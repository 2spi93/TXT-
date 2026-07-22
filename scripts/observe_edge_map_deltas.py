#!/usr/bin/env python3
"""Read-only 24h edge-map delta summary.

Reads logs/edge_map_engine.jsonl and prints:
  - coverage of classified vs unknown rows
  - delta table for last 24h vs previous 24h by reaction_class x regime

Purely descriptive. No DB writes. No trading integration.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_IN = REPO_ROOT / "logs" / "edge_map_engine.jsonl"


def _parse_iso(value: str) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iter_jsonl(path: Path) -> Iterable[dict]:
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                yield payload


def _is_classified(row: dict) -> bool:
    return bool(str(row.get("reaction_class") or "").strip()) and bool(str(row.get("regime") or "").strip())


def _stats(rows: list[dict]) -> dict:
    pnl = [float(row.get("pnl_bps") or 0.0) for row in rows]
    count = len(pnl)
    if count == 0:
        return {"count": 0, "winrate": 0.0, "mean": 0.0, "median": 0.0, "stdev": 0.0}
    mean = statistics.fmean(pnl)
    median = statistics.median(pnl)
    stdev = statistics.pstdev(pnl) if count > 1 else 0.0
    wins = sum(1 for value in pnl if value > 0)
    return {
        "count": count,
        "winrate": wins / count,
        "mean": mean,
        "median": median,
        "stdev": stdev,
    }


def _confidence(count: int, rows: list[dict]) -> tuple[int, str]:
    regime_values = [float(row.get("regime_confidence")) for row in rows if row.get("regime_confidence") is not None]
    avg_regime = statistics.fmean(regime_values) if regime_values else 0.0
    sigma = _stats(rows)["stdev"]
    sample_score = min(count / 12.0, 1.0)
    stability_score = max(0.0, 1.0 - sigma / 80.0)
    score = round((sample_score * 0.5 + avg_regime * 0.25 + stability_score * 0.15 + 0.1) * 100)
    if score >= 75:
        return score, "HIGH"
    if score >= 50:
        return score, "MEDIUM"
    return score, "LOW"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", type=Path, default=DEFAULT_IN)
    ap.add_argument("--hours", type=int, default=24)
    args = ap.parse_args()

    if not args.input.exists():
        print(f"ERROR: {args.input} does not exist yet. Run observation cron first.", file=sys.stderr)
        return 2

    rows = []
    for row in _iter_jsonl(args.input):
        ts_intent = _parse_iso(str(row.get("ts_intent") or ""))
        if not ts_intent:
            continue
        row = dict(row)
        row["_ts_intent"] = ts_intent
        rows.append(row)

    print("=== edge map delta summary (read-only) ===")
    print(f"source : {args.input}")
    print(f"rows   : {len(rows)}")
    if not rows:
        return 0

    latest = max(row["_ts_intent"] for row in rows)
    now = datetime.now(timezone.utc)
    current_cutoff = now - timedelta(hours=args.hours)
    previous_cutoff = now - timedelta(hours=args.hours * 2)
    classified_rows = [row for row in rows if _is_classified(row)]
    recent_rows = [row for row in rows if row["_ts_intent"] >= current_cutoff]
    recent_classified = [row for row in recent_rows if _is_classified(row)]

    print(f"latest : {latest.isoformat()}")
    print(f"classif: {len(classified_rows)} / {len(rows)} ({(len(classified_rows) / len(rows) * 100):.1f}%)")
    print(f"recent : {len(recent_classified)} classified / {len(recent_rows)} total over last {args.hours}h")
    print()

    current_buckets: dict[tuple[str, str], list[dict]] = defaultdict(list)
    previous_buckets: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in classified_rows:
        key = (str(row.get("reaction_class") or "UNKNOWN"), str(row.get("regime") or "UNKNOWN"))
        ts = row["_ts_intent"]
        if ts >= current_cutoff:
            current_buckets[key].append(row)
        elif previous_cutoff <= ts < current_cutoff:
            previous_buckets[key].append(row)

    if not current_buckets:
        print("No classified edge cells in the last 24h.")
        return 0

    print(f"{'edge':<28s} {'24h':>4s} {'prev':>4s} {'dCnt':>5s} {'mean':>9s} {'dMean':>9s} {'wr':>8s} {'dWr':>8s} {'conf':>12s}")
    for key, bucket in sorted(current_buckets.items(), key=lambda item: (_confidence(len(item[1]), item[1])[0], _stats(item[1])["mean"]), reverse=True):
        prev = previous_buckets.get(key, [])
        cur_stats = _stats(bucket)
        prev_stats = _stats(prev)
        score, level = _confidence(len(bucket), bucket)
        edge = f"{key[0]} + {key[1]}"
        print(
            f"{edge:<28.28s} "
            f"{cur_stats['count']:>4d} "
            f"{prev_stats['count']:>4d} "
            f"{cur_stats['count'] - prev_stats['count']:>5d} "
            f"{cur_stats['mean']:>+9.2f} "
            f"{cur_stats['mean'] - prev_stats['mean']:>+9.2f} "
            f"{cur_stats['winrate'] * 100:>7.1f}% "
            f"{(cur_stats['winrate'] - prev_stats['winrate']) * 100:>+7.1f} "
            f"{level:>6s} {score:>3d}%"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())