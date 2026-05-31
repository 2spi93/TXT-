#!/usr/bin/env python3
"""Publish the current Edge Truth proof phase.

This script does not classify markets and does not launch campaigns. It turns
the maturity snapshot into an operator-facing phase status: current state, next
gate, and candidate cells to replicate.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "logs" / "reaction_regime_cell_maturity.json"
DEFAULT_JSON_OUTPUT = ROOT / "logs" / "edge_truth_phase_status.json"
DEFAULT_MARKDOWN_OUTPUT = ROOT / "logs" / "edge_truth_phase_status.md"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_snapshot(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "edge_evidence": {
                "state": "UNAVAILABLE",
                "summary": "Cell maturity snapshot is missing.",
                "next_gate": {
                    "name": "BUILD_MATURITY_SNAPSHOT",
                    "target_state": "EXPLORATORY",
                    "condition": "reaction_regime_cell_maturity.json exists",
                    "summary": "Generate the cell maturity snapshot first.",
                    "candidate_cells": [],
                },
            },
            "diagnostics": {},
            "cells": [],
        }
    return json.loads(path.read_text(encoding="utf-8"))


def phase_label(state: str) -> str:
    return {
        "NO_REPLICATED_CELLS": "NO COMPLETE PROOF",
        "EXPLORATORY": "JOINED OBSERVATION",
        "EMERGING": "REPLICATED CELL",
        "EVIDENCED": "MATURE CELL",
        "STRUCTURAL": "STRUCTURAL EDGE EVIDENCE",
        "UNAVAILABLE": "UNAVAILABLE",
    }.get(state, state)


def build_status(snapshot: dict[str, Any], source_path: Path) -> dict[str, Any]:
    evidence = snapshot.get("edge_evidence") if isinstance(snapshot.get("edge_evidence"), dict) else {}
    diagnostics = snapshot.get("diagnostics") if isinstance(snapshot.get("diagnostics"), dict) else {}
    next_gate = evidence.get("next_gate") if isinstance(evidence.get("next_gate"), dict) else {}
    state = str(evidence.get("state") or diagnostics.get("edge_evidence_state") or "UNAVAILABLE")
    return {
        "schema_version": "edge-truth-phase/v1",
        "generated_at": utc_now(),
        "source_path": str(source_path),
        "state": state,
        "phase_label": phase_label(state),
        "summary": str(evidence.get("summary") or "Edge evidence state unavailable."),
        "metrics": {
            "outcomes_with_both": int(diagnostics.get("outcomes_with_both") or 0),
            "cell_count": int(diagnostics.get("cell_count") or 0),
            "replicated_cells": int(evidence.get("replicated_cells") or diagnostics.get("replicated_cells") or 0),
            "mature_cells": int(evidence.get("mature_cells") or diagnostics.get("mature_cells") or 0),
            "max_cell_event_count": int(evidence.get("max_cell_event_count") or 0),
        },
        "next_gate": {
            "name": str(next_gate.get("name") or "UNKNOWN"),
            "target_state": str(next_gate.get("target_state") or "UNKNOWN"),
            "condition": str(next_gate.get("condition") or ""),
            "summary": str(next_gate.get("summary") or ""),
            "candidate_cells": next_gate.get("candidate_cells") if isinstance(next_gate.get("candidate_cells"), list) else [],
        },
    }


def format_markdown(status: dict[str, Any]) -> str:
    metrics = status["metrics"]
    gate = status["next_gate"]
    lines = [
        "# Edge Truth Phase Status",
        "",
        f"Generated at: `{status['generated_at']}`",
        "",
        f"Current state: `{status['state']}` ({status['phase_label']})",
        "",
        status["summary"],
        "",
        "## Metrics",
        "",
        "| Metric | Value |",
        "| --- | ---: |",
    ]
    for key in ["outcomes_with_both", "cell_count", "replicated_cells", "mature_cells", "max_cell_event_count"]:
        lines.append(f"| `{key}` | {metrics.get(key, 0)} |")
    lines.extend([
        "",
        "## Next Gate",
        "",
        f"Name: `{gate['name']}`",
        "",
        f"Target state: `{gate['target_state']}`",
        "",
        f"Condition: `{gate['condition']}`",
        "",
        gate["summary"],
        "",
        "## Candidate Cells",
        "",
        "| Cell | Events | Samples | Venue | Next required events |",
        "| --- | ---: | ---: | --- | ---: |",
    ])
    candidates = gate.get("candidate_cells") or []
    if not candidates:
        lines.append("| none | 0 | 0 |  | 0 |")
    else:
        for cell in candidates:
            lines.append(
                f"| {cell.get('cell')} | {cell.get('event_count')} | {cell.get('sample_count')} | "
                f"{cell.get('dominant_venue') or ''} | {cell.get('next_required_event_count')} |"
            )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish Edge Truth phase status.")
    parser.add_argument("--input", default=str(DEFAULT_INPUT))
    parser.add_argument("--json-output", default=str(DEFAULT_JSON_OUTPUT))
    parser.add_argument("--markdown-output", default=str(DEFAULT_MARKDOWN_OUTPUT))
    parser.add_argument("--format", choices=["json", "markdown"], default="markdown")
    parser.add_argument("--no-write", action="store_true")
    args = parser.parse_args()

    source = Path(args.input)
    status = build_status(load_snapshot(source), source)
    markdown = format_markdown(status)
    if not args.no_write:
        json_output = Path(args.json_output)
        markdown_output = Path(args.markdown_output)
        json_output.parent.mkdir(parents=True, exist_ok=True)
        markdown_output.parent.mkdir(parents=True, exist_ok=True)
        json_output.write_text(json.dumps(status, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        markdown_output.write_text(markdown, encoding="utf-8")

    if args.format == "json":
        print(json.dumps(status, indent=2, sort_keys=True))
    else:
        print(markdown)
    return 0


if __name__ == "__main__":
    sys.exit(main())