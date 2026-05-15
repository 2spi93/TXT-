#!/usr/bin/env python3
"""Offline Regime Engine — observation only.

Strictly read-only against `market_ohlcv_clean` (clean candles rebuilt
from `market_trades`). NO writes, NO runtime hook, NO threshold mutation,
NO trading integration.

Purpose:
    Classify market regime over a rolling window. We do NOT predict price.
    We label what the tape currently looks like:
        TREND       -> directional, low chop
        RANGE       -> mean-reverting, contained
        CHAOTIC     -> high vol, low directional persistence
        LOW_LIQUIDITY -> sparse, large gaps
        HIGH_VOL    -> elevated realized volatility

Fixed parameters (NO optimization):
    WINDOW_BARS               = 60       # ~60 minutes on 1m
    TREND_AUTOCORR_MIN        = 0.10
    RANGE_AUTOCORR_MAX        = 0.05
    HIGH_VOL_BPS              = 25.0     # realized stdev per bar in bps
    CHAOTIC_DIRECT_RATIO_MAX  = 0.55     # |sum(ret)| / sum(|ret|) below this and high vol => chaotic
    LOW_LIQ_GAP_RATIO_MIN     = 0.70     # share of empty-bucket gaps in window

Computation per window ending at bar t:
    rets[i] = ln(close[i] / close[i-1])
    realized_vol_bps = stdev(rets) * 1e4
    autocorr_lag1    = pearson(rets[1:], rets[:-1])
    direction_ratio  = |sum(rets)| / sum(|rets|)
    gap_ratio        = expected_bars - actual_bars / expected_bars

Classification (priority order):
    if gap_ratio        >= LOW_LIQ_GAP_RATIO_MIN     -> LOW_LIQUIDITY
    elif vol_bps        >= HIGH_VOL_BPS and direction_ratio < CHAOTIC_DIRECT_RATIO_MAX -> CHAOTIC
    elif vol_bps        >= HIGH_VOL_BPS              -> HIGH_VOL
    elif autocorr_lag1  >= TREND_AUTOCORR_MIN        -> TREND
    elif autocorr_lag1  <= RANGE_AUTOCORR_MAX        -> RANGE
    else                                             -> RANGE

Output (JSONL, append):
    venue, instrument, timeframe_sec, window_end, regime, confidence,
    realized_vol_bps, autocorr_lag1, direction_ratio, gap_ratio, bar_count

Run inside control-plane:
    docker exec -i control-plane python3 /workspace/scripts/regime_engine.py \
        --venue binance-public --instrument BTCUSDT --timeframe 1m \
        --since '2026-04-20T17:00:00Z'
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover
    print(
        "ERROR: psycopg not installed. Run inside control-plane:\n"
        "  docker exec -i control-plane python3 /workspace/scripts/regime_engine.py ...",
        file=sys.stderr,
    )
    sys.exit(2)


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = REPO_ROOT / "logs" / "regime_engine.jsonl"
DEFAULT_DB_SECRET = REPO_ROOT / "secrets" / "database_url"

# Fixed parameters — DO NOT TUNE in this phase.
WINDOW_BARS = 60
TREND_AUTOCORR_MIN = 0.10
RANGE_AUTOCORR_MAX = 0.05
HIGH_VOL_BPS = 25.0
CHAOTIC_DIRECT_RATIO_MAX = 0.55
LOW_LIQ_GAP_RATIO_MIN = 0.70

TIMEFRAME_TO_SEC = {"30s": 30, "1m": 60, "5m": 300, "1h": 3600}


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


def _fetch_clean_candles(conn, *, venue: str, instrument: str, timeframe_sec: int, since: datetime, until: datetime | None) -> list[dict[str, Any]]:
    sql = """
        SELECT bucket_start, close
        FROM market_ohlcv_clean
        WHERE venue = %s
          AND instrument = %s
          AND timeframe_sec = %s
          AND bucket_start >= %s
          {until_clause}
        ORDER BY bucket_start ASC
    """
    params: list[Any] = [venue, instrument, timeframe_sec, since]
    until_clause = ""
    if until is not None:
        until_clause = "AND bucket_start < %s"
        params.append(until)
    sql = sql.format(until_clause=until_clause)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params)
        return [
            {"bucket_start": row["bucket_start"], "close": float(row["close"])}
            for row in cur.fetchall()
            if row.get("close") is not None
        ]


def _stdev(values: list[float]) -> float:
    n = len(values)
    if n < 2:
        return 0.0
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / (n - 1)
    return math.sqrt(var)


def _pearson(x: list[float], y: list[float]) -> float:
    n = min(len(x), len(y))
    if n < 2:
        return 0.0
    mx = sum(x[:n]) / n
    my = sum(y[:n]) / n
    sxx = sum((xi - mx) ** 2 for xi in x[:n])
    syy = sum((yi - my) ** 2 for yi in y[:n])
    sxy = sum((x[i] - mx) * (y[i] - my) for i in range(n))
    if sxx <= 0 or syy <= 0:
        return 0.0
    return sxy / math.sqrt(sxx * syy)


def _classify_window(*, vol_bps: float, autocorr: float, direction_ratio: float, gap_ratio: float) -> tuple[str, float]:
    if gap_ratio >= LOW_LIQ_GAP_RATIO_MIN:
        return "LOW_LIQUIDITY", round(min(1.0, gap_ratio), 4)
    if vol_bps >= HIGH_VOL_BPS and direction_ratio < CHAOTIC_DIRECT_RATIO_MAX:
        # confidence grows with vol and inversely with directional persistence
        conf = min(1.0, (vol_bps / (HIGH_VOL_BPS * 2)) * (1.0 - direction_ratio))
        return "CHAOTIC", round(conf, 4)
    if vol_bps >= HIGH_VOL_BPS:
        conf = min(1.0, vol_bps / (HIGH_VOL_BPS * 2))
        return "HIGH_VOL", round(conf, 4)
    if autocorr >= TREND_AUTOCORR_MIN:
        conf = min(1.0, abs(autocorr) / 0.3)
        return "TREND", round(conf, 4)
    if autocorr <= RANGE_AUTOCORR_MAX:
        conf = min(1.0, (RANGE_AUTOCORR_MAX - autocorr + 0.1) / 0.3)
        return "RANGE", round(conf, 4)
    return "RANGE", 0.5


def run(
    *,
    venue: str,
    instrument: str,
    timeframe: str,
    since: datetime,
    until: datetime | None,
    emit_since: datetime | None,
    output_path: Path,
) -> dict[str, Any]:
    if timeframe not in TIMEFRAME_TO_SEC:
        raise SystemExit(f"ERROR: unsupported timeframe {timeframe}. Choose from {list(TIMEFRAME_TO_SEC)}.")
    timeframe_sec = TIMEFRAME_TO_SEC[timeframe]
    db_url = _read_db_url()
    with psycopg.connect(db_url) as conn:
        candles = _fetch_clean_candles(
            conn,
            venue=venue,
            instrument=instrument,
            timeframe_sec=timeframe_sec,
            since=since,
            until=until,
        )

    summary: dict[str, Any] = {
        "venue": venue,
        "instrument": instrument,
        "timeframe": timeframe,
        "timeframe_sec": timeframe_sec,
        "since": since.isoformat(),
        "until": until.isoformat() if until else None,
        "emit_since": emit_since.isoformat() if emit_since else None,
        "candle_count": len(candles),
        "window_count": 0,
        "params": {
            "window_bars": WINDOW_BARS,
            "trend_autocorr_min": TREND_AUTOCORR_MIN,
            "range_autocorr_max": RANGE_AUTOCORR_MAX,
            "high_vol_bps": HIGH_VOL_BPS,
            "chaotic_direct_ratio_max": CHAOTIC_DIRECT_RATIO_MAX,
            "low_liq_gap_ratio_min": LOW_LIQ_GAP_RATIO_MIN,
        },
        "regime_counts": {},
        "regime_pct": {},
    }

    if len(candles) < WINDOW_BARS + 2:
        return summary

    rows_to_write: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()

    for end_idx in range(WINDOW_BARS, len(candles)):
        window = candles[end_idx - WINDOW_BARS:end_idx]
        closes = [c["close"] for c in window]
        rets: list[float] = []
        for i in range(1, len(closes)):
            if closes[i - 1] > 0:
                rets.append(math.log(closes[i] / closes[i - 1]))
        if len(rets) < 5:
            continue
        vol_bps = _stdev(rets) * 1e4
        autocorr = _pearson(rets[1:], rets[:-1])
        sum_abs = sum(abs(r) for r in rets)
        direction_ratio = (abs(sum(rets)) / sum_abs) if sum_abs > 0 else 0.0
        # gap ratio: contiguous bars expected vs actual bucket count
        first_ts = window[0]["bucket_start"]
        last_ts = window[-1]["bucket_start"]
        if emit_since is not None and last_ts < emit_since:
            continue
        expected = max(1, int((last_ts - first_ts).total_seconds() / timeframe_sec) + 1)
        actual = len(window)
        gap_ratio = max(0.0, 1.0 - actual / expected)
        regime, confidence = _classify_window(
            vol_bps=vol_bps,
            autocorr=autocorr,
            direction_ratio=direction_ratio,
            gap_ratio=gap_ratio,
        )
        counts[regime] += 1
        rows_to_write.append({
            "venue": venue,
            "instrument": instrument,
            "timeframe_sec": timeframe_sec,
            "window_end": last_ts.isoformat(),
            "regime": regime,
            "confidence": confidence,
            "realized_vol_bps": round(vol_bps, 4),
            "autocorr_lag1": round(autocorr, 6),
            "direction_ratio": round(direction_ratio, 6),
            "gap_ratio": round(gap_ratio, 6),
            "bar_count": len(window),
        })

    summary["window_count"] = sum(counts.values())
    total = max(1, summary["window_count"])
    summary["regime_counts"] = dict(counts)
    summary["regime_pct"] = {k: round(100.0 * counts.get(k, 0) / total, 2) for k in ("TREND", "RANGE", "CHAOTIC", "HIGH_VOL", "LOW_LIQUIDITY")}

    if rows_to_write:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("a", encoding="utf-8") as fh:
            for row in rows_to_write:
                fh.write(json.dumps(row, separators=(",", ":")) + "\n")

    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Offline regime engine (observation only).")
    parser.add_argument("--venue", required=True)
    parser.add_argument("--instrument", required=True)
    parser.add_argument("--timeframe", default="1m", choices=list(TIMEFRAME_TO_SEC))
    parser.add_argument("--since", required=True, help="ISO8601 start.")
    parser.add_argument("--until", default=None, help="ISO8601 end (exclusive). Defaults to now.")
    parser.add_argument("--emit-since", default=None, help="Only emit regime windows ending at/after this timestamp.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--no-jsonl", action="store_true")
    args = parser.parse_args()

    since = _parse_iso(args.since)
    until = _parse_iso(args.until) if args.until else None
    emit_since = _parse_iso(args.emit_since) if args.emit_since else None
    output_path = Path("/dev/null") if args.no_jsonl else Path(args.output)

    summary = run(
        venue=args.venue,
        instrument=args.instrument,
        timeframe=args.timeframe,
        since=since,
        until=until,
        emit_since=emit_since,
        output_path=output_path,
    )
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
