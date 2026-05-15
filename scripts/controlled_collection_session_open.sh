#!/usr/bin/env bash
# Open a controlled-collection watcher session with the current UTC baseline.
#
# Stdout stays compact and tmux-friendly.
# Raw snapshots are archived to logs/controlled_collection_watch.jsonl.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${CONTROLLED_COLLECTION_CONTAINER:-control-plane}"
ARCHIVE="${CONTROLLED_COLLECTION_ARCHIVE:-/workspace/logs/controlled_collection_watch.jsonl}"
STATE_FILE="${CONTROLLED_COLLECTION_STATE_FILE:-$ROOT_DIR/logs/controlled_collection_session_state.json}"
BASELINE="$(date -u +%FT%TZ)"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "[session-open] container '$CONTAINER' is not running" >&2
  exit 2
fi

mkdir -p "$(dirname "$STATE_FILE")"
cat > "$STATE_FILE" <<EOF
{"baseline_since":"$BASELINE","opened_at":"$BASELINE","archive":"$ARCHIVE","container":"$CONTAINER","status":"open"}
EOF

echo "[session-open] baseline=$BASELINE archive=$ARCHIVE container=$CONTAINER" >&2

exec docker exec -i "$CONTAINER" python3 /workspace/scripts/controlled_collection_watch.py \
  --since "$BASELINE" \
  --compact \
  --jsonl-output "$ARCHIVE" \
  "$@"