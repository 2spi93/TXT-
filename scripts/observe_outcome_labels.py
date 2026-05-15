#!/usr/bin/env python3
"""Read-only distribution view over logs/intent_outcome_labels.jsonl.

Purely descriptive. Does not feed decisions.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_IN = REPO_ROOT / "logs" / "intent_outcome_labels.jsonl"


def _iter_jsonl(path: Path) -> Iterable[dict]:
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def _fmt_stats(vals: list[float]) -> str:
    if not vals:
        return "n=0"
    s = sorted(vals)
    n = len(s)
    mean = statistics.fmean(s)
    stdev = statistics.pstdev(s) if n > 1 else 0.0
    return f"n={n} min={s[0]:.2f} median={statistics.median(s):.2f} max={s[-1]:.2f} mean={mean:.2f} stdev={stdev:.2f}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", type=Path, default=DEFAULT_IN)
    args = ap.parse_args()

    if not args.input.exists():
        print(f"ERROR: {args.input} does not exist yet. Run label_intent_outcomes.py first.", file=sys.stderr)
        return 2

    rows = list(_iter_jsonl(args.input))
    print("=== intent outcome label distribution (read-only) ===")
    print(f"source : {args.input}")
    print(f"rows   : {len(rows)}")
    if not rows:
        return 0
    print(f"window : {rows[0].get('ts_fill_final')}  ->  {rows[-1].get('ts_fill_final')}")
    print()

    outcomes = Counter(r.get("outcome", "unknown") for r in rows)
    total = len(rows)
    print("-- outcome distribution --")
    for k, v in outcomes.most_common():
        print(f"  {k:<10s} {v:>6d}  ({v / total:.1%})")
    print()

    pnl_5m = [float(r["pnl_bps_5m"]) for r in rows if r.get("pnl_bps_5m") is not None]
    pnl_1h = [float(r["pnl_bps_1h"]) for r in rows if r.get("pnl_bps_1h") is not None]
    slip = [float(r["realized_slippage_bps"]) for r in rows if r.get("realized_slippage_bps") is not None]
    lat = [float(r["latency_e2e_ms"]) for r in rows if r.get("latency_e2e_ms") is not None]

    print("-- pnl_bps_5m  --", _fmt_stats(pnl_5m))
    print("-- pnl_bps_1h  --", _fmt_stats(pnl_1h))
    print("-- slip_real_bps --", _fmt_stats(slip))
    print("-- latency_e2e_ms --", _fmt_stats(lat))
    print()

    scopes: dict[tuple, Counter] = defaultdict(Counter)
    for r in rows:
        key = (r.get("venue") or "?", r.get("instrument") or "?", r.get("strategy_id") or "?")
        scopes[key][r.get("outcome") or "unknown"] += 1
    print("-- top scopes by volume --")
    print(f"  {'venue':<14s} {'instrument':<12s} {'strategy':<22s} {'total':>6s} {'win%':>6s} {'loss%':>6s}")
    for (venue, inst, strat), counts in sorted(
        scopes.items(), key=lambda t: sum(t[1].values()), reverse=True
    )[:20]:
        tot = sum(counts.values())
        w = counts.get("win", 0) / tot if tot else 0
        l = counts.get("loss", 0) / tot if tot else 0
        print(f"  {venue:<14s} {inst:<12s} {strat:<22s} {tot:>6d} {w:>6.1%} {l:>6.1%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
