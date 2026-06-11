#!/usr/bin/env sh
set -eu

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
HOST_HEADER="${HOST_HEADER:-app.txt.gtixt.com}"
USERNAME="${USERNAME:-operator}"
PASSWORD="${PASSWORD:-}"
NEW_PASSWORD="${NEW_PASSWORD:-}"
CONFIRM_PASSWORD="${CONFIRM_PASSWORD:-}"
SYMBOL="${SYMBOL:-BTCUSD}"
ACCOUNT_ID="${ACCOUNT_ID:-mt5-demo-01}"

usage() {
  cat <<'EOF'
Usage: mc-auth-smoke.sh [options]

Options:
  --base-url URL             Base URL (default: http://127.0.0.1:3000)
  --host HOST                Host header (default: app.txt.gtixt.com)
  --username NAME            Login username (default: operator)
  --password VALUE           Login password (default: resolved from .env defaults)
  --new-password VALUE       Optional: rotate password after login
  --confirm-password VALUE   Optional: confirmation for --new-password
  --symbol VALUE             Symbol for smoke calls (default: BTCUSD)
  --account-id VALUE         Account id for risk-history smoke (default: mt5-demo-01)
  -h, --help                 Show help

Environment fallbacks:
  BASE_URL, HOST_HEADER, USERNAME, PASSWORD, NEW_PASSWORD, CONFIRM_PASSWORD, SYMBOL, ACCOUNT_ID

Notes:
  - If --password is omitted, script resolves password from /opt/txt/.env using:
    DEFAULT_OPERATOR_PASSWORD(_FILE), DEFAULT_ADMIN_PASSWORD(_FILE), DEFAULT_VIEWER_PASSWORD(_FILE)
  - Does not print secrets.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --host) HOST_HEADER="$2"; shift 2 ;;
    --username) USERNAME="$2"; shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    --new-password) NEW_PASSWORD="$2"; shift 2 ;;
    --confirm-password) CONFIRM_PASSWORD="$2"; shift 2 ;;
    --symbol) SYMBOL="$2"; shift 2 ;;
    --account-id) ACCOUNT_ID="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

resolve_secret() {
  value="$1"
  file_path="$2"
  if [ -n "$value" ]; then
    printf "%s" "$value"
    return 0
  fi
  if [ -n "$file_path" ] && [ -f "$file_path" ]; then
    tr -d '\n' < "$file_path"
    return 0
  fi
  return 1
}

if [ -f /opt/txt/.env ]; then
  # shellcheck disable=SC1091
  set -a
  . /opt/txt/.env
  set +a
fi

if [ -z "$PASSWORD" ]; then
  case "$USERNAME" in
    operator)
      PASSWORD="$(resolve_secret "${DEFAULT_OPERATOR_PASSWORD:-}" "${DEFAULT_OPERATOR_PASSWORD_FILE:-}" || true)"
      ;;
    admin)
      PASSWORD="$(resolve_secret "${DEFAULT_ADMIN_PASSWORD:-}" "${DEFAULT_ADMIN_PASSWORD_FILE:-}" || true)"
      ;;
    viewer)
      PASSWORD="$(resolve_secret "${DEFAULT_VIEWER_PASSWORD:-}" "${DEFAULT_VIEWER_PASSWORD_FILE:-}" || true)"
      ;;
  esac
fi

if [ -z "$PASSWORD" ]; then
  echo "auth_error: password missing for user '$USERNAME'" >&2
  exit 3
fi

if [ -n "$NEW_PASSWORD" ] && [ -z "$CONFIRM_PASSWORD" ]; then
  CONFIRM_PASSWORD="$NEW_PASSWORD"
fi

COOKIE_FILE="/tmp/mc_auth_cookie.txt"
rm -f "$COOKIE_FILE"

login_code="$(curl --max-time 20 -s -o /tmp/mc_login_body.txt -D /tmp/mc_login_headers.txt -c "$COOKIE_FILE" -b "$COOKIE_FILE" -w '%{http_code}' \
  -H "Host: $HOST_HEADER" \
  -H 'content-type: application/json' \
  -X POST "$BASE_URL/api/auth/login" \
  --data "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}")"

login_location="$(grep -i '^location:' /tmp/mc_login_headers.txt | tail -n 1 | tr -d '\r' | cut -d' ' -f2-)"

if [ "$login_code" != "302" ] && [ "$login_code" != "303" ]; then
  echo "login_failed: status=$login_code"
  exit 4
fi

if echo "$login_location" | grep -q 'error=1'; then
  echo "login_failed: invalid_credentials"
  exit 5
fi

if [ -n "$NEW_PASSWORD" ]; then
  cp_code="$(curl --max-time 20 -s -o /tmp/mc_change_password_body.txt -D /tmp/mc_change_password_headers.txt -b "$COOKIE_FILE" -c "$COOKIE_FILE" -w '%{http_code}' \
    -H "Host: $HOST_HEADER" \
    -H 'content-type: application/x-www-form-urlencoded' \
    -X POST "$BASE_URL/api/auth/change-password" \
    --data "old_password=$(printf '%s' "$PASSWORD" | sed 's/%/%25/g; s/&/%26/g; s/=/%3D/g')&new_password=$(printf '%s' "$NEW_PASSWORD" | sed 's/%/%25/g; s/&/%26/g; s/=/%3D/g')&confirm_password=$(printf '%s' "$CONFIRM_PASSWORD" | sed 's/%/%25/g; s/&/%26/g; s/=/%3D/g')")"
  cp_location="$(grep -i '^location:' /tmp/mc_change_password_headers.txt | tail -n 1 | tr -d '\r' | cut -d' ' -f2-)"
  if [ "$cp_code" != "302" ] && [ "$cp_code" != "303" ]; then
    echo "change_password_failed: status=$cp_code"
    exit 6
  fi
  if echo "$cp_location" | grep -q 'error=1'; then
    echo "change_password_failed: rejected"
    exit 7
  fi
  echo "change_password_ok"
fi

risk_code="$(curl --max-time 20 -s -o /tmp/mc_risk_history_body.json -w '%{http_code}' -b "$COOKIE_FILE" \
  -H "Host: $HOST_HEADER" \
  -H 'x-mc-origin: terminal' \
  -H 'x-mc-priority: high' \
  -H 'x-mc-requested-by: execution' \
  -H 'x-mc-signal-state: danger' \
  -H 'x-mc-volatility: high' \
  "$BASE_URL/api/mt5/orders/risk-history?limit=120&symbol=$SYMBOL&account_id=$ACCOUNT_ID")"
risk_bytes="$(wc -c < /tmp/mc_risk_history_body.json)"

dom_code="$(curl --max-time 20 -s -o /tmp/mc_broker_orderbook_body.json -w '%{http_code}' -b "$COOKIE_FILE" \
  -H "Host: $HOST_HEADER" \
  -H 'x-mc-origin: terminal' \
  -H 'x-mc-priority: high' \
  -H 'x-mc-requested-by: execution' \
  -H 'x-mc-signal-state: danger' \
  -H 'x-mc-volatility: high' \
  "$BASE_URL/api/broker/orderbook/binance/$SYMBOL?limit=20")"
dom_bytes="$(wc -c < /tmp/mc_broker_orderbook_body.json)"

echo "risk_history_auth $risk_code bytes=$risk_bytes"
echo "broker_orderbook_auth $dom_code bytes=$dom_bytes"
