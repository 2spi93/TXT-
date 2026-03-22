from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import math
import os
import random
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, PlainTextResponse

from shared.auth import AuthContext, auth_context_from_token, hash_password, issue_access_token, sign_approval_payload, verify_approval_signature, verify_password
from shared.db import ensure_schema, execute, fetch_all, fetch_one, json_dumps
from shared.models import ApprovalRequest, AuditEvent, ChangePasswordRequest, IntentSubmissionRequest, IntentSubmissionResponse, LoginRequest, LoginResponse, OrderResult, RiskCheckRequest, RiskDecision, StrategyCreateRequest, StrategyPromotionRequest, SystemMode, SystemModeChangeRequest

app = FastAPI(title="Control Plane", version="0.1.0")

RISK_GATEWAY_URL = os.getenv("RISK_GATEWAY_URL", "http://127.0.0.1:8001")
EXECUTION_ROUTER_URL = os.getenv("EXECUTION_ROUTER_URL", "http://127.0.0.1:8002")
MARKET_DATA_URL = os.getenv("MARKET_DATA_URL", "http://127.0.0.1:8003")
BROKER_ADAPTER_URL = os.getenv("BROKER_ADAPTER_URL", "http://127.0.0.1:8004")
AI_ORCHESTRATOR_URL = os.getenv("AI_ORCHESTRATOR_URL", "http://127.0.0.1:8005")
MT5_BRIDGE_URL = os.getenv("MT5_BRIDGE_URL", "http://127.0.0.1:8006")
EMBEDDINGS_SERVICE_URL = os.getenv("EMBEDDINGS_SERVICE_URL", "http://127.0.0.1:8007")
CURRENT_SYSTEM_MODE = SystemMode(os.getenv("SYSTEM_MODE", SystemMode.SUGGEST.value))

AUDIT_LOG: list[AuditEvent] = []
PENDING_INTENTS: dict[str, dict] = {}


def _secret_env(name: str, default: str) -> str:
    file_path = os.getenv(f"{name}_FILE", "").strip()
    if file_path:
        try:
            with open(file_path, "r", encoding="utf-8") as handle:
                value = handle.read().strip()
            if value:
                return value
        except OSError:
            pass
    value = os.getenv(name, "").strip()
    return value or default


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _kill_switch_thresholds() -> dict[str, float]:
    return {
        "max_api_errors": float(os.getenv("KILL_MAX_API_ERRORS", "5")),
        "max_slippage_bps": float(os.getenv("KILL_MAX_SLIPPAGE_BPS", "30")),
        "max_drawdown_intraday": float(os.getenv("KILL_MAX_DRAWDOWN_INTRADAY_USD", "1500")),
    }


def _memory_ab_enabled() -> bool:
    return os.getenv("MEMORY_AB_ENABLED", "1").strip().lower() not in {"0", "false", "no"}


def _auto_resume_enabled() -> bool:
    return os.getenv("AUTO_RESUME_ENABLED", "1").strip().lower() not in {"0", "false", "no"}


def _auto_resume_cooldown_hours() -> int:
    raw = os.getenv("AUTO_RESUME_COOLDOWN_HOURS", "24")
    try:
        return max(1, min(24 * 14, int(raw)))
    except ValueError:
        return 24


def _drift_window_hours() -> int:
    raw = os.getenv("DRIFT_WINDOW_HOURS", "168")
    try:
        return max(24, min(24 * 30, int(raw)))
    except ValueError:
        return 168


def _kill_switch_state() -> dict:
    stored = fetch_one("SELECT config_value FROM system_config WHERE config_key = 'kill_switch_state'")
    if not stored:
        return {
            "active": False,
            "reason": "",
            "activated_at": None,
            "stats": {"api_errors": 0, "high_slippage_events": 0, "drawdown_intraday_usd": 0.0},
        }
    return stored["config_value"]


def _save_kill_switch_state(state: dict) -> None:
    execute(
        """
        INSERT INTO system_config (config_key, config_value)
        VALUES ('kill_switch_state', %s::jsonb)
        ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()
        """,
        (json_dumps(state),),
    )


def _normalize_ui_preferences(payload: dict | None) -> dict:
    raw = payload or {}
    normalized: dict[str, object] = {}
    ui_mode = str(raw.get("uiMode") or "").strip().lower()
    if ui_mode in {"novice", "expert"}:
        normalized["uiMode"] = ui_mode
    chart_motion_preset = str(raw.get("chartMotionPreset") or "").strip().lower()
    if chart_motion_preset in {"stable", "balanced", "aggressive"}:
        normalized["chartMotionPreset"] = chart_motion_preset
    chart_snap_enabled = raw.get("chartSnapEnabled")
    if isinstance(chart_snap_enabled, bool):
        normalized["chartSnapEnabled"] = chart_snap_enabled
    chart_snap_priority = str(raw.get("chartSnapPriority") or "").strip().lower()
    if chart_snap_priority in {"execution", "vwap", "liquidity"}:
        normalized["chartSnapPriority"] = chart_snap_priority
    chart_release_send_mode = str(raw.get("chartReleaseSendMode") or "").strip().lower()
    if chart_release_send_mode in {"one-click", "confirm-required"}:
        normalized["chartReleaseSendMode"] = chart_release_send_mode
    chart_haptic_mode = str(raw.get("chartHapticMode") or "").strip().lower()
    if chart_haptic_mode in {"off", "light", "medium"}:
        normalized["chartHapticMode"] = chart_haptic_mode

    def _normalize_account_map(value: object) -> dict[str, dict]:
        if not isinstance(value, dict):
            return {}
        sanitized: dict[str, dict] = {}
        for account_key, account_value in value.items():
            key = str(account_key).strip()
            if not key or not isinstance(account_value, dict):
                continue
            sanitized[key] = account_value
        return sanitized

    layout_map = _normalize_account_map(raw.get("terminalLayoutByAccount"))
    if layout_map:
        normalized["terminalLayoutByAccount"] = layout_map

    workspace_map = _normalize_account_map(raw.get("terminalWorkspacesByAccount"))
    if workspace_map:
        normalized["terminalWorkspacesByAccount"] = workspace_map

    floating_preset_map = _normalize_account_map(raw.get("terminalFloatingPresetsByAccount"))
    if floating_preset_map:
        normalized["terminalFloatingPresetsByAccount"] = floating_preset_map
    return normalized


def _parse_iso_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _get_ui_preferences_row(user_id: int) -> tuple[dict, str | None]:
    row = fetch_one("SELECT preferences, updated_at FROM user_ui_preferences WHERE user_id = %s", (user_id,))
    if not row:
        return {}, None
    preferences = row.get("preferences") or {}
    updated_at = row.get("updated_at")
    updated_label = updated_at.isoformat() if updated_at else None
    return (preferences if isinstance(preferences, dict) else {}), updated_label


def _save_ui_preferences(user_id: int, preferences: dict) -> tuple[dict, str | None]:
    normalized = _normalize_ui_preferences(preferences)
    row = fetch_one(
        """
        INSERT INTO user_ui_preferences (user_id, preferences)
        VALUES (%s, %s::jsonb)
        ON CONFLICT (user_id)
        DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = NOW()
        RETURNING updated_at
        """,
        (user_id, json_dumps(normalized)),
    )
    updated_at = row.get("updated_at").isoformat() if row and row.get("updated_at") else None
    return normalized, updated_at


def _normalize_self_learning_v4_scope(payload: dict | None) -> tuple[str, str, str] | None:
    if not isinstance(payload, dict):
        return None
    account_id = str(payload.get("accountId") or payload.get("account_id") or "").strip()
    symbol = str(payload.get("symbol") or "").strip().upper()
    timeframe = str(payload.get("timeframe") or "").strip().lower()
    if not account_id or not symbol or not timeframe:
        return None
    return account_id, symbol, timeframe


def _normalize_self_learning_v4_state(payload: dict | None) -> dict | None:
    scope = _normalize_self_learning_v4_scope(payload)
    if not scope:
        return None
    account_id, symbol, timeframe = scope
    raw = payload if isinstance(payload, dict) else {}
    filters = raw.get("filters") if isinstance(raw.get("filters"), dict) else {}
    regime_filter = str(filters.get("regime") or "all").strip().lower()
    if regime_filter not in {"all", "trend", "chop", "volatile"}:
        regime_filter = "all"
    scenario_filter = str(filters.get("scenario") or "all").strip().lower()
    if scenario_filter not in {"all", "continuation", "reversal", "balance"}:
        scenario_filter = "all"
    snapshot = raw.get("snapshot") if isinstance(raw.get("snapshot"), dict) else {}
    journal_raw = raw.get("journal") if isinstance(raw.get("journal"), list) else []
    journal: list[dict] = []
    seen_ids: set[str] = set()
    for item in journal_raw:
        if not isinstance(item, dict):
            continue
        event_id = str(item.get("id") or "").strip()
        if not event_id or event_id in seen_ids:
            continue
        seen_ids.add(event_id)
        outcome = str(item.get("outcome") or "").strip().lower()
        if outcome not in {"win", "loss"}:
            continue
        regime = str(item.get("regime") or "").strip().lower()
        scenario = str(item.get("scenario") or "").strip().lower()
        if regime not in {"trend", "chop", "volatile"} or scenario not in {"continuation", "reversal", "balance"}:
            continue
        journal.append(
            {
                "id": event_id,
                "timestampIso": str(item.get("timestampIso") or _now_utc().isoformat()),
                "symbol": symbol,
                "timeframe": timeframe,
                "regime": regime,
                "scenario": scenario,
                "outcome": outcome,
                "pnl": _to_float(item.get("pnl"), 0.0),
                "mfe": _to_float(item.get("mfe"), 0.0),
                "mae": _to_float(item.get("mae"), 0.0),
                "weights": item.get("weights") if isinstance(item.get("weights"), dict) else {},
            }
        )
        if len(journal) >= 240:
            break

    updated_at = _now_utc().isoformat()
    return {
        "version": max(1, int(raw.get("version", 1))) if str(raw.get("version", "")).strip() else 1,
        "accountId": account_id,
        "symbol": symbol,
        "timeframe": timeframe,
        "enabled": bool(raw.get("enabled", True)),
        "autoAdaptEnabled": bool(raw.get("autoAdaptEnabled", True)),
        "modelUpdatedAt": raw.get("modelUpdatedAt") if isinstance(raw.get("modelUpdatedAt"), str) else None,
        "driftAutoDemotedAt": raw.get("driftAutoDemotedAt") if isinstance(raw.get("driftAutoDemotedAt"), str) else None,
        "filters": {
            "regime": regime_filter,
            "scenario": scenario_filter,
        },
        "snapshot": snapshot if isinstance(snapshot, dict) else {},
        "journal": journal,
        "updatedAt": updated_at,
    }


def _get_self_learning_v4_state(user_id: int, account_id: str, symbol: str, timeframe: str) -> tuple[dict | None, str | None]:
    row = fetch_one(
        """
        SELECT state, updated_at
        FROM self_learning_v4_states
        WHERE user_id = %s AND account_id = %s AND symbol = %s AND timeframe = %s
        """,
        (user_id, account_id, symbol.upper(), timeframe.lower()),
    )
    if not row:
        return None, None
    state = row.get("state") if isinstance(row.get("state"), dict) else {}
    normalized = _normalize_self_learning_v4_state(
        {
            **state,
            "accountId": account_id,
            "symbol": symbol.upper(),
            "timeframe": timeframe.lower(),
        }
    )
    updated_at = row.get("updated_at")
    return normalized, (updated_at.isoformat() if updated_at else None)


def _save_self_learning_v4_state(user_id: int, payload: dict) -> tuple[dict, str]:
    normalized = _normalize_self_learning_v4_state(payload)
    if not normalized:
        raise HTTPException(status_code=400, detail="invalid self-learning-v4 payload")
    execute(
        """
        INSERT INTO self_learning_v4_states (user_id, account_id, symbol, timeframe, state)
        VALUES (%s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (user_id, account_id, symbol, timeframe)
        DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()
        """,
        (
            user_id,
            normalized["accountId"],
            normalized["symbol"],
            normalized["timeframe"],
            json_dumps(normalized),
        ),
    )
    row = fetch_one(
        """
        SELECT updated_at
        FROM self_learning_v4_states
        WHERE user_id = %s AND account_id = %s AND symbol = %s AND timeframe = %s
        """,
        (
            user_id,
            normalized["accountId"],
            normalized["symbol"],
            normalized["timeframe"],
        ),
    )
    updated_at = row.get("updated_at").isoformat() if row and row.get("updated_at") else _now_utc().isoformat()
    normalized["updatedAt"] = updated_at
    return normalized, updated_at


def _list_self_learning_v4_scopes(user_id: int, account_id: str = "", symbol: str = "", timeframe: str = "", limit: int = 120) -> list[dict]:
    where_clauses = ["user_id = %s"]
    params: list[object] = [user_id]
    if account_id:
        where_clauses.append("account_id = %s")
        params.append(account_id)
    if symbol:
        where_clauses.append("symbol = %s")
        params.append(symbol.upper())
    if timeframe:
        where_clauses.append("timeframe = %s")
        params.append(timeframe.lower())
    params.append(max(1, min(500, int(limit))))
    rows = fetch_all(
        f"""
        SELECT account_id, symbol, timeframe, state, updated_at
        FROM self_learning_v4_states
        WHERE {' AND '.join(where_clauses)}
        ORDER BY updated_at DESC
        LIMIT %s
        """,
        tuple(params),
    )
    items: list[dict] = []
    for row in rows:
        state = row.get("state") if isinstance(row.get("state"), dict) else {}
        drift = state.get("snapshot", {}).get("drift", {}) if isinstance(state.get("snapshot"), dict) else {}
        items.append(
            {
                "accountId": row.get("account_id"),
                "symbol": row.get("symbol"),
                "timeframe": row.get("timeframe"),
                "updatedAt": row.get("updated_at").isoformat() if row.get("updated_at") else None,
                "journalSize": len(state.get("journal") or []) if isinstance(state.get("journal"), list) else 0,
                "enabled": bool(state.get("enabled", True)),
                "autoAdaptEnabled": bool(state.get("autoAdaptEnabled", True)),
                "driftStatus": str(drift.get("status") or "WARMUP"),
            }
        )
    return items


def _activate_kill_switch(source: str, reason: str, payload: dict) -> dict:
    state = _kill_switch_state()
    if state.get("active"):
        return state
    state["active"] = True
    state["reason"] = reason
    state["activated_at"] = _now_utc().isoformat()
    _save_kill_switch_state(state)
    execute(
        "INSERT INTO kill_switch_events (source, reason, payload, active) VALUES (%s, %s, %s::jsonb, TRUE)",
        (source, reason, json_dumps(payload)),
    )
    append_audit("kill_switch_activated", {"source": source, "reason": reason, "payload": payload})
    return state


def _record_api_error(source: str, detail: str) -> None:
    state = _kill_switch_state()
    stats = state.setdefault("stats", {})
    stats["api_errors"] = int(stats.get("api_errors", 0)) + 1
    _save_kill_switch_state(state)
    if stats["api_errors"] >= _kill_switch_thresholds()["max_api_errors"]:
        _activate_kill_switch(source, "api_errors_threshold", {"detail": detail, "count": stats["api_errors"]})


def _record_slippage_event(slippage_bps: float, source: str) -> None:
    state = _kill_switch_state()
    stats = state.setdefault("stats", {})
    if slippage_bps >= _kill_switch_thresholds()["max_slippage_bps"]:
        stats["high_slippage_events"] = int(stats.get("high_slippage_events", 0)) + 1
        _save_kill_switch_state(state)
        _activate_kill_switch(source, "slippage_threshold", {"slippage_bps": slippage_bps})


def _recompute_drawdown_guard() -> None:
    row = fetch_one(
        """
        SELECT COALESCE(SUM(net_result_usd), 0) AS pnl_24h
        FROM decision_outcomes
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        """
    ) or {"pnl_24h": 0.0}
    pnl_24h = float(row["pnl_24h"])
    drawdown = abs(min(0.0, pnl_24h))
    state = _kill_switch_state()
    stats = state.setdefault("stats", {})
    stats["drawdown_intraday_usd"] = drawdown
    _save_kill_switch_state(state)
    if drawdown >= _kill_switch_thresholds()["max_drawdown_intraday"]:
        _activate_kill_switch("outcome_engine", "drawdown_intraday_threshold", {"drawdown_intraday_usd": drawdown})


def _assert_kill_switch_allows_execution() -> None:
    state = _kill_switch_state()
    if state.get("active"):
        raise HTTPException(status_code=423, detail={"kill_switch": state})


def _to_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _evaluate_chart_risk_rules(order_payload: dict) -> dict:
    if not isinstance(order_payload, dict):
        return {
            "guard_enabled": False,
            "risk_usd": 0.0,
            "reward_usd": 0.0,
            "max_loss_usd": 0.0,
            "target_gain_usd": 0.0,
            "target_rr": 0.0,
            "confirm_ack": False,
            "loss_exceeded": False,
            "target_miss": False,
        }

    order_intent = order_payload.get("order_intent") or {}
    if not isinstance(order_intent, dict):
        order_intent = {}
    bracket = order_intent.get("bracket") or {}
    if not isinstance(bracket, dict):
        bracket = {}
    risk_preview = order_intent.get("risk_preview") or {}
    if not isinstance(risk_preview, dict):
        risk_preview = {}

    guard_enabled = bool(risk_preview.get("guard_enabled"))
    risk_usd = max(0.0, _to_float(bracket.get("risk_usd"), _to_float(risk_preview.get("risk_usd"), 0.0)))
    reward_usd = max(0.0, _to_float(bracket.get("reward_usd"), _to_float(risk_preview.get("reward_usd"), 0.0)))
    max_loss_usd = max(0.0, _to_float(risk_preview.get("max_loss_usd"), 0.0))
    target_gain_usd = max(0.0, _to_float(risk_preview.get("target_gain_usd"), 0.0))
    target_rr = max(0.0, _to_float(risk_preview.get("target_rr"), 0.0))
    confirm_ack = bool(risk_preview.get("confirm_ack"))

    loss_exceeded = guard_enabled and max_loss_usd > 0 and risk_usd > max_loss_usd
    target_miss = guard_enabled and target_gain_usd > 0 and reward_usd < target_gain_usd

    return {
        "guard_enabled": guard_enabled,
        "risk_usd": risk_usd,
        "reward_usd": reward_usd,
        "max_loss_usd": max_loss_usd,
        "target_gain_usd": target_gain_usd,
        "target_rr": target_rr,
        "confirm_ack": confirm_ack,
        "loss_exceeded": loss_exceeded,
        "target_miss": target_miss,
    }


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def _normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def _two_proportion_p_value(success_a: int, total_a: int, success_b: int, total_b: int) -> float | None:
    if total_a <= 0 or total_b <= 0:
        return None
    p1 = success_a / total_a
    p2 = success_b / total_b
    pooled = (success_a + success_b) / (total_a + total_b)
    variance = pooled * (1.0 - pooled) * ((1.0 / total_a) + (1.0 / total_b))
    if variance <= 0:
        return None
    z = (p1 - p2) / math.sqrt(variance)
    return max(0.0, min(1.0, 2.0 * (1.0 - _normal_cdf(abs(z)))))


def _chat_confirmation_ttl_seconds() -> int:
    raw = os.getenv("CHAT_CONFIRM_TTL_SECONDS", "600")
    try:
        return max(60, min(3600, int(raw)))
    except ValueError:
        return 600


def _incident_unassigned_alert_minutes() -> int:
    raw = os.getenv("INCIDENT_UNASSIGNED_ALERT_MINUTES", "20")
    try:
        return max(1, min(24 * 60, int(raw)))
    except ValueError:
        return 20


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _requires_safe_confirmation(action_type: str) -> bool:
    return action_type in {"apply_threshold", "run_runbook", "open_incident_ticket"}


def _create_action_confirmation(action_type: str, action_payload: dict, username: str) -> dict:
    token = uuid4().hex
    token_hash = _hash_token(token)
    expires_at = _now_utc() + timedelta(seconds=_chat_confirmation_ttl_seconds())
    execute(
        """
        INSERT INTO chatbot_action_confirmations (token_hash, action_type, action_payload, requested_by, status, expires_at)
        VALUES (%s, %s, %s::jsonb, %s, 'pending', %s)
        """,
        (token_hash, action_type, json_dumps(action_payload), username, expires_at),
    )
    return {
        "token": token,
        "action_type": action_type,
        "expires_at": expires_at.isoformat(),
        "summary": f"Confirmer action sensible: {action_type}",
    }


def _consume_action_confirmation(token: str, username: str) -> dict | None:
    row = fetch_one(
        """
        SELECT id, action_type, action_payload, requested_by, status, expires_at
        FROM chatbot_action_confirmations
        WHERE token_hash = %s
        """,
        (_hash_token(token),),
    )
    if not row:
        return None
    if str(row.get("requested_by", "")) != username:
        return None
    if str(row.get("status", "")) != "pending":
        return None
    expires_at = row.get("expires_at")
    if not expires_at or expires_at <= _now_utc():
        execute("UPDATE chatbot_action_confirmations SET status = 'expired' WHERE id = %s", (row["id"],))
        return None

    execute(
        "UPDATE chatbot_action_confirmations SET status = 'confirmed', confirmed_at = NOW() WHERE id = %s",
        (row["id"],),
    )
    payload = row.get("action_payload") or {}
    if not isinstance(payload, dict):
        payload = {}
    return {
        "id": row["id"],
        "action_type": str(row.get("action_type", "")),
        "action_payload": payload,
    }


def _mark_action_confirmation_executed(confirmation_id: int) -> None:
    execute(
        "UPDATE chatbot_action_confirmations SET status = 'executed', executed_at = NOW() WHERE id = %s",
        (confirmation_id,),
    )


async def _execute_chat_action(action: dict, auth: AuthContext) -> dict:
    action_type = str(action.get("type", "")).strip().lower()
    if action_type == "apply_threshold":
        if auth.role not in {"operator", "admin"}:
            raise HTTPException(status_code=403, detail="Operator role required")
        result = await upsert_strategy_drift_threshold(
            {
                "regime": action.get("regime", "unknown"),
                "min_samples": action.get("min_samples", 20),
                "min_win_rate": action.get("min_win_rate", 0.48),
                "max_drawdown_usd": action.get("max_drawdown_usd", 800.0),
                "max_avg_loss_usd": action.get("max_avg_loss_usd", 120.0),
            },
            auth,
        )
        return {
            "status": "ok",
            "reply": f"Seuils regime {result['item']['regime']} appliques.",
            "action_result": result,
            "actions": ["open_live_readiness"],
        }

    if action_type == "open_incident_ticket":
        ticket_key = f"INC-{uuid4().hex[:10].upper()}"
        title = str(action.get("title") or "Incident operationnel")
        severity = str(action.get("severity") or "medium").lower()
        execute(
            """
            INSERT INTO incident_tickets (ticket_key, severity, title, status, source, payload, created_by)
            VALUES (%s, %s, %s, 'open', 'ops-chatbot', %s::jsonb, %s)
            """,
            (ticket_key, severity, title, json_dumps(action.get("payload", {})), auth.username),
        )
        append_audit("incident_ticket_opened", {"ticket_key": ticket_key, "by": auth.username, "severity": severity})
        return {
            "status": "ok",
            "reply": f"Ticket incident ouvert: {ticket_key}",
            "action_result": {"ticket_key": ticket_key, "severity": severity, "title": title},
            "actions": ["open_incident_board"],
        }

    if action_type == "run_runbook":
        runbook = str(action.get("name") or "stabilize_trading").strip().lower()
        if runbook == "stabilize_trading":
            _recompute_drawdown_guard()
            _recompute_strategy_drift_state()
            snapshot = await _compute_connectors_snapshot()
            return {
                "status": "ok",
                "reply": "Runbook stabilize_trading execute: drawdown/derive recomputes et snapshot connecteurs rafraichi.",
                "action_result": {"runbook": runbook, "snapshot": snapshot},
                "actions": ["open_live_readiness", "review_suspended_strategies"],
            }
        return {
            "status": "ok",
            "reply": f"Runbook inconnu: {runbook}. Disponibles: stabilize_trading.",
            "actions": ["open_help"],
        }

    return {
        "status": "ok",
        "reply": f"Action inconnue: {action_type}",
        "actions": ["open_help"],
    }


def _upsert_default_regime_thresholds() -> None:
    defaults = [
        ("trend", 25, 0.52, 1000.0, 140.0),
        ("mean_reversion", 25, 0.50, 850.0, 120.0),
        ("range", 20, 0.49, 700.0, 110.0),
        ("volatile", 30, 0.54, 1200.0, 180.0),
        ("neutral", 20, 0.48, 800.0, 120.0),
        ("unknown", 20, 0.48, 800.0, 120.0),
    ]
    for regime, min_samples, min_win_rate, max_drawdown, max_avg_loss in defaults:
        execute(
            """
            INSERT INTO strategy_regime_thresholds (regime, min_samples, min_win_rate, max_drawdown_usd, max_avg_loss_usd)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (regime) DO NOTHING
            """,
            (regime, min_samples, min_win_rate, max_drawdown, max_avg_loss),
        )


def _recompute_strategy_drift_state(strategy_id: str | None = None, regime: str | None = None) -> None:
    window = _drift_window_hours()
    if strategy_id:
        rows = fetch_all(
            """
            SELECT strategy_id, COALESCE(regime, 'unknown') AS regime,
                   COUNT(*) AS sample_count,
                   AVG(CASE WHEN COALESCE(net_result_usd, 0) > 0 THEN 1 ELSE 0 END) AS win_rate,
                   AVG(COALESCE(net_result_usd, 0)) AS avg_net_result_usd,
                   ABS(MIN(COALESCE(net_result_usd, 0))) AS drawdown_usd
            FROM decision_outcomes
            WHERE created_at >= NOW() - (%s * INTERVAL '1 hour')
              AND strategy_id = %s
              AND (%s::text IS NULL OR COALESCE(regime, 'unknown') = %s)
            GROUP BY strategy_id, COALESCE(regime, 'unknown')
            """,
            (window, strategy_id, regime, regime),
        )
    else:
        rows = fetch_all(
            """
            SELECT strategy_id, COALESCE(regime, 'unknown') AS regime,
                   COUNT(*) AS sample_count,
                   AVG(CASE WHEN COALESCE(net_result_usd, 0) > 0 THEN 1 ELSE 0 END) AS win_rate,
                   AVG(COALESCE(net_result_usd, 0)) AS avg_net_result_usd,
                   ABS(MIN(COALESCE(net_result_usd, 0))) AS drawdown_usd
            FROM decision_outcomes
            WHERE created_at >= NOW() - (%s * INTERVAL '1 hour')
              AND strategy_id IS NOT NULL
            GROUP BY strategy_id, COALESCE(regime, 'unknown')
            """,
            (window,),
        )

    for row in rows:
        sid = str(row.get("strategy_id") or "")
        reg = str(row.get("regime") or "unknown")
        sample_count = int(row.get("sample_count") or 0)
        win_rate = _to_float(row.get("win_rate"), 0.0)
        avg_loss = _to_float(row.get("avg_net_result_usd"), 0.0)
        drawdown = _to_float(row.get("drawdown_usd"), 0.0)
        thresholds = fetch_one(
            "SELECT min_samples, min_win_rate, max_drawdown_usd, max_avg_loss_usd FROM strategy_regime_thresholds WHERE regime = %s",
            (reg,),
        ) or fetch_one(
            "SELECT min_samples, min_win_rate, max_drawdown_usd, max_avg_loss_usd FROM strategy_regime_thresholds WHERE regime = 'unknown'"
        ) or {
            "min_samples": 20,
            "min_win_rate": 0.48,
            "max_drawdown_usd": 800.0,
            "max_avg_loss_usd": 120.0,
        }

        drift_reasons: list[str] = []
        if sample_count >= int(thresholds["min_samples"]):
            if win_rate < _to_float(thresholds["min_win_rate"], 0.48):
                drift_reasons.append("win_rate")
            if drawdown > _to_float(thresholds["max_drawdown_usd"], 800.0):
                drift_reasons.append("drawdown")
            if avg_loss < -abs(_to_float(thresholds["max_avg_loss_usd"], 120.0)):
                drift_reasons.append("avg_loss")

        drift_detected = len(drift_reasons) > 0
        auto_suspended = False
        auto_resumed = False
        cooldown_until: datetime | None = None
        if drift_detected and sid:
            current = fetch_one("SELECT status FROM strategies WHERE strategy_id = %s", (sid,))
            cooldown_until = _now_utc() + timedelta(hours=_auto_resume_cooldown_hours())
            if current and str(current.get("status", "")).lower() != "suspended_drift":
                execute(
                    "UPDATE strategies SET status = 'suspended_drift', updated_at = NOW() WHERE strategy_id = %s",
                    (sid,),
                )
                auto_suspended = True
                append_audit(
                    "strategy_auto_suspended_drift",
                    {
                        "strategy_id": sid,
                        "regime": reg,
                        "reasons": drift_reasons,
                        "window_hours": window,
                    },
                )
        elif sid and _auto_resume_enabled():
            current = fetch_one("SELECT status FROM strategies WHERE strategy_id = %s", (sid,))
            prior_state = fetch_one(
                "SELECT cooldown_until FROM strategy_health_state WHERE strategy_id = %s AND regime = %s AND window_hours = %s",
                (sid, reg, window),
            )
            prior_cooldown = prior_state.get("cooldown_until") if prior_state else None
            cooldown_until = prior_cooldown
            now = _now_utc()
            if current and str(current.get("status", "")).lower() == "suspended_drift" and prior_cooldown and now >= prior_cooldown:
                execute(
                    "UPDATE strategies SET status = 'active', updated_at = NOW() WHERE strategy_id = %s",
                    (sid,),
                )
                auto_resumed = True
                append_audit(
                    "strategy_auto_resumed_after_cooldown",
                    {
                        "strategy_id": sid,
                        "regime": reg,
                        "cooldown_until": prior_cooldown.isoformat(),
                        "window_hours": window,
                    },
                )

        execute(
            """
            INSERT INTO strategy_health_state (
                strategy_id, regime, window_hours, sample_count, win_rate,
                avg_net_result_usd, drawdown_usd, drift_detected, auto_suspended,
                auto_resumed, cooldown_until, reason, updated_at
            )
            VALUES (%s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (strategy_id, regime, window_hours) DO UPDATE SET
                sample_count = EXCLUDED.sample_count,
                win_rate = EXCLUDED.win_rate,
                avg_net_result_usd = EXCLUDED.avg_net_result_usd,
                drawdown_usd = EXCLUDED.drawdown_usd,
                drift_detected = EXCLUDED.drift_detected,
                auto_suspended = EXCLUDED.auto_suspended,
                auto_resumed = EXCLUDED.auto_resumed,
                cooldown_until = EXCLUDED.cooldown_until,
                reason = EXCLUDED.reason,
                updated_at = NOW()
            """,
            (
                sid,
                reg,
                window,
                sample_count,
                win_rate,
                avg_loss,
                drawdown,
                drift_detected,
                auto_suspended,
                auto_resumed,
                cooldown_until,
                ",".join(drift_reasons),
            ),
        )


def _pick_memory_arm(payload: dict) -> str:
    forced = str(payload.get("memory_ab_arm", "")).strip().lower()
    if forced in {"memory_on", "memory_off"}:
        return forced
    key = str(payload.get("decision_id") or payload.get("strategy_id") or "") + "|" + str(payload.get("symbol") or "")
    if not key:
        return "memory_on" if random.random() >= 0.5 else "memory_off"
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return "memory_on" if int(digest[:8], 16) % 2 == 0 else "memory_off"


def _infer_memory_context(payload: dict) -> dict:
    instrument = str(payload.get("symbol") or payload.get("instrument") or "").strip()
    symbol = instrument.upper() if instrument else None
    regime = str(payload.get("regime") or payload.get("market_regime") or "").strip() or None
    strategy_id = str(payload.get("strategy_id") or "").strip() or None
    timeframe = str(payload.get("timeframe") or "").strip() or None

    features = payload.get("market_features") if isinstance(payload.get("market_features"), dict) else {}
    query_parts = [
        f"symbol={symbol or 'n/a'}",
        f"regime={regime or 'n/a'}",
        f"strategy={strategy_id or 'n/a'}",
        f"timeframe={timeframe or 'n/a'}",
    ]
    if features:
        query_parts.append(f"features={features}")

    return {
        "query": " | ".join(query_parts),
        "strategy_id": strategy_id,
        "symbol": symbol,
        "regime": regime,
        "timeframe": timeframe,
        "query_market_features": features,
        "top_k": int(payload.get("memory_top_k", 5) or 5),
        "max_age_hours": int(payload.get("memory_max_age_hours", 24 * 14) or 24 * 14),
        "compatible_strategies": payload.get("compatible_strategies", []),
    }


async def _retrieve_memory_for_payload(payload: dict) -> dict:
    body = _infer_memory_context(payload)
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(f"{EMBEDDINGS_SERVICE_URL}/v1/retrieve", json=body)
        if response.status_code >= 400:
            _record_api_error("embeddings-service", "memory_retrieve_for_decision_failed")
            return {
                "status": "degraded",
                "results": [],
                "historical_alignment_score": _to_float(payload.get("historical_match"), 0.5),
                "risk_flags": {"high_drawdown": False},
                "formatted_memory": [],
                "insights": ["Memory retrieval unavailable; using base score only."],
            }
        return response.json()


def _inject_memory_into_prompt(prompt: str, memory: dict) -> str:
    formatted = memory.get("formatted_memory", [])
    insights = memory.get("insights", [])
    if not formatted and not insights:
        return prompt
    blocks = ["", "Similar past cases:"]
    for line in formatted[:3]:
        blocks.append(f"- {line}")
    blocks.append("")
    blocks.append("Insights:")
    for insight in insights[:4]:
        blocks.append(f"- {insight}")
    return (prompt or "") + "\n" + "\n".join(blocks)


def _apply_memory_aware_score(payload: dict, memory: dict) -> tuple[dict, dict]:
    adjusted = dict(payload)
    base_hist = _to_float(payload.get("historical_match"), 0.5)
    align = _to_float(memory.get("historical_alignment_score"), base_hist)
    boost = 0.1 if align > 0.65 else 0.0
    penalty = -0.15 if bool((memory.get("risk_flags") or {}).get("high_drawdown")) else 0.0
    final_hist = _clamp01((base_hist * 0.5) + (align * 0.5) + boost + penalty)
    adjusted["historical_match"] = final_hist
    return adjusted, {
        "base_historical_match": round(base_hist, 6),
        "alignment": round(align, 6),
        "boost": boost,
        "penalty": penalty,
        "final_historical_match": round(final_hist, 6),
    }


def _resolve_auth(
    authorization: str | None,
    allowed_roles: set[str],
    require_password_fresh: bool = True,
) -> AuthContext:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    auth = auth_context_from_token(token)
    if not auth or not auth.session_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = fetch_one(
        "SELECT id, username, role, is_active, password_must_change FROM users WHERE id = %s",
        (auth.user_id,),
    )
    if not user or not user["is_active"]:
        raise HTTPException(status_code=401, detail="Inactive or missing user")

    session = fetch_one(
        "SELECT session_id, expires_at, revoked_at FROM sessions WHERE session_id = %s AND user_id = %s",
        (auth.session_id, auth.user_id),
    )
    if not session:
        raise HTTPException(status_code=401, detail="Session not found")
    if session["revoked_at"] is not None:
        raise HTTPException(status_code=401, detail="Session revoked")
    if session["expires_at"] <= _now_utc():
        raise HTTPException(status_code=401, detail="Session expired")

    if user["role"] not in allowed_roles:
        raise HTTPException(status_code=403, detail="Insufficient role")
    if require_password_fresh and user["password_must_change"]:
        raise HTTPException(status_code=403, detail="Password rotation required")

    execute(
        "UPDATE sessions SET last_seen_at = NOW() WHERE session_id = %s",
        (auth.session_id,),
    )
    return AuthContext(
        user_id=user["id"],
        principal=user["username"],
        username=user["username"],
        role=user["role"],
        session_id=auth.session_id,
    )


def viewer_auth(authorization: str | None = Header(default=None)) -> AuthContext:
    return _resolve_auth(authorization, {"viewer", "operator", "admin"})


def operator_auth(authorization: str | None = Header(default=None)) -> AuthContext:
    return _resolve_auth(authorization, {"operator", "admin"})


def admin_auth(authorization: str | None = Header(default=None)) -> AuthContext:
    return _resolve_auth(authorization, {"admin"})


def relaxed_auth(authorization: str | None = Header(default=None)) -> AuthContext:
    return _resolve_auth(authorization, {"viewer", "operator", "admin"}, require_password_fresh=False)


def _resolve_websocket_user(token: str) -> dict | None:
    auth = auth_context_from_token(token)
    if not auth:
        return None

    user = fetch_one(
        "SELECT id, username, role, is_active FROM users WHERE id = %s",
        (auth.user_id,),
    )
    if not user or not user["is_active"]:
        return None

    session = fetch_one(
        "SELECT session_id, expires_at, revoked_at FROM sessions WHERE session_id = %s AND user_id = %s",
        (auth.session_id, auth.user_id),
    )
    if not session or session["revoked_at"] is not None or session["expires_at"] <= _now_utc():
        return None

    return {
        "user_id": user["id"],
        "username": user["username"],
        "role": user["role"],
        "session_id": auth.session_id,
    }


def _execution_telemetry_rows(limit: int = 50) -> list[dict]:
    safe_limit = max(1, min(limit, 500))
    return fetch_all(
        """
        SELECT telemetry_id, decision_id, account_id, symbol, side, lots,
               route_chosen, route_backup, route_reason, route_score, backup_score,
               quote_spread_bps, available_depth_usd,
               expected_slippage_bps, realized_slippage_bps, latency_e2e_ms,
               ts_decision, ts_intent, ts_routing, ts_broker_accept, ts_fill_partial, ts_fill_final,
               created_at
        FROM execution_telemetry
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (safe_limit,),
    )


def append_audit(category: str, payload: dict) -> None:
    event = AuditEvent(category=category, payload=payload)
    AUDIT_LOG.append(event)
    execute(
        "INSERT INTO audit_events (category, payload) VALUES (%s, %s::jsonb)",
        (event.category, json_dumps(event.payload)),
    )
    prev = fetch_one("SELECT event_hash FROM audit_chain_events ORDER BY id DESC LIMIT 1")
    prev_hash = prev["event_hash"] if prev else ""
    serialized = f"{prev_hash}|{event.category}|{json_dumps(event.payload)}|{event.timestamp}"
    event_hash = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    execute(
        "INSERT INTO audit_chain_events (prev_hash, event_hash, category, payload) VALUES (%s, %s, %s, %s::jsonb)",
        (prev_hash or None, event_hash, event.category, json_dumps(event.payload)),
    )


def persist_system_mode() -> None:
    execute(
        """
        INSERT INTO system_config (config_key, config_value)
        VALUES ('system_mode', %s::jsonb)
        ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()
        """,
        (json_dumps({"mode": CURRENT_SYSTEM_MODE.value}),),
    )


def persist_intent(intent_payload: dict, status: str, risk_decision: RiskDecision | None = None) -> None:
    execute(
        """
        INSERT INTO intents (
          intent_id, strategy_id, portfolio_id, venue, instrument, side, reason_code,
          confidence, target_notional_usd, max_slippage_bps, leverage, risk_tags,
          explainability, system_mode, status, risk_decision
        ) VALUES (
          %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s::jsonb,
          %s::jsonb, %s, %s, %s::jsonb
        )
        ON CONFLICT (intent_id) DO UPDATE SET
          status = EXCLUDED.status,
          system_mode = EXCLUDED.system_mode,
          risk_decision = EXCLUDED.risk_decision,
          updated_at = NOW()
        """,
        (
            intent_payload["intent_id"],
            intent_payload["strategy_id"],
            intent_payload["portfolio_id"],
            intent_payload["venue"],
            intent_payload["instrument"],
            intent_payload["side"],
            intent_payload["reason_code"],
            intent_payload["confidence"],
            intent_payload["target_notional_usd"],
            intent_payload["max_slippage_bps"],
            intent_payload["leverage"],
            json_dumps(intent_payload["risk_tags"]),
            json_dumps(intent_payload["explainability"]),
            CURRENT_SYSTEM_MODE.value,
            status,
            json_dumps(risk_decision.model_dump() if risk_decision else {}),
        ),
    )


@app.on_event("startup")
async def startup() -> None:
    global CURRENT_SYSTEM_MODE
    ensure_schema()
    await seed_default_users()
    stored = fetch_one("SELECT config_value FROM system_config WHERE config_key = 'system_mode'")
    if stored:
        CURRENT_SYSTEM_MODE = SystemMode(stored["config_value"]["mode"])
    else:
        persist_system_mode()
    _upsert_default_regime_thresholds()
    _save_kill_switch_state(_kill_switch_state())


async def seed_default_users() -> None:
    default_users = [
        ("admin", _secret_env("DEFAULT_ADMIN_PASSWORD", "admin123"), "admin"),
        ("operator", _secret_env("DEFAULT_OPERATOR_PASSWORD", "operator123"), "operator"),
        ("viewer", _secret_env("DEFAULT_VIEWER_PASSWORD", "viewer123"), "viewer"),
    ]
    for username, password, role in default_users:
        execute(
            """
            INSERT INTO users (username, password_hash, role, is_active)
            VALUES (%s, %s, %s, TRUE)
            ON CONFLICT (username) DO NOTHING
            """,
            (username, hash_password(password), role),
        )


def _create_session(user_id: int, user_agent: str = "", ip_address: str = "") -> tuple[str, int]:
    session_id = str(uuid4())
    token, expires_at = issue_access_token(
        user_id=user_id,
        username=str(user_id),
        role="viewer",
        session_id=session_id,
    )
    # Re-issue with true identity payload using token helper
    return session_id, expires_at


@app.post("/v1/auth/login", response_model=LoginResponse)
async def login(request: LoginRequest) -> LoginResponse:
    user = fetch_one(
        "SELECT id, username, password_hash, role, is_active, password_must_change FROM users WHERE username = %s",
        (request.username,),
    )
    if not user or not user["is_active"]:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(request.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    session_id = str(uuid4())
    token, expires_at = issue_access_token(
        user_id=user["id"],
        username=user["username"],
        role=user["role"],
        session_id=session_id,
    )
    execute(
        """
        INSERT INTO sessions (session_id, user_id, expires_at)
        VALUES (%s, %s, to_timestamp(%s))
        """,
        (session_id, user["id"], expires_at),
    )
    append_audit("auth_login", {"username": user["username"], "role": user["role"]})
    return LoginResponse(
        access_token=token,
        expires_at=expires_at,
        role=user["role"],
        username=user["username"],
        password_must_change=bool(user["password_must_change"]),
    )


@app.get("/v1/auth/me")
async def auth_me(auth: AuthContext = Depends(relaxed_auth)) -> dict:
    user = fetch_one(
        "SELECT password_must_change FROM users WHERE id = %s",
        (auth.user_id,),
    ) or {"password_must_change": False}
    return {
        "user_id": auth.user_id,
        "username": auth.username,
        "role": auth.role,
        "password_must_change": bool(user["password_must_change"]),
        "session_id": auth.session_id,
    }


@app.get("/v1/auth/preferences")
async def auth_preferences(auth: AuthContext = Depends(relaxed_auth)) -> dict:
    preferences, updated_at = _get_ui_preferences_row(auth.user_id)
    return {
        "user_id": auth.user_id,
        "preferences": preferences,
        "updated_at": updated_at,
    }


@app.put("/v1/auth/preferences")
async def update_auth_preferences(payload: dict, auth: AuthContext = Depends(relaxed_auth)) -> dict:
    preferences = payload.get("preferences") if isinstance(payload, dict) else {}
    base_updated_at = str(payload.get("base_updated_at") or "").strip() if isinstance(payload, dict) else ""
    client_updated_at = str(payload.get("client_updated_at") or "").strip() if isinstance(payload, dict) else ""
    current_preferences, current_updated_at = _get_ui_preferences_row(auth.user_id)
    current_dt = _parse_iso_utc(current_updated_at)
    base_dt = _parse_iso_utc(base_updated_at)
    client_dt = _parse_iso_utc(client_updated_at)
    if current_dt and base_dt and current_dt > base_dt:
        if not client_dt or client_dt <= current_dt:
            return JSONResponse(status_code=409, content={
                "status": "conflict",
                "reason": "backend_newer",
                "user_id": auth.user_id,
                "preferences": current_preferences,
                "updated_at": current_updated_at,
            })

    saved, updated_at = _save_ui_preferences(auth.user_id, preferences if isinstance(preferences, dict) else {})
    append_audit("auth_preferences_updated", {"username": auth.username, "keys": sorted(saved.keys())})
    return {
        "status": "updated",
        "user_id": auth.user_id,
        "preferences": saved,
        "updated_at": updated_at,
    }


@app.post("/v1/auth/change-password")
async def change_password(request: ChangePasswordRequest, auth: AuthContext = Depends(relaxed_auth)) -> dict:
    user = fetch_one(
        "SELECT id, username, password_hash FROM users WHERE id = %s",
        (auth.user_id,),
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(request.old_password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Old password invalid")
    execute(
        """
        UPDATE users
        SET password_hash = %s,
            password_must_change = FALSE,
            last_password_change_at = NOW(),
            updated_at = NOW()
        WHERE id = %s
        """,
        (hash_password(request.new_password), auth.user_id),
    )
    append_audit("password_changed", {"username": auth.username})
    return {"status": "password_updated"}


@app.post("/v1/auth/logout")
async def logout(auth: AuthContext = Depends(relaxed_auth)) -> dict:
    execute(
        "UPDATE sessions SET revoked_at = NOW(), revoke_reason = 'logout' WHERE session_id = %s",
        (auth.session_id,),
    )
    append_audit("auth_logout", {"username": auth.username, "session_id": auth.session_id})
    return {"status": "logged_out"}


@app.get("/v1/auth/sessions")
async def list_my_sessions(auth: AuthContext = Depends(relaxed_auth)) -> list[dict]:
    return fetch_all(
        "SELECT session_id, issued_at, expires_at, revoked_at, revoke_reason, last_seen_at FROM sessions WHERE user_id = %s ORDER BY issued_at DESC",
        (auth.user_id,),
    )


@app.get("/v1/system/kill-switch")
async def get_kill_switch(auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    return {
        "status": "ok",
        "state": _kill_switch_state(),
        "thresholds": _kill_switch_thresholds(),
    }


@app.post("/v1/system/kill-switch/reset")
async def reset_kill_switch(auth: AuthContext = Depends(admin_auth)) -> dict:
    state = _kill_switch_state()
    state["active"] = False
    state["reason"] = "manual_reset"
    state["activated_at"] = None
    state["stats"] = {"api_errors": 0, "high_slippage_events": 0, "drawdown_intraday_usd": 0.0}
    _save_kill_switch_state(state)
    execute(
        "INSERT INTO kill_switch_events (source, reason, payload, active) VALUES (%s, %s, %s::jsonb, FALSE)",
        ("admin", "manual_reset", json_dumps({"by": auth.username})),
    )
    append_audit("kill_switch_reset", {"by": auth.username})
    return {"status": "reset", "state": state}


@app.post("/v1/admin/sessions/{session_id}/revoke")
async def revoke_session(session_id: str, auth: AuthContext = Depends(admin_auth)) -> dict:
    execute(
        "UPDATE sessions SET revoked_at = NOW(), revoke_reason = %s WHERE session_id = %s",
        (f"revoked_by:{auth.username}", session_id),
    )
    append_audit("session_revoked", {"session_id": session_id, "by": auth.username})
    return {"status": "revoked", "session_id": session_id}


@app.get("/v1/admin/users")
async def list_users(auth: AuthContext = Depends(admin_auth)) -> list[dict]:
    del auth
    return fetch_all("SELECT id, username, role, is_active, created_at FROM users ORDER BY id")


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": "control-plane",
        "system_mode": CURRENT_SYSTEM_MODE,
        "audit_events": len(AUDIT_LOG),
        "pending_intents": len(PENDING_INTENTS),
    }


@app.get("/v1/audit")
async def list_audit(auth: AuthContext = Depends(viewer_auth)) -> list[dict]:
    del auth
    return fetch_all("SELECT category, payload, created_at AS timestamp FROM audit_events ORDER BY id DESC LIMIT 100")


@app.get("/v1/audit/chain")
async def list_audit_chain(limit: int = 50, auth: AuthContext = Depends(viewer_auth)) -> list[dict]:
    del auth
    safe_limit = max(1, min(limit, 500))
    return fetch_all(
        """
        SELECT id, prev_hash, event_hash, category, payload, created_at
        FROM audit_chain_events
        ORDER BY id DESC
        LIMIT %s
        """,
        (safe_limit,),
    )


@app.get("/v1/system/config")
async def get_system_config(auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    return {
        "system_mode": CURRENT_SYSTEM_MODE,
        "risk_gateway_url": RISK_GATEWAY_URL,
        "execution_router_url": EXECUTION_ROUTER_URL,
        "pending_intents": len(PENDING_INTENTS),
    }


@app.post("/v1/system/mode")
async def set_system_mode(request: SystemModeChangeRequest, auth: AuthContext = Depends(operator_auth)) -> dict:
    global CURRENT_SYSTEM_MODE
    del auth
    CURRENT_SYSTEM_MODE = request.mode
    persist_system_mode()
    append_audit("system_mode_changed", {"mode": CURRENT_SYSTEM_MODE})
    return {"status": "updated", "system_mode": CURRENT_SYSTEM_MODE}


@app.get("/v1/intents/pending")
async def list_pending_intents(auth: AuthContext = Depends(viewer_auth)) -> dict[str, dict]:
    del auth
    return PENDING_INTENTS


@app.get("/v1/strategies")
async def list_strategies(auth: AuthContext = Depends(viewer_auth)) -> list[dict]:
    del auth
    return fetch_all(
        """
        SELECT strategy_id, name, market, setup_type, notes, current_level, status, latest_metrics, created_by, created_at, updated_at
        FROM strategies
        ORDER BY updated_at DESC
        """
    )


@app.get("/v1/strategies/self-learning-v4")
async def get_self_learning_v4_state(
    account_id: str,
    symbol: str,
    timeframe: str,
    auth: AuthContext = Depends(relaxed_auth),
) -> dict:
    state, updated_at = _get_self_learning_v4_state(auth.user_id, account_id, symbol, timeframe)
    return {
        "status": "ok",
        "state": state,
        "updated_at": updated_at,
    }


@app.put("/v1/strategies/self-learning-v4")
async def put_self_learning_v4_state(payload: dict, auth: AuthContext = Depends(relaxed_auth)) -> dict:
    state, updated_at = _save_self_learning_v4_state(auth.user_id, payload)
    append_audit(
        "self_learning_v4_state_upserted",
        {
            "user_id": auth.user_id,
            "account_id": state.get("accountId"),
            "symbol": state.get("symbol"),
            "timeframe": state.get("timeframe"),
        },
    )
    return {
        "status": "ok",
        "state": state,
        "updated_at": updated_at,
    }


@app.get("/v1/strategies/self-learning-v4/scopes")
async def list_self_learning_v4_scopes(
    account_id: str = "",
    symbol: str = "",
    timeframe: str = "",
    limit: int = 120,
    auth: AuthContext = Depends(relaxed_auth),
) -> dict:
    items = _list_self_learning_v4_scopes(
        user_id=auth.user_id,
        account_id=account_id,
        symbol=symbol,
        timeframe=timeframe,
        limit=limit,
    )
    return {
        "status": "ok",
        "items": items,
        "total": len(items),
    }


@app.post("/v1/strategies")
async def create_strategy(request: StrategyCreateRequest, auth: AuthContext = Depends(operator_auth)) -> dict:
    execute(
        """
        INSERT INTO strategies (strategy_id, name, market, setup_type, notes, current_level, status, latest_metrics, created_by)
        VALUES (%s, %s, %s, %s, %s, 0, 'active', '{}'::jsonb, %s)
        ON CONFLICT (strategy_id) DO NOTHING
        """,
        (request.strategy_id, request.name, request.market, request.setup_type, request.notes, auth.username),
    )
    append_audit("strategy_created", {"strategy_id": request.strategy_id, "by": auth.username})
    created = fetch_one("SELECT * FROM strategies WHERE strategy_id = %s", (request.strategy_id,))
    if not created:
        raise HTTPException(status_code=409, detail="Strategy already exists")
    return created


@app.post("/v1/strategies/{strategy_id}/promote")
async def promote_strategy(strategy_id: str, request: StrategyPromotionRequest, auth: AuthContext = Depends(operator_auth)) -> dict:
    strategy = fetch_one("SELECT strategy_id, current_level FROM strategies WHERE strategy_id = %s", (strategy_id,))
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")
    current_level = int(strategy["current_level"])
    if request.to_level != current_level + 1:
        raise HTTPException(status_code=400, detail="Promotion must be sequential (Lx to Lx+1)")

    metrics = request.metrics or {}
    sample_count = int(metrics.get("sample_count", 0))
    oos_sharpe = float(metrics.get("oos_sharpe", 0.0))
    fee_impact_bps = float(metrics.get("fee_impact_bps", 9999.0))
    slippage_bps = float(metrics.get("slippage_bps", 9999.0))

    failures: list[str] = []
    if sample_count < 200:
        failures.append("sample_count_below_min_200")
    if oos_sharpe < 1.0:
        failures.append("oos_sharpe_below_1_0")
    if fee_impact_bps > 25:
        failures.append("fee_impact_bps_above_25")
    if slippage_bps > 20:
        failures.append("slippage_bps_above_20")
    if failures:
        raise HTTPException(status_code=400, detail={"promotion_blocked": failures})

    execute(
        """
        INSERT INTO strategy_promotions (strategy_id, from_level, to_level, approved_by, rationale, metrics)
        VALUES (%s, %s, %s, %s, %s, %s::jsonb)
        """,
        (strategy_id, current_level, request.to_level, auth.username, request.rationale, json_dumps(request.metrics)),
    )
    execute(
        """
        UPDATE strategies
        SET current_level = %s,
            latest_metrics = %s::jsonb,
            updated_at = NOW()
        WHERE strategy_id = %s
        """,
        (request.to_level, json_dumps(request.metrics), strategy_id),
    )
    append_audit(
        "strategy_promoted",
        {
            "strategy_id": strategy_id,
            "from_level": current_level,
            "to_level": request.to_level,
            "approved_by": auth.username,
        },
    )
    return fetch_one("SELECT * FROM strategies WHERE strategy_id = %s", (strategy_id,)) or {}


@app.get("/v1/dashboard/overview")
async def dashboard_overview(auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    policy = await fetch_policy()
    positions = fetch_all(
        """
        SELECT COALESCE(SUM(CASE WHEN side = 'buy' THEN filled_notional_usd ELSE -filled_notional_usd END), 0) AS net_exposure_usd
        FROM orders
        """
    )
    orders = fetch_one("SELECT COUNT(*) AS count FROM orders") or {"count": 0}
    return {
        "system_mode": CURRENT_SYSTEM_MODE.value,
        "pending_intents": len(PENDING_INTENTS),
        "orders_count": orders["count"],
        "net_exposure_usd": positions[0]["net_exposure_usd"] if positions else 0,
        "policy_version": policy["policy_version"],
        "paper_only": policy["paper_only"],
    }


@app.get("/v1/market/quotes")
async def proxy_market_quotes(auth: AuthContext = Depends(viewer_auth)) -> list[dict]:
    del auth
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(f"{MARKET_DATA_URL}/v1/quotes")
        return response.json()


async def _fetch_market_quotes() -> list[dict]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(f"{MARKET_DATA_URL}/v1/quotes")
        return response.json()


@app.get("/v1/market/ohlcv")
async def proxy_market_ohlcv(
    instrument: str,
    venue: str = "binance-public",
    timeframe: str = "1m",
    limit: int = 200,
    auth: AuthContext = Depends(viewer_auth),
) -> list[dict]:
    del auth
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            f"{MARKET_DATA_URL}/v1/market/ohlcv",
            params={"instrument": instrument, "venue": venue, "timeframe": timeframe, "limit": max(1, min(limit, 1000))},
        )
        return response.json()


@app.get("/v1/market/trades")
async def proxy_market_trades(
    instrument: str,
    venue: str = "binance-public",
    limit: int = 200,
    auth: AuthContext = Depends(viewer_auth),
) -> list[dict]:
    del auth
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            f"{MARKET_DATA_URL}/v1/market/trades",
            params={"instrument": instrument, "venue": venue, "limit": max(1, min(limit, 500))},
        )
        return response.json()


@app.get("/v1/market/orderbook/depth")
async def proxy_market_depth(
    instrument: str,
    venue: str = "binance-public",
    auth: AuthContext = Depends(viewer_auth),
) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            f"{MARKET_DATA_URL}/v1/market/orderbook/depth",
            params={"instrument": instrument, "venue": venue},
        )
        return response.json()


@app.get("/v1/market/microstructure")
async def proxy_market_microstructure(
    instrument: str,
    venue: str = "binance-public",
    lookback_minutes: int = 60,
    auth: AuthContext = Depends(viewer_auth),
) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            f"{MARKET_DATA_URL}/v1/market/microstructure",
            params={"instrument": instrument, "venue": venue, "lookback_minutes": max(5, min(lookback_minutes, 720))},
        )
        return response.json()


@app.get("/v1/market/session-state")
async def proxy_market_session_state(instrument: str = "BTCUSDT", auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(f"{MARKET_DATA_URL}/v1/market/session-state", params={"instrument": instrument})
        return response.json()


@app.get("/v1/broker/balance")
async def proxy_broker_balance(auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(f"{BROKER_ADAPTER_URL}/v1/balance")
        return response.json()


@app.get("/v1/broker/positions")
async def proxy_broker_positions(auth: AuthContext = Depends(viewer_auth)) -> list[dict]:
    del auth
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(f"{BROKER_ADAPTER_URL}/v1/positions")
        return response.json()


@app.get("/v1/broker/orderbook/{venue}/{instrument}")
async def proxy_broker_orderbook(venue: str, instrument: str, auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(f"{BROKER_ADAPTER_URL}/v1/orderbook/{venue}/{instrument}")
        return response.json()


@app.post("/v1/ai/route")
async def proxy_ai_route(payload: dict, auth: AuthContext = Depends(operator_auth)) -> dict:
    del auth
    enriched_payload = dict(payload)
    if isinstance(enriched_payload.get("prompt"), str):
        memory = await _retrieve_memory_for_payload(enriched_payload)
        enriched_payload["prompt"] = _inject_memory_into_prompt(str(enriched_payload.get("prompt", "")), memory)
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(f"{AI_ORCHESTRATOR_URL}/v1/route", json=enriched_payload)
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="AI orchestrator unavailable")
        return response.json()


@app.post("/v1/ai/execute")
async def proxy_ai_execute(payload: dict, auth: AuthContext = Depends(operator_auth)) -> dict:
    del auth
    enriched_payload = dict(payload)
    if isinstance(enriched_payload.get("prompt"), str):
        memory = await _retrieve_memory_for_payload(enriched_payload)
        enriched_payload["prompt"] = _inject_memory_into_prompt(str(enriched_payload.get("prompt", "")), memory)
    try:
        async with httpx.AsyncClient(timeout=240.0) as client:
            response = await client.post(f"{AI_ORCHESTRATOR_URL}/v1/execute", json=enriched_payload)
            if response.status_code >= 400:
                raise HTTPException(status_code=502, detail="AI orchestrator unavailable")
            append_audit("ai_orchestration_executed", {"task": enriched_payload.get("task", "unknown")})
            return response.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="AI orchestrator timeout") from None


@app.get("/v1/ai/health")
async def proxy_ai_health(auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=12.0) as client:
        response = await client.get(f"{AI_ORCHESTRATOR_URL}/health")
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="AI orchestrator unavailable")
        return response.json()


@app.get("/v1/ai/capacity")
async def proxy_ai_capacity(auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=12.0) as client:
        response = await client.get(f"{AI_ORCHESTRATOR_URL}/v1/capacity")
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="AI orchestrator unavailable")
        return response.json()


@app.get("/v1/ai/providers")
async def proxy_ai_providers(auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=12.0) as client:
        response = await client.get(f"{AI_ORCHESTRATOR_URL}/v1/providers")
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="AI orchestrator unavailable")
        return response.json()


@app.get("/v1/ai/history")
async def proxy_ai_history(limit: int = 30, auth: AuthContext = Depends(viewer_auth)) -> list[dict]:
    del auth
    safe_limit = max(1, min(limit, 200))
    async with httpx.AsyncClient(timeout=12.0) as client:
        response = await client.get(f"{AI_ORCHESTRATOR_URL}/v1/history", params={"limit": safe_limit})
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="AI orchestrator unavailable")
        return response.json()


@app.post("/v1/ai/history/clear-old")
async def proxy_ai_history_clear_old(auth: AuthContext = Depends(operator_auth)) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(f"{AI_ORCHESTRATOR_URL}/v1/history/clear-old")
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="AI orchestrator unavailable")
        append_audit("ai_history_clear_old", response.json())
        return response.json()


@app.get("/v1/ai/local-models/health")
async def proxy_ai_local_models_health(auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(f"{AI_ORCHESTRATOR_URL}/v1/local-models/health")
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="AI orchestrator unavailable")
        return response.json()


@app.post("/v1/ai/local-models/warmup")
async def proxy_ai_local_models_warmup(payload: dict, auth: AuthContext = Depends(operator_auth)) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=300.0) as client:
        response = await client.post(f"{AI_ORCHESTRATOR_URL}/v1/local-models/warmup", json=payload)
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="AI orchestrator unavailable")
        append_audit("ai_local_warmup", {"model_key": payload.get("model_key", "all")})
        return response.json()


@app.post("/v1/ai/regimes/detect")
async def proxy_ai_regime_detect(payload: dict, auth: AuthContext = Depends(operator_auth)) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(f"{AI_ORCHESTRATOR_URL}/v1/regimes/detect", json=payload)
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="AI orchestrator unavailable")
        return response.json()


@app.post("/v1/ai/backtests/geopolitical")
async def proxy_ai_geopolitical_backtest(payload: dict, auth: AuthContext = Depends(operator_auth)) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(f"{AI_ORCHESTRATOR_URL}/v1/backtests/geopolitical", json=payload)
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="AI orchestrator unavailable")
        append_audit("ai_geopolitical_backtest", {"strategy": payload.get("strategy_name", "")})
        return response.json()


@app.post("/v1/ai/decision/score")
async def proxy_ai_decision_score(payload: dict, auth: AuthContext = Depends(operator_auth)) -> dict:
    del auth
    arm = "memory_on"
    memory = {
        "kpis": {},
        "formatted_memory": [],
        "insights": [],
        "historical_alignment_score": _to_float(payload.get("historical_match"), 0.5),
        "risk_flags": {"high_drawdown": False},
    }
    adjusted_payload = dict(payload)
    adjustments = {
        "base_historical_match": _to_float(payload.get("historical_match"), 0.5),
        "alignment": _to_float(payload.get("historical_match"), 0.5),
        "boost": 0.0,
        "penalty": 0.0,
        "final_historical_match": _to_float(payload.get("historical_match"), 0.5),
    }

    if _memory_ab_enabled():
        arm = _pick_memory_arm(payload)
    if arm == "memory_on":
        memory = await _retrieve_memory_for_payload(payload)
        adjusted_payload, adjustments = _apply_memory_aware_score(payload, memory)

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(f"{AI_ORCHESTRATOR_URL}/v1/decision/score", json=adjusted_payload)
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="AI orchestrator unavailable")
        body = response.json()
        score_before = _to_float(payload.get("historical_match"), 0.5)
        score_after = _to_float((body.get("score") or {}).get("score_global"), score_before)
        execute(
            """
            INSERT INTO memory_ab_events (
                decision_id, source, strategy_id, symbol, regime,
                arm, score_before, score_after, action, payload
            )
            VALUES (%s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s::jsonb)
            """,
            (
                str(payload.get("decision_id", "")) or None,
                "decision_score",
                str(payload.get("strategy_id", "")) or None,
                str(payload.get("symbol") or payload.get("instrument") or "") or None,
                str(payload.get("regime", "")) or None,
                arm,
                score_before,
                score_after,
                str(body.get("action", "")) or None,
                json_dumps({"adjustments": adjustments, "memory_kpis": memory.get("kpis", {})}),
            ),
        )
        body["memory"] = {
            "kpis": memory.get("kpis", {}),
            "formatted_memory": memory.get("formatted_memory", []),
            "insights": memory.get("insights", []),
            "adjustments": adjustments,
            "ab_arm": arm,
        }
        return body


@app.post("/v1/ai/decision/vote")
async def proxy_ai_decision_vote(payload: dict, auth: AuthContext = Depends(operator_auth)) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(f"{AI_ORCHESTRATOR_URL}/v1/decision/vote", json=payload)
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="AI orchestrator unavailable")
        body = response.json()
        disagreement = float(body.get("disagreement", 0.0))
        if disagreement > float(os.getenv("KILL_MAX_AGENT_DISAGREEMENT", "0.5")):
            _activate_kill_switch("ai_vote", "agent_disagreement_threshold", body)
        return body


@app.post("/v1/embeddings/index")
async def proxy_embeddings_index(payload: dict, auth: AuthContext = Depends(operator_auth)) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(f"{EMBEDDINGS_SERVICE_URL}/v1/index", json=payload)
        if response.status_code >= 400:
            _record_api_error("embeddings-service", "index_failed")
            raise HTTPException(status_code=502, detail="Embeddings service unavailable")
        return response.json()


@app.post("/v1/embeddings/retrieve")
async def proxy_embeddings_retrieve(payload: dict, auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(f"{EMBEDDINGS_SERVICE_URL}/v1/retrieve", json=payload)
        if response.status_code >= 400:
            _record_api_error("embeddings-service", "retrieve_failed")
            raise HTTPException(status_code=502, detail="Embeddings service unavailable")
        return response.json()


@app.get("/v1/embeddings/kpi/retrieval")
async def proxy_embeddings_retrieval_kpi(window_hours: int = 24, auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    window = max(1, min(window_hours, 24 * 30))
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(f"{EMBEDDINGS_SERVICE_URL}/v1/kpi/retrieval", params={"window_hours": window})
        if response.status_code >= 400:
            _record_api_error("embeddings-service", "kpi_retrieval_failed")
            raise HTTPException(status_code=502, detail="Embeddings service unavailable")
        return response.json()


@app.get("/v1/mt5/health")
async def proxy_mt5_health(auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    async with httpx.AsyncClient(timeout=12.0) as client:
        response = await client.get(f"{MT5_BRIDGE_URL}/health")
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="MT5 bridge unavailable")
        return response.json()


@app.get("/v1/mt5/accounts")
async def proxy_mt5_accounts(auth: AuthContext = Depends(viewer_auth)) -> list[dict]:
    del auth
    async with httpx.AsyncClient(timeout=12.0) as client:
        response = await client.get(f"{MT5_BRIDGE_URL}/v1/accounts")
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="MT5 bridge unavailable")
        return response.json()


@app.post("/v1/mt5/accounts")
async def proxy_mt5_connect_account(payload: dict, auth: AuthContext = Depends(operator_auth)) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(f"{MT5_BRIDGE_URL}/v1/accounts", json=payload)
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="MT5 bridge unavailable")
        body = response.json()
        append_audit("mt5_account_connected", {"by": auth.username, "account_id": payload.get("account_id", "")})
        return body


@app.post("/v1/mt5/orders/filter")
async def proxy_mt5_filtered_order(payload: dict, auth: AuthContext = Depends(operator_auth)) -> dict:
    _assert_kill_switch_allows_execution()
    account_id = payload.get("account_id", "")
    if not account_id:
        raise HTTPException(status_code=400, detail="account_id is required")

    async with httpx.AsyncClient(timeout=10.0) as client:
        account_response = await client.get(f"{MT5_BRIDGE_URL}/v1/accounts/{account_id}")
        if account_response.status_code == 404:
            raise HTTPException(status_code=404, detail="MT5 account not found")
        if account_response.status_code >= 400:
            raise HTTPException(status_code=502, detail="MT5 bridge unavailable")
        account = account_response.json().get("account", {})

    risk_eval = _evaluate_chart_risk_rules(payload)
    if risk_eval["loss_exceeded"]:
        append_audit(
            "mt5_order_blocked_risk_max_loss",
            {
                "by": auth.username,
                "account_id": account_id,
                "risk_usd": risk_eval["risk_usd"],
                "max_loss_usd": risk_eval["max_loss_usd"],
                "symbol": payload.get("symbol", ""),
            },
        )
        raise HTTPException(
            status_code=422,
            detail=f"risk_guard_blocked:max_loss_exceeded risk={risk_eval['risk_usd']:.2f} limit={risk_eval['max_loss_usd']:.2f}",
        )

    account_mode = account.get("mode", "paper")
    if risk_eval["target_miss"] and account_mode != "live" and not risk_eval["confirm_ack"]:
        append_audit(
            "mt5_order_requires_confirm_target_gain",
            {
                "by": auth.username,
                "account_id": account_id,
                "reward_usd": risk_eval["reward_usd"],
                "target_gain_usd": risk_eval["target_gain_usd"],
                "symbol": payload.get("symbol", ""),
            },
        )
        raise HTTPException(
            status_code=409,
            detail=(
                "risk_confirmation_required:target_gain_below_objective "
                f"reward={risk_eval['reward_usd']:.2f} target={risk_eval['target_gain_usd']:.2f}"
            ),
        )

    risk_context = {
        "guard_enabled": risk_eval["guard_enabled"],
        "risk_usd": risk_eval["risk_usd"],
        "reward_usd": risk_eval["reward_usd"],
        "max_loss_usd": risk_eval["max_loss_usd"],
        "target_gain_usd": risk_eval["target_gain_usd"],
        "target_rr": risk_eval["target_rr"],
        "target_miss": risk_eval["target_miss"],
        "compliant": not risk_eval["loss_exceeded"] and not risk_eval["target_miss"],
    }

    if account_mode != "live":
        body = await _execute_mt5_filtered_order(payload)
        append_audit(
            "mt5_order_accepted",
            {
                "by": auth.username,
                "result": body,
                "approval": "single",
                "account_id": account_id,
                "symbol": payload.get("symbol", ""),
                "side": payload.get("side", "buy"),
                "risk_context": risk_context,
            },
        )
        return body

    approval_id = str(uuid4())
    execute(
        """
        INSERT INTO mt5_live_approvals (approval_id, account_id, order_payload, first_approved_by, status)
        VALUES (%s, %s, %s::jsonb, %s, 'pending')
        """,
        (approval_id, account_id, json_dumps(payload), auth.username),
    )
    append_audit(
        "mt5_live_order_pending_second_approval",
        {
            "approval_id": approval_id,
            "account_id": account_id,
            "first_approved_by": auth.username,
            "symbol": payload.get("symbol", ""),
            "side": payload.get("side", "buy"),
            "risk_context": risk_context,
        },
    )
    return {
        "status": "pending_second_approval",
        "approval_id": approval_id,
        "message": "Live order requires a second approval by another operator/admin",
    }


@app.get("/v1/execution/routing/score")
async def execution_routing_score(symbol: str, auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    return await _compute_route_plan(symbol)


@app.get("/v1/execution/telemetry/recent")
async def execution_telemetry_recent(limit: int = 50, auth: AuthContext = Depends(viewer_auth)) -> list[dict]:
    del auth
    return _execution_telemetry_rows(limit)


@app.get("/v1/execution/replay/{decision_id}")
async def execution_replay(decision_id: str, auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    telemetry = fetch_one(
        """
        SELECT telemetry_id, decision_id, account_id, symbol, side, lots,
               route_chosen, route_backup, route_reason, route_score, backup_score,
               quote_spread_bps, available_depth_usd,
               expected_slippage_bps, realized_slippage_bps, latency_e2e_ms,
               ts_decision, ts_intent, ts_routing, ts_broker_accept, ts_fill_partial, ts_fill_final,
               payload, created_at
        FROM execution_telemetry
        WHERE decision_id = %s
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (decision_id,),
    )
    fills = fetch_all(
        """
        SELECT decision_id, fill_id, venue, instrument, side, price, size_base, notional_usd,
               depth_level, fill_type, slippage_bps, fill_latency_ms, payload, filled_at
        FROM execution_fill_events
        WHERE decision_id = %s
        ORDER BY filled_at ASC, id ASC
        """,
        (decision_id,),
    )
    return {
        "decision_id": decision_id,
        "telemetry": telemetry,
        "fills": fills,
        "fill_count": len(fills),
    }


@app.get("/v1/mt5/orders/live-pending")
async def mt5_live_pending(auth: AuthContext = Depends(operator_auth)) -> list[dict]:
    del auth
    return fetch_all(
        """
        SELECT approval_id, account_id, order_payload, first_approved_by, second_approved_by, status, created_at, executed_at
        FROM mt5_live_approvals
        WHERE status = 'pending'
        ORDER BY created_at DESC
        """
    )


@app.get("/v1/mt5/orders/risk-history")
async def mt5_orders_risk_history(
    limit: int = 50,
    symbol: str | None = None,
    account_id: str | None = None,
    from_ts: str | None = None,
    to_ts: str | None = None,
    auth: AuthContext = Depends(viewer_auth),
) -> list[dict]:
    del auth
    safe_limit = max(1, min(limit, 200))
    filters: list[str] = [
        "category IN ('mt5_order_accepted', 'mt5_order_blocked_risk_max_loss', 'mt5_order_requires_confirm_target_gain')"
    ]
    params: list[object] = []
    symbol_value = (symbol or "").strip().upper()
    account_value = (account_id or "").strip()
    if symbol_value:
        filters.append("UPPER(COALESCE(payload->>'symbol', '')) = %s")
        params.append(symbol_value)
    if account_value:
        filters.append("COALESCE(payload->>'account_id', '') = %s")
        params.append(account_value)

    from_dt = _parse_iso_utc(from_ts)
    to_dt = _parse_iso_utc(to_ts)
    if from_ts and not from_dt:
        raise HTTPException(status_code=400, detail="invalid from_ts")
    if to_ts and not to_dt:
        raise HTTPException(status_code=400, detail="invalid to_ts")
    if from_dt and to_dt and from_dt > to_dt:
        raise HTTPException(status_code=400, detail="from_ts must be <= to_ts")
    if from_dt:
        filters.append("created_at >= %s")
        params.append(from_dt)
    if to_dt:
        filters.append("created_at <= %s")
        params.append(to_dt)

    params.append(safe_limit)

    return fetch_all(
        f"""
        SELECT category, payload, created_at AS timestamp
        FROM audit_events
        WHERE {' AND '.join(filters)}
        ORDER BY id DESC
        LIMIT %s
        """,
        tuple(params),
    )


@app.get("/v1/mt5/orders/risk-history/summary")
async def mt5_orders_risk_history_summary(
    window: int = 10,
    miss_threshold: int = 3,
    symbol: str | None = None,
    account_id: str | None = None,
    from_ts: str | None = None,
    to_ts: str | None = None,
    auth: AuthContext = Depends(viewer_auth),
) -> dict:
    del auth
    safe_window = max(1, min(window, 200))
    safe_miss_threshold = max(1, min(miss_threshold, safe_window))

    filters: list[str] = [
        "category IN ('mt5_order_accepted', 'mt5_order_blocked_risk_max_loss', 'mt5_order_requires_confirm_target_gain')"
    ]
    params: list[object] = []
    symbol_value = (symbol or "").strip().upper()
    account_value = (account_id or "").strip()
    if symbol_value:
        filters.append("UPPER(COALESCE(payload->>'symbol', '')) = %s")
        params.append(symbol_value)
    if account_value:
        filters.append("COALESCE(payload->>'account_id', '') = %s")
        params.append(account_value)

    from_dt = _parse_iso_utc(from_ts)
    to_dt = _parse_iso_utc(to_ts)
    if from_ts and not from_dt:
        raise HTTPException(status_code=400, detail="invalid from_ts")
    if to_ts and not to_dt:
        raise HTTPException(status_code=400, detail="invalid to_ts")
    if from_dt and to_dt and from_dt > to_dt:
        raise HTTPException(status_code=400, detail="from_ts must be <= to_ts")
    if from_dt:
        filters.append("created_at >= %s")
        params.append(from_dt)
    if to_dt:
        filters.append("created_at <= %s")
        params.append(to_dt)

    rows = fetch_all(
        f"""
        SELECT category, payload, created_at AS timestamp
        FROM audit_events
        WHERE {' AND '.join(filters)}
        ORDER BY id DESC
        LIMIT %s
        """,
        tuple([*params, 500]),
    )

    def _is_compliant(row: dict) -> bool:
        category = str(row.get("category") or "")
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        risk_context = payload.get("risk_context") if isinstance(payload, dict) and isinstance(payload.get("risk_context"), dict) else {}
        if category == "mt5_order_accepted":
            return bool(risk_context.get("compliant"))
        return False

    count_ok = 0
    count_miss = 0
    last_block_reason = "none"
    for row in rows:
        category = str(row.get("category") or "")
        if _is_compliant(row):
            count_ok += 1
            continue
        count_miss += 1
        if last_block_reason == "none":
            if category == "mt5_order_blocked_risk_max_loss":
                last_block_reason = "max_loss_exceeded"
            elif category == "mt5_order_requires_confirm_target_gain":
                last_block_reason = "target_gain_below_objective"
            else:
                last_block_reason = "non_compliant_execution"

    window_rows = rows[:safe_window]
    miss_in_window = sum(1 for row in window_rows if not _is_compliant(row))
    ratio_miss_window = miss_in_window / safe_window if safe_window > 0 else 0.0
    return {
        "count_ok": count_ok,
        "count_miss": count_miss,
        "last_block_reason": last_block_reason,
        "window_size": safe_window,
        "miss_in_window": miss_in_window,
        "ratio_miss_window": ratio_miss_window,
        "miss_threshold": safe_miss_threshold,
        "alert": miss_in_window >= safe_miss_threshold,
    }


@app.get("/v1/mt5/orders/risk-history/export")
async def mt5_orders_risk_history_export(
    format: str = "json",
    limit: int = 1000,
    symbol: str | None = None,
    account_id: str | None = None,
    from_ts: str | None = None,
    to_ts: str | None = None,
    auth: AuthContext = Depends(viewer_auth),
):
    del auth
    safe_limit = max(1, min(limit, 5000))
    format_value = format.strip().lower()
    if format_value not in {"json", "csv"}:
        raise HTTPException(status_code=400, detail="format must be json or csv")

    filters: list[str] = [
        "category IN ('mt5_order_accepted', 'mt5_order_blocked_risk_max_loss', 'mt5_order_requires_confirm_target_gain')"
    ]
    params: list[object] = []
    symbol_value = (symbol or "").strip().upper()
    account_value = (account_id or "").strip()
    if symbol_value:
        filters.append("UPPER(COALESCE(payload->>'symbol', '')) = %s")
        params.append(symbol_value)
    if account_value:
        filters.append("COALESCE(payload->>'account_id', '') = %s")
        params.append(account_value)

    from_dt = _parse_iso_utc(from_ts)
    to_dt = _parse_iso_utc(to_ts)
    if from_ts and not from_dt:
        raise HTTPException(status_code=400, detail="invalid from_ts")
    if to_ts and not to_dt:
        raise HTTPException(status_code=400, detail="invalid to_ts")
    if from_dt and to_dt and from_dt > to_dt:
        raise HTTPException(status_code=400, detail="from_ts must be <= to_ts")
    if from_dt:
        filters.append("created_at >= %s")
        params.append(from_dt)
    if to_dt:
        filters.append("created_at <= %s")
        params.append(to_dt)

    rows = fetch_all(
        f"""
        SELECT category, payload, created_at AS timestamp
        FROM audit_events
        WHERE {' AND '.join(filters)}
        ORDER BY id DESC
        LIMIT %s
        """,
        tuple([*params, safe_limit]),
    )

    if format_value == "json":
        return JSONResponse(content=rows)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "timestamp",
            "category",
            "symbol",
            "account_id",
            "side",
            "risk_usd",
            "reward_usd",
            "max_loss_usd",
            "target_gain_usd",
            "target_rr",
            "compliant",
            "reason",
        ]
    )
    for row in rows:
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        risk_context = payload.get("risk_context") if isinstance(payload, dict) and isinstance(payload.get("risk_context"), dict) else {}
        category = str(row.get("category") or "")
        reason = ""
        if category == "mt5_order_blocked_risk_max_loss":
            reason = "max_loss_exceeded"
        elif category == "mt5_order_requires_confirm_target_gain":
            reason = "target_gain_below_objective"
        elif category == "mt5_order_accepted":
            reason = "accepted"
        writer.writerow(
            [
                str(row.get("timestamp") or ""),
                category,
                str(payload.get("symbol") or ""),
                str(payload.get("account_id") or ""),
                str(payload.get("side") or ""),
                _to_float(risk_context.get("risk_usd"), 0.0),
                _to_float(risk_context.get("reward_usd"), 0.0),
                _to_float(risk_context.get("max_loss_usd"), 0.0),
                _to_float(risk_context.get("target_gain_usd"), 0.0),
                _to_float(risk_context.get("target_rr"), 0.0),
                bool(risk_context.get("compliant")),
                reason,
            ]
        )

    return PlainTextResponse(content=output.getvalue(), media_type="text/csv")


@app.post("/v1/mt5/orders/live-approve/{approval_id}")
async def mt5_live_second_approve(approval_id: str, auth: AuthContext = Depends(operator_auth)) -> dict:
    approval = fetch_one(
        """
        SELECT approval_id, account_id, order_payload, first_approved_by, status
        FROM mt5_live_approvals
        WHERE approval_id = %s
        """,
        (approval_id,),
    )
    if not approval:
        raise HTTPException(status_code=404, detail="Approval request not found")
    if approval["status"] != "pending":
        raise HTTPException(status_code=409, detail="Approval already resolved")
    if approval["first_approved_by"] == auth.username:
        raise HTTPException(status_code=403, detail="Second approval must be from a different operator")

    body = await _execute_mt5_filtered_order(approval["order_payload"])
    execute(
        """
        UPDATE mt5_live_approvals
        SET second_approved_by = %s,
            status = 'executed',
            execution_result = %s::jsonb,
            executed_at = NOW()
        WHERE approval_id = %s
        """,
        (auth.username, json_dumps(body), approval_id),
    )
    append_audit(
        "mt5_live_order_executed_double_approved",
        {
            "approval_id": approval_id,
            "first_approved_by": approval["first_approved_by"],
            "second_approved_by": auth.username,
            "result": body,
        },
    )
    return {"status": "executed", "approval_id": approval_id, "result": body}


async def _risk_check_mt5_order(payload: dict) -> dict:
    risk_payload = {
        "account_id": payload.get("account_id", ""),
        "symbol": payload.get("symbol", ""),
        "side": payload.get("side", "buy"),
        "lots": payload.get("lots", 0),
        "estimated_notional_usd": payload.get("estimated_notional_usd", 0),
        "max_spread_bps": payload.get("max_spread_bps", 0),
        "system_mode": CURRENT_SYSTEM_MODE.value,
    }
    async with httpx.AsyncClient(timeout=12.0) as client:
        response = await client.post(f"{RISK_GATEWAY_URL}/v1/checks/mt5-order", json=risk_payload)
        return response.json()


def _normalize_symbol(symbol: str) -> str:
    return symbol.replace("-PERP", "").replace("/", "").replace("-", "").upper()


async def _compute_route_plan(symbol: str) -> dict:
    normalized_symbol = _normalize_symbol(symbol)

    async with httpx.AsyncClient(timeout=10.0) as client:
        router_response = await client.get(
            f"{EXECUTION_ROUTER_URL}/v1/routes/score",
            params={"symbol": normalized_symbol},
        )
        if router_response.status_code < 400:
            payload = router_response.json()
            if isinstance(payload, dict) and payload.get("best"):
                return payload

    async with httpx.AsyncClient(timeout=10.0) as client:
        quotes_response = await client.get(f"{MARKET_DATA_URL}/v1/quotes")
        quotes = quotes_response.json() if quotes_response.status_code < 400 else []

        candidates: list[dict] = []
        for quote in quotes:
            instrument = _normalize_symbol(str(quote.get("instrument", "")))
            if instrument != normalized_symbol:
                continue
            venue = str(quote.get("venue", "unknown"))
            spread_bps = float(quote.get("spread_bps", 9999.0) or 9999.0)
            depth_response = await client.get(
                f"{MARKET_DATA_URL}/v1/market/orderbook/depth",
                params={"venue": venue, "instrument": normalized_symbol},
            )
            depth_payload = depth_response.json() if depth_response.status_code < 400 else {}
            raw_bids = ((depth_payload or {}).get("depth_payload") or {}).get("bids", [])
            available_depth_usd = 0.0
            for level in raw_bids[:5]:
                try:
                    available_depth_usd += float(level[0]) * float(level[1])
                except Exception:
                    continue

            score = max(0.0, 100.0 - spread_bps * 2.0 + min(45.0, available_depth_usd / 25000.0))
            candidates.append(
                {
                    "venue": venue,
                    "instrument": normalized_symbol,
                    "spread_bps": spread_bps,
                    "available_depth_usd": available_depth_usd,
                    "score": score,
                }
            )

    candidates = sorted(candidates, key=lambda item: item["score"], reverse=True)
    best = candidates[0] if candidates else None
    backup = candidates[1] if len(candidates) > 1 else None
    reason = "best_score_from_spread_and_depth" if best else "no_market_candidates"
    return {
        "symbol": normalized_symbol,
        "best": best,
        "backup": backup,
        "reason": reason,
        "candidates": candidates,
    }


async def _execute_mt5_filtered_order(payload: dict) -> dict:
    _assert_kill_switch_allows_execution()
    ts_decision = _now_utc()
    ts_intent = _now_utc()
    risk_body = await _risk_check_mt5_order(payload)
    if risk_body.get("decision") != "accept":
        append_audit("mt5_order_rejected", {"risk": risk_body})
        raise HTTPException(status_code=400, detail=risk_body)

    routing = await _compute_route_plan(str(payload.get("symbol", "")))
    ts_routing = _now_utc()
    route_best = routing.get("best") or {}
    route_backup = routing.get("backup") or {}

    routed_execution_result: dict = {}
    router_decision_id = f"route-{uuid4()}"
    async with httpx.AsyncClient(timeout=12.0) as client:
        router_response = await client.post(
            f"{EXECUTION_ROUTER_URL}/v1/orders/routed",
            json={
                "decision_id": router_decision_id,
                "order_id": f"routed-{router_decision_id}",
                "intent_id": payload.get("strategy_id", "mt5-live"),
                "execution_mode": "routed-mt5",
                "account_id": payload.get("account_id", ""),
                "symbol": _normalize_symbol(str(payload.get("symbol", ""))),
                "side": payload.get("side", "buy"),
                "lots": payload.get("lots", 0),
                "estimated_notional_usd": payload.get("estimated_notional_usd", 0),
                "max_spread_bps": payload.get("max_spread_bps", 0),
                "preferred_venue": route_best.get("venue"),
            },
        )
        if router_response.status_code < 400:
            routed_execution_result = router_response.json()
        else:
            _record_api_error("execution-router", "routed_order_failed")
            raise HTTPException(status_code=502, detail="Execution router unavailable")

    selected_route = ((routed_execution_result.get("route") or {}).get("chosen") or route_best)
    selected_backup = ((routed_execution_result.get("route") or {}).get("backup") or route_backup)

    bridge_payload = dict(payload)
    bridge_payload["risk_gate"] = risk_body
    bridge_payload["routing_plan"] = routing
    bridge_payload["chosen_route"] = selected_route
    bridge_payload["expected_slippage_bps"] = routed_execution_result.get("expected_slippage_bps")
    async with httpx.AsyncClient(timeout=12.0) as client:
        response = await client.post(f"{MT5_BRIDGE_URL}/v1/orders/filter", json=bridge_payload)
        if response.status_code >= 400:
            _record_api_error("mt5-bridge", "order_filter_failed")
            raise HTTPException(status_code=502, detail="MT5 bridge unavailable")
        result = response.json()
        _record_slippage_event(float(result.get("realized_slippage_bps", 0.0)), "mt5-bridge")
        ts_broker_accept = _now_utc()
        latency_bridge_ms = int(result.get("latency_ms", 0))
        fill_partial_ms = max(20, int(latency_bridge_ms * 0.55))
        fill_final_ms = max(fill_partial_ms, latency_bridge_ms)
        ts_fill_partial = ts_broker_accept + timedelta(milliseconds=fill_partial_ms)
        ts_fill_final = ts_broker_accept + timedelta(milliseconds=fill_final_ms)
        latency_e2e_ms = int((ts_fill_final - ts_decision).total_seconds() * 1000)
        expected_slippage_bps = float(routed_execution_result.get("expected_slippage_bps", float(payload.get("max_spread_bps", 0.0)) * 0.8))
        realized_slippage_bps = float(result.get("realized_slippage_bps", 0.0))

        execute(
            """
            INSERT INTO decision_outcomes (decision_id, source, strategy_id, symbol, provider, regime, score_pre_trade,
                                           slippage_real_bps, latency_ms, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending')
            ON CONFLICT (decision_id) DO NOTHING
            """,
            (
                str(result.get("broker_ticket", str(uuid4()))),
                "mt5",
                str(payload.get("strategy_id", "mt5-live")),
                str(payload.get("symbol", "")),
                "mt5-bridge",
                str(payload.get("regime", "unknown")),
                payload.get("score_pre_trade"),
                float(result.get("realized_slippage_bps", 0.0)),
                int(result.get("latency_ms", 0)),
            ),
        )

        telemetry_id = str(uuid4())
        execute(
            """
            INSERT INTO execution_telemetry (
              telemetry_id, decision_id, account_id, symbol, side, lots,
              route_chosen, route_backup, route_reason, route_score, backup_score,
              quote_spread_bps, available_depth_usd,
              expected_slippage_bps, realized_slippage_bps, latency_e2e_ms,
              ts_decision, ts_intent, ts_routing, ts_broker_accept, ts_fill_partial, ts_fill_final,
              payload
            ) VALUES (
              %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s, %s,
              %s, %s,
              %s, %s, %s,
              %s, %s, %s, %s, %s, %s,
              %s::jsonb
            )
            """,
            (
                telemetry_id,
                str(result.get("broker_ticket", str(uuid4()))),
                str(payload.get("account_id", "")),
                str(payload.get("symbol", "")),
                str(payload.get("side", "")),
                float(payload.get("lots", 0.0)),
                str(selected_route.get("venue", "mt5-default")),
                str(selected_backup.get("venue", "")),
                str(routing.get("reason", "")),
                float(selected_route.get("score", 0.0)),
                float(selected_backup.get("score", 0.0)) if selected_backup else None,
                float(selected_route.get("spread_bps", selected_route.get("spread", 0.0))),
                float(selected_route.get("available_depth_usd", 0.0)),
                expected_slippage_bps,
                realized_slippage_bps,
                latency_e2e_ms,
                ts_decision,
                ts_intent,
                ts_routing,
                ts_broker_accept,
                ts_fill_partial,
                ts_fill_final,
                json_dumps({"routing": routing, "bridge_result": result, "risk": risk_body, "router_execution": routed_execution_result}),
            ),
        )

        append_audit(
            "execution_telemetry_recorded",
            {
                "telemetry_id": telemetry_id,
                "decision_id": str(result.get("broker_ticket", "")),
                "route": selected_route.get("venue", "mt5-default"),
                "expected_slippage_bps": expected_slippage_bps,
                "realized_slippage_bps": realized_slippage_bps,
                "latency_e2e_ms": latency_e2e_ms,
            },
        )
        if routed_execution_result:
            result["routed_execution"] = {
                "decision_id": routed_execution_result.get("decision_id"),
                "venue": ((routed_execution_result.get("route") or {}).get("chosen") or {}).get("venue"),
                "fill_count": len(routed_execution_result.get("fills", [])),
                "expected_slippage_bps": routed_execution_result.get("expected_slippage_bps"),
                "fill_quality_score": routed_execution_result.get("fill_quality_score"),
            }
        return result


async def _compute_connectors_snapshot() -> dict:
    async with httpx.AsyncClient(timeout=8.0) as client:
        mt5_ok = False
        market_ok = False
        broker_ok = False
        ai_ok = False
        embeddings_ok = False

        try:
            mt5_ok = (await client.get(f"{MT5_BRIDGE_URL}/health")).status_code < 500
        except Exception:
            mt5_ok = False
        try:
            market_ok = (await client.get(f"{MARKET_DATA_URL}/health")).status_code < 500
        except Exception:
            market_ok = False
        try:
            broker_ok = (await client.get(f"{BROKER_ADAPTER_URL}/health")).status_code < 500
        except Exception:
            broker_ok = False
        try:
            ai_ok = (await client.get(f"{AI_ORCHESTRATOR_URL}/health")).status_code < 500
        except Exception:
            ai_ok = False
        try:
            embeddings_ok = (await client.get(f"{EMBEDDINGS_SERVICE_URL}/health")).status_code < 500
        except Exception:
            embeddings_ok = False

    pending = fetch_one("SELECT COUNT(*) AS count FROM mt5_live_approvals WHERE status = 'pending'") or {"count": 0}
    recent_approvals = fetch_all(
        """
        SELECT approval_id, account_id, first_approved_by, second_approved_by, status, created_at, executed_at
        FROM mt5_live_approvals
        ORDER BY created_at DESC
        LIMIT 10
        """
    )
    kill_state = _kill_switch_state()
    unassigned_sla = fetch_one(
        """
        SELECT COUNT(*) AS count
        FROM incident_tickets
        WHERE status IN ('open', 'assigned')
          AND assignee IS NULL
          AND NOW() - created_at >= (%s * INTERVAL '1 minute')
        """,
        (_incident_unassigned_alert_minutes(),),
    ) or {"count": 0}
    alerts: list[dict] = []
    if kill_state.get("active"):
        alerts.append({"level": "critical", "type": "kill_switch", "message": f"Kill switch active: {kill_state.get('reason', 'unknown')}"})
    if int(pending["count"]) > 0:
        alerts.append({"level": "warning", "type": "pending_live_approvals", "message": f"{int(pending['count'])} live approval(s) pending"})
    if int(unassigned_sla["count"]) > 0:
        alerts.append(
            {
                "level": "warning",
                "type": "incidents_unassigned_sla",
                "message": f"{int(unassigned_sla['count'])} incident(s) unassigned over {_incident_unassigned_alert_minutes()} min",
            }
        )

    return {
        "status": "ok",
        "pending_live_approvals": int(pending["count"]),
        "incident_unassigned_sla_count": int(unassigned_sla["count"]),
        "kill_switch": kill_state,
        "recent_live_approvals": recent_approvals,
        "alerts": alerts,
        "connectors": [
            {"name": "binance", "type": "crypto", "transport": "rest/ws", "healthy": market_ok},
            {"name": "okx", "type": "crypto", "transport": "rest/ws", "healthy": market_ok},
            {"name": "bitget", "type": "crypto", "transport": "rest/ws", "healthy": market_ok},
            {"name": "polymarket", "type": "prediction", "transport": "rest", "healthy": market_ok},
            {"name": "mt5", "type": "forex-indices", "transport": "bridge", "healthy": mt5_ok},
            {"name": "broker-adapter", "type": "execution", "transport": "rest", "healthy": broker_ok},
            {"name": "ai-orchestrator", "type": "intelligence", "transport": "rest", "healthy": ai_ok},
            {"name": "embeddings-service", "type": "memory", "transport": "rest", "healthy": embeddings_ok},
        ],
    }


@app.post("/v1/outcomes/{decision_id}/update")
async def update_outcome(decision_id: str, payload: dict, auth: AuthContext = Depends(operator_auth)) -> dict:
    execute(
        """
        INSERT INTO decision_outcomes (decision_id, source, strategy_id, symbol, provider, regime, score_pre_trade,
                                       pnl_5m, pnl_1h, pnl_24h, mae, mfe, slippage_real_bps, latency_ms, fees_usd, net_result_usd, status, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (decision_id) DO UPDATE SET
            pnl_5m = EXCLUDED.pnl_5m,
            pnl_1h = EXCLUDED.pnl_1h,
            pnl_24h = EXCLUDED.pnl_24h,
            mae = EXCLUDED.mae,
            mfe = EXCLUDED.mfe,
            slippage_real_bps = EXCLUDED.slippage_real_bps,
            latency_ms = EXCLUDED.latency_ms,
            fees_usd = EXCLUDED.fees_usd,
            net_result_usd = EXCLUDED.net_result_usd,
            status = EXCLUDED.status,
            updated_at = NOW()
        """,
        (
            decision_id,
            payload.get("source", "manual"),
            payload.get("strategy_id"),
            payload.get("symbol"),
            payload.get("provider"),
            payload.get("regime"),
            payload.get("score_pre_trade"),
            payload.get("pnl_5m"),
            payload.get("pnl_1h"),
            payload.get("pnl_24h"),
            payload.get("mae"),
            payload.get("mfe"),
            payload.get("slippage_real_bps"),
            payload.get("latency_ms"),
            payload.get("fees_usd"),
            payload.get("net_result_usd"),
            payload.get("status", "finalized"),
        ),
    )
    _recompute_drawdown_guard()
    _recompute_strategy_drift_state(
        strategy_id=str(payload.get("strategy_id") or "") or None,
        regime=str(payload.get("regime") or "") or None,
    )
    execute(
        """
        UPDATE memory_ab_events
        SET outcome_net_result_usd = %s
        WHERE decision_id = %s
        """,
        (_to_float(payload.get("net_result_usd"), 0.0), decision_id),
    )
    append_audit("outcome_updated", {"decision_id": decision_id, "by": auth.username})
    return {"status": "updated", "decision_id": decision_id}


@app.get("/v1/outcomes/recent")
async def recent_outcomes(limit: int = 50, auth: AuthContext = Depends(viewer_auth)) -> list[dict]:
    del auth
    safe_limit = max(1, min(limit, 500))
    return fetch_all(
        """
        SELECT decision_id, source, strategy_id, symbol, provider, regime,
               score_pre_trade, pnl_5m, pnl_1h, pnl_24h, mae, mfe,
               slippage_real_bps, latency_ms, fees_usd, net_result_usd,
               status, created_at, updated_at
        FROM decision_outcomes
        ORDER BY updated_at DESC
        LIMIT %s
        """,
        (safe_limit,),
    )


@app.get("/v1/outcomes/calibration")
async def outcomes_calibration(auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    rows = fetch_all(
        """
        SELECT
            FLOOR(COALESCE(score_pre_trade, 0) * 10) / 10.0 AS score_bucket,
            COUNT(*) AS sample_count,
            AVG(COALESCE(net_result_usd, 0)) AS avg_net_result_usd,
            AVG(CASE WHEN COALESCE(net_result_usd, 0) > 0 THEN 1 ELSE 0 END) AS win_rate
        FROM decision_outcomes
        WHERE score_pre_trade IS NOT NULL
        GROUP BY score_bucket
        ORDER BY score_bucket
        """
    )
    return {"status": "ok", "buckets": rows}


@app.get("/v1/strategies/drift")
async def strategies_drift(auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    rows = fetch_all(
        """
        SELECT strategy_id, regime, window_hours, sample_count, win_rate,
               avg_net_result_usd, drawdown_usd, drift_detected, auto_suspended,
               auto_resumed, cooldown_until, reason, updated_at
        FROM strategy_health_state
        ORDER BY updated_at DESC
        LIMIT 200
        """
    )
    return {"status": "ok", "window_hours": _drift_window_hours(), "items": rows}


@app.get("/v1/strategies/drift-thresholds")
async def strategy_drift_thresholds(auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    rows = fetch_all(
        """
        SELECT regime, min_samples, min_win_rate, max_drawdown_usd, max_avg_loss_usd, updated_at
        FROM strategy_regime_thresholds
        ORDER BY regime
        """
    )
    return {"status": "ok", "items": rows}


@app.post("/v1/strategies/drift-thresholds")
async def upsert_strategy_drift_threshold(payload: dict, auth: AuthContext = Depends(operator_auth)) -> dict:
    regime = str(payload.get("regime", "")).strip().lower()
    if not regime:
        raise HTTPException(status_code=400, detail="regime is required")
    min_samples = max(5, int(payload.get("min_samples", 20)))
    min_win_rate = _clamp01(_to_float(payload.get("min_win_rate"), 0.48))
    max_drawdown_usd = max(10.0, _to_float(payload.get("max_drawdown_usd"), 800.0))
    max_avg_loss_usd = max(5.0, _to_float(payload.get("max_avg_loss_usd"), 120.0))
    execute(
        """
        INSERT INTO strategy_regime_thresholds (regime, min_samples, min_win_rate, max_drawdown_usd, max_avg_loss_usd, updated_at)
        VALUES (%s, %s, %s, %s, %s, NOW())
        ON CONFLICT (regime) DO UPDATE SET
            min_samples = EXCLUDED.min_samples,
            min_win_rate = EXCLUDED.min_win_rate,
            max_drawdown_usd = EXCLUDED.max_drawdown_usd,
            max_avg_loss_usd = EXCLUDED.max_avg_loss_usd,
            updated_at = NOW()
        """,
        (regime, min_samples, min_win_rate, max_drawdown_usd, max_avg_loss_usd),
    )
    _recompute_strategy_drift_state(regime=regime)
    append_audit("strategy_drift_threshold_updated", {"regime": regime, "by": auth.username})
    return {
        "status": "ok",
        "item": {
            "regime": regime,
            "min_samples": min_samples,
            "min_win_rate": min_win_rate,
            "max_drawdown_usd": max_drawdown_usd,
            "max_avg_loss_usd": max_avg_loss_usd,
        },
    }


@app.post("/v1/strategies/{strategy_id}/resume")
async def resume_strategy(strategy_id: str, auth: AuthContext = Depends(operator_auth)) -> dict:
    execute(
        "UPDATE strategies SET status = 'active', updated_at = NOW() WHERE strategy_id = %s",
        (strategy_id,),
    )
    append_audit("strategy_resumed_manual", {"strategy_id": strategy_id, "by": auth.username})
    return {"status": "ok", "strategy_id": strategy_id, "new_status": "active"}


@app.get("/v1/experiments/memory-ab")
async def memory_ab_stats(window_hours: int = 24 * 7, auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    window = max(24, min(24 * 30, window_hours))
    summary = fetch_all(
        """
        SELECT arm,
               COUNT(*) AS samples,
               AVG(COALESCE(score_after, 0)) AS avg_score_after,
               AVG(CASE WHEN COALESCE(outcome_net_result_usd, 0) > 0 THEN 1 ELSE 0 END) AS win_rate,
               AVG(COALESCE(outcome_net_result_usd, 0)) AS avg_outcome
        FROM memory_ab_events
        WHERE created_at >= NOW() - (%s * INTERVAL '1 hour')
        GROUP BY arm
        ORDER BY arm
        """,
        (window,),
    )
    by_arm = {str(row.get("arm", "")): row for row in summary}
    on_row = by_arm.get("memory_on", {})
    off_row = by_arm.get("memory_off", {})
    on_n = int(on_row.get("samples") or 0)
    off_n = int(off_row.get("samples") or 0)
    on_w = int(round(_to_float(on_row.get("win_rate"), 0.0) * on_n))
    off_w = int(round(_to_float(off_row.get("win_rate"), 0.0) * off_n))
    p_value = _two_proportion_p_value(on_w, on_n, off_w, off_n)
    effect = _to_float(on_row.get("win_rate"), 0.0) - _to_float(off_row.get("win_rate"), 0.0)

    return {
        "status": "ok",
        "window_hours": window,
        "arms": summary,
        "with_vs_without_memory": {
            "winrate_delta": round(effect, 6),
            "p_value_two_sided": round(p_value, 6) if p_value is not None else None,
            "significant_95": bool(p_value is not None and p_value < 0.05),
            "samples": {"memory_on": on_n, "memory_off": off_n},
        },
    }


@app.get("/v1/incidents")
async def list_incidents(status: str = "", auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    threshold = _incident_unassigned_alert_minutes()
    if status:
        rows = fetch_all(
            """
            SELECT ticket_key, severity, title, status, assignee, source, payload, created_by,
                   resolution_note, closed_by, closed_at, created_at, updated_at,
                   ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0, 1) AS age_minutes,
                   CASE
                     WHEN status IN ('open', 'assigned') AND assignee IS NULL AND NOW() - created_at >= (%s * INTERVAL '1 minute')
                     THEN TRUE ELSE FALSE
                   END AS sla_breached
            FROM incident_tickets
            WHERE status = %s
            ORDER BY created_at DESC
            LIMIT 300
            """,
            (threshold, status),
        )
    else:
        rows = fetch_all(
            """
            SELECT ticket_key, severity, title, status, assignee, source, payload, created_by,
                   resolution_note, closed_by, closed_at, created_at, updated_at,
                   ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0, 1) AS age_minutes,
                   CASE
                     WHEN status IN ('open', 'assigned') AND assignee IS NULL AND NOW() - created_at >= (%s * INTERVAL '1 minute')
                     THEN TRUE ELSE FALSE
                   END AS sla_breached
            FROM incident_tickets
            ORDER BY created_at DESC
            LIMIT 300
            """,
            (threshold,),
        )
    return {"status": "ok", "sla_minutes": threshold, "items": rows}


@app.post("/v1/incidents/{ticket_key}/assign")
async def assign_incident(ticket_key: str, payload: dict, auth: AuthContext = Depends(operator_auth)) -> dict:
    assignee = str(payload.get("assignee") or "").strip() or auth.username
    execute(
        """
        UPDATE incident_tickets
        SET assignee = %s,
            status = CASE WHEN status = 'open' THEN 'assigned' ELSE status END,
            updated_at = NOW()
        WHERE ticket_key = %s
        """,
        (assignee, ticket_key),
    )
    append_audit("incident_assigned", {"ticket_key": ticket_key, "assignee": assignee, "by": auth.username})
    return {"status": "ok", "ticket_key": ticket_key, "assignee": assignee}


@app.post("/v1/incidents/{ticket_key}/close")
async def close_incident(ticket_key: str, payload: dict, auth: AuthContext = Depends(operator_auth)) -> dict:
    note = str(payload.get("resolution_note") or "Resolved by operator").strip()
    execute(
        """
        UPDATE incident_tickets
        SET status = 'closed',
            resolution_note = %s,
            closed_by = %s,
            closed_at = NOW(),
            updated_at = NOW()
        WHERE ticket_key = %s
        """,
        (note, auth.username, ticket_key),
    )
    append_audit("incident_closed", {"ticket_key": ticket_key, "by": auth.username})
    return {"status": "ok", "ticket_key": ticket_key, "closed_by": auth.username}


@app.get("/v1/live-readiness/overview")
async def live_readiness_overview(auth: AuthContext = Depends(viewer_auth)) -> dict:
    async with httpx.AsyncClient(timeout=20.0) as client:
        retrieval_kpi_resp = await client.get(f"{EMBEDDINGS_SERVICE_URL}/v1/kpi/retrieval", params={"window_hours": 24})
    retrieval_kpi = retrieval_kpi_resp.json() if retrieval_kpi_resp.status_code < 400 else {"status": "degraded"}

    drift_items = fetch_all(
        """
        SELECT strategy_id, regime, sample_count, win_rate, drawdown_usd,
               drift_detected, auto_suspended, auto_resumed, cooldown_until, reason, updated_at
        FROM strategy_health_state
        ORDER BY updated_at DESC
        LIMIT 100
        """
    )
    suspended = fetch_all(
        """
        SELECT strategy_id, name, market, setup_type, status, updated_at
        FROM strategies
        WHERE status = 'suspended_drift'
        ORDER BY updated_at DESC
        """
    )
    ab = await memory_ab_stats(window_hours=24 * 7, auth=auth)
    return {
        "status": "ok",
        "memory_kpi": retrieval_kpi,
        "drift": {
            "window_hours": _drift_window_hours(),
            "items": drift_items,
            "suspended_strategies": suspended,
            "auto_resume": {
                "enabled": _auto_resume_enabled(),
                "cooldown_hours": _auto_resume_cooldown_hours(),
            },
        },
        "memory_ab": ab,
    }


@app.post("/v1/copilot/chat")
async def copilot_chat(payload: dict, auth: AuthContext = Depends(viewer_auth)) -> dict:
    confirm_token = str(payload.get("confirm_token", "")).strip()
    confirm_ack = bool(payload.get("confirm_ack", False))

    if confirm_token and confirm_ack:
        confirmed = _consume_action_confirmation(confirm_token, auth.username)
        if not confirmed:
            return {
                "status": "error",
                "reply": "Confirmation invalide ou expiree. Relance l'action guidee.",
                "actions": ["open_help"],
            }
        action_payload = dict(confirmed["action_payload"])
        action_payload["type"] = confirmed["action_type"]
        result = await _execute_chat_action(action_payload, auth)
        _mark_action_confirmation_executed(int(confirmed["id"]))
        result["confirmation"] = {"status": "executed", "token": confirm_token}
        return result

    action = payload.get("action") if isinstance(payload.get("action"), dict) else None
    if action:
        action_type = str(action.get("type", "")).strip().lower()
        safe_mode = bool(payload.get("safe_mode", True))
        if _requires_safe_confirmation(action_type) and safe_mode:
            confirmation = _create_action_confirmation(action_type, action, auth.username)
            return {
                "status": "confirmation_required",
                "reply": "Confirmation requise: valide une seconde fois pour executer l'action sensible.",
                "confirmation": confirmation,
                "actions": ["confirm_sensitive_action"],
            }
        return await _execute_chat_action(action, auth)

    message = str(payload.get("message", "")).strip().lower()
    if not message:
        return {
            "status": "ok",
            "reply": "Pose une question sur readiness, drift, A/B memory, ou declenche une action guidee.",
            "actions": ["open_live_readiness", "open_memory_ab_panel"],
            "suggested_actions": [
                {"type": "apply_threshold", "label": "Appliquer seuil regime"},
                {"type": "open_incident_ticket", "label": "Ouvrir ticket incident"},
                {"type": "run_runbook", "label": "Lancer runbook stabilize_trading"},
            ],
        }

    if "readiness" in message or "live" in message:
        data = await live_readiness_overview(auth)
        suspended = len((data.get("drift") or {}).get("suspended_strategies", []))
        reply = f"Live Readiness: {suspended} strategie(s) suspendue(s), voir panneau readiness pour details."
        return {"status": "ok", "reply": reply, "data": data, "actions": ["open_live_readiness"]}

    if "drift" in message or "derive" in message:
        drift = await strategies_drift(auth)
        active_drift = [x for x in drift.get("items", []) if x.get("drift_detected")]
        return {
            "status": "ok",
            "reply": f"Drift detecte sur {len(active_drift)} ligne(s) regime/strategie.",
            "data": {"drift": active_drift[:20]},
            "actions": ["review_suspended_strategies"],
        }

    if "a/b" in message or "ab" in message or "memory" in message:
        ab = await memory_ab_stats(auth=auth)
        return {
            "status": "ok",
            "reply": "Comparatif A/B memory genere.",
            "data": ab,
            "actions": ["open_memory_ab_panel"],
        }

    if "ticket" in message or "incident" in message:
        return {
            "status": "ok",
            "reply": "Je peux ouvrir un ticket incident pour toi. Utilise l'action guidee.",
            "suggested_actions": [
                {"type": "open_incident_ticket", "label": "Ouvrir ticket incident", "severity": "high"},
            ],
            "actions": ["open_incident_board"],
        }

    if "incident list" in message or "liste incident" in message:
        incidents = await list_incidents(auth=auth)
        return {
            "status": "ok",
            "reply": f"{len(incidents.get('items', []))} incident(s) charges.",
            "data": incidents,
            "actions": ["open_incident_board"],
        }

    if "runbook" in message:
        return {
            "status": "ok",
            "reply": "Tu peux lancer le runbook stabilize_trading pour recalculer derive et readiness.",
            "suggested_actions": [
                {"type": "run_runbook", "name": "stabilize_trading", "label": "Lancer stabilize_trading"},
            ],
            "actions": ["open_live_readiness"],
        }

    return {
        "status": "ok",
        "reply": "Je peux t'aider sur: live readiness, drift, A/B memory, resume strategy.",
        "actions": ["open_help"],
        "context": {"user": auth.username, "role": auth.role},
    }


@app.get("/v1/connectors/status")
async def connectors_status(auth: AuthContext = Depends(viewer_auth)) -> dict:
    del auth
    return await _compute_connectors_snapshot()


@app.websocket("/v1/connectors/ws")
async def connectors_ws(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token", "").strip()
    user = _resolve_websocket_user(token)
    if not user:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    try:
        while True:
            snapshot = await _compute_connectors_snapshot()
            await websocket.send_json(snapshot)
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        return


@app.websocket("/ws/v1/execution/telemetry")
async def execution_telemetry_ws(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token", "").strip()
    user = _resolve_websocket_user(token)
    if not user:
        await websocket.close(code=4401)
        return

    try:
        limit = int(websocket.query_params.get("limit", "20"))
    except ValueError:
        limit = 20
    safe_limit = max(1, min(limit, 200))

    await websocket.accept()
    sent_ids: set[str] = set()

    try:
        snapshot = _execution_telemetry_rows(safe_limit)
        for item in snapshot:
            telemetry_id = str(item.get("telemetry_id") or "").strip()
            if telemetry_id:
                sent_ids.add(telemetry_id)
        await websocket.send_json({"type": "snapshot", "items": snapshot})

        while True:
            await asyncio.sleep(1)
            latest = _execution_telemetry_rows(safe_limit)
            new_items: list[dict] = []
            for item in reversed(latest):
                telemetry_id = str(item.get("telemetry_id") or "").strip()
                if telemetry_id and telemetry_id not in sent_ids:
                    new_items.append(item)
                    sent_ids.add(telemetry_id)

            for item in new_items:
                await websocket.send_json({"type": "telemetry", "item": item})

            if len(sent_ids) > safe_limit * 20:
                sent_ids = {
                    str(item.get("telemetry_id") or "").strip()
                    for item in latest
                    if str(item.get("telemetry_id") or "").strip()
                }
    except WebSocketDisconnect:
        return


@app.websocket("/ws/v1/market/quotes")
async def market_quotes_ws(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token", "").strip()
    user = _resolve_websocket_user(token)
    if not user:
        await websocket.close(code=4401)
        return

    instrument_filter = _normalize_symbol(websocket.query_params.get("instrument", "").strip())
    if instrument_filter in {"", "-"}:
        instrument_filter = ""

    await websocket.accept()
    last_digest = ""

    try:
        while True:
            rows = await _fetch_market_quotes()
            if instrument_filter:
                rows = [row for row in rows if _normalize_symbol(str(row.get("instrument", ""))) == instrument_filter]

            digest = hashlib.sha256(json_dumps(rows).encode("utf-8")).hexdigest()
            if digest != last_digest:
                await websocket.send_json({"type": "snapshot", "items": rows})
                last_digest = digest
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        return


async def fetch_policy() -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(f"{RISK_GATEWAY_URL}/v1/policies")
        return response.json()


async def execute_approved_intent(intent_payload: dict, risk_decision: RiskDecision) -> OrderResult:
    _assert_kill_switch_allows_execution()
    async with httpx.AsyncClient(timeout=10.0) as client:
        execution_response = await client.post(
            f"{EXECUTION_ROUTER_URL}/v1/orders",
            json={
                "intent": intent_payload,
                "risk_decision": risk_decision.model_dump(),
                "execution_mode": "paper",
            },
        )

        if execution_response.status_code >= 400:
            _record_api_error("execution-router", "intent_execution_failed")
            raise HTTPException(status_code=502, detail="Execution router unavailable")

        order = OrderResult.model_validate(execution_response.json())
        execute(
            """
            INSERT INTO orders (order_id, intent_id, venue, instrument, side, requested_notional_usd, filled_notional_usd, avg_fill_price, execution_mode, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (order_id) DO NOTHING
            """,
            (
                order.order_id,
                intent_payload["intent_id"],
                order.venue,
                order.instrument,
                order.side.value,
                order.requested_notional_usd,
                order.filled_notional_usd,
                order.avg_fill_price,
                order.execution_mode,
                order.status,
            ),
        )
        persist_intent(intent_payload, "executed", risk_decision)
        append_audit(
            "order_executed",
            {
                "intent_id": intent_payload["intent_id"],
                "order_id": order.order_id,
                "status": order.status,
            },
        )
        execute(
            """
            INSERT INTO decision_outcomes (decision_id, source, strategy_id, symbol, provider, regime, score_pre_trade,
                                           slippage_real_bps, latency_ms, fees_usd, net_result_usd, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s)
            ON CONFLICT (decision_id) DO NOTHING
            """,
            (
                order.order_id,
                "intent",
                intent_payload.get("strategy_id"),
                intent_payload.get("instrument"),
                order.venue,
                intent_payload.get("regime", "unknown"),
                intent_payload.get("confidence"),
                0.0,
                0,
                0.0,
                0.0,
                "pending",
            ),
        )
        return order


@app.post("/v1/intents/{intent_id}/approve", response_model=IntentSubmissionResponse)
async def approve_pending_intent(intent_id: str, request: ApprovalRequest, auth: AuthContext = Depends(operator_auth)) -> IntentSubmissionResponse:
    pending = PENDING_INTENTS.get(intent_id)
    if not pending:
        raise HTTPException(status_code=404, detail="Pending intent not found")

    if not verify_approval_signature(request.signed_payload, request.signature):
        raise HTTPException(status_code=403, detail="Invalid approval signature")

    execute(
        "INSERT INTO approval_events (intent_id, approver, role, signature, signed_payload) VALUES (%s, %s, %s, %s, %s)",
        (intent_id, auth.principal, auth.role, request.signature, request.signed_payload),
    )

    risk_decision = RiskDecision.model_validate(pending["risk_decision"])
    if risk_decision.decision != "accept":
        raise HTTPException(status_code=400, detail="Only accepted intents can be approved")

    order = await execute_approved_intent(pending["intent"], risk_decision)
    del PENDING_INTENTS[intent_id]
    append_audit("intent_approved", {"intent_id": intent_id, "approver": auth.principal, "role": auth.role})
    return IntentSubmissionResponse(
        intent_id=intent_id,
        system_mode=CURRENT_SYSTEM_MODE,
        status="approved_and_executed",
        risk_decision=risk_decision,
        order=order,
    )


@app.post("/v1/intents/submit", response_model=IntentSubmissionResponse)
async def submit_intent(request: IntentSubmissionRequest, auth: AuthContext = Depends(operator_auth)) -> IntentSubmissionResponse:
    del auth
    append_audit(
        "intent_received",
        {"intent_id": request.intent.intent_id, "strategy_id": request.intent.strategy_id},
    )

    async with httpx.AsyncClient(timeout=10.0) as client:
        risk_response = await client.post(
            f"{RISK_GATEWAY_URL}/v1/checks/pre-trade",
            json=RiskCheckRequest(intent=request.intent, system_mode=CURRENT_SYSTEM_MODE).model_dump(),
        )

        if risk_response.status_code >= 400:
            raise HTTPException(status_code=502, detail="Risk gateway unavailable")

        risk_decision = RiskDecision.model_validate(risk_response.json())
        append_audit(
            "risk_decision",
            {
                "intent_id": request.intent.intent_id,
                "decision": risk_decision.decision,
                "reasons": risk_decision.reasons,
            },
        )

        if risk_decision.decision != "accept":
            persist_intent(request.intent.model_dump(), "rejected_by_risk", risk_decision)
            return IntentSubmissionResponse(
                intent_id=request.intent.intent_id,
                system_mode=CURRENT_SYSTEM_MODE,
                status="rejected_by_risk",
                risk_decision=risk_decision,
            )

        if not request.auto_execute or CURRENT_SYSTEM_MODE in {SystemMode.OBSERVE, SystemMode.SUGGEST}:
            PENDING_INTENTS[request.intent.intent_id] = {
                "intent": request.intent.model_dump(),
                "risk_decision": risk_decision.model_dump(),
            }
            persist_intent(request.intent.model_dump(), "pending_approval", risk_decision)
            append_audit(
                "intent_queued_for_approval",
                {"intent_id": request.intent.intent_id, "mode": CURRENT_SYSTEM_MODE},
            )
            return IntentSubmissionResponse(
                intent_id=request.intent.intent_id,
                system_mode=CURRENT_SYSTEM_MODE,
                status="accepted_waiting_human_or_higher_mode",
                risk_decision=risk_decision,
            )

        order = await execute_approved_intent(request.intent.model_dump(), risk_decision)
        return IntentSubmissionResponse(
            intent_id=request.intent.intent_id,
            system_mode=CURRENT_SYSTEM_MODE,
            status="executed_in_paper_mode",
            risk_decision=risk_decision,
            order=order,
        )


@app.post("/v1/intents/{intent_id}/approve/server-signed", response_model=IntentSubmissionResponse)
async def approve_pending_intent_server_signed(intent_id: str, auth: AuthContext = Depends(operator_auth)) -> IntentSubmissionResponse:
    payload = f"intent_id={intent_id}|action=approve|by={auth.username}|ts={datetime.now(timezone.utc).isoformat()}"
    signature = sign_approval_payload(payload)
    request = ApprovalRequest(signed_payload=payload, signature=signature)
    return await approve_pending_intent(intent_id, request, auth)
