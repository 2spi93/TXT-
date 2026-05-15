#!/usr/bin/env python3
"""Read-only outcome labeler for trading intents.

Joins intents -> orders -> execution_fill_events -> execution_telemetry
-> market_ohlcv to produce one outcome label per filled intent.

Strictly read-only against the DB. Appends to a single new JSONL file
(default: logs/intent_outcome_labels.jsonl). Idempotent: skips intents
whose intent_id already appears in the output file.

Does NOT:
  - mutate intents, orders, decision_outcomes, reality_gap_samples,
    v2 risk journal, KPI files, system_config, or any decision gate
  - call /brain/learn, /v1/outcomes/update, or any POST endpoint
  - change thresholds or promotion scores

Intended execution (DB host is `postgres`, not exposed to host loopback):

    docker exec -i control-plane python3 /workspace/scripts/label_intent_outcomes.py \
        --since '2026-04-15T00:00:00Z' --limit 500

Output schema per line:
    {
      "intent_id", "decision_id", "strategy_id", "portfolio_id",
      "venue", "instrument", "side",
      "ts_intent", "ts_fill_final",
      "requested_notional_usd", "filled_notional_usd", "avg_fill_price",
      "fill_count", "fill_latency_ms_avg",
      "expected_slippage_bps", "realized_slippage_bps",
      "latency_e2e_ms",
      "post_fill_price_5m", "post_fill_price_1h",
      "pnl_usd_5m", "pnl_usd_1h",
      "pnl_bps_5m", "pnl_bps_1h",
      "outcome", "outcome_basis",
      "labeled_at"
    }

Outcome rule (configurable thresholds, defaults):
    |pnl_bps_5m| <  neutral_band_bps (default 5)  -> "neutral"
    pnl_bps_5m >=  neutral_band_bps               -> "win"
    pnl_bps_5m <= -neutral_band_bps               -> "loss"
    If 5m post-fill price unavailable              -> "pending" (not appended)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover
    print(
        "ERROR: psycopg not installed. Run inside the control-plane container:\n"
        "  docker exec -i control-plane python3 /workspace/scripts/label_intent_outcomes.py ...",
        file=sys.stderr,
    )
    raise

REPO_ROOT_CANDIDATES = (Path("/workspace"), Path(__file__).resolve().parent.parent)
REPO_ROOT = next((p for p in REPO_ROOT_CANDIDATES if (p / "shared" / "db.py").exists()), REPO_ROOT_CANDIDATES[-1])
DEFAULT_OUTPUT = REPO_ROOT / "logs" / "intent_outcome_labels.jsonl"


def _read_secret(name: str, default: str = "") -> str:
    fp = os.getenv(f"{name}_FILE", "").strip()
    if fp:
        try:
            with open(fp, "r", encoding="utf-8") as fh:
                v = fh.read().strip()
            if v:
                return v
        except OSError:
            pass
    return os.getenv(name, "").strip() or default


def _database_url() -> str:
    return _read_secret("DATABASE_URL", "postgresql://txt:txt@postgres:5432/mission_control")


def _iso(dt: Any) -> str | None:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return str(dt)


def _load_already_labeled(output_path: Path) -> set[str]:
    labeled: set[str] = set()
    if not output_path.exists():
        return labeled
    with output_path.open("r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            iid = row.get("intent_id")
            if isinstance(iid, str):
                labeled.add(iid)
    return labeled


def _fetch_filled_intents(conn, since: datetime, limit: int) -> list[dict[str, Any]]:
    """Select filled executions anchored on execution_fill_events.

    In this stack, orders.intent_id is typically NULL — intents and fills are
    linked only through telemetry.decision_id. We therefore anchor on
    execution_fill_events (the authoritative fill record) and enrich via
    execution_telemetry and intents when possible.
    """
    sql = """
        WITH agg AS (
            SELECT
                decision_id,
                MIN(venue)                    AS venue,
                MIN(instrument)               AS instrument,
                MIN(side)                     AS side,
                SUM(size_base * price)        AS filled_notional_usd,
                CASE WHEN SUM(size_base) > 0
                     THEN SUM(size_base * price) / SUM(size_base)
                     ELSE NULL END            AS avg_fill_price,
                COUNT(*)                      AS fill_count,
                AVG(fill_latency_ms)::float   AS fill_latency_ms_avg,
                MAX(filled_at)                AS ts_fill_final,
                MIN(filled_at)                AS ts_first_fill
            FROM execution_fill_events
            WHERE filled_at >= %(since)s
            GROUP BY decision_id
        )
        SELECT
            agg.decision_id                   AS intent_id,
            agg.decision_id,
            i.strategy_id,
            i.portfolio_id,
            COALESCE(i.venue, agg.venue)      AS venue,
            COALESCE(i.instrument, agg.instrument) AS instrument,
            COALESCE(i.side, agg.side)        AS side,
            i.target_notional_usd,
            i.max_slippage_bps,
            i.confidence,
            COALESCE(i.created_at, agg.ts_first_fill) AS intent_created_at,
            agg.filled_notional_usd,
            agg.avg_fill_price,
            agg.fill_count,
            agg.fill_latency_ms_avg,
            agg.ts_fill_final,
            t.ts_intent,
            t.expected_slippage_bps,
            t.realized_slippage_bps,
            t.latency_e2e_ms
        FROM agg
        LEFT JOIN execution_telemetry t ON t.decision_id = agg.decision_id
        LEFT JOIN intents              i ON i.intent_id  = agg.decision_id
        WHERE agg.filled_notional_usd > 0
          AND agg.avg_fill_price > 0
        ORDER BY agg.ts_fill_final ASC
        LIMIT %(limit)s
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, {"since": since, "limit": limit})
        return list(cur.fetchall())


def _fetch_post_fill_close(
    conn,
    venue: str,
    instrument: str,
    anchor: datetime,
    horizon: timedelta,
    proxy_map: dict[tuple[str, str], tuple[str, str]] | None = None,
) -> tuple[float, str, datetime, bool] | None:
    """Return (close, timeframe_used, bucket_start, proxy_used) for the first
    candle on or after ``anchor + horizon`` that lies within a tolerated window.

    Tries 1m -> 5m -> 1h on the (venue, instrument) pair. If nothing is found
    and ``proxy_map`` provides a fallback (venue, instrument), retries on the
    proxy and sets ``proxy_used=True``.
    Returns ``None`` if no in-window candle is available.
    """
    target = anchor + horizon
    candidates: list[tuple[str, timedelta]] = [
        ("1m", timedelta(minutes=5)),
        ("5m", timedelta(minutes=15)),
        ("1h", timedelta(hours=1, minutes=30)),
    ]
    sql = """
        SELECT close, bucket_start
        FROM market_ohlcv
        WHERE venue = %(venue)s
          AND instrument = %(instrument)s
          AND timeframe = %(tf)s
          AND bucket_start >= %(target)s
          AND bucket_start <  %(upper)s
        ORDER BY bucket_start ASC
        LIMIT 1
    """

    def _try(v: str, i: str) -> tuple[float, str, datetime] | None:
        with conn.cursor(row_factory=dict_row) as cur:
            for tf, tol in candidates:
                cur.execute(
                    sql,
                    {
                        "venue": v,
                        "instrument": i,
                        "tf": tf,
                        "target": target,
                        "upper": target + tol,
                    },
                )
                row = cur.fetchone()
                if row and row.get("close") is not None:
                    bs = row["bucket_start"]
                    if bs.tzinfo is None:
                        bs = bs.replace(tzinfo=timezone.utc)
                    return float(row["close"]), tf, bs
        return None

    direct = _try(venue, instrument)
    if direct is not None:
        return direct[0], direct[1], direct[2], False

    if proxy_map:
        proxy = proxy_map.get((venue, instrument)) or proxy_map.get((venue, "*")) or proxy_map.get(("*", instrument))
        if proxy:
            via = _try(proxy[0], proxy[1])
            if via is not None:
                return via[0], via[1], via[2], True

    return None


def _pnl(side: str, fill_price: float, exit_price: float, filled_notional_usd: float) -> tuple[float, float]:
    """Return (pnl_usd, pnl_bps) relative to filled notional."""
    if fill_price <= 0 or exit_price <= 0 or filled_notional_usd <= 0:
        return 0.0, 0.0
    direction = 1.0 if side.lower() in ("buy", "long") else -1.0
    move_frac = (exit_price - fill_price) / fill_price
    pnl_usd = direction * move_frac * filled_notional_usd
    pnl_bps = direction * move_frac * 10_000.0
    return pnl_usd, pnl_bps


def _classify(pnl_bps_5m: float, neutral_band_bps: float) -> str:
    if pnl_bps_5m >= neutral_band_bps:
        return "win"
    if pnl_bps_5m <= -neutral_band_bps:
        return "loss"
    return "neutral"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--since",
        type=str,
        default=(datetime.now(timezone.utc) - timedelta(days=7)).isoformat().replace("+00:00", "Z"),
        help="ISO-8601 lower bound on intents.created_at (default: 7 days ago).",
    )
    parser.add_argument("--limit", type=int, default=500, help="Max intents to scan.")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output JSONL path (default: {DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--neutral-band-bps",
        type=float,
        default=5.0,
        help="Classification band in bps (default 5). |pnl_bps_5m| < band -> neutral.",
    )
    parser.add_argument(
        "--min-age-minutes",
        type=float,
        default=60.0,
        help="Skip intents whose fill is more recent than this (default 60). Ensures 1h window is closable.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Do not write output; print sample lines.")
    parser.add_argument(
        "--use-proxy-pairs",
        action="store_true",
        help=(
            "When a fill's (venue, instrument) has no candles in window, fall back "
            "to a proxy pair: bingx->bingx-public (futures->spot), and BTCUSD->BTCUSDT "
            "(near-zero tether premium). Each label records `proxy_used=true` and the "
            "proxy source for full auditability."
        ),
    )
    args = parser.parse_args()

    try:
        since_dt = datetime.fromisoformat(args.since.replace("Z", "+00:00"))
    except ValueError:
        print(f"ERROR: invalid --since '{args.since}'", file=sys.stderr)
        return 2
    if since_dt.tzinfo is None:
        since_dt = since_dt.replace(tzinfo=timezone.utc)

    min_fill_cutoff = datetime.now(timezone.utc) - timedelta(minutes=args.min_age_minutes)

    # Aliasing applied at lookup time only; never written back to the DB.
    proxy_map: dict[tuple[str, str], tuple[str, str]] = {}
    if args.use_proxy_pairs:
        proxy_map = {
            ("bingx", "BTCUSDT"): ("bingx-public", "BTCUSDT"),
            ("binance-public", "BTCUSD"): ("binance-public", "BTCUSDT"),
            ("coinbase-public", "BTCUSD"): ("coinbase-public", "BTCUSDT"),
            ("okx-public", "BTCUSD"): ("okx-public", "BTCUSDT"),
        }

    output_path: Path = args.output
    already = _load_already_labeled(output_path) if not args.dry_run else set()

    db_url = _database_url()
    print(
        f"[labeler] since={since_dt.isoformat()} limit={args.limit} "
        f"output={output_path} already_labeled={len(already)} dry_run={args.dry_run}",
        file=sys.stderr,
    )

    try:
        conn = psycopg.connect(db_url, connect_timeout=10)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: cannot connect to DB: {exc}", file=sys.stderr)
        return 3

    written = 0
    skipped_already = 0
    skipped_pending = 0
    skipped_fresh = 0
    sample_lines: list[str] = []

    try:
        with conn:
            candidates = _fetch_filled_intents(conn, since_dt, args.limit)
            print(f"[labeler] candidates={len(candidates)}", file=sys.stderr)

            for row in candidates:
                intent_id = row["intent_id"]
                if intent_id in already:
                    skipped_already += 1
                    continue

                ts_fill_final = row.get("ts_fill_final") or row.get("intent_created_at")
                if ts_fill_final and ts_fill_final.tzinfo is None:
                    ts_fill_final = ts_fill_final.replace(tzinfo=timezone.utc)
                if ts_fill_final and ts_fill_final > min_fill_cutoff:
                    skipped_fresh += 1
                    continue

                fill_price = float(row.get("avg_fill_price") or 0.0)
                filled_notional = float(row.get("filled_notional_usd") or 0.0)
                if fill_price <= 0 or filled_notional <= 0 or ts_fill_final is None:
                    skipped_pending += 1
                    continue

                venue = row["venue"]
                instrument = row["instrument"]
                side = row["side"]

                close_5m_row = _fetch_post_fill_close(
                    conn, venue, instrument, ts_fill_final, timedelta(minutes=5), proxy_map
                )
                close_1h_row = _fetch_post_fill_close(
                    conn, venue, instrument, ts_fill_final, timedelta(hours=1), proxy_map
                )

                if close_5m_row is None:
                    skipped_pending += 1
                    continue

                close_5m, tf_5m, bs_5m, proxy_5m = close_5m_row
                pnl_usd_5m, pnl_bps_5m = _pnl(side, fill_price, close_5m, filled_notional)
                if close_1h_row is not None:
                    close_1h, tf_1h, bs_1h, proxy_1h = close_1h_row
                    pnl_usd_1h, pnl_bps_1h = _pnl(side, fill_price, close_1h, filled_notional)
                else:
                    close_1h = None
                    tf_1h = None
                    bs_1h = None
                    proxy_1h = False
                    pnl_usd_1h, pnl_bps_1h = None, None

                outcome = _classify(pnl_bps_5m, args.neutral_band_bps)
                outcome_basis = (
                    f"pnl_bps_5m={pnl_bps_5m:.2f} vs neutral_band={args.neutral_band_bps:.2f}"
                    f" (tf={tf_5m}{', proxy' if proxy_5m else ''})"
                )

                record = {
                    "intent_id": intent_id,
                    "decision_id": intent_id,
                    "strategy_id": row.get("strategy_id"),
                    "portfolio_id": row.get("portfolio_id"),
                    "venue": venue,
                    "instrument": instrument,
                    "side": side,
                    "ts_intent": _iso(row.get("ts_intent") or row.get("intent_created_at")),
                    "ts_fill_final": _iso(ts_fill_final),
                    "requested_notional_usd": float(row.get("target_notional_usd") or 0.0),
                    "filled_notional_usd": filled_notional,
                    "avg_fill_price": fill_price,
                    "fill_count": int(row.get("fill_count") or 0),
                    "fill_latency_ms_avg": (
                        float(row["fill_latency_ms_avg"])
                        if row.get("fill_latency_ms_avg") is not None
                        else None
                    ),
                    "expected_slippage_bps": (
                        float(row["expected_slippage_bps"])
                        if row.get("expected_slippage_bps") is not None
                        else None
                    ),
                    "realized_slippage_bps": (
                        float(row["realized_slippage_bps"])
                        if row.get("realized_slippage_bps") is not None
                        else None
                    ),
                    "latency_e2e_ms": (
                        int(row["latency_e2e_ms"])
                        if row.get("latency_e2e_ms") is not None
                        else None
                    ),
                    "post_fill_price_5m": close_5m,
                    "post_fill_price_1h": close_1h,
                    "post_fill_tf_5m": tf_5m,
                    "post_fill_tf_1h": tf_1h,
                    "post_fill_bucket_5m": _iso(bs_5m),
                    "post_fill_bucket_1h": _iso(bs_1h),
                    "post_fill_proxy_5m": proxy_5m,
                    "post_fill_proxy_1h": proxy_1h,
                    "pnl_usd_5m": pnl_usd_5m,
                    "pnl_usd_1h": pnl_usd_1h,
                    "pnl_bps_5m": pnl_bps_5m,
                    "pnl_bps_1h": pnl_bps_1h,
                    "outcome": outcome,
                    "outcome_basis": outcome_basis,
                    "neutral_band_bps": args.neutral_band_bps,
                    "labeled_at": _iso(datetime.now(timezone.utc)),
                }
                line = json.dumps(record, ensure_ascii=False, default=str)

                if args.dry_run:
                    if len(sample_lines) < 5:
                        sample_lines.append(line)
                    written += 1
                    continue

                output_path.parent.mkdir(parents=True, exist_ok=True)
                with output_path.open("a", encoding="utf-8") as fh:
                    fh.write(line + "\n")
                already.add(intent_id)
                written += 1
    finally:
        conn.close()

    print(
        f"[labeler] done: written={written} skipped_already={skipped_already} "
        f"skipped_pending={skipped_pending} skipped_fresh={skipped_fresh}",
        file=sys.stderr,
    )
    if args.dry_run:
        for ln in sample_lines:
            print(ln)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
