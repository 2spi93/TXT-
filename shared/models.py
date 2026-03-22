from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SystemMode(str, Enum):
    OBSERVE = "observe"
    SUGGEST = "suggest"
    GUARDED_AUTO = "guarded_auto"
    MANAGED_LIVE = "managed_live"


class Side(str, Enum):
    BUY = "buy"
    SELL = "sell"


class TradeIntent(BaseModel):
    intent_id: str = Field(default_factory=lambda: str(uuid4()))
    strategy_id: str
    portfolio_id: str
    venue: str
    instrument: str
    side: Side
    reason_code: str
    confidence: float = Field(ge=0.0, le=1.0)
    target_notional_usd: float = Field(gt=0)
    max_slippage_bps: int = Field(gt=0)
    leverage: float = Field(default=1.0, gt=0)
    risk_tags: list[str] = Field(default_factory=list)
    explainability: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=utc_now_iso)


class RiskCheckRequest(BaseModel):
    intent: TradeIntent
    system_mode: SystemMode


class RiskDecision(BaseModel):
    decision: str
    reasons: list[str] = Field(default_factory=list)
    policy_version: str
    approved_notional_usd: float = 0.0
    risk_snapshot: dict[str, Any] = Field(default_factory=dict)


class ExecutionRequest(BaseModel):
    intent: TradeIntent
    risk_decision: RiskDecision
    execution_mode: str = "paper"


class OrderResult(BaseModel):
    order_id: str
    status: str
    venue: str
    instrument: str
    side: Side
    requested_notional_usd: float
    filled_notional_usd: float
    avg_fill_price: float
    execution_mode: str
    timestamp: str = Field(default_factory=utc_now_iso)


class IntentSubmissionRequest(BaseModel):
    intent: TradeIntent
    auto_execute: bool = True


class IntentSubmissionResponse(BaseModel):
    intent_id: str
    system_mode: SystemMode
    status: str
    risk_decision: RiskDecision
    order: OrderResult | None = None


class SystemModeChangeRequest(BaseModel):
    mode: SystemMode


class ApprovalRequest(BaseModel):
    signed_payload: str
    signature: str


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: int
    role: str
    username: str
    password_must_change: bool = False


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=12)


class StrategyCreateRequest(BaseModel):
    strategy_id: str
    name: str
    market: str
    setup_type: str
    notes: str = ""


class StrategyPromotionRequest(BaseModel):
    to_level: int = Field(ge=0, le=6)
    rationale: str = ""
    metrics: dict[str, Any] = Field(default_factory=dict)


class AuditEvent(BaseModel):
    category: str
    timestamp: str = Field(default_factory=utc_now_iso)
    payload: dict[str, Any]
