#!/usr/bin/env python3
"""Offline alpha-lab: Mean Reversion hypothesis test.

Strictly read-only against `market_ohlcv`. NO writes, NO runtime hook,
NO `/brain/learn` call, NO threshold mutation. Pure backtest over the
historical candles already collected in the multi-venue shadow pipeline.

Hypothesis (single, fixed; NO parameter optimization):
    A 1m close that deviates more than DEV_PCT from its rolling
    SMA(window) is expected to mean-revert toward the SMA within
    HORIZON bars.

Signal (decided at bar t close, action at bar t+1 open to avoid look-ahead):
    deviation = (close[t] - sma[t]) / sma[t]
    if deviation <= -dev_pct  -> LONG  at open[t+1]
    if deviation >= +dev_pct  -> SHORT at open[t+1]

Exit (per bar k > t+1):
    TP  : LONG  high[k] >= sma[t]            (or SHORT low[k]  <= sma[t])
    SL  : LONG  low[k]  <= entry - 1.5 * |entry - sma[t]|
          SHORT high[k] >= entry + 1.5 * |entry - sma[t]|
    timeout: after `horizon` bars without TP/SL -> exit at close[t+1+horizon]

Cooldown: after any exit, no new signal for `cooldown` bars.

Output (one JSONL line per simulated trade) -- compatible with the
distribution observers (`outcome` + `pnl_bps` are the same fields used
by `label_intent_outcomes.py`):

    {
      "venue", "instrument", "timeframe",
      "side", "entry_time", "entry_price",
      "exit_time", "exit_price", "exit_reason",
      "sma_at_signal", "deviation_pct_at_signal",
      "horizon_bars", "bars_held",
      "pnl_bps", "outcome"
    }

Outcome rule (default neutral_band_bps=5, same as labeler):
    pnl_bps >=  +5  -> "win"
    pnl_bps <=  -5  -> "loss"
    otherwise       -> "neutral"

Run:
    docker exec -i control-plane python3 /workspace/scripts/alpha_lab_mean_reversion.py \
        --venue coinbase-public --instrument BTCUSDT --timeframe 1m \
        --since '2026-04-07T00:00:00Z'
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover
    print(
        "ERROR: psycopg not installed. Run inside the control-plane container:\n"
        "  docker exec -i control-plane python3 /workspace/scripts/alpha_lab_mean_reversion.py ...",
        file=sys.stderr,
    )
    sys.exit(2)


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = REPO_ROOT / "logs" / "alpha_lab_mean_reversion.jsonl"
DEFAULT_DB_SECRET = REPO_ROOT / "secrets" / "database_url"


def _read_db_url() -> str:
    env = os.environ.get("DATABASE_URL")
    if env:
        return env
    if DEFAULT_DB_SECRET.exists():
        return DEFAULT_DB_SECRET.read_text(encoding="utf-8").strip()
    raise SystemExit(
        "ERROR: DATABASE_URL not set and secrets/database_url not found."
    )


def _parse_iso(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _fetch_candles(
    conn, venue: str, instrument: str, timeframe: str, since: datetime,
    *, source_table: str = "market_ohlcv",
) -> list[dict[str, Any]]:
    if source_table == "market_ohlcv_clean":
        tf_seconds = {"1m": 60, "5m": 300, "1h": 3600, "30s": 30}.get(timeframe)
        if tf_seconds is None:
            raise ValueError(f"Unsupported timeframe for clean table: {timeframe}")
        sql = (
            "SELECT bucket_start, open, high, low, close, volume "
            "FROM market_ohlcv_clean "
            "WHERE venue = %s AND instrument = %s AND timeframe_sec = %s "
            "  AND bucket_start >= %s "
            "ORDER BY bucket_start ASC"
        )
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, (venue, instrument, tf_seconds, since))
            return list(cur.fetchall())
    sql = """
        SELECT bucket_start, open, high, low, close, volume
          FROM market_ohlcv
         WHERE venue = %s AND instrument = %s AND timeframe = %s
           AND bucket_start >= %s
         ORDER BY bucket_start ASC
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, (venue, instrument, timeframe, since))
        return list(cur.fetchall())


def _classify(pnl_bps: float, neutral_band_bps: float) -> str:
    if pnl_bps >= neutral_band_bps:
        return "win"
    if pnl_bps <= -neutral_band_bps:
        return "loss"
    return "neutral"


def simulate(
    candles: list[dict[str, Any]],
    *,
    venue: str,
    instrument: str,
    timeframe: str,
    sma_window: int,
    dev_pct: float,
    sl_mult: float,
    horizon: int,
    cooldown: int,
    fee_bps: float,
    neutral_band_bps: float,
) -> list[dict[str, Any]]:
    n = len(candles)
    if n < sma_window + horizon + 2:
        return []

    closes = [float(c["close"]) for c in candles]
    # Rolling SMA: sma[t] uses closes[t - sma_window + 1 .. t]
    sma: list[float | None] = [None] * n
    running = sum(closes[:sma_window])
    sma[sma_window - 1] = running / sma_window
    for t in range(sma_window, n):
        running += closes[t] - closes[t - sma_window]
        sma[t] = running / sma_window

    trades: list[dict[str, Any]] = []
    next_eligible = sma_window  # earliest signal bar index
    t = sma_window
    while t < n - horizon - 2:
        if t < next_eligible:
            t += 1
            continue
        sma_t = sma[t]
        if sma_t is None or sma_t <= 0:
            t += 1
            continue
        deviation = (closes[t] - sma_t) / sma_t
        threshold = dev_pct / 100.0  # dev_pct is expressed in PERCENT
        side: str | None = None
        if deviation <= -threshold:
            side = "long"
        elif deviation >= threshold:
            side = "short"
        if side is None:
            t += 1
            continue

        entry_idx = t + 1
        entry_price = float(candles[entry_idx]["open"])
        target = sma_t  # take-profit at SMA level captured at signal bar
        distance = abs(entry_price - target)
        if distance <= 0:
            t += 1
            continue
        if side == "long":
            sl_price = entry_price - sl_mult * distance
        else:
            sl_price = entry_price + sl_mult * distance

        exit_idx: int | None = None
        exit_price: float | None = None
        exit_reason: str | None = None
        last_idx = min(entry_idx + horizon, n - 1)
        for k in range(entry_idx + 1, last_idx + 1):
            high_k = float(candles[k]["high"])
            low_k = float(candles[k]["low"])
            if side == "long":
                hit_tp = high_k >= target
                hit_sl = low_k <= sl_price
            else:
                hit_tp = low_k <= target
                hit_sl = high_k >= sl_price
            if hit_tp and hit_sl:
                # Conservative tie-break: assume SL fired first.
                exit_idx, exit_price, exit_reason = k, sl_price, "sl"
                break
            if hit_tp:
                exit_idx, exit_price, exit_reason = k, target, "tp"
                break
            if hit_sl:
                exit_idx, exit_price, exit_reason = k, sl_price, "sl"
                break
        if exit_idx is None:
            exit_idx = last_idx
            exit_price = float(candles[last_idx]["close"])
            exit_reason = "timeout"

        sign = 1.0 if side == "long" else -1.0
        gross_bps = sign * ((exit_price - entry_price) / entry_price) * 10_000.0
        pnl_bps = gross_bps - 2.0 * fee_bps  # entry + exit fees
        outcome = _classify(pnl_bps, neutral_band_bps)
        trades.append(
            {
                "venue": venue,
                "instrument": instrument,
                "timeframe": timeframe,
                "side": side,
                "entry_time": candles[entry_idx]["bucket_start"]
                .astimezone(timezone.utc)
                .isoformat(),
                "entry_price": entry_price,
                "exit_time": candles[exit_idx]["bucket_start"]
                .astimezone(timezone.utc)
                .isoformat(),
                "exit_price": exit_price,
                "exit_reason": exit_reason,
                "sma_at_signal": sma_t,
                "deviation_pct_at_signal": deviation * 100.0,
                "horizon_bars": horizon,
                "bars_held": exit_idx - entry_idx,
                "fee_bps_per_side": fee_bps,
                "pnl_bps": pnl_bps,
                "outcome": outcome,
            }
        )
        next_eligible = exit_idx + cooldown
        t = exit_idx + 1
    return trades


def _summary(trades: list[dict[str, Any]]) -> dict[str, Any]:
    if not trades:
        return {"trades": 0}
    pnls = [t["pnl_bps"] for t in trades]
    wins = sum(1 for t in trades if t["outcome"] == "win")
    losses = sum(1 for t in trades if t["outcome"] == "loss")
    neutrals = sum(1 for t in trades if t["outcome"] == "neutral")
    longs = [t for t in trades if t["side"] == "long"]
    shorts = [t for t in trades if t["side"] == "short"]
    by_reason: dict[str, int] = {}
    for t in trades:
        by_reason[t["exit_reason"]] = by_reason.get(t["exit_reason"], 0) + 1
    return {
        "trades": len(trades),
        "wins": wins,
        "losses": losses,
        "neutrals": neutrals,
        "winrate_pct": round(100.0 * wins / len(trades), 2),
        "mean_pnl_bps": round(statistics.fmean(pnls), 3),
        "median_pnl_bps": round(statistics.median(pnls), 3),
        "stdev_pnl_bps": round(statistics.pstdev(pnls), 3) if len(pnls) > 1 else 0.0,
        "min_pnl_bps": round(min(pnls), 3),
        "max_pnl_bps": round(max(pnls), 3),
        "longs": len(longs),
        "shorts": len(shorts),
        "by_exit_reason": by_reason,
        "first_entry": trades[0]["entry_time"],
        "last_entry": trades[-1]["entry_time"],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--venue", default="coinbase-public",
                    help="market_ohlcv venue (default: coinbase-public, deepest history)")
    ap.add_argument("--instrument", default="BTCUSDT")
    ap.add_argument("--timeframe", default="1m", choices=["30s", "1m", "5m", "1h"])
    ap.add_argument("--source-table", default="market_ohlcv",
                    choices=["market_ohlcv", "market_ohlcv_clean"],
                    help="OHLCV source. `market_ohlcv_clean` reads candles rebuilt from raw trades.")
    ap.add_argument("--since", default="2026-04-07T00:00:00Z",
                    help="ISO8601; earliest bucket_start to include")
    ap.add_argument("--sma-window", type=int, default=20,
                    help="rolling SMA window in bars (default 20)")
    ap.add_argument("--dev-pct", type=float, default=0.30,
                    help="deviation threshold in PERCENT (default 0.30 = 30bps)")
    ap.add_argument("--sl-mult", type=float, default=1.5,
                    help="stop-loss multiple of |entry - sma| (default 1.5)")
    ap.add_argument("--horizon", type=int, default=60,
                    help="max bars to hold before timeout exit (default 60)")
    ap.add_argument("--cooldown", type=int, default=5,
                    help="bars to wait after exit before next signal (default 5)")
    ap.add_argument("--fee-bps", type=float, default=2.0,
                    help="per-side fee in bps (default 2.0)")
    ap.add_argument("--neutral-band-bps", type=float, default=5.0,
                    help="|pnl| below this is neutral (default 5)")
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT),
                    help="JSONL output path (overwritten each run)")
    ap.add_argument("--dry-run", action="store_true",
                    help="do not write JSONL, just print summary")
    args = ap.parse_args()

    since = _parse_iso(args.since)
    db_url = _read_db_url()

    print(
        f"[alpha-lab/mean-reversion] source={args.source_table} venue={args.venue} "
        f"instrument={args.instrument} tf={args.timeframe} since={since.isoformat()} "
        f"sma={args.sma_window} dev={args.dev_pct}% sl_mult={args.sl_mult} "
        f"horizon={args.horizon}b cooldown={args.cooldown}b fee={args.fee_bps}bps/side",
        file=sys.stderr,
    )

    with psycopg.connect(db_url) as conn:
        candles = _fetch_candles(conn, args.venue, args.instrument, args.timeframe, since,
                                  source_table=args.source_table)

    print(f"[alpha-lab/mean-reversion] candles_loaded={len(candles)}", file=sys.stderr)
    if not candles:
        print(json.dumps({"trades": 0, "reason": "no_candles"}, indent=2))
        return 0

    trades = simulate(
        candles,
        venue=args.venue,
        instrument=args.instrument,
        timeframe=args.timeframe,
        sma_window=args.sma_window,
        dev_pct=args.dev_pct,
        sl_mult=args.sl_mult,
        horizon=args.horizon,
        cooldown=args.cooldown,
        fee_bps=args.fee_bps,
        neutral_band_bps=args.neutral_band_bps,
    )

    summary = _summary(trades)
    print(json.dumps(summary, indent=2, default=str))

    if not args.dry_run and trades:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("w", encoding="utf-8") as fh:
            for t in trades:
                fh.write(json.dumps(t, default=str) + "\n")
        print(f"[alpha-lab/mean-reversion] wrote {len(trades)} trades -> {out_path}",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
