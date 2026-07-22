from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _now_utc(now: datetime | None = None) -> datetime:
    if isinstance(now, datetime):
        return now.astimezone(timezone.utc) if now.tzinfo else now.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


def _parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    normalized = str(value).strip()
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return fallback
    if numeric != numeric:
        return fallback
    return numeric


def _round_or_none(value: float | None, digits: int = 6) -> float | None:
    if value is None:
        return None
    return round(value, digits)


def _normalize_side(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"buy", "long"}:
        return "long"
    if normalized in {"sell", "short"}:
        return "short"
    return normalized or "flat"


def _normalize_leg(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    trigger_price = _to_float(value.get("trigger_price"), _to_float(value.get("stopPrice"), _to_float(value.get("price"), 0.0)))
    if trigger_price <= 0:
        return None
    normalized: dict[str, Any] = {
        "trigger_price": round(trigger_price, 10),
        "order_type": str(value.get("order_type") or value.get("type") or value.get("origType") or "MARKET").strip() or "MARKET",
        "working_type": str(value.get("working_type") or value.get("workingType") or "MARK_PRICE").strip() or "MARK_PRICE",
    }
    limit_price = _to_float(value.get("limit_price"), _to_float(value.get("price"), 0.0))
    if limit_price > 0:
        normalized["limit_price"] = round(limit_price, 10)
    order_id = str(value.get("order_id") or value.get("orderId") or value.get("id") or "").strip()
    if order_id:
        normalized["order_id"] = order_id
    order_status = str(value.get("status") or "").strip()
    if order_status:
        normalized["status"] = order_status
    as_of = str(value.get("as_of") or value.get("created_at") or value.get("updateTime") or "").strip()
    if as_of:
        normalized["as_of"] = as_of
    return normalized


def _normalize_protection_payload(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, Any] = {}
    stop_loss = _normalize_leg(value.get("stop_loss") or value.get("sl"))
    take_profit = _normalize_leg(value.get("take_profit") or value.get("tp"))
    if stop_loss:
        normalized["stop_loss"] = stop_loss
    if take_profit:
        normalized["take_profit"] = take_profit
    for field in ("status", "mode", "reason", "source"):
        field_value = str(value.get(field) or "").strip()
        if field_value:
            normalized[field] = field_value
    require_full_acceptance = value.get("require_full_acceptance")
    if isinstance(require_full_acceptance, bool):
        normalized["require_full_acceptance"] = require_full_acceptance
    return normalized


def build_live_freshness_summary(
    as_of: Any,
    *,
    now: datetime | None = None,
    stale_after_seconds: int = 900,
    warn_after_ratio: float = 0.5,
) -> dict[str, Any]:
    parsed = _parse_iso(as_of)
    if parsed is None:
        return {
            "as_of": None,
            "age_seconds": None,
            "status": "unknown",
            "stale_after_seconds": int(max(1, stale_after_seconds)),
            "warn_after_seconds": int(max(1, stale_after_seconds) * max(0.0, min(1.0, warn_after_ratio))),
            "is_live_truth": False,
        }
    safe_now = _now_utc(now)
    age_seconds = max(0.0, (safe_now - parsed).total_seconds())
    safe_stale_after = int(max(1, stale_after_seconds))
    warn_after_seconds = int(max(1, safe_stale_after * max(0.0, min(1.0, warn_after_ratio))))
    if age_seconds > safe_stale_after:
        status = "stale"
    elif age_seconds > warn_after_seconds:
        status = "aging"
    else:
        status = "live"
    return {
        "as_of": parsed.isoformat(),
        "age_seconds": round(age_seconds, 3),
        "status": status,
        "stale_after_seconds": safe_stale_after,
        "warn_after_seconds": warn_after_seconds,
        "is_live_truth": status in {"live", "aging"},
    }


def _position_pnl_bps(position: dict[str, Any]) -> float | None:
    side = _normalize_side(position.get("side"))
    entry_price = _to_float(position.get("avg_entry_price"), 0.0)
    mark_price = _to_float(position.get("mark_price"), 0.0)
    if entry_price <= 0 or mark_price <= 0 or side not in {"long", "short"}:
        return None
    direction = 1.0 if side == "long" else -1.0
    return direction * ((mark_price - entry_price) / entry_price) * 10000.0


def build_live_position_protection_status(
    position: dict[str, Any],
    *,
    provider: str,
    broker_truth_source: str,
    requested_protection: dict[str, Any] | None = None,
    broker_accepted_protection: dict[str, Any] | None = None,
    active_protection: dict[str, Any] | None = None,
    stale_after_seconds: int = 900,
    now: datetime | None = None,
) -> dict[str, Any]:
    requested = _normalize_protection_payload(requested_protection)
    accepted = _normalize_protection_payload(broker_accepted_protection)
    active = _normalize_protection_payload(active_protection)
    freshness = build_live_freshness_summary(position.get("as_of"), now=now, stale_after_seconds=stale_after_seconds)
    symbol = str(position.get("symbol") or position.get("instrument") or "").strip().upper()
    position_id = str(position.get("position_id") or f"{provider}:{position.get('account_id', '')}:{symbol}:{position.get('side', '')}").strip()
    side = _normalize_side(position.get("side"))
    mark_price = _to_float(position.get("mark_price"), 0.0)
    avg_entry_price = _to_float(position.get("avg_entry_price"), 0.0)
    pnl_bps = _position_pnl_bps(position)
    live_truth = bool(freshness.get("is_live_truth")) and "reconstructed" not in broker_truth_source.lower()

    has_requested_stop = bool(requested.get("stop_loss"))
    has_requested_tp = bool(requested.get("take_profit"))
    has_accepted_stop = bool(accepted.get("stop_loss"))
    has_accepted_tp = bool(accepted.get("take_profit"))
    has_active_stop = bool(active.get("stop_loss"))
    has_active_tp = bool(active.get("take_profit"))

    missing_legs: list[str] = []
    if not has_active_stop:
        missing_legs.append("stop_loss")
    if not has_active_tp:
        missing_legs.append("take_profit")

    if not live_truth:
        protection_status = "stale_snapshot"
    elif has_active_stop and has_active_tp:
        protection_status = "protected"
    elif has_active_stop or has_active_tp:
        protection_status = "protection_partial"
    elif has_requested_stop or has_requested_tp or has_accepted_stop or has_accepted_tp:
        protection_status = "protection_pending"
    else:
        protection_status = "unprotected"

    return {
        "position_id": position_id,
        "account_id": str(position.get("account_id") or "").strip(),
        "provider": str(provider).strip().lower(),
        "symbol": symbol,
        "side": side,
        "quantity": round(abs(_to_float(position.get("quantity"), 0.0)), 10),
        "notional_usd": _round_or_none(abs(_to_float(position.get("notional_usd"), 0.0)), 8),
        "avg_entry_price": _round_or_none(avg_entry_price, 10),
        "mark_price": _round_or_none(mark_price, 10),
        "pnl_unrealized_usd": _round_or_none(_to_float(position.get("pnl_unrealized_usd"), 0.0), 8),
        "pnl_bps": _round_or_none(pnl_bps, 6),
        "position_as_of": freshness.get("as_of"),
        "protection_as_of": str(active.get("stop_loss", {}).get("as_of") or active.get("take_profit", {}).get("as_of") or freshness.get("as_of") or "").strip() or None,
        "freshness_status": freshness.get("status"),
        "snapshot_age_seconds": freshness.get("age_seconds"),
        "stale_after_seconds": freshness.get("stale_after_seconds"),
        "live_truth": live_truth,
        "snapshot_source": str(position.get("source") or "").strip(),
        "broker_truth_source": broker_truth_source,
        "requested_protection": requested,
        "broker_accepted_protection": accepted,
        "broker_active_protection": active,
        "protection_status": protection_status,
        "missing_legs": missing_legs,
        "payload": position.get("payload") if isinstance(position.get("payload"), dict) else {},
    }


def build_position_protection_governor(
    status_row: dict[str, Any],
    *,
    policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config = policy if isinstance(policy, dict) else {}
    breakeven_trigger_bps = max(1.0, _to_float(config.get("breakeven_trigger_bps"), 35.0))
    trailing_trigger_bps = max(breakeven_trigger_bps, _to_float(config.get("trailing_trigger_bps"), 90.0))
    trailing_buffer_bps = max(1.0, _to_float(config.get("trailing_buffer_bps"), 35.0))
    max_adverse_without_stop_bps = max(1.0, _to_float(config.get("max_adverse_without_stop_bps"), 60.0))

    provider = str(status_row.get("provider") or "").strip().lower()
    side = _normalize_side(status_row.get("side"))
    live_truth = bool(status_row.get("live_truth"))
    pnl_bps = _to_float(status_row.get("pnl_bps"), 0.0)
    avg_entry_price = _to_float(status_row.get("avg_entry_price"), 0.0)
    mark_price = _to_float(status_row.get("mark_price"), 0.0)
    active = status_row.get("broker_active_protection") if isinstance(status_row.get("broker_active_protection"), dict) else {}
    active_stop = active.get("stop_loss") if isinstance(active.get("stop_loss"), dict) else None
    active_tp = active.get("take_profit") if isinstance(active.get("take_profit"), dict) else None
    missing_legs = status_row.get("missing_legs") if isinstance(status_row.get("missing_legs"), list) else []

    recommended_action = "HOLD"
    reason = "position_protected"
    actionable = False
    capability = "none"
    suggested_protection: dict[str, Any] = {}

    if not live_truth:
        recommended_action = "NO_ACTION_STALE"
        reason = "stale_or_reconstructed_snapshot"
    elif "stop_loss" in missing_legs and pnl_bps <= -max_adverse_without_stop_bps:
        recommended_action = "FORCE_CLOSE"
        reason = "adverse_move_without_stop_loss"
        actionable = True
        capability = "force_close"
    elif "stop_loss" in missing_legs:
        recommended_action = "ARM_STOP_LOSS"
        reason = "stop_loss_missing"
    elif avg_entry_price > 0 and mark_price > 0 and pnl_bps >= breakeven_trigger_bps and active_stop:
        current_stop = _to_float(active_stop.get("trigger_price"), 0.0)
        breakeven_price = avg_entry_price
        if side == "long" and current_stop + 1e-9 < breakeven_price:
            recommended_action = "MOVE_STOP_TO_BREAKEVEN"
            reason = "breakeven_unlocked"
            suggested_protection["stop_loss"] = {
                "trigger_price": round(breakeven_price, 10),
                "working_type": active_stop.get("working_type") or "MARK_PRICE",
                "order_type": active_stop.get("order_type") or "MARKET",
            }
        elif side == "short" and current_stop - 1e-9 > breakeven_price:
            recommended_action = "MOVE_STOP_TO_BREAKEVEN"
            reason = "breakeven_unlocked"
            suggested_protection["stop_loss"] = {
                "trigger_price": round(breakeven_price, 10),
                "working_type": active_stop.get("working_type") or "MARK_PRICE",
                "order_type": active_stop.get("order_type") or "MARKET",
            }

    if recommended_action == "HOLD" and avg_entry_price > 0 and mark_price > 0 and pnl_bps >= trailing_trigger_bps and active_stop:
        current_stop = _to_float(active_stop.get("trigger_price"), 0.0)
        if side == "long":
            trailing_stop = mark_price * (1.0 - trailing_buffer_bps / 10000.0)
            if trailing_stop > max(current_stop, avg_entry_price):
                recommended_action = "TRAIL_STOP"
                reason = "trail_profit_lock"
                suggested_protection["stop_loss"] = {
                    "trigger_price": round(trailing_stop, 10),
                    "working_type": active_stop.get("working_type") or "MARK_PRICE",
                    "order_type": active_stop.get("order_type") or "MARKET",
                }
        elif side == "short":
            trailing_stop = mark_price * (1.0 + trailing_buffer_bps / 10000.0)
            if current_stop <= 0 or trailing_stop < min(current_stop, avg_entry_price):
                recommended_action = "TRAIL_STOP"
                reason = "trail_profit_lock"
                suggested_protection["stop_loss"] = {
                    "trigger_price": round(trailing_stop, 10),
                    "working_type": active_stop.get("working_type") or "MARK_PRICE",
                    "order_type": active_stop.get("order_type") or "MARKET",
                }

    if recommended_action == "HOLD" and "take_profit" in missing_legs and active_stop and avg_entry_price > 0:
        stop_trigger = _to_float(active_stop.get("trigger_price"), 0.0)
        risk_distance = abs(avg_entry_price - stop_trigger)
        if risk_distance > 0:
            if side == "long":
                tp_trigger = avg_entry_price + risk_distance * 2.0
            else:
                tp_trigger = avg_entry_price - risk_distance * 2.0
            if tp_trigger > 0:
                recommended_action = "ARM_TAKE_PROFIT"
                reason = "take_profit_missing"
                suggested_protection["take_profit"] = {
                    "trigger_price": round(tp_trigger, 10),
                    "working_type": "MARK_PRICE",
                    "order_type": "MARKET",
                }

    if active_stop and "stop_loss" not in suggested_protection:
        suggested_protection["stop_loss"] = active_stop
    if active_tp and "take_profit" not in suggested_protection:
        suggested_protection["take_profit"] = active_tp

    if recommended_action in {"MOVE_STOP_TO_BREAKEVEN", "TRAIL_STOP", "ARM_STOP_LOSS", "ARM_TAKE_PROFIT"}:
        if provider == "bingx":
            capability = "cancel_replace"
            actionable = True
        else:
            capability = "manual_required"
            actionable = False
    elif recommended_action == "FORCE_CLOSE":
        capability = "force_close" if provider == "bingx" else "pending_bridge_support"
        actionable = provider == "bingx"

    return {
        "engine": "LivePositionProtectionGovernor",
        "recommended_action": recommended_action,
        "reason": reason,
        "actionable": actionable,
        "execution_capability": capability,
        "suggested_protection": suggested_protection,
        "policy": {
            "breakeven_trigger_bps": breakeven_trigger_bps,
            "trailing_trigger_bps": trailing_trigger_bps,
            "trailing_buffer_bps": trailing_buffer_bps,
            "max_adverse_without_stop_bps": max_adverse_without_stop_bps,
        },
    }


def detect_protection_status_events(previous: dict[str, Any] | None, current: dict[str, Any]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    if not previous:
        events.append({"event_type": "observed", "event_reason": "position_first_seen", "event_payload": current})
        return events

    if str(previous.get("protection_status") or "") != str(current.get("protection_status") or ""):
        events.append(
            {
                "event_type": "protection_status_changed",
                "event_reason": f"{previous.get('protection_status') or 'unknown'}->{current.get('protection_status') or 'unknown'}",
                "event_payload": {
                    "previous": previous.get("protection_status"),
                    "current": current.get("protection_status"),
                    "missing_legs": current.get("missing_legs"),
                },
            }
        )

    if str(previous.get("freshness_status") or "") != str(current.get("freshness_status") or ""):
        events.append(
            {
                "event_type": "freshness_status_changed",
                "event_reason": f"{previous.get('freshness_status') or 'unknown'}->{current.get('freshness_status') or 'unknown'}",
                "event_payload": {
                    "previous": previous.get("freshness_status"),
                    "current": current.get("freshness_status"),
                    "snapshot_age_seconds": current.get("snapshot_age_seconds"),
                },
            }
        )

    previous_governor = previous.get("governor_state") if isinstance(previous.get("governor_state"), dict) else {}
    current_governor = current.get("governor_state") if isinstance(current.get("governor_state"), dict) else {}
    if str(previous_governor.get("recommended_action") or "") != str(current_governor.get("recommended_action") or ""):
        action = str(current_governor.get("recommended_action") or "").strip()
        if action and action not in {"HOLD", "NO_ACTION_STALE"}:
            events.append(
                {
                    "event_type": "governor_recommendation_changed",
                    "event_reason": action.lower(),
                    "event_payload": current_governor,
                }
            )

    return events