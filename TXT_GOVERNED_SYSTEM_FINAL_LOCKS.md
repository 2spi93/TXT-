# TXT Governed System Final Locks

## Current Truth

TXT now distinguishes data volume from knowledge maturity.

Current controlled evidence state:

```text
outcomes_with_both = 84
cell_count = 3
replicated_cells = 0
mature_cells = 0
edge_evidence_state = EXPLORATORY
```

Interpretation:

- Reaction + Regime + Outcome joining is validated.
- Cell replication is not validated.
- Edge evidence is not validated.
- Runtime Truth can now say: data exists, but proof does not.

## Edge Evidence Ladder

| State | Condition | Operator meaning |
| --- | --- | --- |
| `NO_REPLICATED_CELLS` | No complete cells | No causal cell can be evaluated |
| `EXPLORATORY` | Complete cells exist, `replicated_cells = 0` | Observe only; no replicated evidence |
| `EMERGING` | `replicated_cells >= 1`, `mature_cells = 0` | A cell repeated, but is not mature |
| `EVIDENCED` | `mature_cells >= 1` | At least one cell reached `event_count >= 3` |
| `STRUCTURAL` | Multiple mature cells cohere by regime and pnl direction | Evidence is broader than one mature cell |

This ladder must be ranked before sample count and before pnl performance.

## What TXT Already Has

- Runtime Truth
- Observation Truth
- Edge Evidence State
- Reaction Engine
- Regime Engine
- Outcome Labeler
- Edge Map
- Mission Control
- Live Ops
- MT5 connectivity
- Kairos to MT5 route
- FTMO connectivity
- Watchdogs
- Kill Switch
- Controlled Collection
- Event Count
- Cell Maturity
- Cognitive Physics plan

## Remaining Major Locks

### 1. Causal Replication

Current state:

```text
cell_count = 3
replicated_cells = 0
mature_cells = 0
```

Next gates:

```text
replicated_cells > 0
mature_cells > 0
```

Until then, `edge_evidence_state = EXPLORATORY` is the correct truth.

Active automation:

- `txt-reaction-cell-replication.timer` is armed.
- It checks every minute for a fresh bybit-public BTCUSDT reaction.
- It only launches if `reaction_class in {FAST, SLOW}` and the current regime is
	`RANGE`.
- Campaign prefix: `cellrep50`.
- This remains controlled simulated collection, not live MT5 execution.

### 2. First EVIDENCED Cell

Do not optimize for 1000 outcomes. Optimize for a repeated cell:

```text
FAST + RANGE event_count >= 3
```

or:

```text
SLOW + RANGE event_count >= 3
```

This is the first point where a cell starts to become real causal memory.

### 3. Real MT5 Execution Audit

Connectivity is not enough. The real lock is:

```text
Intent
Broker Ack
Real Fill
Audit
Reality Gap
```

The first test should be deliberately tiny, constrained by FTMO rules and the
available minimum order size.

### 4. Reality Gap Samples

TXT must learn the difference between what it believed would happen and what
the broker/market actually produced.

Key KPI:

```text
reality_gap_samples > 0
```

Without this, execution intelligence remains simulated or inferred.

### 5. Capital Governance

The final major governance layer is not profit seeking. It is survival.

Future Runtime Truth state:

| State | Meaning |
| --- | --- |
| `CAPITAL_UNKNOWN` | Capital source cannot be trusted |
| `CAPITAL_DEGRADED` | Capital is known but incomplete/stale/conflicted |
| `CAPITAL_VERIFIED` | Capital is canonical and auditable |
| `CAPITAL_ACTIONABLE` | Capital is verified and execution-safe |

Capital Truth should be exposed like Runtime Truth: canonically, with explicit
uncertainty rather than silent fallback.

## Unified Truth Panel Target

Mission Control should eventually expose one compact operator line:

```text
Runtime Truth | Observation Truth | Edge Truth | Capital Truth
```

Each truth layer should return one of:

```text
GO | WARNING | NO-GO
```

or a more specific state when useful, such as `EXPLORATORY` for Edge Truth.

## Readiness Definition

TXT should not be considered fully governed because MT5 connects or because the
UI is complete.

The meaningful readiness threshold is:

1. One mature cell.
2. One micro-trade real fill audited end to end.
3. Reality Gap receiving samples.
4. Capital Truth coherent enough to govern action.

Only then does TXT move from a well-instrumented system to a governed causal
execution system.