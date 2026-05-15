#!/usr/bin/env python3
"""Offline Reaction Speed Engine — observation only.

Strictly read-only against `market_trades`. NO writes, NO runtime hook,
NO `/brain/learn` call, NO threshold mutation, NO trading integration.

Purpose:
    Measure how long the market takes to react to a price-move event.
    We do NOT predict price. We classify reaction speed:
        FAST   -> bots dominate, no human edge
        MEDIUM -> grey zone
        SLOW   -> potential human-exploitable edge

Concept:
    1) Detect events: |bps move| >= MOVE_THRESHOLD_BPS between consecutive
       trades (after a minimum dwell so we don't fire on the same micro-burst).
    2) Within REACTION_WINDOW_SEC after the event, find the extremum in the
       same direction as the event ("continuation") and the time it took to
       reach it.
    3) Classify time-to-extremum:
           reaction_time_ms < FAST_MAX_MS    -> FAST
           reaction_time_ms < MEDIUM_MAX_MS  -> MEDIUM
           else                              -> SLOW

Fixed parameters (NO optimization):
    MOVE_THRESHOLD_BPS    = 5
    REACTION_WINDOW_SEC   = 10
    EVENT_COOLDOWN_SEC    = 5     # avoid double-firing inside a burst
    FAST_MAX_MS           = 100
    MEDIUM_MAX_MS         = 1000

Output (JSONL, append):
    venue, instrument, event_time, event_direction, event_price,
    reaction_bps, reaction_time_ms, reaction_class

Run inside control-plane:
    docker exec -i control-plane python3 /workspace/scripts/reaction_speed_engine.py \
        --venue binance-public --instrument BTCUSDT \
        --since '2026-04-20T17:00:00Z'
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover
    print(
        "ERROR: psycopg not installed. Run inside control-plane:\n"
        "  docker exec -i control-plane python3 /workspace/scripts/reaction_speed_engine.py ...",
        file=sys.stderr,
    )
    sys.exit(2)


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = REPO_ROOT / "logs" / "reaction_speed_engine.jsonl"
DEFAULT_DB_SECRET = REPO_ROOT / "secrets" / "database_url"

# Fixed parameters — DO NOT TUNE in this phase.
MOVE_THRESHOLD_BPS = 5.0
REACTION_WINDOW_SEC = 10
EVENT_COOLDOWN_SEC = 5
FAST_MAX_MS = 100
MEDIUM_MAX_MS = 1000


def _read_db_url() -> str:
    env = os.environ.get("DATABASE_URL")
    if env:
        return env
    if DEFAULT_DB_SECRET.exists():
        return DEFAULT_DB_SECRET.read_text(encoding="utf-8").strip()
    raise SystemExit("ERROR: DATABASE_URL not set and secrets/database_url not found.")


def _parse_iso(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _bps(p_from: float, p_to: float) -> float:
    if p_from <= 0:
        return 0.0
    return (p_to - p_from) / p_from * 1e4


def _fetch_trades(conn, *, venue: str, instrument: str, since: datetime, until: datetime | None) -> list[dict[str, Any]]:
    sql = """
        SELECT traded_at, price
        FROM market_trades
        WHERE venue = %s
          AND instrument = %s
          AND traded_at >= %s
          {until_clause}
        ORDER BY traded_at ASC, id ASC
    """
    params: list[Any] = [venue, instrument, since]
    until_clause = ""
    if until is not None:
        until_clause = "AND traded_at < %s"
        params.append(until)
    sql = sql.format(until_clause=until_clause)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params)
        return [
            {"traded_at": row["traded_at"], "price": float(row["price"])}
            for row in cur.fetchall()
            if row.get("price") is not None
        ]


def _detect_events(trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    if len(trades) < 2:
        return events
    last_event_ts: datetime | None = None
    prev = trades[0]
    for cur in trades[1:]:
        move = _bps(prev["price"], cur["price"])
        if abs(move) >= MOVE_THRESHOLD_BPS:
            if last_event_ts is None or (cur["traded_at"] - last_event_ts).total_seconds() >= EVENT_COOLDOWN_SEC:
                events.append({
                    "timestamp": cur["traded_at"],
                    "price": cur["price"],
                    "direction": "up" if move > 0 else "down",
                    "trigger_bps": move,
                })
                last_event_ts = cur["traded_at"]
        prev = cur
    return events


def _measure_reaction(trades: list[dict[str, Any]], event: dict[str, Any], start_idx_hint: int) -> tuple[dict[str, Any] | None, int]:
    """Find the post-event extremum in the event direction within the window.

    Returns (reaction_dict_or_none, new_idx_hint) where new_idx_hint is
    the index of the first trade strictly after the event (used to advance
    the search start for the next event).
    """
    t0: datetime = event["timestamp"]
    p0: float = event["price"]
    direction: str = event["direction"]
    window_end_ts = t0.timestamp() + REACTION_WINDOW_SEC

    # Advance i to the first trade strictly after t0.
    i = start_idx_hint
    n = len(trades)
    while i < n and trades[i]["traded_at"] <= t0:
        i += 1
    new_hint = i

    best_price = p0
    best_ts: datetime | None = None
    while i < n:
        tr = trades[i]
        if tr["traded_at"].timestamp() > window_end_ts:
            break
        price = tr["price"]
        if direction == "up":
            if price > best_price:
                best_price = price
                best_ts = tr["traded_at"]
        else:
            if price < best_price:
                best_price = price
                best_ts = tr["traded_at"]
        i += 1

    if best_ts is None:
        return None, new_hint

    reaction_bps = _bps(p0, best_price)
    # Report continuation magnitude as a positive scalar regardless of direction.
    if direction == "down":
        reaction_bps = -reaction_bps
    reaction_time_ms = (best_ts - t0).total_seconds() * 1000.0
    return {
        "reaction_bps": round(reaction_bps, 4),
        "reaction_time_ms": round(reaction_time_ms, 1),
    }, new_hint


def _classify_reaction(reaction_time_ms: float) -> str:
    if reaction_time_ms < FAST_MAX_MS:
        return "FAST"
    if reaction_time_ms < MEDIUM_MAX_MS:
        return "MEDIUM"
    return "SLOW"


def run(
    *,
    venue: str,
    instrument: str,
    since: datetime,
    until: datetime | None,
    emit_since: datetime | None,
    output_path: Path,
) -> dict[str, Any]:
    db_url = _read_db_url()
    with psycopg.connect(db_url) as conn:
        trades = _fetch_trades(conn, venue=venue, instrument=instrument, since=since, until=until)

    summary: dict[str, Any] = {
        "venue": venue,
        "instrument": instrument,
        "since": since.isoformat(),
        "until": until.isoformat() if until else None,
        "emit_since": emit_since.isoformat() if emit_since else None,
        "trade_count": len(trades),
        "event_count": 0,
        "reaction_count": 0,
        "params": {
            "move_threshold_bps": MOVE_THRESHOLD_BPS,
            "reaction_window_sec": REACTION_WINDOW_SEC,
            "event_cooldown_sec": EVENT_COOLDOWN_SEC,
            "fast_max_ms": FAST_MAX_MS,
            "medium_max_ms": MEDIUM_MAX_MS,
        },
        "class_counts": {},
        "class_pct": {},
        "median_reaction_ms_by_class": {},
        "median_reaction_bps_by_class": {},
    }

    if not trades:
        return summary

    events = _detect_events(trades)
    summary["event_count"] = len(events)

    per_class_times: dict[str, list[float]] = {"FAST": [], "MEDIUM": [], "SLOW": []}
    per_class_bps: dict[str, list[float]] = {"FAST": [], "MEDIUM": [], "SLOW": []}
    counts: Counter[str] = Counter()
    rows_to_write: list[dict[str, Any]] = []
    hint = 0
    for ev in events:
        if emit_since is not None and ev["timestamp"] < emit_since:
            continue
        result, hint = _measure_reaction(trades, ev, hint)
        if result is None:
            continue
        cls = _classify_reaction(result["reaction_time_ms"])
        counts[cls] += 1
        per_class_times[cls].append(result["reaction_time_ms"])
        per_class_bps[cls].append(result["reaction_bps"])
        rows_to_write.append({
            "venue": venue,
            "instrument": instrument,
            "event_time": ev["timestamp"].isoformat(),
            "event_direction": ev["direction"],
            "event_price": ev["price"],
            "trigger_bps": round(ev["trigger_bps"], 4),
            "reaction_bps": result["reaction_bps"],
            "reaction_time_ms": result["reaction_time_ms"],
            "reaction_class": cls,
        })

    summary["reaction_count"] = sum(counts.values())
    total = max(1, summary["reaction_count"])
    summary["class_counts"] = dict(counts)
    summary["class_pct"] = {k: round(100.0 * counts.get(k, 0) / total, 2) for k in ("FAST", "MEDIUM", "SLOW")}

    def _median(values: list[float]) -> float | None:
        if not values:
            return None
        s = sorted(values)
        m = len(s) // 2
        return round(s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2.0, 4)

    summary["median_reaction_ms_by_class"] = {k: _median(per_class_times[k]) for k in ("FAST", "MEDIUM", "SLOW")}
    summary["median_reaction_bps_by_class"] = {k: _median(per_class_bps[k]) for k in ("FAST", "MEDIUM", "SLOW")}

    if rows_to_write:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("a", encoding="utf-8") as fh:
            for row in rows_to_write:
                fh.write(json.dumps(row, separators=(",", ":")) + "\n")

    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Offline reaction-speed engine (observation only).")
    parser.add_argument("--venue", required=True)
    parser.add_argument("--instrument", required=True)
    parser.add_argument("--since", required=True, help="ISO8601 start (e.g. 2026-04-20T17:00:00Z)")
    parser.add_argument("--until", default=None, help="ISO8601 end (exclusive). Defaults to now.")
    parser.add_argument("--emit-since", default=None, help="Only emit events at/after this timestamp.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--no-jsonl", action="store_true", help="Skip JSONL append, only print summary.")
    args = parser.parse_args()

    since = _parse_iso(args.since)
    until = _parse_iso(args.until) if args.until else None
    emit_since = _parse_iso(args.emit_since) if args.emit_since else None
    output_path = Path("/dev/null") if args.no_jsonl else Path(args.output)

    summary = run(
        venue=args.venue,
        instrument=args.instrument,
        since=since,
        until=until,
        emit_since=emit_since,
        output_path=output_path,
    )
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
