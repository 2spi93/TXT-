#!/usr/bin/env bash
# Cron wrapper for observation-only market intelligence layers.
#
# Runs incrementally, read-only:
#   - reaction_speed_engine.py
#   - regime_engine.py
#   - edge_map_engine.py
#
# No DB writes. No opportunity gate / kill switch integration.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${OBS_CRON_LOG:-$ROOT_DIR/logs/observation-cron.log}"
LOCK="${OBS_CRON_LOCK:-/tmp/observation_cron.lock}"
CONTAINER="${OBS_CONTAINER:-control-plane}"
INSTRUMENT="${OBS_INSTRUMENT:-BTCUSDT}"
TIMEFRAME="${OBS_TIMEFRAME:-1m}"
INITIAL_LOOKBACK_HOURS="${OBS_INITIAL_LOOKBACK_HOURS:-24}"
EDGE_MIN_COUNT="${OBS_EDGE_MIN_COUNT:-5}"
REACTION_OUTPUT="${OBS_REACTION_OUTPUT:-$ROOT_DIR/logs/reaction_speed_engine.jsonl}"
REGIME_OUTPUT="${OBS_REGIME_OUTPUT:-$ROOT_DIR/logs/regime_engine.jsonl}"
VENUES=( ${OBS_VENUES:-binance-public coinbase-public} )

mkdir -p "$(dirname "$LOG")"

ts() { date -u +%FT%TZ; }
log() { printf '[%s] %s\n' "$(ts)" "$*" >> "$LOG"; }

exec 9>"$LOCK"
if ! flock -n 9; then
  log "skip: previous run still active"
  exit 0
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  log "skip: container '$CONTAINER' is not running"
  exit 0
fi

timeframe_to_sec() {
  case "$1" in
    30s) echo 30 ;;
    1m) echo 60 ;;
    5m) echo 300 ;;
    1h) echo 3600 ;;
    *) echo 60 ;;
  esac
}

iso_shift() {
  python3 - "$1" "$2" <<'PY'
from datetime import datetime, timedelta, timezone
import sys

value = sys.argv[1]
delta_seconds = float(sys.argv[2])
if value.endswith('Z'):
    value = value[:-1] + '+00:00'
dt = datetime.fromisoformat(value)
if dt.tzinfo is None:
    dt = dt.replace(tzinfo=timezone.utc)
dt = dt + timedelta(seconds=delta_seconds)
print(dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'))
PY
}

default_since() {
  date -u -d "$INITIAL_LOOKBACK_HOURS hours ago" +%FT%TZ 2>/dev/null || date -u +%FT%TZ
}

last_jsonl_ts() {
  python3 - "$@" <<'PY'
from datetime import datetime
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
time_field = sys.argv[2]
venue = sys.argv[3]
instrument = sys.argv[4]
timeframe_sec = sys.argv[5] if len(sys.argv) > 5 else ''
if not path.exists():
    raise SystemExit(0)
last = None
with path.open('r', encoding='utf-8') as fh:
    for line in fh:
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get('venue') != venue or row.get('instrument') != instrument:
            continue
        if timeframe_sec and str(row.get('timeframe_sec')) != timeframe_sec:
            continue
        ts = row.get(time_field)
        if ts:
            last = ts
print(last or '')
PY
}

run_and_log() {
  local label="$1"
  shift
  log "begin $label :: $*"
  docker exec -i "$CONTAINER" "$@" 2>&1 | while IFS= read -r line; do
    log "$label :: $line"
  done
  local rc=${PIPESTATUS[0]}
  log "end $label rc=$rc"
  return "$rc"
}

run_until="$(ts)"
timeframe_sec="$(timeframe_to_sec "$TIMEFRAME")"
regime_context_sec="$(( timeframe_sec * 60 ))"

log "begin observation run_until=$run_until instrument=$INSTRUMENT timeframe=$TIMEFRAME venues=${VENUES[*]}"

for venue in "${VENUES[@]}"; do
  reaction_last="$(last_jsonl_ts "$REACTION_OUTPUT" event_time "$venue" "$INSTRUMENT")"
  if [[ -n "$reaction_last" ]]; then
    reaction_since="$(iso_shift "$reaction_last" -15)"
    reaction_emit_since="$(iso_shift "$reaction_last" 0.000001)"
  else
    reaction_since="$(default_since)"
    reaction_emit_since=""
  fi

  reaction_cmd=(python3 /workspace/scripts/reaction_speed_engine.py --venue "$venue" --instrument "$INSTRUMENT" --since "$reaction_since" --until "$run_until")
  if [[ -n "$reaction_emit_since" ]]; then
    reaction_cmd+=(--emit-since "$reaction_emit_since")
  fi
  run_and_log "reaction:$venue" "${reaction_cmd[@]}"

  regime_last="$(last_jsonl_ts "$REGIME_OUTPUT" window_end "$venue" "$INSTRUMENT" "$timeframe_sec")"
  if [[ -n "$regime_last" ]]; then
    regime_since="$(iso_shift "$regime_last" "-$regime_context_sec")"
    regime_emit_since="$(iso_shift "$regime_last" 0.000001)"
  else
    regime_since="$(default_since)"
    regime_emit_since=""
  fi

  regime_cmd=(python3 /workspace/scripts/regime_engine.py --venue "$venue" --instrument "$INSTRUMENT" --timeframe "$TIMEFRAME" --since "$regime_since" --until "$run_until")
  if [[ -n "$regime_emit_since" ]]; then
    regime_cmd+=(--emit-since "$regime_emit_since")
  fi
  run_and_log "regime:$venue" "${regime_cmd[@]}"
done

run_and_log "edge-map" python3 /workspace/scripts/edge_map_engine.py --min-count "$EDGE_MIN_COUNT"
log "end observation"