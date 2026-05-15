#!/usr/bin/env python3
"""Edge Map Engine — observation only (STEP 3).

Strictly read-only. Joins three JSONL streams produced upstream:

    logs/reaction_speed_engine.jsonl   (per-event reaction class)
    logs/regime_engine.jsonl           (per-window regime label)
    logs/intent_outcome_labels.jsonl   (per-fill outcome by labeler cron)

For each labeled outcome, we attach:
    - the most recent reaction_class for the same (venue, instrument)
      within REACTION_LOOKBACK_SEC before ts_intent
    - the most recent regime label for the same (venue, instrument)
      within REGIME_LOOKBACK_SEC before ts_intent

Then we aggregate by (reaction_class, regime) and report:
    count, winrate, mean_pnl_bps, median_pnl_bps, stdev_pnl_bps

NO writes to DB, NO calls to opportunity_gate / kill_switch / brain.
NO threshold tuning. Pure observation.

Run:
    python3 scripts/edge_map_engine.py
    python3 scripts/edge_map_engine.py --min-count 5 --pnl-field pnl_bps_5m
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_REACTION = REPO_ROOT / "logs" / "reaction_speed_engine.jsonl"
DEFAULT_REGIME = REPO_ROOT / "logs" / "regime_engine.jsonl"
DEFAULT_OUTCOMES = REPO_ROOT / "logs" / "intent_outcome_labels.jsonl"
DEFAULT_OUTPUT = REPO_ROOT / "logs" / "edge_map_engine.jsonl"

# Fixed asof-join tolerances. Fixed, not tunable in this phase.
REACTION_LOOKBACK_SEC = 300   # accept a reaction event within 5 min before the fill
REGIME_LOOKBACK_SEC = 300     # accept a regime window ending within 5 min before the fill


def _parse_iso(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def _index_by_key(rows: list[dict[str, Any]], time_field: str) -> dict[tuple[str, str], list[tuple[datetime, dict[str, Any]]]]:
    """Group rows by (venue, instrument) and sort by time ascending."""
    grouped: dict[tuple[str, str], list[tuple[datetime, dict[str, Any]]]] = defaultdict(list)
    for row in rows:
        venue = row.get("venue")
        instrument = row.get("instrument")
        ts_raw = row.get(time_field)
        if not (venue and instrument and ts_raw):
            continue
        try:
            ts = _parse_iso(ts_raw)
        except ValueError:
            continue
        grouped[(venue, instrument)].append((ts, row))
    for key in grouped:
        grouped[key].sort(key=lambda item: item[0])
    return grouped


def _asof_lookup(
    index: dict[tuple[str, str], list[tuple[datetime, dict[str, Any]]]],
    *,
    venue: str,
    instrument: str,
    target_ts: datetime,
    lookback_sec: int,
) -> dict[str, Any] | None:
    series = index.get((venue, instrument))
    if not series:
        return None
    cutoff = target_ts - timedelta(seconds=lookback_sec)
    # binary search for the rightmost timestamp <= target_ts
    lo, hi = 0, len(series)
    while lo < hi:
        mid = (lo + hi) // 2
        if series[mid][0] <= target_ts:
            lo = mid + 1
        else:
            hi = mid
    idx = lo - 1
    if idx < 0:
        return None
    ts, row = series[idx]
    if ts < cutoff:
        return None
    return row


def _stats(values: list[float]) -> dict[str, float]:
    n = len(values)
    if n == 0:
        return {"count": 0, "winrate": 0.0, "mean_pnl_bps": 0.0, "median_pnl_bps": 0.0, "stdev_pnl_bps": 0.0}
    wins = sum(1 for v in values if v > 0)
    mean = sum(values) / n
    s = sorted(values)
    median = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0
    if n >= 2:
        var = sum((v - mean) ** 2 for v in values) / (n - 1)
        std = math.sqrt(var)
    else:
        std = 0.0
    return {
        "count": n,
        "winrate": round(wins / n, 4),
        "mean_pnl_bps": round(mean, 4),
        "median_pnl_bps": round(median, 4),
        "stdev_pnl_bps": round(std, 4),
    }


def build_edge_map(
    *,
    reaction_path: Path,
    regime_path: Path,
    outcomes_path: Path,
    pnl_field: str,
    min_count: int,
) -> dict[str, Any]:
    reaction_rows = _load_jsonl(reaction_path)
    regime_rows = _load_jsonl(regime_path)
    outcome_rows = _load_jsonl(outcomes_path)

    reaction_idx = _index_by_key(reaction_rows, "event_time")
    regime_idx = _index_by_key(regime_rows, "window_end")

    joined: list[dict[str, Any]] = []
    matched_reaction = 0
    matched_regime = 0
    matched_both = 0
    skipped_no_pnl = 0

    for row in outcome_rows:
        venue = row.get("venue")
        instrument = row.get("instrument")
        ts_raw = row.get("ts_intent") or row.get("ts_fill_final")
        pnl = row.get(pnl_field)
        if not (venue and instrument and ts_raw):
            continue
        if pnl is None:
            skipped_no_pnl += 1
            continue
        try:
            ts = _parse_iso(ts_raw)
        except ValueError:
            continue

        reaction = _asof_lookup(reaction_idx, venue=venue, instrument=instrument, target_ts=ts, lookback_sec=REACTION_LOOKBACK_SEC)
        regime = _asof_lookup(regime_idx, venue=venue, instrument=instrument, target_ts=ts, lookback_sec=REGIME_LOOKBACK_SEC)
        if reaction is not None:
            matched_reaction += 1
        if regime is not None:
            matched_regime += 1
        if reaction is not None and regime is not None:
            matched_both += 1
        joined.append({
            "intent_id": row.get("intent_id"),
            "venue": venue,
            "instrument": instrument,
            "ts_intent": ts_raw,
            "side": row.get("side"),
            "pnl_bps": float(pnl),
            "outcome": row.get("outcome"),
            "reaction_class": (reaction or {}).get("reaction_class"),
            "regime": (regime or {}).get("regime"),
            "regime_confidence": (regime or {}).get("confidence"),
        })

    # Aggregate by (reaction_class, regime)
    buckets: dict[tuple[str, str], list[float]] = defaultdict(list)
    for entry in joined:
        rc = entry.get("reaction_class") or "UNKNOWN"
        rg = entry.get("regime") or "UNKNOWN"
        buckets[(rc, rg)].append(entry["pnl_bps"])

    edge_map: list[dict[str, Any]] = []
    for (rc, rg), values in buckets.items():
        s = _stats(values)
        if s["count"] < min_count:
            continue
        edge_map.append({
            "reaction_class": rc,
            "regime": rg,
            **s,
        })
    edge_map.sort(key=lambda r: r["mean_pnl_bps"], reverse=True)

    return {
        "params": {
            "pnl_field": pnl_field,
            "min_count": min_count,
            "reaction_lookback_sec": REACTION_LOOKBACK_SEC,
            "regime_lookback_sec": REGIME_LOOKBACK_SEC,
        },
        "input_counts": {
            "reaction_rows": len(reaction_rows),
            "regime_rows": len(regime_rows),
            "outcome_rows": len(outcome_rows),
        },
        "join_diagnostics": {
            "outcomes_with_reaction": matched_reaction,
            "outcomes_with_regime": matched_regime,
            "outcomes_with_both": matched_both,
            "outcomes_skipped_no_pnl": skipped_no_pnl,
            "joined_total": len(joined),
        },
        "edge_map": edge_map,
        "joined_rows": joined,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Edge Map Engine (observation only).")
    parser.add_argument("--reaction", default=str(DEFAULT_REACTION))
    parser.add_argument("--regime", default=str(DEFAULT_REGIME))
    parser.add_argument("--outcomes", default=str(DEFAULT_OUTCOMES))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="JSONL of joined per-fill rows.")
    parser.add_argument("--pnl-field", default="pnl_bps_5m", choices=["pnl_bps_5m", "pnl_bps_1h"])
    parser.add_argument("--min-count", type=int, default=5)
    parser.add_argument("--no-jsonl", action="store_true")
    args = parser.parse_args()

    result = build_edge_map(
        reaction_path=Path(args.reaction),
        regime_path=Path(args.regime),
        outcomes_path=Path(args.outcomes),
        pnl_field=args.pnl_field,
        min_count=args.min_count,
    )

    if not args.no_jsonl and result["joined_rows"]:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("w", encoding="utf-8") as fh:
            for row in result["joined_rows"]:
                fh.write(json.dumps(row, separators=(",", ":")) + "\n")

    summary = {k: v for k, v in result.items() if k != "joined_rows"}
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
