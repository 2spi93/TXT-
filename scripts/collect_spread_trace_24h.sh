#!/usr/bin/env bash
set -euo pipefail

INTERVAL_SECONDS="${INTERVAL_SECONDS:-300}"
HOURS="${HOURS:-24}"
LIMIT="${LIMIT:-5000}"
OUTPUT_DIR="${OUTPUT_DIR:-/workspace/logs/spread_audit}"
CONTAINER="${CONTAINER:-control-plane}"
REMEDIATION_TOP_N="${REMEDIATION_TOP_N:-3}"
REMEDIATION_IGNORED_RATE_THRESHOLD_PCT="${REMEDIATION_IGNORED_RATE_THRESHOLD_PCT:-10}"
REMEDIATION_IMPACT_THRESHOLD_PCT_POINTS="${REMEDIATION_IMPACT_THRESHOLD_PCT_POINTS:-1}"

start_epoch="$(date +%s)"
end_epoch="$((start_epoch + HOURS * 3600))"
host_log_dir="/opt/txt/logs/spread_audit"
host_log_file="${host_log_dir}/spread_decision_trace_collector_24h.jsonl"

mkdir -p "${host_log_dir}"

echo "{\"event\":\"collector_started\",\"started_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"hours\":${HOURS},\"interval_seconds\":${INTERVAL_SECONDS}}" >> "${host_log_file}"

while [[ "$(date +%s)" -lt "${end_epoch}" ]]; do
  docker exec -i "${CONTAINER}" \
    python3 /workspace/scripts/spread_decision_trace_audit.py \
      --lookback-hours 24 \
      --limit "${LIMIT}" \
      --export-remediation-snapshot \
      --remediation-top-n "${REMEDIATION_TOP_N}" \
      --remediation-ignored-rate-threshold-pct "${REMEDIATION_IGNORED_RATE_THRESHOLD_PCT}" \
      --remediation-impact-threshold-pct-points "${REMEDIATION_IMPACT_THRESHOLD_PCT_POINTS}" \
      --output-dir "${OUTPUT_DIR}" >/dev/null

  docker exec -i "${CONTAINER}" python3 - <<'PY' >> "${host_log_file}"
import json
from pathlib import Path
from datetime import datetime, timezone

summary_dir = Path("/workspace/logs/spread_audit")
files = sorted(summary_dir.glob("spread_decision_trace_*.summary.json"), key=lambda p: p.stat().st_mtime)
latest = files[-1] if files else None

record = {
    "observed_at": datetime.now(timezone.utc).isoformat(),
    "summary_file": str(latest) if latest else None,
}

if latest and latest.exists():
    try:
        summary = json.loads(latest.read_text(encoding="utf-8"))
        record.update({
            "rows": summary.get("rows"),
            "spread_too_wide_rows": summary.get("spread_too_wide_rows"),
            "policy_only_rows": summary.get("policy_only_rows"),
            "spread_live_used_rows": summary.get("spread_live_used_rows"),
            "policy_only_rate_pct": summary.get("policy_only_rate_pct"),
            "spread_live_used_rate_pct": summary.get("spread_live_used_rate_pct"),
            "distinct_symbols": summary.get("distinct_symbols"),
        })

        remediation_files = sorted(summary_dir.glob("spread_decision_remediation_snapshot_*.json"), key=lambda p: p.stat().st_mtime)
        remediation_latest = remediation_files[-1] if remediation_files else None
        record["remediation_snapshot_file"] = str(remediation_latest) if remediation_latest else None
        if remediation_latest and remediation_latest.exists():
          remediation = json.loads(remediation_latest.read_text(encoding="utf-8"))
          top_candidates = remediation.get("top_candidates") if isinstance(remediation.get("top_candidates"), list) else []
          record["remediation_top_candidates"] = top_candidates[:3]
    except Exception as exc:
        record["error"] = f"summary_parse_failed:{exc}"
else:
    record["error"] = "summary_missing"

print(json.dumps(record, ensure_ascii=True))
PY

  sleep "${INTERVAL_SECONDS}"
done

echo "{\"event\":\"collector_finished\",\"finished_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >> "${host_log_file}"
