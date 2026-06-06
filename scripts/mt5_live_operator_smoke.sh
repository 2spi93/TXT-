#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/control_plane_helpers.sh
. "$SCRIPT_DIR/lib/control_plane_helpers.sh"

txt_source_repo_env

CONTROL_PLANE_URL="$(txt_resolve_control_plane_url "${CONTROL_PLANE_URL:-}")"
USERNAME="${USERNAME:-operator}"
PASSWORD="${PASSWORD:-}"
ACCOUNT_ID="${ACCOUNT_ID:-541283177}"
SYMBOL="${SYMBOL:-AUTO}"
SIDE="${SIDE:-buy}"
LOTS="${LOTS:-0.01}"
NOTIONAL_USD="${NOTIONAL_USD:-5}"
MAX_SPREAD_BPS="${MAX_SPREAD_BPS:-10}"
CONFIDENCE="${CONFIDENCE:-0.8}"
PREFERRED_VENUE="${PREFERRED_VENUE:-mt5}"
RATIONALE="${RATIONALE:-operator mt5 live smoke}"
CONFIRM_LIVE="${CONFIRM_LIVE:-}"
APPROVAL_ID="${APPROVAL_ID:-}"
PRINT_RAW="${PRINT_RAW:-0}"
CURL_INSECURE="${CURL_INSECURE:-0}"

usage() {
  cat <<'EOF'
Usage: mt5_live_operator_smoke.sh [options]

Options:
  --control-plane-url URL    Control-plane base URL (default: resolved from env)
  --username NAME            Login username (default: operator)
  --password VALUE           Login password (default: resolved from .env/secrets)
  --account-id VALUE         MT5 account id (default: 541283177)
  --symbol VALUE             EURUSD, BTCUSD, or AUTO (default: AUTO)
  --side VALUE               buy or sell (default: buy)
  --lots VALUE               MT5 lots to send (default: 0.01)
  --notional-usd VALUE       Estimated notional in USD (default: 5)
  --max-spread-bps VALUE     Max spread bps (default: 10)
  --confidence VALUE         Live hardening confidence (default: 0.8)
  --preferred-venue VALUE    Preferred venue (default: mt5)
  --rationale VALUE          Human rationale note
  --confirm-live VALUE       Must equal MT5_LIVE_SMOKE to submit/approve live
  --approve VALUE            Approval id to second-approve instead of creating a new request
  --print-raw                Print raw JSON response
  --insecure                 Pass -k to curl
  -h, --help                 Show help

Notes:
  - The bridge now fails closed when broker_session.execution_url is missing.
  - With SYMBOL=AUTO, the script chooses EURUSD only during the FTMO week window
    (Mon 01:05 UTC -> Fri 23:50 UTC) and falls back to BTCUSD when FX is closed.
  - A first live submit returns pending_second_approval. A second operator must
    run the script with --approve <approval_id> to execute the real broker order.
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
    --lots) LOTS="$2"; shift 2 ;;
    --notional-usd) NOTIONAL_USD="$2"; shift 2 ;;
    --max-spread-bps) MAX_SPREAD_BPS="$2"; shift 2 ;;
    --confidence) CONFIDENCE="$2"; shift 2 ;;
    --preferred-venue) PREFERRED_VENUE="$2"; shift 2 ;;
    --rationale) RATIONALE="$2"; shift 2 ;;
    --confirm-live) CONFIRM_LIVE="$2"; shift 2 ;;
    --approve) APPROVAL_ID="$2"; shift 2 ;;
    --print-raw) PRINT_RAW="1"; shift 1 ;;
    --insecure) CURL_INSECURE="1"; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

if [ "$CONFIRM_LIVE" != "MT5_LIVE_SMOKE" ]; then
  echo "confirmation_missing: pass --confirm-live MT5_LIVE_SMOKE" >&2
  exit 3
fi

if [ -z "$PASSWORD" ]; then
  PASSWORD="$(txt_resolve_user_password "$USERNAME" "$PASSWORD" || true)"
fi

if [ -z "$PASSWORD" ]; then
  echo "auth_error: password missing for user '$USERNAME'" >&2
  exit 4
fi

if [ "$SIDE" != "buy" ] && [ "$SIDE" != "sell" ]; then
  echo "invalid_side: expected buy or sell" >&2
  exit 5
fi

txt_init_curl_tls_flag "$CURL_INSECURE"

TOKEN="$(txt_control_plane_login_token "$CONTROL_PLANE_URL" "$USERNAME" "$PASSWORD" "$CURL_INSECURE" || true)"
if [ -z "$TOKEN" ]; then
  echo "login_failed: no access token returned" >&2
  exit 6
fi

SELECTED_SYMBOL="$(SYMBOL="$SYMBOL" python3 - <<'PY'
import os
from datetime import datetime, time, timezone

symbol = os.environ["SYMBOL"].strip().upper()
if symbol and symbol != "AUTO":
    print(symbol)
    raise SystemExit(0)

now = datetime.now(timezone.utc)
monday_open = time(hour=1, minute=5)
friday_close = time(hour=23, minute=50)
weekday = now.weekday()
fx_open = True
if weekday in {5, 6}:
    fx_open = False
elif weekday == 0 and now.time() < monday_open:
    fx_open = False
elif weekday == 4 and now.time() >= friday_close:
    fx_open = False

print("EURUSD" if fx_open else "BTCUSD")
PY
)"

ACCOUNT_CONFIG_JSON="$(curl "${CURL_TLS_FLAG[@]}" --max-time 25 -sS \
  -H "Authorization: Bearer $TOKEN" \
  "$CONTROL_PLANE_URL/v1/mt5/accounts")"

ACCOUNT_CHECK="$(ACCOUNT_CONFIG_JSON="$ACCOUNT_CONFIG_JSON" TARGET_ACCOUNT_ID="$ACCOUNT_ID" python3 - <<'PY'
import json
import os
import sys

payload = json.loads(os.environ["ACCOUNT_CONFIG_JSON"])
target = os.environ["TARGET_ACCOUNT_ID"]
if not isinstance(payload, list):
    raise SystemExit("mt5_accounts_unavailable")
account = next((item for item in payload if str(item.get("account_id") or "") == target), None)
if not isinstance(account, dict):
    raise SystemExit("mt5_account_not_found")
metadata = account.get("metadata") if isinstance(account.get("metadata"), dict) else {}
broker_session = metadata.get("broker_session") if isinstance(metadata.get("broker_session"), dict) else {}
execution_url = str(broker_session.get("execution_url") or broker_session.get("place_order_url") or broker_session.get("order_url") or "").strip()
if not execution_url:
    raise SystemExit("mt5_execution_url_missing")
print(json.dumps({"mode": account.get("mode"), "status": account.get("status"), "execution_url": execution_url}))
PY
 2>&1)" || {
  echo "$ACCOUNT_CHECK" >&2
  exit 7
}

if [ -n "$APPROVAL_ID" ]; then
  RESPONSE_BODY="$(curl "${CURL_TLS_FLAG[@]}" --max-time 45 -sS \
    -H "Authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' \
    -X POST "$CONTROL_PLANE_URL/v1/mt5/orders/live-approve/$APPROVAL_ID")"
else
  REQUEST_BODY="$(ACCOUNT_ID="$ACCOUNT_ID" SYMBOL="$SELECTED_SYMBOL" SIDE="$SIDE" LOTS="$LOTS" NOTIONAL_USD="$NOTIONAL_USD" MAX_SPREAD_BPS="$MAX_SPREAD_BPS" CONFIDENCE="$CONFIDENCE" PREFERRED_VENUE="$PREFERRED_VENUE" RATIONALE="$RATIONALE" python3 - <<'PY'
import json
import os

print(json.dumps({
    "account_id": os.environ["ACCOUNT_ID"],
    "symbol": os.environ["SYMBOL"],
    "side": os.environ["SIDE"],
    "lots": float(os.environ["LOTS"]),
    "estimated_notional_usd": float(os.environ["NOTIONAL_USD"]),
    "max_spread_bps": int(float(os.environ["MAX_SPREAD_BPS"])),
    "confidence": float(os.environ["CONFIDENCE"]),
    "preferred_venue": os.environ["PREFERRED_VENUE"],
    "rationale": os.environ["RATIONALE"],
    "metadata": {
        "source": "scripts/mt5_live_operator_smoke.sh",
        "smoke": True,
        "confidence": float(os.environ["CONFIDENCE"]),
    },
}))
PY
)"

  RESPONSE_BODY="$(curl "${CURL_TLS_FLAG[@]}" --max-time 45 -sS \
    -H "Authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' \
    -X POST "$CONTROL_PLANE_URL/v1/mt5/orders/filter" \
    --data "$REQUEST_BODY")"
fi

if [ "$PRINT_RAW" = "1" ]; then
  printf '%s\n' "$RESPONSE_BODY"
  exit 0
fi

ACCOUNT_CHECK_JSON="$ACCOUNT_CHECK" RESPONSE_BODY_JSON="$RESPONSE_BODY" SELECTED_SYMBOL="$SELECTED_SYMBOL" APPROVAL_ID="$APPROVAL_ID" python3 - <<'PY'
import json
import os

account = json.loads(os.environ["ACCOUNT_CHECK_JSON"])
body = json.loads(os.environ["RESPONSE_BODY_JSON"])
print(f"account_mode={account.get('mode', '-')}")
print(f"account_status={account.get('status', '-')}")
print(f"execution_url={account.get('execution_url', '-')}")
print(f"symbol={os.environ['SELECTED_SYMBOL']}")
if os.environ["APPROVAL_ID"]:
    print(f"approval_id={os.environ['APPROVAL_ID']}")
print(f"status={body.get('status', '-')}")
hardening = body.get("hardening") if isinstance(body.get("hardening"), dict) else {}
if hardening:
    print(f"hardening_status={hardening.get('status', '-')}")
    print(f"hardening_effective_confidence={hardening.get('effective_confidence', '-')}")
    print(f"hardening_reasons={','.join(hardening.get('reasons') or [])}")
if isinstance(body.get("detail"), dict):
    detail = body["detail"]
    print(f"detail_status={detail.get('status', '-')}")
    print(f"detail_reason={detail.get('reason', '-')}")
    print(f"detail_next_open_at={detail.get('next_open_at', '-')}")
else:
    print(f"detail={body.get('detail', '-')}")
print(f"approval_id={body.get('approval_id', '-')}")
print(f"broker_ticket={body.get('broker_ticket', '-')}")
print(f"bridge_mode={body.get('bridge_mode', '-')}")
print(f"latency_ms={body.get('latency_ms', '-')}")
print(f"realized_slippage_bps={body.get('realized_slippage_bps', '-')}")
tradability = body.get("tradability") if isinstance(body.get("tradability"), dict) else {}
print(f"tradable={tradability.get('tradable', '-')}")
print(f"tradability_reason={tradability.get('reason', '-')}")
print(f"tradability_session={tradability.get('session', '-')}")
print(f"tradability_next_open_at={tradability.get('next_open_at', '-')}")
PY
