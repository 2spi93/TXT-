#!/usr/bin/env python3
"""Read-only observer for NO_TRADE / decision concentration in v2 risk journal.

Pure observation. Does NOT modify the journal, thresholds, or any gate.
Aggregates entries from logs/mission-control-v2-risk-journal.jsonl by
(symbol, timeframe, strategy, action) and prints a concentration table.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_JOURNAL = REPO_ROOT / "logs" / "mission-control-v2-risk-journal.jsonl"


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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--journal", type=Path, default=DEFAULT_JOURNAL)
    parser.add_argument(
        "--top",
        type=int,
        default=20,
        help="Top N scope buckets to display (default 20).",
    )
    parser.add_argument(
        "--tail",
        type=int,
        default=0,
        help="If >0, only consider the last N entries (rolling view).",
    )
    args = parser.parse_args()

    if not args.journal.exists():
        print(f"ERROR: journal not found: {args.journal}", file=sys.stderr)
        return 2

    rows = list(_iter_jsonl(args.journal))
    if args.tail > 0:
        rows = rows[-args.tail:]

    by_scope: dict[tuple, Counter] = defaultdict(Counter)
    by_action: Counter = Counter()
    by_outcome: Counter = Counter()

    for r in rows:
        symbol = r.get("symbol") or "?"
        timeframe = r.get("timeframe") or "?"
        strategy = r.get("strategy") or "?"
        action = r.get("action") or "?"
        outcome = r.get("decisionOutcome") or "unknown"
        scope = (symbol, timeframe, strategy)
        by_scope[scope][action] += 1
        by_action[action] += 1
        by_outcome[outcome] += 1

    total = len(rows)
    print("=== v2 risk journal concentration (read-only) ===")
    print(f"source  : {args.journal}")
    print(f"entries : {total}")
    if rows:
        first = rows[0].get("createdAtIso") or rows[0].get("timestamp") or "?"
        last = rows[-1].get("createdAtIso") or rows[-1].get("timestamp") or "?"
        print(f"window  : {first}  ->  {last}")
    print()

    print("-- actions distribution --")
    for action, n in by_action.most_common():
        print(f"  {action:<24s} {n:>7d}  ({n / total:.1%})")
    print()

    print("-- decision outcomes --")
    for outcome, n in by_outcome.most_common():
        print(f"  {outcome:<24s} {n:>7d}  ({n / total:.1%})")
    print()

    print(f"-- top {args.top} scopes by volume --")
    scope_totals = sorted(
        ((scope, sum(actions.values()), actions) for scope, actions in by_scope.items()),
        key=lambda t: t[1],
        reverse=True,
    )[: args.top]
    print(
        f"  {'symbol':<12s} {'tf':<6s} {'strategy':<18s} "
        f"{'total':>7s} {'NO_TRADE%':>11s} {'top_action':<18s}"
    )
    for (symbol, tf, strat), tot, actions in scope_totals:
        nt = sum(c for a, c in actions.items() if "NO_TRADE" in a.upper() or a == "BLOCK")
        nt_pct = nt / tot if tot else 0.0
        top_action = actions.most_common(1)[0][0] if actions else "-"
        print(
            f"  {symbol:<12s} {tf:<6s} {strat:<18s} "
            f"{tot:>7d} {nt_pct:>10.1%}  {top_action:<18s}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
