#!/usr/bin/env python3
"""Launch one controlled outcome campaign only after a fresh reaction.

This is a diagnostic guard for the production edge-map window: it keeps the
reaction lookback at 300 seconds and only creates simulated fills when the latest
BTCUSDT reaction is still inside that window. Optional target filters can restrict
collection to a specific reaction/regime cell replication.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = ROOT / "logs"
REACTION_LOG = LOG_DIR / "reaction_speed_engine.jsonl"
STATE_FILE = Path(os.getenv("REACTION_GATED_STATE_FILE", str(LOG_DIR / "reaction_gated_campaign10_state.json")))
CAMPAIGN_LOG = Path(os.getenv("REACTION_GATED_LOG", str(LOG_DIR / "reaction_gated_campaign10.log")))

VENUES = tuple(
    venue.strip()
    for venue in os.getenv("REACTION_GATED_VENUES", "binance-public,coinbase-public").split(",")
    if venue.strip()
)
INSTRUMENT = "BTCUSDT"
MAX_REACTION_AGE_SEC = int(os.getenv("REACTION_GATED_MAX_AGE_SEC", "300"))
ORDER_COUNT = int(os.getenv("REACTION_GATED_ORDER_COUNT", "10"))
MIN_SUCCESS = int(os.getenv("REACTION_GATED_MIN_SUCCESS", str(ORDER_COUNT)))
NOTIONAL_USD = float(os.getenv("REACTION_GATED_NOTIONAL_USD", "5.0"))
CAMPAIGN_PREFIX = os.getenv("REACTION_GATED_CAMPAIGN_PREFIX", "rg10")
TARGET_REACTION_CLASSES = tuple(
    item.strip().upper()
    for item in os.getenv("REACTION_GATED_TARGET_CLASSES", "").split(",")
    if item.strip()
)
TARGET_REGIMES = tuple(
    item.strip().upper()
    for item in os.getenv("REACTION_GATED_TARGET_REGIMES", "").split(",")
    if item.strip()
)
MATURITY_DECISION_PREFIXES = tuple(
    item.strip()
    for item in os.getenv("REACTION_GATED_MATURITY_PREFIXES", "rg10-,rg50-,cellrep50-").split(",")
    if item.strip()
)
ALLOW_MULTIPLE_CAMPAIGNS = os.getenv("REACTION_GATED_ALLOW_MULTIPLE", "0").strip().lower() in {"1", "true", "yes", "on"}
MAX_CAMPAIGN_HISTORY = int(os.getenv("REACTION_GATED_MAX_HISTORY", "50"))


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def log(message: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with CAMPAIGN_LOG.open("a", encoding="utf-8") as fh:
        fh.write(f"[{iso_z(utc_now())}] {message}\n")


def run(cmd: list[str], *, input_text: str | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        cmd,
        input=input_text,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=str(ROOT),
        timeout=120,
    )
    if check and result.returncode != 0:
        raise RuntimeError(f"command failed rc={result.returncode}: {' '.join(cmd)}\n{result.stdout}")
    return result


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(state: dict[str, Any]) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def reaction_event_key(reaction: dict[str, Any] | None) -> str | None:
    if not reaction:
        return None
    venue = str(reaction.get("venue") or "")
    instrument = str(reaction.get("instrument") or INSTRUMENT)
    event_time = str(reaction.get("event_time") or "")
    reaction_class = str(reaction.get("reaction_class") or "")
    if not venue or not event_time:
        return None
    return "|".join([venue, instrument, event_time, reaction_class])


def processed_event_keys(state: dict[str, Any]) -> set[str]:
    keys = {str(item) for item in state.get("processed_event_keys", []) if item}
    previous_reaction = state.get("reaction") if isinstance(state.get("reaction"), dict) else None
    previous_key = reaction_event_key(previous_reaction)
    if state.get("launched") and previous_key:
        keys.add(previous_key)
    return keys


def remember_campaign(state: dict[str, Any], *, event_key: str, campaign: dict[str, Any], reaction: dict[str, Any]) -> None:
    keys = list(processed_event_keys(state))
    if event_key not in keys:
        keys.append(event_key)
    state["processed_event_keys"] = keys[-MAX_CAMPAIGN_HISTORY:]

    history = state.get("campaign_history") if isinstance(state.get("campaign_history"), list) else []
    target_regime = reaction.get("target_regime") if isinstance(reaction.get("target_regime"), dict) else {}
    history.append({
        "campaign_id": campaign.get("campaign_id"),
        "event_key": event_key,
        "event_time": reaction.get("event_time"),
        "reaction_class": reaction.get("reaction_class"),
        "regime": target_regime.get("regime"),
        "venue": reaction.get("venue"),
        "success_count": len(campaign.get("successes") or []),
        "failure_count": len(campaign.get("failures") or []),
        "updated_at": iso_z(utc_now()),
    })
    state["campaign_history"] = history[-MAX_CAMPAIGN_HISTORY:]


def refresh_reactions() -> None:
    since = iso_z(utc_now() - timedelta(minutes=20))
    for venue in VENUES:
        result = run([
            "docker", "exec", "-i", "control-plane", "python3",
            "/workspace/scripts/reaction_speed_engine.py",
            "--venue", venue,
            "--instrument", INSTRUMENT,
            "--since", since,
            "--emit-since", since,
            "--output", "/workspace/logs/reaction_speed_engine.jsonl",
        ])
        log(f"refresh_reaction venue={venue} rc={result.returncode} tail={result.stdout.splitlines()[-1:]}")


def latest_reaction() -> dict[str, Any] | None:
    if not REACTION_LOG.exists():
        return None
    best: tuple[datetime, dict[str, Any]] | None = None
    with REACTION_LOG.open("r", encoding="utf-8") as fh:
        for line in fh:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("venue") not in VENUES or row.get("instrument") != INSTRUMENT or not row.get("event_time"):
                continue
            ts = parse_ts(str(row["event_time"]))
            if best is None or ts > best[0]:
                best = (ts, row)
    if best is None:
        return None
    age = (utc_now() - best[0]).total_seconds()
    reaction = dict(best[1])
    reaction["age_sec"] = age
    return reaction


def refresh_clean_and_regime(reaction: dict[str, Any]) -> None:
    since = iso_z(utc_now() - timedelta(days=1))
    for venue in VENUES:
        run([
            "docker", "exec", "-i", "control-plane", "python3",
            "/workspace/scripts/rebuild_candles_from_trades.py",
            "--venue", venue,
            "--instrument", INSTRUMENT,
            "--since", since,
            "--timeframes", "60",
            "--write-db",
            "--no-jsonl",
        ])
        run([
            "docker", "exec", "-i", "control-plane", "python3",
            "/workspace/scripts/regime_engine.py",
            "--venue", venue,
            "--instrument", INSTRUMENT,
            "--timeframe", "1m",
            "--since", since,
            "--emit-since", since,
            "--output", "/workspace/logs/regime_engine.jsonl",
        ])


def latest_regime_for_reaction(reaction: dict[str, Any]) -> dict[str, Any] | None:
    regime_log = LOG_DIR / "regime_engine.jsonl"
    if not regime_log.exists():
        return None
    target_ts = parse_ts(str(reaction["event_time"]))
    best: tuple[datetime, dict[str, Any]] | None = None
    with regime_log.open("r", encoding="utf-8") as fh:
        for line in fh:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("venue") != reaction.get("venue") or row.get("instrument") != INSTRUMENT or not row.get("window_end"):
                continue
            ts = parse_ts(str(row["window_end"]))
            if ts > target_ts:
                continue
            if (target_ts - ts).total_seconds() > MAX_REACTION_AGE_SEC:
                continue
            if best is None or ts > best[0]:
                best = (ts, row)
    if best is None:
        return None
    regime = dict(best[1])
    regime["age_at_reaction_sec"] = (target_ts - best[0]).total_seconds()
    return regime


def target_reaction_matches(reaction: dict[str, Any]) -> bool:
    if not TARGET_REACTION_CLASSES:
        return True
    return str(reaction.get("reaction_class") or "").upper() in TARGET_REACTION_CLASSES


def target_regime_matches(regime: dict[str, Any] | None) -> bool:
    if not TARGET_REGIMES:
        return True
    if regime is None:
        return False
    return str(regime.get("regime") or "").upper() in TARGET_REGIMES


def post_order(payload: dict[str, Any]) -> dict[str, Any]:
    code = """
import json, sys, urllib.request, urllib.error
url = 'http://127.0.0.1:8002/v1/orders/routed'
payload = json.loads(sys.stdin.read())
request = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers={'content-type':'application/json'})
try:
    with urllib.request.urlopen(request, timeout=40) as response:
        print(json.dumps({'http_status': response.getcode(), 'body': json.load(response)}, separators=(',', ':')))
except urllib.error.HTTPError as exc:
    raw = exc.read().decode('utf-8')
    try:
        body = json.loads(raw)
    except Exception:
        body = {'raw': raw}
    print(json.dumps({'http_status': exc.code, 'body': body}, separators=(',', ':')))
"""
    result = run(["docker", "exec", "-i", "execution-router", "python3", "-c", code], input_text=json.dumps(payload), check=False)
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        return {"http_status": 0, "body": {"error": "empty response", "stdout": result.stdout}}
    return json.loads(lines[-1])


def side_sequence(direction: str) -> list[str]:
    first = "buy" if direction == "up" else "sell"
    second = "sell" if first == "buy" else "buy"
    return [first if index % 2 == 0 else second for index in range(ORDER_COUNT)]


def launch_campaign(reaction: dict[str, Any]) -> dict[str, Any]:
    campaign_id = f"{CAMPAIGN_PREFIX}-{utc_now().strftime('%Y%m%d-%H%M%S')}"
    venue = str(reaction["venue"])
    direction = str(reaction.get("event_direction") or "up")
    successes: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for index, side in enumerate(side_sequence(direction), start=1):
        decision_id = f"{campaign_id}-{index:02d}"
        payload = {
            "symbol": INSTRUMENT,
            "side": side,
            "estimated_notional_usd": NOTIONAL_USD,
            "execution_mode": "controlled_reaction_gated_sim",
            "decision_id": decision_id,
            "order_id": f"order-{decision_id}",
            "preferred_venue": venue,
            "execution_style": "primary_only",
            "metadata": {
                "campaign_id": campaign_id,
                "campaign_type": CAMPAIGN_PREFIX,
                "reaction_event_time": reaction.get("event_time"),
                "reaction_class": reaction.get("reaction_class"),
                "reaction_direction": reaction.get("event_direction"),
                "reaction_trigger_bps": reaction.get("trigger_bps"),
                "target_reaction_classes": list(TARGET_REACTION_CLASSES),
                "target_regimes": list(TARGET_REGIMES),
                "max_reaction_age_sec": MAX_REACTION_AGE_SEC,
            },
        }
        response = post_order(payload)
        body = response.get("body") if isinstance(response.get("body"), dict) else {}
        record = {
            "decision_id": decision_id,
            "http_status": response.get("http_status"),
            "venue": body.get("venue"),
            "status": body.get("status"),
            "filled_notional_usd": body.get("filled_notional_usd"),
        }
        if response.get("http_status") == 200 and body.get("status") == "filled" and body.get("venue") == venue:
            successes.append(record)
        else:
            record["body"] = body
            failures.append(record)
        log(f"order {json.dumps(record, separators=(',', ':'))}")

    return {"campaign_id": campaign_id, "successes": successes, "failures": failures}


def schedule_label_edge(campaign_id: str) -> dict[str, str]:
    unit = f"txt-reaction-gated-label-edge-{campaign_id}"
    log_path = LOG_DIR / f"reaction-gated-{campaign_id}-label-edge.log"
    since = iso_z(utc_now() - timedelta(minutes=10))
    maturity_prefix_args = " ".join(f"--decision-prefix {prefix}" for prefix in MATURITY_DECISION_PREFIXES)
    command = (
        f"cd {ROOT} && "
        f"echo '[begin] '$(date -u +%FT%TZ) > {log_path} && "
        f"LABELER_SINCE={since} LABELER_LIMIT=100 scripts/label_intent_outcomes_cron.sh >> {log_path} 2>&1; "
        f"python3 scripts/edge_map_engine.py --min-count 1 --pnl-field pnl_bps_5m >> {log_path} 2>&1; "
        f"python3 scripts/reaction_regime_cell_maturity.py {maturity_prefix_args} --format json >> {log_path} 2>&1; "
        f"python3 scripts/edge_truth_phase_monitor.py --format json >> {log_path} 2>&1; "
        f"echo '[end] '$(date -u +%FT%TZ) >> {log_path}"
    )
    result = run(["systemd-run", "--on-active=65m", f"--unit={unit}", "/usr/bin/env", "bash", "-lc", command], check=False)
    log(f"schedule_label_edge unit={unit} rc={result.returncode} output={result.stdout.strip()}")
    return {"unit": unit, "log": str(log_path)}


def main() -> int:
    state = load_state()
    if state.get("launched") and not ALLOW_MULTIPLE_CAMPAIGNS:
        log(f"skip already_launched campaign_id={state.get('campaign_id')}")
        return 0

    refresh_reactions()
    reaction = latest_reaction()
    if reaction is None:
        log("skip no_reaction")
        return 0
    if float(reaction["age_sec"]) > MAX_REACTION_AGE_SEC:
        log(f"skip stale_reaction age_sec={reaction['age_sec']:.1f} event_time={reaction.get('event_time')} venue={reaction.get('venue')}")
        return 0
    if not target_reaction_matches(reaction):
        log(
            "skip target_reaction_mismatch "
            f"reaction_class={reaction.get('reaction_class')} targets={','.join(TARGET_REACTION_CLASSES)} "
            f"event_time={reaction.get('event_time')} venue={reaction.get('venue')}"
        )
        return 0
    event_key = reaction_event_key(reaction)
    if event_key and event_key in processed_event_keys(state):
        log(f"skip already_processed_event event_key={event_key} campaign_id={state.get('campaign_id')}")
        return 0
    if state.get("blocked_event_time") == reaction.get("event_time"):
        log(f"skip blocked_event_time event_time={reaction.get('event_time')}")
        return 0

    refresh_clean_and_regime(reaction)
    regime = latest_regime_for_reaction(reaction)
    if not target_regime_matches(regime):
        log(
            "skip target_regime_mismatch "
            f"regime={(regime or {}).get('regime')} targets={','.join(TARGET_REGIMES)} "
            f"event_time={reaction.get('event_time')} venue={reaction.get('venue')}"
        )
        return 0
    if regime is not None:
        reaction["target_regime"] = regime
    campaign = launch_campaign(reaction)
    if len(campaign["successes"]) < MIN_SUCCESS:
        state.update({
            "launched": False,
            "blocked_event_time": reaction.get("event_time"),
            "last_failure": campaign,
            "reaction": reaction,
            "updated_at": iso_z(utc_now()),
        })
        save_state(state)
        log(f"campaign_incomplete {json.dumps(campaign, separators=(',', ':'))}")
        return 1

    deferred = schedule_label_edge(str(campaign["campaign_id"]))
    if event_key:
        remember_campaign(state, event_key=event_key, campaign=campaign, reaction=reaction)
    state.update({
        "launched": True,
        "complete": len(campaign["successes"]) >= ORDER_COUNT,
        "min_success_met": len(campaign["successes"]) >= MIN_SUCCESS,
        "allow_multiple": ALLOW_MULTIPLE_CAMPAIGNS,
        "success_count": len(campaign["successes"]),
        "failure_count": len(campaign["failures"]),
        "min_success": MIN_SUCCESS,
        "campaign_id": campaign["campaign_id"],
        "reaction": reaction,
        "campaign": campaign,
        "deferred": deferred,
        "updated_at": iso_z(utc_now()),
    })
    save_state(state)
    log(f"campaign_launched {json.dumps(state, separators=(',', ':'))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())