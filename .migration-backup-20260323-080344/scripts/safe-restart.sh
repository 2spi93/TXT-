#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="$ROOT_DIR/logs/safe-restart"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="$LOG_ROOT/$TIMESTAMP"

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
HOST_HEADER="${HOST_HEADER:-app.txt.gtixt.com}"
CHECK_TIMEOUT_SEC="${CHECK_TIMEOUT_SEC:-180}"
CHECK_INTERVAL_SEC="${CHECK_INTERVAL_SEC:-2}"

DEFAULT_CHECKS=(
  "/terminal"
  "/api/mt5/orders/risk-history?limit=120&symbol=BTCUSD&account_id=mt5-demo-01"
  "/api/mt5/orders/risk-history/summary?window=10&miss_threshold=3&symbol=BTCUSD&account_id=mt5-demo-01"
)

COMPOSE_BIN=(docker compose)

DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: scripts/safe-restart.sh [options]

Safe restart flow:
1) Snapshot running services
2) docker compose up -d
3) Wait for services to be healthy/running
4) Run API checks (HTTP 200 expected)
5) Check WebSocket connectivity
6) On failure: auto rollback + log dump
7) Export JSON summary for monitoring

Options:
  --base-url URL         Base URL for checks (default: http://127.0.0.1:3000)
  --host HOST            Host header for checks (default: app.txt.gtixt.com)
  --timeout SEC          Global wait timeout in seconds (default: 180)
  --interval SEC         Poll interval in seconds (default: 2)
  --check PATH           Extra API path to check (can be repeated)
  --compose-file FILE    Compose file path (repeatable)
  --dry-run              Simulate restart without making changes
  --help                 Show this help

Environment:
  BASE_URL, HOST_HEADER, CHECK_TIMEOUT_SEC, CHECK_INTERVAL_SEC

Output:
  Diagnostics saved to logs/safe-restart/<TIMESTAMP>/
  JSON summary: summary.json (success, duration, checks, latencies)
EOF
}

EXTRA_CHECKS=()
COMPOSE_FILES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    --host)
      HOST_HEADER="$2"
      shift 2
      ;;
    --timeout)
      CHECK_TIMEOUT_SEC="$2"
      shift 2
      ;;
    --interval)
      CHECK_INTERVAL_SEC="$2"
      shift 2
      ;;
    --check)
      EXTRA_CHECKS+=("$2")
      shift 2
      ;;
    --compose-file)
      COMPOSE_FILES+=("$2")
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ ${#COMPOSE_FILES[@]} -gt 0 ]]; then
  COMPOSE_BIN+=("-f")
  for f in "${COMPOSE_FILES[@]}"; do
    COMPOSE_BIN+=("$f" "-f")
  done
  unset 'COMPOSE_BIN[${#COMPOSE_BIN[@]}-1]'
fi

mkdir -p "$RUN_DIR"

mapfile -t CHECKS < <(printf '%s\n' "${DEFAULT_CHECKS[@]}" "${EXTRA_CHECKS[@]}" | awk 'NF' | awk '!seen[$0]++')

pushd "$ROOT_DIR" >/dev/null

log() {
  printf '[safe-restart] %s\n' "$*"
}

# Timing and results tracking
RESULTS_CHECKS=()
declare -A CHECK_LATENCIES
READINESS_START_TIME=0
READINESS_END_TIME=0
CHECKS_START_TIME=0
CHECKS_END_TIME=0
WS_START_TIME=0
WS_END_TIME=0
WS_SUCCESS=0

dump_logs() {
  log "Dumping diagnostics to $RUN_DIR"
  {
    echo "timestamp=$TIMESTAMP"
    echo "base_url=$BASE_URL"
    echo "host_header=$HOST_HEADER"
    echo "timeout=$CHECK_TIMEOUT_SEC"
    echo "interval=$CHECK_INTERVAL_SEC"
    echo "dry_run=$DRY_RUN"
  } >"$RUN_DIR/meta.txt"

  "${COMPOSE_BIN[@]}" ps >"$RUN_DIR/compose-ps.txt" 2>&1 || true
  docker ps -a >"$RUN_DIR/docker-ps-a.txt" 2>&1 || true
  uptime >"$RUN_DIR/uptime.txt" 2>&1 || true
  free -m >"$RUN_DIR/free-m.txt" 2>&1 || true

  while IFS= read -r svc; do
    [[ -n "$svc" ]] || continue
    "${COMPOSE_BIN[@]}" logs --no-color --tail 300 "$svc" >"$RUN_DIR/log-$svc.txt" 2>&1 || true
  done < <("${COMPOSE_BIN[@]}" config --services 2>/dev/null || true)
}

PREV_RUNNING=()
while IFS= read -r svc; do
  [[ -n "$svc" ]] && PREV_RUNNING+=("$svc")
done < <("${COMPOSE_BIN[@]}" ps --status running --services 2>/dev/null || true)

printf '%s\n' "${PREV_RUNNING[@]-}" >"$RUN_DIR/prev-running-services.txt"

rollback() {
  log "Rollback started"

  CURRENT_RUNNING=()
  while IFS= read -r svc; do
    [[ -n "$svc" ]] && CURRENT_RUNNING+=("$svc")
  done < <("${COMPOSE_BIN[@]}" ps --status running --services 2>/dev/null || true)

  if [[ ${#PREV_RUNNING[@]} -gt 0 ]]; then
    log "Restoring previously running services: ${PREV_RUNNING[*]}"
    "${COMPOSE_BIN[@]}" up -d "${PREV_RUNNING[@]}" || true
  fi

  for svc in "${CURRENT_RUNNING[@]}"; do
    keep=0
    for prev in "${PREV_RUNNING[@]}"; do
      if [[ "$svc" == "$prev" ]]; then
        keep=1
        break
      fi
    done
    if [[ $keep -eq 0 ]]; then
      log "Stopping service not present before restart: $svc"
      "${COMPOSE_BIN[@]}" stop "$svc" || true
    fi
  done

  log "Rollback completed"
}

wait_for_services() {
  local deadline now
  deadline=$((SECONDS + CHECK_TIMEOUT_SEC))
  READINESS_START_TIME=$SECONDS

  mapfile -t all_services < <("${COMPOSE_BIN[@]}" config --services)
  log "Waiting services: ${all_services[*]}"

  while true; do
    local all_ready=1

    for svc in "${all_services[@]}"; do
      local cid
      cid="$("${COMPOSE_BIN[@]}" ps -q "$svc" | head -n 1)"
      if [[ -z "$cid" ]]; then
        all_ready=0
        continue
      fi

      local running health
      running="$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo false)"
      health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo none)"

      if [[ "$running" != "true" ]]; then
        all_ready=0
        continue
      fi

      if [[ "$health" != "none" && "$health" != "healthy" ]]; then
        all_ready=0
        continue
      fi
    done

    if [[ $all_ready -eq 1 ]]; then
      READINESS_END_TIME=$SECONDS
      log "All services ready"
      return 0
    fi

    now=$SECONDS
    if (( now >= deadline )); then
      READINESS_END_TIME=$SECONDS
      log "Service readiness timeout"
      return 1
    fi

    sleep "$CHECK_INTERVAL_SEC"
  done
}

check_apis() {
  local failed=0
  : >"$RUN_DIR/check-results.txt"
  CHECKS_START_TIME=$SECONDS

  for path in "${CHECKS[@]}"; do
    local code start_time elapsed
    start_time=$SECONDS
    code="$(curl --max-time 20 -s -o /dev/null -w '%{http_code}' -H "Host: $HOST_HEADER" "$BASE_URL$path" || echo 000)"
    elapsed=$((SECONDS - start_time))
    CHECK_LATENCIES["${path:0:60}"]=$elapsed
    printf '%s %s (latency: %ds)\n' "$code" "$path" "$elapsed" | tee -a "$RUN_DIR/check-results.txt"
    RESULTS_CHECKS+=("$code:$path:$elapsed")
    if [[ "$code" != "200" ]]; then
      failed=1
    fi
  done

  CHECKS_END_TIME=$SECONDS

  if [[ $failed -ne 0 ]]; then
    log "API checks failed"
    return 1
  fi

  log "API checks passed"
  return 0
}

check_websocket() {
  local ws_url ws_protocol timeout=10
  
  WS_START_TIME=$SECONDS
  
  # Convert http/https to ws/wss
  if [[ "$BASE_URL" == https://* ]]; then
    ws_url="${BASE_URL//https:/wss:}/"
  else
    ws_url="${BASE_URL//http:/ws:}/"
  fi
  
  # Use curl to connect via HTTP Upgrade (WebSocket handshake)
  if curl --max-time "$timeout" -i -N -H "Connection: Upgrade" \
       -H "Upgrade: websocket" \
       -H "Sec-WebSocket-Version: 13" \
       -H "Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==" \
       -H "Host: $HOST_HEADER" \
       "${ws_url}ws" >/dev/null 2>&1; then
    WS_END_TIME=$SECONDS
    WS_SUCCESS=1
    log "WebSocket check passed (latency: $((WS_END_TIME - WS_START_TIME))s)"
    return 0
  else
    WS_END_TIME=$SECONDS
    WS_SUCCESS=0
    log "WebSocket check failed (latency: $((WS_END_TIME - WS_START_TIME))s)"
    return 1
  fi
}

export_json_summary() {
  local total_duration checks_duration ws_duration
  total_duration=$((SECONDS))
  checks_duration=$((CHECKS_END_TIME - CHECKS_START_TIME))
  ws_duration=$((WS_END_TIME - WS_START_TIME))
  
  local checks_json="["
  for check_result in "${RESULTS_CHECKS[@]}"; do
    IFS=':' read -r code path latency <<< "$check_result"
    checks_json+="{\"code\":$code,\"path\":\"$path\",\"latency_sec\":$latency},"
  done
  checks_json="${checks_json%,}]"
  
  cat >"$RUN_DIR/summary.json" <<EOF
{
  "timestamp": "$TIMESTAMP",
  "dry_run": $DRY_RUN,
  "success": $([[ $? -eq 0 ]] && echo "true" || echo "false"),
  "base_url": "$BASE_URL",
  "host_header": "$HOST_HEADER",
  "timings": {
    "total_duration_sec": $total_duration,
    "readiness_duration_sec": $((READINESS_END_TIME - READINESS_START_TIME)),
    "checks_duration_sec": $checks_duration,
    "websocket_duration_sec": $ws_duration
  },
  "checks": $checks_json,
  "websocket": {
    "success": $WS_SUCCESS,
    "latency_sec": $ws_duration
  },
  "logs_directory": "$RUN_DIR"
}
EOF
  
  log "JSON summary exported to $RUN_DIR/summary.json"
}

log "Step 1/5: docker compose up -d"
if [[ $DRY_RUN -eq 1 ]]; then
  log "[DRY-RUN] Skipping docker compose up -d"
else
  "${COMPOSE_BIN[@]}" up -d
fi

log "Step 2/5: wait services health/running"
if ! wait_for_services; then
  dump_logs
  if [[ $DRY_RUN -eq 0 ]]; then
    rollback
  fi
  log "FAILED (readiness). Diagnostics in $RUN_DIR"
  export_json_summary
  exit 1
fi

log "Step 3/5: API checks"
if ! check_apis; then
  dump_logs
  if [[ $DRY_RUN -eq 0 ]]; then
    rollback
  fi
  log "FAILED (checks). Diagnostics in $RUN_DIR"
  export_json_summary
  exit 1
fi

log "Step 4/5: WebSocket check"
if ! check_websocket; then
  log "WARNING: WebSocket check failed (continuing anyway)"
fi

log "Step 5/5: success"
log "OK - safe restart completed"
export_json_summary

popd >/dev/null
