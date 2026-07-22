#!/usr/bin/env python3
"""Read-only observer for canary promotion score distribution.

Pure observation. Does NOT modify thresholds, gates, KPI files, deployment
state, or any decision logic. Reads:
  - logs/mission-control-runtime-decision-kpi.jsonl  (hourly KPI snapshots)
  - optional: logs/mission-control-v2-risk-journal.jsonl (decision outcomes)

Outputs a textual summary to stdout answering:
  - how many scores > 0.8 ?
  - how many scores < 0.6 ?
  - temporal stability (median, p5, p95, stdev, drift between halves)

Constraint honored: "observer sans influencer".
"""
from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_KPI = REPO_ROOT / "logs" / "mission-control-runtime-decision-kpi.jsonl"

SCORE_FIELD_CANDIDATES = (
    "opportunityScore",
    "promotionScore",
    "score",
    "effectiveScore",
    "reliability",
)


def _iter_jsonl(path: Path) -> Iterable[dict]:
    if not path.exists():
        return
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def _extract_score(row: dict, field: str) -> float | None:
    val = row.get(field)
    if isinstance(val, (int, float)) and not math.isnan(float(val)):
        return float(val)
    return None


def _percentile(sorted_values: list[float], pct: float) -> float:
    if not sorted_values:
        return float("nan")
    if len(sorted_values) == 1:
        return sorted_values[0]
    k = (len(sorted_values) - 1) * pct
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_values[int(k)]
    return sorted_values[f] * (c - k) + sorted_values[c] * (k - f)


def summarize(values: list[float], label: str, high: float | None, low: float | None) -> str:
    if not values:
        return f"  [{label}] no samples"
    s = sorted(values)
    n = len(s)
    # Auto-detect scale (0-1 vs 0-100) if thresholds not provided.
    scale_100 = max(s) > 1.5
    h = high if high is not None else (80.0 if scale_100 else 0.8)
    l = low if low is not None else (60.0 if scale_100 else 0.6)
    above_08 = sum(1 for v in s if v > h)
    below_06 = sum(1 for v in s if v < l)
    between = n - above_08 - below_06
    stdev = statistics.pstdev(s) if n > 1 else 0.0
    half = n // 2
    drift = (
        statistics.fmean(s[half:]) - statistics.fmean(s[:half])
        if half >= 1 and n - half >= 1
        else 0.0
    )
    return (
        f"  [{label}] n={n}  scale={'0-100' if scale_100 else '0-1'}  "
        f">{h:g}={above_08} ({above_08 / n:.1%})  "
        f"<{l:g}={below_06} ({below_06 / n:.1%})  "
        f"mid={between} ({between / n:.1%})\n"
        f"          min={min(s):.4f}  p5={_percentile(s, 0.05):.4f}  "
        f"median={statistics.median(s):.4f}  p95={_percentile(s, 0.95):.4f}  "
        f"max={max(s):.4f}\n"
        f"          mean={statistics.fmean(s):.4f}  stdev={stdev:.4f}  "
        f"half-drift={drift:+.4f}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--kpi",
        type=Path,
        default=DEFAULT_KPI,
        help=f"Path to KPI jsonl (default: {DEFAULT_KPI})",
    )
    parser.add_argument(
        "--field",
        action="append",
        help="Score field to track (repeatable). Default: all known candidates.",
    )
    parser.add_argument(
        "--high",
        type=float,
        default=None,
        help="High threshold (auto: 0.8 for 0-1 scale, 80 for 0-100 scale).",
    )
    parser.add_argument(
        "--low",
        type=float,
        default=None,
        help="Low threshold (auto: 0.6 for 0-1 scale, 60 for 0-100 scale).",
    )
    args = parser.parse_args()

    fields = args.field or list(SCORE_FIELD_CANDIDATES)

    if not args.kpi.exists():
        print(f"ERROR: KPI file not found: {args.kpi}", file=sys.stderr)
        return 2

    rows = list(_iter_jsonl(args.kpi))
    print(f"=== canary distribution observer (read-only) ===")
    print(f"source : {args.kpi}")
    print(f"rows   : {len(rows)}")
    if rows:
        first = rows[0].get("timestamp") or rows[0].get("bucketStartIso") or "?"
        last = rows[-1].get("timestamp") or rows[-1].get("bucketStartIso") or "?"
        print(f"window : {first}  ->  {last}")

    print()
    for field in fields:
        vals = [v for v in (_extract_score(r, field) for r in rows) if v is not None]
        print(f"field: {field}")
        print(summarize(vals, field, args.high, args.low))
        print()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
