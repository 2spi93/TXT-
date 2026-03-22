from __future__ import annotations

import hashlib
import hmac
import os
import time
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI

from shared.db import ensure_schema, fetch_all

app = FastAPI(title="Broker Adapter", version="0.1.0")

MARKET_DATA_URL = os.getenv("MARKET_DATA_URL", "http://127.0.0.1:8003")
REAL_BROKER_BASE_URL = os.getenv("REAL_BROKER_BASE_URL", "https://api.binance.com")
REAL_BROKER_PROVIDER = os.getenv("REAL_BROKER_PROVIDER", "binance")
REAL_BROKER_API_KEY = os.getenv("REAL_BROKER_API_KEY", "")
REAL_BROKER_API_SECRET = os.getenv("REAL_BROKER_API_SECRET", "")


def _binance_sign(params: dict[str, str]) -> str:
    query = urlencode(params)
    return hmac.new(REAL_BROKER_API_SECRET.encode(), query.encode(), hashlib.sha256).hexdigest()


@app.on_event("startup")
async def startup() -> None:
    ensure_schema()


@app.get("/health")
async def health() -> dict:
    real_status = "degraded"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{REAL_BROKER_BASE_URL}/api/v3/ping")
            if response.status_code == 200:
                real_status = "ok"
    except Exception:
        real_status = "degraded"
    return {
        "status": "ok",
        "service": "broker-adapter",
        "mode": "read-only",
        "real_broker": REAL_BROKER_BASE_URL,
        "provider": REAL_BROKER_PROVIDER,
        "real_status": real_status,
        "credentialed": bool(REAL_BROKER_API_KEY and REAL_BROKER_API_SECRET),
    }


@app.get("/v1/balance")
async def balance() -> dict:
    if REAL_BROKER_PROVIDER == "binance" and REAL_BROKER_API_KEY and REAL_BROKER_API_SECRET:
        params = {
            "timestamp": str(int(time.time() * 1000)),
            "recvWindow": "5000",
        }
        signature = _binance_sign(params)
        params["signature"] = signature
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{REAL_BROKER_BASE_URL}/api/v3/account",
                params=params,
                headers={"X-MBX-APIKEY": REAL_BROKER_API_KEY},
            )
        if response.status_code == 200:
            data = response.json()
            balances = [
                {
                    "currency": item["asset"],
                    "free": float(item["free"]),
                    "locked": float(item["locked"]),
                }
                for item in data.get("balances", [])
                if float(item.get("free", 0)) > 0 or float(item.get("locked", 0)) > 0
            ]
            return {
                "mode": "read-only",
                "provider": "binance",
                "source": "real-credentialed",
                "can_trade": data.get("canTrade", False),
                "can_withdraw": data.get("canWithdraw", False),
                "balances": balances,
            }

    return {
        "mode": "read-only",
        "provider": "paper",
        "source": "mock",
        "balances": [
            {"currency": "USD", "free": 100000.0, "locked": 0.0},
            {"currency": "USDT", "free": 25000.0, "locked": 0.0}
        ]
    }


@app.get("/v1/positions")
async def positions() -> list[dict]:
    return fetch_all(
        """
        SELECT instrument,
               SUM(CASE WHEN side = 'buy' THEN filled_notional_usd ELSE -filled_notional_usd END) AS net_notional_usd,
               MAX(created_at) AS updated_at
        FROM orders
        GROUP BY instrument
        ORDER BY instrument
        """
    )


@app.get("/v1/orderbook/{venue}/{instrument}")
async def orderbook(venue: str, instrument: str) -> dict:
    symbol = instrument.replace("-", "").replace("/", "").upper()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{REAL_BROKER_BASE_URL}/api/v3/ticker/bookTicker", params={"symbol": symbol})
        if response.status_code == 200:
            data = response.json()
            return {
                "venue": "binance-public",
                "instrument": symbol,
                "bid": float(data["bidPrice"]),
                "ask": float(data["askPrice"]),
                "source": "real-read-only",
            }
    except Exception:
        pass

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(f"{MARKET_DATA_URL}/v1/quotes")
    for item in response.json():
        if item["venue"] == venue and item["instrument"] == instrument:
            return {"venue": venue, "instrument": instrument, "bid": item["bid"], "ask": item["ask"], "last": item["last"], "source": "paper-fallback"}
    return {"venue": venue, "instrument": instrument, "status": "unknown", "source": "none"}
