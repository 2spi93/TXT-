# TXT Proof Reactivation Runbook

Date: 2026-06-05

Purpose: move TXT from stale proof back to recent market-touching proof. This runbook is about producing fresh evidence, not adding more governance.

## Current Verdict

TXT does not currently prove that it makes real money today.

Current gates:

```text
fresh_proven=false
operational_v1_proven=false
strict_v1_proven=false
real_money_positive=false
```

Current minimum target:

```text
1 recent ACK
1 recent FILL
1 recent OUTCOME
1 recent GAP
```

Money target before calling this Alpha Engine:

```text
>= 10 recent real-money trades
net_pnl_usd > 0
positive expectancy
controlled drawdown
```

Final objective:

```text
BATTRE LE MARCHE
```

Current operational objective is lower and stricter: produce one complete real loop, then enough real trades to learn from. Until then, adding sentiment, macro/news, RL, LLM trading, or new strategy families is scope creep.

## Hard Safety Rule

Do not run a live order command unless an operator explicitly approves that specific live run.

Live-capable commands include:

```bash
bash scripts/mt5_live_operator_smoke.sh --confirm-live MT5_LIVE_SMOKE ...
bash scripts/mt5_spread_gated_one_shot.sh --confirm-live MT5_LIVE_SMOKE ...
bash scripts/bingx_live_smoke.sh --confirm-live BINGX_LIVE_SMOKE ...
```

The default MT5 path is the two-step operator smoke, because it preserves second approval. The one-shot script is not the default path because it automatically second-approves after risk pre-check approval.

If the one-shot path is used, it first probes the runtime `risk-gateway` dry-run contract with a deliberately rejected check. If `risk_snapshot.dry_run=true` is missing, it aborts before the real precheck so the precheck cannot consume risk budget/exposure on older runtime code.

## Phase 0: Prove The Gap Still Exists

Run the offline gates first:

```bash
python3 scripts/proof_lifecycle_snapshot.py --audit
python3 scripts/proof_lifecycle_snapshot.py --recommend
python3 scripts/money_reality_audit.py --text --hours 24 --check real-money-positive
python3 scripts/recent_real_proof_audit.py --text --hours 24 --check ack --check fill --check outcome --check gap --check linked-loop
```

Expected current result:

```text
fresh=no
operational=no
strict=no
real_trades=0
failed_checks=real-money-positive
Recent Real Proof: status=REAL_PROOF_STALE ack=0 fill=0 outcome=0 gap=0 linked=0
```

If this unexpectedly passes, stop and inspect the new real-money rows before any live action.

## Phase 1: Read-Only Preflight

Run the MT5 continuity preflight:

```bash
bash scripts/mt5_reality_gap_preflight.sh
```

This script is read-only. It checks edge evidence, local/control-plane MT5 health, MT5 bridge continuity, route continuity, the target MT5 account, and the relevant database tables.

Required before live MT5:

```text
mt5 bridge healthy
target account visible
account status connected
broker_session.execution_url present
risk-gateway reachable
risk-gateway MT5 dry_run contract active
route resolves to MT5 for the intended symbol
```

If any of these fail, do not submit a live order. Fix continuity first.

Latest read-only preflight result on 2026-06-05:

```text
edge_evidence=STRUCTURAL
micro_trade_gate.ready=true
mt5_bridge.mode=live
mt5_bridge.status=ok
account_541283177=true
account_status=connected
broker_session=true
route_exists=true
execution_fill_events.latest=2026-06-05 13:23:41 UTC
mt5_order_events.latest=2026-05-17 18:37:01 UTC
reality_gap_samples.latest=2026-05-17 18:36:44 UTC
```

Interpretation: continuity is good enough for an operator-approved smoke, but the real MT5/GAP proof loop is stale. A new live attempt should be judged by whether it renews MT5 order events and reality gap samples, not merely by whether the bridge is healthy.

## Phase 2: Produce Broker ACK/FILL

Preferred MT5 path:

```bash
bash scripts/mt5_live_operator_smoke.sh \
  --confirm-live MT5_LIVE_SMOKE \
  --account-id 541283177 \
  --symbol AUTO \
  --side buy \
  --lots 0.01 \
  --notional-usd 5 \
  --max-spread-bps 10 \
  --confidence 0.8 \
  --rationale "TXT proof reactivation smoke"
```

Expected first result:

```text
status=pending_second_approval
approval_id=<id>
```

Second operator approval, only after checking the first response:

```bash
bash scripts/mt5_live_operator_smoke.sh \
  --confirm-live MT5_LIVE_SMOKE \
  --username <second_operator_username> \
  --approve <approval_id>
```

The second approval must use a different `--username` than the first submitter. The control-plane rejects same-operator second approval.

Required evidence:

```text
broker ACK is recent
broker FILL is recent
broker_ticket is present
bridge_mode is live or broker-backed, not paper
realized execution fields are persisted
```

## Phase 3: Produce OUTCOME And GAP

After the broker event, refresh the non-publishing snapshot and lifecycle views:

```bash
REMEDIATION_SNAPSHOT_PUBLISH=0 bash scripts/remediation_snapshot_daily.sh
python3 scripts/proof_lifecycle_snapshot.py --audit
python3 scripts/recent_real_proof_audit.py --text --hours 24 --check ack --check fill --check outcome --check gap --check linked-loop
python3 scripts/money_reality_audit.py --text --hours 24
```

Required evidence:

```text
recent outcome row exists
recent reality_gap sample exists
recent ACK/FILL/OUTCOME/GAP are linked by broker_ticket/decision_id
proof_lifecycle fresh moves toward yes
money audit sees real-money rows
```

If ACK/FILL appear but OUTCOME/GAP do not, the next task is not another trade. The next task is fixing the decision-to-outcome-to-gap ingestion chain for that decision id.

## Phase 4: Accumulate Money Evidence

Do not call one micro-fill alpha.

Minimum Alpha Engine candidate gate:

```bash
python3 scripts/money_reality_audit.py --text --hours 168 --min-real-trades 10 --check real-money-positive
python3 scripts/alpha_engine_report.py --text --days 30 --min-trades 50 --check alpha
```

Pass means only:

```text
TXT has recent positive real-money evidence.
TXT has a recent real-money alpha candidate report.
```

It does not yet mean:

```text
TXT beats the market.
TXT is stable over regimes.
TXT is ready for larger size.
```

Those require multi-week real execution, benchmark comparison, drawdown control, and live route reliability.

## BingX Secondary Path

BingX smoke remains useful for proving live connector reachability:

```bash
bash scripts/bingx_live_smoke.sh \
  --confirm-live BINGX_LIVE_SMOKE \
  --account-id 29586394 \
  --symbol BTCUSDT \
  --side buy \
  --notional-usd 7.5
```

This path places a tiny live limit order and cancels it if still open. It may prove live create/cancel, but it may not produce a real FILL/OUTCOME/GAP. For this week's objective, prefer MT5 if the goal is a full ACK/FILL/OUTCOME/GAP proof loop.

## Stop Conditions

Stop live attempts immediately if any of these occur:

```text
broker_session.execution_url missing
account not connected
risk pre-check rejects
market closed or symbol not tradable
spread exceeds max_spread_bps
ACK without persisted broker ticket
FILL without outcome ingestion
GAP ingestion fails for the decision id
```

The correct response to a stop condition is to repair the broken chain, not to increase order count.
