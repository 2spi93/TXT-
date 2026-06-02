#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


def _to_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:
        return None


def _fetch_json(base_url: str, path: str, params: dict[str, Any] | None = None, timeout: float = 10.0) -> dict[str, Any]:
    query = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None})
    url = f"{base_url.rstrip('/')}{path}"
    if query:
        url = f"{url}?{query}"
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    if len(values) == 1:
        return round(values[0], 6)
    ordered = sorted(values)
    rank = (len(ordered) - 1) * percentile
    lower = int(math.floor(rank))
    upper = int(math.ceil(rank))
    if lower == upper:
        return round(ordered[lower], 6)
    weight = rank - lower
    return round(ordered[lower] * (1.0 - weight) + ordered[upper] * weight, 6)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _load_policy_max_slippage_bps(risk_gateway_url: str) -> float | None:
    try:
        payload = _fetch_json(risk_gateway_url, "/v1/policies")
    except Exception:
        return None
    return _to_float(payload.get("max_slippage_bps")) if isinstance(payload, dict) else None


def _collect_sample(*, execution_router_url: str, market_data_url: str, mt5_bridge_url: str, account_id: str, symbol: str, market_symbol: str) -> dict[str, Any]:
    observed_at = _utc_now().isoformat()
    route_payload = _fetch_json(execution_router_url, "/v1/routes/score", params={"symbol": market_symbol})
    best = route_payload.get("best") if isinstance(route_payload.get("best"), dict) else {}

    try:
        session_payload = _fetch_json(market_data_url, "/v1/market/session-state", params={"instrument": market_symbol})
    except Exception as exc:
        session_payload = {"session": "unknown", "source": f"session_fetch_error:{type(exc).__name__}"}

    try:
        account_payload = _fetch_json(mt5_bridge_url, f"/v1/accounts/{account_id}/normalized-state")
        account = account_payload.get("account") if isinstance(account_payload.get("account"), dict) else {}
    except Exception as exc:
        account = {"status": f"account_fetch_error:{type(exc).__name__}"}

    bid = _to_float(best.get("best_bid"))
    ask = _to_float(best.get("best_ask"))
    midpoint = ((bid + ask) / 2.0) if bid and ask and bid > 0 and ask > 0 else None
    spread_absolute = (ask - bid) if bid is not None and ask is not None else None
    spread_bps = _to_float(best.get("spread_bps"))
    if spread_bps is None and midpoint and spread_absolute is not None and midpoint > 0:
        spread_bps = spread_absolute / midpoint * 10000.0

    return {
        "observed_at": observed_at,
        "account_id": account_id,
        "symbol": symbol,
        "market_symbol": market_symbol,
        "session": str(session_payload.get("session") or "unknown"),
        "session_source": str(session_payload.get("source") or "unknown"),
        "spread_bps": round(spread_bps, 6) if spread_bps is not None else None,
        "spread_absolute": round(spread_absolute, 8) if spread_absolute is not None else None,
        "bid": round(bid, 8) if bid is not None else None,
        "ask": round(ask, 8) if ask is not None else None,
        "venue": str(best.get("venue") or ""),
        "freshness_ms": _to_float(best.get("freshness_ms")),
        "quote_age_ms": _to_float(best.get("quote_age_ms")),
        "available_depth_usd": _to_float(best.get("available_depth_usd")),
        "account_status": str(account.get("status") or "unknown"),
        "account_mode": str(account.get("mode") or "unknown"),
    }


def _summarize(samples: list[dict[str, Any]], *, account_id: str, symbol: str, market_symbol: str, duration_hours: float, interval_seconds: float, policy_max_slippage_bps: float | None) -> dict[str, Any]:
    spread_values = [float(sample["spread_bps"]) for sample in samples if sample.get("spread_bps") is not None]
    sessions = Counter(str(sample.get("session") or "unknown") for sample in samples)
    venues = Counter(str(sample.get("venue") or "") for sample in samples if str(sample.get("venue") or ""))
    by_session: dict[str, dict[str, Any]] = defaultdict(dict)

    for session_name in sessions:
        session_values = [float(sample["spread_bps"]) for sample in samples if str(sample.get("session") or "unknown") == session_name and sample.get("spread_bps") is not None]
        by_session[session_name] = {
            "samples": len(session_values),
            "p50_spread_bps": _percentile(session_values, 0.50),
            "p90_spread_bps": _percentile(session_values, 0.90),
            "p95_spread_bps": _percentile(session_values, 0.95),
            "hit_rate_le_25_bps_pct": round((sum(1 for value in session_values if value <= 25.0) / len(session_values)) * 100.0, 4) if session_values else None,
        }

    return {
        "generated_at": _utc_now().isoformat(),
        "account_id": account_id,
        "symbol": symbol,
        "market_symbol": market_symbol,
        "duration_hours": duration_hours,
        "interval_seconds": interval_seconds,
        "sample_count": len(samples),
        "policy_max_slippage_bps": policy_max_slippage_bps,
        "spread_gate_note": "Current risk-gateway MT5 spread gate compares request.max_spread_bps to policy.max_slippage_bps; this audit measures observed market spread independently.",
        "p50_spread_bps": _percentile(spread_values, 0.50),
        "p75_spread_bps": _percentile(spread_values, 0.75),
        "p90_spread_bps": _percentile(spread_values, 0.90),
        "p95_spread_bps": _percentile(spread_values, 0.95),
        "p99_spread_bps": _percentile(spread_values, 0.99),
        "max_spread_bps": round(max(spread_values), 6) if spread_values else None,
        "hit_rate_le_25_bps_pct": round((sum(1 for value in spread_values if value <= 25.0) / len(spread_values)) * 100.0, 4) if spread_values else None,
        "hit_rate_le_30_bps_pct": round((sum(1 for value in spread_values if value <= 30.0) / len(spread_values)) * 100.0, 4) if spread_values else None,
        "hit_rate_le_40_bps_pct": round((sum(1 for value in spread_values if value <= 40.0) / len(spread_values)) * 100.0, 4) if spread_values else None,
        "sessions": dict(sessions),
        "venues": dict(venues),
        "by_session": dict(by_session),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit observed BTC/MT5 spread distribution over time.")
    parser.add_argument("--account-id", default=os.getenv("ACCOUNT_ID", "541283177"))
    parser.add_argument("--symbol", default=os.getenv("SYMBOL", "BTCUSD"))
    parser.add_argument("--market-symbol", default=os.getenv("MARKET_SYMBOL", "BTCUSDT"))
    parser.add_argument("--duration-hours", type=float, default=float(os.getenv("DURATION_HOURS", "24")))
    parser.add_argument("--interval-seconds", type=float, default=float(os.getenv("INTERVAL_SECONDS", "60")))
    parser.add_argument("--max-samples", type=int, default=int(os.getenv("MAX_SAMPLES", "0")))
    parser.add_argument("--output-dir", default=os.getenv("OUTPUT_DIR", "/workspace/logs/spread_audit"))
    parser.add_argument("--execution-router-url", default=os.getenv("EXECUTION_ROUTER_URL", "http://execution-router:8002"))
    parser.add_argument("--market-data-url", default=os.getenv("MARKET_DATA_URL", "http://market-data:8004"))
    parser.add_argument("--mt5-bridge-url", default=os.getenv("MT5_BRIDGE_URL", "http://mt5-bridge:8006"))
    parser.add_argument("--risk-gateway-url", default=os.getenv("RISK_GATEWAY_URL", "http://risk-gateway:8001"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    run_id = _utc_now().strftime("%Y%m%dT%H%M%SZ")
    jsonl_path = output_dir / f"mt5_spread_audit_{args.symbol}_{run_id}.jsonl"
    summary_path = output_dir / f"mt5_spread_audit_{args.symbol}_{run_id}.summary.json"
    policy_max_slippage_bps = _load_policy_max_slippage_bps(args.risk_gateway_url)
    started_at = _utc_now()
    deadline = started_at + timedelta(hours=max(0.0, args.duration_hours))
    samples: list[dict[str, Any]] = []
    sample_index = 0

    try:
        while True:
            sample = _collect_sample(
                execution_router_url=args.execution_router_url,
                market_data_url=args.market_data_url,
                mt5_bridge_url=args.mt5_bridge_url,
                account_id=args.account_id,
                symbol=args.symbol,
                market_symbol=args.market_symbol,
            )
            samples.append(sample)
            with jsonl_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(sample, ensure_ascii=True) + "\n")
            print(json.dumps(sample, ensure_ascii=True), flush=True)
            sample_index += 1
            if args.max_samples > 0 and sample_index >= args.max_samples:
                break
            if _utc_now() >= deadline:
                break
            if args.interval_seconds > 0:
                time.sleep(args.interval_seconds)
    except KeyboardInterrupt:
        pass

    summary = _summarize(
        samples,
        account_id=args.account_id,
        symbol=args.symbol,
        market_symbol=args.market_symbol,
        duration_hours=args.duration_hours,
        interval_seconds=args.interval_seconds,
        policy_max_slippage_bps=policy_max_slippage_bps,
    )
    with summary_path.open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2, ensure_ascii=True)
        handle.write("\n")
    print(json.dumps({"jsonl_path": str(jsonl_path), "summary_path": str(summary_path), "summary": summary}, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())