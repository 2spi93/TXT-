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
PRINT_RAW="${PRINT_RAW:-0}"
CURL_INSECURE="${CURL_INSECURE:-0}"

usage() {
  cat <<'EOF'
Usage: bingx_account_observe.sh [options]

Read-only account snapshot for observing balances, positions and open orders.

Options:
  --control-plane-url URL    Control-plane base URL (default: http://127.0.0.1:8000)
  --username NAME            Login username (default: operator)
  --password VALUE           Login password (default: resolved from .env/secrets)
  --account-id VALUE         Linked BingX account id (required)
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
  exit 5
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
  exit 6
fi

RESPONSE_BODY_FILE="$(mktemp)"
RESPONSE_STATUS="$(curl "${CURL_TLS_FLAG[@]}" --max-time 40 -sS -o "$RESPONSE_BODY_FILE" -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -X GET "$CONTROL_PLANE_URL/v1/internal/accounts/$ACCOUNT_ID/verification")"

if [ "$PRINT_RAW" = "1" ]; then
  cat "$RESPONSE_BODY_FILE"
  exit 0
fi

python3 - <<'PY' "$RESPONSE_BODY_FILE" "$RESPONSE_STATUS"
import json
import sys

path = sys.argv[1]
status_code = sys.argv[2]

with open(path, 'r', encoding='utf-8') as fh:
    body = json.load(fh)

positions = body.get('positions') if isinstance(body.get('positions'), list) else []
open_orders = body.get('open_orders') if isinstance(body.get('open_orders'), list) else []
notes = ((body.get('normalized_state') or {}).get('notes') or []) if isinstance(body.get('normalized_state'), dict) else []
cash = body.get('cash_vs_equivalent') if isinstance(body.get('cash_vs_equivalent'), dict) else {}

print(f"http_status={status_code}")
print(f"status={body.get('status', '-')}")
print(f"account_id={((body.get('account') or {}).get('account_id') if isinstance(body.get('account'), dict) else '-')}")
print(f"total_equivalent_usd={cash.get('total_equivalent_usd', '-')}")
print(f"total_raw_cash_usd={cash.get('total_raw_cash_usd', '-')}")
print(f"positions_count={len(positions)}")
for index, position in enumerate(positions[:5], start=1):
    print(
        f"position_{index}="
        f"{position.get('symbol', '-')}:side={position.get('side', '-')},"
        f"qty={position.get('quantity', '-')},"
        f"entry={position.get('entry_price', '-')},"
        f"mark={position.get('mark_price', '-')},"
        f"pnl={position.get('unrealized_pnl_usd', '-')},"
        f"exposure={position.get('notional_usd', '-')}"
    )
print(f"open_orders_count={len(open_orders)}")
for index, order in enumerate(open_orders[:5], start=1):
    print(
        f"open_order_{index}="
        f"{order.get('side', '-')}:symbol={order.get('symbol', '-')},"
        f"qty={order.get('quantity', '-')},"
        f"price={order.get('price', '-')},"
        f"status={order.get('status', '-')}"
    )
print("notes=" + json.dumps(notes, ensure_ascii=True, separators=(",", ":")))
PY