#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.request
from collections import Counter
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


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _fetch_json(url: str, timeout: float = 15.0) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = (len(ordered) - 1) * percentile
    lower = int(math.floor(rank))
    upper = int(math.ceil(rank))
    if lower == upper:
        return round(ordered[lower], 6)
    weight = rank - lower
    return round(ordered[lower] * (1.0 - weight) + ordered[upper] * weight, 6)


def _find_first_numeric(payload: Any, keys: tuple[str, ...]) -> float | None:
    if isinstance(payload, dict):
        for key in keys:
            if key in payload:
                value = _to_float(payload.get(key))
                if value is not None:
                    return value
        for value in payload.values():
            found = _find_first_numeric(value, keys)
            if found is not None:
                return found
    elif isinstance(payload, list):
        for item in payload:
            found = _find_first_numeric(item, keys)
            if found is not None:
                return found
    return None


def _find_first_string(payload: Any, keys: tuple[str, ...]) -> str | None:
    if isinstance(payload, dict):
        for key in keys:
            if key in payload:
                value = str(payload.get(key) or "").strip()
                if value:
                    return value
        for value in payload.values():
            found = _find_first_string(value, keys)
            if found:
                return found
    elif isinstance(payload, list):
        for item in payload:
            found = _find_first_string(item, keys)
            if found:
                return found
    return None


def _extract_quote_fields(payload: dict[str, Any]) -> dict[str, Any]:
    bid = _find_first_numeric(payload, ("bid", "best_bid", "bid_price", "bid1", "bid1Price"))
    ask = _find_first_numeric(payload, ("ask", "best_ask", "ask_price", "ask1", "ask1Price"))
    spread_bps = _find_first_numeric(payload, ("spread_bps", "spreadBps"))
    spread_absolute = _find_first_numeric(payload, ("spread", "spread_absolute", "spreadAbsolute"))
    midpoint = ((bid + ask) / 2.0) if bid and ask and bid > 0 and ask > 0 else None
    if spread_absolute is None and bid is not None and ask is not None:
        spread_absolute = ask - bid
    if spread_bps is None and midpoint and spread_absolute is not None and midpoint > 0:
        spread_bps = spread_absolute / midpoint * 10000.0
    return {
        "bid": round(bid, 8) if bid is not None else None,
        "ask": round(ask, 8) if ask is not None else None,
        "spread_absolute": round(spread_absolute, 8) if spread_absolute is not None else None,
        "spread_bps": round(spread_bps, 6) if spread_bps is not None else None,
        "quote_found": bid is not None or ask is not None or spread_bps is not None,
    }


def _collect_sample(base_url: str, account_id: str) -> dict[str, Any]:
    body = _fetch_json(f"{base_url.rstrip('/')}/v1/accounts/{account_id}/normalized-state")
    account = body.get("account") if isinstance(body.get("account"), dict) else {}
    metadata = account.get("metadata") if isinstance(account.get("metadata"), dict) else {}
    runtime_session = metadata.get("broker_runtime_session") if isinstance(metadata.get("broker_runtime_session"), dict) else {}
    quote_fields = _extract_quote_fields(body)
    quote_fields_runtime = _extract_quote_fields(runtime_session)
    if not quote_fields["quote_found"] and quote_fields_runtime["quote_found"]:
        quote_fields = quote_fields_runtime
    sample = {
        "observed_at": _utc_now().isoformat(),
        "account_id": account_id,
        "account_status": str(account.get("status") or "unknown"),
        "account_mode": str(account.get("mode") or "unknown"),
        "broker": str(account.get("broker") or ""),
        "truth_source": str(body.get("truth_source") or metadata.get("truth_source") or ""),
        "broker_state_updated_at": str(metadata.get("broker_state_updated_at") or ""),
        "broker_connected": bool(runtime_session.get("connected")),
        "watchdog_state": str(runtime_session.get("watchdog_state") or ""),
        "last_heartbeat_at": str(runtime_session.get("last_heartbeat_at") or ""),
        "session_company": str(runtime_session.get("company") or ""),
        "session_terminal": str(runtime_session.get("terminal") or ""),
        "quote_surface": "broker_runtime_session" if quote_fields_runtime["quote_found"] else "normalized_state" if quote_fields["quote_found"] else "missing",
        **quote_fields,
    }
    if not sample["quote_found"]:
        sample["quote_absence_reason"] = "normalized-state exposes broker connectivity and balances, but no broker-native bid/ask/spread fields were found"
    return sample


def _summarize(samples: list[dict[str, Any]], account_id: str, duration_hours: float, interval_seconds: float) -> dict[str, Any]:
    spread_values = [float(sample["spread_bps"]) for sample in samples if sample.get("spread_bps") is not None]
    quote_found_count = sum(1 for sample in samples if bool(sample.get("quote_found")))
    surfaces = Counter(str(sample.get("quote_surface") or "missing") for sample in samples)
    watchdog = Counter(str(sample.get("watchdog_state") or "") for sample in samples)
    return {
        "generated_at": _utc_now().isoformat(),
        "account_id": account_id,
        "duration_hours": duration_hours,
        "interval_seconds": interval_seconds,
        "sample_count": len(samples),
        "quote_found_count": quote_found_count,
        "quote_found_rate_pct": round((quote_found_count / len(samples)) * 100.0, 4) if samples else None,
        "quote_surfaces": dict(surfaces),
        "watchdog_states": dict(watchdog),
        "p50_spread_bps": _percentile(spread_values, 0.50),
        "p90_spread_bps": _percentile(spread_values, 0.90),
        "p95_spread_bps": _percentile(spread_values, 0.95),
        "max_spread_bps": round(max(spread_values), 6) if spread_values else None,
        "note": "This audit is broker-specific only if normalized-state or broker_runtime_session exposes quote fields. Otherwise it proves the current MT5 surface lacks native broker quote observability.",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit broker-specific MT5 state and detect whether native quote fields are exposed.")
    parser.add_argument("--account-id", default=os.getenv("ACCOUNT_ID", "MT5_ACCOUNT_ID_REQUIRED"))
    parser.add_argument("--duration-hours", type=float, default=float(os.getenv("DURATION_HOURS", "24")))
    parser.add_argument("--interval-seconds", type=float, default=float(os.getenv("INTERVAL_SECONDS", "60")))
    parser.add_argument("--max-samples", type=int, default=int(os.getenv("MAX_SAMPLES", "0")))
    parser.add_argument("--mt5-bridge-url", default=os.getenv("MT5_BRIDGE_URL", "http://mt5-bridge:8006"))
    parser.add_argument("--output-dir", default=os.getenv("OUTPUT_DIR", "/workspace/logs/spread_audit"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    run_id = _utc_now().strftime("%Y%m%dT%H%M%SZ")
    jsonl_path = output_dir / f"mt5_broker_state_audit_{args.account_id}_{run_id}.jsonl"
    summary_path = output_dir / f"mt5_broker_state_audit_{args.account_id}_{run_id}.summary.json"
    started_at = _utc_now()
    deadline = started_at + timedelta(hours=max(0.0, args.duration_hours))
    samples: list[dict[str, Any]] = []
    sample_index = 0

    try:
        while True:
            sample = _collect_sample(args.mt5_bridge_url, args.account_id)
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

    summary = _summarize(samples, args.account_id, args.duration_hours, args.interval_seconds)
    with summary_path.open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2, ensure_ascii=True)
        handle.write("\n")
    print(json.dumps({"jsonl_path": str(jsonl_path), "summary_path": str(summary_path), "summary": summary}, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())