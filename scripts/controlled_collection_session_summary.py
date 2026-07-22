#!/usr/bin/env python3
"""Summarize a controlled collection watcher session.

Read-only over:
  - logs/controlled_collection_watch.jsonl
  - logs/controlled_collection_session_state.json (optional)

Outputs one JSON summary for the target session baseline.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ARCHIVE = REPO_ROOT / "logs" / "controlled_collection_watch.jsonl"
DEFAULT_STATE = REPO_ROOT / "logs" / "controlled_collection_session_state.json"


def _parse_iso(value: str | None) -> datetime | None:
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


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _iter_jsonl(path: Path):
    if not path.exists():
        return
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict):
                yield row


def _load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _pick_baseline(rows: list[dict[str, Any]], state: dict[str, Any], explicit: str) -> str | None:
    if explicit:
        return explicit
    state_baseline = str(state.get("baseline_since") or "").strip()
    if state_baseline:
        return state_baseline
    baselines = [str(row.get("baseline_since") or "").strip() for row in rows if str(row.get("baseline_since") or "").strip()]
    return baselines[-1] if baselines else None


def build_summary(archive_path: Path, state_path: Path, baseline: str) -> dict[str, Any]:
    rows = [row for row in _iter_jsonl(archive_path) or [] if str(row.get("baseline_since") or "").strip() == baseline]
    state = _load_state(state_path)
    target_baseline = baseline

    started_at = _parse_iso(target_baseline)
    first_ts = _parse_iso(str(rows[0].get("ts") if rows else ""))
    last_ts = _parse_iso(str(rows[-1].get("ts") if rows else ""))
    latest = rows[-1] if rows else {}
    fills_seen = max(int((row.get("fills") or {}).get("filled_decisions_since") or 0) for row in rows) if rows else 0
    labels_seen = max(int((row.get("labels") or {}).get("labels_since") or 0) for row in rows) if rows else 0
    kill_switch_rearmed = any(str(row.get("phase") or "") == "kill_switch_rearmed_stop" for row in rows)
    phase = str(latest.get("phase") or "unknown")
    gate = latest.get("opportunity_gate") if isinstance(latest.get("opportunity_gate"), dict) else {}
    kill = latest.get("kill_switch") if isinstance(latest.get("kill_switch"), dict) else {}
    latest_fill_at = str((latest.get("fills") or {}).get("latest_fill_at") or "") or None
    latest_labeled_at = str((latest.get("labels") or {}).get("latest_labeled_at") or "") or None
    duration_seconds = 0.0
    if started_at and last_ts:
        duration_seconds = max(0.0, (last_ts - started_at).total_seconds())

    state_baseline = str(state.get("baseline_since") or "").strip()
    active = bool(state) and state_baseline == target_baseline and str(state.get("status") or "") == "open"

    return {
        "baseline_since": target_baseline,
        "opened_at": str(state.get("opened_at") or target_baseline),
        "active": active,
        "started_at": _iso(first_ts or started_at),
        "last_snapshot_at": _iso(last_ts),
        "duration_seconds": round(duration_seconds, 1),
        "duration_minutes": round(duration_seconds / 60.0, 2),
        "cycles": len(rows),
        "phase": phase,
        "fills_seen": fills_seen,
        "labels_seen": labels_seen,
        "kill_switch_rearmed": kill_switch_rearmed,
        "kill_switch_active": bool(kill.get("active")),
        "kill_switch_reason": kill.get("reason"),
        "gate_status": gate.get("status"),
        "gate_health_score": gate.get("health_score"),
        "latest_fill_at": latest_fill_at,
        "latest_labeled_at": latest_labeled_at,
        "archive": str(archive_path),
        "state_file": str(state_path),
    }


def _compact(summary: dict[str, Any]) -> str:
    return (
        f"baseline={summary.get('baseline_since')} phase={summary.get('phase')} "
        f"dur={summary.get('duration_minutes')}m fills={summary.get('fills_seen')} labels={summary.get('labels_seen')} "
        f"kill_rearmed={summary.get('kill_switch_rearmed')} gate={summary.get('gate_status')} health={summary.get('gate_health_score')}"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Summarize a controlled collection session.")
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--baseline", default="")
    parser.add_argument("--compact", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    rows = list(_iter_jsonl(args.archive) or [])
    state = _load_state(args.state)
    baseline = _pick_baseline(rows, state, args.baseline)
    if not baseline:
        print("controlled_collection_session_summary: no session baseline found", file=sys.stderr)
        return 2
    summary = build_summary(args.archive, args.state, baseline)
    if args.compact:
        print(_compact(summary))
    else:
        print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())