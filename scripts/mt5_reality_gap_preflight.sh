#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PREFLIGHT_HTTP_TIMEOUT="${PREFLIGHT_HTTP_TIMEOUT:-15}"

python3 - <<'PY'
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

PREFLIGHT_HTTP_TIMEOUT = max(3, min(60, int(float(os.getenv("PREFLIGHT_HTTP_TIMEOUT", "15")))))

def read_edge_evidence() -> dict:
    path = Path("logs/reaction_regime_cell_maturity.json")
    if not path.exists():
        return {"available": False, "state": "UNAVAILABLE", "summary": "cell maturity snapshot missing"}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"available": False, "state": "UNAVAILABLE", "summary": f"cell maturity snapshot unreadable: {exc}"}
    evidence = payload.get("edge_evidence") if isinstance(payload.get("edge_evidence"), dict) else {}
    diagnostics = payload.get("diagnostics") if isinstance(payload.get("diagnostics"), dict) else {}
    return {
        "available": True,
        "state": evidence.get("state") or diagnostics.get("edge_evidence_state") or "UNKNOWN",
        "summary": evidence.get("summary"),
        "cell_count": diagnostics.get("cell_count", 0),
        "replicated_cells": diagnostics.get("replicated_cells", 0),
        "mature_cells": diagnostics.get("mature_cells", 0),
        "outcomes_with_both": diagnostics.get("outcomes_with_both", 0),
    }


def fetch_json(url: str, timeout: int = PREFLIGHT_HTTP_TIMEOUT) -> dict:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return {"ok": 200 <= response.status < 300, "status": response.status, "body": json.load(response)}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(raw)
        except Exception:
            body = {"raw": raw}
        return {"ok": False, "status": exc.code, "body": body}
    except Exception as exc:
        return {"ok": False, "status": 0, "body": {"error": str(exc)}}


edge = read_edge_evidence()
mt5_health = fetch_json("http://127.0.0.1:8000/v1/mt5/health")
print(json.dumps({"section": "edge_evidence", **edge}, sort_keys=True))
print(json.dumps({"section": "mt5_health", **mt5_health}, sort_keys=True, default=str))

gate_reasons = []
if edge.get("state") != "STRUCTURAL":
    gate_reasons.append(f"edge_not_structural:{edge.get('state')}")
if not mt5_health.get("ok") and mt5_health.get("status") != 401:
    gate_reasons.append("mt5_health_unavailable")

print(json.dumps({
    "section": "micro_trade_gate",
    "ready": not gate_reasons,
    "reasons": gate_reasons,
    "required_edge_state": "STRUCTURAL",
    "note": "read-only preflight; this script never submits live orders",
}, sort_keys=True))
PY

docker exec -i -e PREFLIGHT_HTTP_TIMEOUT="$PREFLIGHT_HTTP_TIMEOUT" control-plane python3 - <<'PY'
import json
import os
import urllib.error
import urllib.request

PREFLIGHT_HTTP_TIMEOUT = max(3, min(60, int(float(os.getenv("PREFLIGHT_HTTP_TIMEOUT", "15")))))

def fetch_json(url: str, timeout: int = PREFLIGHT_HTTP_TIMEOUT) -> dict:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return {"ok": 200 <= response.status < 300, "status": response.status, "body": json.load(response)}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(raw)
        except Exception:
            body = {"raw": raw}
        return {"ok": False, "status": exc.code, "body": body}
    except Exception as exc:
        return {"ok": False, "status": 0, "body": {"error": str(exc)}}

try:
    with urllib.request.urlopen("http://mt5-bridge:8006/health", timeout=PREFLIGHT_HTTP_TIMEOUT) as response:
        body = json.load(response)
        print(json.dumps({"section": "mt5_bridge_health", "ok": 200 <= response.status < 300, "status": response.status, "body": body}, sort_keys=True, default=str))
except urllib.error.HTTPError as exc:
    raw = exc.read().decode("utf-8", errors="replace")
    try:
        body = json.loads(raw)
    except Exception:
        body = {"raw": raw}
    print(json.dumps({"section": "mt5_bridge_health", "ok": False, "status": exc.code, "body": body}, sort_keys=True, default=str))
except Exception as exc:
    print(json.dumps({"section": "mt5_bridge_health", "ok": False, "status": 0, "body": {"error": str(exc)}}, sort_keys=True, default=str))

target_account_id = "MT5_ACCOUNT_ID_REQUIRED"
route_probe = fetch_json("http://execution-router:8002/v1/routes/score?symbol=BTCUSDT")
bridge_probe = fetch_json("http://mt5-bridge:8006/health")
account_probe = fetch_json(f"http://mt5-bridge:8006/v1/accounts/{target_account_id}")

route_body = route_probe.get("body") if isinstance(route_probe.get("body"), dict) else {}
route_best = route_body.get("best") if isinstance(route_body.get("best"), dict) else {}
route_exists = bool(route_best)

account_body = account_probe.get("body") if isinstance(account_probe.get("body"), dict) else {}
account_data = account_body.get("account") if isinstance(account_body.get("account"), dict) else {}
account_status = str(account_data.get("status") or "").strip().lower()
account_id = str(account_data.get("account_id") or "").strip()

bridge_health = bool(bridge_probe.get("ok"))
executor_reachable = bool(account_probe.get("ok"))
broker_session = account_status == "connected"
account_ok = account_id == target_account_id and broker_session

print(json.dumps({
    "section": "mt5_continuity_phase1a",
    "route_exists": route_exists,
    "bridge_health": bridge_health,
    "executor_reachable": executor_reachable,
    "broker_session": broker_session,
    "account_MT5_ACCOUNT_ID_REQUIRED": account_ok,
    "target_account": target_account_id,
    "route_probe": {
        "ok": bool(route_probe.get("ok")),
        "status": route_probe.get("status"),
        "best_route_venue": route_best.get("venue") if isinstance(route_best, dict) else None,
    },
    "account_probe": {
        "ok": bool(account_probe.get("ok")),
        "status": account_probe.get("status"),
        "account_id": account_id or None,
        "status_text": account_status or None,
    },
    "note": "phase 1A continuity check only; no order submitted",
}, sort_keys=True, default=str))
PY

docker exec -i control-plane python3 - <<'PY'
import json
import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row


def db_url() -> str:
    value = os.environ.get("DATABASE_URL")
    if value:
        return value
    for candidate in (Path("/run/secrets/database_url"), Path("/workspace/secrets/database_url")):
        if candidate.exists():
            return candidate.read_text(encoding="utf-8").strip()
    raise RuntimeError("database url unavailable")


def table_exists(cur, table: str) -> bool:
    cur.execute("SELECT to_regclass(%s) AS table_name", (table,))
    row = cur.fetchone()
    return bool(row and row.get("table_name"))


summary = {"section": "database_truth", "tables": {}}
with psycopg.connect(db_url()) as conn:
    with conn.cursor(row_factory=dict_row) as cur:
        for table in ("reality_gap_samples", "mt5_order_events", "internal_account_verification", "execution_fill_events"):
            if not table_exists(cur, table):
                summary["tables"][table] = {"exists": False}
                continue
            cur.execute(f"SELECT COUNT(*) AS count FROM {table}")
            count = int(cur.fetchone()["count"])
            info = {"exists": True, "count": count}
            for column in ("created_at", "updated_at", "filled_at", "ts"):
                try:
                    cur.execute(f"SELECT MAX({column}) AS latest FROM {table}")
                    info[f"latest_{column}"] = cur.fetchone()["latest"]
                    break
                except Exception:
                    conn.rollback()
            summary["tables"][table] = info
print(json.dumps(summary, sort_keys=True, default=str))
PY
