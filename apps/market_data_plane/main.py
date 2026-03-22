from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import websockets
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect

from shared.db import ensure_schema, execute, fetch_all, fetch_one, json_dumps

app = FastAPI(title="Market Data Plane", version="0.3.0")

DEFAULT_SYMBOLS = [symbol.strip() for symbol in os.getenv("MARKET_SYMBOLS", "BTCUSDT,ETHUSDT,SOLUSDT").split(",") if symbol.strip()]
DEFAULT_VENUE = os.getenv("MARKET_PRIMARY_VENUE", "binance-public")
SYNC_SECONDS = max(4, int(os.getenv("MARKET_SYNC_SECONDS", "12")))
MAX_DEPTH_LEVELS = max(5, min(100, int(os.getenv("MARKET_DEPTH_LEVELS", "20"))))
DEPTH_STREAM_ENABLED = os.getenv("MARKET_DEPTH_STREAM_ENABLED", "1").strip().lower() not in {"0", "false", "no"}

SNAPSHOTS = {
    "paper-bitget:BTCUSDT-PERP": {"venue": "paper-bitget", "instrument": "BTCUSDT-PERP", "bid": 68245.5, "ask": 68250.1, "last": 68247.8, "spread_bps": 0.67},
    "paper-coinbase:ETHUSDT-PERP": {"venue": "paper-coinbase", "instrument": "ETHUSDT-PERP", "bid": 3520.2, "ask": 3521.0, "last": 3520.5, "spread_bps": 2.27},
    "paper-polymarket:BTC-UP-THIS-WEEK": {"venue": "paper-polymarket", "instrument": "BTC-UP-THIS-WEEK", "bid": 0.57, "ask": 0.58, "last": 0.575, "spread_bps": 173.91},
}

DEPTH_BOOKS: dict[str, dict[str, Any]] = {}
DEPTH_SUBSCRIBERS: dict[str, set[WebSocket]] = {}
DERIVATIVES_CACHE: dict[str, dict[str, Any]] = {}


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_instrument(instrument: str) -> str:
    return instrument.replace("-PERP", "").replace("/", "").replace("-", "").upper()


def _stream_key(venue: str, instrument: str) -> str:
    return f"{venue}:{_normalize_instrument(instrument)}"


def _session_label(ts: datetime) -> str:
    hour = ts.hour
    if 0 <= hour < 8:
        return "asia"
    if 8 <= hour < 14:
        return "london"
    return "new-york"


def _timeframe_delta(timeframe: str) -> timedelta:
    mapping = {
        "1m": timedelta(minutes=1),
        "5m": timedelta(minutes=5),
        "15m": timedelta(minutes=15),
        "1h": timedelta(hours=1),
    }
    return mapping.get(timeframe, timedelta(minutes=1))


def _bucket_floor(ts: datetime, timeframe: str) -> datetime:
    if timeframe == "1h":
        return ts.replace(minute=0, second=0, microsecond=0)
    step = int(_timeframe_delta(timeframe).total_seconds() // 60)
    minute = (ts.minute // step) * step
    return ts.replace(minute=minute, second=0, microsecond=0)


def _float(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return fallback


def _depth_rows_to_map(rows: list[list[float]]) -> dict[float, float]:
    return {float(price): float(size) for price, size in rows if float(size) > 0}


def _depth_map_to_rows(side_map: dict[float, float], reverse: bool, limit: int = MAX_DEPTH_LEVELS) -> list[list[float]]:
    prices = sorted(side_map.keys(), reverse=reverse)[:limit]
    return [[price, side_map[price]] for price in prices]


def _apply_side_delta(side_map: dict[float, float], delta: list[list[str]]) -> None:
    for raw_price, raw_size in delta:
        price = _float(raw_price)
        size = _float(raw_size)
        if size <= 0:
            side_map.pop(price, None)
        else:
            side_map[price] = size


def _snapshot_from_book(symbol: str, book: dict[str, Any], reason: str) -> dict[str, Any]:
    bids = _depth_map_to_rows(book.get("bids", {}), reverse=True)
    asks = _depth_map_to_rows(book.get("asks", {}), reverse=False)
    best_bid = bids[0][0] if bids else 0.0
    best_ask = asks[0][0] if asks else 0.0
    mid = (best_bid + best_ask) / 2 if best_bid > 0 and best_ask > 0 else 0.0
    spread_bps = ((best_ask - best_bid) / mid * 10000) if mid > 0 else 0.0
    return {
        "venue": DEFAULT_VENUE,
        "instrument": symbol,
        "snapshot_at": _now_utc(),
        "best_bid": best_bid,
        "best_ask": best_ask,
        "spread_bps": spread_bps,
        "depth": {
            "bids": bids,
            "asks": asks,
            "lastUpdateId": book.get("last_update_id"),
            "event_time": book.get("event_time"),
            "reason": reason,
        },
        "source": "binance-depth-stream",
    }


async def _broadcast_depth_delta(symbol: str, payload: dict[str, Any]) -> None:
    key = _stream_key(DEFAULT_VENUE, symbol)
    subscribers = DEPTH_SUBSCRIBERS.get(key, set())
    if not subscribers:
        return
    stale: list[WebSocket] = []
    for socket in list(subscribers):
        try:
            await socket.send_json(payload)
        except Exception:
            stale.append(socket)
    for socket in stale:
        subscribers.discard(socket)


async def _fetch_binance_book_ticker(client: httpx.AsyncClient, symbol: str) -> dict[str, Any] | None:
    try:
        response = await client.get("https://api.binance.com/api/v3/ticker/bookTicker", params={"symbol": symbol}, timeout=8.0)
        if response.status_code >= 400:
            return None
        payload = response.json()
        bid = _float(payload.get("bidPrice"))
        ask = _float(payload.get("askPrice"))
        if bid <= 0 or ask <= 0:
            return None
        last = (bid + ask) / 2
        spread_bps = ((ask - bid) / last * 10000) if last > 0 else 0.0
        return {
            "venue": DEFAULT_VENUE,
            "instrument": symbol,
            "bid": bid,
            "ask": ask,
            "last": last,
            "spread_bps": spread_bps,
            "source": "binance-bookTicker",
        }
    except Exception:
        return None


async def _fetch_binance_trades(client: httpx.AsyncClient, symbol: str, limit: int = 200) -> list[dict[str, Any]]:
    try:
        response = await client.get("https://api.binance.com/api/v3/trades", params={"symbol": symbol, "limit": max(1, min(limit, 500))}, timeout=8.0)
        if response.status_code >= 400:
            return []
        rows = []
        for item in response.json():
            price = _float(item.get("price"))
            qty = _float(item.get("qty"))
            traded_at = datetime.fromtimestamp(int(item.get("time", 0)) / 1000, tz=timezone.utc)
            rows.append(
                {
                    "trade_id": str(item.get("id")),
                    "price": price,
                    "size": qty,
                    "side": "sell" if bool(item.get("isBuyerMaker")) else "buy",
                    "traded_at": traded_at,
                    "payload": item,
                }
            )
        return rows
    except Exception:
        return []


async def _fetch_binance_depth_snapshot(client: httpx.AsyncClient, symbol: str) -> dict[str, Any] | None:
    try:
        response = await client.get("https://api.binance.com/api/v3/depth", params={"symbol": symbol, "limit": MAX_DEPTH_LEVELS}, timeout=8.0)
        if response.status_code >= 400:
            return None
        payload = response.json()
        bids = [[_float(level[0]), _float(level[1])] for level in payload.get("bids", [])]
        asks = [[_float(level[0]), _float(level[1])] for level in payload.get("asks", [])]
        return {
            "last_update_id": payload.get("lastUpdateId"),
            "bids": bids,
            "asks": asks,
        }
    except Exception:
        return None


async def _fetch_binance_derivatives_metrics(client: httpx.AsyncClient, symbol: str) -> dict[str, Any] | None:
    try:
        premium_response = await client.get("https://fapi.binance.com/fapi/v1/premiumIndex", params={"symbol": symbol}, timeout=8.0)
        oi_response = await client.get("https://fapi.binance.com/fapi/v1/openInterest", params={"symbol": symbol}, timeout=8.0)
        if premium_response.status_code >= 400 or oi_response.status_code >= 400:
            return None

        premium = premium_response.json()
        oi = oi_response.json()
        next_funding_ms = int(_float(premium.get("nextFundingTime"), 0))
        next_funding_time = datetime.fromtimestamp(next_funding_ms / 1000, tz=timezone.utc) if next_funding_ms > 0 else None
        return {
            "venue": DEFAULT_VENUE,
            "instrument": symbol,
            "funding_rate": _float(premium.get("lastFundingRate"), 0.0),
            "open_interest": _float(oi.get("openInterest"), 0.0),
            "mark_price": _float(premium.get("markPrice"), 0.0),
            "next_funding_time": next_funding_time,
            "payload": {"premiumIndex": premium, "openInterest": oi},
            "captured_at": _now_utc(),
        }
    except Exception:
        return None


def _upsert_snapshot(snapshot: dict[str, Any]) -> None:
    snapshot_key = f"{snapshot['venue']}:{snapshot['instrument']}"
    execute(
        """
        INSERT INTO market_snapshots (snapshot_key, venue, instrument, bid, ask, last, spread_bps, payload)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (snapshot_key) DO UPDATE SET
          bid = EXCLUDED.bid,
          ask = EXCLUDED.ask,
          last = EXCLUDED.last,
          spread_bps = EXCLUDED.spread_bps,
          payload = EXCLUDED.payload,
          updated_at = NOW()
        """,
        (
            snapshot_key,
            snapshot["venue"],
            snapshot["instrument"],
            snapshot["bid"],
            snapshot["ask"],
            snapshot["last"],
            snapshot["spread_bps"],
            json_dumps(snapshot),
        ),
    )


def _store_trades(venue: str, instrument: str, trades: list[dict[str, Any]]) -> None:
    for trade in trades:
        execute(
            """
            INSERT INTO market_trades (venue, instrument, trade_id, side, price, size, traded_at, payload)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                venue,
                instrument,
                trade.get("trade_id"),
                trade.get("side"),
                trade.get("price"),
                trade.get("size"),
                trade.get("traded_at"),
                json_dumps(trade.get("payload", {})),
            ),
        )


def _store_depth(depth_payload: dict[str, Any]) -> None:
    execute(
        """
        INSERT INTO market_orderbook_snapshots (venue, instrument, snapshot_at, best_bid, best_ask, spread_bps, depth_payload, source)
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
        """,
        (
            depth_payload["venue"],
            depth_payload["instrument"],
            depth_payload["snapshot_at"],
            depth_payload.get("best_bid"),
            depth_payload.get("best_ask"),
            depth_payload.get("spread_bps"),
            json_dumps(depth_payload.get("depth", {})),
            depth_payload.get("source", "unknown"),
        ),
    )


def _store_derivatives(metrics: dict[str, Any]) -> None:
    execute(
        """
        INSERT INTO market_derivatives_metrics (venue, instrument, funding_rate, open_interest, mark_price, next_funding_time, payload, captured_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
        """,
        (
            metrics["venue"],
            metrics["instrument"],
            metrics.get("funding_rate"),
            metrics.get("open_interest"),
            metrics.get("mark_price"),
            metrics.get("next_funding_time"),
            json_dumps(metrics.get("payload", {})),
            metrics.get("captured_at", _now_utc()),
        ),
    )


def _upsert_ohlcv_from_trades(venue: str, instrument: str, trades: list[dict[str, Any]], timeframe: str) -> None:
    if not trades:
        return
    grouped: dict[datetime, list[dict[str, Any]]] = {}
    for trade in trades:
        ts = trade["traded_at"]
        bucket = _bucket_floor(ts, timeframe)
        grouped.setdefault(bucket, []).append(trade)

    for bucket, rows in grouped.items():
        rows_sorted = sorted(rows, key=lambda row: row["traded_at"])
        open_price = _float(rows_sorted[0]["price"])
        close_price = _float(rows_sorted[-1]["price"])
        high_price = max(_float(row["price"]) for row in rows_sorted)
        low_price = min(_float(row["price"]) for row in rows_sorted)
        volume = sum(_float(row["size"]) for row in rows_sorted)
        quote_volume = sum(_float(row["size"]) * _float(row["price"]) for row in rows_sorted)
        execute(
            """
            INSERT INTO market_ohlcv (venue, instrument, timeframe, bucket_start, open, high, low, close, volume, quote_volume, trades_count, source)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (venue, instrument, timeframe, bucket_start) DO UPDATE SET
              open = EXCLUDED.open,
              high = EXCLUDED.high,
              low = EXCLUDED.low,
              close = EXCLUDED.close,
              volume = EXCLUDED.volume,
              quote_volume = EXCLUDED.quote_volume,
              trades_count = EXCLUDED.trades_count,
              source = EXCLUDED.source,
              created_at = NOW()
            """,
            (
                venue,
                instrument,
                timeframe,
                bucket,
                open_price,
                high_price,
                low_price,
                close_price,
                volume,
                quote_volume,
                len(rows_sorted),
                "trade-resampled",
            ),
        )


def _cleanup_old_rows() -> None:
    execute("DELETE FROM market_trades WHERE traded_at < NOW() - INTERVAL '24 hours'")
    execute("DELETE FROM market_orderbook_snapshots WHERE snapshot_at < NOW() - INTERVAL '12 hours'")
    execute("DELETE FROM market_ohlcv WHERE bucket_start < NOW() - INTERVAL '14 days'")
    execute("DELETE FROM market_derivatives_metrics WHERE captured_at < NOW() - INTERVAL '14 days'")


async def _sync_symbol(client: httpx.AsyncClient, instrument: str) -> None:
    symbol = _normalize_instrument(instrument)
    quote = await _fetch_binance_book_ticker(client, symbol)
    if quote:
        _upsert_snapshot(quote)

    trades = await _fetch_binance_trades(client, symbol, limit=200)
    if trades:
        _store_trades(DEFAULT_VENUE, symbol, trades)
        for timeframe in ("1m", "5m", "15m", "1h"):
            _upsert_ohlcv_from_trades(DEFAULT_VENUE, symbol, trades, timeframe)

    depth_snapshot = await _fetch_binance_depth_snapshot(client, symbol)
    if depth_snapshot:
        DEPTH_BOOKS[_stream_key(DEFAULT_VENUE, symbol)] = {
            "bids": _depth_rows_to_map(depth_snapshot["bids"]),
            "asks": _depth_rows_to_map(depth_snapshot["asks"]),
            "last_update_id": int(depth_snapshot.get("last_update_id") or 0),
            "event_time": int(_now_utc().timestamp() * 1000),
        }
        _store_depth(_snapshot_from_book(symbol, DEPTH_BOOKS[_stream_key(DEFAULT_VENUE, symbol)], "rest-sync"))

    derivatives = await _fetch_binance_derivatives_metrics(client, symbol)
    if derivatives:
        DERIVATIVES_CACHE[_stream_key(DEFAULT_VENUE, symbol)] = derivatives
        _store_derivatives(derivatives)


async def _sync_loop() -> None:
    while True:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                for instrument in DEFAULT_SYMBOLS:
                    await _sync_symbol(client, instrument)
            _cleanup_old_rows()
        except Exception:
            pass
        await asyncio.sleep(SYNC_SECONDS)


async def _stream_depth_symbol(symbol: str) -> None:
    stream_url = f"wss://stream.binance.com:9443/ws/{symbol.lower()}@depth@100ms"
    key = _stream_key(DEFAULT_VENUE, symbol)

    while True:
        try:
            if key not in DEPTH_BOOKS:
                async with httpx.AsyncClient(timeout=8.0) as client:
                    snapshot = await _fetch_binance_depth_snapshot(client, symbol)
                if snapshot:
                    DEPTH_BOOKS[key] = {
                        "bids": _depth_rows_to_map(snapshot["bids"]),
                        "asks": _depth_rows_to_map(snapshot["asks"]),
                        "last_update_id": int(snapshot.get("last_update_id") or 0),
                        "event_time": int(_now_utc().timestamp() * 1000),
                    }

            async with websockets.connect(stream_url, ping_interval=20, ping_timeout=20) as socket:
                last_persist = _now_utc()
                while True:
                    raw_message = await socket.recv()
                    payload = json.loads(raw_message)
                    book = DEPTH_BOOKS.setdefault(
                        key,
                        {
                            "bids": {},
                            "asks": {},
                            "last_update_id": 0,
                            "event_time": int(_now_utc().timestamp() * 1000),
                        },
                    )
                    _apply_side_delta(book["bids"], payload.get("b", []))
                    _apply_side_delta(book["asks"], payload.get("a", []))
                    book["last_update_id"] = int(payload.get("u", book.get("last_update_id", 0)))
                    book["event_time"] = int(payload.get("E", int(_now_utc().timestamp() * 1000)))

                    await _broadcast_depth_delta(
                        symbol,
                        {
                            "type": "delta",
                            "venue": DEFAULT_VENUE,
                            "instrument": symbol,
                            "update_id": book["last_update_id"],
                            "event_time": book["event_time"],
                            "bids": payload.get("b", []),
                            "asks": payload.get("a", []),
                        },
                    )

                    if (_now_utc() - last_persist).total_seconds() >= 4:
                        _store_depth(_snapshot_from_book(symbol, book, "stream-delta"))
                        last_persist = _now_utc()
        except Exception:
            await asyncio.sleep(2)


@app.on_event("startup")
async def startup() -> None:
    ensure_schema()
    for _, snapshot in SNAPSHOTS.items():
        _upsert_snapshot(snapshot)
    asyncio.create_task(_sync_loop())
    if DEPTH_STREAM_ENABLED:
        for symbol in DEFAULT_SYMBOLS:
            asyncio.create_task(_stream_depth_symbol(_normalize_instrument(symbol)))


@app.get("/health")
async def health() -> dict:
    symbols = fetch_one("SELECT COUNT(*) AS count FROM market_snapshots") or {"count": 0}
    return {
        "status": "ok",
        "service": "market-data-plane",
        "snapshots": symbols["count"],
        "symbols": DEFAULT_SYMBOLS,
        "depth_stream_enabled": DEPTH_STREAM_ENABLED,
        "depth_books": len(DEPTH_BOOKS),
    }


@app.get("/v1/quotes")
async def quotes() -> list[dict]:
    return fetch_all("SELECT venue, instrument, bid, ask, last, spread_bps, updated_at FROM market_snapshots ORDER BY venue, instrument")


@app.get("/v1/market/ohlcv")
async def market_ohlcv(
    instrument: str = Query(...),
    venue: str = Query(DEFAULT_VENUE),
    timeframe: str = Query("1m"),
    limit: int = Query(200, ge=1, le=1000),
) -> list[dict]:
    rows = fetch_all(
        """
        SELECT venue, instrument, timeframe, bucket_start, open, high, low, close, volume, quote_volume, trades_count, source
        FROM market_ohlcv
        WHERE venue = %s AND instrument = %s AND timeframe = %s
        ORDER BY bucket_start DESC
        LIMIT %s
        """,
        (venue, _normalize_instrument(instrument), timeframe, limit),
    )
    return list(reversed(rows))


@app.get("/v1/market/trades")
async def market_trades(
    instrument: str = Query(...),
    venue: str = Query(DEFAULT_VENUE),
    limit: int = Query(200, ge=1, le=500),
) -> list[dict]:
    return fetch_all(
        """
        SELECT venue, instrument, trade_id, side, price, size, traded_at, payload
        FROM market_trades
        WHERE venue = %s AND instrument = %s
        ORDER BY traded_at DESC
        LIMIT %s
        """,
        (venue, _normalize_instrument(instrument), limit),
    )


@app.get("/v1/market/orderbook/depth")
async def market_depth(
    instrument: str = Query(...),
    venue: str = Query(DEFAULT_VENUE),
) -> dict:
    symbol = _normalize_instrument(instrument)
    key = _stream_key(venue, symbol)

    book = DEPTH_BOOKS.get(key)
    if book:
        snapshot = _snapshot_from_book(symbol, book, "in-memory")
        return {
            "venue": snapshot["venue"],
            "instrument": snapshot["instrument"],
            "snapshot_at": snapshot["snapshot_at"],
            "best_bid": snapshot["best_bid"],
            "best_ask": snapshot["best_ask"],
            "spread_bps": snapshot["spread_bps"],
            "depth_payload": snapshot["depth"],
            "source": snapshot["source"],
        }

    row = fetch_one(
        """
        SELECT venue, instrument, snapshot_at, best_bid, best_ask, spread_bps, depth_payload, source
        FROM market_orderbook_snapshots
        WHERE venue = %s AND instrument = %s
        ORDER BY snapshot_at DESC
        LIMIT 1
        """,
        (venue, symbol),
    )
    if row:
        return row

    quote = fetch_one(
        """
        SELECT venue, instrument, bid AS best_bid, ask AS best_ask, spread_bps
        FROM market_snapshots
        WHERE venue = %s AND instrument = %s
        """,
        (venue, symbol),
    )
    if not quote:
        return {"venue": venue, "instrument": symbol, "status": "unknown", "depth_payload": {"bids": [], "asks": []}}

    return {
        "venue": quote["venue"],
        "instrument": quote["instrument"],
        "snapshot_at": _now_utc(),
        "best_bid": quote["best_bid"],
        "best_ask": quote["best_ask"],
        "spread_bps": quote["spread_bps"],
        "depth_payload": {"bids": [[quote["best_bid"], 1.0]], "asks": [[quote["best_ask"], 1.0]]},
        "source": "quote-fallback",
    }


@app.websocket("/ws/v1/market/orderbook/depth/{instrument}")
async def ws_market_depth(websocket: WebSocket, instrument: str, venue: str = DEFAULT_VENUE) -> None:
    symbol = _normalize_instrument(instrument)
    key = _stream_key(venue, symbol)
    await websocket.accept()
    DEPTH_SUBSCRIBERS.setdefault(key, set()).add(websocket)

    initial = await market_depth(instrument=symbol, venue=venue)
    snapshot_at = initial.get("snapshot_at") if isinstance(initial, dict) else None
    if isinstance(snapshot_at, datetime):
        initial["snapshot_at"] = snapshot_at.isoformat()
    await websocket.send_json({"type": "snapshot", **initial})

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        DEPTH_SUBSCRIBERS.get(key, set()).discard(websocket)


@app.get("/v1/market/microstructure")
async def market_microstructure(
    instrument: str = Query(...),
    venue: str = Query(DEFAULT_VENUE),
    lookback_minutes: int = Query(60, ge=5, le=720),
) -> dict:
    symbol = _normalize_instrument(instrument)
    depth = await market_depth(instrument=symbol, venue=venue)
    trades = fetch_all(
        """
        SELECT side, price, size, traded_at
        FROM market_trades
        WHERE venue = %s AND instrument = %s
          AND traded_at >= NOW() - (%s || ' minutes')::interval
        ORDER BY traded_at DESC
        LIMIT 500
        """,
        (venue, symbol, lookback_minutes),
    )

    buy_volume = sum(_float(row.get("size")) for row in trades if str(row.get("side", "")).lower() == "buy")
    sell_volume = sum(_float(row.get("size")) for row in trades if str(row.get("side", "")).lower() == "sell")
    trade_count = len(trades)
    imbalance = (buy_volume - sell_volume) / max(buy_volume + sell_volume, 1e-9)

    bids = depth.get("depth_payload", {}).get("bids", []) if isinstance(depth, dict) else []
    asks = depth.get("depth_payload", {}).get("asks", []) if isinstance(depth, dict) else []
    bid_depth = sum(_float(level[1]) for level in bids[:10]) if isinstance(bids, list) else 0.0
    ask_depth = sum(_float(level[1]) for level in asks[:10]) if isinstance(asks, list) else 0.0
    depth_imbalance = (bid_depth - ask_depth) / max(bid_depth + ask_depth, 1e-9)

    spread_bps = _float(depth.get("spread_bps"), 0.0) if isinstance(depth, dict) else 0.0
    derivatives = DERIVATIVES_CACHE.get(_stream_key(venue, symbol))
    if not derivatives:
        derivatives = fetch_one(
            """
            SELECT funding_rate, open_interest, mark_price, next_funding_time, captured_at
            FROM market_derivatives_metrics
            WHERE venue = %s AND instrument = %s
            ORDER BY captured_at DESC
            LIMIT 1
            """,
            (venue, symbol),
        )

    return {
        "venue": venue,
        "instrument": symbol,
        "spread_bps": spread_bps,
        "trade_count": trade_count,
        "buy_volume": buy_volume,
        "sell_volume": sell_volume,
        "tape_acceleration": (buy_volume + sell_volume) / max(lookback_minutes, 1),
        "depth_imbalance": depth_imbalance,
        "volume_imbalance": imbalance,
        "depth_top10": {"bid": bid_depth, "ask": ask_depth},
        "funding_rate": _float((derivatives or {}).get("funding_rate"), 0.0),
        "open_interest": _float((derivatives or {}).get("open_interest"), 0.0),
        "mark_price": _float((derivatives or {}).get("mark_price"), 0.0),
        "next_funding_time": (derivatives or {}).get("next_funding_time"),
        "as_of": _now_utc().isoformat(),
    }


@app.get("/v1/market/session-state")
async def market_session_state(instrument: str = Query("BTCUSDT")) -> dict:
    symbol = _normalize_instrument(instrument)
    now = _now_utc()
    return {
        "instrument": symbol,
        "session": _session_label(now),
        "as_of": now.isoformat(),
        "next_session_change_at": (now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)).isoformat(),
    }
