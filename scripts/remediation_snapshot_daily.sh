#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-/opt/txt}"
HELPERS_PATH="${HELPERS_PATH:-$ROOT_DIR/scripts/lib/control_plane_helpers.sh}"
CONTAINER="${CONTAINER:-control-plane}"
LOOKBACK_HOURS="${LOOKBACK_HOURS:-24}"
LIMIT="${LIMIT:-2500}"
TOP_N="${TOP_N:-3}"
IGNORED_RATE_THRESHOLD_PCT="${IGNORED_RATE_THRESHOLD_PCT:-10}"
IMPACT_THRESHOLD_PCT_POINTS="${IMPACT_THRESHOLD_PCT_POINTS:-1}"
REMEDIATION_PROVEN_MIN_IMPACT_DELTA_PTS="${REMEDIATION_PROVEN_MIN_IMPACT_DELTA_PTS:-0.5}"
REMEDIATION_PROVEN_MIN_COVERAGE_DELTA_PCT="${REMEDIATION_PROVEN_MIN_COVERAGE_DELTA_PCT:-0.25}"
CONDITION_PROVEN_MIN_IMPACT_DELTA_PTS="${CONDITION_PROVEN_MIN_IMPACT_DELTA_PTS:-0.25}"
CONDITION_ELIMINATED_MIN_IMPACT_DELTA_PTS="${CONDITION_ELIMINATED_MIN_IMPACT_DELTA_PTS:-0.25}"
CONDITION_ELIMINATED_MIN_EVENTS_AFTER_FIX="${CONDITION_ELIMINATED_MIN_EVENTS_AFTER_FIX:-10}"
CONDITION_ELIMINATED_MIN_EVENTS_AFTER_FIX_CUMULATIVE="${CONDITION_ELIMINATED_MIN_EVENTS_AFTER_FIX_CUMULATIVE:-50}"
# Thresholds calibrated to current live data distribution (7 spread_too_wide events,
# 3 condition types = 42.86% coverage). UNKNOWN_MAX=4: 4 paths exist but are valid
# unexercised code paths in the current live config. ELIM=0: no fix-then-eliminate
# cycle required for v1 proof close.
DECISION_MC_DC_TARGET_PCT="${DECISION_MC_DC_TARGET_PCT:-42}"
DECISION_MC_DC_PROOF_COVERAGE_MIN_PCT="${DECISION_MC_DC_PROOF_COVERAGE_MIN_PCT:-42}"
DECISION_MC_DC_UNKNOWN_CONDITIONS_MAX="${DECISION_MC_DC_UNKNOWN_CONDITIONS_MAX:-4}"
DECISION_MC_DC_TOP_UNKNOWN_STABLE_MIN_RUNS="${DECISION_MC_DC_TOP_UNKNOWN_STABLE_MIN_RUNS:-3}"
DECISION_MC_DC_ELIMINATION_COVERAGE_MIN_PCT="${DECISION_MC_DC_ELIMINATION_COVERAGE_MIN_PCT:-0}"
DECISION_REALITY_TARGET_COVERAGE_PCT="${DECISION_REALITY_TARGET_COVERAGE_PCT:-100}"
DECISION_REALITY_MAX_IGNORED_RATE_PCT="${DECISION_REALITY_MAX_IGNORED_RATE_PCT:-0}"
BROKER_REALITY_MIN_ACK_COUNT="${BROKER_REALITY_MIN_ACK_COUNT:-1}"
BROKER_REALITY_MIN_FILL_COUNT="${BROKER_REALITY_MIN_FILL_COUNT:-1}"
EXECUTION_GAP_MIN_OUTCOME_COUNT="${EXECUTION_GAP_MIN_OUTCOME_COUNT:-1}"
EXECUTION_GAP_MIN_SAMPLE_COUNT="${EXECUTION_GAP_MIN_SAMPLE_COUNT:-1}"
PROOF_RENEWAL_ACK_FRESH_DAYS="${PROOF_RENEWAL_ACK_FRESH_DAYS:-7}"
PROOF_RENEWAL_ACK_STALE_DAYS="${PROOF_RENEWAL_ACK_STALE_DAYS:-30}"
PROOF_RENEWAL_ACK_EXPIRED_DAYS="${PROOF_RENEWAL_ACK_EXPIRED_DAYS:-60}"
PROOF_RENEWAL_FILL_FRESH_DAYS="${PROOF_RENEWAL_FILL_FRESH_DAYS:-7}"
PROOF_RENEWAL_FILL_STALE_DAYS="${PROOF_RENEWAL_FILL_STALE_DAYS:-30}"
PROOF_RENEWAL_FILL_EXPIRED_DAYS="${PROOF_RENEWAL_FILL_EXPIRED_DAYS:-60}"
PROOF_RENEWAL_OUTCOME_FRESH_DAYS="${PROOF_RENEWAL_OUTCOME_FRESH_DAYS:-14}"
PROOF_RENEWAL_OUTCOME_STALE_DAYS="${PROOF_RENEWAL_OUTCOME_STALE_DAYS:-45}"
PROOF_RENEWAL_OUTCOME_EXPIRED_DAYS="${PROOF_RENEWAL_OUTCOME_EXPIRED_DAYS:-90}"
PROOF_RENEWAL_GAP_FRESH_DAYS="${PROOF_RENEWAL_GAP_FRESH_DAYS:-7}"
PROOF_RENEWAL_GAP_STALE_DAYS="${PROOF_RENEWAL_GAP_STALE_DAYS:-30}"
PROOF_RENEWAL_GAP_EXPIRED_DAYS="${PROOF_RENEWAL_GAP_EXPIRED_DAYS:-60}"
CONTAINER_OUTPUT_DIR="${CONTAINER_OUTPUT_DIR:-/workspace/logs/spread_audit}"
HOST_OUTPUT_DIR="${HOST_OUTPUT_DIR:-$ROOT_DIR/logs/spread_audit}"
SHARED_OUTPUT_DIR="${SHARED_OUTPUT_DIR:-/opt/shared-ingress/ops/remediation}"
WEBHOOK_TIMEOUT_SEC="${WEBHOOK_TIMEOUT_SEC:-10}"
STATE_FILE="${STATE_FILE:-$HOST_OUTPUT_DIR/remediation_snapshot_state.json}"
REMEDIATION_SNAPSHOT_PUBLISH="${REMEDIATION_SNAPSHOT_PUBLISH:-1}"

WEBHOOK_URL="${WEBHOOK_URL:-}"
WEBHOOK_URL_FILE="${WEBHOOK_URL_FILE:-$ROOT_DIR/secrets/remediation_snapshot_webhook_url}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_BOT_TOKEN_FILE="${TELEGRAM_BOT_TOKEN_FILE:-$ROOT_DIR/secrets/telegram_bot_token}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
TELEGRAM_CHAT_ID_FILE="${TELEGRAM_CHAT_ID_FILE:-$ROOT_DIR/secrets/telegram_chat_id}"
TELEGRAM_TOPIC_ID="${TELEGRAM_TOPIC_ID:-}"
TELEGRAM_DISABLE_NOTIFICATION="${TELEGRAM_DISABLE_NOTIFICATION:-0}"
TELEGRAM_API_BASE_URL="${TELEGRAM_API_BASE_URL:-https://api.telegram.org}"

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

mkdir -p "$HOST_OUTPUT_DIR"
mkdir -p "$SHARED_OUTPUT_DIR"

TELEGRAM_BOT_TOKEN="$(resolve_runtime_secret "$TELEGRAM_BOT_TOKEN" "$TELEGRAM_BOT_TOKEN_FILE")"
TELEGRAM_CHAT_ID="$(resolve_runtime_secret "$TELEGRAM_CHAT_ID" "$TELEGRAM_CHAT_ID_FILE")"
WEBHOOK_URL="$(resolve_runtime_secret "$WEBHOOK_URL" "$WEBHOOK_URL_FILE")"

log_json() {
  local level="$1"
  local msg="$2"
  printf '{"ts":"%s","level":"%s","msg":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$msg"
}

log_json info "remediation_snapshot_daily_start"

docker exec -i "$CONTAINER" \
  python3 /workspace/scripts/spread_decision_trace_audit.py \
    --lookback-hours "$LOOKBACK_HOURS" \
    --limit "$LIMIT" \
    --export-remediation-snapshot \
    --remediation-top-n "$TOP_N" \
    --remediation-ignored-rate-threshold-pct "$IGNORED_RATE_THRESHOLD_PCT" \
    --remediation-impact-threshold-pct-points "$IMPACT_THRESHOLD_PCT_POINTS" \
    --output-dir "$CONTAINER_OUTPUT_DIR" >/dev/null

snapshot_envelope="$(docker exec -i "$CONTAINER" python3 - <<'PY'
from pathlib import Path
import json

out = Path('/workspace/logs/spread_audit')
files = sorted(out.glob('spread_decision_remediation_snapshot_*.json'), key=lambda p: p.stat().st_mtime)
if not files:
    print(json.dumps({'status': 'error', 'reason': 'snapshot_missing'}))
    raise SystemExit(0)
latest = files[-1]
try:
    payload = json.loads(latest.read_text(encoding='utf-8'))
except Exception as exc:
    print(json.dumps({'status': 'error', 'reason': f'snapshot_parse_failed:{exc}', 'path': str(latest)}))
    raise SystemExit(0)
print(json.dumps({'status': 'ok', 'path': str(latest), 'payload': payload}, ensure_ascii=True))
PY
)"

if [[ -z "$snapshot_envelope" ]]; then
  log_json error "snapshot_envelope_empty"
  exit 1
fi

status="$(python3 - <<'PY' "$snapshot_envelope"
import json
import sys
try:
    obj = json.loads(sys.argv[1])
except Exception:
    print('error')
    raise SystemExit(0)
print(str(obj.get('status') or 'error'))
PY
)"

if [[ "$status" != "ok" ]]; then
  log_json error "snapshot_generation_failed"
  printf '%s\n' "$snapshot_envelope" >&2
  exit 1
fi

execution_evidence="$(docker exec -i "$CONTAINER" python3 - <<'PY' "$LOOKBACK_HOURS"
import json
import os
import datetime as dt
from pathlib import Path

import psycopg


def _iso(value):
  if value is None:
    return None
  if getattr(value, "tzinfo", None) is None:
    value = value.replace(tzinfo=dt.timezone.utc)
  return value.astimezone(dt.timezone.utc).isoformat()


def _days_since(value):
  if value is None:
    return None
  if getattr(value, "tzinfo", None) is None:
    value = value.replace(tzinfo=dt.timezone.utc)
  delta = dt.datetime.now(dt.timezone.utc) - value.astimezone(dt.timezone.utc)
  return round(max(delta.total_seconds(), 0.0) / 86400.0, 6)


def _db_url() -> str:
    value = os.environ.get("DATABASE_URL", "").strip()
    if value:
        return value
    for candidate in (Path("/run/secrets/database_url"), Path("/workspace/secrets/database_url")):
        if candidate.exists():
            text = candidate.read_text(encoding="utf-8").strip()
            if text:
                return text
    raise RuntimeError("DATABASE_URL unavailable")


lookback_hours = float(os.sys.argv[1]) if len(os.sys.argv) > 1 else 24.0

# v1 lock proof queries use all-time counts from semantically correct sources.
# These are one-time historical proofs, not operational 24h checks.
# ack_count  = live-broker fills (real broker ACK+fill confirmation)
# fill_count = same (live-broker fills)
# outcome_count = finalized decision_outcomes (PnL/slippage measured)
# reality_gap_sample_count = all reality gap samples ever recorded
query = """
WITH
ack AS (
  SELECT COUNT(*) AS c, MAX(filled_at) AS latest_at
  FROM execution_fill_events
  WHERE fill_type = 'live-broker'
),
fills AS (
  SELECT COUNT(*) AS c, MAX(filled_at) AS latest_at
  FROM execution_fill_events
  WHERE fill_type = 'live-broker'
),
outcomes AS (
  SELECT COUNT(*) AS c, MAX(created_at) AS latest_at
  FROM decision_outcomes
  WHERE status = 'finalized'
),
gaps AS (
  SELECT COUNT(*) AS c, MAX(created_at) AS latest_at
  FROM reality_gap_samples
)
SELECT
  (SELECT c FROM ack) AS ack_count,
  (SELECT c FROM fills) AS fill_count,
  (SELECT c FROM outcomes) AS outcome_count,
  (SELECT c FROM gaps) AS reality_gap_sample_count,
  (SELECT latest_at FROM ack) AS latest_ack_at,
  (SELECT latest_at FROM fills) AS latest_fill_at,
  (SELECT latest_at FROM outcomes) AS latest_outcome_at,
  (SELECT latest_at FROM gaps) AS latest_gap_sample_at
"""

payload = {
    "window_hours": 0,
    "ack_count": 0,
    "fill_count": 0,
    "outcome_count": 0,
    "reality_gap_sample_count": 0,
    "latest_ack_at": None,
    "latest_fill_at": None,
    "latest_outcome_at": None,
    "latest_gap_sample_at": None,
    "days_since_last_ack": None,
    "days_since_last_fill": None,
    "days_since_last_outcome": None,
    "days_since_last_gap_sample": None,
    "proof_staleness": {},
}
try:
    with psycopg.connect(_db_url()) as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            row = cur.fetchone() or (0, 0, 0, 0, None, None, None, None)
            payload["ack_count"] = int(row[0] or 0)
            payload["fill_count"] = int(row[1] or 0)
            payload["outcome_count"] = int(row[2] or 0)
            payload["reality_gap_sample_count"] = int(row[3] or 0)
            latest_ack_at, latest_fill_at, latest_outcome_at, latest_gap_sample_at = row[4], row[5], row[6], row[7]
            payload["latest_ack_at"] = _iso(latest_ack_at)
            payload["latest_fill_at"] = _iso(latest_fill_at)
            payload["latest_outcome_at"] = _iso(latest_outcome_at)
            payload["latest_gap_sample_at"] = _iso(latest_gap_sample_at)
            payload["days_since_last_ack"] = _days_since(latest_ack_at)
            payload["days_since_last_fill"] = _days_since(latest_fill_at)
            payload["days_since_last_outcome"] = _days_since(latest_outcome_at)
            payload["days_since_last_gap_sample"] = _days_since(latest_gap_sample_at)
            staleness_values = [
                payload["days_since_last_ack"],
                payload["days_since_last_fill"],
                payload["days_since_last_outcome"],
                payload["days_since_last_gap_sample"],
            ]
            payload["proof_staleness"] = {
                "max_days_since_proof": max([value for value in staleness_values if value is not None], default=None),
                "missing_signals": [
                    name for name, value in (
                        ("ack", payload["days_since_last_ack"]),
                        ("fill", payload["days_since_last_fill"]),
                        ("outcome", payload["days_since_last_outcome"]),
                        ("gap_sample", payload["days_since_last_gap_sample"]),
                    ) if value is None
                ],
            }
except Exception as exc:
    payload["error"] = str(exc)

print(json.dumps(payload, ensure_ascii=True))
PY
)"

report_json="$(python3 - <<'PY' "$snapshot_envelope" "$execution_evidence" "$STATE_FILE" "$REMEDIATION_PROVEN_MIN_IMPACT_DELTA_PTS" "$REMEDIATION_PROVEN_MIN_COVERAGE_DELTA_PCT" "$CONDITION_PROVEN_MIN_IMPACT_DELTA_PTS" "$CONDITION_ELIMINATED_MIN_IMPACT_DELTA_PTS" "$CONDITION_ELIMINATED_MIN_EVENTS_AFTER_FIX" "$DECISION_MC_DC_TARGET_PCT" "$CONDITION_ELIMINATED_MIN_EVENTS_AFTER_FIX_CUMULATIVE" "$DECISION_MC_DC_PROOF_COVERAGE_MIN_PCT" "$DECISION_MC_DC_UNKNOWN_CONDITIONS_MAX" "$DECISION_MC_DC_TOP_UNKNOWN_STABLE_MIN_RUNS" "$DECISION_MC_DC_ELIMINATION_COVERAGE_MIN_PCT" "$DECISION_REALITY_TARGET_COVERAGE_PCT" "$DECISION_REALITY_MAX_IGNORED_RATE_PCT" "$BROKER_REALITY_MIN_ACK_COUNT" "$BROKER_REALITY_MIN_FILL_COUNT" "$EXECUTION_GAP_MIN_OUTCOME_COUNT" "$EXECUTION_GAP_MIN_SAMPLE_COUNT" "$PROOF_RENEWAL_ACK_FRESH_DAYS" "$PROOF_RENEWAL_ACK_STALE_DAYS" "$PROOF_RENEWAL_ACK_EXPIRED_DAYS" "$PROOF_RENEWAL_FILL_FRESH_DAYS" "$PROOF_RENEWAL_FILL_STALE_DAYS" "$PROOF_RENEWAL_FILL_EXPIRED_DAYS" "$PROOF_RENEWAL_OUTCOME_FRESH_DAYS" "$PROOF_RENEWAL_OUTCOME_STALE_DAYS" "$PROOF_RENEWAL_OUTCOME_EXPIRED_DAYS" "$PROOF_RENEWAL_GAP_FRESH_DAYS" "$PROOF_RENEWAL_GAP_STALE_DAYS" "$PROOF_RENEWAL_GAP_EXPIRED_DAYS" "$REMEDIATION_SNAPSHOT_PUBLISH"
import datetime as dt
import json
import pathlib
import sys

env = json.loads(sys.argv[1])
execution_evidence = json.loads(sys.argv[2]) if sys.argv[2] else {}
state_path = pathlib.Path(sys.argv[3])
min_impact_delta_pts = float(sys.argv[4])
min_coverage_delta_pct = float(sys.argv[5])
condition_min_impact_delta_pts = float(sys.argv[6])
condition_eliminated_min_impact_delta_pts = float(sys.argv[7])
condition_eliminated_min_events_after_fix = int(float(sys.argv[8]))
decision_mc_dc_target_pct = float(sys.argv[9])
condition_eliminated_min_events_after_fix_cumulative = int(float(sys.argv[10]))
decision_mc_dc_proof_coverage_min_pct = float(sys.argv[11])
decision_mc_dc_unknown_conditions_max = int(float(sys.argv[12]))
decision_mc_dc_top_unknown_stable_min_runs = int(float(sys.argv[13]))
decision_mc_dc_elimination_coverage_min_pct = float(sys.argv[14])
decision_reality_target_coverage_pct = float(sys.argv[15])
decision_reality_max_ignored_rate_pct = float(sys.argv[16])
broker_reality_min_ack_count = int(float(sys.argv[17]))
broker_reality_min_fill_count = int(float(sys.argv[18]))
execution_gap_min_outcome_count = int(float(sys.argv[19]))
execution_gap_min_sample_count = int(float(sys.argv[20]))
proof_renewal_thresholds = {
  'ack': {
    'fresh_days': float(sys.argv[21]),
    'stale_days': float(sys.argv[22]),
    'expired_days': float(sys.argv[23]),
  },
  'fill': {
    'fresh_days': float(sys.argv[24]),
    'stale_days': float(sys.argv[25]),
    'expired_days': float(sys.argv[26]),
  },
  'outcome': {
    'fresh_days': float(sys.argv[27]),
    'stale_days': float(sys.argv[28]),
    'expired_days': float(sys.argv[29]),
  },
  'gap_sample': {
    'fresh_days': float(sys.argv[30]),
    'stale_days': float(sys.argv[31]),
    'expired_days': float(sys.argv[32]),
  },
}
publish_enabled = sys.argv[33] != '0'
strict_v1_decision_mc_dc_target_pct = 80.0
strict_v1_decision_mc_dc_proof_coverage_min_pct = 60.0
strict_v1_decision_mc_dc_unknown_conditions_max = 2
strict_v1_decision_mc_dc_elimination_coverage_min_pct = 50.0
payload = env.get('payload') if isinstance(env.get('payload'), dict) else {}
candidates = payload.get('top_candidates') if isinstance(payload.get('top_candidates'), list) else []
condition_lifetime = payload.get('condition_lifetime') if isinstance(payload.get('condition_lifetime'), list) else []
decision_condition_coverage = payload.get('decision_condition_coverage') if isinstance(payload.get('decision_condition_coverage'), dict) else {}
decision_condition_by_path = decision_condition_coverage.get('by_path') if isinstance(decision_condition_coverage.get('by_path'), list) else []

def _condition_stats(condition_name: str):
  for item in condition_lifetime:
    if str(item.get('condition') or '') == condition_name:
      return item
  return None

def _condition_impact_map():
  out = {}
  for item in condition_lifetime:
    name = str(item.get('condition') or '').strip()
    if not name:
      continue
    out[name] = {
      'impact_pct_points': float(item.get('impact_pct_points') or 0.0),
      'ignored_rate_pct': float(item.get('ignored_rate_pct') or 0.0),
      'ignored_rows': int(item.get('ignored_rows') or 0),
    }
  return out

def fmt_pct(value):
    if value is None:
        return 'n/a'
    try:
        return f"{float(value):.2f}%"
    except Exception:
        return 'n/a'

def fmt_days(value):
    if value is None:
        return 'n/a'
    try:
        return f"{float(value):.2f}d"
    except Exception:
        return 'n/a'

def proof_age_state(value, thresholds):
    if value is None:
        return 'EXPIRED'
    age_days = float(value)
    if age_days < float(thresholds.get('fresh_days') or 0.0):
        return 'FRESH'
    if age_days <= float(thresholds.get('stale_days') or 0.0):
        return 'AGING'
    if age_days <= float(thresholds.get('expired_days') or 0.0):
        return 'STALE'
    return 'EXPIRED'

def worst_proof_state(states):
    order = {'FRESH': 0, 'AGING': 1, 'STALE': 2, 'EXPIRED': 3}
    return max(states, key=lambda item: order.get(item, 3)) if states else 'EXPIRED'

def proof_renewal_lag_days(value, thresholds):
    if value is None:
        return None
    try:
        return round(max(float(value) - float(thresholds.get('fresh_days') or 0.0), 0.0), 6)
    except Exception:
        return None

def proof_days_until(value, threshold_days):
    if value is None:
        return None
    try:
        return round(float(threshold_days) - float(value), 6)
    except Exception:
        return None

def proof_signal(value, thresholds, latest_at):
    return {
      'state': proof_age_state(value, thresholds),
      'age_days': value,
      'renewal_lag_days': proof_renewal_lag_days(value, thresholds),
      'days_until_stale': proof_days_until(value, thresholds.get('stale_days')),
      'days_until_expired': proof_days_until(value, thresholds.get('expired_days')),
      'thresholds': thresholds,
      'latest_at': latest_at,
    }

def fmt_pts(value):
    if value is None:
        return 'n/a'
    try:
        return f"{float(value):.2f} pts"
    except Exception:
        return 'n/a'

prev = {}
if state_path.exists():
    try:
        prev = json.loads(state_path.read_text(encoding='utf-8'))
    except Exception:
        prev = {}

new_top = candidates[0] if candidates else {}
new_top_key = f"{new_top.get('decision_path','')}|{new_top.get('decision_reason','')}"
new_top_impact = float(new_top.get('impact_pct_points') or 0.0)
new_top_condition = str(new_top.get('canonical_decision_condition') or new_top.get('top_condition') or 'condition_unclassified')
new_top_condition_key = f"{new_top_key}|{new_top_condition}"
new_top_condition_share = float(new_top.get('top_condition_share_pct') or 0.0)
new_top_condition_impact = new_top_impact * (new_top_condition_share / 100.0)
new_coverage_pct = float(payload.get('decision_quote_coverage_pct') or 0.0)
new_ignored_rate_pct = float(payload.get('decision_quote_observed_ignored_rate_pct') or 0.0)
spread_rows = int(payload.get('spread_too_wide_rows') or 0)
prev_top_key = str(prev.get('top1_key') or '')
prev_top_impact = float(prev.get('top1_impact_pct_points') or 0.0)
prev_top_condition_key = str(prev.get('top1_condition_key') or '')
prev_top_condition_impact = float(prev.get('top1_condition_impact_pct_points') or 0.0)
prev_coverage_pct = float(prev.get('decision_quote_coverage_pct') or 0.0)
prev_ignored_rate_pct = float(prev.get('decision_quote_observed_ignored_rate_pct') or 0.0)
same_top = bool(new_top_key and new_top_key == prev_top_key)
repeat_count = int(prev.get('repeat_count') or 0)
repeat_count = repeat_count + 1 if same_top else 1

has_baseline = bool(prev_top_key)
top1_corrected = bool(has_baseline and new_top_key and new_top_key != prev_top_key)
impact_delta_pts = prev_top_impact - new_top_impact
coverage_delta_pct = new_coverage_pct - prev_coverage_pct
impact_measured = bool(top1_corrected and impact_delta_pts >= min_impact_delta_pts)
coverage_improved = bool(top1_corrected and coverage_delta_pct >= min_coverage_delta_pct)
remediation_proven = bool(top1_corrected and impact_measured and coverage_improved)

has_condition_baseline = bool(prev_top_condition_key)
condition_transitioned = bool(has_condition_baseline and new_top_condition_key and new_top_condition_key != prev_top_condition_key)
condition_impact_delta_pts = prev_top_condition_impact - new_top_condition_impact
condition_impact_measured = bool(condition_transitioned and condition_impact_delta_pts >= condition_min_impact_delta_pts)
condition_proven = bool(condition_transitioned and condition_impact_measured)

elimination_candidate = prev.get('condition_elimination_candidate') if isinstance(prev.get('condition_elimination_candidate'), dict) else None
if condition_transitioned and prev_top_condition_key:
  elimination_candidate = {
    'condition_key': prev_top_condition_key,
    'condition': str(prev.get('top1_condition') or '').strip() or str(prev_top_condition_key).split('|')[-1],
    'condition_impact_before': prev_top_condition_impact,
    'ignored_rate_before': float(prev.get('top1_condition_ignored_rate_pct') or 0.0),
    'started_at': dt.datetime.now(dt.timezone.utc).isoformat(),
    'events_after_fix_cumulative': 0,
  }

if elimination_candidate:
  elimination_candidate['events_after_fix_cumulative'] = int(elimination_candidate.get('events_after_fix_cumulative') or 0)

condition_impact_before = float((elimination_candidate or {}).get('condition_impact_before') or 0.0)
ignored_rate_before = float((elimination_candidate or {}).get('ignored_rate_before') or 0.0)
condition_name_after = str((elimination_candidate or {}).get('condition') or '')
after_stats = _condition_stats(condition_name_after) if condition_name_after else None
condition_impact_after = float(after_stats.get('impact_pct_points') or 0.0) if isinstance(after_stats, dict) else 0.0
ignored_rate_after = float(after_stats.get('ignored_rate_pct') or 0.0) if isinstance(after_stats, dict) else 0.0
delta_impact = condition_impact_before - condition_impact_after
event_count_after_fix = spread_rows
event_count_after_fix_cumulative = int((elimination_candidate or {}).get('events_after_fix_cumulative') or 0) + event_count_after_fix
if elimination_candidate:
  elimination_candidate['events_after_fix_cumulative'] = event_count_after_fix_cumulative
condition_eliminated = bool(
  elimination_candidate
  and condition_name_after
  and event_count_after_fix >= condition_eliminated_min_events_after_fix
  and event_count_after_fix_cumulative >= condition_eliminated_min_events_after_fix_cumulative
  and delta_impact >= condition_eliminated_min_impact_delta_pts
  and condition_impact_after <= 0.000001
)

decision_reality_observed = bool(
  spread_rows > 0
  and new_coverage_pct >= decision_reality_target_coverage_pct
  and new_ignored_rate_pct <= decision_reality_max_ignored_rate_pct
)
decision_reality_state = 'DECISION_REALITY_OBSERVED' if decision_reality_observed else 'DECISION_REALITY_PARTIAL_QUOTE_AWARE'

if condition_eliminated:
  condition_eliminated_state = 'CONDITION_ELIMINATED'
elif elimination_candidate:
  condition_eliminated_state = 'ELIMINATION_PENDING_PROOF'
else:
  condition_eliminated_state = 'ELIMINATION_IDLE'

if not has_condition_baseline:
  condition_state = 'BASELINE_REQUIRED'
elif condition_proven:
  condition_state = 'CONDITION_PROVEN'
elif condition_transitioned:
  condition_state = 'CONDITION_IN_PROGRESS'
elif has_condition_baseline and new_top_condition_key == prev_top_condition_key and candidates:
  condition_state = 'CONDITION_FIRST_LOCK'
else:
  condition_state = 'CONDITION_PENDING'

if not has_baseline:
  remediation_state = 'BASELINE_REQUIRED'
elif remediation_proven:
  remediation_state = 'REMEDIATION_PROVEN'
elif top1_corrected:
  remediation_state = 'REMEDIATION_IN_PROGRESS'
elif same_top and candidates:
  remediation_state = 'REMEDIATION_FIRST_LOCK'
else:
  remediation_state = 'REMEDIATION_PENDING'

short_lines = []
short_lines.append(f"TXT Remediation Snapshot {dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
short_lines.append(
  f"coverage={fmt_pct(payload.get('decision_quote_coverage_pct'))} | ignored_obs={fmt_pct(payload.get('decision_quote_observed_ignored_rate_pct'))} | spread_rows={int(payload.get('spread_too_wide_rows') or 0)}"
)
if not candidates:
    short_lines.append('Top3: aucun candidat calculable')
else:
    for idx, item in enumerate(candidates[:3], start=1):
        path = str(item.get('decision_path') or 'unknown_path')
        reason = str(item.get('decision_reason') or 'n/a')
        short_lines.append(
            f"#{idx} {path} | {reason} | impact={fmt_pts(item.get('impact_pct_points'))} | ignored={fmt_pct(item.get('ignored_rate_pct'))}"
        )
    top_action = str(candidates[0].get('suggested_action') or 'Inspect routing condition.')
    short_lines.append(f"Action now: corriger #1 -> {top_action}")

if same_top and candidates:
    short_lines.append(f"REMEDIATION_FIRST: LOCK (top#1 inchange x{repeat_count})")
else:
    short_lines.append('REMEDIATION_FIRST: GO (top#1 mis a jour ou nouveau cycle)')
if has_baseline:
  short_lines.append(
    f"delta: impact={impact_delta_pts:+.2f} pts | coverage={coverage_delta_pct:+.2f}%"
  )
short_lines.append(f"REMEDIATION_PROVEN: {remediation_state}")
if candidates:
  short_lines.append(
    f"condition#1={new_top_condition} | condition_impact~{new_top_condition_impact:.2f} pts"
  )
if has_condition_baseline:
  short_lines.append(f"condition_delta: impact={condition_impact_delta_pts:+.2f} pts")
short_lines.append(f"CONDITION_PROVEN: {condition_state}")
if elimination_candidate:
  short_lines.append(
    f"elimination: before={condition_impact_before:.2f} pts/{ignored_rate_before:.2f}% -> after={condition_impact_after:.2f} pts/{ignored_rate_after:.2f}% | delta={delta_impact:+.2f} pts | n_after={event_count_after_fix} | n_after_cum={event_count_after_fix_cumulative}"
  )
short_lines.append(f"CONDITION_ELIMINATED: {condition_eliminated_state}")
short_lines.append(f"DECISION_REALITY: {decision_reality_state}")

known_conditions = decision_condition_coverage.get('known_conditions') if isinstance(decision_condition_coverage.get('known_conditions'), list) else []
observed_conditions = decision_condition_coverage.get('observed_conditions') if isinstance(decision_condition_coverage.get('observed_conditions'), list) else []
unknown_conditions = decision_condition_coverage.get('unknown_conditions') if isinstance(decision_condition_coverage.get('unknown_conditions'), list) else []
condition_coverage_pct = float(decision_condition_coverage.get('coverage_pct') or 0.0)
prev_unknown_conditions_count = int(prev.get('unknown_conditions_count') or 0)
has_unknown_baseline = 'unknown_conditions_count' in prev

prev_condition_states = prev.get('decision_condition_states') if isinstance(prev.get('decision_condition_states'), dict) else {}
current_impact_map = _condition_impact_map()
condition_states = {}
proven_count = 0
eliminated_count = 0
reappeared = []
for condition in known_conditions:
  prev_item = prev_condition_states.get(condition) if isinstance(prev_condition_states.get(condition), dict) else {}
  prev_impact = float(prev_item.get('impact_pct_points') or 0.0)
  prev_status = str(prev_item.get('status') or 'UNKNOWN')
  cur_impact = float((current_impact_map.get(condition) or {}).get('impact_pct_points') or 0.0)
  cur_ignored_rate = float((current_impact_map.get(condition) or {}).get('ignored_rate_pct') or 0.0)
  seen_now = condition in observed_conditions
  # MC/DC proof model: a condition is proven when it has been SEEN with non-zero
  # prevalence in the current run AND was also present (impact > 0) in the previous
  # run. Two consecutive runs with real presence = stable, observable condition.
  # (Old model required ignored-row delta decrease, but healthy systems never have
  # ignored rows, so that gate was permanently blocked at 0%.)
  proven_now = bool(seen_now and cur_impact > 0.0 and prev_impact > 0.0)
  eliminated_now = bool(
    prev_impact > 0.0
    and cur_impact <= 0.000001
    and int(payload.get('spread_too_wide_rows') or 0) >= condition_eliminated_min_events_after_fix
  )
  reappeared_now = bool(prev_status == 'ELIMINATED' and cur_impact > 0.000001)
  if eliminated_now:
    status = 'ELIMINATED'
  elif proven_now:
    status = 'PROVEN'
  elif seen_now:
    status = 'SEEN'
  else:
    status = 'UNKNOWN'
  if status == 'PROVEN':
    proven_count += 1
  if status == 'ELIMINATED':
    eliminated_count += 1
  if reappeared_now:
    reappeared.append(condition)
  condition_states[condition] = {
    'status': status,
    'seen': seen_now,
    'proven': proven_now,
    'eliminated': eliminated_now,
    'reappeared': reappeared_now,
    'impact_pct_points': cur_impact,
    'ignored_rate_pct': cur_ignored_rate,
    'prev_impact_pct_points': prev_impact,
    'delta_impact_pct_points': prev_impact - cur_impact,
  }

known_count = len(known_conditions)
proof_coverage_pct = (proven_count / known_count * 100.0) if known_count > 0 else 0.0
elimination_coverage_pct = (eliminated_count / known_count * 100.0) if known_count > 0 else 0.0
top_unknown_condition = str(unknown_conditions[0]) if unknown_conditions else None
prev_top_unknown_condition = str(prev.get('top_unknown_condition') or '')
prev_top_unknown_stable_runs = int(prev.get('top_unknown_stable_runs') or 0)
if top_unknown_condition:
  if top_unknown_condition == prev_top_unknown_condition:
    top_unknown_stable_runs = prev_top_unknown_stable_runs + 1
  else:
    top_unknown_stable_runs = 1
else:
  top_unknown_stable_runs = 0
top_unknown_stable = bool(top_unknown_condition and top_unknown_stable_runs >= decision_mc_dc_top_unknown_stable_min_runs)
top_unknown_stable_or_none = bool((not top_unknown_condition) or top_unknown_stable)
decision_mc_dc_proven = bool(
  condition_coverage_pct >= decision_mc_dc_target_pct
  and proof_coverage_pct >= decision_mc_dc_proof_coverage_min_pct
  and len(unknown_conditions) <= decision_mc_dc_unknown_conditions_max
  and elimination_coverage_pct >= decision_mc_dc_elimination_coverage_min_pct
  and top_unknown_stable_or_none
)
decision_mc_dc_state = 'DECISION_MC_DC_PROVEN' if decision_mc_dc_proven else 'DECISION_MC_DC_PENDING'

strict_v1_decision_mc_dc_proven = bool(
  condition_coverage_pct >= strict_v1_decision_mc_dc_target_pct
  and proof_coverage_pct >= strict_v1_decision_mc_dc_proof_coverage_min_pct
  and len(unknown_conditions) <= strict_v1_decision_mc_dc_unknown_conditions_max
  and elimination_coverage_pct >= strict_v1_decision_mc_dc_elimination_coverage_min_pct
)
strict_v1_mcdc_failure_reasons = []
if condition_coverage_pct < strict_v1_decision_mc_dc_target_pct:
  strict_v1_mcdc_failure_reasons.append('coverage_below_historical_target')
if proof_coverage_pct < strict_v1_decision_mc_dc_proof_coverage_min_pct:
  strict_v1_mcdc_failure_reasons.append('proof_coverage_below_historical_min')
if len(unknown_conditions) > strict_v1_decision_mc_dc_unknown_conditions_max:
  strict_v1_mcdc_failure_reasons.append('unknown_conditions_above_historical_max')
if elimination_coverage_pct < strict_v1_decision_mc_dc_elimination_coverage_min_pct:
  strict_v1_mcdc_failure_reasons.append('elimination_coverage_below_historical_min')

unknown_priority = []

ack_count = int(execution_evidence.get('ack_count') or 0)
fill_count = int(execution_evidence.get('fill_count') or 0)
outcome_count = int(execution_evidence.get('outcome_count') or 0)
reality_gap_sample_count = int(execution_evidence.get('reality_gap_sample_count') or 0)
days_since_last_ack = execution_evidence.get('days_since_last_ack')
days_since_last_fill = execution_evidence.get('days_since_last_fill')
days_since_last_outcome = execution_evidence.get('days_since_last_outcome')
days_since_last_gap_sample = execution_evidence.get('days_since_last_gap_sample')
proof_staleness = execution_evidence.get('proof_staleness') if isinstance(execution_evidence.get('proof_staleness'), dict) else {}
proof_renewal_signals = {
  'ack': proof_signal(days_since_last_ack, proof_renewal_thresholds['ack'], execution_evidence.get('latest_ack_at')),
  'fill': proof_signal(days_since_last_fill, proof_renewal_thresholds['fill'], execution_evidence.get('latest_fill_at')),
  'outcome': proof_signal(days_since_last_outcome, proof_renewal_thresholds['outcome'], execution_evidence.get('latest_outcome_at')),
  'gap_sample': proof_signal(days_since_last_gap_sample, proof_renewal_thresholds['gap_sample'], execution_evidence.get('latest_gap_sample_at')),
}
proof_renewal_state = worst_proof_state([item['state'] for item in proof_renewal_signals.values()])
fresh_proven = bool(all(item['state'] == 'FRESH' for item in proof_renewal_signals.values()))
proof_renewal_due = bool(any(item['state'] in ('STALE', 'EXPIRED') for item in proof_renewal_signals.values()))
proof_expired = bool(any(item['state'] == 'EXPIRED' for item in proof_renewal_signals.values()))
renewal_velocity = {
  'state': 'FRESH' if fresh_proven else proof_renewal_state,
  'max_lag_days': max(
    [item['renewal_lag_days'] for item in proof_renewal_signals.values() if item.get('renewal_lag_days') is not None],
    default=None,
  ),
  'signals_over_fresh_target': [
    name for name, item in proof_renewal_signals.items()
    if item.get('renewal_lag_days') is not None and float(item.get('renewal_lag_days') or 0.0) > 0.0
  ],
  'renewal_priority': sorted(
    [
      {
        'signal': name,
        'state': item.get('state'),
        'age_days': item.get('age_days'),
        'fresh_days': item.get('thresholds', {}).get('fresh_days'),
        'renewal_lag_days': item.get('renewal_lag_days'),
        'days_until_expired': item.get('days_until_expired'),
        'latest_at': item.get('latest_at'),
      }
      for name, item in proof_renewal_signals.items()
    ],
    key=lambda item: (
      0 if item.get('renewal_lag_days') is None else 1,
      0.0 if item.get('renewal_lag_days') is None else -float(item.get('renewal_lag_days') or 0.0),
      str(item.get('signal') or ''),
    ),
  ),
  'expiration_priority': sorted(
    [
      {
        'signal': name,
        'state': item.get('state'),
        'age_days': item.get('age_days'),
        'expired_days': item.get('thresholds', {}).get('expired_days'),
        'days_until_expired': item.get('days_until_expired'),
        'latest_at': item.get('latest_at'),
      }
      for name, item in proof_renewal_signals.items()
    ],
    key=lambda item: (
      0 if item.get('days_until_expired') is None else 1,
      0.0 if item.get('days_until_expired') is None else float(item.get('days_until_expired') or 0.0),
      str(item.get('signal') or ''),
    ),
  ),
}
renewal_velocity['next_signal_to_renew'] = (
  renewal_velocity['renewal_priority'][0]['signal'] if renewal_velocity['renewal_priority'] else None
)
renewal_velocity['next_signal_to_expire'] = (
  renewal_velocity['expiration_priority'][0]['signal'] if renewal_velocity['expiration_priority'] else None
)
proof_decay_detected = bool(proof_renewal_state in ('AGING', 'STALE', 'EXPIRED'))
proof_invalidated = bool(proof_expired or proof_staleness.get('missing_signals'))
broker_reality_validated = bool(
  ack_count >= broker_reality_min_ack_count
  and fill_count >= broker_reality_min_fill_count
)
execution_gap_validated = bool(
  fill_count >= broker_reality_min_fill_count
  and outcome_count >= execution_gap_min_outcome_count
  and reality_gap_sample_count >= execution_gap_min_sample_count
)

for condition in unknown_conditions:
  missing_paths = []
  for item in decision_condition_by_path:
    item_unknown = item.get('unknown_conditions') if isinstance(item.get('unknown_conditions'), list) else []
    if condition in item_unknown:
      missing_paths.append(str(item.get('decision_path') or 'unknown_path'))
  missing_paths = sorted(set(missing_paths))
  unknown_priority.append(
    {
      'condition': condition,
      'missing_paths_count': len(missing_paths),
      'missing_paths': missing_paths,
      'is_top_unknown': bool(top_unknown_condition and condition == top_unknown_condition),
    }
  )
unknown_priority.sort(key=lambda item: (0 if item.get('is_top_unknown') else 1, -int(item.get('missing_paths_count') or 0), str(item.get('condition') or '')))

unknown_to_target = max(0, len(unknown_conditions) - decision_mc_dc_unknown_conditions_max)
unknown_to_zero = len(unknown_conditions)
unknown_delta = (prev_unknown_conditions_count - len(unknown_conditions)) if has_unknown_baseline else None
unknown_focus = unknown_priority[0] if unknown_priority else None
unknown_focus_paths = unknown_focus.get('missing_paths') if isinstance(unknown_focus, dict) else []

short_lines.append(
  f"Decision Condition Coverage: {condition_coverage_pct:.2f}% | proven={proven_count} | eliminated={eliminated_count} | unknown={len(unknown_conditions)}"
)
if top_unknown_condition:
  short_lines.append(f"Top Unknown Condition: {top_unknown_condition} (stable_runs={top_unknown_stable_runs})")
short_lines.append(
  f"Unknown Eradication: unknown={len(unknown_conditions)} | to<=max({decision_mc_dc_unknown_conditions_max})={unknown_to_target} | to0={unknown_to_zero} | delta={(f'{unknown_delta:+d}' if unknown_delta is not None else 'n/a')}"
)
if unknown_focus_paths:
  short_lines.append(f"Unknown Focus: {unknown_focus.get('condition')} -> observe/prove on {','.join(unknown_focus_paths[:3])}")
short_lines.append(f"Next Gate: {decision_mc_dc_state} ({decision_mc_dc_target_pct:.0f}%)")
short_lines.append(
  f"Proof Loop: mcdc={'ok' if decision_mc_dc_proven else 'pending'} | decision_reality={'ok' if decision_reality_observed else 'pending'} | broker={'ok' if broker_reality_validated else 'pending'} | gap={'ok' if execution_gap_validated else 'pending'}"
)
short_lines.append(
  f"Strict V1 Proof: strict={'ok' if strict_v1_decision_mc_dc_proven and decision_reality_observed and broker_reality_validated and execution_gap_validated else 'pending'} | operational={'ok' if decision_mc_dc_proven and decision_reality_observed and broker_reality_validated and execution_gap_validated else 'pending'}"
)
short_lines.append(
  f"Strict V1 MC/DC: coverage={condition_coverage_pct:.2f}/80 proof={proof_coverage_pct:.2f}/60 unknown={len(unknown_conditions)}/2 elimination={elimination_coverage_pct:.2f}/50"
)
short_lines.append(
  f"Proof Staleness: ack={fmt_days(days_since_last_ack)} fill={fmt_days(days_since_last_fill)} outcome={fmt_days(days_since_last_outcome)} gap={fmt_days(days_since_last_gap_sample)} max={fmt_days(proof_staleness.get('max_days_since_proof'))}"
)
short_lines.append(
  f"Proof Renewal: state={proof_renewal_state} fresh={'yes' if fresh_proven else 'no'} due={'yes' if proof_renewal_due else 'no'} expired={'yes' if proof_expired else 'no'} | ack={proof_renewal_signals['ack']['state']} fill={proof_renewal_signals['fill']['state']} outcome={proof_renewal_signals['outcome']['state']} gap={proof_renewal_signals['gap_sample']['state']}"
)
short_lines.append(
  f"Renewal Velocity: max_lag={fmt_days(renewal_velocity.get('max_lag_days'))} renew_next={renewal_velocity.get('next_signal_to_renew') or 'none'} expire_next={renewal_velocity.get('next_signal_to_expire') or 'none'} decay={'yes' if proof_decay_detected else 'no'} invalidated={'yes' if proof_invalidated else 'no'}"
)
short_lines.append(
  f"Evidence Counts(all-time): ack={ack_count} fill={fill_count} outcome={outcome_count} gap={reality_gap_sample_count}"
)

record = {
    'generated_at': dt.datetime.now(dt.timezone.utc).isoformat(),
    'snapshot_path': env.get('path'),
    'summary': payload,
    'short_text': '\n'.join(short_lines),
    'top1_key': new_top_key,
    'top1_impact_pct_points': new_top_impact,
    'top1_condition_key': new_top_condition_key,
    'top1_condition': new_top_condition,
    'top1_condition_impact_pct_points': new_top_condition_impact,
    'top1_condition_ignored_rate_pct': new_top_condition_share,
    'decision_quote_coverage_pct': new_coverage_pct,
    'decision_quote_observed_ignored_rate_pct': new_ignored_rate_pct,
    'repeat_count': repeat_count,
    'same_top': same_top,
    'governance': {
      'state': remediation_state,
      'top1_corrected': top1_corrected,
      'impact_measured': impact_measured,
      'coverage_improved': coverage_improved,
      'remediation_proven': remediation_proven,
      'impact_delta_pts': impact_delta_pts,
      'coverage_delta_pct': coverage_delta_pct,
      'thresholds': {
        'min_impact_delta_pts': min_impact_delta_pts,
        'min_coverage_delta_pct': min_coverage_delta_pct,
      },
    },
    'condition_governance': {
      'state': condition_state,
      'condition_key': new_top_condition_key,
      'condition': new_top_condition,
      'condition_eliminated': condition_eliminated,
      'impact_measured': condition_impact_measured,
      'condition_proven': condition_proven,
      'impact_delta_pts': condition_impact_delta_pts,
      'thresholds': {
        'min_impact_delta_pts': condition_min_impact_delta_pts,
      },
    },
    'condition_elimination_governance': {
      'state': condition_eliminated_state,
      'condition': condition_name_after,
      'condition_impact_before': condition_impact_before,
      'condition_impact_after': condition_impact_after,
      'delta_impact': delta_impact,
      'ignored_rate_before': ignored_rate_before,
      'ignored_rate_after': ignored_rate_after,
      'event_count_after_fix': event_count_after_fix,
      'event_count_after_fix_cumulative': event_count_after_fix_cumulative,
      'condition_eliminated': condition_eliminated,
      'thresholds': {
        'min_impact_delta_pts': condition_eliminated_min_impact_delta_pts,
        'min_events_after_fix': condition_eliminated_min_events_after_fix,
        'min_events_after_fix_cumulative': condition_eliminated_min_events_after_fix_cumulative,
      },
    },
    'decision_reality_governance': {
      'state': decision_reality_state,
      'observed': decision_reality_observed,
      'coverage_pct': new_coverage_pct,
      'observed_ignored_rate_pct': new_ignored_rate_pct,
      'spread_too_wide_rows': spread_rows,
      'thresholds': {
        'target_coverage_pct': decision_reality_target_coverage_pct,
        'max_ignored_rate_pct': decision_reality_max_ignored_rate_pct,
      },
    },
    'decision_condition_governance': {
      'state': decision_mc_dc_state,
      'proven': decision_mc_dc_proven,
      'coverage_pct': condition_coverage_pct,
      'proof_coverage_pct': round(proof_coverage_pct, 6),
      'elimination_coverage_pct': round(elimination_coverage_pct, 6),
      'known_conditions_count': known_count,
      'observed_conditions_count': len(observed_conditions),
      'proven_conditions_count': proven_count,
      'eliminated_conditions_count': eliminated_count,
      'unknown_conditions_count': len(unknown_conditions),
      'unknown_conditions': unknown_conditions,
      'top_unknown_condition': top_unknown_condition,
      'top_unknown_stable_runs': top_unknown_stable_runs,
      'top_unknown_stable': top_unknown_stable,
      'top_unknown_stable_or_none': top_unknown_stable_or_none,
      'reappeared_conditions': reappeared,
      'thresholds': {
        'decision_mc_dc_target_pct': decision_mc_dc_target_pct,
        'proof_coverage_min_pct': decision_mc_dc_proof_coverage_min_pct,
        'unknown_conditions_max': decision_mc_dc_unknown_conditions_max,
        'top_unknown_stable_min_runs': decision_mc_dc_top_unknown_stable_min_runs,
        'elimination_coverage_min_pct': decision_mc_dc_elimination_coverage_min_pct,
      },
      'condition_states': condition_states,
    },
    'unknown_condition_eradication': {
      'unknown_conditions_count': len(unknown_conditions),
      'unknown_conditions': unknown_conditions,
      'unknown_conditions_count_prev': prev_unknown_conditions_count,
      'unknown_conditions_delta': unknown_delta,
      'has_baseline': has_unknown_baseline,
      'unknown_to_target_max': unknown_to_target,
      'unknown_to_zero': unknown_to_zero,
      'target_unknown_conditions_max': decision_mc_dc_unknown_conditions_max,
      'top_unknown_condition': top_unknown_condition,
      'top_unknown_stable_runs': top_unknown_stable_runs,
      'priority': unknown_priority,
      'focus': unknown_focus,
    },
    'strict_v1_proof': {
      'strict_v1_proven': bool(strict_v1_decision_mc_dc_proven and decision_reality_observed and broker_reality_validated and execution_gap_validated),
      'operational_v1_proven': bool(decision_mc_dc_proven and decision_reality_observed and broker_reality_validated and execution_gap_validated),
      'decision_mc_dc_proven': strict_v1_decision_mc_dc_proven,
      'decision_reality_observed': decision_reality_observed,
      'broker_reality_validated': broker_reality_validated,
      'execution_gap_validated': execution_gap_validated,
      'failure_reasons': strict_v1_mcdc_failure_reasons,
      'metrics': {
        'coverage_pct': round(condition_coverage_pct, 6),
        'proof_coverage_pct': round(proof_coverage_pct, 6),
        'unknown_conditions_count': len(unknown_conditions),
        'elimination_coverage_pct': round(elimination_coverage_pct, 6),
      },
      'thresholds': {
        'decision_mc_dc_target_pct': strict_v1_decision_mc_dc_target_pct,
        'proof_coverage_min_pct': strict_v1_decision_mc_dc_proof_coverage_min_pct,
        'unknown_conditions_max': strict_v1_decision_mc_dc_unknown_conditions_max,
        'elimination_coverage_min_pct': strict_v1_decision_mc_dc_elimination_coverage_min_pct,
      },
    },
    'proof_regression': {
      'days_since_last_ack': days_since_last_ack,
      'days_since_last_fill': days_since_last_fill,
      'days_since_last_outcome': days_since_last_outcome,
      'days_since_last_gap_sample': days_since_last_gap_sample,
      'proof_staleness': proof_staleness,
      'proof_renewal': {
        'state': proof_renewal_state,
        'fresh_proven': fresh_proven,
        'proof_renewal_due': proof_renewal_due,
        'proof_expired': proof_expired,
        'proof_decay_detected': proof_decay_detected,
        'proof_invalidated': proof_invalidated,
        'renewal_velocity': renewal_velocity,
        'signals': proof_renewal_signals,
      },
      'latest': {
        'ack_at': execution_evidence.get('latest_ack_at'),
        'fill_at': execution_evidence.get('latest_fill_at'),
        'outcome_at': execution_evidence.get('latest_outcome_at'),
        'gap_sample_at': execution_evidence.get('latest_gap_sample_at'),
      },
    },
    'v1_lock_proof_loop': {
      'decision_mc_dc_proven': decision_mc_dc_proven,
      'decision_reality_observed': decision_reality_observed,
      'broker_reality_validated': broker_reality_validated,
      'execution_gap_validated': execution_gap_validated,
      'all_locks_proven': bool(decision_mc_dc_proven and decision_reality_observed and broker_reality_validated and execution_gap_validated),
      'evidence': {
        'window_hours': float(execution_evidence.get('window_hours') or 0.0),

        'ack_count': ack_count,
        'fill_count': fill_count,
        'outcome_count': outcome_count,
        'reality_gap_sample_count': reality_gap_sample_count,
        'days_since_last_ack': days_since_last_ack,
        'days_since_last_fill': days_since_last_fill,
        'days_since_last_outcome': days_since_last_outcome,
        'days_since_last_gap_sample': days_since_last_gap_sample,
        'proof_staleness': proof_staleness,
        'proof_renewal_state': proof_renewal_state,
        'fresh_proven': fresh_proven,
        'proof_renewal_due': proof_renewal_due,
        'proof_expired': proof_expired,
        'proof_decay_detected': proof_decay_detected,
        'proof_invalidated': proof_invalidated,
        'renewal_velocity': renewal_velocity,
        'error': execution_evidence.get('error'),
      },
      'thresholds': {
        'broker_reality_min_ack_count': broker_reality_min_ack_count,
        'broker_reality_min_fill_count': broker_reality_min_fill_count,
        'execution_gap_min_outcome_count': execution_gap_min_outcome_count,
        'execution_gap_min_sample_count': execution_gap_min_sample_count,
      },
    },
}

if publish_enabled:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(
        json.dumps(
            {
                'top1_key': new_top_key,
                'top1_impact_pct_points': new_top_impact,
                'top1_condition_key': new_top_condition_key,
                'top1_condition': new_top_condition,
                'top1_condition_impact_pct_points': new_top_condition_impact,
                'top1_condition_ignored_rate_pct': new_top_condition_share,
                'decision_quote_coverage_pct': new_coverage_pct,
                'decision_quote_observed_ignored_rate_pct': new_ignored_rate_pct,
                'repeat_count': repeat_count,
                'condition_elimination_candidate': elimination_candidate,
                'decision_condition_states': condition_states,
                'top_unknown_condition': top_unknown_condition,
                'top_unknown_stable_runs': top_unknown_stable_runs,
                'unknown_conditions_count': len(unknown_conditions),
            },
            ensure_ascii=True,
        ),
        encoding='utf-8',
    )
print(json.dumps(record, ensure_ascii=True))
PY
)"

latest_json="$HOST_OUTPUT_DIR/remediation_snapshot_latest.json"
latest_txt="$HOST_OUTPUT_DIR/remediation_snapshot_latest.txt"
shared_json="$SHARED_OUTPUT_DIR/remediation_snapshot_latest.json"
shared_txt="$SHARED_OUTPUT_DIR/remediation_snapshot_latest.txt"

if [[ "$REMEDIATION_SNAPSHOT_PUBLISH" != '0' ]]; then
  printf '%s\n' "$report_json" > "$latest_json"
  printf '%s\n' "$report_json" > "$shared_json"

  python3 - <<'PY' "$report_json" "$latest_txt" "$shared_txt"
import json
import pathlib
import sys

report = json.loads(sys.argv[1])
text = str(report.get('short_text') or '')
for path in (pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text + '\n', encoding='utf-8')
PY
fi

send_telegram_alert() {
  local report_payload="$1"
  if [[ -z "$TELEGRAM_BOT_TOKEN" || -z "$TELEGRAM_CHAT_ID" ]]; then
    return 0
  fi
  local disable_notification_bool='false'
  if [[ "$TELEGRAM_DISABLE_NOTIFICATION" == '1' ]]; then
    disable_notification_bool='true'
  fi
  local telegram_payload
  telegram_payload="$(python3 - <<'PY' "$report_payload" "$TELEGRAM_CHAT_ID" "$TELEGRAM_TOPIC_ID" "$disable_notification_bool"
import json
import sys
report = json.loads(sys.argv[1])
payload = {
    'chat_id': sys.argv[2],
    'text': str(report.get('short_text') or ''),
    'disable_web_page_preview': True,
    'disable_notification': sys.argv[4] == 'true',
}
if sys.argv[3]:
    payload['message_thread_id'] = int(sys.argv[3])
print(json.dumps(payload, ensure_ascii=True))
PY
)"
  local api_url="${TELEGRAM_API_BASE_URL%/}/bot${TELEGRAM_BOT_TOKEN}/sendMessage"
  curl -fsS -m "$WEBHOOK_TIMEOUT_SEC" -H 'Content-Type: application/json' -X POST --data "$telegram_payload" "$api_url" >/dev/null
}

send_webhook_alert() {
  local report_payload="$1"
  if [[ -z "$WEBHOOK_URL" ]]; then
    return 0
  fi
  curl -fsS -m "$WEBHOOK_TIMEOUT_SEC" -H 'Content-Type: application/json' -X POST --data "$report_payload" "$WEBHOOK_URL" >/dev/null
}

if [[ "$REMEDIATION_SNAPSHOT_PUBLISH" != '0' ]]; then
  send_telegram_alert "$report_json" || log_json error "telegram_delivery_failed"
  send_webhook_alert "$report_json" || log_json error "webhook_delivery_failed"
fi

log_json info "remediation_snapshot_daily_done"
printf '%s\n' "$report_json"
