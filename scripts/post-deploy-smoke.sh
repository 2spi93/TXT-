#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
HOST_HEADER="${HOST_HEADER:-app.txt.gtixt.com}"
USERNAME="${USERNAME:-operator}"
PASSWORD="${PASSWORD:-}"
SYMBOL="${SYMBOL:-BTCUSD}"
ACCOUNT_ID="${ACCOUNT_ID:-mt5-demo-01}"
WS_PATH="${WS_PATH:-/ws/v1/market/quotes}"
RUN_BINGX_TPSL_SMOKE="${RUN_BINGX_TPSL_SMOKE:-0}"
BINGX_TPSL_CONTROL_PLANE_URL="${BINGX_TPSL_CONTROL_PLANE_URL:-http://127.0.0.1:8000}"
BINGX_TPSL_ACCOUNT_ID="${BINGX_TPSL_ACCOUNT_ID:-}"
BINGX_TPSL_SYMBOL="${BINGX_TPSL_SYMBOL:-BTCUSDT}"
BINGX_TPSL_SIDE="${BINGX_TPSL_SIDE:-buy}"
BINGX_TPSL_NOTIONAL_USD="${BINGX_TPSL_NOTIONAL_USD:-7.5}"
BINGX_TPSL_RESET_RISK_GATEWAY_IF_NEEDED="${BINGX_TPSL_RESET_RISK_GATEWAY_IF_NEEDED:-1}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TOTAL_STEPS=5
if [[ "$RUN_BINGX_TPSL_SMOKE" == "1" ]]; then
  TOTAL_STEPS=6
fi
STEP=1

check_http() {
  local url="$1"
  local expect_regex="$2"
  local code
  local curl_tls_flag=""
  case "$url" in
    https://*) curl_tls_flag="-k" ;;
  esac
  code="$(curl $curl_tls_flag --max-time 20 -sS -o /tmp/post_deploy_smoke_body.out -w '%{http_code}' -H "Host: $HOST_HEADER" "$url" || echo 000)"
  if [[ ! "$code" =~ $expect_regex ]]; then
    echo "[fail] $url -> $code (expected: $expect_regex)"
    head -c 240 /tmp/post_deploy_smoke_body.out || true
    echo
    return 1
  fi
  echo "[ok]   $url -> $code"
}

echo "[$STEP/$TOTAL_STEPS] Core health checks"
check_http "http://127.0.0.1:8000/health" '^(200)$'
check_http "http://127.0.0.1:8003/health" '^(200)$'
check_http "http://127.0.0.1:8001/health" '^(200)$'
check_http "http://127.0.0.1:8004/health" '^(200)$'
STEP=$((STEP + 1))

echo "[$STEP/$TOTAL_STEPS] Gateway/UI checks"
check_http "$BASE_URL/" '^(200)$'
check_http "http://127.0.0.1/healthz" '^(200)$'
check_http "https://127.0.0.1/healthz" '^(200)$'
STEP=$((STEP + 1))

echo "[$STEP/$TOTAL_STEPS] Next static asset checks"
"$ROOT_DIR/scripts/check_ui_static_assets.sh" --base-url "$BASE_URL" --host "$HOST_HEADER"

# These endpoints are expected to be protected when called without auth.
check_http "$BASE_URL/api/auth/ws-token" '^(200|401)$'
check_http "$BASE_URL/api/connectors/status" '^(200|401)$'
check_http "$BASE_URL/api/mt5/health" '^(200|401)$'
STEP=$((STEP + 1))

echo "[$STEP/$TOTAL_STEPS] Authenticated API + WS 101 E2E"
if [[ -n "$PASSWORD" ]]; then
  "$ROOT_DIR/scripts/mc-auth-smoke.sh" \
    --base-url "$BASE_URL" \
    --host "$HOST_HEADER" \
    --insecure \
    --username "$USERNAME" \
    --password "$PASSWORD" \
    --symbol "$SYMBOL" \
    --account-id "$ACCOUNT_ID" \
    --ws-path "$WS_PATH"
else
  "$ROOT_DIR/scripts/mc-auth-smoke.sh" \
    --base-url "$BASE_URL" \
    --host "$HOST_HEADER" \
    --insecure \
    --username "$USERNAME" \
    --symbol "$SYMBOL" \
    --account-id "$ACCOUNT_ID" \
    --ws-path "$WS_PATH"
fi
STEP=$((STEP + 1))

if [[ "$RUN_BINGX_TPSL_SMOKE" == "1" ]]; then
  if [[ -z "$BINGX_TPSL_ACCOUNT_ID" ]]; then
    echo "[fail] RUN_BINGX_TPSL_SMOKE=1 requires BINGX_TPSL_ACCOUNT_ID"
    exit 1
  fi
  echo "[$STEP/$TOTAL_STEPS] BingX TP/SL runtime smoke"
  bingx_tpsl_args=(
    --control-plane-url "$BINGX_TPSL_CONTROL_PLANE_URL"
    --username "$USERNAME"
    --account-id "$BINGX_TPSL_ACCOUNT_ID"
    --symbol "$BINGX_TPSL_SYMBOL"
    --side "$BINGX_TPSL_SIDE"
    --notional-usd "$BINGX_TPSL_NOTIONAL_USD"
  )
  if [[ -n "$PASSWORD" ]]; then
    bingx_tpsl_args+=(--password "$PASSWORD")
  fi
  if [[ "$BINGX_TPSL_RESET_RISK_GATEWAY_IF_NEEDED" == "1" ]]; then
    bingx_tpsl_args+=(--reset-risk-gateway-if-needed)
  fi
  "$ROOT_DIR/scripts/bingx_tpsl_smoke.sh" "${bingx_tpsl_args[@]}"
  STEP=$((STEP + 1))
fi

echo "[$STEP/$TOTAL_STEPS] Post-deploy smoke completed"
