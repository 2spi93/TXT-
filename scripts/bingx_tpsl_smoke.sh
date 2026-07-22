#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/control_plane_helpers.sh
. "$SCRIPT_DIR/lib/control_plane_helpers.sh"

txt_source_repo_env

CONTROL_PLANE_URL=""
USERNAME="${USERNAME:-operator}"
PASSWORD="${PASSWORD:-}"
ACCOUNT_ID="${ACCOUNT_ID:-BINGX_ACCOUNT_ID_REQUIRED}"
SYMBOL="${SYMBOL:-BTCUSDT}"
SIDE="${SIDE:-buy}"
NOTIONAL_USD="${NOTIONAL_USD:-7.5}"
CONFIDENCE="${CONFIDENCE:-0.8}"
MAX_SLIPPAGE_BPS="${MAX_SLIPPAGE_BPS:-10}"
PORTFOLIO_ID="${PORTFOLIO_ID:-ops}"
STRATEGY_ID="${STRATEGY_ID:-ops_micro_live_btc_first}"
REASON_CODE="${REASON_CODE:-micro_live_observation}"
INCLUDE_LENIENT="${INCLUDE_LENIENT:-1}"
RESET_RISK_GATEWAY_IF_NEEDED="${RESET_RISK_GATEWAY_IF_NEEDED:-0}"
INCLUDE_LIVE_ORDER_DRY_RUN="${INCLUDE_LIVE_ORDER_DRY_RUN:-1}"

usage() {
  cat <<'EOF'
Usage: bingx_tpsl_smoke.sh [options]

Runs TP/SL smoke checks for the BingX live path:
1. broker preflight baseline to derive a live reference price
2. broker preflight with valid TP/SL
3. broker preflight with invalid TP/SL
4. control-plane preview submit with valid TP/SL
5. optional control-plane preview submit with invalid TP and require_full_acceptance=false
6. optional broker/router live-order dry-run with compact requested/accepted protection dump

Options:
  --control-plane-url URL           Control-plane base URL (default: http://127.0.0.1:8000)
  --username NAME                   Login username (default: operator)
  --password VALUE                  Login password (default: resolved from env/secrets)
  --account-id VALUE                BingX account id (default: BINGX_ACCOUNT_ID_REQUIRED)
  --symbol VALUE                    Symbol to test (default: BTCUSDT)
  --side VALUE                      buy or sell (default: buy)
  --notional-usd VALUE              Requested notional (default: 7.5)
  --confidence VALUE                Intent confidence (default: 0.8)
  --max-slippage-bps VALUE          Max slippage bps (default: 10)
  --portfolio-id VALUE              Portfolio id (default: ops)
  --strategy-id VALUE               Strategy id (default: ops_micro_live_btc_first)
  --reason-code VALUE               Reason code (default: micro_live_observation)
  --skip-lenient                    Skip the require_full_acceptance=false preview submit
  --reset-risk-gateway-if-needed    Restart risk-gateway if remaining daily budget is below requested notional
  --skip-live-order-dry-run         Skip internal live-order dry-run checks
  -h, --help                        Show help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --control-plane-url) CONTROL_PLANE_URL="$2"; shift 2 ;;
    --username) USERNAME="$2"; shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    --account-id) ACCOUNT_ID="$2"; shift 2 ;;
    --symbol) SYMBOL="$2"; shift 2 ;;
    --side) SIDE="$2"; shift 2 ;;
    --notional-usd) NOTIONAL_USD="$2"; shift 2 ;;
    --confidence) CONFIDENCE="$2"; shift 2 ;;
    --max-slippage-bps) MAX_SLIPPAGE_BPS="$2"; shift 2 ;;
    --portfolio-id) PORTFOLIO_ID="$2"; shift 2 ;;
    --strategy-id) STRATEGY_ID="$2"; shift 2 ;;
    --reason-code) REASON_CODE="$2"; shift 2 ;;
    --skip-lenient) INCLUDE_LENIENT="0"; shift 1 ;;
    --reset-risk-gateway-if-needed) RESET_RISK_GATEWAY_IF_NEEDED="1"; shift 1 ;;
    --skip-live-order-dry-run) INCLUDE_LIVE_ORDER_DRY_RUN="0"; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

if [ -z "$CONTROL_PLANE_URL" ]; then
  CONTROL_PLANE_URL="http://127.0.0.1:8000"
fi

if [ "$SIDE" != "buy" ] && [ "$SIDE" != "sell" ]; then
  echo "invalid_side: expected buy or sell" >&2
  exit 3
fi

if [ -z "$PASSWORD" ]; then
  PASSWORD="$(txt_resolve_user_password "$USERNAME" "$PASSWORD" || true)"
fi

if [ -z "$PASSWORD" ]; then
  echo "auth_error: password missing for user '$USERNAME'" >&2
  exit 4
fi

python3 - <<'PY' "$CONTROL_PLANE_URL" "$USERNAME" "$PASSWORD" "$ACCOUNT_ID" "$SYMBOL" "$SIDE" "$NOTIONAL_USD" "$CONFIDENCE" "$MAX_SLIPPAGE_BPS" "$PORTFOLIO_ID" "$STRATEGY_ID" "$REASON_CODE" "$INCLUDE_LENIENT" "$RESET_RISK_GATEWAY_IF_NEEDED" "$INCLUDE_LIVE_ORDER_DRY_RUN"
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request


CONTROL_PLANE_URL = sys.argv[1]
USERNAME = sys.argv[2]
PASSWORD = sys.argv[3]
ACCOUNT_ID = sys.argv[4]
SYMBOL = sys.argv[5]
SIDE = sys.argv[6]
NOTIONAL = float(sys.argv[7])
CONFIDENCE = float(sys.argv[8])
MAX_SLIPPAGE_BPS = int(float(sys.argv[9]))
PORTFOLIO_ID = sys.argv[10]
STRATEGY_ID = sys.argv[11]
REASON_CODE = sys.argv[12]
INCLUDE_LENIENT = sys.argv[13] == "1"
RESET_RISK_GATEWAY_IF_NEEDED = sys.argv[14] == "1"
INCLUDE_LIVE_ORDER_DRY_RUN = sys.argv[15] == "1"


def fail(message: str) -> None:
    raise SystemExit(message)


def ensure(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def print_json(label: str, payload: dict) -> None:
    print(f"{label} {json.dumps(payload, separators=(',', ':'))}")


def post_json(url: str, payload: dict, headers: dict | None = None, timeout: int = 40) -> tuple[int, dict]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={"content-type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.getcode(), json.load(response)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            body = json.loads(raw)
        except Exception:
            body = {"raw": raw}
        return exc.code, body


def docker_exec_python(container: str, code: str, *args: str) -> str:
    command = ["docker", "exec", container, "python", "-c", code, *args]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=120)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or f"docker exec failed: {completed.returncode}")
    return completed.stdout.strip()


def get_risk_budget() -> dict:
    code = (
        "import json, urllib.request; "
        "resp=urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=10); "
        "print(json.dumps(json.load(resp), separators=(',',':')))"
    )
    return json.loads(docker_exec_python("risk-gateway", code).splitlines()[-1])


def ensure_risk_budget(required_notional_usd: float) -> dict:
    budget = get_risk_budget()
    used = float(budget.get("daily_notional_used_usd") or 0.0)
    limit = 30.0
    try:
        policies_code = (
            "import json, urllib.request; "
            "resp=urllib.request.urlopen('http://127.0.0.1:8001/v1/policies', timeout=10); "
            "print(json.dumps(json.load(resp), separators=(',',':')))"
        )
        policy = json.loads(docker_exec_python("risk-gateway", policies_code).splitlines()[-1])
        limit = float(policy.get("daily_notional_limit_usd") or limit)
    except Exception:
        pass
    remaining = limit - used
    print_json("RISK_BUDGET", {"used_usd": used, "limit_usd": limit, "remaining_usd": remaining, "required_usd": required_notional_usd, "reset_requested": RESET_RISK_GATEWAY_IF_NEEDED})
    if remaining + 1e-9 >= required_notional_usd:
        return budget
    if not RESET_RISK_GATEWAY_IF_NEEDED:
        fail("risk_budget_exhausted: pass --reset-risk-gateway-if-needed to reset in-memory preview budget")
    subprocess.run(["docker", "compose", "restart", "risk-gateway"], check=True, timeout=120)
    for _ in range(30):
        try:
            budget = get_risk_budget()
            if str(budget.get("status") or "").strip().lower() == "ok":
                print_json("RISK_BUDGET_RESET", {"used_usd": float(budget.get("daily_notional_used_usd") or 0.0)})
                return budget
        except Exception:
            pass
        time.sleep(1)
    fail("risk_gateway_restart_failed")


def container_post_json(container: str, url: str, payload: dict, timeout: int = 40) -> tuple[int, dict]:
    code = r'''
import json, sys, urllib.request, urllib.error
url = sys.argv[1]
payload = json.loads(sys.argv[2])
request = urllib.request.Request(
    url,
    data=json.dumps(payload).encode('utf-8'),
    headers={'content-type': 'application/json'},
)
try:
    with urllib.request.urlopen(request, timeout=40) as response:
        print(json.dumps({'http_status': response.getcode(), 'body': json.load(response)}, separators=(',',':')))
except urllib.error.HTTPError as exc:
    raw = exc.read().decode('utf-8')
    try:
        body = json.loads(raw)
    except Exception:
        body = {'raw': raw}
    print(json.dumps({'http_status': exc.code, 'body': body}, separators=(',',':')))
'''
    result = json.loads(docker_exec_python(container, code, url, json.dumps(payload)).splitlines()[-1])
    return int(result.get("http_status") or 0), result.get("body") or {}


def broker_constraints(payload: dict) -> tuple[int, dict]:
    return container_post_json("broker-adapter", "http://127.0.0.1:8004/v1/live/execution-constraints", payload)


def broker_live_order(payload: dict) -> tuple[int, dict]:
    return container_post_json("broker-adapter", "http://127.0.0.1:8004/v1/live/orders", payload)


def router_live_order(payload: dict) -> tuple[int, dict]:
    return container_post_json("execution-router", "http://127.0.0.1:8002/v1/orders/routed", payload)


def compact_protection(payload: dict | object) -> dict:
    if not isinstance(payload, dict):
        return {}
    compact: dict[str, object] = {}
    for leg_name in ("take_profit", "stop_loss"):
        leg = payload.get(leg_name)
        if isinstance(leg, dict):
            compact[leg_name] = {
                "trigger_price": leg.get("trigger_price"),
                "limit_price": leg.get("limit_price"),
                "order_type": leg.get("order_type"),
                "working_type": leg.get("working_type"),
            }
    if "require_full_acceptance" in payload:
        compact["require_full_acceptance"] = bool(payload.get("require_full_acceptance"))
    return compact


def summarize_constraints(label: str, http_status: int, body: dict) -> None:
    protection = body.get("protection") if isinstance(body.get("protection"), dict) else {}
    print_json(label, {
        "http_status": http_status,
        "status": body.get("status"),
        "reference_price": body.get("reference_price"),
        "min_notional_usd": body.get("min_notional_usd"),
        "supports_requested_notional": body.get("supports_requested_notional"),
        "protection_mode": protection.get("mode"),
        "protection_status": protection.get("status"),
        "protection_reasons": protection.get("reasons"),
        "require_full_acceptance": protection.get("require_full_acceptance"),
        "requested": compact_protection(protection.get("requested")),
        "accepted": compact_protection(protection.get("accepted")),
    })


def build_intent(protection: dict, *, tag: str) -> dict:
    return {
        "auto_execute": False,
        "intent": {
            "intent_id": f"ops-tpsl-smoke-{tag}-{int(time.time() * 1000)}",
            "strategy_id": STRATEGY_ID,
            "portfolio_id": PORTFOLIO_ID,
            "venue": "bingx",
            "instrument": SYMBOL,
            "side": SIDE,
            "reason_code": REASON_CODE,
            "confidence": CONFIDENCE,
            "target_notional_usd": effective_notional,
            "max_slippage_bps": MAX_SLIPPAGE_BPS,
            "leverage": 1.0,
            "risk_tags": ["micro-live", "btc-first", "observation", "tpsl-smoke"],
            "protection": protection,
            "explainability": {
                "live_execution": {
                    "enabled": True,
                    "provider": "bingx",
                    "account_id": ACCOUNT_ID,
                    "order_type": "MARKET",
                    "position_side": "LONG" if SIDE == "buy" else "SHORT",
                }
            },
        },
    }


def summarize_submit(label: str, http_status: int, body: dict) -> None:
    risk = body.get("risk_decision") if isinstance(body.get("risk_decision"), dict) else {}
    constraints = body.get("live_execution_constraints") if isinstance(body.get("live_execution_constraints"), dict) else {}
    protection = constraints.get("protection") if isinstance(constraints.get("protection"), dict) else {}
    print_json(label, {
        "http_status": http_status,
        "submission_status": body.get("status"),
        "risk_decision": risk.get("decision"),
        "risk_reasons": risk.get("reasons"),
        "constraints_status": constraints.get("status"),
        "constraints_min_notional_usd": constraints.get("min_notional_usd"),
        "constraints_supports_requested_notional": constraints.get("supports_requested_notional"),
        "protection_status": protection.get("status"),
        "protection_reasons": protection.get("reasons"),
        "require_full_acceptance": protection.get("require_full_acceptance"),
        "requested": compact_protection(protection.get("requested")),
        "accepted": compact_protection(protection.get("accepted")),
    })


def summarize_live_order(label: str, http_status: int, body: dict) -> None:
    protection = body.get("protection") if isinstance(body.get("protection"), dict) else {}
    dry_run = body.get("dry_run") if isinstance(body.get("dry_run"), dict) else {}
    print_json(label, {
        "http_status": http_status,
        "order_status": body.get("status"),
        "protection_status": body.get("protection_status") or protection.get("status"),
        "protection_reasons": protection.get("reasons"),
        "requested": compact_protection(protection.get("requested")),
        "accepted": compact_protection(protection.get("accepted")),
        "accepted_legs": dry_run.get("accepted_legs"),
    })


def assert_constraints(label: str, http_status: int, body: dict, expected_status: str, expected_protection_status: str) -> None:
    protection = body.get("protection") if isinstance(body.get("protection"), dict) else {}
    ensure(http_status == 200, f"{label}_http_status_unexpected:{http_status}")
    ensure(str(body.get("status") or "") == expected_status, f"{label}_status_unexpected:{body.get('status')}")
    ensure(str(protection.get("status") or "") == expected_protection_status, f"{label}_protection_status_unexpected:{protection.get('status')}")


def assert_submit(label: str, http_status: int, body: dict, expected_protection_status: str) -> None:
    risk = body.get("risk_decision") if isinstance(body.get("risk_decision"), dict) else {}
    constraints = body.get("live_execution_constraints") if isinstance(body.get("live_execution_constraints"), dict) else {}
    protection = constraints.get("protection") if isinstance(constraints.get("protection"), dict) else {}
    ensure(http_status == 200, f"{label}_http_status_unexpected:{http_status}")
    ensure(str(risk.get("decision") or "") == "accept", f"{label}_risk_decision_unexpected:{risk.get('decision')}")
    ensure(str(constraints.get("status") or "") == "ready_preflight", f"{label}_constraints_status_unexpected:{constraints.get('status')}")
    ensure(str(protection.get("status") or "") == expected_protection_status, f"{label}_protection_status_unexpected:{protection.get('status')}")


def assert_live_order(label: str, http_status: int, body: dict, expected_protection_status: str, expected_accepted_legs: set[str]) -> None:
    protection = body.get("protection") if isinstance(body.get("protection"), dict) else {}
    accepted = protection.get("accepted") if isinstance(protection.get("accepted"), dict) else {}
    actual_accepted_legs = {leg_name for leg_name in ("take_profit", "stop_loss") if isinstance(accepted.get(leg_name), dict)}
    ensure(http_status == 200, f"{label}_http_status_unexpected:{http_status}")
    ensure(str(body.get("status") or "") == "dry_run", f"{label}_order_status_unexpected:{body.get('status')}")
    ensure(str(body.get("protection_status") or protection.get("status") or "") == expected_protection_status, f"{label}_protection_status_unexpected:{body.get('protection_status') or protection.get('status')}")
    ensure(actual_accepted_legs == expected_accepted_legs, f"{label}_accepted_legs_unexpected:{sorted(actual_accepted_legs)}")


ensure_risk_budget(NOTIONAL)
login_status, login_body = post_json(f"{CONTROL_PLANE_URL}/v1/auth/login", {"username": USERNAME, "password": PASSWORD}, timeout=20)
print_json("LOGIN", {"http_status": login_status, "has_token": bool(login_body.get("access_token")), "role": login_body.get("role")})
ensure(login_status == 200 and bool(login_body.get("access_token")), "login_failed")
token = login_body["access_token"]

baseline_status, baseline_body = broker_constraints({
    "provider": "bingx",
    "symbol": SYMBOL,
    "side": SIDE,
    "requested_notional_usd": NOTIONAL,
})
summarize_constraints("BROKER_BASELINE", baseline_status, baseline_body)
ensure(baseline_status == 200, f"broker_baseline_http_status_unexpected:{baseline_status}")
reference_price = float(baseline_body.get("reference_price") or 0.0)
ensure(reference_price > 0, "reference_price_unavailable")
min_notional_usd = float(baseline_body.get("min_notional_usd") or 0.0)

effective_notional = NOTIONAL
if min_notional_usd > 0 and effective_notional <= min_notional_usd + 0.05:
    effective_notional = round(min_notional_usd + 0.25, 4)
    print_json("NOTIONAL_ADJUSTED", {
        "requested_notional_usd": NOTIONAL,
        "effective_notional_usd": effective_notional,
        "min_notional_usd": min_notional_usd,
    })
    ensure_risk_budget(effective_notional)

strict_tp = round(reference_price * (1.01 if SIDE == "buy" else 0.99), 4)
strict_sl = round(reference_price * (0.99 if SIDE == "buy" else 1.01), 4)
invalid_tp = round(reference_price * (0.99 if SIDE == "buy" else 1.01), 4)

valid_protection = {
    "take_profit": {"trigger_price": strict_tp, "order_type": "market", "working_type": "MARK_PRICE"},
    "stop_loss": {"trigger_price": strict_sl, "order_type": "market", "working_type": "MARK_PRICE"},
    "require_full_acceptance": True,
}
invalid_strict_protection = {
    "take_profit": {"trigger_price": invalid_tp, "order_type": "market", "working_type": "MARK_PRICE"},
    "stop_loss": {"trigger_price": strict_sl, "order_type": "market", "working_type": "MARK_PRICE"},
    "require_full_acceptance": True,
}
invalid_lenient_protection = {
    "take_profit": {"trigger_price": invalid_tp, "order_type": "market", "working_type": "MARK_PRICE"},
    "stop_loss": {"trigger_price": strict_sl, "order_type": "market", "working_type": "MARK_PRICE"},
    "require_full_acceptance": False,
}

valid_status, valid_body = broker_constraints({
    "provider": "bingx",
    "symbol": SYMBOL,
    "side": SIDE,
    "requested_notional_usd": effective_notional,
    "protection": valid_protection,
})
summarize_constraints("BROKER_VALID", valid_status, valid_body)
assert_constraints("broker_valid", valid_status, valid_body, "ready_preflight", "ready_preflight")

invalid_status, invalid_body = broker_constraints({
    "provider": "bingx",
    "symbol": SYMBOL,
    "side": SIDE,
    "requested_notional_usd": effective_notional,
    "protection": invalid_strict_protection,
})
summarize_constraints("BROKER_INVALID", invalid_status, invalid_body)
assert_constraints("broker_invalid", invalid_status, invalid_body, "rejected_preflight", "rejected_preflight")

ensure_risk_budget(effective_notional)
submit_status, submit_body = post_json(
    f"{CONTROL_PLANE_URL}/v1/intents/submit",
    build_intent(valid_protection, tag="strict"),
    headers={"Authorization": f"Bearer {token}"},
    timeout=50,
)
summarize_submit("CONTROL_PLANE_STRICT", submit_status, submit_body)
assert_submit("control_plane_strict", submit_status, submit_body, "ready_preflight")

if INCLUDE_LENIENT:
    ensure_risk_budget(effective_notional)
    lenient_status, lenient_body = post_json(
        f"{CONTROL_PLANE_URL}/v1/intents/submit",
        build_intent(invalid_lenient_protection, tag="lenient"),
        headers={"Authorization": f"Bearer {token}"},
        timeout=50,
    )
    summarize_submit("CONTROL_PLANE_LENIENT", lenient_status, lenient_body)
    assert_submit("control_plane_lenient", lenient_status, lenient_body, "rejected_preflight")

if INCLUDE_LIVE_ORDER_DRY_RUN:
    broker_dry_run_full_status, broker_dry_run_full_body = broker_live_order({
        "provider": "bingx",
        "account_id": ACCOUNT_ID,
        "symbol": SYMBOL,
        "side": SIDE,
        "notional_usd": effective_notional,
        "order_type": "MARKET",
        "position_side": "LONG" if SIDE == "buy" else "SHORT",
        "dry_run": True,
        "protection": valid_protection,
    })
    summarize_live_order("BROKER_LIVE_DRY_RUN_FULL", broker_dry_run_full_status, broker_dry_run_full_body)
    assert_live_order("broker_live_dry_run_full", broker_dry_run_full_status, broker_dry_run_full_body, "armed", {"take_profit", "stop_loss"})

    broker_dry_run_partial_status, broker_dry_run_partial_body = broker_live_order({
        "provider": "bingx",
        "account_id": ACCOUNT_ID,
        "symbol": SYMBOL,
        "side": SIDE,
        "notional_usd": effective_notional,
        "order_type": "MARKET",
        "position_side": "LONG" if SIDE == "buy" else "SHORT",
        "dry_run": True,
        "dry_run_accepted_legs": ["stop_loss"],
        "protection": valid_protection,
    })
    summarize_live_order("BROKER_LIVE_DRY_RUN_PARTIAL", broker_dry_run_partial_status, broker_dry_run_partial_body)
    assert_live_order("broker_live_dry_run_partial", broker_dry_run_partial_status, broker_dry_run_partial_body, "protection_partial", {"stop_loss"})

    router_dry_run_partial_status, router_dry_run_partial_body = router_live_order({
        "decision_id": f"route-dry-run-{int(time.time() * 1000)}",
        "symbol": SYMBOL,
        "side": SIDE,
        "estimated_notional_usd": effective_notional,
        "execution_mode": "live-intent-dry-run",
        "live_execution": {
            "enabled": True,
            "provider": "bingx",
            "account_id": ACCOUNT_ID,
            "secret_payload": {"dry_run": True},
            "order_type": "MARKET",
            "position_side": "LONG" if SIDE == "buy" else "SHORT",
            "dry_run": True,
            "dry_run_accepted_legs": ["stop_loss"],
            "protection": valid_protection,
        },
        "metadata": {
            "provider": "bingx",
            "account_id": ACCOUNT_ID,
        },
    })
    summarize_live_order("ROUTER_LIVE_DRY_RUN_PARTIAL", router_dry_run_partial_status, router_dry_run_partial_body)
    assert_live_order("router_live_dry_run_partial", router_dry_run_partial_status, router_dry_run_partial_body, "protection_partial", {"stop_loss"})
PY