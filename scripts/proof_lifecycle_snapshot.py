#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


DEFAULT_SNAPSHOT = Path("logs/spread_audit/remediation_snapshot_latest.json")


def proof_age_state(value: float | None, thresholds: dict[str, Any]) -> str:
    if value is None:
        return "EXPIRED"
    age_days = float(value)
    if age_days < float(thresholds.get("fresh_days") or 0.0):
        return "FRESH"
    if age_days <= float(thresholds.get("stale_days") or 0.0):
        return "AGING"
    if age_days <= float(thresholds.get("expired_days") or 0.0):
        return "STALE"
    return "EXPIRED"


def worst_proof_state(states: list[str]) -> str:
    order = {"FRESH": 0, "AGING": 1, "STALE": 2, "EXPIRED": 3}
    return max(states, key=lambda item: order.get(item, 3)) if states else "EXPIRED"


def proof_renewal_lag_days(value: float | None, thresholds: dict[str, Any]) -> float | None:
    if value is None:
        return None
    return round(max(float(value) - float(thresholds.get("fresh_days") or 0.0), 0.0), 6)


def proof_days_until(value: float | None, threshold_days: float | None) -> float | None:
    if value is None or threshold_days is None:
        return None
    return round(float(threshold_days) - float(value), 6)


def proof_signal(value: float | None, thresholds: dict[str, Any], latest_at: str | None) -> dict[str, Any]:
    return {
        "state": proof_age_state(value, thresholds),
        "age_days": value,
        "renewal_lag_days": proof_renewal_lag_days(value, thresholds),
        "days_until_stale": proof_days_until(value, thresholds.get("stale_days")),
        "days_until_expired": proof_days_until(value, thresholds.get("expired_days")),
        "thresholds": thresholds,
        "latest_at": latest_at,
    }


def _signal_entry(signal: str, item: dict[str, Any]) -> dict[str, Any]:
    return {
        "signal": signal,
        "state": item.get("state"),
        "age_days": item.get("age_days"),
        "fresh_days": item.get("thresholds", {}).get("fresh_days"),
        "expired_days": item.get("thresholds", {}).get("expired_days"),
        "renewal_lag_days": item.get("renewal_lag_days"),
        "days_until_expired": item.get("days_until_expired"),
        "latest_at": item.get("latest_at"),
    }


def build_lifecycle(snapshot: dict[str, Any]) -> dict[str, Any]:
    regression = snapshot.get("proof_regression") if isinstance(snapshot.get("proof_regression"), dict) else {}
    renewal = regression.get("proof_renewal") if isinstance(regression.get("proof_renewal"), dict) else {}
    existing_signals = renewal.get("signals") if isinstance(renewal.get("signals"), dict) else {}

    signals: dict[str, dict[str, Any]] = {}
    for name in ("ack", "fill", "outcome", "gap_sample"):
        current = existing_signals.get(name) if isinstance(existing_signals.get(name), dict) else {}
        thresholds = current.get("thresholds") if isinstance(current.get("thresholds"), dict) else {}
        age_days = current.get("age_days")
        if age_days is None:
            age_days = regression.get(f"days_since_last_{name}")
        signals[name] = proof_signal(age_days, thresholds, current.get("latest_at"))

    renewal_priority = sorted(
        [_signal_entry(name, item) for name, item in signals.items()],
        key=lambda item: (
            0 if item.get("renewal_lag_days") is None else 1,
            0.0 if item.get("renewal_lag_days") is None else -float(item.get("renewal_lag_days") or 0.0),
            str(item.get("signal") or ""),
        ),
    )
    expiration_priority = sorted(
        [_signal_entry(name, item) for name, item in signals.items()],
        key=lambda item: (
            0 if item.get("days_until_expired") is None else 1,
            0.0 if item.get("days_until_expired") is None else float(item.get("days_until_expired") or 0.0),
            str(item.get("signal") or ""),
        ),
    )

    state = worst_proof_state([item["state"] for item in signals.values()])
    fresh_proven = all(item["state"] == "FRESH" for item in signals.values())
    proof_expired = any(item["state"] == "EXPIRED" for item in signals.values())
    proof_staleness = regression.get("proof_staleness") if isinstance(regression.get("proof_staleness"), dict) else {}
    missing_signals = proof_staleness.get("missing_signals") if isinstance(proof_staleness.get("missing_signals"), list) else []

    return {
        "state": "FRESH" if fresh_proven else state,
        "fresh_proven": fresh_proven,
        "proof_renewal_due": any(item["state"] in ("STALE", "EXPIRED") for item in signals.values()),
        "proof_expired": proof_expired,
        "proof_decay_detected": state in ("AGING", "STALE", "EXPIRED"),
        "proof_invalidated": bool(proof_expired or missing_signals),
        "max_lag_days": max(
            [item["renewal_lag_days"] for item in signals.values() if item.get("renewal_lag_days") is not None],
            default=None,
        ),
        "next_signal_to_renew": renewal_priority[0]["signal"] if renewal_priority else None,
        "next_signal_to_expire": expiration_priority[0]["signal"] if expiration_priority else None,
        "renewal_priority": renewal_priority,
        "expiration_priority": expiration_priority,
        "signals": signals,
    }


def build_v1_closure(snapshot: dict[str, Any], lifecycle: dict[str, Any]) -> dict[str, Any]:
    strict = snapshot.get("strict_v1_proof") if isinstance(snapshot.get("strict_v1_proof"), dict) else {}
    metrics = strict.get("metrics") if isinstance(strict.get("metrics"), dict) else {}
    thresholds = strict.get("thresholds") if isinstance(strict.get("thresholds"), dict) else {}
    unknown_count = metrics.get("unknown_conditions_count")
    unknown_max = thresholds.get("unknown_conditions_max")

    def gap(metric_name: str, threshold_name: str) -> float | None:
        metric = metrics.get(metric_name)
        threshold = thresholds.get(threshold_name)
        if metric is None or threshold is None:
            return None
        return round(max(float(threshold) - float(metric), 0.0), 6)

    unknown_to_target = None
    if unknown_count is not None and unknown_max is not None:
        unknown_to_target = max(int(unknown_count) - int(unknown_max), 0)

    return {
        "fresh_proven": bool(lifecycle.get("fresh_proven")),
        "fresh_state": lifecycle.get("state"),
        "proof_decay_detected": bool(lifecycle.get("proof_decay_detected")),
        "proof_invalidated": bool(lifecycle.get("proof_invalidated")),
        "strict_v1_proven": bool(strict.get("strict_v1_proven")),
        "operational_v1_proven": bool(strict.get("operational_v1_proven")),
        "decision_reality_observed": bool(strict.get("decision_reality_observed")),
        "broker_reality_validated": bool(strict.get("broker_reality_validated")),
        "execution_gap_validated": bool(strict.get("execution_gap_validated")),
        "strict_remaining": {
            "coverage_pct_to_target": gap("coverage_pct", "decision_mc_dc_target_pct"),
            "proof_coverage_pct_to_target": gap("proof_coverage_pct", "proof_coverage_min_pct"),
            "unknown_conditions_to_target": unknown_to_target,
            "elimination_coverage_pct_to_target": gap("elimination_coverage_pct", "elimination_coverage_min_pct"),
        },
        "metrics": metrics,
        "thresholds": thresholds,
    }


def format_text(lifecycle: dict[str, Any]) -> str:
    def fmt_days(value: Any) -> str:
        return "n/a" if value is None else f"{float(value):.2f}d"

    return (
        "Proof Lifecycle: "
        f"state={lifecycle.get('state')} "
        f"fresh={'yes' if lifecycle.get('fresh_proven') else 'no'} "
        f"renew_next={lifecycle.get('next_signal_to_renew') or 'none'} "
        f"expire_next={lifecycle.get('next_signal_to_expire') or 'none'} "
        f"max_lag={fmt_days(lifecycle.get('max_lag_days'))} "
        f"decay={'yes' if lifecycle.get('proof_decay_detected') else 'no'} "
        f"invalidated={'yes' if lifecycle.get('proof_invalidated') else 'no'}"
    )


def format_audit(closure: dict[str, Any], lifecycle: dict[str, Any]) -> str:
    remaining = closure.get("strict_remaining") if isinstance(closure.get("strict_remaining"), dict) else {}

    def fmt(value: Any, suffix: str = "") -> str:
        if value is None:
            return "n/a"
        if isinstance(value, int):
            return f"{value}{suffix}"
        return f"{float(value):.2f}{suffix}"

    return (
        "V1 Closure: "
        f"fresh={'yes' if closure.get('fresh_proven') else 'no'} "
        f"strict={'yes' if closure.get('strict_v1_proven') else 'no'} "
        f"operational={'yes' if closure.get('operational_v1_proven') else 'no'} "
        f"renew_next={lifecycle.get('next_signal_to_renew') or 'none'} "
        f"expire_next={lifecycle.get('next_signal_to_expire') or 'none'} "
        f"coverage_gap={fmt(remaining.get('coverage_pct_to_target'), 'pts')} "
        f"proof_gap={fmt(remaining.get('proof_coverage_pct_to_target'), 'pts')} "
        f"unknown_gap={fmt(remaining.get('unknown_conditions_to_target'))} "
        f"elimination_gap={fmt(remaining.get('elimination_coverage_pct_to_target'), 'pts')}"
    )


def failed_checks(closure: dict[str, Any], lifecycle: dict[str, Any], checks: list[str]) -> list[str]:
    failures = []
    for check in checks:
        if check == "fresh" and not closure.get("fresh_proven"):
            failures.append(check)
        elif check == "operational" and not closure.get("operational_v1_proven"):
            failures.append(check)
        elif check == "strict" and not closure.get("strict_v1_proven"):
            failures.append(check)
        elif check == "not-invalidated" and lifecycle.get("proof_invalidated"):
            failures.append(check)
    return failures


def build_recommendations(closure: dict[str, Any], lifecycle: dict[str, Any]) -> list[str]:
    recommendations = []
    if lifecycle.get("proof_invalidated"):
        recommendations.append("BLOCK: proof invalidated; investigate missing or expired proof before closure.")
    elif lifecycle.get("proof_decay_detected"):
        recommendations.append(
            f"RENEW: prioritize {lifecycle.get('next_signal_to_renew') or 'unknown'} proof renewal."
        )
        recommendations.append(
            f"WATCH: {lifecycle.get('next_signal_to_expire') or 'unknown'} is closest to expiration."
        )
    else:
        recommendations.append("OK: proof lifecycle is fresh.")

    if not closure.get("operational_v1_proven"):
        recommendations.append("OBSERVE: wait for decision rows before claiming operational v1 closure.")
    if not closure.get("strict_v1_proven"):
        remaining = closure.get("strict_remaining") if isinstance(closure.get("strict_remaining"), dict) else {}
        recommendations.append(
            "MAP: close strict v1 gaps "
            f"coverage={remaining.get('coverage_pct_to_target')} "
            f"proof={remaining.get('proof_coverage_pct_to_target')} "
            f"unknown={remaining.get('unknown_conditions_to_target')} "
            f"elimination={remaining.get('elimination_coverage_pct_to_target')}."
        )
    if not recommendations:
        recommendations.append("OK: no lifecycle recommendation.")
    return recommendations


def main() -> int:
    parser = argparse.ArgumentParser(description="Render TXT proof lifecycle from a remediation snapshot JSON.")
    parser.add_argument("snapshot", nargs="?", default=str(DEFAULT_SNAPSHOT))
    parser.add_argument("--text", action="store_true", help="print a one-line human summary")
    parser.add_argument("--audit", action="store_true", help="print a one-line v1 closure audit")
    parser.add_argument("--recommend", action="store_true", help="print proof lifecycle recommendations")
    parser.add_argument(
        "--check",
        action="append",
        choices=("fresh", "operational", "strict", "not-invalidated"),
        default=[],
        help="return exit code 2 if the requested gate is not satisfied; can be repeated",
    )
    args = parser.parse_args()

    snapshot = json.loads(Path(args.snapshot).read_text(encoding="utf-8"))
    lifecycle = build_lifecycle(snapshot)
    closure = build_v1_closure(snapshot, lifecycle)
    if args.recommend:
        for item in build_recommendations(closure, lifecycle):
            print(item)
    elif args.audit:
        print(format_audit(closure, lifecycle))
    elif args.text:
        print(format_text(lifecycle))
    else:
        print(
            json.dumps(
                {
                    "proof_lifecycle": lifecycle,
                    "v1_closure": closure,
                },
                ensure_ascii=True,
                sort_keys=True,
            )
        )
    failures = failed_checks(closure, lifecycle, args.check)
    if failures:
        print(f"failed_checks={','.join(failures)}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
