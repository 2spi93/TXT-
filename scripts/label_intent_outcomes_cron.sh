#!/usr/bin/env bash
# Cron wrapper around scripts/label_intent_outcomes.py.
#
# Read-only against the DB; appends to logs/intent_outcome_labels.jsonl
# only. Holds a flock to prevent overlap. Defaults are conservative:
#   - --since   : last 7 days (configurable via LABELER_SINCE)
#   - --limit   : 500 (configurable via LABELER_LIMIT)
#   - --use-proxy-pairs always on (records proxy_used flag per row)
#
# Output is appended to logs/intent_outcome_labels-cron.log. Overlapping
# runs return immediately with exit 0.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${LABELER_CRON_LOG:-$ROOT_DIR/logs/intent_outcome_labels-cron.log}"
LOCK="${LABELER_CRON_LOCK:-/tmp/label_intent_outcomes.lock}"
SINCE_DEFAULT="$(date -u -d '7 days ago' +%FT%TZ 2>/dev/null || date -u +%FT%TZ)"
SINCE="${LABELER_SINCE:-$SINCE_DEFAULT}"
LIMIT="${LABELER_LIMIT:-500}"
CONTAINER="${LABELER_CONTAINER:-control-plane}"

mkdir -p "$(dirname "$LOG")"

ts() { date -u +%FT%TZ; }
log() { printf '[%s] %s\n' "$(ts)" "$*" >> "$LOG"; }

# Non-blocking flock; if a previous run is still in progress, exit cleanly.
exec 9>"$LOCK"
if ! flock -n 9; then
  log "skip: previous run still active"
  exit 0
fi

log "begin since=$SINCE limit=$LIMIT container=$CONTAINER"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  log "skip: container '$CONTAINER' is not running"
  exit 0
fi

# Run labeler inside the container; capture stderr line-by-line.
docker exec -i "$CONTAINER" python3 /workspace/scripts/label_intent_outcomes.py \
  --since "$SINCE" \
  --limit "$LIMIT" \
  --use-proxy-pairs 2>&1 | while IFS= read -r line; do
    printf '[%s] %s\n' "$(ts)" "$line" >> "$LOG"
done

rc=${PIPESTATUS[0]}
log "end rc=$rc"
exit 0
