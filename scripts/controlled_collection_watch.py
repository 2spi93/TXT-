#!/usr/bin/env python3
"""Read-only operator watcher for controlled collection windows.

Purpose:
    Observe a manual controlled-collection session without touching live
    execution, policies, kill-switch state, or thresholds.

What it watches:
    - control-plane /health
    - /v1/system/kill-switch
    - execution_fill_events since a baseline timestamp
    - logs/intent_outcome_labels.jsonl entries anchored on ts_fill_final
    - recent execution telemetry for realized slippage / latency context

Typical usage:
    # Start watcher before the manual kill-switch reset.
    docker exec -i control-plane python3 /workspace/scripts/controlled_collection_watch.py

    # Or anchor explicitly to a known reset time.
    docker exec -i control-plane python3 /workspace/scripts/controlled_collection_watch.py \
      --since '2026-04-22T10:30:00Z'

Behavior:
    - If kill_switch is still active, status = waiting_for_manual_reset
    - After kill_switch clears once, watcher records that the collection
      window has opened
    - It then waits for the first fill and the first label
    - If kill_switch re-arms after a clear, watcher reports
      kill_switch_rearmed_stop and exits non-zero

Strictly read-only:
    NO POSTs, NO threshold mutation, NO route changes, NO DB writes.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover
    print(
        "ERROR: psycopg not installed. Run inside control-plane:\n"
        "  docker exec -i control-plane python3 /workspace/scripts/controlled_collection_watch.py",
        file=sys.stderr,
    )
    raise

from go_live_watchdog import (  # type: ignore
    ControlPlaneClient,
    load_repo_env,
    resolve_control_plane_url,
    resolve_secret,
)


REPO_ROOT_CANDIDATES = (Path("/workspace"), Path(__file__).resolve().parent.parent)
REPO_ROOT = next((p for p in REPO_ROOT_CANDIDATES if (p / "scripts").exists()), REPO_ROOT_CANDIDATES[-1])
DEFAULT_LABELS = REPO_ROOT / "logs" / "intent_outcome_labels.jsonl"
DEFAULT_ARCHIVE = REPO_ROOT / "logs" / "controlled_collection_watch.jsonl"


def _database_url() -> str:
    file_path = os.getenv("DATABASE_URL_FILE", "").strip()
    if file_path:
        candidate = Path(file_path)
        if candidate.exists():
            return candidate.read_text(encoding="utf-8").strip()
    return os.getenv("DATABASE_URL", "").strip() or "postgresql://txt:txt@postgres:5432/mission_control"


def _parse_iso(value: str) -> datetime:
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _iter_jsonl(path: Path):
    if not path.exists():
        return
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


def _label_stats(path: Path, since: datetime) -> dict[str, Any]:
    labels = 0
    latest_fill_ts: datetime | None = None
    latest_labeled_at: datetime | None = None
    for row in _iter_jsonl(path) or []:
        fill_ts_raw = row.get("ts_fill_final") or row.get("ts_intent")
        if not fill_ts_raw:
            continue
        try:
            fill_ts = _parse_iso(str(fill_ts_raw))
        except ValueError:
            continue
        if fill_ts < since:
            continue
        labels += 1
        if latest_fill_ts is None or fill_ts > latest_fill_ts:
            latest_fill_ts = fill_ts
        labeled_at_raw = row.get("labeled_at")
        if labeled_at_raw:
            try:
                labeled_at = _parse_iso(str(labeled_at_raw))
            except ValueError:
                labeled_at = None
            if labeled_at and (latest_labeled_at is None or labeled_at > latest_labeled_at):
                latest_labeled_at = labeled_at
    return {
        "labels_since": labels,
        "latest_fill_ts": latest_fill_ts,
        "latest_labeled_at": latest_labeled_at,
    }


def _fill_stats(conn: psycopg.Connection[Any], since: datetime) -> dict[str, Any]:
    sql = """
        SELECT
            COUNT(*) AS fill_events,
            COUNT(DISTINCT decision_id) AS filled_decisions,
            MAX(filled_at) AS latest_fill_at
        FROM execution_fill_events
        WHERE filled_at >= %s
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, (since,))
        row = cur.fetchone() or {}
    latest_fill_at = row.get("latest_fill_at")
    if latest_fill_at and latest_fill_at.tzinfo is None:
        latest_fill_at = latest_fill_at.replace(tzinfo=timezone.utc)
    return {
        "fill_events_since": int(row.get("fill_events") or 0),
        "filled_decisions_since": int(row.get("filled_decisions") or 0),
        "latest_fill_at": latest_fill_at,
    }


def _latest_telemetry_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    latest = rows[0] if rows else {}
    return {
        "decision_id": str(latest.get("decision_id") or "").strip() or None,
        "realized_slippage_bps": float(latest.get("realized_slippage_bps") or 0.0) if latest.get("realized_slippage_bps") is not None else None,
        "latency_e2e_ms": float(latest.get("latency_e2e_ms") or 0.0) if latest.get("latency_e2e_ms") is not None else None,
        "venue": str(latest.get("venue") or "").strip() or None,
        "instrument": str(latest.get("instrument") or "").strip() or None,
    }


def _compute_phase(*, kill_switch_active: bool, seen_reset: bool, fills_since: int, labels_since: int) -> str:
    if kill_switch_active and seen_reset:
        return "kill_switch_rearmed_stop"
    if kill_switch_active:
        return "waiting_for_manual_reset"
    if not seen_reset:
        return "reset_observed_waiting_for_first_fill"
    if fills_since <= 0:
        return "reset_ok_waiting_for_first_fill"
    if labels_since <= 0:
        return "first_fill_seen_waiting_for_first_label"
    return "label_flow_started"


def _append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, sort_keys=True) + "\n")


def _compact_line(snapshot: dict[str, Any]) -> str:
    ts = str(snapshot.get("ts") or "-")
    phase = str(snapshot.get("phase") or "unknown")
    gate = snapshot.get("opportunity_gate") if isinstance(snapshot.get("opportunity_gate"), dict) else {}
    kill = snapshot.get("kill_switch") if isinstance(snapshot.get("kill_switch"), dict) else {}
    fills = snapshot.get("fills") if isinstance(snapshot.get("fills"), dict) else {}
    labels = snapshot.get("labels") if isinstance(snapshot.get("labels"), dict) else {}
    telemetry = snapshot.get("telemetry") if isinstance(snapshot.get("telemetry"), dict) else {}

    gate_status = str(gate.get("status") or "-").upper()
    gate_health = gate.get("health_score")
    gate_health_text = f"{float(gate_health):.2f}" if gate_health is not None else "-"
    kill_active = bool(kill.get("active"))
    kill_reason = str(kill.get("reason") or "-")
    fills_count = int(fills.get("filled_decisions_since") or 0)
    labels_count = int(labels.get("labels_since") or 0)
    slippage = telemetry.get("realized_slippage_bps")
    latency = telemetry.get("latency_e2e_ms")
    slippage_text = f"{float(slippage):.1f}" if slippage is not None else "-"
    latency_text = f"{float(latency):.0f}" if latency is not None else "-"

    return (
        f"{ts} phase={phase} gate={gate_status} health={gate_health_text} "
        f"kill={'ACTIVE' if kill_active else 'CLEAR'}({kill_reason}) "
        f"fills={fills_count} labels={labels_count} slip={slippage_text}bps lat={latency_text}ms"
    )


def _print_snapshot(snapshot: dict[str, Any]) -> None:
    print(json.dumps(snapshot, sort_keys=True), flush=True)


def _emit_snapshot(snapshot: dict[str, Any], *, compact: bool, jsonl_output: Path | None) -> None:
    if jsonl_output is not None:
        _append_jsonl(jsonl_output, snapshot)
    if compact:
        print(_compact_line(snapshot), flush=True)
    else:
        _print_snapshot(snapshot)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read-only watcher for controlled collection sessions.")
    parser.add_argument("--control-plane-url", default="", help="Control-plane base URL. Defaults to env or http://127.0.0.1:8000")
    parser.add_argument("--username", default=os.getenv("CONTROLLED_COLLECTION_USERNAME", "admin"))
    parser.add_argument("--password", default=os.getenv("CONTROLLED_COLLECTION_PASSWORD", ""))
    parser.add_argument("--password-file", default=os.getenv("CONTROLLED_COLLECTION_PASSWORD_FILE") or os.getenv("DEFAULT_ADMIN_PASSWORD_FILE", ""))
    parser.add_argument("--since", default="", help="ISO8601 baseline for fills/labels. Defaults to watcher start time.")
    parser.add_argument("--interval-seconds", type=float, default=float(os.getenv("CONTROLLED_COLLECTION_INTERVAL_SECONDS", "10")))
    parser.add_argument("--recent-limit", type=int, default=int(os.getenv("CONTROLLED_COLLECTION_RECENT_LIMIT", "10")))
    parser.add_argument("--timeout-seconds", type=float, default=float(os.getenv("CONTROLLED_COLLECTION_TIMEOUT_SECONDS", "10")))
    parser.add_argument("--labels", type=Path, default=DEFAULT_LABELS)
    parser.add_argument("--compact", action="store_true", help="Print one compact line per cycle for tmux/console use.")
    parser.add_argument("--jsonl-output", type=Path, default=None, help="Append raw JSON snapshots to this JSONL file.")
    parser.add_argument("--once", action="store_true", help="Run one cycle and exit.")
    return parser.parse_args()


def main() -> int:
    load_repo_env()
    args = parse_args()
    control_plane_url = resolve_control_plane_url(args.control_plane_url)
    password = resolve_secret(args.password, args.password_file, args.username)
    if not password:
        print("controlled_collection_watch: missing control-plane password", file=sys.stderr)
        return 2

    baseline = _parse_iso(args.since) if args.since else _now_utc()
    client = ControlPlaneClient(control_plane_url, args.username, password, args.timeout_seconds)
    db_url = _database_url()
    seen_reset = False

    try:
        with psycopg.connect(db_url) as conn:
            while True:
                health = client.request("GET", "/health", auth=False)
                kill_switch = client.request("GET", "/v1/system/kill-switch")
                telemetry = client.request("GET", "/v1/execution/telemetry/recent", params={"limit": max(5, min(args.recent_limit, 25))})

                kill_state = kill_switch.get("state") if isinstance(kill_switch, dict) and isinstance(kill_switch.get("state"), dict) else kill_switch if isinstance(kill_switch, dict) else {}
                kill_switch_active = bool(kill_state.get("active"))
                if not kill_switch_active:
                    seen_reset = True

                fill_stats = _fill_stats(conn, baseline)
                label_stats = _label_stats(args.labels, baseline)
                telemetry_metrics = _latest_telemetry_metrics(telemetry if isinstance(telemetry, list) else [])

                snapshot = {
                    "ts": _iso(_now_utc()),
                    "baseline_since": _iso(baseline),
                    "phase": _compute_phase(
                        kill_switch_active=kill_switch_active,
                        seen_reset=seen_reset,
                        fills_since=fill_stats["filled_decisions_since"],
                        labels_since=label_stats["labels_since"],
                    ),
                    "control_plane": {
                        "status": health.get("status") if isinstance(health, dict) else None,
                        "system_mode": health.get("system_mode") if isinstance(health, dict) else None,
                        "pending_intents": health.get("pending_intents") if isinstance(health, dict) else None,
                    },
                    "opportunity_gate": (health.get("opportunity_gate") if isinstance(health, dict) and isinstance(health.get("opportunity_gate"), dict) else {}),
                    "kill_switch": {
                        "active": kill_switch_active,
                        "reason": kill_state.get("reason"),
                        "activated_at": kill_state.get("activated_at"),
                        "seen_reset": seen_reset,
                    },
                    "fills": {
                        "fill_events_since": fill_stats["fill_events_since"],
                        "filled_decisions_since": fill_stats["filled_decisions_since"],
                        "latest_fill_at": _iso(fill_stats["latest_fill_at"]),
                    },
                    "labels": {
                        "labels_since": label_stats["labels_since"],
                        "latest_fill_ts": _iso(label_stats["latest_fill_ts"]),
                        "latest_labeled_at": _iso(label_stats["latest_labeled_at"]),
                        "source": str(args.labels),
                    },
                    "telemetry": telemetry_metrics,
                }
                _emit_snapshot(snapshot, compact=args.compact, jsonl_output=args.jsonl_output)

                if snapshot["phase"] == "kill_switch_rearmed_stop":
                    return 3
                if args.once:
                    return 0
                time.sleep(max(1.0, args.interval_seconds))
    except KeyboardInterrupt:
        return 130


def _default_archive_path() -> Path:
    return Path(os.getenv("CONTROLLED_COLLECTION_JSONL_OUTPUT", "").strip() or str(DEFAULT_ARCHIVE))


if __name__ == "__main__":
    raise SystemExit(main())