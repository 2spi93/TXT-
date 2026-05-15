#!/usr/bin/env python3
"""Offline alpha-lab: Microstructure / Trade Flow Imbalance (TFI).

Strictly read-only against `market_trades`. NO writes, NO runtime hook,
NO `/brain/learn` call, NO threshold mutation.

Hypothesis (single, fixed; NO parameter optimization):
    Aggressive trade flow imbalance over a short look-back window
    L predicts the direction of the close-to-close return over the
    next horizon H seconds.

    imbalance(t) = (buy_vol[t-L:t] - sell_vol[t-L:t])
                 / (buy_vol[t-L:t] + sell_vol[t-L:t])

Signal (decided at the end of bucket t, executed at start of t+1):
    if imbalance(t) >=  +threshold -> LONG  at vwap[t+1]
    if imbalance(t) <=  -threshold -> SHORT at vwap[t+1]

Exit:
    flat at vwap of bucket (t + 1 + horizon_buckets).
    No intra-horizon TP/SL: this isolates the directional edge of the
    raw flow signal without execution-policy contamination.

Cooldown: after exit, no new signal for `cooldown` buckets.

Outcome (default neutral_band_bps=5, same convention as labeler):
    pnl_bps >=  +5  -> "win"
    pnl_bps <=  -5  -> "loss"
    otherwise       -> "neutral"

Output (JSONL):
    venue, instrument, side, entry_time, entry_price, exit_time,
    exit_price, imbalance, buy_vol, sell_vol, total_vol,
    bucket_seconds, lookback_buckets, horizon_buckets,
    fee_bps_per_side, pnl_bps, outcome

Run inside control-plane:
    docker exec -i control-plane python3 /workspace/scripts/alpha_lab_microstructure.py \
        --venue binance-public --instrument BTCUSDT
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
        "ERROR: psycopg not installed. Run inside control-plane:\n"
        "  docker exec -i control-plane python3 /workspace/scripts/alpha_lab_microstructure.py ...",
        file=sys.stderr,
    )
    sys.exit(2)


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = REPO_ROOT / "logs" / "alpha_lab_microstructure.jsonl"
DEFAULT_DB_SECRET = REPO_ROOT / "secrets" / "database_url"


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


def _fetch_buckets(
    conn,
    *,
    venue: str,
    instrument: str,
    bucket_seconds: int,
    since: datetime,
) -> list[dict[str, Any]]:
    """Aggregate market_trades into fixed-width time buckets.

    Returns ordered list of dicts:
        bucket_start (datetime), buy_vol, sell_vol, total_vol,
        notional, vwap (notional/total_vol), n_trades.
    """
    sql = """
        SELECT
            to_timestamp(floor(extract(epoch FROM traded_at) / %s) * %s)
                AT TIME ZONE 'UTC'                                  AS bucket_start,
            SUM(CASE WHEN lower(side) = 'buy'  THEN size ELSE 0 END) AS buy_vol,
            SUM(CASE WHEN lower(side) = 'sell' THEN size ELSE 0 END) AS sell_vol,
            SUM(size)                                                 AS total_vol,
            SUM(price * size)                                         AS notional,
            COUNT(*)                                                  AS n_trades
          FROM market_trades
         WHERE venue = %s AND instrument = %s
           AND traded_at >= %s
           AND lower(side) IN ('buy','sell')
         GROUP BY 1
         ORDER BY 1 ASC
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, (bucket_seconds, bucket_seconds, venue, instrument, since))
        rows = list(cur.fetchall())
    out: list[dict[str, Any]] = []
    for r in rows:
        total = float(r["total_vol"] or 0.0)
        if total <= 0:
            continue
        notional = float(r["notional"] or 0.0)
        out.append(
            {
                "bucket_start": r["bucket_start"],
                "buy_vol": float(r["buy_vol"] or 0.0),
                "sell_vol": float(r["sell_vol"] or 0.0),
                "total_vol": total,
                "vwap": notional / total,
                "n_trades": int(r["n_trades"] or 0),
            }
        )
    return out


def _classify(pnl_bps: float, neutral_band_bps: float) -> str:
    if pnl_bps >= neutral_band_bps:
        return "win"
    if pnl_bps <= -neutral_band_bps:
        return "loss"
    return "neutral"


def simulate(
    buckets: list[dict[str, Any]],
    *,
    venue: str,
    instrument: str,
    bucket_seconds: int,
    lookback_buckets: int,
    horizon_buckets: int,
    threshold: float,
    cooldown: int,
    fee_bps: float,
    min_total_vol: float,
    neutral_band_bps: float,
    max_gap_seconds: float,
) -> list[dict[str, Any]]:
    n = len(buckets)
    needed = lookback_buckets + horizon_buckets + 2
    if n < needed:
        return []

    trades_out: list[dict[str, Any]] = []
    next_eligible = lookback_buckets - 1
    t = lookback_buckets - 1
    while t < n - horizon_buckets - 1:
        if t < next_eligible:
            t += 1
            continue
        # Skip if any transition inside the lookback exceeds max_gap_seconds
        # (data cadence is irregular -- prevents stale signal carry-over).
        window = buckets[t - lookback_buckets + 1 : t + 1]
        ok_lookback = True
        for i in range(1, len(window)):
            delta = (window[i]["bucket_start"] - window[i - 1]["bucket_start"]).total_seconds()
            if delta > max_gap_seconds:
                ok_lookback = False
                break
        if not ok_lookback:
            t += 1
            continue
        buy = sum(b["buy_vol"] for b in window)
        sell = sum(b["sell_vol"] for b in window)
        total = buy + sell
        if total < min_total_vol:
            t += 1
            continue
        imbalance = (buy - sell) / total
        side: str | None = None
        if imbalance >= threshold:
            side = "long"
        elif imbalance <= -threshold:
            side = "short"
        if side is None:
            t += 1
            continue

        entry_idx = t + 1
        exit_idx = t + 1 + horizon_buckets
        # Reject the signal if execution path crosses a data gap larger
        # than max_gap_seconds (treats long pauses as session breaks).
        path = buckets[t : exit_idx + 1]
        ok = True
        for i in range(1, len(path)):
            delta = (path[i]["bucket_start"] - path[i - 1]["bucket_start"]).total_seconds()
            if delta > max_gap_seconds:
                ok = False
                break
        if not ok:
            t += 1
            continue

        entry_price = buckets[entry_idx]["vwap"]
        exit_price = buckets[exit_idx]["vwap"]
        sign = 1.0 if side == "long" else -1.0
        gross_bps = sign * ((exit_price - entry_price) / entry_price) * 10_000.0
        pnl_bps = gross_bps - 2.0 * fee_bps
        outcome = _classify(pnl_bps, neutral_band_bps)
        trades_out.append(
            {
                "venue": venue,
                "instrument": instrument,
                "side": side,
                "entry_time": buckets[entry_idx]["bucket_start"]
                .astimezone(timezone.utc)
                .isoformat(),
                "entry_price": entry_price,
                "exit_time": buckets[exit_idx]["bucket_start"]
                .astimezone(timezone.utc)
                .isoformat(),
                "exit_price": exit_price,
                "imbalance": imbalance,
                "buy_vol": buy,
                "sell_vol": sell,
                "total_vol": total,
                "bucket_seconds": bucket_seconds,
                "lookback_buckets": lookback_buckets,
                "horizon_buckets": horizon_buckets,
                "fee_bps_per_side": fee_bps,
                "pnl_bps": pnl_bps,
                "outcome": outcome,
            }
        )
        next_eligible = exit_idx + cooldown
        t = exit_idx + 1
    return trades_out


def _summary(trades: list[dict[str, Any]]) -> dict[str, Any]:
    if not trades:
        return {"trades": 0}
    pnls = [t["pnl_bps"] for t in trades]
    wins = sum(1 for t in trades if t["outcome"] == "win")
    losses = sum(1 for t in trades if t["outcome"] == "loss")
    neutrals = sum(1 for t in trades if t["outcome"] == "neutral")
    longs = [t for t in trades if t["side"] == "long"]
    shorts = [t for t in trades if t["side"] == "short"]
    long_pnls = [t["pnl_bps"] for t in longs]
    short_pnls = [t["pnl_bps"] for t in shorts]

    def _fmean(xs: list[float]) -> float:
        return round(statistics.fmean(xs), 3) if xs else 0.0

    return {
        "trades": len(trades),
        "wins": wins,
        "losses": losses,
        "neutrals": neutrals,
        "winrate_pct": round(100.0 * wins / len(trades), 2),
        "mean_pnl_bps": _fmean(pnls),
        "median_pnl_bps": round(statistics.median(pnls), 3),
        "stdev_pnl_bps": round(statistics.pstdev(pnls), 3) if len(pnls) > 1 else 0.0,
        "min_pnl_bps": round(min(pnls), 3),
        "max_pnl_bps": round(max(pnls), 3),
        "longs": len(longs),
        "shorts": len(shorts),
        "long_mean_pnl_bps": _fmean(long_pnls),
        "short_mean_pnl_bps": _fmean(short_pnls),
        "first_entry": trades[0]["entry_time"],
        "last_entry": trades[-1]["entry_time"],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--venue", default="binance-public",
                    help="market_trades venue (default: binance-public)")
    ap.add_argument("--instrument", default="BTCUSDT")
    ap.add_argument("--since", default=None,
                    help="ISO8601; default = now - 24h (full coverage)")
    ap.add_argument("--bucket-seconds", type=int, default=60,
                    help="aggregation bucket size in seconds (default 60)")
    ap.add_argument("--lookback-buckets", type=int, default=1,
                    help="lookback window in buckets (default 1 = single bucket TFI)")
    ap.add_argument("--horizon-buckets", type=int, default=1,
                    help="forward horizon in buckets (default 1 = next bucket VWAP)")
    ap.add_argument("--threshold", type=float, default=0.20,
                    help="imbalance threshold (default 0.20)")
    ap.add_argument("--cooldown", type=int, default=1,
                    help="cooldown buckets after exit (default 1)")
    ap.add_argument("--max-gap-seconds", type=float, default=None,
                    help="max allowed gap between adjacent buckets (default = 5 * bucket_seconds)")
    ap.add_argument("--fee-bps", type=float, default=2.0,
                    help="per-side fee in bps (default 2.0)")
    ap.add_argument("--min-total-vol", type=float, default=0.0,
                    help="skip windows with total_vol < threshold (default 0)")
    ap.add_argument("--neutral-band-bps", type=float, default=5.0,
                    help="|pnl| below this is neutral (default 5)")
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.since:
        since = _parse_iso(args.since)
    else:
        since = datetime.now(timezone.utc) - __import__("datetime").timedelta(hours=24)

    db_url = _read_db_url()

    max_gap = args.max_gap_seconds
    if max_gap is None:
        max_gap = 5.0 * args.bucket_seconds

    print(
        f"[alpha-lab/microstructure] venue={args.venue} instrument={args.instrument} "
        f"since={since.isoformat()} bucket={args.bucket_seconds}s "
        f"lookback={args.lookback_buckets}b horizon={args.horizon_buckets}b "
        f"threshold={args.threshold} cooldown={args.cooldown}b fee={args.fee_bps}bps/side "
        f"min_vol={args.min_total_vol} max_gap={max_gap}s",
        file=sys.stderr,
    )

    with psycopg.connect(db_url) as conn:
        buckets = _fetch_buckets(
            conn,
            venue=args.venue,
            instrument=args.instrument,
            bucket_seconds=args.bucket_seconds,
            since=since,
        )

    print(f"[alpha-lab/microstructure] buckets_loaded={len(buckets)}", file=sys.stderr)
    if not buckets:
        print(json.dumps({"trades": 0, "reason": "no_buckets"}, indent=2))
        return 0

    trades = simulate(
        buckets,
        venue=args.venue,
        instrument=args.instrument,
        bucket_seconds=args.bucket_seconds,
        lookback_buckets=args.lookback_buckets,
        horizon_buckets=args.horizon_buckets,
        threshold=args.threshold,
        cooldown=args.cooldown,
        fee_bps=args.fee_bps,
        min_total_vol=args.min_total_vol,
        neutral_band_bps=args.neutral_band_bps,
        max_gap_seconds=max_gap,
    )

    summary = _summary(trades)
    print(json.dumps(summary, indent=2, default=str))

    if not args.dry_run and trades:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("w", encoding="utf-8") as fh:
            for t in trades:
                fh.write(json.dumps(t, default=str) + "\n")
        print(f"[alpha-lab/microstructure] wrote {len(trades)} trades -> {out_path}",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
