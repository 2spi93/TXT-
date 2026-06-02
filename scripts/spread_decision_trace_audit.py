#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row


def _to_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:
        return None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _db_url() -> str:
    value = os.environ.get("DATABASE_URL", "").strip()
    if value:
        return value
    for candidate in (Path("/run/secrets/database_url"), Path("/workspace/secrets/database_url")):
        if candidate.exists():
            text = candidate.read_text(encoding="utf-8").strip()
            if text:
                return text
    raise RuntimeError("DATABASE_URL unavailable")


def _load_policy(policy_path: str) -> dict[str, Any]:
    path = Path(policy_path)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _extract_nested(obj: Any, path: list[str]) -> Any:
    cur = obj
    for part in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _first_nonempty(obj: dict[str, Any], candidates: list[list[str]]) -> Any:
    for path in candidates:
        value = _extract_nested(obj, path)
        if value is not None and value != "":
            return value
    return None


def _derive_decision_condition(
    payload: dict[str, Any],
    risk: dict[str, Any],
    risk_context: dict[str, Any],
    decision_reason: str,
    coverage_category: str,
    spread_source_norm: str,
) -> str:
    explicit = _first_nonempty(payload, [
        ["decision_condition"],
        ["condition"],
        ["route_condition"],
        ["decision_gate_condition"],
        ["risk_context", "decision_condition"],
        ["risk_context", "condition"],
        ["risk_context", "route_condition"],
        ["risk", "condition"],
    ])
    explicit_text = str(explicit or "").strip().lower()
    if explicit_text:
        return explicit_text

    if bool(_first_nonempty(payload, [["confidence_gate_disabled"], ["risk_context", "confidence_gate_disabled"]])):
        return "confidence_gate_disabled"
    if bool(_first_nonempty(payload, [["fallback_router_selected"], ["risk_context", "fallback_router_selected"]])):
        return "fallback_router_selected"
    if bool(_first_nonempty(payload, [["quote_merge_timeout"], ["risk_context", "quote_merge_timeout"]])):
        return "timeout_before_quote_merge"

    if decision_reason in {"quote_timeout", "quote_fetch_timeout"} or spread_source_norm in {"timeout", "fetch_timeout", "quote_timeout", "quote_fetch_timeout"}:
        return "timeout_before_quote_merge"
    if decision_reason in {"fallback_path_used", "fallback_policy_only"}:
        return "fallback_router_selected"
    if decision_reason in {"legacy_path_used", "spread_source_missing"}:
        return "legacy_path_selected"
    if coverage_category == "quote_observed_but_ignored":
        return "quote_merge_or_gate_mismatch"
    if coverage_category == "quote_observed_and_used":
        return "quote_merged"
    return "condition_unclassified"


def _load_spread_samples(spread_audit_dir: Path) -> list[dict[str, Any]]:
    if not spread_audit_dir.exists():
        return []
    files = sorted(spread_audit_dir.glob("mt5_spread_audit_BTCUSD_*.jsonl"), key=lambda p: p.stat().st_mtime)
    if not files:
        return []
    rows: list[dict[str, Any]] = []
    for line in files[-1].read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except Exception:
            continue
        observed_at = _parse_iso(str(item.get("observed_at") or ""))
        if observed_at is None:
            continue
        rows.append({
            "observed_at": observed_at,
            "spread_bps": _to_float(item.get("spread_bps")),
            "venue": str(item.get("venue") or ""),
            "symbol": str(item.get("symbol") or ""),
            "market_symbol": str(item.get("market_symbol") or ""),
        })
    return rows


def _nearest_spread_sample(samples: list[dict[str, Any]], ts: datetime) -> dict[str, Any] | None:
    if not samples:
        return None
    nearest = min(samples, key=lambda row: abs((row["observed_at"] - ts).total_seconds()))
    return nearest


def build_trace_rows(
    *,
    lookback_hours: float,
    limit: int,
    policy: dict[str, Any],
    spread_samples: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    policy_max_slippage_bps = _to_float(policy.get("max_slippage_bps"))
    policy_version = str(policy.get("policy_version") or "")
    cutoff = _utc_now() - timedelta(hours=max(0.0, lookback_hours))
    query = """
        SELECT created_at, category, payload
        FROM audit_events
        WHERE created_at >= %s
          AND category IN ('mt5_order_rejected', 'mt5_order_accepted', 'mt5_live_order_pending_second_approval')
        ORDER BY created_at DESC
        LIMIT %s
    """
    rows_out: list[dict[str, Any]] = []
    with psycopg.connect(_db_url()) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(query, (cutoff, limit))
            for row in cur.fetchall():
                payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
                risk = payload.get("risk") if isinstance(payload.get("risk"), dict) else {}
                risk_context = payload.get("risk_context") if isinstance(payload.get("risk_context"), dict) else {}
                reasons = risk.get("reasons") if isinstance(risk.get("reasons"), list) else []
                created_at = row.get("created_at")
                created_iso = created_at.astimezone(timezone.utc).isoformat() if isinstance(created_at, datetime) else None

                request_max_spread_bps = _to_float(_first_nonempty(payload, [
                    ["max_spread_bps"],
                    ["risk_context", "max_spread_bps"],
                    ["risk_context", "request", "max_spread_bps"],
                    ["request", "max_spread_bps"],
                ]))
                spread_live_used = _to_float(_first_nonempty(payload, [
                    ["spread_live_used"],
                    ["spread_bps"],
                    ["risk_context", "spread_bps"],
                    ["risk_context", "observed_spread_bps"],
                    ["tradability", "spread_bps"],
                ]))
                spread_source = str(_first_nonempty(payload, [
                    ["spread_source"],
                    ["risk_context", "spread_source"],
                    ["tradability", "spread_source"],
                ]) or "").strip() or None
                decision_path = str(_first_nonempty(payload, [
                    ["decision_path"],
                    ["path"],
                    ["route_path"],
                    ["route_key"],
                    ["risk_context", "decision_path"],
                    ["risk_context", "path"],
                ]) or row.get("category") or "unknown_path").strip() or "unknown_path"
                decision_reason = str(_first_nonempty(payload, [
                    ["decision_reason"],
                    ["route_reason"],
                    ["reason"],
                    ["decision_cause"],
                    ["risk", "decision_reason"],
                    ["risk", "route_reason"],
                    ["risk_context", "decision_reason"],
                    ["risk_context", "reason"],
                ]) or "").strip()

                if spread_source is None:
                    if spread_live_used is not None:
                        spread_source = "payload_trace"
                    elif "spread_too_wide" in [str(item) for item in reasons]:
                        spread_source = "policy_only"

                spread_source_norm = str(spread_source or "").strip().lower()
                has_quote_trace = spread_source_norm in {"payload_trace", "observed", "live_quote", "broker_quote", "bridge_quote_api"}
                if spread_live_used is not None:
                    coverage_category = "quote_observed_and_used"
                elif spread_source_norm in {"timeout", "fetch_timeout", "quote_timeout", "quote_fetch_timeout"}:
                    coverage_category = "quote_timeout"
                elif has_quote_trace:
                    coverage_category = "quote_observed_but_ignored"
                elif spread_source_norm in {"policy_only", "fallback_policy_only", "policy_fallback", "fallback"}:
                    coverage_category = "fallback_path_used"
                elif spread_source_norm in {"", "legacy", "legacy_path", "spread_source_missing", "unknown", "payload_trace"}:
                    coverage_category = "legacy_path_used"
                elif spread_source_norm in {"unavailable", "quote_unavailable", "no_quote"}:
                    coverage_category = "quote_unavailable"
                else:
                    coverage_category = "legacy_path_used"

                if not decision_reason:
                    if coverage_category == "quote_observed_but_ignored":
                        if spread_source_norm in {"timeout", "fetch_timeout", "quote_timeout", "quote_fetch_timeout"}:
                            decision_reason = "quote_timeout"
                        elif spread_source_norm in {"policy_only", "fallback_policy_only", "policy_fallback", "fallback"}:
                            decision_reason = "fallback_path_used"
                        elif spread_source_norm in {"", "legacy", "legacy_path", "spread_source_missing", "unknown", "payload_trace"}:
                            decision_reason = "legacy_path_used"
                        elif spread_source_norm in {"unavailable", "quote_unavailable", "no_quote"}:
                            decision_reason = "quote_unavailable"
                        else:
                            decision_reason = "quote_observed_but_ignored"
                    elif coverage_category == "quote_timeout":
                        decision_reason = "quote_timeout"
                    elif coverage_category == "quote_unavailable":
                        decision_reason = "quote_unavailable"
                    elif coverage_category == "fallback_path_used":
                        decision_reason = "fallback_path_used"
                    elif coverage_category == "legacy_path_used":
                        decision_reason = "legacy_path_used"
                decision_reason = decision_reason or "n/a"
                decision_condition = _derive_decision_condition(
                    payload=payload,
                    risk=risk,
                    risk_context=risk_context,
                    decision_reason=decision_reason,
                    coverage_category=coverage_category,
                    spread_source_norm=spread_source_norm,
                )

                decision_id = str(_first_nonempty(payload, [
                    ["decision_id"],
                    ["risk_context", "decision_id"],
                    ["risk_context", "go_live_hardening", "decision_id"],
                ]) or "").strip() or None
                approval_id = str(_first_nonempty(payload, [["approval_id"], ["risk_context", "approval_id"]]) or "").strip() or None
                symbol = str(_first_nonempty(payload, [["symbol"], ["risk_context", "go_live_hardening", "symbol"]]) or "").strip() or None
                account_id = str(_first_nonempty(payload, [["account_id"], ["risk_context", "go_live_hardening", "account_id"]]) or "").strip() or None

                nearest = _nearest_spread_sample(spread_samples, created_at.astimezone(timezone.utc)) if isinstance(created_at, datetime) else None
                proxy_spread_bps = nearest.get("spread_bps") if nearest else None
                proxy_spread_ts = nearest.get("observed_at").isoformat() if nearest else None
                proxy_spread_age_seconds = abs((nearest.get("observed_at") - created_at.astimezone(timezone.utc)).total_seconds()) if nearest and isinstance(created_at, datetime) else None

                rows_out.append({
                    "event_at": created_iso,
                    "category": row.get("category"),
                    "decision_id": decision_id,
                    "approval_id": approval_id,
                    "account_id": account_id,
                    "symbol": symbol,
                    "request_max_spread_bps": request_max_spread_bps,
                    "policy_max_slippage_bps": policy_max_slippage_bps,
                    "policy_version": policy_version or str(risk.get("policy_version") or "") or None,
                    "spread_live_used": spread_live_used,
                    "spread_source": spread_source,
                    "decision_path": decision_path,
                    "decision_reason": decision_reason,
                    "canonical_decision_reason": decision_reason,
                    "decision_condition": decision_condition,
                    "decision_source": spread_source or "unknown_source",
                    "decision_quote_coverage_category": coverage_category,
                    "reject_reason": reasons,
                    "decision": str(risk.get("decision") or "").strip() or None,
                    "spread_market_proxy_bps": proxy_spread_bps,
                    "spread_market_proxy_at": proxy_spread_ts,
                    "spread_market_proxy_age_seconds": proxy_spread_age_seconds,
                })
    return rows_out


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    spread_rejects = [row for row in rows if "spread_too_wide" in [str(x) for x in (row.get("reject_reason") or [])]]
    policy_only = [row for row in spread_rejects if row.get("spread_source") == "policy_only"]
    with_spread_used = [row for row in spread_rejects if row.get("spread_live_used") is not None]
    coverage_categories = {
        "quote_observed_and_used": 0,
        "quote_observed_but_ignored": 0,
        "quote_timeout": 0,
        "quote_unavailable": 0,
        "fallback_path_used": 0,
        "legacy_path_used": 0,
    }
    for row in spread_rejects:
        category = str(row.get("decision_quote_coverage_category") or "legacy_path_used")
        if category in coverage_categories:
            coverage_categories[category] += 1
        else:
            coverage_categories["legacy_path_used"] += 1
    return {
        "generated_at": _utc_now().isoformat(),
        "rows": len(rows),
        "spread_too_wide_rows": len(spread_rejects),
        "policy_only_rows": len(policy_only),
        "spread_live_used_rows": len(with_spread_used),
        "policy_only_rate_pct": round((len(policy_only) / len(spread_rejects)) * 100.0, 4) if spread_rejects else None,
        "spread_live_used_rate_pct": round((len(with_spread_used) / len(spread_rejects)) * 100.0, 4) if spread_rejects else None,
        "decision_quote_coverage_breakdown": [
            {
                "key": key,
                "count": count,
                "share_pct": round((count / len(spread_rejects)) * 100.0, 4) if spread_rejects else None,
            }
            for key, count in coverage_categories.items()
        ],
        "distinct_symbols": sorted({str(row.get("symbol") or "") for row in rows if row.get("symbol")}),
        "note": "policy_only means spread_too_wide was emitted without a traceable spread_live_used value in the event payload.",
    }


def summarize_remediation(
    rows: list[dict[str, Any]],
    *,
    ignored_rate_threshold_pct: float = 10.0,
    impact_threshold_pct_points: float = 1.0,
    top_n: int = 3,
) -> dict[str, Any]:
    spread_rejects = [row for row in rows if "spread_too_wide" in [str(x) for x in (row.get("reject_reason") or [])]]
    spread_total = len(spread_rejects)
    known_conditions = [
        "confidence_gate_disabled",
        "fallback_router_selected",
        "timeout_before_quote_merge",
        "legacy_path_selected",
        "quote_merge_or_gate_mismatch",
        "quote_merged",
        "condition_unclassified",
    ]
    known_conditions_set = set(known_conditions)
    # DECISION_REALITY_OBSERVED: spread reality is "observed" when we know the spread
    # situation at decision time — whether positive (quote used), negative (broker
    # confirmed unavailable), or deliberate (policy fallback chosen). Only rows with
    # zero spread context (legacy_path_used with no source) are "unobserved".
    _REALITY_OBSERVED_COVERAGE_CATEGORIES = frozenset({
        "quote_observed_and_used",   # live broker spread confirmed and used
        "quote_unavailable",          # broker confirmed no quote → absence is evidence
        "fallback_path_used",         # deliberate policy choice → known decision context
    })
    decision_quote_covered_rows = len(
        [row for row in spread_rejects
         if str(row.get("decision_quote_coverage_category") or "") in _REALITY_OBSERVED_COVERAGE_CATEGORIES]
    )
    top_limit = max(1, min(top_n, 20))
    path_reason_total: dict[tuple[str, str], int] = {}
    path_reason_ignored: dict[tuple[str, str], int] = {}
    path_reason_source_ignored: dict[tuple[str, str, str], int] = {}
    path_reason_condition_ignored: dict[tuple[str, str, str], int] = {}
    condition_stats: dict[str, dict[str, Any]] = {}
    path_condition_seen: dict[str, set[str]] = {}
    # MC/DC prevalence: count each known condition across ALL spread_too_wide rows,
    # not just ignored-quote rows. Enables impact_pct_points ≠ 0 for correct-path conditions.
    condition_prevalence: dict[str, int] = {}

    remediation_reason_to_action = {
        "quote_timeout": "Augmenter la resilience quote fetch (timeout/retry) sur ce path.",
        "quote_fetch_timeout": "Raccourcir le chemin de fallback et renforcer retry budget quote.",
        "fallback_path_used": "Verifier la condition de fallback et re-prioriser quote broker sur ce path.",
        "legacy_path_used": "Migrer le path legacy vers route quote-aware v2.",
        "quote_unavailable": "Verifier la disponibilite quote broker et la qualite des snapshots.",
        "partial_quote_metadata": "Completer les metadonnees quote (bid/ask/spread/timestamp/source).",
        "spread_source_missing": "Instrumenter spread_source pour supprimer les contournements implicites.",
        "quote_timestamp_missing": "Forcer l'horodatage quote avant arbitrage de spread.",
        "quote_missing": "Traiter la source quote manquante avant decision routing.",
    }

    for row in spread_rejects:
        decision_path = str(row.get("decision_path") or "unknown_path").strip() or "unknown_path"
        decision_reason = str(row.get("decision_reason") or "n/a").strip() or "n/a"
        key = (decision_path, decision_reason)
        path_reason_total[key] = path_reason_total.get(key, 0) + 1
        condition_name = str(row.get("decision_condition") or "condition_unclassified").strip() or "condition_unclassified"
        seen = path_condition_seen.get(decision_path) or set()
        seen.add(condition_name)
        path_condition_seen[decision_path] = seen
        condition_prevalence[condition_name] = condition_prevalence.get(condition_name, 0) + 1
        if str(row.get("decision_quote_coverage_category") or "") == "quote_observed_but_ignored":
            path_reason_ignored[key] = path_reason_ignored.get(key, 0) + 1
            source = str(row.get("decision_source") or "unknown_source").strip() or "unknown_source"
            src_key = (decision_path, decision_reason, source)
            path_reason_source_ignored[src_key] = path_reason_source_ignored.get(src_key, 0) + 1
            condition = condition_name
            cond_key = (decision_path, decision_reason, condition)
            path_reason_condition_ignored[cond_key] = path_reason_condition_ignored.get(cond_key, 0) + 1
            event_at = _parse_iso(str(row.get("event_at") or ""))
            stat = condition_stats.get(condition) or {
                "condition": condition,
                "ignored_rows": 0,
                "first_seen": None,
                "last_seen": None,
            }
            stat["ignored_rows"] = int(stat.get("ignored_rows") or 0) + 1
            if isinstance(event_at, datetime):
                first_seen = stat.get("first_seen")
                last_seen = stat.get("last_seen")
                if first_seen is None or event_at < first_seen:
                    stat["first_seen"] = event_at
                if last_seen is None or event_at > last_seen:
                    stat["last_seen"] = event_at
            condition_stats[condition] = stat

    alerts: list[dict[str, Any]] = []
    for (decision_path, decision_reason), total_rows in path_reason_total.items():
        ignored_rows = path_reason_ignored.get((decision_path, decision_reason), 0)
        if ignored_rows <= 0:
            continue
        ignored_rate_pct = (ignored_rows / total_rows * 100.0) if total_rows > 0 else None
        volume_share_pct = (total_rows / spread_total * 100.0) if spread_total > 0 else None
        impact_pct_points = (ignored_rows / spread_total * 100.0) if spread_total > 0 else None
        ignored_rate_alert = bool(ignored_rate_pct is not None and ignored_rate_pct > ignored_rate_threshold_pct)
        impact_alert = bool(impact_pct_points is not None and impact_pct_points > impact_threshold_pct_points)
        alerts.append(
            {
                "decision_path": decision_path,
                "decision_reason": decision_reason,
                "total_rows": total_rows,
                "ignored_rows": ignored_rows,
                "ignored_rate_pct": round(ignored_rate_pct, 6) if ignored_rate_pct is not None else None,
                "volume_share_pct": round(volume_share_pct, 6) if volume_share_pct is not None else None,
                "impact_pct_points": round(impact_pct_points, 6) if impact_pct_points is not None else None,
                "threshold_pct": ignored_rate_threshold_pct,
                "impact_threshold_pct_points": impact_threshold_pct_points,
                "ignored_rate_alert": ignored_rate_alert,
                "impact_alert": impact_alert,
                "alert": bool(ignored_rate_alert or impact_alert),
            }
        )

    alerts.sort(
        key=lambda item: (
            0 if item.get("alert") else 1,
            -(item.get("impact_pct_points") or 0),
            -(item.get("ignored_rate_pct") or 0),
            -int(item.get("ignored_rows") or 0),
            str(item.get("decision_path") or ""),
            str(item.get("decision_reason") or ""),
        )
    )

    candidates: list[dict[str, Any]] = []
    for item in alerts[:20]:
        decision_path = str(item.get("decision_path") or "unknown_path")
        decision_reason = str(item.get("decision_reason") or "n/a")
        ignored_rows = int(item.get("ignored_rows") or 0)
        source_counts = [
            (source, count)
            for (path_value, reason_value, source), count in path_reason_source_ignored.items()
            if path_value == decision_path and reason_value == decision_reason
        ]
        source_counts.sort(key=lambda pair: (-pair[1], pair[0]))
        top_sources = [
            {
                "source": source,
                "count": count,
                "share_pct": round((count / ignored_rows * 100.0), 6) if ignored_rows > 0 else None,
            }
            for source, count in source_counts[:3]
        ]
        condition_counts = [
            (condition, count)
            for (path_value, reason_value, condition), count in path_reason_condition_ignored.items()
            if path_value == decision_path and reason_value == decision_reason
        ]
        condition_counts.sort(key=lambda pair: (-pair[1], pair[0]))
        top_conditions = [
            {
                "condition": condition,
                "count": count,
                "share_pct": round((count / ignored_rows * 100.0), 6) if ignored_rows > 0 else None,
            }
            for condition, count in condition_counts[:3]
        ]
        top_condition = top_conditions[0] if top_conditions else {"condition": "condition_unclassified", "count": 0, "share_pct": None}
        candidates.append(
            {
                **item,
                "canonical_decision_reason": decision_reason,
                "canonical_decision_condition": str(top_condition.get("condition") or "condition_unclassified"),
                "top_condition": str(top_condition.get("condition") or "condition_unclassified"),
                "top_condition_count": int(top_condition.get("count") or 0),
                "top_condition_share_pct": top_condition.get("share_pct"),
                "top_conditions": top_conditions,
                "top_sources": top_sources,
                "suggested_action": remediation_reason_to_action.get(
                    decision_reason,
                    "Inspecter la condition de routage et supprimer le contournement quote.",
                ),
            }
        )

    candidates.sort(
        key=lambda item: (
            0 if item.get("alert") else 1,
            -(item.get("impact_pct_points") or 0),
            -(item.get("ignored_rate_pct") or 0),
            -int(item.get("ignored_rows") or 0),
        )
    )
    top_candidates = candidates[:top_limit]

    ignored_total = int(sum(path_reason_ignored.values()))
    # Rebuild condition_lifetime from ALL known conditions, using prevalence-based
    # impact_pct_points (fraction of spread_too_wide rows for each condition).
    # This gives non-zero impact to healthy conditions (quote_merged etc.) so the
    # MC/DC proven_now stability check can fire after 2+ daily runs.
    condition_lifetime = []
    for cond in known_conditions:
        stat = condition_stats.get(cond) or {}
        prevalent_rows = condition_prevalence.get(cond, 0)
        ignored_rows_c = int(stat.get("ignored_rows") or 0)
        condition_lifetime.append({
            "condition": cond,
            "first_seen": stat.get("first_seen").isoformat() if isinstance(stat.get("first_seen"), datetime) else None,
            "last_seen": stat.get("last_seen").isoformat() if isinstance(stat.get("last_seen"), datetime) else None,
            "prevalent_rows": prevalent_rows,
            "ignored_rows": ignored_rows_c,
            # prevalence-based impact: % of spread_too_wide rows where this condition appeared
            "impact_pct_points": round((prevalent_rows / spread_total) * 100.0, 6) if spread_total > 0 else None,
            # ignored-row rate kept for backward compat / remediation tracking
            "ignored_rate_pct": round((ignored_rows_c / spread_total) * 100.0, 6) if spread_total > 0 else None,
        })
    condition_lifetime.sort(
        key=lambda item: (
            -(item.get("impact_pct_points") or 0),
            str(item.get("condition") or ""),
        )
    )
    observed_conditions_set = set()
    for seen_set in path_condition_seen.values():
        observed_conditions_set.update(seen_set)
    observed_conditions = sorted(observed_conditions_set)
    unknown_conditions = sorted(list(known_conditions_set - observed_conditions_set))
    known_condition_count = len(known_conditions)
    observed_condition_count = len(observed_conditions)
    by_path = []
    for decision_path in sorted(path_condition_seen.keys()):
        path_observed = sorted(path_condition_seen.get(decision_path) or set())
        path_unknown = sorted(list(known_conditions_set - set(path_observed)))
        by_path.append(
            {
                "decision_path": decision_path,
                "known_conditions_count": known_condition_count,
                "observed_conditions_count": len(path_observed),
                "coverage_pct": round((len(path_observed) / known_condition_count) * 100.0, 6) if known_condition_count > 0 else None,
                "observed_conditions": path_observed,
                "unknown_conditions": path_unknown,
            }
        )
    decision_condition_coverage = {
        "known_conditions": known_conditions,
        "known_conditions_count": known_condition_count,
        "observed_conditions": observed_conditions,
        "observed_conditions_count": observed_condition_count,
        "unknown_conditions": unknown_conditions,
        "unknown_conditions_count": len(unknown_conditions),
        "coverage_pct": round((observed_condition_count / known_condition_count) * 100.0, 6) if known_condition_count > 0 else None,
        "by_path": by_path,
    }

    return {
        "generated_at": _utc_now().isoformat(),
        "rows": len(rows),
        "spread_too_wide_rows": spread_total,
        "decision_quote_covered_rows": decision_quote_covered_rows,
        "decision_quote_coverage_pct": round((decision_quote_covered_rows / spread_total) * 100.0, 6) if spread_total > 0 else None,
        "decision_quote_observed_ignored_rows": ignored_total,
        "decision_quote_observed_ignored_rate_pct": round((ignored_total / spread_total) * 100.0, 6) if spread_total > 0 else None,
        "decision_quote_ignored_path_reason_threshold_pct": ignored_rate_threshold_pct,
        "decision_quote_ignored_path_reason_impact_threshold_pct_points": impact_threshold_pct_points,
        "decision_quote_ignored_path_reason_alerts": alerts,
        "decision_quote_ignored_path_reason_condition_alerts": candidates,
        "decision_condition_coverage": decision_condition_coverage,
        "decision_condition_coverage_pct": decision_condition_coverage.get("coverage_pct"),
        "condition_lifetime": condition_lifetime,
        "top_n": top_limit,
        "top_candidates": top_candidates,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build spread decision trace audit from MT5 risk events.")
    parser.add_argument("--lookback-hours", type=float, default=float(os.environ.get("LOOKBACK_HOURS", "48")))
    parser.add_argument("--limit", type=int, default=int(os.environ.get("LIMIT", "500")))
    parser.add_argument("--policy-path", default=os.environ.get("RISK_POLICY_PATH", "/workspace/config/risk_policy.json"))
    parser.add_argument("--spread-audit-dir", default=os.environ.get("SPREAD_AUDIT_DIR", "/workspace/logs/spread_audit"))
    parser.add_argument("--output-dir", default=os.environ.get("OUTPUT_DIR", "/workspace/logs/spread_audit"))
    parser.add_argument("--export-remediation-snapshot", action="store_true")
    parser.add_argument("--remediation-top-n", type=int, default=int(os.environ.get("REMEDIATION_TOP_N", "3")))
    parser.add_argument("--remediation-ignored-rate-threshold-pct", type=float, default=float(os.environ.get("REMEDIATION_IGNORED_RATE_THRESHOLD_PCT", "10")))
    parser.add_argument("--remediation-impact-threshold-pct-points", type=float, default=float(os.environ.get("REMEDIATION_IMPACT_THRESHOLD_PCT_POINTS", "1")))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    run_id = _utc_now().strftime("%Y%m%dT%H%M%SZ")
    trace_path = output_dir / f"spread_decision_trace_{run_id}.jsonl"
    summary_path = output_dir / f"spread_decision_trace_{run_id}.summary.json"
    remediation_snapshot_path = output_dir / f"spread_decision_remediation_snapshot_{run_id}.json"

    policy = _load_policy(args.policy_path)
    spread_samples = _load_spread_samples(Path(args.spread_audit_dir))
    rows = build_trace_rows(
        lookback_hours=args.lookback_hours,
        limit=args.limit,
        policy=policy,
        spread_samples=spread_samples,
    )

    with trace_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=True) + "\n")

    summary = summarize(rows)
    with summary_path.open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2, ensure_ascii=True)
        handle.write("\n")

    remediation_snapshot: dict[str, Any] | None = None
    if args.export_remediation_snapshot:
        remediation_snapshot = summarize_remediation(
            rows,
            ignored_rate_threshold_pct=max(0.1, float(args.remediation_ignored_rate_threshold_pct)),
            impact_threshold_pct_points=max(0.05, float(args.remediation_impact_threshold_pct_points)),
            top_n=args.remediation_top_n,
        )
        with remediation_snapshot_path.open("w", encoding="utf-8") as handle:
            json.dump(remediation_snapshot, handle, indent=2, ensure_ascii=True)
            handle.write("\n")

    print(json.dumps({
        "trace_path": str(trace_path),
        "summary_path": str(summary_path),
        "remediation_snapshot_path": str(remediation_snapshot_path) if remediation_snapshot is not None else None,
        "summary": summary,
        "remediation_snapshot": remediation_snapshot,
        "preview": rows[:10],
    }, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())