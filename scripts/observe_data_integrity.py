#!/usr/bin/env python3
"""Read-only data integrity audit for market_ohlcv + market_trades.

Strictly read-only. NO writes anywhere. NO threshold mutation.

Four checks per (venue, instrument, timeframe):
  A) Continuity: gap distribution between consecutive bucket_start values.
  B) Flat candles: open==high==low==close as a fraction of bars.
  C) Jumps: |return| in bps between consecutive closes (p50/p95/p99/max).
  D) Cross-venue divergence (1m close, snapped to common minutes):
       max - min across venues per minute, in bps; p50/p95/p99/max + share
       of minutes with divergence > 5/10/25 bps.

Run inside control-plane:
    docker exec -i control-plane python3 /workspace/scripts/observe_data_integrity.py \
        --instrument BTCUSDT --timeframe 1m --hours 24
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
from datetime import datetime, timedelta, timezone
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

TF_SECONDS = {"1m": 60, "5m": 300, "1h": 3600}


def _read_db_url() -> str:
    env = os.environ.get("DATABASE_URL")
    if env:
        return env
    if DEFAULT_DB_SECRET.exists():
        return DEFAULT_DB_SECRET.read_text(encoding="utf-8").strip()
    raise SystemExit("ERROR: DATABASE_URL not set and secrets/database_url not found.")


def _pct(xs: list[float], q: float) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    k = max(0, min(len(s) - 1, int(round(q * (len(s) - 1)))))
    return s[k]


def _venues(conn, instrument: str, timeframe: str, since: datetime) -> list[str]:
    sql = (
        "SELECT DISTINCT venue FROM market_ohlcv "
        "WHERE instrument=%s AND timeframe=%s AND bucket_start>=%s ORDER BY 1"
    )
    with conn.cursor() as cur:
        cur.execute(sql, (instrument, timeframe, since))
        return [r[0] for r in cur.fetchall()]


def _fetch_candles(conn, venue: str, instrument: str, timeframe: str, since: datetime):
    sql = (
        "SELECT bucket_start, open, high, low, close, volume "
        "FROM market_ohlcv WHERE venue=%s AND instrument=%s AND timeframe=%s "
        "AND bucket_start>=%s ORDER BY bucket_start ASC"
    )
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, (venue, instrument, timeframe, since))
        return list(cur.fetchall())


def audit_one(rows: list[dict[str, Any]], expected_seconds: int) -> dict[str, Any]:
    n = len(rows)
    if n < 2:
        return {"bars": n, "reason": "insufficient_bars"}

    gaps: list[float] = []
    bad_low_high: int = 0
    flat = 0
    zero_volume = 0
    rets_bps: list[float] = []
    for i, r in enumerate(rows):
        o, h, l, c = float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"])
        if not (l <= min(o, c) and h >= max(o, c)):
            bad_low_high += 1
        if o == h == l == c:
            flat += 1
        if float(r["volume"] or 0) == 0:
            zero_volume += 1
        if i > 0:
            prev = rows[i - 1]
            dt = (r["bucket_start"] - prev["bucket_start"]).total_seconds()
            gaps.append(dt)
            pc = float(prev["close"])
            if pc > 0:
                rets_bps.append(abs(c - pc) / pc * 1e4)

    exact = sum(1 for g in gaps if g == expected_seconds)
    missing_buckets = sum(int(round(g / expected_seconds)) - 1 for g in gaps if g > expected_seconds)
    duplicates = sum(1 for g in gaps if g < expected_seconds)
    longest_gap = max(gaps) if gaps else 0.0

    return {
        "bars": n,
        "first": rows[0]["bucket_start"].astimezone(timezone.utc).isoformat(),
        "last": rows[-1]["bucket_start"].astimezone(timezone.utc).isoformat(),
        "expected_seconds": expected_seconds,
        "continuity": {
            "exact_gap_pct": round(100.0 * exact / len(gaps), 2),
            "missing_buckets": missing_buckets,
            "duplicate_or_short_gap": duplicates,
            "longest_gap_seconds": longest_gap,
        },
        "flats": {
            "flat_bars": flat,
            "flat_pct": round(100.0 * flat / n, 3),
            "zero_volume_bars": zero_volume,
            "zero_volume_pct": round(100.0 * zero_volume / n, 3),
            "ohlc_inconsistent_bars": bad_low_high,
        },
        "jumps_bps": {
            "median": round(statistics.median(rets_bps), 3) if rets_bps else 0.0,
            "p95": round(_pct(rets_bps, 0.95), 3),
            "p99": round(_pct(rets_bps, 0.99), 3),
            "max": round(max(rets_bps), 3) if rets_bps else 0.0,
            "gt_25bps": sum(1 for x in rets_bps if x > 25),
            "gt_50bps": sum(1 for x in rets_bps if x > 50),
            "gt_100bps": sum(1 for x in rets_bps if x > 100),
        },
    }


def cross_venue_divergence(
    by_venue: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    # Map venue -> {bucket_iso: close}
    series: dict[str, dict[str, float]] = {}
    for v, rows in by_venue.items():
        series[v] = {
            r["bucket_start"].astimezone(timezone.utc).isoformat(): float(r["close"])
            for r in rows
        }
    if len(series) < 2:
        return {"reason": "need_at_least_two_venues"}
    common = set.intersection(*(set(s.keys()) for s in series.values()))
    if not common:
        return {"reason": "no_common_buckets"}
    divs_bps: list[float] = []
    for ts in common:
        prices = [s[ts] for s in series.values()]
        lo, hi = min(prices), max(prices)
        if lo > 0:
            divs_bps.append((hi - lo) / lo * 1e4)
    if not divs_bps:
        return {"reason": "no_div_samples"}
    return {
        "venues": sorted(series.keys()),
        "common_buckets": len(divs_bps),
        "median_bps": round(statistics.median(divs_bps), 3),
        "p95_bps": round(_pct(divs_bps, 0.95), 3),
        "p99_bps": round(_pct(divs_bps, 0.99), 3),
        "max_bps": round(max(divs_bps), 3),
        "gt_5bps_pct": round(100.0 * sum(1 for x in divs_bps if x > 5) / len(divs_bps), 2),
        "gt_10bps_pct": round(100.0 * sum(1 for x in divs_bps if x > 10) / len(divs_bps), 2),
        "gt_25bps_pct": round(100.0 * sum(1 for x in divs_bps if x > 25) / len(divs_bps), 2),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--instrument", default="BTCUSDT")
    ap.add_argument("--timeframe", default="1m", choices=list(TF_SECONDS.keys()))
    ap.add_argument("--hours", type=int, default=24, help="lookback window in hours")
    ap.add_argument("--venues", default="", help="comma-separated venue list (default: auto)")
    args = ap.parse_args()

    since = datetime.now(timezone.utc) - timedelta(hours=args.hours)
    expected = TF_SECONDS[args.timeframe]
    db_url = _read_db_url()

    report: dict[str, Any] = {
        "instrument": args.instrument,
        "timeframe": args.timeframe,
        "since": since.isoformat(),
        "per_venue": {},
    }

    with psycopg.connect(db_url) as conn:
        venues = (
            [v.strip() for v in args.venues.split(",") if v.strip()]
            if args.venues
            else _venues(conn, args.instrument, args.timeframe, since)
        )
        by_venue: dict[str, list[dict[str, Any]]] = {}
        for v in venues:
            rows = _fetch_candles(conn, v, args.instrument, args.timeframe, since)
            by_venue[v] = rows
            report["per_venue"][v] = audit_one(rows, expected)
        report["cross_venue"] = cross_venue_divergence(by_venue)

    print(json.dumps(report, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
