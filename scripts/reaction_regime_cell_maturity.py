#!/usr/bin/env python3
"""Reaction/regime cell maturity table.

Builds a permanent observation table from the same JSONL streams as the edge map
engine, but ranks knowledge by independent event count before sample count.

Run:
    python3 scripts/reaction_regime_cell_maturity.py
    python3 scripts/reaction_regime_cell_maturity.py --decision-prefix rg50- --format markdown
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

from edge_map_engine import (
    DEFAULT_OUTCOMES,
    DEFAULT_REACTION,
    DEFAULT_REGIME,
    REACTION_LOOKBACK_SEC,
    REGIME_LOOKBACK_SEC,
    _asof_lookup,
    _index_by_key,
    _load_jsonl,
    _parse_iso,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_JSON_OUTPUT = REPO_ROOT / "logs" / "reaction_regime_cell_maturity.json"
DEFAULT_MARKDOWN_OUTPUT = REPO_ROOT / "logs" / "reaction_regime_cell_maturity.md"


def _decision_id(row: dict[str, Any]) -> str:
    return str(row.get("decision_id") or row.get("intent_id") or "")


def _matches_prefixes(row: dict[str, Any], prefixes: list[str]) -> bool:
    if not prefixes:
        return True
    decision_id = _decision_id(row)
    return any(decision_id.startswith(prefix) for prefix in prefixes)


def _event_key(reaction: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(reaction.get("venue") or ""),
        str(reaction.get("instrument") or ""),
        str(reaction.get("event_time") or ""),
    )


def _percentile(values: list[float], p: float) -> float:
    if len(values) == 1:
        return values[0]
    pos = (len(values) - 1) * p
    low = math.floor(pos)
    high = math.ceil(pos)
    if low == high:
        return values[low]
    return values[low] + (values[high] - values[low]) * (pos - low)


def _stats(values: list[float]) -> dict[str, Any]:
    values = sorted(values)
    if not values:
        return {
            "sample_count": 0,
            "mean_pnl_bps": None,
            "median_pnl_bps": None,
            "stdev_pnl_bps": None,
            "positive_rate": None,
            "min_pnl_bps": None,
            "p25_pnl_bps": None,
            "p75_pnl_bps": None,
            "max_pnl_bps": None,
        }
    return {
        "sample_count": len(values),
        "mean_pnl_bps": round(statistics.fmean(values), 4),
        "median_pnl_bps": round(statistics.median(values), 4),
        "stdev_pnl_bps": round(statistics.pstdev(values), 4),
        "positive_rate": round(sum(value > 0 for value in values) / len(values), 4),
        "min_pnl_bps": round(values[0], 4),
        "p25_pnl_bps": round(_percentile(values, 0.25), 4),
        "p75_pnl_bps": round(_percentile(values, 0.75), 4),
        "max_pnl_bps": round(values[-1], 4),
    }


def _fmt(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:.4f}"
    return str(value)


def _format_markdown(result: dict[str, Any]) -> str:
    evidence = result["edge_evidence"]
    lines = [
        "# Reaction/Regime Cell Maturity",
        "",
        "Cells are sorted by independent event count first, then sample count.",
        "",
        f"Edge evidence state: `{evidence['state']}` - {evidence['summary']}",
        "",
        "| Cell | Status | Event count | Sample count | Mean pnl | Median pnl | Stdev pnl | Positive % | Last observation | Venue |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ]
    for cell in result["cells"]:
        positive_pct = "" if cell["positive_rate"] is None else f"{cell['positive_rate'] * 100:.2f}%"
        lines.append(
            "| "
            + " | ".join([
                cell["cell"],
                cell["maturity_status"],
                str(cell["event_count"]),
                str(cell["sample_count"]),
                _fmt(cell["mean_pnl_bps"]),
                _fmt(cell["median_pnl_bps"]),
                _fmt(cell["stdev_pnl_bps"]),
                positive_pct,
                cell["last_observation"] or "",
                cell["dominant_venue"] or "",
            ])
            + " |"
        )
    lines.extend([
        "",
        "## Diagnostics",
        "",
        "```json",
        json.dumps(result["diagnostics"], indent=2, sort_keys=True),
        "```",
    ])
    return "\n".join(lines) + "\n"


def _maturity_status(event_count: int, mature_threshold_events: int) -> str:
    if event_count >= mature_threshold_events:
        return "MATURE"
    if event_count >= 2:
        return "REPLICATED"
    return "OBSERVATION"


def _pnl_direction(cell: dict[str, Any]) -> str:
    mean = cell.get("mean_pnl_bps")
    if mean is None:
        return "UNKNOWN"
    if mean > 0:
        return "POSITIVE"
    if mean < 0:
        return "NEGATIVE"
    return "FLAT"


def _coherent_mature_groups(cells: list[dict[str, Any]], mature_threshold_events: int) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for cell in cells:
        if cell["event_count"] < mature_threshold_events:
            continue
        groups[(str(cell.get("regime") or "UNKNOWN"), _pnl_direction(cell))].append(cell)

    coherent: list[dict[str, Any]] = []
    for (regime, pnl_direction), group_cells in groups.items():
        if len(group_cells) < 2:
            continue
        coherent.append({
            "regime": regime,
            "pnl_direction": pnl_direction,
            "mature_cell_count": len(group_cells),
            "cells": [cell["cell"] for cell in group_cells],
        })
    coherent.sort(key=lambda group: (-group["mature_cell_count"], group["regime"], group["pnl_direction"]))
    return coherent


def _candidate_cells(cells: list[dict[str, Any]], *, min_events: int, max_events: int | None = None) -> list[dict[str, Any]]:
    candidates = []
    for cell in cells:
        event_count = int(cell.get("event_count") or 0)
        if event_count < min_events:
            continue
        if max_events is not None and event_count > max_events:
            continue
        candidates.append({
            "cell": cell.get("cell"),
            "event_count": event_count,
            "sample_count": cell.get("sample_count"),
            "dominant_venue": cell.get("dominant_venue"),
            "mean_pnl_bps": cell.get("mean_pnl_bps"),
            "stdev_pnl_bps": cell.get("stdev_pnl_bps"),
            "next_required_event_count": event_count + 1,
        })
    candidates.sort(key=lambda cell: (-int(cell.get("event_count") or 0), -int(cell.get("sample_count") or 0), str(cell.get("cell") or "")))
    return candidates


def _next_gate_for_state(state: str, cells: list[dict[str, Any]], mature_threshold_events: int) -> dict[str, Any]:
    if state == "NO_REPLICATED_CELLS":
        return {
            "name": "COMPLETE_FIRST_CELL",
            "target_state": "EXPLORATORY",
            "condition": "outcomes_with_both > 0 and cell_count > 0",
            "summary": "Create the first complete Reaction + Regime + Outcome cell.",
            "candidate_cells": [],
        }
    if state == "EXPLORATORY":
        return {
            "name": "FIRST_REPLICATION",
            "target_state": "EMERGING",
            "condition": "replicated_cells > 0",
            "summary": "Repeat one existing cell on an independent event.",
            "candidate_cells": _candidate_cells(cells, min_events=1, max_events=1),
        }
    if state == "EMERGING":
        return {
            "name": "FIRST_MATURE_CELL",
            "target_state": "EVIDENCED",
            "condition": f"mature_cells > 0 with event_count >= {mature_threshold_events}",
            "summary": "Promote one replicated cell to mature causal evidence.",
            "candidate_cells": _candidate_cells(cells, min_events=2, max_events=mature_threshold_events - 1),
        }
    if state == "EVIDENCED":
        return {
            "name": "STRUCTURAL_COHERENCE",
            "target_state": "STRUCTURAL",
            "condition": "multiple mature cells cohere by regime and pnl direction",
            "summary": "Show that evidence is broader than one isolated mature cell.",
            "candidate_cells": _candidate_cells(cells, min_events=mature_threshold_events),
        }
    return {
        "name": "BROKER_REALITY",
        "target_state": "REALITY_GAP_REAL",
        "condition": "real broker fill audited and reality_gap_real_samples > 0",
        "summary": "Move from structural simulated evidence to audited broker reality.",
        "candidate_cells": _candidate_cells(cells, min_events=mature_threshold_events),
    }


def _edge_evidence_state(cells: list[dict[str, Any]], outcomes_with_both: int, mature_threshold_events: int) -> dict[str, Any]:
    replicated_cells = sum(1 for cell in cells if cell["event_count"] >= 2)
    mature_cells = sum(1 for cell in cells if cell["event_count"] >= mature_threshold_events)
    max_event_count = max((cell["event_count"] for cell in cells), default=0)
    coherent_groups = _coherent_mature_groups(cells, mature_threshold_events)
    if outcomes_with_both <= 0 or not cells:
        state = "NO_REPLICATED_CELLS"
        summary = "No complete reaction/regime/outcome cell is available yet."
    elif coherent_groups:
        state = "STRUCTURAL"
        summary = f"{len(coherent_groups)} coherent mature cell group(s) are available."
    elif mature_cells > 0:
        state = "EVIDENCED"
        summary = f"{mature_cells} cell(s) reached event_count >= {mature_threshold_events}."
    elif replicated_cells > 0:
        state = "EMERGING"
        summary = f"{replicated_cells} cell(s) have at least two independent events, but none is mature yet."
    else:
        state = "EXPLORATORY"
        summary = "Complete joins are stable enough to observe cells, but no cell has replicated across independent events."
    return {
        "state": state,
        "summary": summary,
        "mature_threshold_events": mature_threshold_events,
        "replicated_cells": replicated_cells,
        "mature_cells": mature_cells,
        "max_cell_event_count": max_event_count,
        "coherent_mature_groups": coherent_groups,
        "next_gate": _next_gate_for_state(state, cells, mature_threshold_events),
    }


def build_cell_maturity(
    *,
    reaction_path: Path,
    regime_path: Path,
    outcomes_path: Path,
    pnl_field: str,
    decision_prefixes: list[str],
    mature_threshold_events: int,
) -> dict[str, Any]:
    reaction_rows = _load_jsonl(reaction_path)
    regime_rows = _load_jsonl(regime_path)
    outcome_rows = [row for row in _load_jsonl(outcomes_path) if _matches_prefixes(row, decision_prefixes)]

    reaction_idx = _index_by_key(reaction_rows, "event_time")
    regime_idx = _index_by_key(regime_rows, "window_end")

    buckets: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    outcomes_with_reaction = 0
    outcomes_with_regime = 0
    outcomes_with_both = 0
    outcomes_skipped_no_pnl = 0

    for row in outcome_rows:
        venue = row.get("venue")
        instrument = row.get("instrument")
        ts_raw = row.get("ts_intent") or row.get("ts_fill_final")
        pnl = row.get(pnl_field)
        if not (venue and instrument and ts_raw):
            continue
        if pnl is None:
            outcomes_skipped_no_pnl += 1
            continue
        try:
            ts = _parse_iso(ts_raw)
        except ValueError:
            continue

        reaction = _asof_lookup(reaction_idx, venue=venue, instrument=instrument, target_ts=ts, lookback_sec=REACTION_LOOKBACK_SEC)
        regime = _asof_lookup(regime_idx, venue=venue, instrument=instrument, target_ts=ts, lookback_sec=REGIME_LOOKBACK_SEC)
        if reaction is not None:
            outcomes_with_reaction += 1
        if regime is not None:
            outcomes_with_regime += 1
        if reaction is None or regime is None:
            continue

        outcomes_with_both += 1
        reaction_class = str(reaction.get("reaction_class") or "UNKNOWN")
        regime_label = str(regime.get("regime") or "UNKNOWN")
        buckets[(reaction_class, regime_label)].append({
            "decision_id": _decision_id(row),
            "event_key": _event_key(reaction),
            "event_time": reaction.get("event_time"),
            "venue": venue,
            "instrument": instrument,
            "ts_intent": ts,
            "ts_intent_raw": ts_raw,
            "pnl_bps": float(pnl),
            "outcome": row.get("outcome"),
        })

    cells: list[dict[str, Any]] = []
    for (reaction_class, regime_label), rows in buckets.items():
        pnl_values = [row["pnl_bps"] for row in rows]
        events = {row["event_key"] for row in rows}
        venues = Counter(str(row["venue"]) for row in rows)
        outcomes = Counter(str(row.get("outcome") or "UNKNOWN") for row in rows)
        last_row = max(rows, key=lambda row: row["ts_intent"])
        stats = _stats(pnl_values)
        cells.append({
            "cell": f"{reaction_class} + {regime_label}",
            "reaction_class": reaction_class,
            "regime": regime_label,
            "event_count": len(events),
            "cell_replicates": len(events),
            "maturity_status": _maturity_status(len(events), mature_threshold_events),
            **stats,
            "last_observation": last_row["ts_intent_raw"],
            "last_event_time": last_row["event_time"],
            "dominant_venue": venues.most_common(1)[0][0] if venues else None,
            "venue_counts": dict(sorted(venues.items())),
            "outcome_counts": dict(sorted(outcomes.items())),
        })

    cells.sort(key=lambda cell: (-cell["event_count"], -cell["sample_count"], cell["cell"]))
    evidence = _edge_evidence_state(cells, outcomes_with_both, mature_threshold_events)
    return {
        "params": {
            "pnl_field": pnl_field,
            "decision_prefixes": decision_prefixes,
            "reaction_lookback_sec": REACTION_LOOKBACK_SEC,
            "regime_lookback_sec": REGIME_LOOKBACK_SEC,
            "mature_threshold_events": mature_threshold_events,
        },
        "edge_evidence": evidence,
        "diagnostics": {
            "reaction_rows": len(reaction_rows),
            "regime_rows": len(regime_rows),
            "outcome_rows": len(outcome_rows),
            "outcomes_with_reaction": outcomes_with_reaction,
            "outcomes_with_regime": outcomes_with_regime,
            "outcomes_with_both": outcomes_with_both,
            "outcomes_skipped_no_pnl": outcomes_skipped_no_pnl,
            "cell_count": len(cells),
            "total_cell_event_count": sum(cell["event_count"] for cell in cells),
            "replicated_cells": evidence["replicated_cells"],
            "mature_cells": evidence["mature_cells"],
            "edge_evidence_state": evidence["state"],
        },
        "cells": cells,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a reaction/regime cell maturity table.")
    parser.add_argument("--reaction", default=str(DEFAULT_REACTION))
    parser.add_argument("--regime", default=str(DEFAULT_REGIME))
    parser.add_argument("--outcomes", default=str(DEFAULT_OUTCOMES))
    parser.add_argument("--pnl-field", default="pnl_bps_5m", choices=["pnl_bps_5m", "pnl_bps_1h"])
    parser.add_argument("--decision-prefix", action="append", default=[], help="Filter outcomes by decision/intent id prefix. Repeatable.")
    parser.add_argument("--mature-threshold-events", type=int, default=3)
    parser.add_argument("--json-output", default=str(DEFAULT_JSON_OUTPUT))
    parser.add_argument("--markdown-output", default=str(DEFAULT_MARKDOWN_OUTPUT))
    parser.add_argument("--format", choices=["json", "markdown"], default="markdown")
    parser.add_argument("--no-write", action="store_true")
    args = parser.parse_args()

    result = build_cell_maturity(
        reaction_path=Path(args.reaction),
        regime_path=Path(args.regime),
        outcomes_path=Path(args.outcomes),
        pnl_field=args.pnl_field,
        decision_prefixes=args.decision_prefix,
        mature_threshold_events=max(1, args.mature_threshold_events),
    )

    markdown = _format_markdown(result)
    if not args.no_write:
        json_output = Path(args.json_output)
        markdown_output = Path(args.markdown_output)
        json_output.parent.mkdir(parents=True, exist_ok=True)
        markdown_output.parent.mkdir(parents=True, exist_ok=True)
        json_output.write_text(json.dumps(result, indent=2, sort_keys=True, default=str) + "\n", encoding="utf-8")
        markdown_output.write_text(markdown, encoding="utf-8")

    if args.format == "json":
        print(json.dumps(result, indent=2, sort_keys=True, default=str))
    else:
        print(markdown)
    return 0


if __name__ == "__main__":
    sys.exit(main())