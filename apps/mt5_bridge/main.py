from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from shared.db import ensure_schema, execute, fetch_all, fetch_one, json_dumps

app = FastAPI(title="MT5 Bridge", version="0.1.0")


class Mt5AccountCreateRequest(BaseModel):
    account_id: str
    broker: str = "metaquotes"
    server: str
    login: str
    mode: str = Field(default="paper", pattern="^(paper|live)$")
    metadata: dict[str, Any] = Field(default_factory=dict)


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


@app.post("/v1/orders/filter")
async def filter_order(request: Mt5OrderFilterRequest) -> dict[str, Any]:
    account = fetch_one("SELECT account_id, mode, status FROM mt5_accounts WHERE account_id = %s", (request.account_id,))
    if not account:
        raise HTTPException(status_code=404, detail="MT5 account not found")
    if account["status"] != "connected":
        raise HTTPException(status_code=409, detail="MT5 account disconnected")

    started_at = datetime.now(timezone.utc)
    chosen_venue = str((request.chosen_route or {}).get("venue") or "mt5-default")
    ticket = f"{chosen_venue}-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
    route_spread_bps = float((request.chosen_route or {}).get("spread_bps") or (request.chosen_route or {}).get("spread") or 0.0)
    baseline_slippage = route_spread_bps if route_spread_bps > 0 else float(request.max_spread_bps) * 0.72
    realized_slippage_bps = round(min(float(request.max_spread_bps), max(0.5, baseline_slippage * 1.05)), 3)
    latency_ms = int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000) + 30
    execute(
        """
        INSERT INTO mt5_order_events (account_id, symbol, side, lots, mode, status, risk_gate, broker_ticket, notes, chosen_route, expected_slippage_bps, execution_context)
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s::jsonb)
        """,
        (
            request.account_id,
            request.symbol,
            request.side,
            request.lots,
            account["mode"],
            "accepted",
            json_dumps(request.risk_gate),
            ticket,
            request.rationale,
            chosen_venue,
            request.expected_slippage_bps,
            json_dumps({"routing_plan": request.routing_plan, "chosen_route": request.chosen_route}),
        ),
    )

    return {
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
