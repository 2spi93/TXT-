#!/usr/bin/env bash
set -euo pipefail

BRIDGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_ROOT="/opt/hermes/data/home/mwc-live-staging/opt/txt/sites/mwc"
LIVE_ROOT="/opt/txt/sites/mwc"
REQUEST_FILE="$BRIDGE_ROOT/deploy-request.latest.txt"

pick_writable_dir() {
  local candidate
  for candidate in "$@"; do
    mkdir -p "$candidate" 2>/dev/null || true
    if [ -d "$candidate" ] && [ -w "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

LOG_DIR="$(pick_writable_dir "$BRIDGE_ROOT/logs-hermes" "/opt/hermes/data/home/mwc-live-staging/logs-hermes")"
LOG_FILE="$LOG_DIR/auto_publish_cron.log"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

STATE_DIR="$(pick_writable_dir "$BRIDGE_ROOT/.autopublish-hermes" "/opt/hermes/data/home/mwc-live-staging/.autopublish-hermes")"
HASH_FILE="$STATE_DIR/last_published_tree.sha256"
LOCK_FILE="$STATE_DIR/auto_publish.lock"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Publish already running; exiting."
  exit 0
fi

compute_hash() {
  (
    cd "$BRIDGE_ROOT"
    find . \
      -path './logs' -prune -o \
      -path './logs-hermes' -prune -o \
      -path './backups' -prune -o \
      -path './.autopublish' -prune -o \
      -path './.autopublish-hermes' -prune -o \
      -path './.deploy-request' -prune -o \
      -name 'deploy-request.latest.txt' -prune -o \
      -type f -print0 |
    sort -z |
    xargs -0 sha256sum | sha256sum | awk '{print $1}'
  )
}

CURRENT_HASH="$(compute_hash)"
LAST_HASH=""
if [ -f "$HASH_FILE" ]; then
  LAST_HASH="$(cat "$HASH_FILE")"
fi

if [ "$CURRENT_HASH" = "$LAST_HASH" ]; then
  log "No publish needed; bridge tree unchanged."
  exit 0
fi

sync_tree() {
  local src="$1"
  local dest="$2"
  python3 - "$src" "$dest" <<'PY'
from pathlib import Path
import shutil
import sys

src = Path(sys.argv[1])
dest = Path(sys.argv[2])
exclude = {'logs', 'logs-hermes', 'backups', '.autopublish', '.autopublish-hermes', '.deploy-request', 'deploy-request.latest.txt'}

dest.mkdir(parents=True, exist_ok=True)
for child in src.iterdir():
    if child.name in exclude:
        continue
    target = dest / child.name
    if child.is_dir():
        if target.exists() and not target.is_dir():
            target.unlink()
        shutil.copytree(child, target, dirs_exist_ok=True)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(child, target)
PY
}

if [ -d "$STAGING_ROOT" ] && [ -w "$STAGING_ROOT" ]; then
  sync_tree "$BRIDGE_ROOT" "$STAGING_ROOT"
  log "Synced bridge -> staging: $STAGING_ROOT"
else
  log "Staging root unavailable or not writable: $STAGING_ROOT"
fi

if [ -d "$LIVE_ROOT" ] && [ -w "$LIVE_ROOT" ]; then
  sync_tree "$BRIDGE_ROOT" "$LIVE_ROOT"
  log "Synced bridge -> live: $LIVE_ROOT"
else
  log "Live root unavailable or not writable from this session: $LIVE_ROOT"
fi

cat > "$REQUEST_FILE" <<EOF
requested_at=$(date --iso-8601=seconds)
requested_from=telegram-hermes
bridge_root=$BRIDGE_ROOT
staging_root=$STAGING_ROOT
live_root=$LIVE_ROOT
bridge_tree_hash=$CURRENT_HASH
log_file=$LOG_FILE
note=copy updated to staging; live publish still requires a session with /opt/txt write access when unavailable locally
EOF

printf '%s\n' "$CURRENT_HASH" > "$HASH_FILE"
log "Publish workflow recorded with hash $CURRENT_HASH"
