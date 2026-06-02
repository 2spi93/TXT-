from __future__ import annotations

import asyncio
import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Query, Request


SCHEMA_VERSION = "market-recorder/v1"
WRITER_ENABLED = os.getenv("MARKET_RECORDER_WRITER_ENABLED", "0").strip().lower() in {"1", "true", "yes", "on"}
POLL_ENABLED = os.getenv("MARKET_RECORDER_POLL_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}
STORAGE_ROOT = Path(os.getenv("MARKET_RECORDER_STORAGE_ROOT", "/workspace/data/market-data"))
MARKET_DATA_URL = os.getenv("MARKET_DATA_URL", "http://market-data:8003").rstrip("/")
POLL_SECONDS = max(1.0, float(os.getenv("MARKET_RECORDER_POLL_SECONDS", "5")))
SYMBOLS = [item.strip().upper() for item in os.getenv("MARKET_RECORDER_SYMBOLS", "BTCUSDT").split(",") if item.strip()]
VENUES = [item.strip() for item in os.getenv("MARKET_RECORDER_VENUES", "binance-public,bybit-public,okx-public,bingx-public").split(",") if item.strip()]
TRADE_LIMIT = max(20, min(500, int(os.getenv("MARKET_RECORDER_TRADE_LIMIT", "120"))))
QUOTE_MAX_AGE_SECONDS = max(0.0, float(os.getenv("MARKET_RECORDER_QUOTE_MAX_AGE_SECONDS", "120")))

app = FastAPI(title="TXT Market Recorder", version="1.0.0")

_seen_trade_keys: set[str] = set()
_counts: dict[str, int] = {}
_last_write_at: str | None = None
_last_poll_at: str | None = None
_last_poll_error: str | None = None
_started_at = datetime.now(timezone.utc).isoformat()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _date_key(value: str | None = None) -> str:
    raw = value or _now_iso()
    return raw[:10] if len(raw) >= 10 else datetime.now(timezone.utc).date().isoformat()


def _safe_part(value: Any) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "unknown").strip())
    return cleaned[:96] or "unknown"


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return str(value)


def _event_time(payload: dict[str, Any]) -> str:
    for key in ("traded_at", "snapshot_at", "updated_at", "captured_at", "generated_at", "ts"):
        value = payload.get(key)
        if value:
            return str(value)
    return _now_iso()


def _parse_event_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _normalized_symbol(value: Any) -> str:
    return str(value or "").replace("-PERP", "").replace("/", "").replace("-", "").upper()


def _quote_is_recordable(row: dict[str, Any]) -> bool:
    venue = str(row.get("venue") or "").strip()
    if venue not in set(VENUES):
        return False
    instrument = _normalized_symbol(row.get("instrument") or row.get("symbol") or row.get("market_instrument"))
    if instrument not in {_normalized_symbol(symbol) for symbol in SYMBOLS}:
        return False
    if QUOTE_MAX_AGE_SECONDS > 0:
        event_at = _parse_event_datetime(_event_time(row))
        if event_at is not None:
            age_seconds = (datetime.now(timezone.utc) - event_at).total_seconds()
            if age_seconds > QUOTE_MAX_AGE_SECONDS:
                return False
    return True


def _normalize_event(family: str, payload: dict[str, Any]) -> dict[str, Any]:
    event_time = _event_time(payload)
    venue = str(payload.get("venue") or payload.get("preferred_venue") or "unknown")
    instrument = str(payload.get("instrument") or payload.get("symbol") or payload.get("market_instrument") or "unknown")
    return {
        "schema_version": SCHEMA_VERSION,
        "family": family,
        "venue": venue,
        "instrument": instrument,
        "event_time": event_time,
        "recorded_at": _now_iso(),
        "payload": payload,
    }


def _event_path(event: dict[str, Any]) -> Path:
    return STORAGE_ROOT / "schema=v1" / f"family={_safe_part(event.get('family'))}" / f"venue={_safe_part(event.get('venue'))}" / f"instrument={_safe_part(event.get('instrument'))}" / f"date={_date_key(str(event.get('event_time') or ''))}" / "events.jsonl"


def _write_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    global _last_write_at
    if not WRITER_ENABLED:
        return {"written": 0, "writer_enabled": False}
    written = 0
    by_path: dict[Path, list[dict[str, Any]]] = {}
    for event in events:
        by_path.setdefault(_event_path(event), []).append(event)
    for path, path_events in by_path.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            for event in path_events:
                handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True, default=_json_default) + "\n")
                family = str(event.get("family") or "unknown")
                _counts[family] = _counts.get(family, 0) + 1
                written += 1
    if written:
        _last_write_at = _now_iso()
    return {"written": written, "writer_enabled": True}


def _fetch_json(path: str, params: dict[str, Any] | None = None, timeout: float = 4.0) -> Any:
    query = urllib.parse.urlencode(params or {})
    url = f"{MARKET_DATA_URL}{path}{'?' + query if query else ''}"
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _record_quotes() -> int:
    payload = _fetch_json("/v1/quotes", timeout=5.0)
    if not isinstance(payload, list):
        return 0
    events = [_normalize_event("quotes", row) for row in payload if isinstance(row, dict) and _quote_is_recordable(row)]
    return int(_write_events(events).get("written") or 0)


def _record_trade_rows(venue: str, symbol: str) -> int:
    payload = _fetch_json("/v1/market/trades", {"venue": venue, "instrument": symbol, "limit": TRADE_LIMIT}, timeout=5.0)
    if not isinstance(payload, list):
        return 0
    events: list[dict[str, Any]] = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        trade_key = f"{venue}:{row.get('instrument') or symbol}:{row.get('trade_id') or row.get('traded_at') or row.get('price')}"
        if trade_key in _seen_trade_keys:
            continue
        _seen_trade_keys.add(trade_key)
        events.append(_normalize_event("trades", row))
    return int(_write_events(events).get("written") or 0)


def _record_depth(venue: str, symbol: str) -> int:
    payload = _fetch_json("/v1/market/orderbook/depth", {"venue": venue, "instrument": symbol}, timeout=5.0)
    if not isinstance(payload, dict):
        return 0
    return int(_write_events([_normalize_event("orderbook", payload)]).get("written") or 0)


async def _poll_once() -> dict[str, Any]:
    started = time.time()
    written = 0
    errors: list[str] = []
    try:
        written += await asyncio.to_thread(_record_quotes)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"quotes:{exc}")
    for venue in VENUES:
        for symbol in SYMBOLS:
            try:
                written += await asyncio.to_thread(_record_trade_rows, venue, symbol)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"trades:{venue}:{symbol}:{exc}")
            try:
                written += await asyncio.to_thread(_record_depth, venue, symbol)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"orderbook:{venue}:{symbol}:{exc}")
    return {"written": written, "errors": errors[:12], "latency_ms": round((time.time() - started) * 1000, 2)}


async def _poll_loop() -> None:
    global _last_poll_at, _last_poll_error
    while True:
        try:
            result = await _poll_once()
            _last_poll_at = _now_iso()
            _last_poll_error = "; ".join(result["errors"]) if result["errors"] else None
        except Exception as exc:  # noqa: BLE001
            _last_poll_error = str(exc)
        await asyncio.sleep(POLL_SECONDS)


@app.on_event("startup")
async def _startup() -> None:
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    if WRITER_ENABLED and POLL_ENABLED:
        asyncio.create_task(_poll_loop())


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok" if WRITER_ENABLED else "degraded",
        "schema_version": SCHEMA_VERSION,
        "writer_enabled": WRITER_ENABLED,
        "poll_enabled": POLL_ENABLED,
        "market_data_url": MARKET_DATA_URL,
        "storage_root": str(STORAGE_ROOT),
        "symbols": SYMBOLS,
        "venues": VENUES,
        "quote_max_age_seconds": QUOTE_MAX_AGE_SECONDS,
        "counts": _counts,
        "started_at": _started_at,
        "last_write_at": _last_write_at,
        "last_poll_at": _last_poll_at,
        "last_poll_error": _last_poll_error,
    }


@app.post("/v1/events")
async def ingest_events(request: Request, family: str = Query("external")) -> dict[str, Any]:
    payload = await request.json()
    rows = payload if isinstance(payload, list) else [payload]
    events = [_normalize_event(family, row) for row in rows if isinstance(row, dict)]
    return _write_events(events)


@app.post("/v1/record")
async def record_events(request: Request, family: str = Query("external")) -> dict[str, Any]:
    return await ingest_events(request, family=family)


@app.post("/v1/poll/run-once")
async def poll_run_once() -> dict[str, Any]:
    return await _poll_once()


@app.get("/v1/replay")
async def replay(
    family: str = Query("trades"),
    venue: str | None = Query(None),
    instrument: str | None = Query(None),
    limit: int = Query(200, ge=1, le=2000),
) -> dict[str, Any]:
    roots = [STORAGE_ROOT / "schema=v1" / f"family={_safe_part(family)}"]
    rows: list[dict[str, Any]] = []
    for root in roots:
        if not root.exists():
            continue
        for path in sorted(root.rglob("events.jsonl"), reverse=True):
            path_text = str(path)
            if venue and f"venue={_safe_part(venue)}" not in path_text:
                continue
            if instrument and f"instrument={_safe_part(instrument)}" not in path_text:
                continue
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    if not line.strip():
                        continue
                    try:
                        rows.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
            if len(rows) >= limit:
                break
    rows.sort(key=lambda item: str(item.get("event_time") or ""), reverse=True)
    return {"family": family, "count": min(len(rows), limit), "items": rows[:limit]}