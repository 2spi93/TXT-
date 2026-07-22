#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-/opt/txt}"
HELPERS_PATH="${HELPERS_PATH:-$ROOT_DIR/scripts/lib/control_plane_helpers.sh}"
ACTIVE_SLOT_FILE="${ACTIVE_SLOT_FILE:-$ROOT_DIR/data/mission-control/ui-active-slot.conf}"
TERMINAL_PATH="${TERMINAL_PATH:-/terminal?engine=v4&terminal_passive_mode=1&boot=full}"
READY_PATH="${READY_PATH:-/login}"
HOST_JSONL_PATH="${OUT:-$ROOT_DIR/logs/terminal-truth-observer.jsonl}"
STATE_FILE="${STATE_FILE:-$ROOT_DIR/logs/terminal-truth-observer.state.json}"
CRASH_FORENSICS_DIR="${CRASH_FORENSICS_DIR:-$ROOT_DIR/logs/terminal_crash_forensics}"
MISSION_CONTROL_UI_SLOT="${MISSION_CONTROL_UI_SLOT:-active}"
MISSION_CONTROL_UI_CONTAINER="${MISSION_CONTROL_UI_CONTAINER:-}"
BASE_URL_OVERRIDE="${BASE_URL:-}"
WAIT_READY_ATTEMPTS="${WAIT_READY_ATTEMPTS:-60}"
WAIT_READY_INTERVAL_SEC="${WAIT_READY_INTERVAL_SEC:-2}"
RUN_FOREVER="${RUN_FOREVER:-1}"
ITERATIONS="${ITERATIONS:-1}"
CYCLE_INTERVAL_MS="${CYCLE_INTERVAL_MS:-${CHECK_EVERY_MS:-15000}}"
TRUTH_TIMEOUT_MS="${TRUTH_TIMEOUT_MS:-45000}"
NAVIGATION_TIMEOUT_MS="${NAVIGATION_TIMEOUT_MS:-90000}"
WEBHOOK_URL="${WEBHOOK_URL:-}"
WEBHOOK_URL_FILE="${WEBHOOK_URL_FILE:-$ROOT_DIR/secrets/terminal_truth_observer_webhook_url}"
WEBHOOK_TIMEOUT_SEC="${WEBHOOK_TIMEOUT_SEC:-10}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_BOT_TOKEN_FILE="${TELEGRAM_BOT_TOKEN_FILE:-$ROOT_DIR/secrets/telegram_bot_token}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
TELEGRAM_CHAT_ID_FILE="${TELEGRAM_CHAT_ID_FILE:-$ROOT_DIR/secrets/telegram_chat_id}"
TELEGRAM_TOPIC_ID="${TELEGRAM_TOPIC_ID:-}"
TELEGRAM_DISABLE_NOTIFICATION="${TELEGRAM_DISABLE_NOTIFICATION:-0}"
TELEGRAM_API_BASE_URL="${TELEGRAM_API_BASE_URL:-https://api.telegram.org}"
ALERT_ON_STATUS="${ALERT_ON_STATUS:-degraded,error}"
ALERT_REPEAT_ERROR_EVERY="${ALERT_REPEAT_ERROR_EVERY:-3}"
CONTAINER_OUTPUT_PATH="${CONTAINER_OUTPUT_PATH:-/tmp/terminal-truth-observer.jsonl}"
ALERT_TEXT_RENDERER="${ALERT_TEXT_RENDERER:-$ROOT_DIR/scripts/lib/terminal_truth_alert_text.js}"
TRANSIENT_RETRY_COUNT="${TRANSIENT_RETRY_COUNT:-2}"
TRANSIENT_RETRY_DELAY_SEC="${TRANSIENT_RETRY_DELAY_SEC:-2}"
OBSERVER_ATTEMPT_TIMEOUT_SEC="${OBSERVER_ATTEMPT_TIMEOUT_SEC:-180}"
AUTO_RECOVERY_ENABLED="${AUTO_RECOVERY_ENABLED:-0}"
AUTO_RECOVERY_SCRIPT="${AUTO_RECOVERY_SCRIPT:-$ROOT_DIR/scripts/auto_recover_terminal_truth_incident.sh}"

if [[ -f "$HELPERS_PATH" ]]; then
  # shellcheck disable=SC1090
  . "$HELPERS_PATH"
fi

resolve_runtime_secret() {
  local value="${1:-}"
  local file_path="${2:-}"
  if declare -F txt_resolve_secret >/dev/null 2>&1; then
    txt_resolve_secret "$value" "$file_path" || true
    return 0
  fi
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
    return 0
  fi
  if [[ -n "$file_path" && -f "$file_path" ]]; then
    tr -d '\n' < "$file_path"
    return 0
  fi
  return 0
}

mkdir -p "$(dirname "$HOST_JSONL_PATH")"
mkdir -p "$(dirname "$STATE_FILE")"
mkdir -p "$CRASH_FORENSICS_DIR"

TELEGRAM_BOT_TOKEN="$(resolve_runtime_secret "$TELEGRAM_BOT_TOKEN" "$TELEGRAM_BOT_TOKEN_FILE")"
TELEGRAM_CHAT_ID="$(resolve_runtime_secret "$TELEGRAM_CHAT_ID" "$TELEGRAM_CHAT_ID_FILE")"
WEBHOOK_URL="$(resolve_runtime_secret "$WEBHOOK_URL" "$WEBHOOK_URL_FILE")"

slot_port() {
  case "$1" in
    blue) printf '3001\n' ;;
    green) printf '3002\n' ;;
    *) return 1 ;;
  esac
}

ensure_active_slot_file() {
  mkdir -p "$(dirname "$ACTIVE_SLOT_FILE")"
  if [[ ! -f "$ACTIVE_SLOT_FILE" ]]; then
    cat >"$ACTIVE_SLOT_FILE" <<'EOF'
set $upstream_ui http://mission-control-ui-blue:3001;
EOF
  fi
}

resolve_active_slot() {
  ensure_active_slot_file
  if grep -q 'mission-control-ui-green:3002' "$ACTIVE_SLOT_FILE"; then
    printf 'green\n'
  else
    printf 'blue\n'
  fi
}

resolve_slot() {
  if [[ "$MISSION_CONTROL_UI_SLOT" == 'active' ]]; then
    resolve_active_slot
  else
    printf '%s\n' "$MISSION_CONTROL_UI_SLOT"
  fi
}

resolve_container() {
  local slot="$1"
  if [[ -n "$MISSION_CONTROL_UI_CONTAINER" ]]; then
    printf '%s\n' "$MISSION_CONTROL_UI_CONTAINER"
  else
    printf 'mission-control-ui-%s\n' "$slot"
  fi
}

resolve_base_url() {
  local slot="$1"
  if [[ -n "$BASE_URL_OVERRIDE" ]]; then
    printf '%s\n' "$BASE_URL_OVERRIDE"
    return
  fi
  printf 'http://127.0.0.1:%s\n' "$(slot_port "$slot")"
}

json_get_field() {
  local json_line="$1"
  local field_name="$2"
  if [[ -z "$json_line" ]]; then
    return 0
  fi
  node -e '
try {
  const value = JSON.parse(process.argv[1])[process.argv[2]];
  process.stdout.write(value == null ? "" : String(value));
} catch {
  process.exit(0);
}
' "$json_line" "$field_name"
}

build_error_record() {
  local reason="$1"
  local base_url="$2"
  local snapshot_payload="${3:-}"
  local terminal_url="${base_url%/}${TERMINAL_PATH}"
  node -e 'const reason = process.argv[1]; const terminalUrl = process.argv[2]; const snapshotRaw = process.argv[3] || ""; let snapshot = null; if (snapshotRaw) { try { snapshot = JSON.parse(snapshotRaw); } catch {} } const record = { iteration: 1, capturedAt: new Date().toISOString(), status: "error", reason, readyMs: null, terminalUrl, state: snapshot?.state ?? null, certification: snapshot?.certification ?? null, crashForensics: snapshot?.crashForensics ?? null, responseErrors: [], requestFailures: [], consoleEvents: [], pageErrors: [] }; if (snapshot?.phase) record.observerPhase = snapshot.phase; if (snapshot?.capturedAt) record.observerSnapshotCapturedAt = snapshot.capturedAt; process.stdout.write(JSON.stringify(record));' "$reason" "$terminal_url" "$snapshot_payload"
}

read_container_snapshot() {
  local container="$1"
  local snapshot_path="$2"
  docker exec "$container" sh -lc "cat '$snapshot_path' 2>/dev/null || true; rm -f '$snapshot_path' >/dev/null 2>&1 || true" || true
}

with_observer_attempt_metadata() {
  local record="$1"
  local attempt_count="$2"
  node -e 'const record = JSON.parse(process.argv[1]); record.observerAttemptCount = Number(process.argv[2] || "1"); process.stdout.write(JSON.stringify(record));' "$record" "$attempt_count"
}

enrich_record() {
  local raw_record="$1"
  local slot="$2"
  local container="$3"
  local base_url="$4"
  node -e 'const record = JSON.parse(process.argv[1]); record.hostCapturedAt = new Date().toISOString(); record.slot = process.argv[2]; record.container = process.argv[3]; record.baseUrl = process.argv[4]; process.stdout.write(JSON.stringify(record));' "$raw_record" "$slot" "$container" "$base_url"
}

wait_until_ready() {
  local container="$1"
  local base_url="$2"
  local ready_url="${base_url%/}${READY_PATH}"
  local attempt
  for (( attempt=1; attempt<=WAIT_READY_ATTEMPTS; attempt+=1 )); do
    if docker exec "$container" sh -lc "wget -qO- '$ready_url' >/dev/null 2>&1"; then
      return 0
    fi
    sleep "$WAIT_READY_INTERVAL_SEC"
  done
  return 1
}

append_host_record() {
  local record="$1"
  printf '%s\n' "$record" >>"$HOST_JSONL_PATH"
}

write_crash_forensics_record() {
  local record="$1"
  local status reason captured_at slot sanitized_reason timestamp_safe output_path
  status="$(json_get_field "$record" status)"
  if [[ "$status" != 'error' ]]; then
    return 0
  fi
  reason="$(json_get_field "$record" reason)"
  captured_at="$(json_get_field "$record" capturedAt)"
  slot="$(json_get_field "$record" slot)"
  sanitized_reason="$(printf '%s' "$reason" | tr -cs 'A-Za-z0-9._-' '-')"
  sanitized_reason="${sanitized_reason#-}"
  sanitized_reason="${sanitized_reason%-}"
  sanitized_reason="${sanitized_reason:-error}"
  timestamp_safe="${captured_at:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  timestamp_safe="${timestamp_safe//:/-}"
  output_path="$CRASH_FORENSICS_DIR/${timestamp_safe}-${slot:-unknown}-${sanitized_reason}.json"
  printf '%s\n' "$record" >"$output_path"
}

read_previous_status() {
  if [[ ! -f "$STATE_FILE" ]]; then
    return 0
  fi
  node -e 'try { const fs = require("fs"); const raw = fs.readFileSync(process.argv[1], "utf8").trim(); if (!raw) process.exit(0); const parsed = JSON.parse(raw); process.stdout.write(String(parsed.status || "")); } catch { process.exit(0); }' "$STATE_FILE" 2>/dev/null || true
}

read_previous_reason() {
  if [[ ! -f "$STATE_FILE" ]]; then
    return 0
  fi
  node -e 'try { const fs = require("fs"); const raw = fs.readFileSync(process.argv[1], "utf8").trim(); if (!raw) process.exit(0); const parsed = JSON.parse(raw); process.stdout.write(String(parsed.reason || "")); } catch { process.exit(0); }' "$STATE_FILE" 2>/dev/null || true
}

read_previous_repeat_count() {
  if [[ ! -f "$STATE_FILE" ]]; then
    printf '0\n'
    return 0
  fi
  node -e 'try { const fs = require("fs"); const raw = fs.readFileSync(process.argv[1], "utf8").trim(); if (!raw) { process.stdout.write("0"); process.exit(0); } const parsed = JSON.parse(raw); const value = Number(parsed.observerConsecutiveRepeatCount || 0); process.stdout.write(Number.isFinite(value) ? String(value) : "0"); } catch { process.stdout.write("0"); }' "$STATE_FILE" 2>/dev/null || printf '0\n'
}

with_observer_repeat_count() {
  local record="$1"
  local repeat_count="$2"
  local alert_mode="${3:-none}"
  node -e 'const record = JSON.parse(process.argv[1]); record.observerConsecutiveRepeatCount = Number(process.argv[2] || "0"); record.observerAlertMode = process.argv[3] || "none"; process.stdout.write(JSON.stringify(record));' "$record" "$repeat_count" "$alert_mode"
}

write_current_state() {
  local record="$1"
  printf '%s\n' "$record" >"$STATE_FILE"
}

should_alert_for_status() {
  local status="$1"
  local value
  IFS=',' read -r -a statuses <<<"$ALERT_ON_STATUS"
  for value in "${statuses[@]}"; do
    if [[ "${value// /}" == "$status" ]]; then
      return 0
    fi
  done
  return 1
}

is_retryable_observer_reason() {
  local reason="${1:-}"
  [[ "$reason" == 'observer_output_missing' ]] && return 0
  [[ "$reason" == 'observer_attempt_timeout' ]] && return 0
  [[ "$reason" == 'truth_strip_missing' ]] && return 0
  [[ "$reason" == 'truth_labels_missing' ]] && return 0
  [[ "$reason" == 'mission_control_not_ready' ]] && return 0
  [[ "$reason" == *'page.goto: net::ERR_ABORTED'* ]] && return 0
  [[ "$reason" == *'interrupted by another navigation'* ]] && return 0
  [[ "$reason" == *'page.goto: net::ERR_CONNECTION_REFUSED'* ]] && return 0
  [[ "$reason" == *'page.goto: Page crashed'* ]] && return 0
  [[ "$reason" == *'page.goto: net::ERR_CONNECTION_RESET'* ]] && return 0
  [[ "$reason" == *'page.goto: net::ERR_EMPTY_RESPONSE'* ]] && return 0
  [[ "$reason" == *'page.evaluate: Target crashed'* ]] && return 0
  [[ "$reason" == *'browserType.launch: Target page, context or browser has been closed'* ]] && return 0
  [[ "$reason" == *'Zygote could not fork'* ]] && return 0
  [[ "$reason" == *'pthread_create: Resource temporarily unavailable'* ]] && return 0
  [[ "$reason" == *'page.goto: Timeout'*'/login'* ]] && return 0
  [[ "$reason" == *'page.goto: Timeout'*'/terminal'* ]] && return 0
  return 1
}

run_single_observer_attempt() {
  local container="$1"
  local base_url="$2"
  local stdout_summary detail_record snapshot_record container_output_path snapshot_output_path exit_code

  container_output_path="${CONTAINER_OUTPUT_PATH}.$$.$RANDOM.jsonl"
  snapshot_output_path="${container_output_path}.snapshot"

  set +e
  stdout_summary="$(timeout --kill-after=10s "${OBSERVER_ATTEMPT_TIMEOUT_SEC}s" docker exec -i \
    -e BASE_URL="$base_url" \
    -e TERMINAL_PATH="$TERMINAL_PATH" \
    -e OUT="$container_output_path" \
    -e SNAPSHOT_OUT="$snapshot_output_path" \
    -e RUN_FOREVER=0 \
    -e ITERATIONS=1 \
    -e CHECK_EVERY_MS="$CYCLE_INTERVAL_MS" \
    -e TRUTH_TIMEOUT_MS="$TRUTH_TIMEOUT_MS" \
    -e NAVIGATION_TIMEOUT_MS="$NAVIGATION_TIMEOUT_MS" \
    "$container" \
    node /workspace/ui/mission-control/scripts/terminal_truth_observer.js 2>&1)"
  exit_code=$?
  set -e
  if [[ -n "$stdout_summary" ]]; then
    printf '%s\n' "$stdout_summary" >&2
  fi

  snapshot_record="$(read_container_snapshot "$container" "$snapshot_output_path")"

  if [[ "$exit_code" -eq 124 || "$exit_code" -eq 137 ]]; then
    docker exec "$container" sh -lc "rm -f '$container_output_path'" >/dev/null 2>&1 || true
    build_error_record "observer_attempt_timeout" "$base_url" "$snapshot_record"
    return 0
  fi

  detail_record="$(docker exec "$container" sh -lc "tail -n 1 '$container_output_path' 2>/dev/null || true; rm -f '$container_output_path'" )"
  if [[ -z "$detail_record" ]]; then
    build_error_record "observer_output_missing" "$base_url" "$snapshot_record"
    return 0
  fi

  printf '%s\n' "$detail_record"
}

send_webhook_alert() {
  local record="$1"
  if [[ -n "$TELEGRAM_BOT_TOKEN" && -n "$TELEGRAM_CHAT_ID" ]]; then
    send_telegram_alert "$record"
    return
  fi
  if [[ -z "$WEBHOOK_URL" ]]; then
    return 0
  fi
  curl -fsS -m "$WEBHOOK_TIMEOUT_SEC" \
    -H 'Content-Type: application/json' \
    -X POST \
    --data "$record" \
    "$WEBHOOK_URL" >/dev/null
}

build_telegram_payload() {
  local record="$1"
  local rendered_text
  local disable_notification_bool='false'
  if [[ "$TELEGRAM_DISABLE_NOTIFICATION" == '1' ]]; then
    disable_notification_bool='true'
  fi
  rendered_text="$(node "$ALERT_TEXT_RENDERER" "$record")"
  node -e '
const payload = {
  chat_id: process.argv[2],
  text: process.argv[5],
  disable_web_page_preview: true,
  disable_notification: process.argv[4] === "true",
};
if (process.argv[3]) {
  payload.message_thread_id = Number(process.argv[3]);
}
process.stdout.write(JSON.stringify(payload));
' "$record" "$TELEGRAM_CHAT_ID" "$TELEGRAM_TOPIC_ID" "$disable_notification_bool" "$rendered_text"
}

send_telegram_alert() {
  local record="$1"
  local payload api_url
  payload="$(build_telegram_payload "$record")"
  api_url="${TELEGRAM_API_BASE_URL%/}/bot${TELEGRAM_BOT_TOKEN}/sendMessage"
  curl -fsS -m "$WEBHOOK_TIMEOUT_SEC" \
    -H 'Content-Type: application/json' \
    -X POST \
    --data "$payload" \
    "$api_url" >/dev/null
}

process_record() {
  local record="$1"
  local status reason previous_status previous_reason previous_repeat_count current_repeat_count alert_mode enriched_record
  status="$(json_get_field "$record" status)"
  reason="$(json_get_field "$record" reason)"
  previous_status="$(read_previous_status)"
  previous_reason="$(read_previous_reason)"
  previous_repeat_count="$(read_previous_repeat_count)"
  alert_mode='none'

  if [[ "$status" == "$previous_status" && "$reason" == "$previous_reason" ]]; then
    current_repeat_count=$((previous_repeat_count + 1))
  else
    current_repeat_count=1
  fi

  if should_alert_for_status "$status"; then
    if [[ "$status" != "$previous_status" || "$reason" != "$previous_reason" ]]; then
      alert_mode='transition'
    elif [[ "$status" == 'error' && "$ALERT_REPEAT_ERROR_EVERY" =~ ^[0-9]+$ && "$ALERT_REPEAT_ERROR_EVERY" -gt 0 && $((current_repeat_count % ALERT_REPEAT_ERROR_EVERY)) -eq 0 ]]; then
      alert_mode='repeat-threshold'
    fi
  fi

  enriched_record="$(with_observer_repeat_count "$record" "$current_repeat_count" "$alert_mode")"
  append_host_record "$enriched_record"
  write_crash_forensics_record "$enriched_record"
  if [[ "$alert_mode" != 'none' ]]; then
    send_webhook_alert "$enriched_record" || printf '{"status":"error","reason":"webhook_delivery_failed","webhookUrl":"%s"}\n' "$WEBHOOK_URL" >&2
    if [[ "$AUTO_RECOVERY_ENABLED" == '1' && -x "$AUTO_RECOVERY_SCRIPT" ]]; then
      "$AUTO_RECOVERY_SCRIPT" "$enriched_record" || printf '{"status":"error","reason":"auto_recovery_failed","script":"%s"}\n' "$AUTO_RECOVERY_SCRIPT" >&2
    fi
  fi
  write_current_state "$enriched_record"
}

run_observer_cycle() {
  local slot="$1"
  local container="$2"
  local base_url="$3"
  local raw_record status reason attempt attempt_limit

  if ! wait_until_ready "$container" "$base_url"; then
    raw_record="$(build_error_record "mission_control_not_ready" "$base_url")"
    printf '%s\n' "$(enrich_record "$raw_record" "$slot" "$container" "$base_url")"
    return 0
  fi

  attempt=1
  attempt_limit=$((TRANSIENT_RETRY_COUNT + 1))
  while true; do
    raw_record="$(run_single_observer_attempt "$container" "$base_url")"
    status="$(json_get_field "$raw_record" status)"
    reason="$(json_get_field "$raw_record" reason)"
    if [[ "$status" != 'error' ]]; then
      break
    fi
    if (( attempt >= attempt_limit )); then
      break
    fi
    if ! is_retryable_observer_reason "$reason"; then
      break
    fi
    sleep "$TRANSIENT_RETRY_DELAY_SEC"
    attempt=$((attempt + 1))
  done
  raw_record="$(with_observer_attempt_metadata "$raw_record" "$attempt")"
  printf '%s\n' "$(enrich_record "$raw_record" "$slot" "$container" "$base_url")"
}

sleep_between_cycles() {
  local remaining_ms="$CYCLE_INTERVAL_MS"
  while (( remaining_ms > 0 )); do
    local chunk=1000
    if (( remaining_ms < chunk )); then
      chunk="$remaining_ms"
    fi
    sleep "$(awk "BEGIN { printf \"%.3f\", $chunk / 1000 }")"
    remaining_ms=$((remaining_ms - chunk))
  done
}

iteration=0
while true; do
  iteration=$((iteration + 1))
  slot="$(resolve_slot)"
  container="$(resolve_container "$slot")"
  base_url="$(resolve_base_url "$slot")"
  record="$(run_observer_cycle "$slot" "$container" "$base_url")"
  process_record "$record"

  if [[ "$RUN_FOREVER" == '0' && "$iteration" -ge "$ITERATIONS" ]]; then
    break
  fi
  sleep_between_cycles
done