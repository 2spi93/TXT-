#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
UI_DIR="$ROOT_DIR/ui/mission-control"
ACTIVE_SLOT_FILE="$ROOT_DIR/data/mission-control/ui-active-slot.conf"
COMPOSE=(docker compose -f "$ROOT_DIR/docker-compose.yml")

slot_port() {
  case "$1" in
    blue) printf '3001\n' ;;
    green) printf '3002\n' ;;
    *) return 1 ;;
  esac
}

slot_dist_dir() {
  printf '.next-runtime-%s\n' "$1"
}

slot_service() {
  printf 'mission-control-ui-%s\n' "$1"
}

prepare_slot_dist_dir() {
  local dist_dir="$1"
  mkdir -p "$UI_DIR/$dist_dir/server" "$UI_DIR/$dist_dir/static"
}

ensure_active_slot_file() {
  mkdir -p "$(dirname "$ACTIVE_SLOT_FILE")"
  if [[ ! -f "$ACTIVE_SLOT_FILE" ]]; then
    write_active_slot blue
  fi
}

write_active_slot() {
  local slot="$1"
  local port
  local tmp_file
  port="$(slot_port "$slot")"
  tmp_file="${ACTIVE_SLOT_FILE}.tmp"
  cat >"$tmp_file" <<EOF
set \$upstream_ui http://mission-control-ui-${slot}:${port};
EOF
  mv "$tmp_file" "$ACTIVE_SLOT_FILE"
}

active_slot() {
  ensure_active_slot_file
  if grep -q 'mission-control-ui-green:3002' "$ACTIVE_SLOT_FILE"; then
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
  local status
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$(slot_service "$1")" 2>/dev/null || true)"
  status="$(printf '%s' "$status" | tr -d '\r\n')"
  printf '%s\n' "${status:-missing}"
}

wait_for_healthy() {
  local slot="$1"
  local deadline=$((SECONDS + 180))
  local status='missing'
  while (( SECONDS < deadline )); do
    status="$(container_health "$slot")"
    if [[ "$status" == 'healthy' || "$status" == 'running' ]]; then
      return 0
    fi
    sleep 2
  done
  printf '[blue-green] slot %s did not become healthy, last status=%s\n' "$slot" "$status" >&2
  return 1
}

reload_gateway() {
  docker exec mission-control-gateway nginx -s reload >/dev/null
}

status_cmd() {
  local active inactive
  active="$(active_slot)"
  inactive="$(inactive_slot)"
  printf 'active=%s inactive=%s\n' "$active" "$inactive"
  printf 'slot_file=%s\n' "$ACTIVE_SLOT_FILE"
  printf 'blue=%s\n' "$(container_health blue)"
  printf 'green=%s\n' "$(container_health green)"
}

deploy_cmd() {
  local slot="${1:-$(inactive_slot)}"
  local port dist_dir service active inactive
  active="$(active_slot)"
  inactive="$(inactive_slot)"
  if [[ "$slot" == "$active" && "${ALLOW_ACTIVE_SLOT_DEPLOY:-0}" != '1' ]]; then
    printf '[blue-green] refusing to deploy active slot=%s; deploy standby slot=%s then flip, or set ALLOW_ACTIVE_SLOT_DEPLOY=1 for an emergency in-place rebuild\n' "$slot" "$inactive" >&2
    return 1
  fi
  port="$(slot_port "$slot")"
  dist_dir="$(slot_dist_dir "$slot")"
  service="$(slot_service "$slot")"

  printf '[blue-green] building slot=%s dist=%s port=%s\n' "$slot" "$dist_dir" "$port"
  (
    cd "$UI_DIR"
    rm -rf "$dist_dir"
    prepare_slot_dist_dir "$dist_dir"
    NEXT_DIST_DIR="$dist_dir" PORT="$port" npm run build
  )

  printf '[blue-green] starting %s\n' "$service"
  "${COMPOSE[@]}" up -d --no-deps "$service"
  wait_for_healthy "$slot"
  printf '[blue-green] slot %s is healthy\n' "$slot"
}

flip_cmd() {
  local slot="${1:-$(inactive_slot)}"
  wait_for_healthy "$slot"
  write_active_slot "$slot"
  reload_gateway
  printf '[blue-green] active slot switched to %s\n' "$slot"
}

promote_cmd() {
  local slot="${1:-$(inactive_slot)}"
  deploy_cmd "$slot"
  flip_cmd "$slot"
}

rollback_cmd() {
  flip_cmd "$(inactive_slot)"
}

usage() {
  cat <<'EOF'
Usage: scripts/mission_control_blue_green.sh <command> [slot]

Commands:
  status             Show active/inactive slot and health
  deploy [slot]      Build and start the target slot, defaulting to inactive
  flip [slot]        Flip gateway upstream to the target healthy slot
  promote [slot]     Deploy inactive slot, wait health, then flip
  rollback           Flip back to the other slot immediately

Notes:
  deploy refuses the active slot unless ALLOW_ACTIVE_SLOT_DEPLOY=1 is set.
EOF
}

command="${1:-status}"
case "$command" in
  status)
    status_cmd
    ;;
  deploy)
    deploy_cmd "${2:-}"
    ;;
  flip)
    flip_cmd "${2:-}"
    ;;
  promote)
    promote_cmd "${2:-}"
    ;;
  rollback)
    rollback_cmd
    ;;
  *)
    usage
    exit 1
    ;;
esac