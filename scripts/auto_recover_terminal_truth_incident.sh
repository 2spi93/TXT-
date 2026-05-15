#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-/opt/txt}"
RECORD_JSON="${1:-}"
STATE_FILE="${AUTO_RECOVERY_STATE_FILE:-$ROOT_DIR/logs/terminal-truth-auto-recovery.state.json}"
LOG_FILE="${AUTO_RECOVERY_LOG_PATH:-$ROOT_DIR/logs/terminal-truth-auto-recovery.jsonl}"
COOLDOWN_SEC="${AUTO_RECOVERY_COOLDOWN_SEC:-300}"
MIN_REPEAT_COUNT="${AUTO_RECOVERY_MIN_REPEAT_COUNT:-6}"
ROLLBACK_REPEAT_COUNT="${AUTO_RECOVERY_ROLLBACK_REPEAT_COUNT:-9}"
ENABLED="${AUTO_RECOVERY_ENABLED:-0}"
DRY_RUN="${AUTO_RECOVERY_DRY_RUN:-0}"
LOCK_DIR="${AUTO_RECOVERY_LOCK_DIR:-$ROOT_DIR/.locks/terminal-truth-auto-recovery}"
ACTIVE_SLOT_FILE="${ACTIVE_SLOT_FILE:-$ROOT_DIR/data/mission-control/ui-active-slot.conf}"

mkdir -p "$(dirname "$STATE_FILE")" "$(dirname "$LOG_FILE")" "$(dirname "$LOCK_DIR")"

log_json() {
  local action="$1"
  local outcome="$2"
  local detail="${3:-}"
  node -e '
const payload = {
  capturedAt: new Date().toISOString(),
  action: process.argv[1],
  outcome: process.argv[2],
  detail: process.argv[3] || "",
  reason: process.env.REASON || "",
  status: process.env.STATUS || "",
  slot: process.env.SLOT || "",
  repeatCount: Number(process.env.REPEAT_COUNT || "0"),
  alertMode: process.env.ALERT_MODE || "",
  dryRun: process.env.DRY_RUN === "1",
};
process.stdout.write(JSON.stringify(payload));
' "$action" "$outcome" "$detail" >>"$LOG_FILE"
  printf '\n' >>"$LOG_FILE"
}

if [[ -z "$RECORD_JSON" ]]; then
  log_json "noop" "missing-record" "record_json_missing"
  exit 0
fi

export STATUS="$(node -e 'const record = JSON.parse(process.argv[1]); process.stdout.write(String(record.status || ""));' "$RECORD_JSON")"
export REASON="$(node -e 'const record = JSON.parse(process.argv[1]); process.stdout.write(String(record.reason || ""));' "$RECORD_JSON")"
export SLOT="$(node -e 'const record = JSON.parse(process.argv[1]); process.stdout.write(String(record.slot || ""));' "$RECORD_JSON")"
export REPEAT_COUNT="$(node -e 'const record = JSON.parse(process.argv[1]); process.stdout.write(String(Number(record.observerConsecutiveRepeatCount || 0)));' "$RECORD_JSON")"
export ALERT_MODE="$(node -e 'const record = JSON.parse(process.argv[1]); process.stdout.write(String(record.observerAlertMode || ""));' "$RECORD_JSON")"
export DRY_RUN

if [[ "$ENABLED" != "1" ]]; then
  log_json "noop" "disabled" "auto_recovery_disabled"
  exit 0
fi

if [[ "$STATUS" != "error" ]]; then
  log_json "noop" "non-error" "status_not_error"
  exit 0
fi

case "$REASON" in
  mission_control_not_ready|truth_strip_missing)
    ;;
  *)
    log_json "noop" "unsupported-reason" "$REASON"
    exit 0
    ;;
esac

if [[ "$ALERT_MODE" == "none" ]]; then
  log_json "noop" "no-alert-mode" "observer_alert_mode_none"
  exit 0
fi

if [[ "$REPEAT_COUNT" -lt "$MIN_REPEAT_COUNT" ]]; then
  log_json "noop" "below-threshold" "repeat_count_below_min"
  exit 0
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log_json "noop" "locked" "recovery_already_running"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

now_epoch="$(date +%s)"
last_action_epoch="0"
if [[ -f "$STATE_FILE" ]]; then
  last_action_epoch="$(node -e 'const fs = require("fs"); try { const raw = fs.readFileSync(process.argv[1], "utf8").trim(); if (!raw) { process.stdout.write("0"); process.exit(0); } const parsed = JSON.parse(raw); process.stdout.write(String(Number(parsed.lastActionEpoch || 0))); } catch { process.stdout.write("0"); }' "$STATE_FILE")"
fi

if [[ $((now_epoch - last_action_epoch)) -lt "$COOLDOWN_SEC" ]]; then
  log_json "noop" "cooldown" "cooldown_active"
  exit 0
fi

active_slot() {
  if [[ -f "$ACTIVE_SLOT_FILE" ]] && grep -q 'mission-control-ui-green:3002' "$ACTIVE_SLOT_FILE"; then
    printf 'green\n'
  else
    printf 'blue\n'
  fi
}

inactive_slot() {
  if [[ "$(active_slot)" == 'blue' ]]; then
    printf 'green\n'
  else
    printf 'blue\n'
  fi
}

container_health() {
  local slot="$1"
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "mission-control-ui-${slot}" 2>/dev/null | tr -d '\r\n'
}

write_state() {
  local action="$1"
  node -e '
const fs = require("fs");
const payload = {
  lastActionAt: new Date().toISOString(),
  lastActionEpoch: Number(process.argv[2]),
  lastAction: process.argv[3],
  lastReason: process.env.REASON || "",
  lastSlot: process.env.SLOT || "",
  lastRepeatCount: Number(process.env.REPEAT_COUNT || "0"),
};
fs.writeFileSync(process.argv[1], JSON.stringify(payload));
' "$STATE_FILE" "$now_epoch" "$action"
}

do_restart() {
  local slot="$1"
  local container="mission-control-ui-${slot}"
  if [[ "$DRY_RUN" == "1" ]]; then
    log_json "restart" "dry-run" "$container"
    write_state "restart-dry-run"
    return 0
  fi
  docker restart "$container" >/dev/null
  log_json "restart" "executed" "$container"
  write_state "restart"
}

do_rollback() {
  if [[ "$DRY_RUN" == "1" ]]; then
    log_json "rollback" "dry-run" "mission_control_blue_green.sh rollback"
    write_state "rollback-dry-run"
    return 0
  fi
  bash "$ROOT_DIR/scripts/mission_control_blue_green.sh" rollback >/dev/null
  log_json "rollback" "executed" "mission_control_blue_green.sh rollback"
  write_state "rollback"
}

current_active_slot="$(active_slot)"
current_inactive_slot="$(inactive_slot)"
inactive_health="$(container_health "$current_inactive_slot")"

if [[ "$REPEAT_COUNT" -ge "$ROLLBACK_REPEAT_COUNT" && "$SLOT" == "$current_active_slot" && "$inactive_health" == "healthy" ]]; then
  do_rollback
  exit 0
fi

do_restart "$SLOT"