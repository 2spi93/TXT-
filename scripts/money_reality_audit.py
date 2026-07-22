#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


DEFAULT_LABELS = Path("logs/intent_outcome_labels.jsonl")
PUBLIC_VENUE_SUFFIX = "-public"


def parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def load_rows(path: Path, *, since: datetime | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        row_time = parse_time(row.get("ts_fill_final") or row.get("ts_intent") or row.get("labeled_at"))
        if since is not None and (row_time is None or row_time < since):
            continue
        rows.append(row)
    return rows


def is_real_money(row: dict[str, Any]) -> bool:
    venue = str(row.get("venue") or "").strip().lower()
    requested_notional = float(row.get("requested_notional_usd") or 0.0)
    strategy_id = row.get("strategy_id")
    portfolio_id = row.get("portfolio_id")
    if venue.endswith(PUBLIC_VENUE_SUFFIX):
        return False
    if requested_notional <= 0.0:
        return False
    return bool(strategy_id or portfolio_id)


def pnl_value(row: dict[str, Any]) -> float | None:
    value = row.get("pnl_usd_5m")
    if value is None:
        value = row.get("pnl_usd_1h")
    if value is None:
        return None
    return float(value)


def max_drawdown(values: list[float]) -> float:
    equity = 0.0
    peak = 0.0
    max_dd = 0.0
    for value in values:
        equity += value
        peak = max(peak, equity)
        max_dd = max(max_dd, peak - equity)
    return max_dd


def stats(rows: list[dict[str, Any]]) -> dict[str, Any]:
    pnls = [value for row in rows if (value := pnl_value(row)) is not None]
    wins = [value for value in pnls if value > 0]
    losses = [value for value in pnls if value < 0]
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    mean = sum(pnls) / len(pnls) if pnls else 0.0
    variance = sum((value - mean) ** 2 for value in pnls) / len(pnls) if len(pnls) > 1 else 0.0
    stdev = math.sqrt(max(variance, 0.0))
    return {
        "trade_count": len(rows),
        "pnl_sample_count": len(pnls),
        "net_pnl_usd": round(sum(pnls), 8),
        "win_count": len(wins),
        "loss_count": len(losses),
        "win_rate_pct": round((len(wins) / len(pnls)) * 100.0, 4) if pnls else 0.0,
        "expectancy_usd": round(mean, 8),
        "profit_factor": round(gross_profit / gross_loss, 8) if gross_loss > 0 else (round(gross_profit, 8) if gross_profit > 0 else 0.0),
        "sharpe_like": round(mean / stdev, 8) if stdev > 0 else 0.0,
        "max_drawdown_usd": round(max_drawdown(pnls), 8),
    }


def build_audit(rows: list[dict[str, Any]], *, min_real_trades: int = 10) -> dict[str, Any]:
    real_rows = [row for row in rows if is_real_money(row)]
    simulated_rows = [row for row in rows if not is_real_money(row)]
    real_stats = stats(real_rows)
    simulated_stats = stats(simulated_rows)
    real_money_positive = bool(real_stats["pnl_sample_count"] > 0 and real_stats["net_pnl_usd"] > 0)
    money_proven = bool(real_stats["trade_count"] >= min_real_trades and real_money_positive)
    return {
        "money_proven_today": money_proven,
        "real_money_positive": real_money_positive,
        "status": "REAL_MONEY_PROVEN" if money_proven else "REAL_MONEY_NOT_PROVEN",
        "thresholds": {
            "min_real_trades": min_real_trades,
        },
        "real_money": real_stats,
        "simulated_or_public": simulated_stats,
        "classification": {
            "real_money_rows": len(real_rows),
            "simulated_or_public_rows": len(simulated_rows),
            "public_venue_rows": sum(1 for row in rows if str(row.get("venue") or "").lower().endswith(PUBLIC_VENUE_SUFFIX)),
            "zero_requested_notional_rows": sum(1 for row in rows if float(row.get("requested_notional_usd") or 0.0) <= 0.0),
        },
    }


def format_text(audit: dict[str, Any]) -> str:
    real = audit["real_money"]
    sim = audit["simulated_or_public"]
    return (
        "Money Reality: "
        f"status={audit['status']} "
        f"real_trades={real['trade_count']} "
        f"real_net=${real['net_pnl_usd']:.8f} "
        f"sim_trades={sim['trade_count']} "
        f"sim_net=${sim['net_pnl_usd']:.8f} "
        f"sim_win_rate={sim['win_rate_pct']:.2f}% "
        f"sim_expectancy=${sim['expectancy_usd']:.8f} "
        f"sim_profit_factor={sim['profit_factor']:.4f}"
    )


def failed_checks(audit: dict[str, Any], checks: list[str]) -> list[str]:
    failures = []
    real = audit["real_money"]
    for check in checks:
        if check == "real-trades" and real["trade_count"] <= 0:
            failures.append(check)
        elif check == "real-sample" and real["trade_count"] < audit.get("thresholds", {}).get("min_real_trades", 10):
            failures.append(check)
        elif check == "real-money-positive" and not audit["money_proven_today"]:
            failures.append(check)
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit whether TXT proves real money performance from outcome labels.")
    parser.add_argument("labels", nargs="?", default=str(DEFAULT_LABELS))
    parser.add_argument("--hours", type=float, default=24.0)
    parser.add_argument("--min-real-trades", type=int, default=10)
    parser.add_argument("--text", action="store_true")
    parser.add_argument(
        "--check",
        action="append",
        choices=("real-trades", "real-sample", "real-money-positive"),
        default=[],
        help="return exit code 2 if the requested money gate is not satisfied; can be repeated",
    )
    args = parser.parse_args()

    since = datetime.now(timezone.utc) - timedelta(hours=args.hours) if args.hours > 0 else None
    audit = build_audit(load_rows(Path(args.labels), since=since), min_real_trades=args.min_real_trades)
    if args.text:
        print(format_text(audit))
    else:
        print(json.dumps(audit, ensure_ascii=True, sort_keys=True))
    failures = failed_checks(audit, args.check)
    if failures:
        print(f"failed_checks={','.join(failures)}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
