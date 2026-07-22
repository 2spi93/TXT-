#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/control_plane_helpers.sh
. "$SCRIPT_DIR/lib/control_plane_helpers.sh"

EXPLICIT_CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-}"
txt_source_repo_env

CONTROL_PLANE_URL="$(txt_resolve_control_plane_url "$EXPLICIT_CONTROL_PLANE_URL")"
USERNAME="${USERNAME:-operator}"
PASSWORD="${PASSWORD:-}"
ACCOUNT_ID="${ACCOUNT_ID:-}"
SYMBOL="${SYMBOL:-BTCUSDT}"
SIDE="${SIDE:-buy}"
NOTIONAL_USD="${NOTIONAL_USD:-2.5}"
CONFIDENCE="${CONFIDENCE:-0.96}"
MAX_SLIPPAGE_BPS="${MAX_SLIPPAGE_BPS:-10}"
PORTFOLIO_ID="${PORTFOLIO_ID:-smoke}"
STRATEGY_ID="${STRATEGY_ID:-}"
REASON_CODE="${REASON_CODE:-}"
DRY_RUN="${DRY_RUN:-1}"
ACCEPTED_LEGS="${ACCEPTED_LEGS:-take_profit,stop_loss}"
AUTO_EXECUTE="${AUTO_EXECUTE:-1}"
RESET_RISK_GATEWAY_IF_NEEDED="${RESET_RISK_GATEWAY_IF_NEEDED:-0}"
PRINT_RAW="${PRINT_RAW:-0}"
CURL_INSECURE="${CURL_INSECURE:-0}"

usage() {
  cat <<'EOF'
Usage: control_plane_live_intent_smoke.sh [options]

Options:
  --control-plane-url URL    Control-plane base URL (default: http://127.0.0.1:8000)
  --username NAME            Login username (default: operator)
  --password VALUE           Login password (default: resolved from .env/secrets)
  --account-id VALUE         Linked BingX account id (required)
  --symbol VALUE             Symbol to use (default: BTCUSDT)
  --side VALUE               buy or sell (default: buy)
  --notional-usd VALUE       Requested notional in USD before auto-size (default: 2.5)
  --confidence VALUE         Intent confidence (default: 0.96)
  --max-slippage-bps VALUE   Max slippage bps sent to risk/control-plane (default: 10)
  --portfolio-id VALUE       Portfolio id carried by the smoke intent (default: smoke)
  --strategy-id VALUE        Strategy id override; defaults to a unique per-run smoke id
  --reason-code VALUE        Reason code override; defaults to a unique per-run smoke code
  --dry-run 0|1              Route as live dry_run to avoid a real order (default: 1)
  --accepted-legs CSV        Dry-run accepted legs (default: take_profit,stop_loss)
  --auto-execute 0|1         Submit with auto_execute (default: 1)
  --reset-risk-gateway-if-needed
                              Restart risk-gateway if remaining daily budget is below effective notional
  --print-raw                Print raw JSON response
  --insecure                 Pass -k to curl
  -h, --help                 Show help

Environment fallbacks:
  CONTROL_PLANE_URL, USERNAME, PASSWORD, ACCOUNT_ID, SYMBOL, SIDE, NOTIONAL_USD,
  CONFIDENCE, MAX_SLIPPAGE_BPS, PORTFOLIO_ID, STRATEGY_ID, REASON_CODE,
  DRY_RUN, ACCEPTED_LEGS, AUTO_EXECUTE,
  RESET_RISK_GATEWAY_IF_NEEDED, PRINT_RAW, CURL_INSECURE

Notes:
  - Safe by default: the intent is routed as live dry_run unless --dry-run 0 is passed.
  - Verifies that control-plane propagates live_execution_constraints.effective_notional_usd
    into the approved routed order requested_notional_usd.
  - Also checks that dynamically generated TP/SL legs are present on the routed order.
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
    --dry-run) DRY_RUN="$2"; shift 2 ;;
    --accepted-legs) ACCEPTED_LEGS="$2"; shift 2 ;;
    --auto-execute) AUTO_EXECUTE="$2"; shift 2 ;;
    --reset-risk-gateway-if-needed) RESET_RISK_GATEWAY_IF_NEEDED="1"; shift 1 ;;
    --print-raw) PRINT_RAW="1"; shift 1 ;;
    --insecure) CURL_INSECURE="1"; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

if [ -z "$PASSWORD" ]; then
  PASSWORD="$(txt_resolve_user_password "$USERNAME" "$PASSWORD" || true)"
fi

if [ -z "$ACCOUNT_ID" ]; then
  echo "account_id_missing: pass --account-id or set ACCOUNT_ID" >&2
  exit 3
fi

if [ -z "$PASSWORD" ]; then
  echo "auth_error: password missing for user '$USERNAME'" >&2
  exit 4
fi

if [ "$SIDE" != "buy" ] && [ "$SIDE" != "sell" ]; then
  echo "invalid_side: expected buy or sell" >&2
  exit 5
fi

python3 - <<'PY' "$SYMBOL" "$SIDE" "$NOTIONAL_USD" "$RESET_RISK_GATEWAY_IF_NEEDED"
import json
import subprocess
import sys
import time


symbol = sys.argv[1]
side = sys.argv[2]
requested_notional = float(sys.argv[3])
reset_requested = sys.argv[4] == "1"


def docker_exec_python(container: str, code: str) -> str:
  completed = subprocess.run(
    ["docker", "exec", "-i", container, "python", "-c", code],
    capture_output=True,
    text=True,
    timeout=120,
  )
  if completed.returncode != 0:
    raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or f"docker exec failed: {completed.returncode}")
  return completed.stdout.strip()


constraints_code = (
  "import json, urllib.request; "
  f"payload={{'provider':'bingx','symbol':{symbol!r},'side':{side!r},'requested_notional_usd':{requested_notional!r},'auto_adjust_notional':True}}; "
  "request=urllib.request.Request('http://127.0.0.1:8004/v1/live/execution-constraints', data=json.dumps(payload).encode('utf-8'), headers={'content-type':'application/json'}); "
  "resp=urllib.request.urlopen(request, timeout=40); print(json.dumps(json.load(resp), separators=(',',':')))"
)
constraints = json.loads(docker_exec_python("broker-adapter", constraints_code).splitlines()[-1])
required = float(constraints.get("effective_notional_usd") or requested_notional)

health_code = (
  "import json, urllib.request; "
  "resp=urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=10); print(json.dumps(json.load(resp), separators=(',',':')))"
)
budget = json.loads(docker_exec_python("risk-gateway", health_code).splitlines()[-1])
used = float(budget.get("daily_notional_used_usd") or 0.0)
limit = 30.0
try:
  policy_code = (
    "import json, urllib.request; "
    "resp=urllib.request.urlopen('http://127.0.0.1:8001/v1/policies', timeout=10); print(json.dumps(json.load(resp), separators=(',',':')))"
  )
  policies = json.loads(docker_exec_python("risk-gateway", policy_code).splitlines()[-1])
  limit = float(policies.get("daily_notional_limit_usd") or limit)
except Exception:
  pass

remaining = limit - used
print(json.dumps({
  "label": "RISK_BUDGET",
  "used_usd": used,
  "limit_usd": limit,
  "remaining_usd": remaining,
  "required_usd": required,
  "reset_requested": reset_requested,
}, separators=(",", ":")))

if remaining + 1e-9 >= required:
  raise SystemExit(0)
if not reset_requested:
  raise SystemExit("risk_budget_exhausted: pass --reset-risk-gateway-if-needed to reset in-memory preview budget")

subprocess.run(["docker", "compose", "restart", "risk-gateway"], check=True, timeout=120)
for _ in range(30):
  try:
    budget = json.loads(docker_exec_python("risk-gateway", health_code).splitlines()[-1])
    if str(budget.get("status") or "").strip().lower() == "ok":
      print(json.dumps({
        "label": "RISK_BUDGET_RESET",
        "used_usd": float(budget.get("daily_notional_used_usd") or 0.0),
      }, separators=(",", ":")))
      raise SystemExit(0)
  except Exception:
    pass
  time.sleep(1)
raise SystemExit("risk_gateway_restart_failed")
PY

TOKEN="$(txt_control_plane_login_token "$CONTROL_PLANE_URL" "$USERNAME" "$PASSWORD" "$CURL_INSECURE" || true)"
if [ -z "$TOKEN" ]; then
  echo "login_failed: no access token returned" >&2
  exit 6
fi

REQUEST_BODY="$(TXT_ACCOUNT_ID="$ACCOUNT_ID" TXT_SYMBOL="$SYMBOL" TXT_SIDE="$SIDE" TXT_NOTIONAL_USD="$NOTIONAL_USD" TXT_CONFIDENCE="$CONFIDENCE" TXT_MAX_SLIPPAGE_BPS="$MAX_SLIPPAGE_BPS" TXT_PORTFOLIO_ID="$PORTFOLIO_ID" TXT_STRATEGY_ID="$STRATEGY_ID" TXT_REASON_CODE="$REASON_CODE" TXT_DRY_RUN="$DRY_RUN" TXT_ACCEPTED_LEGS="$ACCEPTED_LEGS" TXT_AUTO_EXECUTE="$AUTO_EXECUTE" python3 - <<'PY'
import json
import os
import uuid

run_suffix = uuid.uuid4().hex[:8]
accepted_legs = [item.strip() for item in os.environ["TXT_ACCEPTED_LEGS"].split(",") if item.strip()]
body = {
    "intent": {
        "intent_id": f"smoke-live-auto-size-{uuid.uuid4()}",
    "strategy_id": os.environ.get("TXT_STRATEGY_ID") or f"smoke-live-auto-size-{run_suffix}",
    "portfolio_id": os.environ.get("TXT_PORTFOLIO_ID") or "smoke",
        "venue": "bingx",
        "instrument": os.environ["TXT_SYMBOL"],
        "side": os.environ["TXT_SIDE"],
    "reason_code": os.environ.get("TXT_REASON_CODE") or f"smoke_live_auto_size_{run_suffix}",
        "confidence": float(os.environ["TXT_CONFIDENCE"]),
        "target_notional_usd": float(os.environ["TXT_NOTIONAL_USD"]),
        "max_slippage_bps": int(float(os.environ["TXT_MAX_SLIPPAGE_BPS"])),
        "leverage": 1.0,
        "risk_tags": ["smoke", "live_auto_size", "dynamic_protection"],
        "explainability": {
            "regime": "TREND",
            "live_execution": {
                "enabled": True,
                "provider": "bingx",
                "account_id": os.environ["TXT_ACCOUNT_ID"],
                "auto_size": True,
                "auto_protection": True,
                "dry_run": os.environ["TXT_DRY_RUN"] == "1",
                "dry_run_accepted_legs": accepted_legs,
            },
        },
    },
    "auto_execute": os.environ["TXT_AUTO_EXECUTE"] == "1",
}
print(json.dumps(body))
PY
)"

txt_init_curl_tls_flag "$CURL_INSECURE"
RESPONSE_BODY="$(curl "${CURL_TLS_FLAG[@]}" --max-time 45 -sS \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -X POST "$CONTROL_PLANE_URL/v1/intents/submit" \
  --data "$REQUEST_BODY")"

PENDING_APPROVAL_JSON="$(RESPONSE_BODY_JSON="$RESPONSE_BODY" python3 - <<'PY'
import json
import os

try:
    body = json.loads(os.environ["RESPONSE_BODY_JSON"])
except Exception:
    print('{"should_approve": false}')
    raise SystemExit(0)

status = str(body.get("status") or "")
intent_id = str(body.get("intent_id") or "")
should_approve = status in {"accepted_waiting_opportunity_gate", "accepted_waiting_human_or_higher_mode"} and bool(intent_id)
print(json.dumps({"should_approve": should_approve, "intent_id": intent_id}))
PY
)"

if APPROVAL_URL="$(PENDING_APPROVAL_JSON="$PENDING_APPROVAL_JSON" CONTROL_PLANE_URL="$CONTROL_PLANE_URL" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["PENDING_APPROVAL_JSON"])
if payload.get("should_approve") and payload.get("intent_id"):
    print(f"{os.environ['CONTROL_PLANE_URL']}/v1/intents/{payload['intent_id']}/approve/server-signed")
PY
)" && [ -n "$APPROVAL_URL" ]; then
  RESPONSE_BODY="$(curl "${CURL_TLS_FLAG[@]}" --max-time 45 -sS \
    -H "Authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' \
    -X POST "$APPROVAL_URL")"
fi

if [ "$PRINT_RAW" = "1" ]; then
  printf '%s\n' "$RESPONSE_BODY"
  exit 0
fi

RESPONSE_BODY_JSON="$RESPONSE_BODY" ORIGINAL_REQUESTED_NOTIONAL_USD="$NOTIONAL_USD" python3 - <<'PY'
import json
import math
import os
import sys

envelope = json.loads(os.environ["RESPONSE_BODY_JSON"])
body = envelope.get("detail") if isinstance(envelope, dict) and isinstance(envelope.get("detail"), dict) and not isinstance(envelope.get("risk_decision"), dict) else envelope
status = str(body.get("status") or "")
risk = body.get("risk_decision") if isinstance(body.get("risk_decision"), dict) else {}
constraints = body.get("live_execution_constraints") if isinstance(body.get("live_execution_constraints"), dict) else {}
order = body.get("order") if isinstance(body.get("order"), dict) else {}
protection = order.get("protection") if isinstance(order.get("protection"), dict) else {}
requested_constraints = float(constraints.get("requested_notional_usd") or 0.0)
effective_constraints = float(constraints.get("effective_notional_usd") or 0.0)
order_requested = float(order.get("requested_notional_usd") or 0.0)
original_requested = float(os.environ.get("ORIGINAL_REQUESTED_NOTIONAL_USD") or 0.0)

errors = []
if risk.get("decision") != "accept":
    errors.append(f"risk_decision={risk.get('decision')}")
if status not in {"executed_in_live_mode", "approved_and_executed"}:
    errors.append(f"status={status}")
if not constraints:
    errors.append("missing_live_execution_constraints")
if effective_constraints <= original_requested:
  errors.append(f"effective_notional_not_promoted={effective_constraints}")
if not math.isclose(order_requested, effective_constraints, rel_tol=0.0, abs_tol=1e-6):
    errors.append(f"order_requested_notional_mismatch={order_requested}!= {effective_constraints}")
if str(order.get("status") or "").lower() != "dry_run":
    errors.append(f"order_status={order.get('status')}")
requested_protection = protection.get("requested") if isinstance(protection.get("requested"), dict) else {}
if not isinstance(requested_protection.get("take_profit"), dict) or not isinstance(requested_protection.get("stop_loss"), dict):
    errors.append("dynamic_protection_missing")

if errors:
    print(json.dumps(body, indent=2, sort_keys=True))
    raise SystemExit("smoke_failed: " + ", ".join(errors))

print(f"status={status}")
print(f"risk_decision={risk.get('decision')}")
print(f"original_requested_notional_usd={original_requested}")
print(f"requested_notional_usd={requested_constraints}")
print(f"effective_notional_usd={effective_constraints}")
print(f"order_requested_notional_usd={order_requested}")
print(f"order_status={order.get('status')}")
print(f"protection_status={order.get('protection_status')}")
print(f"take_profit_trigger={requested_protection.get('take_profit', {}).get('trigger_price')}")
print(f"stop_loss_trigger={requested_protection.get('stop_loss', {}).get('trigger_price')}")
PY