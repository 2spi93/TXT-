#!/usr/bin/env bash
# Install / refresh the cron entry for the outcome labeler.
#
# Default schedule: every 10 minutes. Override with CRON_SCHEDULE env var.
#   CRON_SCHEDULE='*/30 * * * *' ./scripts/install-intent-outcome-labeler-cron.sh
#
# Idempotent: removes any existing entry tagged
# "# mission-control-intent-outcome-labeler" before re-adding.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/scripts/label_intent_outcomes_cron.sh"
CRON_SCHEDULE="${CRON_SCHEDULE:-*/10 * * * *}"
CRON_LOG="${CRON_LOG:-$ROOT_DIR/logs/intent_outcome_labels-cron.log}"
CRON_TAG="# mission-control-intent-outcome-labeler"

if [[ ! -x "$SCRIPT_PATH" ]]; then
  echo "[install] making $SCRIPT_PATH executable"
  chmod +x "$SCRIPT_PATH"
fi

mkdir -p "$(dirname "$CRON_LOG")"

line="$CRON_SCHEDULE cd $ROOT_DIR && $SCRIPT_PATH >> $CRON_LOG 2>&1 $CRON_TAG"

tmpfile="$(mktemp)"
crontab -l 2>/dev/null | grep -v "$CRON_TAG" > "$tmpfile" || true
echo "$line" >> "$tmpfile"
crontab "$tmpfile"
rm -f "$tmpfile"

echo "[ok] cron installed"
echo "[ok] schedule: $CRON_SCHEDULE"
echo "[ok] script:   $SCRIPT_PATH"
echo "[ok] log:      $CRON_LOG"
