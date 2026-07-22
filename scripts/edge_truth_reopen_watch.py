#!/usr/bin/env python3
"""Publish a read-only Edge Truth snapshot around market reopen.

This observer does not launch campaigns and never submits broker orders. It
summarizes the current proof phase, candidate cells, recent targeted campaigns,
and the MT5 gate status that must remain closed until STRUCTURAL.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = ROOT / "logs"
DEFAULT_OUTPUT_JSON = LOG_DIR / "edge_truth_reopen_watch.json"
DEFAULT_OUTPUT_MD = LOG_DIR / "edge_truth_reopen_watch.md"
PHASE_PATH = LOG_DIR / "edge_truth_phase_status.json"
MATURITY_PATH = LOG_DIR / "reaction_regime_cell_maturity.json"
WATCHER_STATE_PATH = LOG_DIR / "reaction_cell_replication_state.json"
REACTION_LOG_PATH = LOG_DIR / "reaction_speed_engine.jsonl"
WATCHER_LOG_PATH = LOG_DIR / "reaction_cell_replication.log"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def recent_reactions(*, since: datetime, limit: int) -> list[dict[str, Any]]:
    if not REACTION_LOG_PATH.exists():
        return []
    rows: list[dict[str, Any]] = []
    with REACTION_LOG_PATH.open("r", encoding="utf-8") as fh:
        for line in fh:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("instrument") != "BTCUSDT":
                continue
            ts = parse_ts(row.get("event_time"))
            if ts is None or ts < since:
                continue
            rows.append({
                "event_time": row.get("event_time"),
                "venue": row.get("venue"),
                "reaction_class": row.get("reaction_class"),
                "event_direction": row.get("event_direction"),
                "trigger_bps": row.get("trigger_bps"),
                "reaction_time_ms": row.get("reaction_time_ms"),
            })
    rows.sort(key=lambda row: str(row.get("event_time") or ""), reverse=True)
    return rows[:limit]


def tail_lines(path: Path, limit: int) -> list[str]:
    if not path.exists():
        return []
    try:
        return path.read_text(encoding="utf-8", errors="replace").splitlines()[-limit:]
    except Exception:
        return []


def build_snapshot(*, lookback_hours: float, reaction_limit: int) -> dict[str, Any]:
    phase = read_json(PHASE_PATH)
    maturity = read_json(MATURITY_PATH)
    watcher_state = read_json(WATCHER_STATE_PATH)
    evidence = maturity.get("edge_evidence") if isinstance(maturity.get("edge_evidence"), dict) else {}
    phase_gate = phase.get("next_gate") if isinstance(phase.get("next_gate"), dict) else {}
    cells = maturity.get("cells") if isinstance(maturity.get("cells"), list) else []
    since = utc_now() - timedelta(hours=lookback_hours)
    edge_state = str(phase.get("state") or evidence.get("state") or "UNAVAILABLE")
    return {
        "schema_version": "edge-truth-reopen-watch/v1",
        "generated_at": iso_z(utc_now()),
        "lookback_hours": lookback_hours,
        "edge_truth": {
            "state": edge_state,
            "phase_label": phase.get("phase_label"),
            "metrics": phase.get("metrics"),
            "summary": phase.get("summary") or evidence.get("summary"),
            "next_gate": {
                "name": phase_gate.get("name"),
                "target_state": phase_gate.get("target_state"),
                "condition": phase_gate.get("condition"),
                "candidate_cells": phase_gate.get("candidate_cells") if isinstance(phase_gate.get("candidate_cells"), list) else [],
            },
            "cells": [
                {
                    "cell": cell.get("cell"),
                    "event_count": cell.get("event_count"),
                    "sample_count": cell.get("sample_count"),
                    "maturity_status": cell.get("maturity_status"),
                    "dominant_venue": cell.get("dominant_venue"),
                    "mean_pnl_bps": cell.get("mean_pnl_bps"),
                    "positive_rate": cell.get("positive_rate"),
                    "last_event_time": cell.get("last_event_time"),
                }
                for cell in cells[:8]
                if isinstance(cell, dict)
            ],
        },
        "watcher": {
            "campaign_id": watcher_state.get("campaign_id"),
            "allow_multiple": watcher_state.get("allow_multiple"),
            "success_count": watcher_state.get("success_count"),
            "failure_count": watcher_state.get("failure_count"),
            "updated_at": watcher_state.get("updated_at"),
            "history_count": len(watcher_state.get("campaign_history") or []),
            "recent_history": (watcher_state.get("campaign_history") or [])[-5:],
            "log_tail": tail_lines(WATCHER_LOG_PATH, 12),
        },
        "market": {
            "recent_reactions": recent_reactions(since=since, limit=reaction_limit),
        },
        "mt5_gate": {
            "ready": edge_state == "STRUCTURAL",
            "required_edge_state": "STRUCTURAL",
            "reason": None if edge_state == "STRUCTURAL" else f"edge_not_structural:{edge_state}",
            "live_order_submitted": False,
        },
    }


def format_markdown(snapshot: dict[str, Any]) -> str:
    edge = snapshot["edge_truth"]
    gate = edge["next_gate"]
    mt5 = snapshot["mt5_gate"]
    lines = [
        "# Edge Truth Reopen Watch",
        "",
        f"Generated at: `{snapshot['generated_at']}`",
        "",
        f"State: `{edge.get('state')}`",
        f"Next gate: `{gate.get('name')}` -> `{gate.get('target_state')}`",
        f"Condition: `{gate.get('condition')}`",
        f"MT5 gate ready: `{str(mt5.get('ready')).lower()}` ({mt5.get('reason') or 'ok'})",
        "",
        "## Cells",
        "",
        "| Cell | Status | Events | Samples | Mean pnl | Positive rate | Last event |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for cell in edge.get("cells") or []:
        positive = cell.get("positive_rate")
        positive_text = "" if positive is None else f"{float(positive) * 100:.2f}%"
        lines.append(
            f"| {cell.get('cell')} | {cell.get('maturity_status')} | {cell.get('event_count')} | "
            f"{cell.get('sample_count')} | {cell.get('mean_pnl_bps')} | {positive_text} | {cell.get('last_event_time') or ''} |"
        )
    lines.extend(["", "## Recent Watcher Campaigns", ""])
    for item in snapshot["watcher"].get("recent_history") or []:
        lines.append(
            f"- `{item.get('campaign_id')}` {item.get('reaction_class')}+{item.get('regime')} "
            f"event `{item.get('event_time')}` success={item.get('success_count')} failure={item.get('failure_count')}"
        )
    lines.extend(["", "## Recent Reactions", ""])
    for row in snapshot["market"].get("recent_reactions") or []:
        lines.append(
            f"- `{row.get('event_time')}` {row.get('venue')} {row.get('reaction_class')} "
            f"{row.get('event_direction')} trigger_bps={row.get('trigger_bps')}"
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish read-only Edge Truth market reopen watch snapshot.")
    parser.add_argument("--lookback-hours", type=float, default=6.0)
    parser.add_argument("--reaction-limit", type=int, default=20)
    parser.add_argument("--json-output", default=str(DEFAULT_OUTPUT_JSON))
    parser.add_argument("--markdown-output", default=str(DEFAULT_OUTPUT_MD))
    parser.add_argument("--format", choices=["json", "markdown"], default="json")
    args = parser.parse_args()

    snapshot = build_snapshot(lookback_hours=args.lookback_hours, reaction_limit=args.reaction_limit)
    json_output = Path(args.json_output)
    markdown_output = Path(args.markdown_output)
    json_output.parent.mkdir(parents=True, exist_ok=True)
    markdown_output.parent.mkdir(parents=True, exist_ok=True)
    json_output.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    markdown_output.write_text(format_markdown(snapshot), encoding="utf-8")

    if args.format == "markdown":
        print(format_markdown(snapshot))
    else:
        print(json.dumps(snapshot, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
