#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/control_plane_helpers.sh
. "$SCRIPT_DIR/lib/control_plane_helpers.sh"

txt_source_repo_env

CONTROL_PLANE_URL="http://127.0.0.1:8000"
USERNAME="${USERNAME:-operator}"
PASSWORD="${PASSWORD:-}"
ACCOUNT_ID="${ACCOUNT_ID:-}"
SYMBOL="${SYMBOL:-BTCUSDT}"
SIDE="${SIDE:-buy}"
NOTIONAL_USD="${NOTIONAL_USD:-7.5}"
CONFIDENCE="${CONFIDENCE:-0.8}"
MAX_SLIPPAGE_BPS="${MAX_SLIPPAGE_BPS:-10}"
PORTFOLIO_ID="${PORTFOLIO_ID:-ops}"
STRATEGY_ID="${STRATEGY_ID:-ops_micro_live_btc_first}"
REASON_CODE="${REASON_CODE:-micro_live_observation}"
AUTO_EXECUTE="${AUTO_EXECUTE:-0}"
CONFIRM_LIVE="${CONFIRM_LIVE:-}"
PRINT_RAW="${PRINT_RAW:-0}"
CURL_INSECURE="${CURL_INSECURE:-0}"

usage() {
  cat <<'EOF'
Usage: bingx_micro_live_intent.sh [options]

Defaults to a non-destructive intent preview (`auto_execute=false`).
Use `--auto-execute` plus `--confirm-live MICRO_LIVE_EXECUTE` to allow live submission.

Options:
  --control-plane-url URL    Control-plane base URL (default: http://127.0.0.1:8000)
  --username NAME            Login username (default: operator)
  --password VALUE           Login password (default: resolved from .env/secrets)
  --account-id VALUE         Linked BingX account id (required)
  --symbol VALUE             Symbol to use (default: BTCUSDT)
  --side VALUE               buy or sell (default: buy)
  --notional-usd VALUE       Requested notional in USD (default: 7.5)
  --confidence VALUE         Intent confidence (default: 0.8)
  --max-slippage-bps VALUE   Max slippage in bps (default: 10)
  --portfolio-id VALUE       Portfolio id (default: ops)
  --strategy-id VALUE        Strategy id (default: ops_micro_live_btc_first)
  --reason-code VALUE        Reason code (default: micro_live_observation)
  --auto-execute             Allow control-plane live execution path
  --confirm-live VALUE       Must equal MICRO_LIVE_EXECUTE when --auto-execute is used
  --print-raw                Print raw JSON response
  --insecure                 Pass -k to curl
  -h, --help                 Show help
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
    --auto-execute) AUTO_EXECUTE="1"; shift 1 ;;
    --confirm-live) CONFIRM_LIVE="$2"; shift 2 ;;
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

if [ "$AUTO_EXECUTE" = "1" ] && [ "$CONFIRM_LIVE" != "MICRO_LIVE_EXECUTE" ]; then
  echo "confirmation_missing: pass --confirm-live MICRO_LIVE_EXECUTE when using --auto-execute" >&2
  exit 4
fi

if [ -z "$PASSWORD" ]; then
  echo "auth_error: password missing for user '$USERNAME'" >&2
  exit 5
fi

if [ "$SIDE" != "buy" ] && [ "$SIDE" != "sell" ]; then
  echo "invalid_side: expected buy or sell" >&2
  exit 6
fi

txt_init_curl_tls_flag "$CURL_INSECURE"

LOGIN_PAYLOAD="$(TXT_LOGIN_USERNAME="$USERNAME" TXT_LOGIN_PASSWORD="$PASSWORD" python3 - <<'PY'
import json
import os

print(json.dumps({
    "username": os.environ["TXT_LOGIN_USERNAME"],
    "password": os.environ["TXT_LOGIN_PASSWORD"],
}))
PY
)"

LOGIN_BODY_FILE="$(mktemp)"
LOGIN_STATUS="$(curl "${CURL_TLS_FLAG[@]}" --max-time 20 -sS -o "$LOGIN_BODY_FILE" -w '%{http_code}' \
  -H 'content-type: application/json' \
  -X POST "$CONTROL_PLANE_URL/v1/auth/login" \
  --data "$LOGIN_PAYLOAD")"

if [ "$LOGIN_STATUS" != "200" ]; then
  echo "login_failed: status=$LOGIN_STATUS" >&2
  sed -n '1,40p' "$LOGIN_BODY_FILE" >&2
  exit 7
fi

TOKEN="$(python3 - <<'PY' "$LOGIN_BODY_FILE"
import json
import sys

with open(sys.argv[1], 'r', encoding='utf-8') as fh:
    body = json.load(fh)

print(body.get('access_token', ''))
PY
)"

if [ -z "$TOKEN" ]; then
  echo "login_failed: no access token returned" >&2
  exit 8
fi

REQUEST_BODY="$(AUTO_EXECUTE_VALUE="$AUTO_EXECUTE" \
ACCOUNT_ID_VALUE="$ACCOUNT_ID" \
SYMBOL_VALUE="$SYMBOL" \
SIDE_VALUE="$SIDE" \
NOTIONAL_VALUE="$NOTIONAL_USD" \
CONFIDENCE_VALUE="$CONFIDENCE" \
MAX_SLIPPAGE_VALUE="$MAX_SLIPPAGE_BPS" \
PORTFOLIO_ID_VALUE="$PORTFOLIO_ID" \
STRATEGY_ID_VALUE="$STRATEGY_ID" \
REASON_CODE_VALUE="$REASON_CODE" \
python3 - <<'PY'
import json
import os
import time

auto_execute = os.environ["AUTO_EXECUTE_VALUE"] == "1"
intent_id = f"ops-micro-live-{int(time.time())}"
body = {
    "auto_execute": auto_execute,
    "intent": {
        "intent_id": intent_id,
        "strategy_id": os.environ["STRATEGY_ID_VALUE"],
        "portfolio_id": os.environ["PORTFOLIO_ID_VALUE"],
        "venue": "bingx",
        "instrument": os.environ["SYMBOL_VALUE"],
        "side": os.environ["SIDE_VALUE"],
        "reason_code": os.environ["REASON_CODE_VALUE"],
        "confidence": float(os.environ["CONFIDENCE_VALUE"]),
        "target_notional_usd": float(os.environ["NOTIONAL_VALUE"]),
        "max_slippage_bps": int(float(os.environ["MAX_SLIPPAGE_VALUE"])),
        "leverage": 1.0,
        "risk_tags": ["micro-live", "btc-first", "observation"],
        "explainability": {
            "live_execution": {
                "enabled": True,
                "provider": "bingx",
                "account_id": os.environ["ACCOUNT_ID_VALUE"],
                "order_type": "MARKET",
                "position_side": "LONG" if os.environ["SIDE_VALUE"].strip().lower() == "buy" else "SHORT",
            }
        },
    },
}
print(json.dumps(body))
PY
)"

RESPONSE_BODY_FILE="$(mktemp)"
RESPONSE_STATUS="$(curl "${CURL_TLS_FLAG[@]}" --max-time 40 -sS -o "$RESPONSE_BODY_FILE" -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -X POST "$CONTROL_PLANE_URL/v1/intents/submit" \
  --data "$REQUEST_BODY")"

if [ "$PRINT_RAW" = "1" ]; then
  cat "$RESPONSE_BODY_FILE"
  exit 0
fi

python3 - <<'PY' "$RESPONSE_BODY_FILE" "$RESPONSE_STATUS" "$AUTO_EXECUTE"
import json
import sys

path = sys.argv[1]
status_code = sys.argv[2]
auto_execute = sys.argv[3] == "1"

with open(path, 'r', encoding='utf-8') as fh:
    body = json.load(fh)

constraints = body.get("live_execution_constraints") if isinstance(body.get("live_execution_constraints"), dict) else {}
risk = body.get("risk_decision") if isinstance(body.get("risk_decision"), dict) else {}
order = body.get("order") if isinstance(body.get("order"), dict) else {}

print(f"http_status={status_code}")
print(f"auto_execute={'true' if auto_execute else 'false'}")
print(f"intent_id={body.get('intent_id', '-')}")
print(f"status={body.get('status', '-')}")
print(f"system_mode={body.get('system_mode', '-')}")
print(f"risk_decision={risk.get('decision', '-')}")
print("risk_reasons=" + json.dumps(risk.get("reasons") or [], separators=(",", ":")))
print(f"order_status={order.get('status', '-')}")
print(f"order_execution_mode={order.get('execution_mode', '-')}")
print(f"constraints_status={constraints.get('status', '-')}")
print(f"constraints_requested_notional={constraints.get('requested_notional_usd', '-')}")
print(f"constraints_effective_notional={constraints.get('effective_notional_usd', '-')}")
print(f"constraints_min_notional={constraints.get('min_notional_usd', '-')}")
print(f"constraints_supports_requested={constraints.get('supports_requested_notional', '-')}")
PY