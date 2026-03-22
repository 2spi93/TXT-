from __future__ import annotations

import os
from datetime import datetime, timezone
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException

from shared.db import ensure_schema, execute, fetch_all, fetch_one
from shared.models import ExecutionRequest, OrderResult

app = FastAPI(title="Execution Router", version="0.1.0")

ORDERS: list[OrderResult] = []
POSITIONS: dict[str, float] = {}
MARKET_DATA_URL = os.getenv("MARKET_DATA_URL", "http://127.0.0.1:8003")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_symbol(symbol: str) -> str:
    return symbol.replace("-PERP", "").replace("/", "").replace("-", "").upper()


def _to_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


async def _build_route_candidates(symbol: str) -> list[dict]:
    normalized = _normalize_symbol(symbol)
    async with httpx.AsyncClient(timeout=10.0) as client:
        quotes_response = await client.get(f"{MARKET_DATA_URL}/v1/quotes")
        quotes = quotes_response.json() if quotes_response.status_code < 400 else []

        candidates: list[dict] = []
        for quote in quotes:
            if _normalize_symbol(str(quote.get("instrument", ""))) != normalized:
                continue
            venue = str(quote.get("venue", "unknown"))
            spread_bps = _to_float(quote.get("spread_bps"), 9999.0)
            depth_response = await client.get(
                f"{MARKET_DATA_URL}/v1/market/orderbook/depth",
                params={"venue": venue, "instrument": normalized},
            )
            depth_payload = depth_response.json() if depth_response.status_code < 400 else {}
            book = (depth_payload or {}).get("depth_payload", {})
            bids = book.get("bids", []) if isinstance(book, dict) else []
            asks = book.get("asks", []) if isinstance(book, dict) else []

            bid_depth_usd = 0.0
            ask_depth_usd = 0.0
            for level in bids[:8]:
                if isinstance(level, list) and len(level) >= 2:
                    bid_depth_usd += _to_float(level[0]) * _to_float(level[1])
            for level in asks[:8]:
                if isinstance(level, list) and len(level) >= 2:
                    ask_depth_usd += _to_float(level[0]) * _to_float(level[1])

            available_depth_usd = min(bid_depth_usd, ask_depth_usd) if bid_depth_usd > 0 and ask_depth_usd > 0 else max(bid_depth_usd, ask_depth_usd)
            score = max(0.0, 100.0 - spread_bps * 2.2 + min(40.0, available_depth_usd / 20000.0))
            candidates.append(
                {
                    "venue": venue,
                    "instrument": normalized,
                    "spread_bps": spread_bps,
                    "available_depth_usd": available_depth_usd,
                    "best_bid": _to_float(depth_payload.get("best_bid"), 0.0),
                    "best_ask": _to_float(depth_payload.get("best_ask"), 0.0),
                    "score": score,
                    "depth_payload": book,
                }
            )

    return sorted(candidates, key=lambda item: item["score"], reverse=True)


def _simulate_fills(decision_id: str, side: str, notional_usd: float, depth_payload: dict, venue: str, instrument: str) -> tuple[list[dict], float]:
    book_side = depth_payload.get("asks", []) if side == "buy" else depth_payload.get("bids", [])
    remaining = max(0.0, notional_usd)
    fills: list[dict] = []
    filled_notional = 0.0
    weighted_price = 0.0

    for level_index, level in enumerate(book_side[:20]):
      if not (isinstance(level, list) and len(level) >= 2):
          continue
      price = _to_float(level[0], 0.0)
      size_base = _to_float(level[1], 0.0)
      level_notional = price * size_base
      if price <= 0 or size_base <= 0 or level_notional <= 0:
          continue

      take_notional = min(level_notional, remaining)
      take_size_base = take_notional / price
      fill_id = f"{decision_id}-f{len(fills) + 1}"
      fill = {
          "fill_id": fill_id,
          "decision_id": decision_id,
          "venue": venue,
          "instrument": instrument,
          "side": side,
          "price": price,
          "size_base": take_size_base,
          "notional_usd": take_notional,
          "depth_level": level_index,
          "fill_type": "book",
          "fill_latency_ms": 18 + (level_index * 7),
          "filled_at": _now_iso(),
      }
      fills.append(fill)
      filled_notional += take_notional
      weighted_price += price * take_notional
      remaining -= take_notional
      if remaining <= 1e-9:
          break

    if remaining > 0:
        fallback_price = _to_float((book_side[0] if book_side else [1.0])[0], 1.0)
        fill_id = f"{decision_id}-f{len(fills) + 1}"
        fill = {
            "fill_id": fill_id,
            "decision_id": decision_id,
            "venue": venue,
            "instrument": instrument,
            "side": side,
            "price": fallback_price,
            "size_base": remaining / max(fallback_price, 1e-9),
            "notional_usd": remaining,
            "depth_level": 999,
            "fill_type": "residual",
            "fill_latency_ms": 180,
            "filled_at": _now_iso(),
        }
        fills.append(fill)
        filled_notional += remaining
        weighted_price += fallback_price * remaining

    avg_fill_price = weighted_price / max(filled_notional, 1e-9)
    return fills, avg_fill_price


@app.on_event("startup")
async def startup() -> None:
    ensure_schema()


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": "execution-router",
        "orders": len(ORDERS),
        "positions": POSITIONS,
    }


@app.get("/v1/routes/score")
async def route_score(symbol: str) -> dict:
    candidates = await _build_route_candidates(symbol)
    best = candidates[0] if candidates else None
    backup = candidates[1] if len(candidates) > 1 else None
    return {
        "symbol": _normalize_symbol(symbol),
        "best": best,
        "backup": backup,
        "reason": "best_score_from_spread_and_depth" if best else "no_market_candidates",
        "candidates": candidates,
    }


@app.post("/v1/orders/routed")
async def place_routed_order(payload: dict) -> dict:
    symbol = _normalize_symbol(str(payload.get("symbol", "")))
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol is required")
    side = str(payload.get("side", "buy")).lower()
    if side not in {"buy", "sell"}:
        raise HTTPException(status_code=400, detail="side must be buy/sell")
    notional = _to_float(payload.get("estimated_notional_usd"), 0.0)
    if notional <= 0:
        raise HTTPException(status_code=400, detail="estimated_notional_usd must be > 0")

    candidates = await _build_route_candidates(symbol)
    if not candidates:
        raise HTTPException(status_code=502, detail="no route candidates available")

    preferred_venue = str(payload.get("preferred_venue", "")).strip()
    selected = candidates[0]
    if preferred_venue:
        for candidate in candidates:
            if str(candidate.get("venue")) == preferred_venue:
                selected = candidate
                break

    backup = None
    for candidate in candidates:
        if candidate.get("venue") != selected.get("venue"):
            backup = candidate
            break

    decision_id = str(payload.get("decision_id") or f"route-{uuid4()}")
    fills, avg_fill_price = _simulate_fills(
        decision_id=decision_id,
        side=side,
        notional_usd=notional,
        depth_payload=(selected.get("depth_payload") or {}),
        venue=str(selected.get("venue", "unknown")),
        instrument=symbol,
    )

    filled_notional = sum(_to_float(fill.get("notional_usd"), 0.0) for fill in fills)
    spread_bps = _to_float(selected.get("spread_bps"), 0.0)
    reference_price = _to_float(selected.get("best_ask" if side == "buy" else "best_bid"), avg_fill_price)
    expected_slippage_bps = max(0.2, spread_bps * 0.7)
    realized_slippage_bps = abs(avg_fill_price - reference_price) / max(reference_price, 1e-9) * 10000
    fill_quality_score = max(0.0, 100.0 - spread_bps * 1.6 - realized_slippage_bps * 2.0)

    signed_notional = filled_notional if side == "buy" else -filled_notional
    POSITIONS[symbol] = POSITIONS.get(symbol, 0.0) + signed_notional

    execution_mode = str(payload.get("execution_mode", "routed"))
    intent_id = str(payload.get("intent_id") or "").strip() or None
    if intent_id and not fetch_one("SELECT intent_id FROM intents WHERE intent_id = %s", (intent_id,)):
        intent_id = None
    order_id = str(payload.get("order_id") or f"routed-{decision_id}")
    execute(
        """
        INSERT INTO orders (order_id, intent_id, venue, instrument, side, requested_notional_usd, filled_notional_usd, avg_fill_price, execution_mode, status)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'filled')
        ON CONFLICT (order_id) DO UPDATE SET
          venue = EXCLUDED.venue,
          filled_notional_usd = EXCLUDED.filled_notional_usd,
          avg_fill_price = EXCLUDED.avg_fill_price,
          execution_mode = EXCLUDED.execution_mode,
          status = EXCLUDED.status
        """,
        (
            order_id,
            intent_id,
            str(selected.get("venue", "unknown")),
            symbol,
            side,
            notional,
            filled_notional,
            avg_fill_price,
            execution_mode,
        ),
    )

    for fill in fills:
        execute(
            """
            INSERT INTO execution_fill_events (decision_id, fill_id, venue, instrument, side, price, size_base, notional_usd, depth_level, fill_type, slippage_bps, fill_latency_ms, payload, filled_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
            ON CONFLICT (decision_id, fill_id) DO NOTHING
            """,
            (
                decision_id,
                str(fill.get("fill_id")),
                str(fill.get("venue")),
                str(fill.get("instrument")),
                side,
                _to_float(fill.get("price"), 0.0),
                _to_float(fill.get("size_base"), 0.0),
                _to_float(fill.get("notional_usd"), 0.0),
                int(fill.get("depth_level", 0)),
                str(fill.get("fill_type", "book")),
                realized_slippage_bps,
                int(fill.get("fill_latency_ms", 0)),
                "{}",
                datetime.fromisoformat(str(fill.get("filled_at"))),
            ),
        )

    order = {
        "decision_id": decision_id,
        "order_id": order_id,
        "status": "filled",
        "venue": str(selected.get("venue", "unknown")),
        "instrument": symbol,
        "side": side,
        "requested_notional_usd": notional,
        "filled_notional_usd": filled_notional,
        "avg_fill_price": avg_fill_price,
        "execution_mode": execution_mode,
        "expected_slippage_bps": expected_slippage_bps,
        "realized_slippage_bps": realized_slippage_bps,
        "fill_quality_score": fill_quality_score,
        "route": {
            "chosen": selected,
            "backup": backup,
            "reason": "best_score_from_spread_and_depth",
        },
        "fills": fills,
        "timestamp": _now_iso(),
    }

    ORDERS.append(
        OrderResult(
            order_id=order_id,
            status="filled",
            venue=order["venue"],
            instrument=symbol,
            side=side,
            requested_notional_usd=notional,
            filled_notional_usd=filled_notional,
            avg_fill_price=avg_fill_price,
            execution_mode=execution_mode,
        )
    )
    return order


@app.get("/v1/orders")
async def list_orders() -> list[OrderResult]:
    rows = fetch_all(
        "SELECT order_id, venue, instrument, side, requested_notional_usd, filled_notional_usd, avg_fill_price, execution_mode, status, created_at AS timestamp FROM orders ORDER BY created_at DESC LIMIT 100"
    )
    if rows:
        for row in rows:
            row["timestamp"] = row["timestamp"].isoformat()
        return [OrderResult.model_validate(row) for row in rows]
    return ORDERS[-100:]


@app.get("/v1/positions")
async def list_positions() -> dict[str, float]:
    rows = fetch_all(
        """
        SELECT instrument, SUM(CASE WHEN side = 'buy' THEN filled_notional_usd ELSE -filled_notional_usd END) AS net_notional_usd
        FROM orders
        GROUP BY instrument
        """
    )
    if rows:
        return {row["instrument"]: row["net_notional_usd"] for row in rows}
    return POSITIONS


@app.post("/v1/orders", response_model=OrderResult)
async def place_order(request: ExecutionRequest) -> OrderResult:
    if request.risk_decision.decision != "accept":
        raise HTTPException(status_code=400, detail="Rejected intent cannot be executed")

    intent = request.intent
    signed_notional = intent.target_notional_usd if intent.side.value == "buy" else -intent.target_notional_usd
    POSITIONS[intent.instrument] = POSITIONS.get(intent.instrument, 0.0) + signed_notional

    order = OrderResult(
        order_id=f"paper-{intent.intent_id}",
        status="filled",
        venue=intent.venue,
        instrument=intent.instrument,
        side=intent.side,
        requested_notional_usd=intent.target_notional_usd,
        filled_notional_usd=intent.target_notional_usd,
        avg_fill_price=1.0,
        execution_mode=request.execution_mode,
    )
    ORDERS.append(order)
    return order