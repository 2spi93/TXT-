#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


PUBLIC_VENUE_SUFFIX = "-public"
DEFAULT_HOURS = 24.0
DEFAULT_DOCKER_CONTAINER = "control-plane"


def parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def is_public_venue(venue: Any) -> bool:
    return str(venue or "").strip().lower().endswith(PUBLIC_VENUE_SUFFIX)


def is_real_fill(row: dict[str, Any]) -> bool:
    return not is_public_venue(row.get("venue")) and float(row.get("notional_usd") or 0.0) > 0.0


def _event_time(row: dict[str, Any], *keys: str) -> datetime | None:
    for key in keys:
        parsed = parse_time(row.get(key))
        if parsed is not None:
            return parsed
    return None


def _filter_recent(rows: list[dict[str, Any]], *, since: datetime | None, time_keys: tuple[str, ...]) -> list[dict[str, Any]]:
    if since is None:
        return list(rows)
    return [row for row in rows if (ts := _event_time(row, *time_keys)) is not None and ts >= since]


def load_payload(path: Path) -> dict[str, list[dict[str, Any]]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("input payload must be a JSON object")
    return {
        "ack": [row for row in payload.get("ack", []) if isinstance(row, dict)],
        "fill": [row for row in payload.get("fill", []) if isinstance(row, dict)],
        "outcome": [row for row in payload.get("outcome", []) if isinstance(row, dict)],
        "gap": [row for row in payload.get("gap", []) if isinstance(row, dict)],
    }


def fetch_from_docker(container: str, *, limit: int) -> dict[str, list[dict[str, Any]]]:
    remote_code = r'''
import json
import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row


def db_url() -> str:
    value = os.environ.get("DATABASE_URL")
    if value:
        return value
    for candidate in (Path("/run/secrets/database_url"), Path("/workspace/secrets/database_url")):
        if candidate.exists():
            return candidate.read_text(encoding="utf-8").strip()
    raise RuntimeError("database url unavailable")


def rows(cur, sql, params=()):
    cur.execute(sql, params)
    return [dict(row) for row in cur.fetchall()]


limit = max(1, min(500, int(os.environ.get("RECENT_REAL_PROOF_LIMIT", "100"))))
with psycopg.connect(db_url()) as conn:
    with conn.cursor(row_factory=dict_row) as cur:
        payload = {
            "ack": rows(
                cur,
                """
                SELECT id, account_id, symbol, side, lots, mode, status, broker_ticket,
                       chosen_route, expected_slippage_bps, created_at
                FROM mt5_order_events
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (limit,),
            ),
            "fill": rows(
                cur,
                """
                SELECT id, decision_id, fill_id, venue, instrument, side, price,
                       size_base, notional_usd, slippage_bps, fill_latency_ms,
                       filled_at, created_at
                FROM execution_fill_events
                ORDER BY filled_at DESC, created_at DESC
                LIMIT %s
                """,
                (limit,),
            ),
            "outcome": rows(
                cur,
                """
                SELECT decision_id, source, strategy_id, symbol, provider, regime,
                       pnl_5m, pnl_1h, pnl_24h, slippage_real_bps, latency_ms,
                       fees_usd, net_result_usd, status, created_at, updated_at
                FROM decision_outcomes
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (limit,),
            ),
            "gap": rows(
                cur,
                """
                SELECT sample_id, decision_id, symbol, venue, regime, side,
                       failure_source, gap_slippage_bps, gap_fill_probability,
                       gap_latency_ms, gap_impact_bps, created_at
                FROM reality_gap_samples
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (limit,),
            ),
        }
print(json.dumps(payload, default=str, sort_keys=True))
'''
    result = subprocess.run(
        ["docker", "exec", "-i", "-e", f"RECENT_REAL_PROOF_LIMIT={limit}", container, "python3", "-c", remote_code],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return json.loads(result.stdout)


def build_audit(payload: dict[str, list[dict[str, Any]]], *, hours: float = DEFAULT_HOURS, now: datetime | None = None) -> dict[str, Any]:
    current = now or datetime.now(timezone.utc)
    since = current - timedelta(hours=hours) if hours > 0 else None
    ack_rows = _filter_recent(payload.get("ack", []), since=since, time_keys=("created_at",))
    fill_rows = [row for row in _filter_recent(payload.get("fill", []), since=since, time_keys=("filled_at", "created_at")) if is_real_fill(row)]
    outcome_rows = _filter_recent(payload.get("outcome", []), since=since, time_keys=("created_at", "updated_at"))
    gap_rows = _filter_recent(payload.get("gap", []), since=since, time_keys=("created_at",))

    ack_ids = {str(row.get("broker_ticket") or "").strip() for row in ack_rows if str(row.get("broker_ticket") or "").strip()}
    fill_ids = {str(row.get("decision_id") or "").strip() for row in fill_rows if str(row.get("decision_id") or "").strip()}
    outcome_ids = {str(row.get("decision_id") or "").strip() for row in outcome_rows if str(row.get("decision_id") or "").strip()}
    gap_ids = {str(row.get("decision_id") or "").strip() for row in gap_rows if str(row.get("decision_id") or "").strip()}
    complete_ids = sorted(ack_ids & fill_ids & outcome_ids & gap_ids)

    latest = {
        "ack": ack_rows[0] if ack_rows else None,
        "fill": fill_rows[0] if fill_rows else None,
        "outcome": outcome_rows[0] if outcome_rows else None,
        "gap": gap_rows[0] if gap_rows else None,
    }
    checks = {
        "recent_ack": len(ack_rows) > 0,
        "recent_fill": len(fill_rows) > 0,
        "recent_outcome": len(outcome_rows) > 0,
        "recent_gap": len(gap_rows) > 0,
        "complete_linked_loop": len(complete_ids) > 0,
    }
    return {
        "status": "REAL_PROOF_REACTIVATED" if all(checks.values()) else "REAL_PROOF_STALE",
        "window_hours": hours,
        "generated_at": current.isoformat(),
        "since": since.isoformat() if since else None,
        "checks": checks,
        "counts": {
            "ack": len(ack_rows),
            "real_fill": len(fill_rows),
            "outcome": len(outcome_rows),
            "gap": len(gap_rows),
            "complete_linked_loop": len(complete_ids),
        },
        "complete_decision_ids": complete_ids[:20],
        "latest": latest,
    }


def format_text(audit: dict[str, Any]) -> str:
    counts = audit["counts"]
    checks = audit["checks"]
    missing = [name for name, ok in checks.items() if not ok]
    return (
        "Recent Real Proof: "
        f"status={audit['status']} "
        f"ack={counts['ack']} "
        f"fill={counts['real_fill']} "
        f"outcome={counts['outcome']} "
        f"gap={counts['gap']} "
        f"linked={counts['complete_linked_loop']} "
        f"missing={','.join(missing) if missing else 'none'}"
    )


def failed_checks(audit: dict[str, Any], checks: list[str]) -> list[str]:
    mapping = {
        "ack": "recent_ack",
        "fill": "recent_fill",
        "outcome": "recent_outcome",
        "gap": "recent_gap",
        "linked-loop": "complete_linked_loop",
    }
    failures = []
    for check in checks:
        key = mapping[check]
        if not audit["checks"].get(key):
            failures.append(check)
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit recent real ACK/FILL/OUTCOME/GAP proof after a live smoke.")
    parser.add_argument("--input-json", help="Read proof rows from JSON instead of Docker/control-plane DB.")
    parser.add_argument("--docker-container", default=DEFAULT_DOCKER_CONTAINER)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--hours", type=float, default=DEFAULT_HOURS)
    parser.add_argument("--text", action="store_true")
    parser.add_argument(
        "--check",
        action="append",
        choices=("ack", "fill", "outcome", "gap", "linked-loop"),
        default=[],
        help="return exit code 2 if the requested proof is missing; can be repeated",
    )
    args = parser.parse_args()

    if args.input_json:
        payload = load_payload(Path(args.input_json))
    else:
        payload = fetch_from_docker(args.docker_container, limit=args.limit)

    audit = build_audit(payload, hours=args.hours)
    if args.text:
        print(format_text(audit))
    else:
        print(json.dumps(audit, ensure_ascii=True, sort_keys=True, default=str))
    failures = failed_checks(audit, args.check)
    if failures:
        print(f"failed_checks={','.join(failures)}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
