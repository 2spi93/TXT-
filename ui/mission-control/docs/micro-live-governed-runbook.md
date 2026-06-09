# Governed Micro-Live Runbook

## Objective

Run a bounded real-money micro-live program to accumulate proof, not to optimize profit.

This phase exists to validate the full downstream chain on real executions:

- fill reality
- slippage reality
- latency reality
- hardening behavior
- attribution persistence
- opportunity cost persistence

The program is successful only if it increases complete decision coverage and closes the dominant downstream root cause.

## Program Posture

This is a validation program, not a scale program.

- allowed: automatic micro-live on BTCUSD and BTCUSDT
- allowed sizing: EUR 1 to EUR 5 equivalent using requested_notional_usd in the preview route
- disallowed: capital scaling beyond the active micro-live stage cap
- disallowed: Alpha V2 expansion, LLM Trader expansion, Memory Engine rollout, new signals, new predictors, strategy expansion

## Source Of Truth

Use the existing operator and API surfaces already wired into Mission Control.

Operator pages:

- Connectors: `/connectors`
- Live Ops: `/live-ops`
- Terminal: `/terminal`

Control routes:

- `GET /api/system/micro-live-stage?provider=mt5`
- `POST /api/system/micro-live-stage`
- `POST /api/system/micro-live/preview`
- `GET /api/system/live-ops`

Canonical evidence routes already feed the chain:

- allocation decisions
- approval decisions
- execution facts
- opportunity cost
- allocation writer stage transitions

## Success Targets

Do not treat this phase as complete until the desk has produced real chain throughput.

Program targets:

- at least 100 created decisions
- at least 50 complete decisions
- at least 100 real micro-executions
- stretch target: 100 to 500 real micro-executions

Governance targets required before any size increase above micro-live:

- `decision_journey_completion_rate_pct > 25`
- `native_evidence_coverage_pct > 40`
- `root_cause_closure_rate_pct > 80`

These thresholds already match the runtime governance enforced in code.

## Entry Gate

All of the following must be true before the desk starts a micro-live session.

### Infrastructure Gate

- MT5 bridge status is healthy on `/connectors`
- critical live connectors are healthy
- target account is visible, tradable, and in the expected mode
- the active micro-live stage exposes a positive `max_order_notional_usd`

### Trade Gate

For each symbol and size bucket, run a fresh preview using `POST /api/system/micro-live/preview`.

Minimum request shape:

```json
{
  "provider": "mt5",
  "account_id": "<account-id>",
  "requested_notional_usd": 1,
  "explicit_flag": true,
  "purpose": "execute",
  "paper_only": false,
  "symbol": "BTCUSD",
  "side": "BUY",
  "regime": "TREND",
  "confidence": 0.9
}
```

The preview must show all of the following before a trade is allowed:

- `resolution.effective_notional_usd` is within the current stage cap
- `hardening.status` is not blocked
- `hardening.no_trade_context.no_trade = false`
- `hardening.drawdown_velocity.blocked = false`
- oracle stability is not in a blocked state
- preview reasons do not contain an unresolved escalation the operator cannot explain

### Governance Gate

Micro-live is allowed as proof collection even while scale-up remains blocked.

But the desk must not use micro-live to bypass hard governance. If any route or preview returns a hard block, the trade is forbidden.

## Session Envelope

The micro-live program must stay intentionally narrow.

- symbols: BTCUSD, BTCUSDT only
- size ladder: start at EUR 1 equivalent, then EUR 2 equivalent, then EUR 5 equivalent
- one step up only after at least one full day with no unresolved cut-switch event at the lower size
- no concurrent expansion across new symbols and new sizes in the same session

## Cut-Switches

The desk must stop new entries immediately when any of the following is true.

### Hard Stop

- MT5 bridge or critical connector becomes unhealthy
- `micro-live-stage` no longer returns an active executable stage
- preview returns `no_trade = true`
- preview returns blocked hardening
- preview drawdown velocity is blocked
- preview oracle stability is blocked
- the route path needed to emit approval, execution, outcome, attribution, or opportunity evidence fails

### Program Stop

Pause the program and investigate before continuing when any of the following is true:

- after 20 created decisions, complete decisions remain at 0
- after 50 created decisions, downstream dominant root cause is still `allocation_writer_gap_downstream_present` with no measurable reduction in concentration
- after 100 created decisions, complete decisions are still below 50
- Live Ops shows allocation closure stagnating while created decisions continue to grow
- evidence remains mostly backfilled or inferred instead of moving toward native coverage

### Scale-Up Stop

Do not move above the micro-live envelope until all three runtime governance thresholds are satisfied together:

- `decision_journey_completion_rate_pct > 25`
- `native_evidence_coverage_pct > 40`
- `root_cause_closure_rate_pct > 80`

If one of these falls back under threshold, revert to micro-live only.

## Operator Cadence

### Before Session

1. Open `/connectors`.
2. Read MT5 bridge health, account mode, and pending live approvals.
3. Read FTMO MT5 governance: active phase, current order cap, drawdown warn/block, oracle warn/block.
4. Run preview for the intended account, symbol, side, regime, and notional.
5. Confirm the preview remains inside the allowed bucket and is not blocked.
6. Open `/live-ops` and record the opening baseline:
   - created decisions
   - complete decisions
   - allocation closure rate
   - root cause closure rate
   - native evidence coverage
   - dominant root cause

### During Session

Run a review loop every 10 executions or every 30 minutes, whichever comes first.

At each pass:

1. Re-run preview if symbol, regime, or requested size changed.
2. Check for any new hardening, NO_TRADE, drawdown, or oracle block.
3. Confirm the chain is still being emitted into downstream artifacts.
4. Confirm Live Ops has not regressed on closure metrics.

### End Of Session

Record the closing state from `/live-ops`:

- created decisions
- complete decisions
- allocation closure rate
- root cause closure rate
- native evidence coverage
- dominant root cause
- journey completion rate

Then classify the session outcome:

- `ADVANCING`: complete decisions increased and dominant downstream gap pressure did not worsen
- `STALLED`: created decisions increased but complete decisions did not
- `REGRESSING`: closure rate, native evidence, or hardening quality worsened materially

## Expected Evidence Per Trade

For a micro-live trade to count as valid proof, the chain must be visible across the downstream journals.

Expected transition path:

- `PERSISTED -> APPROVAL_CREATED`
- `APPROVAL_CREATED -> APPROVAL_LINKED`
- `APPROVAL_LINKED -> HARDENING_REACHED`
- `HARDENING_REACHED -> EXECUTION_CREATED`
- `EXECUTION_CREATED -> OUTCOME_CREATED`
- `OUTCOME_CREATED -> ATTRIBUTION_CREATED`
- `OUTCOME_CREATED or EXECUTION_CREATED -> OPPORTUNITY_CREATED`

Expected evidence families:

- allocation decision exists
- approval decision exists
- execution fact exists
- outcome is present when execution completed
- attribution is present when computed
- opportunity artifact exists

If the trade executed but the evidence chain is incomplete, count it as proof debt, not proof success.

## Daily Review

Once per day, the operator or owner reviews the micro-live program against these four questions:

1. Did complete decisions grow faster than created decisions today?
2. Is `allocation_writer_gap_downstream_present` shrinking as a share of all open gaps?
3. Is native evidence coverage increasing rather than being replaced by backfill?
4. Are real fills producing usable slippage, latency, attribution, and opportunity observations?

If the answer is no on two or more questions, keep the program in micro-live and prioritize root-cause repair over more throughput.

## Promotion Rules

### Green

Automatic micro-live is allowed when the entry gate passes and no cut-switch is active.

### Orange

Limited automatic trading above the micro-live envelope is allowed only after all runtime governance thresholds are satisfied together:

- `decision_journey_completion_rate_pct > 25`
- `native_evidence_coverage_pct > 40`
- `root_cause_closure_rate_pct > 80`

Recommended next envelope only after that point:

- EUR 10
- EUR 20
- EUR 50

### Red

Significant capital is forbidden until the system has accumulated enough complete real executions to show that the downstream proof chain remains stable under sustained load.

Examples of forbidden early scaling:

- EUR 500
- EUR 1000
- EUR 5000

## Non-Goals

- no new model programs during this phase
- no new signal programs during this phase
- no strategy expansion during this phase
- no capital scaling justified by confidence alone
- no treating TRI as the primary operating KPI

The primary KPIs during this phase are:

- `allocation_closure_rate_pct`
- `root_cause_closure_rate_pct`

TRI remains an indicator, not the operating objective.

## Related Checklist

- Use [micro-live-operator-checklist.md](micro-live-operator-checklist.md) for the ultra-short daily operator version of this runbook.
- strategy expansion

## Source Of Truth

Use existing Mission Control surfaces and routes only.

Primary operator surfaces:

- Connectors: FTMO governance and MT5 sizing preview
- Live Ops: Allocation Writer Closure Program and global runtime truth
- Terminal: live operator execution surface

Primary routes:

```text
GET  /api/system/micro-live-stage?provider=mt5
POST /api/system/micro-live/preview
GET  /api/system/live-ops
```

The micro-live stage route gives the active stage, caps, and transition history.

The preview route gives the per-order verdict before execution.

The live-ops route is the runtime truth used to validate closure KPIs and evidence quality after execution.

## Entry Criteria

Micro-live is allowed only when all of the following are true at the start of the session.

### Infrastructure

- MT5 bridge status is healthy
- account is trade-enabled and visible in Connectors
- pending live approvals are not accumulating from the prior session
- provider stage is the active micro-live stage intended for evidence collection

### Per-Order Preview

Before every new notional bucket or symbol switch, run:

```text
POST /api/system/micro-live/preview
```

Example body:

```json
{
  "provider": "mt5",
  "account_id": "<account_id>",
  "requested_notional_usd": 5,
  "explicit_flag": true,
  "purpose": "execute",
  "paper_only": false,
  "symbol": "BTCUSD",
  "side": "BUY",
  "regime": "TREND",
  "confidence": 0.9
}
```

The preview must show all of the following:

- hardening.status is not blocked
- no_trade_context.no_trade is false
- oracle_stability is not in a blocked state
- drawdown_velocity is not blocked
- effective_notional_usd is less than or equal to both the requested bucket and the current stage cap

### Runtime Governance Posture

For micro-live evidence collection, the desk may still be below scaling thresholds. That is expected.

However, serious automatic scaling remains blocked until the already coded thresholds are met:

- decision_journey_completion_rate_pct >= 25
- native_evidence_coverage_pct >= 40
- root_cause_closure_rate_pct >= 80

Do not reinterpret this runbook as a scaling override.

## Notional Ladder

Move only when the evidence target of the previous rung is met.

### Rung 1

- target notional: 1 EUR equivalent
- target window: first 25 created decisions
- minimum complete decisions before promotion: 10

### Rung 2

- target notional: 2 EUR equivalent
- target window: next 25 created decisions
- minimum cumulative complete decisions before promotion: 25

### Rung 3

- target notional: 5 EUR equivalent
- target window: until 100 created decisions
- minimum cumulative complete decisions before promotion review: 50

If the broker or stage config works in USD, use the closest supported USD equivalent while staying under the effective stage cap returned by preview.

## Session Procedure

### 1. Pre-Open

Check Connectors before enabling the session:

- MT5 Bridge status = healthy
- FTMO active phase matches the intended micro-live stage
- stage cap and bucket list are visible
- transition history does not show an unresolved downgrade from the last session

Then run a preview for the first intended symbol and notional.

If preview is blocked, the session does not start.

### 2. Start Narrow

At session start:

- use one account only
- use one symbol at a time
- use one active notional rung only
- do not mix scaling experiments with evidence collection

The first goal is not throughput. The first goal is a clean proof chain.

### 3. Run And Observe

During the session, use Live Ops as the post-trade truth surface.

Track these KPIs first:

- allocation_closure_rate_pct
- root_cause_closure_rate_pct
- decision_journey_completion_rate_pct
- native_evidence_coverage_pct

TRI remains an indicator, not the leading control variable for this phase.

### 4. End-Of-Session Review

At the end of each session, record:

- created decisions
- complete decisions
- allocation_closure_rate_pct
- root_cause_closure_rate_pct
- native_evidence_coverage_pct
- dominant root cause
- blocked or warning incidents encountered

Promotion to the next rung is forbidden if the evidence target is not reached or if the dominant downstream gap is still widening.

## Circuit Breakers

Stop immediately and return to observation-only if any of the following becomes true.

### Infrastructure Halt

- MT5 bridge is no longer healthy
- connector health becomes degraded on the execution path
- account loses trade permission or execution capability required by the path

### Preview Halt

- hardening.status becomes blocked
- no_trade_context.no_trade becomes true
- oracle_stability enters a blocked state
- drawdown_velocity enters a blocked state

### Evidence Halt

- allocation_open_total rises for two consecutive review passes while allocation_closed_total does not keep up
- root cause allocation_writer_gap_downstream_present remains dominant and worsens over two consecutive review passes
- complete decisions stay flat while created decisions continue to rise
- a meaningful share of new executions fail to emit outcome, attribution, or opportunity evidence

### Risk Halt

- current stage transition history shows a downgrade
- daily loss protection or total loss protection moves into warning escalation requiring manual review
- operator cannot explain a live execution with the canonical transition chain and execution facts

## Cadence

Use a fixed review cadence. Do not wait for intuition.

### Before Session

- one stage check
- one preview check per symbol and rung

### During Session

- review every 10 decisions or every 30 minutes, whichever comes first
- re-run preview before any symbol change or rung change
- inspect pending live approvals if the queue begins to accumulate

### End Of Day

- one Live Ops review
- one dominant root cause review
- one decision count review against the current rung target

### Weekly Review

Review the last seven days as a program, not as isolated trades.

The weekly question is:

Can the desk prove that the full downstream chain is now traversed often enough to loosen scaling governance?

## Expected Evidence

Each micro-live decision is expected to produce the following proof set.

### Pre-Trade Proof

- active micro-live stage
- current stage cap and bucket
- preview verdict
- hardening reasons, if any
- no-trade context

### Execution Proof

- approval created or linked
- hardening reached when present
- execution created
- fill or outcome facts
- latency and slippage artifacts when available from execution facts

### Post-Trade Proof

- outcome created
- attribution created
- opportunity created
- live-ops state machine counts reflect the new transition

### Program Proof

- 100 created decisions
- 50 or more complete decisions
- dominant downstream root cause no longer worsening
- closure KPIs improving on real data, not replay-only artifacts

## Promotion Rules

### Allowed

Remain inside the 1 EUR to 5 EUR evidence band while building the proof set.

### Conditionally Allowed

Promotion to the 10 EUR to 50 EUR band can be reviewed only after all of the following are sustained on a stable window:

- decision_journey_completion_rate_pct > 25
- native_evidence_coverage_pct > 40
- root_cause_closure_rate_pct > 80
- at least 100 created decisions
- at least 50 complete decisions

### Forbidden

Do not move to significant capital while the micro-live proof chain is still sparse, backfilled, or dominated by the downstream allocation gap.

## Non-Goals

- no model expansion
- no strategy expansion
- no Alpha V2 unfreeze
- no PnL optimization campaign
- no governance bypass for limited good days

This runbook is a proof program. When it works, scaling becomes a consequence rather than a hope.