# TXT Alpha Reactivation

Purpose: keep TXT focused on real trading proof and recent alpha measurement.

## Summit Objective

```text
BATTRE LE MARCHE
```

This is not proven by architecture, governance, simulations, dashboards, or paper fills. It is proven only by sustained real-money alpha against a relevant benchmark, with controlled drawdown and enough trades to separate skill from noise.

## Freeze

Freeze these unless fixing a concrete blocker:

```text
Proof Governance
MC/DC
Condition Lifecycle
Unknown Eradication
Evidence dashboards
New strategy sprawl
```

The risk is no longer technical inability to observe. The risk is perfect observability with zero real trades.

## Board

Run:

```bash
python3 scripts/alpha_reactivation_board.py --hours 720
```

Board rows:

```text
ACK
FILL
OUTCOME
GAP
LINKED_LOOP
REAL_10
REAL_50
REAL_100
ALPHA_30D
```

Operational order:

```text
1. Produce 1 recent ACK
2. Produce 1 recent real FILL
3. Produce 1 recent OUTCOME
4. Produce 1 recent GAP
5. Link ACK/FILL/OUTCOME/GAP by broker_ticket/decision_id
6. Produce 10 real trades
7. Produce 50 real trades
8. Produce 100 real trades
9. Survive the sample: controlled drawdown, controlled risk, preserved capital
10. Run Alpha Engine 30D
```

## TXT V2 Priority

Do not add many new strategies before real trading resumes.

Priority order:

```text
1. Reactivate real proof
2. Complete linked ACK/FILL/OUTCOME/GAP loop
3. Accumulate 10 real trades
4. Accumulate 50 real trades
5. Accumulate 100 real trades
6. Alpha Attribution Engine
7. Capital Allocation Engine, with no scale-up before a decay guard exists
8. Opportunity Cost Engine
9. Strategy Competition Engine
10. Opportunity Engine
11. Regime Switching Engine V2
12. Alpha Decay Engine
13. New quantitative strategies only after alpha is measured
```

Alpha Engine V2 is blocked until all three gates pass:

```text
REAL_100
20 active days with at least 1 timestamped real trade
Profit Factor > 1
```

Run:

```bash
python3 scripts/alpha_reactivation_board.py --hours 720 --check alpha-v2
```

The first allowed V2 engine is `Alpha Attribution Engine`. A same-day batch of 100 trades is not enough; attribution starts only when there is something durable enough to attribute.

The first strategic question after 100 real trades is not "what new signal can be added?" It is:

```text
Why did TXT make or lose money?
```

The second is:

```text
When should TXT stop trusting a strategy?
```

Capital allocation can move only after those answers are visible enough to avoid rewarding randomness.

Immediately after `REAL_100`, run only targeted audits:

```text
Latency Audit
Refusal Audit
Attribution Audit
```

Route cleanup, UI cleanup, and surface cleanup happen after those audits, not before the first real FILL.

Detailed post-reactivation architecture:

```text
TXT_ALPHA_ENGINE_V2_SELECTION_ARCHITECTURE.md
```

## Current Meaning

If:

```text
real_trades=0
```

then:

```text
TXT market outperformance is unanswered.
```

The next useful win is not a new proof layer. It is a recent Alpha Engine report containing real trades.

Deferred until measured alpha exists:

```text
Advanced sentiment
Geopolitics
Macro/news expansion
LLM trading
RL trading
Advanced self-evolution
```
