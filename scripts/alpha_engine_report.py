#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from money_reality_audit import DEFAULT_LABELS, is_real_money, load_rows, pnl_value


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except Exception:
        return default


def max_drawdown(values: list[float]) -> float:
    equity = 0.0
    peak = 0.0
    max_dd = 0.0
    for value in values:
        equity += value
        peak = max(peak, equity)
        max_dd = max(max_dd, peak - equity)
    return max_dd


def alpha_metrics(rows: list[dict[str, Any]], *, capital_usd: float = 0.0) -> dict[str, Any]:
    pnls = [value for row in rows if (value := pnl_value(row)) is not None]
    wins = [value for value in pnls if value > 0]
    losses = [value for value in pnls if value < 0]
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    net_pnl = sum(pnls)
    mean = net_pnl / len(pnls) if pnls else 0.0
    variance = sum((value - mean) ** 2 for value in pnls) / len(pnls) if len(pnls) > 1 else 0.0
    stdev = math.sqrt(max(variance, 0.0))
    requested_notional = sum(_safe_float(row.get("requested_notional_usd")) for row in rows)
    denominator = capital_usd if capital_usd > 0 else requested_notional
    return {
        "trade_count": len(rows),
        "pnl_sample_count": len(pnls),
        "net_pnl_usd": round(net_pnl, 8),
        "gross_profit_usd": round(gross_profit, 8),
        "gross_loss_usd": round(gross_loss, 8),
        "profit_factor": round(gross_profit / gross_loss, 8) if gross_loss > 0 else (round(gross_profit, 8) if gross_profit > 0 else 0.0),
        "expectancy_usd": round(mean, 8),
        "hit_rate_pct": round((len(wins) / len(pnls)) * 100.0, 4) if pnls else 0.0,
        "sharpe_like": round(mean / stdev, 8) if stdev > 0 else 0.0,
        "max_drawdown_usd": round(max_drawdown(pnls), 8),
        "requested_notional_usd": round(requested_notional, 8),
        "return_on_capital_pct": round((net_pnl / denominator) * 100.0, 8) if denominator > 0 else None,
        "capital_basis": "capital_usd" if capital_usd > 0 else "sum_requested_notional_usd",
    }


def build_report(
    rows: list[dict[str, Any]],
    *,
    days: float = 30.0,
    min_trades: int = 50,
    min_profit_factor: float = 1.0,
    min_expectancy_usd: float = 0.0,
    max_drawdown_usd: float | None = None,
    capital_usd: float = 0.0,
) -> dict[str, Any]:
    real_rows = [row for row in rows if is_real_money(row)]
    excluded_rows = [row for row in rows if not is_real_money(row)]
    metrics = alpha_metrics(real_rows, capital_usd=capital_usd)
    checks = {
        "real_trade_sample": metrics["trade_count"] >= min_trades,
        "profit_factor_gt_threshold": metrics["profit_factor"] > min_profit_factor,
        "expectancy_gt_threshold": metrics["expectancy_usd"] > min_expectancy_usd,
        "drawdown_controlled": True if max_drawdown_usd is None else metrics["max_drawdown_usd"] <= max_drawdown_usd,
    }
    alpha_candidate = all(checks.values())
    return {
        "status": "ALPHA_CANDIDATE" if alpha_candidate else "ALPHA_NOT_PROVEN",
        "window_days": days,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "thresholds": {
            "min_trades": min_trades,
            "min_profit_factor": min_profit_factor,
            "min_expectancy_usd": min_expectancy_usd,
            "max_drawdown_usd": max_drawdown_usd,
            "capital_usd": capital_usd,
        },
        "checks": checks,
        "real_money": metrics,
        "excluded": {
            "simulated_or_public_rows": len(excluded_rows),
            "public_venue_rows": sum(1 for row in excluded_rows if str(row.get("venue") or "").lower().endswith("-public")),
            "zero_requested_notional_rows": sum(1 for row in excluded_rows if _safe_float(row.get("requested_notional_usd")) <= 0.0),
        },
        "benchmark": {
            "status": "NOT_EVALUATED",
            "note": "Alpha validation requires benchmark return over the same real trading window.",
        },
    }


def format_text(report: dict[str, Any]) -> str:
    real = report["real_money"]
    missing = [name for name, ok in report["checks"].items() if not ok]
    roc = real["return_on_capital_pct"]
    roc_text = "n/a" if roc is None else f"{roc:.6f}%"
    return (
        "Alpha Engine 30D: "
        f"status={report['status']} "
        f"real_trades={real['trade_count']} "
        f"net=${real['net_pnl_usd']:.8f} "
        f"pf={real['profit_factor']:.4f} "
        f"expectancy=${real['expectancy_usd']:.8f} "
        f"hit_rate={real['hit_rate_pct']:.2f}% "
        f"drawdown=${real['max_drawdown_usd']:.8f} "
        f"roc={roc_text} "
        f"missing={','.join(missing) if missing else 'none'}"
    )


def failed_checks(report: dict[str, Any], checks: list[str]) -> list[str]:
    mapping = {
        "sample": "real_trade_sample",
        "profit-factor": "profit_factor_gt_threshold",
        "expectancy": "expectancy_gt_threshold",
        "drawdown": "drawdown_controlled",
        "alpha": None,
    }
    failures = []
    for check in checks:
        key = mapping[check]
        if key is None:
            if report["status"] != "ALPHA_CANDIDATE":
                failures.append(check)
        elif not report["checks"].get(key):
            failures.append(check)
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="Report Alpha Engine performance from recent real-money outcome labels.")
    parser.add_argument("labels", nargs="?", default=str(DEFAULT_LABELS))
    parser.add_argument("--days", type=float, default=30.0)
    parser.add_argument("--min-trades", type=int, default=50)
    parser.add_argument("--min-profit-factor", type=float, default=1.0)
    parser.add_argument("--min-expectancy-usd", type=float, default=0.0)
    parser.add_argument("--max-drawdown-usd", type=float)
    parser.add_argument("--capital-usd", type=float, default=0.0)
    parser.add_argument("--text", action="store_true")
    parser.add_argument(
        "--check",
        action="append",
        choices=("sample", "profit-factor", "expectancy", "drawdown", "alpha"),
        default=[],
        help="return exit code 2 if the requested Alpha Engine gate is not satisfied; can be repeated",
    )
    args = parser.parse_args()

    since = datetime.now(timezone.utc) - timedelta(days=args.days) if args.days > 0 else None
    report = build_report(
        load_rows(Path(args.labels), since=since),
        days=args.days,
        min_trades=args.min_trades,
        min_profit_factor=args.min_profit_factor,
        min_expectancy_usd=args.min_expectancy_usd,
        max_drawdown_usd=args.max_drawdown_usd,
        capital_usd=args.capital_usd,
    )
    if args.text:
        print(format_text(report))
    else:
        print(json.dumps(report, ensure_ascii=True, sort_keys=True))
    failures = failed_checks(report, args.check)
    if failures:
        print(f"failed_checks={','.join(failures)}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
