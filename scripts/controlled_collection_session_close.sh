#!/usr/bin/env bash
# Close the current controlled-collection session and print a summary.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_FILE="${CONTROLLED_COLLECTION_STATE_FILE:-$ROOT_DIR/logs/controlled_collection_session_state.json}"
ARCHIVE="${CONTROLLED_COLLECTION_ARCHIVE_HOST:-$ROOT_DIR/logs/controlled_collection_watch.jsonl}"
SUMMARY_LOG="${CONTROLLED_COLLECTION_SUMMARY_LOG:-$ROOT_DIR/logs/controlled_collection_session_summary.jsonl}"

if [[ ! -f "$ARCHIVE" ]]; then
  echo "[session-close] archive not found: $ARCHIVE" >&2
  exit 2
fi

summary_json="$(python3 "$ROOT_DIR/scripts/controlled_collection_session_summary.py" --archive "$ARCHIVE" --state "$STATE_FILE" | python3 -c 'import json,sys; payload=json.load(sys.stdin); payload["active"]=False; print(json.dumps(payload))')"
mkdir -p "$(dirname "$SUMMARY_LOG")"
printf '%s\n' "$summary_json" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin), sort_keys=True))' >> "$SUMMARY_LOG"

printf '%s\n' "$summary_json"

if [[ -f "$STATE_FILE" ]]; then
  rm -f "$STATE_FILE"
fi

echo "[session-close] summary appended to $SUMMARY_LOG and state cleared" >&2