#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/control_plane_helpers.sh
. "$SCRIPT_DIR/lib/control_plane_helpers.sh"

txt_source_repo_env

ACCOUNT_ID="${ACCOUNT_ID:-MT5_ACCOUNT_ID_REQUIRED}"
SYMBOL="${SYMBOL:-BTCUSD}"
SIDE="${SIDE:-buy}"
LOTS="${LOTS:-0.01}"
NOTIONAL_USD="${NOTIONAL_USD:-4}"
MAX_SPREAD_BPS="${MAX_SPREAD_BPS:-10}"
CONFIDENCE="${CONFIDENCE:-0.8}"
RATIONALE="${RATIONALE:-spread-gated one-shot cert}"
CONFIRM_LIVE="${CONFIRM_LIVE:-}"
USERNAME="${USERNAME:-operator}"
PASSWORD="${PASSWORD:-}"
SECOND_USERNAME="${SECOND_USERNAME:-}"
SECOND_PASSWORD="${SECOND_PASSWORD:-}"
PREFERRED_VENUE="${PREFERRED_VENUE:-mt5}"

usage() {
  cat <<'EOF'
Usage: mt5_spread_gated_one_shot.sh [options]

Options:
  --account-id VALUE         MT5 account id (default: MT5_ACCOUNT_ID_REQUIRED)
  --symbol VALUE             Symbol (default: BTCUSD)
  --side VALUE               buy or sell (default: buy)
  --lots VALUE               MT5 lots (default: 0.01)
  --notional-usd VALUE       Estimated notional USD (default: 4)
  --max-spread-bps VALUE     Max spread bps (default: 10)
  --confidence VALUE         Live hardening confidence (default: 0.8)
  --rationale VALUE          Metadata rationale
  --preferred-venue VALUE    Venue hint (default: mt5)
  --username VALUE           Operator username (default: operator)
  --password VALUE           Operator password (optional)
  --second-username VALUE    Different operator username for second approval
  --second-password VALUE    Different operator password (optional)
  --confirm-live VALUE       Must be MT5_LIVE_SMOKE
  -h, --help                 Show help

Behavior:
  1) Run risk pre-check against risk-gateway.
  2) If decision=accept: submit live request.
  3) If approval_id returned: second-approve immediately with --second-username.
  4) If pre-check rejects: stop without creating approval.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --account-id) ACCOUNT_ID="$2"; shift 2 ;;
    --symbol) SYMBOL="$2"; shift 2 ;;
    --side) SIDE="$2"; shift 2 ;;
    --lots) LOTS="$2"; shift 2 ;;
    --notional-usd) NOTIONAL_USD="$2"; shift 2 ;;
    --max-spread-bps) MAX_SPREAD_BPS="$2"; shift 2 ;;
    --confidence) CONFIDENCE="$2"; shift 2 ;;
    --rationale) RATIONALE="$2"; shift 2 ;;
    --preferred-venue) PREFERRED_VENUE="$2"; shift 2 ;;
    --username) USERNAME="$2"; shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    --second-username) SECOND_USERNAME="$2"; shift 2 ;;
    --second-password) SECOND_PASSWORD="$2"; shift 2 ;;
    --confirm-live) CONFIRM_LIVE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

if [ "$CONFIRM_LIVE" != "MT5_LIVE_SMOKE" ]; then
  echo "confirmation_missing: pass --confirm-live MT5_LIVE_SMOKE" >&2
  exit 3
fi

if [ -z "$SECOND_USERNAME" ]; then
  echo "second_operator_missing: pass --second-username with a different operator for live second approval" >&2
  exit 8
fi

if [ "$SECOND_USERNAME" = "$USERNAME" ]; then
  echo "second_operator_same_as_first: control-plane requires a different operator for live second approval" >&2
  exit 8
fi

DRY_RUN_CONTRACT_JSON="$(docker exec -i control-plane python3 - <<'PY'
import json
import urllib.request

payload = {
    "account_id": "dry-run-contract",
    "symbol": "BTCUSD",
    "side": "buy",
    "lots": 0.01,
    "estimated_notional_usd": 1.0,
    "max_spread_bps": 999999,
    "system_mode": "managed_live",
    "dry_run": True,
}
req = urllib.request.Request(
    "http://risk-gateway:8001/v1/checks/mt5-order",
    data=json.dumps(payload).encode(),
    headers={"content-type": "application/json"},
)
with urllib.request.urlopen(req, timeout=20) as response:
    body = json.loads(response.read().decode())
print(json.dumps(body))
PY
)"

DRY_RUN_SUPPORTED="$(DRY_RUN_CONTRACT_JSON="$DRY_RUN_CONTRACT_JSON" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["DRY_RUN_CONTRACT_JSON"])
risk_snapshot = payload.get("risk_snapshot") if isinstance(payload.get("risk_snapshot"), dict) else {}
print("1" if risk_snapshot.get("dry_run") is True else "0")
PY
)"

if [ "$DRY_RUN_SUPPORTED" != "1" ]; then
  echo "risk_gateway_dry_run_contract_missing: restart risk-gateway before one-shot precheck" >&2
  echo "$DRY_RUN_CONTRACT_JSON" | python3 -m json.tool >&2
  exit 9
fi

PRECHECK_JSON="$(docker exec -i \
  -e ACCOUNT_ID="$ACCOUNT_ID" \
  -e SYMBOL="$SYMBOL" \
  -e SIDE="$SIDE" \
  -e LOTS="$LOTS" \
  -e NOTIONAL_USD="$NOTIONAL_USD" \
  -e MAX_SPREAD_BPS="$MAX_SPREAD_BPS" \
  control-plane python3 - <<'PY'
import json
import os
import urllib.request

payload = {
    "account_id": os.environ["ACCOUNT_ID"],
    "symbol": os.environ["SYMBOL"],
    "side": os.environ["SIDE"],
    "lots": float(os.environ["LOTS"]),
    "estimated_notional_usd": float(os.environ["NOTIONAL_USD"]),
    "max_spread_bps": int(float(os.environ["MAX_SPREAD_BPS"])),
    "system_mode": "managed_live",
    "dry_run": True,
}

req = urllib.request.Request(
    "http://risk-gateway:8001/v1/checks/mt5-order",
    data=json.dumps(payload).encode(),
    headers={"content-type": "application/json"},
)
with urllib.request.urlopen(req, timeout=20) as response:
    body = json.loads(response.read().decode())

print(
    json.dumps(
        {
            "input": payload,
            "decision": body.get("decision"),
            "reasons": body.get("reasons") or [],
            "approved_notional_usd": body.get("approved_notional_usd"),
            "risk_snapshot": body.get("risk_snapshot") or {},
        }
    )
)
PY
)"

DECISION="$(PRECHECK_JSON="$PRECHECK_JSON" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["PRECHECK_JSON"])
print(str(data.get("decision") or "").strip().lower())
PY
)"

echo "$PRECHECK_JSON" | python3 -m json.tool

if [ "$DECISION" != "accept" ]; then
  echo "precheck_rejected: no submit, no approval created" >&2
  exit 10
fi

PASSWORD_ARGS=()
if [ -n "$PASSWORD" ]; then
  PASSWORD_ARGS=(--password "$PASSWORD")
fi
SECOND_PASSWORD_ARGS=()
if [ -n "$SECOND_PASSWORD" ]; then
  SECOND_PASSWORD_ARGS=(--password "$SECOND_PASSWORD")
fi

SUBMIT_RAW="$(
  CONFIRM_LIVE="$CONFIRM_LIVE" \
  USERNAME="$USERNAME" \
  PASSWORD="$PASSWORD" \
  "$SCRIPT_DIR/mt5_live_operator_smoke.sh" \
    --confirm-live "$CONFIRM_LIVE" \
    --account-id "$ACCOUNT_ID" \
    --symbol "$SYMBOL" \
    --side "$SIDE" \
    --lots "$LOTS" \
    --notional-usd "$NOTIONAL_USD" \
    --max-spread-bps "$MAX_SPREAD_BPS" \
    --confidence "$CONFIDENCE" \
    --preferred-venue "$PREFERRED_VENUE" \
    --rationale "$RATIONALE" \
    --username "$USERNAME" \
    "${PASSWORD_ARGS[@]}" \
    --print-raw
)"

APPROVAL_ID="$(SUBMIT_RAW="$SUBMIT_RAW" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["SUBMIT_RAW"])
print(str(payload.get("approval_id") or "").strip())
PY
)"

if [ -z "$APPROVAL_ID" ]; then
  echo "submit_without_approval_id" >&2
  echo "$SUBMIT_RAW" | python3 -m json.tool
  exit 11
fi

APPROVE_RAW="$(
  CONFIRM_LIVE="$CONFIRM_LIVE" \
  USERNAME="$SECOND_USERNAME" \
  PASSWORD="$SECOND_PASSWORD" \
  "$SCRIPT_DIR/mt5_live_operator_smoke.sh" \
    --confirm-live "$CONFIRM_LIVE" \
    --approve "$APPROVAL_ID" \
    --username "$SECOND_USERNAME" \
    "${SECOND_PASSWORD_ARGS[@]}" \
    --print-raw
)"

PRECHECK_JSON="$PRECHECK_JSON" SUBMIT_RAW="$SUBMIT_RAW" APPROVE_RAW="$APPROVE_RAW" python3 - <<'PY'
import json
import os

summary = {
    "precheck": json.loads(os.environ["PRECHECK_JSON"]),
    "submit": json.loads(os.environ["SUBMIT_RAW"]),
    "approve": json.loads(os.environ["APPROVE_RAW"]),
}
print(json.dumps(summary, indent=2))
PY
