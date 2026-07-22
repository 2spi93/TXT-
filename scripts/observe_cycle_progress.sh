#!/usr/bin/env bash
# Read-only cycle/trade accumulation snapshot.
# Calls only GET endpoints. No state mutation.
#
# Usage: observe_cycle_progress.sh [BASE_URL]
#   BASE_URL defaults to http://127.0.0.1:8000 (control-plane host loopback).
set -u
BASE="${1:-${CONTROL_PLANE_URL:-http://127.0.0.1:8000}}"
# Strip trailing slash
BASE="${BASE%/}"

have_jq=0
if command -v jq >/dev/null 2>&1; then have_jq=1; fi

fetch() {
  local path="$1"
  local out
  out="$(curl -sS --max-time 8 -H 'Accept: application/json' "${BASE}${path}" 2>/dev/null || true)"
  if [[ -z "$out" ]]; then
    echo "  (no response from ${path})"
    return
  fi
  if [[ $have_jq -eq 1 ]]; then
    echo "$out" | jq . 2>/dev/null || echo "$out"
  else
    echo "$out"
  fi
}

echo "=== cycle / trade progress snapshot (read-only) ==="
echo "base : ${BASE}"
echo "time : $(date -u +%FT%TZ)"
echo

echo "-- /v1/ai/kairos/shadow/status --"
fetch "/v1/ai/kairos/shadow/status"
echo

echo "-- /v1/system/improvement-deployments/governor --"
fetch "/v1/system/improvement-deployments/governor"
echo

echo "-- /v1/system/improvement-deployments/monitor --"
fetch "/v1/system/improvement-deployments/monitor"
echo

echo "-- /v1/system/opportunity-gate --"
fetch "/v1/system/opportunity-gate"
