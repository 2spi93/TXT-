# TXT Money Reality and Alpha Engine Pivot

Current reading from `logs/intent_outcome_labels.jsonl` and `logs/spread_audit/remediation_snapshot_latest.json` on 2026-06-05.

## Verdict

TXT does not currently prove that it makes real money today.

TXT proves that it can observe, label, explain, audit, and govern market/execution evidence. That is a foundation, not a return stream.

The project objective is now explicit:

```text
Beat the market.
```

The current blocker is not architecture. The current blocker is unknown real alpha.

## Money Reality

Offline command:

```bash
python3 scripts/money_reality_audit.py --text --check real-money-positive
```

Current 24h reading:

```text
Money Reality: status=REAL_MONEY_NOT_PROVEN real_trades=0 real_net=$0.00000000 sim_trades=6666 sim_net=$2.71300385 sim_win_rate=50.41% sim_expectancy=$0.00040699 sim_profit_factor=1.0666
failed_checks=real-money-positive
exit=2
```

All-time reading is also not sufficient:

```text
real_trades=1
real_net=$0.00229000
status=REAL_MONEY_NOT_PROVEN
failed_checks=real-money-positive
```

The only all-time real-money row found is a BingX micro-live trade from 2026-04-19, labeled neutral at 5m and proxy-based. It is not evidence of continuous profitability.

## Current Separation

| Layer | Current evidence | Verdict |
| --- | --- | --- |
| Proof lifecycle | Stale, not invalidated | Useful governance |
| Real money PnL, 24h | 0 real trades | Not proven |
| Simulated/public PnL, 24h | Slightly positive | Not real yield |
| Structural edge | Mature cells exist | Candidate alpha only |
| Broker reality | Last real fill is old | Must be reactivated |

## This Week's Objective

Single objective:

```text
Reactivate the proof-producing trading loop.
```

Minimum target:

```text
1 recent ACK
1 recent FILL
1 recent OUTCOME
1 recent GAP
```

Money target:

```text
>= 10 recent real-money trades
net_pnl_usd > 0
real-money-positive gate passes
```

## Alpha Engine Gates

Use these commands during observation:

```bash
python3 scripts/proof_lifecycle_snapshot.py --audit --check fresh
python3 scripts/proof_lifecycle_snapshot.py --audit --check operational
python3 scripts/money_reality_audit.py --text --check real-money-positive
python3 scripts/alpha_engine_report.py --text --days 30 --min-trades 50 --check alpha
```

Current expected behavior:

```text
fresh => fail
operational => fail
real-money-positive => fail
alpha => fail
```

The next category shift only happens when real recent trades exist and the money gate starts passing.

Current 30d Alpha Engine reading:

```text
Alpha Engine 30D: status=ALPHA_NOT_PROVEN real_trades=0 net=$0.00000000 pf=0.0000 expectancy=$0.00000000 hit_rate=0.00% drawdown=$0.00000000 roc=n/a
Recent Real Proof 30D: status=REAL_PROOF_STALE ack=4 fill=0 outcome=3 gap=3 linked=0
```

Interpretation: the 30d blocker is not observability. It is the missing recent real FILL and therefore the missing linked ACK/FILL/OUTCOME/GAP loop.

## Alpha Engine V2 Sprints

Sprint 1: Proof Renewal.

Goal:

```text
fresh_proven=true
1 recent ACK
1 recent FILL
1 recent OUTCOME
1 recent GAP
```

Sprint 2: Real Trading Validation.

Goal:

```text
100 recent real-money trades before operational Alpha Engine V2
20 active days with at least 1 timestamped real-money trade
Profit Factor > 1
Expectancy > 0
Drawdown controlled
```

Command:

```bash
python3 scripts/alpha_engine_report.py --text --days 30 --min-trades 50 --check alpha
python3 scripts/alpha_reactivation_board.py --hours 720 --check alpha-v2
```

The Alpha Engine 30D report can become an alpha candidate at 50 real trades, but operational V2 engines remain blocked until `REAL_100`, 20 active days, and `Profit Factor > 1` are all done.

First V2 engine after `REAL_100`:

```text
Alpha Attribution Engine
```

First survival constraint before scale-up:

```text
Controlled drawdown plus alpha-decay guard.
```

Sprint 3: Alpha Validation.

Goal:

```text
TXT > benchmark over a statistically meaningful window
```

The current Alpha Engine report does not claim benchmark outperformance. It only answers whether recent real-money performance is even positive enough to become an alpha candidate.

## What Not To Do Next

Do not spend the next cycle adding more proof dashboards.

Do not claim alpha from public/simulated fills.

Do not treat structural edge as profit.

Do not optimize governance while the real-money loop is inactive.

## What To Do Next

1. Reproduce a real broker ACK/FILL.
2. Link that fill to a decision outcome.
3. Produce a recent reality gap sample.
4. Accumulate at least 10 real-money outcome rows.
5. Accumulate 50 real-money outcome rows for Alpha Engine 30D candidate evaluation.
6. Accumulate 100 real-money outcome rows across 20 active days before Alpha Engine V2 activation.
7. Run targeted Latency, Refusal, and Attribution audits.
8. Build Alpha Attribution Engine before allocation, opportunity cost, market memory, competition, opportunity, regime V2, or full alpha decay.
9. Permit Capital Allocation to reduce or pause strategies early, but do not permit material capital scale-up until attribution and alpha-decay guard exist.

Operational runbook:

```text
TXT_ALPHA_REACTIVATION.md
TXT_ALPHA_ENGINE_V2_SELECTION_ARCHITECTURE.md
TXT_ALPHA_ENGINE_V2_ACTIVATION_ROADMAP.md
TXT_PROOF_REACTIVATION_RUNBOOK.md
```

Only then does TXT move from:

```text
Evidence Lifecycle Engine
```

to:

```text
Alpha Engine
```
