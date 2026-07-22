from __future__ import annotations

import asyncio
import hashlib
import os
import uuid
from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse
import httpx
from pydantic import BaseModel, Field

from shared.db import ensure_schema, execute, fetch_all, fetch_one, json_dumps

app = FastAPI(title="MT5 Bridge", version="0.1.0")

MARKET_DATA_URL = os.getenv("MARKET_DATA_URL", "http://market-data:8003")

_MT5_LIVE_SUCCESS_STATUSES = {
    "accepted",
    "filled",
    "partial_fill",
    "partially_filled",
    "executed",
}

_MT5_LIVE_FAILURE_STATUSES = {
    "cancelled",
    "canceled",
    "error",
    "failed",
    "rejected",
}


class Mt5AccountCreateRequest(BaseModel):
    account_id: str
    broker: str = "metaquotes"
    server: str
    login: str
    mode: str = Field(default="paper", pattern="^(paper|live)$")
    metadata: dict[str, Any] = Field(default_factory=dict)


class Mt5BrokerSessionUpdateRequest(BaseModel):
    broker_session: dict[str, Any] = Field(default_factory=dict)
    merge: bool = True


class Mt5OrderFilterRequest(BaseModel):
    account_id: str
    symbol: str
    side: str = Field(pattern="^(buy|sell)$")
    lots: float = Field(gt=0)
    estimated_notional_usd: float = Field(gt=0)
    max_spread_bps: int = Field(gt=0)
    rationale: str = ""
    risk_gate: dict[str, Any] = Field(default_factory=dict)
    routing_plan: dict[str, Any] = Field(default_factory=dict)
    chosen_route: dict[str, Any] = Field(default_factory=dict)
    expected_slippage_bps: float | None = None


class Mt5CommandResultRequest(BaseModel):
    status: str = ""
    broker_ticket: str = ""
    ticket: str = ""
    order_id: str = ""
    deal_id: str = ""
    error_message: str = ""
    detail: str = ""
    result: dict[str, Any] = Field(default_factory=dict)
    broker_state: dict[str, Any] = Field(default_factory=dict)
    session: dict[str, Any] = Field(default_factory=dict)
    realized_slippage_bps: float | None = None
    latency_ms: int | None = None


def _to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return fallback
    if numeric != numeric:
        return fallback
    return numeric


def _to_nullable_float(value: Any) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric != numeric:
        return None
    return numeric


def _json_safe_row(row: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, value in row.items():
        normalized[key] = value.isoformat() if isinstance(value, datetime) else value
    return normalized


def _find_nested_number(value: Any, keys: tuple[str, ...]) -> float | None:
    if isinstance(value, dict):
        for key in keys:
            if key in value:
                parsed = _to_nullable_float(value.get(key))
                if parsed is not None:
                    return parsed
        for nested in value.values():
            parsed = _find_nested_number(nested, keys)
            if parsed is not None:
                return parsed
    elif isinstance(value, list):
        for item in value:
            parsed = _find_nested_number(item, keys)
            if parsed is not None:
                return parsed
    return None


def _find_nested_string(value: Any, keys: tuple[str, ...]) -> str | None:
    if isinstance(value, dict):
        for key in keys:
            if key in value:
                text = str(value.get(key) or "").strip()
                if text:
                    return text
        for nested in value.values():
            parsed = _find_nested_string(nested, keys)
            if parsed:
                return parsed
    elif isinstance(value, list):
        for item in value:
            parsed = _find_nested_string(item, keys)
            if parsed:
                return parsed
    return None


def _extract_symbol_quote_source(payload: Any, symbol: str) -> dict[str, Any]:
    normalized = _normalize_symbol(symbol)
    if not isinstance(payload, (dict, list)):
        return {}

    if isinstance(payload, dict):
        symbol_entry = payload.get(normalized)
        if isinstance(symbol_entry, dict):
            return symbol_entry
        for key in ("quotes", "symbol_quotes", "market_quotes", "ticks", "symbols"):
            candidate = payload.get(key)
            if isinstance(candidate, dict):
                entry = candidate.get(normalized)
                if isinstance(entry, dict):
                    return entry
            elif isinstance(candidate, list):
                for item in candidate:
                    if isinstance(item, dict) and _normalize_symbol(str(item.get("symbol") or item.get("instrument") or "")) == normalized:
                        return item

    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict) and _normalize_symbol(str(item.get("symbol") or item.get("instrument") or "")) == normalized:
                return item

    return payload if isinstance(payload, dict) else {}


def _extract_quote_snapshot(account: dict[str, Any], symbol: str) -> dict[str, Any]:
    metadata = account.get("metadata") if isinstance(account.get("metadata"), dict) else {}
    runtime_session = metadata.get("broker_runtime_session") if isinstance(metadata.get("broker_runtime_session"), dict) else {}
    symbol_payload = _extract_symbol_quote_source({**metadata, "runtime_session": runtime_session}, symbol)

    bid = _find_nested_number(symbol_payload, ("bid", "best_bid", "bid_price", "bid1", "bid1Price"))
    ask = _find_nested_number(symbol_payload, ("ask", "best_ask", "ask_price", "ask1", "ask1Price"))
    spread_abs = _find_nested_number(symbol_payload, ("spread", "spread_absolute", "spreadAbs"))
    midpoint = ((bid + ask) / 2.0) if bid is not None and ask is not None and bid > 0 and ask > 0 else None
    spread_bps = _find_nested_number(symbol_payload, ("spread_bps", "spreadBps"))
    if spread_abs is None and bid is not None and ask is not None:
        spread_abs = ask - bid
    if spread_bps is None and spread_abs is not None and midpoint and midpoint > 0:
        spread_bps = spread_abs / midpoint * 10000.0

    tick_time = (
        _find_nested_string(symbol_payload, ("tick_time", "time", "timestamp", "as_of", "updated_at"))
        or str(metadata.get("broker_state_updated_at") or "").strip()
        or str(runtime_session.get("last_heartbeat_at") or "").strip()
        or None
    )
    symbol_state = _find_nested_string(symbol_payload, ("symbol_state", "state", "status")) or "unknown"

    return {
        "symbol": _normalize_symbol(symbol),
        "bid": round(bid, 8) if bid is not None else None,
        "ask": round(ask, 8) if ask is not None else None,
        "spread": round(spread_abs, 8) if spread_abs is not None else None,
        "spread_bps": round(spread_bps, 6) if spread_bps is not None else None,
        "tick_time": tick_time,
        "symbol_state": symbol_state,
        "source": "mt5-broker-state" if (bid is not None or ask is not None or spread_bps is not None) else "unavailable",
    }


def _listed_symbols_for_account(account: dict[str, Any]) -> list[str]:
    metadata = account.get("metadata") if isinstance(account.get("metadata"), dict) else {}
    symbols: set[str] = set()
    for key in ("positions", "protective_orders"):
        rows = metadata.get(key)
        if isinstance(rows, list):
            for row in rows:
                if not isinstance(row, dict):
                    continue
                symbol = _normalize_symbol(str(row.get("symbol") or row.get("instrument") or ""))
                if symbol:
                    symbols.add(symbol)
    for key in ("quotes", "symbol_quotes", "symbols", "market_quotes"):
        payload = metadata.get(key)
        if isinstance(payload, dict):
            for raw in payload.keys():
                symbol = _normalize_symbol(str(raw))
                if symbol:
                    symbols.add(symbol)
        elif isinstance(payload, list):
            for item in payload:
                if not isinstance(item, dict):
                    continue
                symbol = _normalize_symbol(str(item.get("symbol") or item.get("instrument") or ""))
                if symbol:
                    symbols.add(symbol)
    return sorted(symbols)


def _normalize_symbol(symbol: str) -> str:
    normalized = str(symbol or "").replace("-PERP", "").replace("/", "").replace("-", "").strip().upper()
    if normalized == "BTCUSDT":
        return "BTCUSD"
    return normalized


def _parse_mql_key_value_body(body: str) -> dict[str, Any]:
    parsed: dict[str, Any] = {}
    for raw_line in str(body or "").splitlines():
        line = raw_line.strip()
        if not line or "=" not in line:
            continue
        key, value = line.split("=", 1)
        parsed[key.strip()] = value.strip()
    return parsed


def _mql_plaintext_requested(request: Request | None) -> bool:
    if request is None:
        return False
    accept = str(request.headers.get("accept") or "").lower()
    content_type = str(request.headers.get("content-type") or "").lower()
    return "text/plain" in accept or content_type.startswith("text/plain")


def _stable_mql_numeric_id(command_id: str) -> str:
    normalized = str(command_id or "").strip()
    if normalized.isdigit() and 0 < int(normalized) < 2_000_000_000:
        return normalized
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return str((int(digest[:12], 16) % 1_900_000_000) + 1)


def _format_mql_command_batch(rows: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for row in rows:
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        command_id = str(row.get("command_id") or "").strip()
        mql_id = str(payload.get("mql_id") or _stable_mql_numeric_id(command_id)).strip()
        if payload.get("mql_id") != mql_id:
            updated_payload = {**payload, "mql_id": mql_id}
            execute(
                "UPDATE mt5_order_commands SET payload = %s::jsonb WHERE command_id = %s",
                (json_dumps(updated_payload), command_id),
            )
            payload = updated_payload
        side = str(payload.get("side") or "BUY").strip().upper()
        if side == "BUY":
            action = "OPEN_MARKET"
        elif side == "SELL":
            action = "OPEN_MARKET"
        else:
            action = str(payload.get("action") or "OPEN_MARKET").strip().upper()
        comment = str(payload.get("comment") or payload.get("rationale") or command_id).replace("\r", " ").replace("\n", " ")[:120]
        lines.extend(
            [
                "command_begin",
                f"id={mql_id}",
                f"action={action}",
                f"symbol={_normalize_symbol(str(payload.get('symbol') or ''))}",
                f"side={side}",
                f"lots={_to_float(payload.get('lots'), 0.0):.8f}",
                "position_ticket=0",
                "order_ticket=0",
                f"reference_price={_to_float(payload.get('reference_price'), 0.0):.8f}",
                f"stop_loss={_to_float(payload.get('stop_loss'), 0.0):.8f}",
                f"take_profit={_to_float(payload.get('take_profit'), 0.0):.8f}",
                f"expected_slippage_bps={_to_float(payload.get('expected_slippage_bps'), 0.0):.8f}",
                f"max_spread_bps={_to_float(payload.get('max_spread_bps'), 0.0):.8f}",
                f"comment={comment}",
                f"created_at={row.get('created_at').isoformat() if isinstance(row.get('created_at'), datetime) else str(row.get('created_at') or '')}",
                "command_end",
            ]
        )
    return "\n".join(lines) + ("\n" if lines else "")


def _mt5_broker_session(account: dict[str, Any]) -> dict[str, Any]:
    metadata = account.get("metadata") if isinstance(account.get("metadata"), dict) else {}
    broker_session = metadata.get("broker_session") if isinstance(metadata.get("broker_session"), dict) else {}
    return dict(broker_session)


def _resolve_runtime_account(account_id: str) -> tuple[dict[str, Any], str]:
    account = fetch_one("SELECT * FROM mt5_accounts WHERE account_id = %s", (account_id,))
    if not account:
        raise HTTPException(status_code=404, detail="MT5 account not found")
    metadata = account.get("metadata") if isinstance(account.get("metadata"), dict) else {}
    alias_target = str(metadata.get("bridge_alias_for") or metadata.get("alias_of_account_id") or "").strip()
    if alias_target and alias_target != account_id:
        canonical = fetch_one("SELECT * FROM mt5_accounts WHERE account_id = %s", (alias_target,))
        if canonical:
            return canonical, account_id
    login_target = str(account.get("login") or "").strip()
    if login_target and login_target != account_id:
        canonical = fetch_one("SELECT * FROM mt5_accounts WHERE account_id = %s", (login_target,))
        if canonical:
            return canonical, account_id
    return account, account_id


def _mt5_symbol_trades_24x7(symbol: str) -> bool:
    normalized = _normalize_symbol(symbol)
    return normalized.startswith(("BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LTC"))


def _easter_sunday(year: int) -> datetime:
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return datetime(year, month, day, tzinfo=timezone.utc)


def _configured_market_holidays() -> dict[str, str]:
    holidays: dict[str, str] = {}
    for item in str(os.getenv("MT5_FTMO_MARKET_HOLIDAYS", "")).split(","):
        raw = item.strip()
        if not raw:
            continue
        day, _, reason = raw.partition(":")
        day = day.strip()
        if len(day) == 10:
            holidays[day] = reason.strip() or "configured_market_holiday"
    return holidays


def _ftmo_market_holiday_reason(now: datetime, symbol: str) -> str:
    normalized = _normalize_symbol(symbol)
    if _mt5_symbol_trades_24x7(normalized):
        return ""
    day_key = now.date().isoformat()
    configured = _configured_market_holidays().get(day_key)
    if configured:
        return configured
    easter = _easter_sunday(now.year)
    fixed_reasons = {
        f"{now.year}-01-01": "new_year_market_holiday",
        f"{now.year}-12-25": "christmas_market_holiday",
        f"{now.year}-12-26": "boxing_day_market_holiday",
        (easter - timedelta(days=2)).date().isoformat(): "good_friday_market_holiday",
    }
    return fixed_reasons.get(day_key, "")


def _next_ftmo_market_open(now: datetime, monday_open: time, symbol: str) -> datetime:
    candidate = now.replace(hour=monday_open.hour, minute=monday_open.minute, second=0, microsecond=0)
    if candidate <= now:
        candidate += timedelta(days=1)
    for _ in range(14):
        if candidate.weekday() in {5, 6}:
            candidate = _next_weekday_at(candidate, 0, monday_open)
            continue
        if _ftmo_market_holiday_reason(candidate, symbol):
            candidate = (candidate + timedelta(days=1)).replace(hour=monday_open.hour, minute=monday_open.minute, second=0, microsecond=0)
            continue
        return candidate
    return _next_weekday_at(now, 0, monday_open)


def _next_weekday_at(now: datetime, weekday: int, target_time: time) -> datetime:
    days_ahead = (weekday - now.weekday()) % 7
    candidate = (now + timedelta(days=days_ahead)).replace(
        hour=target_time.hour,
        minute=target_time.minute,
        second=0,
        microsecond=0,
    )
    if candidate <= now:
        candidate += timedelta(days=7)
    return candidate


async def _resolve_market_session_snapshot(symbol: str) -> dict[str, Any]:
    normalized = _normalize_symbol(symbol)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{MARKET_DATA_URL}/v1/market/session-state", params={"instrument": normalized})
        if response.status_code >= 400:
            return {"instrument": normalized, "session": "unknown", "source": "market-data-unavailable"}
        payload = response.json()
        if isinstance(payload, dict):
            payload.setdefault("instrument", normalized)
            payload.setdefault("source", "market-data")
            return payload
    except Exception:
        pass
    return {"instrument": normalized, "session": "unknown", "source": "market-data-unavailable"}


async def _evaluate_mt5_market_tradability(account: dict[str, Any], symbol: str) -> dict[str, Any]:
    normalized_symbol = _normalize_symbol(symbol)
    now = datetime.now(timezone.utc)
    session_snapshot = await _resolve_market_session_snapshot(normalized_symbol)
    broker_session = _mt5_broker_session(account)
    session_profile = str(broker_session.get("market_schedule_profile") or "ftmo-week").strip().lower() or "ftmo-week"
    if session_profile == "always-open" or _mt5_symbol_trades_24x7(normalized_symbol):
        return {
            "tradable": True,
            "market_type": "crypto",
            "reason": "continuous_market",
            "session": str(session_snapshot.get("session") or "unknown"),
            "session_snapshot": session_snapshot,
            "evaluated_at": now.isoformat(),
        }

    weekday = now.weekday()
    monday_open = time(hour=1, minute=5)
    friday_close = time(hour=23, minute=50)
    closed_reason = ""
    next_open_at: str | None = None

    if weekday == 5:
        closed_reason = "weekend_market_closed"
        next_open_at = _next_weekday_at(now, 0, monday_open).isoformat()
    elif weekday == 6:
        closed_reason = "weekend_market_closed"
        next_open_at = _next_weekday_at(now, 0, monday_open).isoformat()
    elif weekday == 0 and now.time() < monday_open:
        closed_reason = "market_preopen"
        next_open_at = now.replace(hour=monday_open.hour, minute=monday_open.minute, second=0, microsecond=0).isoformat()
    elif weekday == 4 and now.time() >= friday_close:
        closed_reason = "weekend_market_closed"
        next_open_at = _next_weekday_at(now, 0, monday_open).isoformat()
    holiday_reason = _ftmo_market_holiday_reason(now, normalized_symbol)
    if not closed_reason and holiday_reason:
        closed_reason = holiday_reason
        next_open_at = _next_ftmo_market_open(now, monday_open, normalized_symbol).isoformat()

    return {
        "tradable": not bool(closed_reason),
        "market_type": "session-bound",
        "reason": closed_reason or "market_open",
        "session": str(session_snapshot.get("session") or "unknown"),
        "session_snapshot": session_snapshot,
        "evaluated_at": now.isoformat(),
        "next_open_at": next_open_at,
        "schedule_profile": session_profile,
    }


def _extract_nested_dict(payload: Any, payload_path: str | None = None) -> dict[str, Any] | None:
    current = payload
    if payload_path:
        for part in [segment.strip() for segment in str(payload_path).split(".") if segment.strip()]:
            if not isinstance(current, dict):
                return None
            current = current.get(part)

    candidates: list[Any] = [current]
    if isinstance(current, dict):
        candidates.extend(current.get(key) for key in ("payload", "data", "result", "execution", "order"))
    for candidate in candidates:
        if isinstance(candidate, dict):
            return candidate
    return None


def _normalized_live_order_status(payload: dict[str, Any]) -> str:
    raw = str(
        payload.get("status")
        or payload.get("execution_status")
        or payload.get("order_status")
        or payload.get("result")
        or "accepted"
    ).strip().lower() or "accepted"
    if raw in _MT5_LIVE_SUCCESS_STATUSES or raw in _MT5_LIVE_FAILURE_STATUSES:
        return raw
    if raw in {"ok", "success", "done", "complete"}:
        return "filled"
    return "accepted"


def _extract_broker_ticket(payload: dict[str, Any]) -> str:
    for key in ("broker_ticket", "ticket", "order_id", "deal_id", "id"):
        value = str(payload.get(key) or "").strip()
        if value:
            return value
    return ""


def _mt5_uses_mql_command_queue(broker_session: dict[str, Any]) -> bool:
    execution_mode = str(broker_session.get("execution_mode") or broker_session.get("mode") or "").strip().lower()
    execution_url = str(
        broker_session.get("execution_url")
        or broker_session.get("place_order_url")
        or broker_session.get("order_url")
        or ""
    ).strip().lower()
    return execution_mode in {"mql_command_queue", "ea_command_queue", "bridge_command_queue"} or execution_url in {"mql://commands", "ea://commands", "txt://mt5-command-queue"}


def _command_payload_from_order(
    account: dict[str, Any],
    request: Mt5OrderFilterRequest,
    broker_session: dict[str, Any],
    tradability: dict[str, Any],
) -> dict[str, Any]:
    command_payload = dict(broker_session.get("execution_payload") if isinstance(broker_session.get("execution_payload"), dict) else {})
    command_payload.update(
        {
            "type": "place_order",
            "account_id": account["account_id"],
            "symbol": _normalize_symbol(request.symbol),
            "side": request.side,
            "lots": request.lots,
            "estimated_notional_usd": request.estimated_notional_usd,
            "max_spread_bps": request.max_spread_bps,
            "rationale": request.rationale,
            "risk_gate": request.risk_gate,
            "routing_plan": request.routing_plan,
            "chosen_route": request.chosen_route,
            "expected_slippage_bps": request.expected_slippage_bps,
            "tradability": tradability,
            "created_at": _now_iso(),
        }
    )
    return command_payload


def _enqueue_mt5_order_command(
    account: dict[str, Any],
    requested_account_id: str,
    client_id: str,
    payload: dict[str, Any],
    ttl_seconds: float,
) -> str:
    command_id = ""
    for _attempt in range(10):
        candidate = str((uuid.uuid4().int % 1_900_000_000) + 1)
        if not fetch_one("SELECT command_id FROM mt5_order_commands WHERE command_id = %s", (candidate,)):
            command_id = candidate
            break
    if not command_id:
        command_id = str((int(datetime.now(timezone.utc).timestamp() * 1000) % 1_900_000_000) + 1)
    safe_ttl_seconds = max(15.0, min(float(ttl_seconds or 120.0), 600.0))
    payload = {**payload, "mql_id": command_id}
    fetch_one(
        """
        INSERT INTO mt5_order_commands (command_id, account_id, requested_account_id, client_id, command_type, status, payload, expires_at)
        VALUES (%s, %s, %s, %s, 'place_order', 'queued', %s::jsonb, NOW() + (%s || ' seconds')::interval)
        RETURNING command_id
        """,
        (command_id, account["account_id"], requested_account_id, client_id, json_dumps(payload), str(int(safe_ttl_seconds))),
    )
    return command_id


async def _wait_for_mt5_command_result(command_id: str, timeout_seconds: float) -> dict[str, Any] | None:
    deadline = datetime.now(timezone.utc) + timedelta(seconds=max(1.0, timeout_seconds))
    while datetime.now(timezone.utc) < deadline:
        row = fetch_one(
            """
            SELECT command_id, status, result_payload, broker_ticket, error_message, acknowledged_at
            FROM mt5_order_commands
            WHERE command_id = %s
            """,
            (command_id,),
        )
        if row and str(row.get("status") or "") in {"executed", "rejected", "failed", "expired", "cancelled"}:
            return row
        await asyncio.sleep(0.35)
    return None


async def _execute_live_order_via_mql_command_queue(account: dict[str, Any], request: Mt5OrderFilterRequest) -> dict[str, Any]:
    broker_session = _mt5_broker_session(account)
    tradability = await _evaluate_mt5_market_tradability(account, request.symbol)
    if not bool(tradability.get("tradable")):
        raise HTTPException(
            status_code=409,
            detail={
                "status": "market_closed",
                "symbol": _normalize_symbol(request.symbol),
                "reason": tradability.get("reason") or "market_closed",
                "next_open_at": tradability.get("next_open_at"),
                "tradability": tradability,
            },
        )

    runtime_session = (account.get("metadata") if isinstance(account.get("metadata"), dict) else {}).get("broker_runtime_session")
    runtime_session = runtime_session if isinstance(runtime_session, dict) else {}
    client_id = str(broker_session.get("client_id") or runtime_session.get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(
            status_code=503,
            detail={
                "status": "mt5_ea_executor_not_connected",
                "detail": "No MT5 EA client_id is available. Send heartbeat.mql first or configure broker_session.client_id.",
            },
        )

    timeout_seconds = max(3.0, min(45.0, _to_float(broker_session.get("execution_timeout_seconds"), 20.0)))
    payload = _command_payload_from_order(account, request, broker_session, tradability)
    command_id = _enqueue_mt5_order_command(account, request.account_id, client_id, payload, timeout_seconds + 60.0)
    started_at = datetime.now(timezone.utc)
    row = await _wait_for_mt5_command_result(command_id, timeout_seconds)
    if not row:
        raise HTTPException(
            status_code=504,
            detail={
                "status": "mt5_ea_execution_timeout",
                "command_id": command_id,
                "detail": "MT5 EA command was queued, but no broker result arrived before timeout.",
            },
        )

    status = str(row.get("status") or "").strip().lower()
    result_payload = row.get("result_payload") if isinstance(row.get("result_payload"), dict) else {}
    broker_ticket = str(row.get("broker_ticket") or _extract_broker_ticket(result_payload)).strip()
    if status != "executed" or not broker_ticket:
        raise HTTPException(
            status_code=409,
            detail={
                "status": "mt5_ea_execution_rejected",
                "command_id": command_id,
                "provider_status": status,
                "detail": row.get("error_message") or result_payload.get("detail") or result_payload.get("error_message") or "MT5 EA returned no broker ticket.",
            },
        )

    latency_ms = max(1, int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000))
    return {
        "status": "filled" if str(result_payload.get("status") or "").lower() in {"filled", "executed"} else "accepted",
        "bridge_mode": account.get("mode", "live"),
        "broker_ticket": broker_ticket,
        "account_id": request.account_id,
        "symbol": _normalize_symbol(request.symbol),
        "side": request.side,
        "lots": request.lots,
        "chosen_route": request.chosen_route,
        "realized_slippage_bps": _to_float(result_payload.get("realized_slippage_bps"), _to_float(request.expected_slippage_bps, 0.0)),
        "expected_slippage_bps": request.expected_slippage_bps,
        "latency_ms": int(result_payload.get("latency_ms") or latency_ms),
        "tradability": tradability,
        "external_execution": {
            "command_id": command_id,
            "executor": "mt5-ea-command-queue",
            "client_id": client_id,
            "result": result_payload,
        },
    }


async def _execute_live_order_via_broker_session(account: dict[str, Any], request: Mt5OrderFilterRequest) -> dict[str, Any]:
    broker_session = _mt5_broker_session(account)
    if _mt5_uses_mql_command_queue(broker_session):
        return await _execute_live_order_via_mql_command_queue(account, request)

    execution_url = str(
        broker_session.get("execution_url")
        or broker_session.get("place_order_url")
        or broker_session.get("order_url")
        or ""
    ).strip()
    if not execution_url:
        raise HTTPException(
            status_code=503,
            detail={
                "status": "mt5_live_execution_unconfigured",
                "detail": "broker_session.execution_url is required for real MT5 live execution",
            },
        )

    tradability = await _evaluate_mt5_market_tradability(account, request.symbol)
    if not bool(tradability.get("tradable")):
        raise HTTPException(
            status_code=409,
            detail={
                "status": "market_closed",
                "symbol": _normalize_symbol(request.symbol),
                "reason": tradability.get("reason") or "market_closed",
                "next_open_at": tradability.get("next_open_at"),
                "tradability": tradability,
            },
        )

    method = str(broker_session.get("execution_method") or "POST").strip().upper() or "POST"
    headers = dict(broker_session.get("execution_headers") or broker_session.get("headers") or {}) if isinstance(broker_session.get("execution_headers") or broker_session.get("headers"), dict) else {}
    query_params = dict(broker_session.get("execution_query") or {}) if isinstance(broker_session.get("execution_query"), dict) else None
    request_payload = dict(broker_session.get("execution_payload") or {}) if isinstance(broker_session.get("execution_payload"), dict) else {}
    timeout_seconds = max(1.0, min(45.0, _to_float(broker_session.get("execution_timeout_seconds"), 12.0)))
    response_payload_path = str(broker_session.get("execution_payload_path") or "").strip() or None
    truth_source = str(broker_session.get("truth_source") or "mt5-external-broker-session").strip() or "mt5-external-broker-session"

    request_payload.update(
        {
            "account_id": request.account_id,
            "symbol": _normalize_symbol(request.symbol),
            "side": request.side,
            "lots": request.lots,
            "estimated_notional_usd": request.estimated_notional_usd,
            "max_spread_bps": request.max_spread_bps,
            "rationale": request.rationale,
            "risk_gate": request.risk_gate,
            "routing_plan": request.routing_plan,
            "chosen_route": request.chosen_route,
            "expected_slippage_bps": request.expected_slippage_bps,
        }
    )

    started_at = datetime.now(timezone.utc)
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.request(
                method,
                execution_url,
                headers=headers or None,
                params=query_params,
                json=request_payload if method in {"POST", "PUT", "PATCH"} else None,
            )
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"status": "mt5_live_execution_unavailable", "detail": str(exc)[:500]}) from exc

    try:
        body = response.json()
    except ValueError:
        body = {"detail": response.text[:1000]}

    payload = _extract_nested_dict(body, response_payload_path)
    if not isinstance(payload, dict):
        payload = body if isinstance(body, dict) else {"detail": str(body)[:1000]}

    normalized_status = _normalized_live_order_status(payload)
    if response.status_code >= 400 or normalized_status in _MT5_LIVE_FAILURE_STATUSES:
        raise HTTPException(
            status_code=409 if response.status_code < 500 else 502,
            detail={
                "status": "mt5_live_execution_rejected",
                "detail": payload.get("detail") if isinstance(payload, dict) else payload,
                "provider_status": normalized_status,
                "upstream_status_code": response.status_code,
            },
        )

    broker_ticket = _extract_broker_ticket(payload)
    if not broker_ticket:
        raise HTTPException(
            status_code=502,
            detail={
                "status": "mt5_live_execution_invalid_response",
                "detail": "external MT5 executor returned no broker ticket",
            },
        )

    broker_state = payload.get("broker_state") if isinstance(payload.get("broker_state"), dict) else body.get("broker_state") if isinstance(body, dict) and isinstance(body.get("broker_state"), dict) else None
    broker_runtime_session = payload.get("session") if isinstance(payload.get("session"), dict) else body.get("session") if isinstance(body, dict) and isinstance(body.get("session"), dict) else None
    if isinstance(broker_state, dict) or isinstance(broker_runtime_session, dict):
        request_payload = {
            "truth_source": truth_source,
            "as_of": str(payload.get("as_of") or body.get("as_of") or _now_iso()),
        }
        if isinstance(broker_state, dict):
            request_payload["broker_state"] = broker_state
        if isinstance(broker_runtime_session, dict):
            request_payload["session"] = broker_runtime_session
        metadata = _merge_mt5_broker_state_metadata(account.get("metadata"), request_payload)
        execute(
            """
            UPDATE mt5_accounts
            SET metadata = %s::jsonb,
                updated_at = NOW()
            WHERE account_id = %s
            """,
            (json_dumps(metadata), request.account_id),
        )

    latency_ms = max(1, int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000))
    return {
        "status": normalized_status,
        "bridge_mode": account.get("mode", "live"),
        "broker_ticket": broker_ticket,
        "account_id": request.account_id,
        "symbol": _normalize_symbol(request.symbol),
        "side": request.side,
        "lots": request.lots,
        "chosen_route": request.chosen_route,
        "realized_slippage_bps": _to_float(payload.get("realized_slippage_bps"), _to_float(request.expected_slippage_bps, 0.0)),
        "expected_slippage_bps": request.expected_slippage_bps,
        "latency_ms": int(payload.get("latency_ms") or latency_ms),
        "tradability": tradability,
        "external_execution": payload,
    }


def _default_mark_price(symbol: str, metadata: dict[str, Any]) -> float:
    marks = metadata.get("marks") if isinstance(metadata.get("marks"), dict) else {}
    if symbol in marks:
        return max(0.0001, _to_float(marks.get(symbol), 0.0))
    normalized = symbol.upper()
    defaults = {
        "EURUSD": 1.08,
        "GBPUSD": 1.27,
        "USDJPY": 151.4,
        "XAUUSD": 2185.0,
        "BTCUSD": 69000.0,
        "BTCUSDT": 69000.0,
        "ETHUSD": 3500.0,
        "ETHUSDT": 3500.0,
        "NAS100": 18240.0,
        "US30": 39200.0,
        "GER40": 18350.0,
    }
    if normalized in defaults:
        return defaults[normalized]
    if len(normalized) == 6 and normalized.endswith("USD"):
        return 1.0
    return 1.0


def _default_contract_size(symbol: str, metadata: dict[str, Any]) -> float:
    contract_sizes = metadata.get("contract_sizes") if isinstance(metadata.get("contract_sizes"), dict) else {}
    if symbol in contract_sizes:
        return max(1.0, _to_float(contract_sizes.get(symbol), 1.0))
    normalized = symbol.upper()
    if normalized in {"XAUUSD", "XAGUSD"}:
        return 100.0
    if len(normalized) == 6 and normalized.isalpha():
        return 100000.0
    if normalized.startswith("BTC") or normalized.startswith("ETH"):
        return 1.0
    return 1.0


def _normalized_balances_from_account(account: dict[str, Any]) -> list[dict[str, Any]]:
    metadata = account.get("metadata") if isinstance(account.get("metadata"), dict) else {}
    as_of = _now_iso()
    source = "mt5-bridge-normalized"
    balances_raw = metadata.get("balances")
    normalized: list[dict[str, Any]] = []
    if isinstance(balances_raw, list):
        for item in balances_raw:
            if not isinstance(item, dict):
                continue
            asset_symbol = str(item.get("asset_symbol") or item.get("currency") or item.get("asset") or metadata.get("currency") or "USD").upper()
            available_qty = _to_float(item.get("available_qty", item.get("free", item.get("available", item.get("balance", 0.0)))), 0.0)
            locked_qty = _to_float(item.get("locked_qty", item.get("locked", 0.0)), 0.0)
            mark_price_usd = _to_float(item.get("mark_price_usd"), 1.0 if asset_symbol in {"USD", "USDT"} else 0.0)
            equity_usd = _to_float(item.get("equity_usd"), (available_qty + locked_qty) * (mark_price_usd or 1.0))
            normalized.append(
                {
                    "asset_symbol": asset_symbol,
                    "available_qty": available_qty,
                    "locked_qty": locked_qty,
                    "equity_usd": equity_usd,
                    "mark_price_usd": mark_price_usd or None,
                    "as_of": as_of,
                    "source": source,
                    "payload": item,
                }
            )
    if normalized:
        return normalized

    currency = str(metadata.get("base_currency") or metadata.get("currency") or "USD").upper()
    default_equity_usd = 100000.0 if str(account.get("mode", "paper")) == "paper" else 25000.0
    raw_balance = metadata.get("balance")
    raw_equity = metadata.get("equity")
    raw_available = metadata.get("free_margin", metadata.get("available_balance"))
    available_qty = _to_float(raw_available, -1.0)
    locked_qty = max(0.0, _to_float(metadata.get("margin_used", 0.0), 0.0))
    equity_usd = _to_float(raw_equity if raw_equity is not None else raw_balance, default_equity_usd)
    if equity_usd <= 0:
        equity_usd = default_equity_usd
    if available_qty <= 0:
        available_qty = max(0.0, equity_usd - locked_qty)
    return [
        {
            "asset_symbol": currency,
            "available_qty": available_qty,
            "locked_qty": locked_qty,
            "equity_usd": equity_usd,
            "mark_price_usd": 1.0 if currency in {"USD", "USDT"} else None,
            "as_of": as_of,
            "source": source,
            "payload": metadata,
        }
    ]


def _normalized_positions_from_broker_state(account: dict[str, Any]) -> list[dict[str, Any]]:
    metadata = account.get("metadata") if isinstance(account.get("metadata"), dict) else {}
    raw_positions = metadata.get("positions") if isinstance(metadata.get("positions"), list) else []
    if not raw_positions:
        return []
    normalized: list[dict[str, Any]] = []
    as_of_default = _now_iso()
    for item in raw_positions:
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol") or item.get("instrument") or "").strip().upper()
        if not symbol:
            continue
        side = str(item.get("side") or item.get("position_side") or "").strip().lower()
        if side in {"buy", "long"}:
            normalized_side = "long"
        elif side in {"sell", "short"}:
            normalized_side = "short"
        else:
            normalized_side = "flat"
        quantity = abs(_to_float(item.get("quantity"), _to_float(item.get("lots"), _to_float(item.get("volume"), 0.0))))
        mark_price = _to_float(item.get("mark_price"), _to_float(item.get("last_price"), _default_mark_price(symbol, metadata)))
        avg_entry_price = _to_float(item.get("avg_entry_price"), _to_float(item.get("entry_price"), mark_price))
        notional_usd = abs(_to_float(item.get("notional_usd"), quantity * (mark_price or avg_entry_price)))
        if quantity <= 0 and notional_usd <= 0:
            continue
        as_of = str(item.get("as_of") or item.get("updated_at") or item.get("timestamp") or as_of_default)
        normalized.append(
            {
                "position_id": str(item.get("position_id") or f"mt5:{account['account_id']}:{symbol}").strip(),
                "account_id": account["account_id"],
                "symbol": symbol,
                "instrument": symbol,
                "side": normalized_side,
                "quantity": quantity,
                "notional_usd": notional_usd,
                "avg_entry_price": avg_entry_price,
                "mark_price": mark_price,
                "pnl_unrealized_usd": _to_float(item.get("pnl_unrealized_usd"), _to_float(item.get("profit"), 0.0)),
                "pnl_realized_usd": _to_float(item.get("pnl_realized_usd"), 0.0),
                "entry_notional_usd": abs(_to_float(item.get("entry_notional_usd"), quantity * (avg_entry_price or mark_price))),
                "as_of": as_of,
                "source": "mt5-broker-position",
                "payload": {
                    **item,
                    "truth_source": "mt5-broker-state",
                },
            }
        )
    return normalized


def _normalized_protective_orders_from_broker_state(account: dict[str, Any]) -> list[dict[str, Any]]:
    metadata = account.get("metadata") if isinstance(account.get("metadata"), dict) else {}
    raw_orders = metadata.get("protective_orders") if isinstance(metadata.get("protective_orders"), list) else []
    normalized: list[dict[str, Any]] = []
    as_of_default = _now_iso()
    for item in raw_orders:
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol") or item.get("instrument") or "").strip().upper()
        if not symbol:
            continue
        order_type = str(item.get("order_type") or item.get("type") or item.get("kind") or "").strip().upper()
        trigger_price = _to_float(item.get("trigger_price"), _to_float(item.get("price"), _to_float(item.get("stop_price"), 0.0)))
        if trigger_price <= 0:
            continue
        side = str(item.get("position_side") or item.get("side") or "").strip().upper()
        if side in {"BUY", "LONG"}:
            position_side = "LONG"
        elif side in {"SELL", "SHORT"}:
            position_side = "SHORT"
        else:
            position_side = ""
        normalized.append(
            {
                "order_id": str(item.get("order_id") or item.get("ticket") or item.get("id") or "").strip(),
                "symbol": symbol,
                "position_side": position_side,
                "order_type": order_type,
                "trigger_price": trigger_price,
                "working_type": str(item.get("working_type") or "MARK_PRICE").strip() or "MARK_PRICE",
                "status": str(item.get("status") or "OPEN").strip() or "OPEN",
                "as_of": str(item.get("as_of") or item.get("updated_at") or item.get("timestamp") or as_of_default),
                "source": "mt5-broker-protective-order",
                "payload": item,
            }
        )
    return normalized


def _sanitize_mt5_broker_state_rows(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _merge_mt5_broker_state_metadata(existing_metadata: dict[str, Any] | None, payload: dict[str, Any] | None) -> dict[str, Any]:
    metadata = dict(existing_metadata) if isinstance(existing_metadata, dict) else {}
    request_payload = payload if isinstance(payload, dict) else {}
    broker_state = request_payload.get("broker_state") if isinstance(request_payload.get("broker_state"), dict) else request_payload

    if isinstance(broker_state, dict) and broker_state:
        metadata["broker_state"] = dict(broker_state)

    positions = _sanitize_mt5_broker_state_rows(broker_state.get("positions"))
    if positions:
        metadata["positions"] = positions
    protective_orders = _sanitize_mt5_broker_state_rows(broker_state.get("protective_orders"))
    if protective_orders:
        metadata["protective_orders"] = protective_orders
    balances = _sanitize_mt5_broker_state_rows(broker_state.get("balances"))
    if balances:
        metadata["balances"] = balances

    quotes_dict = broker_state.get("quotes") if isinstance(broker_state.get("quotes"), dict) else None
    quotes_rows = _sanitize_mt5_broker_state_rows(broker_state.get("quotes"))
    if isinstance(quotes_dict, dict) and quotes_dict:
        metadata["quotes"] = dict(quotes_dict)
    elif quotes_rows:
        metadata["quotes"] = quotes_rows

    broker_session = broker_state.get("session") if isinstance(broker_state.get("session"), dict) else request_payload.get("session") if isinstance(request_payload.get("session"), dict) else None
    if isinstance(broker_session, dict) and broker_session:
        existing_runtime_session = metadata.get("broker_runtime_session") if isinstance(metadata.get("broker_runtime_session"), dict) else {}
        metadata["broker_runtime_session"] = {**existing_runtime_session, **broker_session}

    truth_source = str(
        broker_state.get("truth_source")
        or request_payload.get("truth_source")
        or metadata.get("truth_source")
        or "mt5-broker-state"
    ).strip() or "mt5-broker-state"
    metadata["truth_source"] = truth_source
    metadata["broker_state_updated_at"] = str(
        broker_state.get("as_of")
        or request_payload.get("as_of")
        or request_payload.get("updated_at")
        or _now_iso()
    )
    requested_account_id = str(request_payload.get("requested_account_id") or "").strip()
    if requested_account_id:
        metadata["last_requested_account_id"] = requested_account_id
    return metadata


async def _request_payload_or_empty(request: Request) -> dict[str, Any]:
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    return payload if isinstance(payload, dict) else {}


def _normalized_positions_from_orders(account: dict[str, Any]) -> list[dict[str, Any]]:
    metadata = account.get("metadata") if isinstance(account.get("metadata"), dict) else {}
    rows = fetch_all(
        """
        SELECT id, symbol, side, lots, created_at, execution_context
        FROM mt5_order_events
        WHERE account_id = %s AND status = ANY(%s)
        ORDER BY created_at ASC, id ASC
        """,
        (account["account_id"], sorted(_MT5_LIVE_SUCCESS_STATUSES)),
    )
    grouped: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "net_lots": 0.0,
        "weighted_lots": 0.0,
        "weighted_entry": 0.0,
        "last_created_at": None,
        "payload_rows": [],
    })
    for row in rows:
        symbol = str(row.get("symbol") or "").upper()
        if not symbol:
            continue
        lots = _to_float(row.get("lots"), 0.0)
        signed_lots = lots if str(row.get("side") or "buy") == "buy" else -lots
        execution_context = row.get("execution_context") if isinstance(row.get("execution_context"), dict) else {}
        mark_price = _default_mark_price(symbol, metadata)
        route = execution_context.get("chosen_route") if isinstance(execution_context.get("chosen_route"), dict) else {}
        implied_entry = _to_float(route.get("last") or route.get("mid") or route.get("reference_price"), mark_price)
        bucket = grouped[symbol]
        bucket["net_lots"] += signed_lots
        bucket["weighted_lots"] += abs(lots)
        bucket["weighted_entry"] += abs(lots) * implied_entry
        bucket["last_created_at"] = row.get("created_at")
        bucket["payload_rows"].append(_json_safe_row(row))

    positions: list[dict[str, Any]] = []
    for symbol, bucket in grouped.items():
        net_lots = _to_float(bucket.get("net_lots"), 0.0)
        if abs(net_lots) < 1e-9:
            continue
        mark_price = _default_mark_price(symbol, metadata)
        contract_size = _default_contract_size(symbol, metadata)
        avg_entry_price = _to_float(bucket.get("weighted_entry"), 0.0) / max(_to_float(bucket.get("weighted_lots"), 0.0), 1e-9)
        quantity = abs(net_lots)
        notional_usd = quantity * contract_size * mark_price
        entry_notional_usd = quantity * contract_size * (avg_entry_price or mark_price)
        side = "long" if net_lots > 0 else "short"
        direction = 1.0 if side == "long" else -1.0
        pnl_unrealized_usd = direction * (mark_price - (avg_entry_price or mark_price)) * quantity * contract_size
        last_created_at = bucket.get("last_created_at")
        as_of = last_created_at.isoformat() if isinstance(last_created_at, datetime) else _now_iso()
        positions.append(
            {
                "position_id": f"mt5:{account['account_id']}:{symbol}",
                "account_id": account["account_id"],
                "symbol": symbol,
                "instrument": symbol,
                "side": side,
                "quantity": quantity,
                "notional_usd": notional_usd,
                "avg_entry_price": avg_entry_price or mark_price,
                "mark_price": mark_price,
                "pnl_unrealized_usd": pnl_unrealized_usd,
                "pnl_realized_usd": 0.0,
                "entry_notional_usd": entry_notional_usd,
                "as_of": as_of,
                "source": "mt5-bridge-normalized",
                "payload": {
                    "contract_size": contract_size,
                    "mode": account.get("mode"),
                    "truth_source": "mt5-order-events-reconstructed",
                    "events": bucket.get("payload_rows", []),
                },
            }
        )
    positions.sort(key=lambda item: (str(item["symbol"]), str(item["as_of"])), reverse=False)
    return positions


def _merge_mt5_broker_session_metadata(
    metadata: dict[str, Any] | None,
    broker_session: dict[str, Any] | None,
    merge: bool = True,
) -> dict[str, Any]:
    current = dict(metadata or {})
    if not isinstance(broker_session, dict):
        broker_session = {}
    existing_session = current.get("broker_session") if isinstance(current.get("broker_session"), dict) else {}
    current["broker_session"] = {**existing_session, **broker_session} if merge else dict(broker_session)
    return current


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.on_event("startup")
async def startup() -> None:
    ensure_schema()


@app.get("/health")
async def health() -> dict[str, Any]:
    accounts = fetch_one("SELECT COUNT(*) AS count FROM mt5_accounts") or {"count": 0}
    return {
        "status": "ok",
        "service": "mt5-bridge",
        "mode": os.getenv("MT5_BRIDGE_MODE", "paper"),
        "accounts": int(accounts["count"]),
        "ts": _now_iso(),
    }


@app.get("/status")
async def status() -> dict[str, Any]:
    rows = fetch_all(
        """
        SELECT account_id, mode, status, updated_at
        FROM mt5_accounts
        ORDER BY updated_at DESC
        LIMIT 50
        """
    )
    connected = sum(1 for row in rows if str(row.get("status") or "").strip().lower() == "connected")
    return {
        "status": "ok",
        "service": "mt5-bridge",
        "accounts_total": len(rows),
        "accounts_connected": connected,
        "accounts": [{
            "account_id": str(row.get("account_id") or ""),
            "mode": str(row.get("mode") or ""),
            "status": str(row.get("status") or ""),
            "updated_at": row.get("updated_at").isoformat() if isinstance(row.get("updated_at"), datetime) else row.get("updated_at"),
        } for row in rows],
    }


@app.get("/symbols")
async def symbols(account_id: str = "") -> dict[str, Any]:
    if account_id.strip():
        account, _ = _resolve_runtime_account(account_id.strip())
    else:
        account = fetch_one("SELECT * FROM mt5_accounts WHERE status = 'connected' ORDER BY updated_at DESC LIMIT 1")
        if not account:
            account = fetch_one("SELECT * FROM mt5_accounts ORDER BY updated_at DESC LIMIT 1")
    if not account:
        raise HTTPException(status_code=404, detail="MT5 account not found")
    return {
        "status": "ok",
        "service": "mt5-bridge",
        "account_id": str(account.get("account_id") or ""),
        "symbols": _listed_symbols_for_account(account),
    }


@app.get("/quote/{symbol}")
async def quote(symbol: str, account_id: str = "") -> dict[str, Any]:
    if account_id.strip():
        account, _ = _resolve_runtime_account(account_id.strip())
    else:
        account = fetch_one("SELECT * FROM mt5_accounts WHERE status = 'connected' ORDER BY updated_at DESC LIMIT 1")
        if not account:
            account = fetch_one("SELECT * FROM mt5_accounts ORDER BY updated_at DESC LIMIT 1")
    if not account:
        raise HTTPException(status_code=404, detail="MT5 account not found")
    snapshot = _extract_quote_snapshot(account, symbol)
    return {
        "status": "ok",
        "service": "mt5-bridge",
        "account_id": str(account.get("account_id") or ""),
        **snapshot,
    }


@app.get("/v1/accounts/{account_id}/quote/{symbol}")
async def account_quote(account_id: str, symbol: str) -> dict[str, Any]:
    account, requested_account_id = _resolve_runtime_account(account_id)
    snapshot = _extract_quote_snapshot(account, symbol)
    return {
        "status": "ok",
        "service": "mt5-bridge",
        "requested_account_id": requested_account_id,
        "account_id": str(account.get("account_id") or ""),
        **snapshot,
    }


@app.get("/v1/accounts")
async def list_accounts() -> list[dict[str, Any]]:
    return fetch_all(
        """
        SELECT account_id, broker, server, login, mode, status, metadata, created_at, updated_at
        FROM mt5_accounts
        ORDER BY updated_at DESC
        """
    )


@app.post("/v1/accounts")
async def upsert_account(request: Mt5AccountCreateRequest) -> dict[str, Any]:
    execute(
        """
        INSERT INTO mt5_accounts (account_id, broker, server, login, mode, status, metadata)
        VALUES (%s, %s, %s, %s, %s, 'connected', %s::jsonb)
        ON CONFLICT (account_id) DO UPDATE SET
            broker = EXCLUDED.broker,
            server = EXCLUDED.server,
            login = EXCLUDED.login,
            mode = EXCLUDED.mode,
            status = 'connected',
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        """,
        (
            request.account_id,
            request.broker,
            request.server,
            request.login,
            request.mode,
            json_dumps(request.metadata),
        ),
    )
    row = fetch_one("SELECT * FROM mt5_accounts WHERE account_id = %s", (request.account_id,))
    return {"status": "connected", "account": row}


@app.get("/v1/accounts/{account_id}")
async def account_status(account_id: str) -> dict[str, Any]:
    account = fetch_one("SELECT * FROM mt5_accounts WHERE account_id = %s", (account_id,))
    if not account:
        raise HTTPException(status_code=404, detail="MT5 account not found")
    return {"status": "ok", "account": account}


@app.patch("/v1/accounts/{account_id}/broker-session")
async def update_account_broker_session(account_id: str, request: Mt5BrokerSessionUpdateRequest) -> dict[str, Any]:
    account = fetch_one("SELECT * FROM mt5_accounts WHERE account_id = %s", (account_id,))
    if not account:
        raise HTTPException(status_code=404, detail="MT5 account not found")

    metadata = _merge_mt5_broker_session_metadata(account.get("metadata"), request.broker_session, merge=bool(request.merge))
    execute(
        """
        UPDATE mt5_accounts
        SET metadata = %s::jsonb,
            updated_at = NOW()
        WHERE account_id = %s
        """,
        (json_dumps(metadata), account_id),
    )
    row = fetch_one("SELECT * FROM mt5_accounts WHERE account_id = %s", (account["account_id"],))
    return {
        "status": "updated",
        "account": row,
        "broker_session": metadata.get("broker_session") if isinstance(metadata.get("broker_session"), dict) else {},
    }


@app.post("/v1/accounts/{account_id}/broker-state")
async def upsert_account_broker_state(account_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    account, requested_account_id = _resolve_runtime_account(account_id)
    request_payload = payload if isinstance(payload, dict) else {}
    request_payload.setdefault("requested_account_id", requested_account_id)
    metadata = _merge_mt5_broker_state_metadata(account.get("metadata"), request_payload)
    connected = request_payload.get("connected")
    requested_status = str(request_payload.get("status") or account.get("status") or "connected").strip().lower() or "connected"
    if connected is False:
        requested_status = "disconnected"
    elif connected is True and requested_status in {"", "disconnected"}:
        requested_status = "connected"
    execute(
        """
        UPDATE mt5_accounts
        SET status = %s,
            metadata = %s::jsonb,
            updated_at = NOW()
        WHERE account_id = %s
        """,
        (
            requested_status,
            json_dumps(metadata),
            account["account_id"],
        ),
    )
    row = fetch_one("SELECT * FROM mt5_accounts WHERE account_id = %s", (account["account_id"],))
    return {
        "status": "updated",
        "requested_account_id": requested_account_id,
        "account_id": account["account_id"],
        "account": row,
        "summary": {
            "positions_count": len(metadata.get("positions") if isinstance(metadata.get("positions"), list) else []),
            "protective_order_count": len(metadata.get("protective_orders") if isinstance(metadata.get("protective_orders"), list) else []),
            "balance_count": len(metadata.get("balances") if isinstance(metadata.get("balances"), list) else []),
            "truth_source": metadata.get("truth_source"),
            "broker_state_updated_at": metadata.get("broker_state_updated_at"),
        },
    }


@app.post("/v1/accounts/{account_id}/heartbeat.mql")
async def account_heartbeat_mql(account_id: str, request: Request) -> dict[str, Any]:
    account, requested_account_id = _resolve_runtime_account(account_id)
    payload = await _request_payload_or_empty(request)
    session_payload = payload.get("session") if isinstance(payload.get("session"), dict) else payload
    metadata = dict(account.get("metadata") if isinstance(account.get("metadata"), dict) else {})
    runtime_session = dict(metadata.get("broker_runtime_session") if isinstance(metadata.get("broker_runtime_session"), dict) else {})
    runtime_session.update(
        {
            **{key: value for key, value in session_payload.items() if key in {"client_id", "login", "server", "terminal", "company", "watchdog_state"}},
            "account_id": account["account_id"],
            "requested_account_id": requested_account_id,
            "connected": payload.get("connected", session_payload.get("connected", True)),
            "last_heartbeat_at": _now_iso(),
        }
    )
    metadata["broker_runtime_session"] = runtime_session
    metadata["last_requested_account_id"] = requested_account_id
    execute(
        """
        UPDATE mt5_accounts
        SET status = 'connected',
            metadata = %s::jsonb,
            updated_at = NOW()
        WHERE account_id = %s
        """,
        (json_dumps(metadata), account["account_id"]),
    )
    return {
        "status": "ok",
        "account_id": account["account_id"],
        "requested_account_id": requested_account_id,
        "server_time": _now_iso(),
    }


@app.get("/v1/accounts/{account_id}/commands.mql", response_model=None)
async def account_commands_mql(account_id: str, request: Request = None, client_id: str = "", limit: int = 5) -> Any:
    account, requested_account_id = _resolve_runtime_account(account_id)
    safe_limit = max(1, min(int(limit or 5), 25))
    safe_client_id = str(client_id or "").strip()
    rows = fetch_all(
        """
        WITH due AS (
            SELECT command_id
            FROM mt5_order_commands
            WHERE account_id = %s
              AND status IN ('queued', 'inflight')
              AND expires_at > NOW()
              AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
              AND (%s = '' OR client_id = '' OR client_id = %s)
            ORDER BY created_at ASC
            LIMIT %s
        )
        UPDATE mt5_order_commands c
        SET status = 'inflight',
            dispatched_at = COALESCE(c.dispatched_at, NOW()),
            lease_expires_at = NOW() + INTERVAL '30 seconds'
        FROM due
        WHERE c.command_id = due.command_id
        RETURNING c.command_id, c.account_id, c.requested_account_id, c.client_id, c.command_type, c.status, c.payload, c.created_at, c.expires_at
        """,
        (account["account_id"], safe_client_id, safe_client_id, safe_limit),
    )
    execute(
        """
        UPDATE mt5_order_commands
        SET status = 'expired',
            error_message = COALESCE(error_message, 'command expired before EA result')
        WHERE account_id = %s
          AND status IN ('queued', 'inflight')
          AND expires_at <= NOW()
        """,
        (account["account_id"],),
    )
    if _mql_plaintext_requested(request):
        return PlainTextResponse(
            _format_mql_command_batch(rows),
            headers={
                "X-TXT-Account-Id": str(account["account_id"]),
                "X-TXT-Requested-Account-Id": requested_account_id,
            },
        )
    return {
        "status": "ok",
        "account_id": account["account_id"],
        "requested_account_id": requested_account_id,
        "client_id": safe_client_id,
        "commands": [
            {
                "command_id": row["command_id"],
                "type": row.get("command_type") or "place_order",
                "status": row.get("status") or "inflight",
                "payload": row.get("payload") if isinstance(row.get("payload"), dict) else {},
                "created_at": row.get("created_at").isoformat() if isinstance(row.get("created_at"), datetime) else row.get("created_at"),
                "expires_at": row.get("expires_at").isoformat() if isinstance(row.get("expires_at"), datetime) else row.get("expires_at"),
            }
            for row in rows
        ],
        "limit": safe_limit,
        "server_time": _now_iso(),
    }


@app.post("/v1/accounts/{account_id}/commands/{command_id}/result.mql")
async def account_command_result_mql(account_id: str, command_id: str, request: Request) -> dict[str, Any]:
    account, requested_account_id = _resolve_runtime_account(account_id)
    if _mql_plaintext_requested(request):
        raw_payload = _parse_mql_key_value_body((await request.body()).decode("utf-8", errors="replace"))
    else:
        raw_payload = await _request_payload_or_empty(request)
    result_request = Mt5CommandResultRequest(**raw_payload)
    command = fetch_one(
        """
        SELECT command_id, account_id, status, payload
        FROM mt5_order_commands
        WHERE command_id = %s AND account_id = %s
        """,
        (command_id, account["account_id"]),
    )
    if not command:
        command = fetch_one(
            """
            SELECT command_id, account_id, status, payload
            FROM mt5_order_commands
            WHERE account_id = %s AND payload->>'mql_id' = %s
            """,
            (account["account_id"], command_id),
        )
    if not command:
        raise HTTPException(status_code=404, detail="MT5 command not found")
    payload = {**raw_payload, **result_request.model_dump(exclude_none=True)}
    payload_result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
    combined_payload = {**payload_result, **{key: value for key, value in payload.items() if key != "result"}}
    raw_status = str(result_request.status or combined_payload.get("status") or combined_payload.get("result") or "").strip().lower()
    broker_ticket = _extract_broker_ticket(combined_payload) or str(result_request.broker_ticket or result_request.ticket or result_request.order_id or result_request.deal_id or "").strip()
    if broker_ticket and raw_status in {"", "ok", "success", "filled", "executed", "accepted"}:
        next_status = "executed"
    elif raw_status in {"expired", "cancelled", "canceled"}:
        next_status = "expired" if raw_status == "expired" else "cancelled"
    else:
        next_status = "rejected" if raw_status in {"rejected", "reject", "blocked"} else "failed"
    error_message = "" if next_status == "executed" else str(result_request.error_message or result_request.detail or combined_payload.get("error_message") or combined_payload.get("detail") or raw_status or "MT5 EA command failed")[:500]
    execute(
        """
        UPDATE mt5_order_commands
        SET status = %s,
            result_payload = %s::jsonb,
            broker_ticket = NULLIF(%s, ''),
            error_message = NULLIF(%s, ''),
            acknowledged_at = NOW(),
            lease_expires_at = NULL
        WHERE command_id = %s AND account_id = %s
        """,
        (next_status, json_dumps(combined_payload), broker_ticket, error_message, command["command_id"], account["account_id"]),
    )

    broker_state = result_request.broker_state if isinstance(result_request.broker_state, dict) else {}
    session = result_request.session if isinstance(result_request.session, dict) else {}
    if broker_state or session:
        state_payload: dict[str, Any] = {
            "truth_source": "mt5-ea-command-result",
            "as_of": _now_iso(),
        }
        if broker_state:
            state_payload["broker_state"] = broker_state
        if session:
            state_payload["session"] = session
        metadata = _merge_mt5_broker_state_metadata(account.get("metadata"), state_payload)
        execute(
            """
            UPDATE mt5_accounts
            SET metadata = %s::jsonb,
                updated_at = NOW()
            WHERE account_id = %s
            """,
            (json_dumps(metadata), account["account_id"]),
        )

    return {
        "status": "ok",
        "account_id": account["account_id"],
        "requested_account_id": requested_account_id,
        "command_id": command["command_id"],
        "requested_command_id": command_id,
        "command_status": next_status,
        "broker_ticket": broker_ticket,
        "server_time": _now_iso(),
    }


@app.get("/v1/accounts/{account_id}/normalized-state")
async def account_normalized_state(account_id: str) -> dict[str, Any]:
    account = fetch_one("SELECT * FROM mt5_accounts WHERE account_id = %s", (account_id,))
    if not account:
        raise HTTPException(status_code=404, detail="MT5 account not found")
    balances = _normalized_balances_from_account(account)
    broker_positions = _normalized_positions_from_broker_state(account)
    positions = broker_positions if broker_positions else _normalized_positions_from_orders(account)
    protective_orders = _normalized_protective_orders_from_broker_state(account)
    truth_source = "mt5-broker-state" if broker_positions else "mt5-order-events-reconstructed"
    equity_usd = sum(_to_float(item.get("equity_usd"), 0.0) for item in balances)
    gross_exposure_usd = sum(abs(_to_float(item.get("notional_usd"), 0.0)) for item in positions)
    net_exposure_usd = sum(
        abs(_to_float(item.get("notional_usd"), 0.0)) if str(item.get("side")) == "long" else -abs(_to_float(item.get("notional_usd"), 0.0))
        for item in positions
    )
    as_of_candidates = [str(item.get("as_of")) for item in balances + positions if item.get("as_of")]
    return {
        "status": "ok",
        "service": "mt5-bridge",
        "account": _json_safe_row(account),
        "as_of": max(as_of_candidates) if as_of_candidates else _now_iso(),
        "balances": balances,
        "positions": positions,
        "protective_orders": protective_orders,
        "truth_source": truth_source,
        "positions_source": truth_source,
        "summary": {
            "equity_usd": equity_usd,
            "gross_exposure_usd": gross_exposure_usd,
            "net_exposure_usd": net_exposure_usd,
            "position_count": len(positions),
            "balance_count": len(balances),
            "protective_order_count": len(protective_orders),
        },
    }


@app.post("/v1/orders/filter")
async def filter_order(request: Mt5OrderFilterRequest) -> dict[str, Any]:
    account = fetch_one("SELECT account_id, mode, status, metadata FROM mt5_accounts WHERE account_id = %s", (request.account_id,))
    if not account:
        raise HTTPException(status_code=404, detail="MT5 account not found")
    if account["status"] != "connected":
        raise HTTPException(status_code=409, detail="MT5 account disconnected")

    chosen_venue = str((request.chosen_route or {}).get("venue") or "mt5-default")
    if str(account.get("mode") or "paper") == "live":
        result = await _execute_live_order_via_broker_session(account, request)
    else:
        started_at = datetime.now(timezone.utc)
        ticket = f"{chosen_venue}-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        route_spread_bps = float((request.chosen_route or {}).get("spread_bps") or (request.chosen_route or {}).get("spread") or 0.0)
        baseline_slippage = route_spread_bps if route_spread_bps > 0 else float(request.max_spread_bps) * 0.72
        realized_slippage_bps = round(min(float(request.max_spread_bps), max(0.5, baseline_slippage * 1.05)), 3)
        latency_ms = int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000) + 30
        result = {
            "status": "accepted",
            "bridge_mode": account["mode"],
            "broker_ticket": ticket,
            "account_id": request.account_id,
            "symbol": request.symbol,
            "side": request.side,
            "lots": request.lots,
            "chosen_route": request.chosen_route,
            "realized_slippage_bps": realized_slippage_bps,
            "expected_slippage_bps": request.expected_slippage_bps,
            "latency_ms": latency_ms,
        }

    execute(
        """
        INSERT INTO mt5_order_events (account_id, symbol, side, lots, mode, status, risk_gate, broker_ticket, notes, chosen_route, expected_slippage_bps, execution_context)
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s::jsonb)
        """,
        (
            request.account_id,
            result["symbol"],
            request.side,
            request.lots,
            account["mode"],
            result["status"],
            json_dumps(request.risk_gate),
            result["broker_ticket"],
            request.rationale,
            chosen_venue,
            request.expected_slippage_bps,
            json_dumps({
                "routing_plan": request.routing_plan,
                "chosen_route": request.chosen_route,
                "tradability": result.get("tradability"),
                "external_execution": result.get("external_execution"),
                "broker_ticket_source": "real_ea_command_result" if str((result.get("external_execution") or {}).get("executor") or "") == "mt5-ea-command-queue" else "external_or_paper",
            }),
        ),
    )

    return result


@app.get("/v1/orders/history")
async def order_history(limit: int = 30) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 200))
    return fetch_all(
        """
        SELECT id, account_id, symbol, side, lots, mode, status, risk_gate, broker_ticket, notes, chosen_route, expected_slippage_bps, execution_context, created_at
        FROM mt5_order_events
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (safe_limit,),
    )
