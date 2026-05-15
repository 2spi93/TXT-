#!/usr/bin/env python3
"""Rebuild OHLCV candles from raw `market_trades` ticks.

Read-only on `market_trades`. Writes optionally to a SEPARATE table
`market_ohlcv_clean` -- never touches `market_ohlcv`.

Why this exists: the live OHLCV pipeline carries forward last-close on
empty buckets and produces 57-71% flat candles per the integrity audit.
This rebuilder uses only real trades, so empty buckets are simply OMITTED
(no synthetic carry-forward). This is the desk-grade convention.

Run inside control-plane:
    docker exec -i control-plane python3 /workspace/scripts/rebuild_candles_from_trades.py \
        --venue binance-public --instrument BTCUSDT --since 2026-04-20T18:00:00Z \
        --timeframes 30,60,300

To persist to the separate clean table:
    ... --write-db
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover
    print("ERROR: psycopg not installed. Run inside control-plane.", file=sys.stderr)
    sys.exit(2)


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_SECRET = REPO_ROOT / "secrets" / "database_url"
DEFAULT_OUTPUT = REPO_ROOT / "logs" / "rebuilt_candles.jsonl"

CREATE_CLEAN_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS market_ohlcv_clean (
    venue          TEXT NOT NULL,
    instrument     TEXT NOT NULL,
    timeframe_sec  INTEGER NOT NULL,
    bucket_start   TIMESTAMPTZ NOT NULL,
    open           DOUBLE PRECISION NOT NULL,
    high           DOUBLE PRECISION NOT NULL,
    low            DOUBLE PRECISION NOT NULL,
    close          DOUBLE PRECISION NOT NULL,
    volume         DOUBLE PRECISION NOT NULL,
    quote_volume   DOUBLE PRECISION NOT NULL,
    n_trades       INTEGER NOT NULL,
    vwap           DOUBLE PRECISION NOT NULL,
    source         TEXT NOT NULL DEFAULT 'rebuilt_from_trades',
    rebuilt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (venue, instrument, timeframe_sec, bucket_start)
);
"""

UPSERT_SQL = """
INSERT INTO market_ohlcv_clean
    (venue, instrument, timeframe_sec, bucket_start, open, high, low, close,
     volume, quote_volume, n_trades, vwap)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (venue, instrument, timeframe_sec, bucket_start) DO UPDATE SET
    open = EXCLUDED.open,
    high = EXCLUDED.high,
    low = EXCLUDED.low,
    close = EXCLUDED.close,
    volume = EXCLUDED.volume,
    quote_volume = EXCLUDED.quote_volume,
    n_trades = EXCLUDED.n_trades,
    vwap = EXCLUDED.vwap,
    rebuilt_at = NOW();
"""


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


def fetch_trades_buckets(
    conn,
    *,
    venue: str,
    instrument: str,
    since: datetime,
    timeframe_sec: int,
) -> list[dict[str, Any]]:
    """SQL-side bucket aggregation. Cheap, exact, no python loop."""
    sql = """
        SELECT
            to_timestamp(floor(extract(epoch FROM traded_at) / %s) * %s)
                AT TIME ZONE 'UTC'                              AS bucket_start,
            (ARRAY_AGG(price ORDER BY traded_at ASC, id ASC))[1]  AS open,
            (ARRAY_AGG(price ORDER BY traded_at DESC, id DESC))[1] AS close,
            MAX(price)                                            AS high,
            MIN(price)                                            AS low,
            SUM(size)                                             AS volume,
            SUM(price * size)                                     AS quote_volume,
            COUNT(*)                                              AS n_trades
          FROM market_trades
         WHERE venue = %s AND instrument = %s
           AND traded_at >= %s
         GROUP BY 1
         ORDER BY 1 ASC
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, (timeframe_sec, timeframe_sec, venue, instrument, since))
        rows = list(cur.fetchall())
    out: list[dict[str, Any]] = []
    for r in rows:
        vol = float(r["volume"] or 0.0)
        if vol <= 0:
            continue
        qvol = float(r["quote_volume"] or 0.0)
        out.append(
            {
                "bucket_start": r["bucket_start"],
                "open": float(r["open"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "close": float(r["close"]),
                "volume": vol,
                "quote_volume": qvol,
                "n_trades": int(r["n_trades"] or 0),
                "vwap": qvol / vol,
            }
        )
    return out


def write_clean(conn, *, venue: str, instrument: str, timeframe_sec: int,
                candles: list[dict[str, Any]]) -> int:
    if not candles:
        return 0
    rows = [
        (
            venue, instrument, timeframe_sec, c["bucket_start"],
            c["open"], c["high"], c["low"], c["close"],
            c["volume"], c["quote_volume"], c["n_trades"], c["vwap"],
        )
        for c in candles
    ]
    with conn.cursor() as cur:
        cur.executemany(UPSERT_SQL, rows)
    return len(rows)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--venue", default="binance-public")
    ap.add_argument("--instrument", default="BTCUSDT")
    ap.add_argument("--since", required=True, help="ISO8601 inclusive lower bound on traded_at")
    ap.add_argument("--timeframes", default="30,60,300",
                    help="comma-separated timeframe seconds (default 30,60,300)")
    ap.add_argument("--write-db", action="store_true",
                    help="upsert into market_ohlcv_clean (separate table)")
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT),
                    help="JSONL output path when not writing DB (default logs/rebuilt_candles.jsonl)")
    ap.add_argument("--no-jsonl", action="store_true",
                    help="skip JSONL output (useful with --write-db only)")
    args = ap.parse_args()

    since = _parse_iso(args.since)
    tfs = [int(x) for x in args.timeframes.split(",") if x.strip()]
    db_url = _read_db_url()

    out_path = Path(args.output)
    if not args.no_jsonl:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_fh = out_path.open("w", encoding="utf-8")
    else:
        out_fh = None

    summary: dict[str, Any] = {
        "venue": args.venue,
        "instrument": args.instrument,
        "since": since.isoformat(),
        "write_db": bool(args.write_db),
        "per_timeframe": {},
    }

    with psycopg.connect(db_url) as conn:
        if args.write_db:
            with conn.cursor() as cur:
                cur.execute(CREATE_CLEAN_TABLE_SQL)
            conn.commit()

        for tf in tfs:
            candles = fetch_trades_buckets(
                conn,
                venue=args.venue,
                instrument=args.instrument,
                since=since,
                timeframe_sec=tf,
            )
            written = 0
            if args.write_db:
                written = write_clean(
                    conn,
                    venue=args.venue,
                    instrument=args.instrument,
                    timeframe_sec=tf,
                    candles=candles,
                )
                conn.commit()
            if out_fh and candles:
                for c in candles:
                    out_fh.write(json.dumps({
                        "venue": args.venue,
                        "instrument": args.instrument,
                        "timeframe_sec": tf,
                        "bucket_start": c["bucket_start"].astimezone(timezone.utc).isoformat(),
                        "open": c["open"], "high": c["high"], "low": c["low"], "close": c["close"],
                        "volume": c["volume"], "quote_volume": c["quote_volume"],
                        "n_trades": c["n_trades"], "vwap": c["vwap"],
                    }) + "\n")
            first = candles[0]["bucket_start"].astimezone(timezone.utc).isoformat() if candles else None
            last = candles[-1]["bucket_start"].astimezone(timezone.utc).isoformat() if candles else None
            summary["per_timeframe"][str(tf)] = {
                "candles": len(candles),
                "written_to_clean_table": written,
                "first": first,
                "last": last,
            }

    if out_fh:
        out_fh.close()
        summary["jsonl_output"] = str(out_path)

    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
