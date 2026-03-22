from __future__ import annotations

import json
import os
import time
from contextlib import contextmanager
from typing import Any, Iterable

import psycopg
from psycopg.rows import dict_row


DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://txt:txt@127.0.0.1:5432/mission_control")


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS system_config (
  config_key TEXT PRIMARY KEY,
  config_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('viewer', 'operator', 'admin')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    password_must_change BOOLEAN NOT NULL DEFAULT TRUE,
    last_password_change_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_must_change BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_password_change_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoke_reason TEXT,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent TEXT,
    ip_address TEXT
);

CREATE TABLE IF NOT EXISTS user_ui_preferences (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS self_learning_v4_states (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    state JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, account_id, symbol, timeframe)
);

CREATE TABLE IF NOT EXISTS risk_policies (
  policy_version TEXT PRIMARY KEY,
  policy JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS intents (
  intent_id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  venue TEXT NOT NULL,
  instrument TEXT NOT NULL,
  side TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  target_notional_usd DOUBLE PRECISION NOT NULL,
  max_slippage_bps INTEGER NOT NULL,
  leverage DOUBLE PRECISION NOT NULL,
  risk_tags JSONB NOT NULL,
  explainability JSONB NOT NULL,
  system_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  risk_decision JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  intent_id TEXT REFERENCES intents(intent_id) ON DELETE SET NULL,
  venue TEXT NOT NULL,
  instrument TEXT NOT NULL,
  side TEXT NOT NULL,
  requested_notional_usd DOUBLE PRECISION NOT NULL,
  filled_notional_usd DOUBLE PRECISION NOT NULL,
  avg_fill_price DOUBLE PRECISION NOT NULL,
  execution_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_chain_events (
    id BIGSERIAL PRIMARY KEY,
    prev_hash TEXT,
    event_hash TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_events (
  id BIGSERIAL PRIMARY KEY,
  intent_id TEXT NOT NULL,
  approver TEXT NOT NULL,
  role TEXT NOT NULL,
  signature TEXT NOT NULL,
  signed_payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  venue TEXT NOT NULL,
  instrument TEXT NOT NULL,
  bid DOUBLE PRECISION NOT NULL,
  ask DOUBLE PRECISION NOT NULL,
  last DOUBLE PRECISION NOT NULL,
  spread_bps DOUBLE PRECISION NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_ohlcv (
    id BIGSERIAL PRIMARY KEY,
    venue TEXT NOT NULL,
    instrument TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    bucket_start TIMESTAMPTZ NOT NULL,
    open DOUBLE PRECISION NOT NULL,
    high DOUBLE PRECISION NOT NULL,
    low DOUBLE PRECISION NOT NULL,
    close DOUBLE PRECISION NOT NULL,
    volume DOUBLE PRECISION NOT NULL,
    quote_volume DOUBLE PRECISION,
    trades_count INTEGER,
    source TEXT NOT NULL DEFAULT 'unknown',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (venue, instrument, timeframe, bucket_start)
);

CREATE TABLE IF NOT EXISTS market_trades (
    id BIGSERIAL PRIMARY KEY,
    venue TEXT NOT NULL,
    instrument TEXT NOT NULL,
    trade_id TEXT,
    side TEXT,
    price DOUBLE PRECISION NOT NULL,
    size DOUBLE PRECISION NOT NULL,
    traded_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_orderbook_snapshots (
    id BIGSERIAL PRIMARY KEY,
    venue TEXT NOT NULL,
    instrument TEXT NOT NULL,
    snapshot_at TIMESTAMPTZ NOT NULL,
    best_bid DOUBLE PRECISION,
    best_ask DOUBLE PRECISION,
    spread_bps DOUBLE PRECISION,
    depth_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    source TEXT NOT NULL DEFAULT 'unknown',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_derivatives_metrics (
    id BIGSERIAL PRIMARY KEY,
    venue TEXT NOT NULL,
    instrument TEXT NOT NULL,
    funding_rate DOUBLE PRECISION,
    open_interest DOUBLE PRECISION,
    mark_price DOUBLE PRECISION,
    next_funding_time TIMESTAMPTZ,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS execution_telemetry (
    telemetry_id TEXT PRIMARY KEY,
    decision_id TEXT,
    account_id TEXT,
    symbol TEXT,
    side TEXT,
    lots DOUBLE PRECISION,
    route_chosen TEXT,
    route_backup TEXT,
    route_reason TEXT,
    route_score DOUBLE PRECISION,
    backup_score DOUBLE PRECISION,
    quote_spread_bps DOUBLE PRECISION,
    available_depth_usd DOUBLE PRECISION,
    expected_slippage_bps DOUBLE PRECISION,
    realized_slippage_bps DOUBLE PRECISION,
    latency_e2e_ms INTEGER,
    ts_decision TIMESTAMPTZ,
    ts_intent TIMESTAMPTZ,
    ts_routing TIMESTAMPTZ,
    ts_broker_accept TIMESTAMPTZ,
    ts_fill_partial TIMESTAMPTZ,
    ts_fill_final TIMESTAMPTZ,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS execution_fill_events (
    id BIGSERIAL PRIMARY KEY,
    decision_id TEXT NOT NULL,
    fill_id TEXT NOT NULL,
    venue TEXT NOT NULL,
    instrument TEXT NOT NULL,
    side TEXT NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    size_base DOUBLE PRECISION NOT NULL,
    notional_usd DOUBLE PRECISION NOT NULL,
    depth_level INTEGER,
    fill_type TEXT NOT NULL DEFAULT 'book',
    slippage_bps DOUBLE PRECISION,
    fill_latency_ms INTEGER,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    filled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (decision_id, fill_id)
);

CREATE TABLE IF NOT EXISTS strategies (
    strategy_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    market TEXT NOT NULL,
    setup_type TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    current_level INTEGER NOT NULL DEFAULT 0 CHECK (current_level BETWEEN 0 AND 6),
    status TEXT NOT NULL DEFAULT 'active',
    latest_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_promotions (
    id BIGSERIAL PRIMARY KEY,
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id) ON DELETE CASCADE,
    from_level INTEGER NOT NULL,
    to_level INTEGER NOT NULL,
    approved_by TEXT NOT NULL,
    rationale TEXT NOT NULL DEFAULT '',
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_orchestration_events (
    id BIGSERIAL PRIMARY KEY,
    task TEXT NOT NULL,
    prompt_preview TEXT NOT NULL,
    criticality TEXT NOT NULL,
    route JSONB NOT NULL,
    provider_used TEXT NOT NULL,
    model_used TEXT NOT NULL,
    estimated_cost_usd DOUBLE PRECISION NOT NULL,
    retries_used INTEGER NOT NULL DEFAULT 0,
    fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    error_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mt5_accounts (
    account_id TEXT PRIMARY KEY,
    broker TEXT NOT NULL,
    server TEXT NOT NULL,
    login TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'paper' CHECK (mode IN ('paper', 'live')),
    status TEXT NOT NULL DEFAULT 'disconnected',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mt5_order_events (
    id BIGSERIAL PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES mt5_accounts(account_id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    lots DOUBLE PRECISION NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    risk_gate JSONB NOT NULL,
    broker_ticket TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE mt5_order_events ADD COLUMN IF NOT EXISTS chosen_route TEXT;
ALTER TABLE mt5_order_events ADD COLUMN IF NOT EXISTS expected_slippage_bps DOUBLE PRECISION;
ALTER TABLE mt5_order_events ADD COLUMN IF NOT EXISTS execution_context JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS mt5_live_approvals (
    approval_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES mt5_accounts(account_id) ON DELETE CASCADE,
    order_payload JSONB NOT NULL,
    first_approved_by TEXT NOT NULL,
    second_approved_by TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'rejected', 'cancelled')),
    execution_result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS kill_switch_events (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    reason TEXT NOT NULL,
    payload JSONB NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS decision_outcomes (
    decision_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    strategy_id TEXT,
    symbol TEXT,
    provider TEXT,
    regime TEXT,
    score_pre_trade DOUBLE PRECISION,
    pnl_5m DOUBLE PRECISION,
    pnl_1h DOUBLE PRECISION,
    pnl_24h DOUBLE PRECISION,
    mae DOUBLE PRECISION,
    mfe DOUBLE PRECISION,
    slippage_real_bps DOUBLE PRECISION,
    latency_ms INTEGER,
    fees_usd DOUBLE PRECISION,
    net_result_usd DOUBLE PRECISION,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_embeddings (
    embedding_id TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT,
    symbol TEXT,
    regime TEXT,
    timeframe TEXT,
    case_timestamp TIMESTAMPTZ,
    decision_action TEXT,
    outcome_label TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    model_name TEXT NOT NULL,
    vector JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE strategy_embeddings ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE strategy_embeddings ADD COLUMN IF NOT EXISTS symbol TEXT;
ALTER TABLE strategy_embeddings ADD COLUMN IF NOT EXISTS regime TEXT;
ALTER TABLE strategy_embeddings ADD COLUMN IF NOT EXISTS timeframe TEXT;
ALTER TABLE strategy_embeddings ADD COLUMN IF NOT EXISTS case_timestamp TIMESTAMPTZ;
ALTER TABLE strategy_embeddings ADD COLUMN IF NOT EXISTS decision_action TEXT;
ALTER TABLE strategy_embeddings ADD COLUMN IF NOT EXISTS outcome_label TEXT;

CREATE TABLE IF NOT EXISTS retrieval_events (
    id BIGSERIAL PRIMARY KEY,
    query_hash TEXT NOT NULL,
    strategy_id TEXT,
    symbol TEXT,
    regime TEXT,
    timeframe TEXT,
    requested_top_k INTEGER NOT NULL,
    candidates_count INTEGER NOT NULL,
    results_count INTEGER NOT NULL,
    avg_vector_similarity DOUBLE PRECISION,
    avg_final_similarity DOUBLE PRECISION,
    win_rate_top_results DOUBLE PRECISION,
    memory_impact_score_delta DOUBLE PRECISION,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_regime_thresholds (
    regime TEXT PRIMARY KEY,
    min_samples INTEGER NOT NULL DEFAULT 20,
    min_win_rate DOUBLE PRECISION NOT NULL DEFAULT 0.48,
    max_drawdown_usd DOUBLE PRECISION NOT NULL DEFAULT 800.0,
    max_avg_loss_usd DOUBLE PRECISION NOT NULL DEFAULT 120.0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_health_state (
    strategy_id TEXT NOT NULL,
    regime TEXT NOT NULL,
    window_hours INTEGER NOT NULL DEFAULT 168,
    sample_count INTEGER NOT NULL DEFAULT 0,
    win_rate DOUBLE PRECISION,
    avg_net_result_usd DOUBLE PRECISION,
    drawdown_usd DOUBLE PRECISION,
    drift_detected BOOLEAN NOT NULL DEFAULT FALSE,
    auto_suspended BOOLEAN NOT NULL DEFAULT FALSE,
    auto_resumed BOOLEAN NOT NULL DEFAULT FALSE,
    cooldown_until TIMESTAMPTZ,
    reason TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (strategy_id, regime, window_hours)
);

ALTER TABLE strategy_health_state ADD COLUMN IF NOT EXISTS auto_resumed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE strategy_health_state ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS memory_ab_events (
    id BIGSERIAL PRIMARY KEY,
    decision_id TEXT,
    source TEXT NOT NULL,
    strategy_id TEXT,
    symbol TEXT,
    regime TEXT,
    arm TEXT NOT NULL CHECK (arm IN ('memory_on', 'memory_off')),
    score_before DOUBLE PRECISION,
    score_after DOUBLE PRECISION,
    action TEXT,
    outcome_net_result_usd DOUBLE PRECISION,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incident_tickets (
    id BIGSERIAL PRIMARY KEY,
    ticket_key TEXT NOT NULL UNIQUE,
    severity TEXT NOT NULL DEFAULT 'medium',
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    assignee TEXT,
    source TEXT NOT NULL DEFAULT 'ops-chatbot',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT,
    resolution_note TEXT,
    closed_by TEXT,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE incident_tickets ADD COLUMN IF NOT EXISTS assignee TEXT;
ALTER TABLE incident_tickets ADD COLUMN IF NOT EXISTS resolution_note TEXT;
ALTER TABLE incident_tickets ADD COLUMN IF NOT EXISTS closed_by TEXT;
ALTER TABLE incident_tickets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS chatbot_action_confirmations (
    id BIGSERIAL PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    action_type TEXT NOT NULL,
    action_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    requested_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    executed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_orchestration_events_created_at
ON ai_orchestration_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mt5_order_events_created_at
ON mt5_order_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mt5_order_events_account_id
ON mt5_order_events (account_id);

CREATE INDEX IF NOT EXISTS idx_mt5_order_events_chosen_route
ON mt5_order_events (chosen_route, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mt5_live_approvals_status_created
ON mt5_live_approvals (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kill_switch_events_created_at
ON kill_switch_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_chain_events_created_at
ON audit_chain_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_outcomes_created_at
ON decision_outcomes (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_outcomes_strategy_id
ON decision_outcomes (strategy_id);

CREATE INDEX IF NOT EXISTS idx_self_learning_v4_states_updated_at
ON self_learning_v4_states (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_self_learning_v4_states_scope
ON self_learning_v4_states (user_id, account_id, symbol, timeframe);

CREATE INDEX IF NOT EXISTS idx_market_ohlcv_venue_instrument_tf
ON market_ohlcv (venue, instrument, timeframe, bucket_start DESC);

CREATE INDEX IF NOT EXISTS idx_market_trades_venue_instrument_time
ON market_trades (venue, instrument, traded_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_orderbook_snapshots_instrument
ON market_orderbook_snapshots (venue, instrument, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_derivatives_metrics_symbol_time
ON market_derivatives_metrics (venue, instrument, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_telemetry_symbol_time
ON execution_telemetry (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_telemetry_route
ON execution_telemetry (route_chosen, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_fill_events_decision
ON execution_fill_events (decision_id, filled_at ASC);

CREATE INDEX IF NOT EXISTS idx_execution_fill_events_symbol_time
ON execution_fill_events (instrument, filled_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_embeddings_strategy_id
ON strategy_embeddings (strategy_id);

CREATE INDEX IF NOT EXISTS idx_strategy_embeddings_symbol_regime
ON strategy_embeddings (symbol, regime, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_embeddings_timeframe
ON strategy_embeddings (timeframe, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_embeddings_content_hash_model
ON strategy_embeddings (content_hash, model_name);

CREATE INDEX IF NOT EXISTS idx_retrieval_events_created_at
ON retrieval_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_retrieval_events_symbol_regime
ON retrieval_events (symbol, regime, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_health_state_drift
ON strategy_health_state (drift_detected, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_ab_events_created_at
ON memory_ab_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_ab_events_arm
ON memory_ab_events (arm, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_tickets_created_at
ON incident_tickets (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_tickets_status
ON incident_tickets (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chatbot_action_confirmations_status
ON chatbot_action_confirmations (status, expires_at DESC);
"""


def _json_default(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return str(value)


@contextmanager
def get_conn():
    last_error: Exception | None = None
    for _ in range(20):
        try:
            conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
            break
        except Exception as exc:  # pragma: no cover - startup resilience
            last_error = exc
            time.sleep(1)
    else:
        raise last_error or RuntimeError("Unable to connect to database")

    try:
        yield conn
    finally:
        conn.close()


def ensure_schema() -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_lock(424242)")
            try:
                cur.execute(SCHEMA_SQL)
            finally:
                cur.execute("SELECT pg_advisory_unlock(424242)")
        conn.commit()


def execute(query: str, params: Iterable[Any] | None = None) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params or ())
        conn.commit()


def execute_rowcount(query: str, params: Iterable[Any] | None = None) -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params or ())
            count = cur.rowcount
        conn.commit()
        return count


def fetch_all(query: str, params: Iterable[Any] | None = None) -> list[dict[str, Any]]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params or ())
            return list(cur.fetchall())


def fetch_one(query: str, params: Iterable[Any] | None = None) -> dict[str, Any] | None:
    rows = fetch_all(query, params)
    return rows[0] if rows else None


def json_dumps(value: Any) -> str:
    return json.dumps(value, default=_json_default)