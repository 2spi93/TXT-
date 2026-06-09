# Runtime Decision Live Observation Runbook

## Objective

Run a bounded 3-7 day observation phase for the runtime decision engine before any manual calibration review.

This phase is operational, not exploratory:

- no auto-calibration
- no policy engine expansion
- no execution automation changes
- one source of truth: `/api/system/runtime-decision`

## Source Of Truth

Use the existing runtime summary route with the live context already used by the terminal:

```text
GET /api/system/runtime-decision?symbol=BTCUSD&timeframe=1m&strategy=terminal&limit=1200&sinceDays=7&samples=3
```

The payload now includes an `observation` block designed for the live window.

## Observation Window

- Minimum observation: 72h
- Target observation: 3-7 days
- Upper review point: 168h
- Calibration mode during this phase: manual only
- Automation posture during this phase: frozen

`observation.status` follows time coverage:

- `INSUFFICIENT`: less than 72h of journal coverage
- `OBSERVE`: at least 72h but less than 168h
- `READY_FOR_REVIEW`: 168h or more covered, eligible for human review only

## KPIs

The observation block exposes the five live KPIs that matter during this phase.

### `driftFalsePositiveRate`

Formula:

```text
falsePositiveCandidates / noTradeRows
```

Meaning:

- how often drift-like refusals look replayable or unjustified
- if this stays high, do not calibrate; clean runtime narration or thresholds first

### `driftStability`

Formula:

- combines drift-score volatility across live series points
- penalizes frequent state flips in the recent drift history

Meaning:

- high score means the signal is temporally stable
- low score means the desk is reacting to oscillation, not structure

### `opportunityHitRate`

Formula:

```text
executed tradable contexts / all tradable contexts
```

Meaning:

- how often structurally tradable contexts are actually executed instead of blocked
- if low, inspect latency/spread/routing before touching policy

### `decisionConsistency`

Formula:

- weighted blend of effective canonical coverage
- inverse semantic mismatch rate
- inverse false positive rate
- drift window consistency

Meaning:

- measures whether the refusal story stays coherent over time
- if low, you are still reading mixed truth, not a clean signal

### `driftReliabilityMean`

Formula:

- mean of runtime drift reliability
- window consistency
- inverse noise level

Meaning:

- compact confidence proxy for the whole observation period
- this is the KPI that protects against overreacting to KS/ADWIN spikes

## Optional Manual Verdict Logging

The journal accepts an optional field:

```json
{
  "decisionOutcome": "correct"
}
```

Allowed values:

- `correct`
- `false_positive`
- `unknown`

This field is strictly for later review and future calibration support. It does not enable any automation.

## Manual Review Gate

`observation.manualCalibrationEligible` can only open when all of the following are true:

- 168h of live coverage reached
- `decisionConsistency >= 70`
- `driftReliabilityMean >= 60`
- `driftStability >= 65`
- `driftFalsePositiveRate <= 12`

Even when the gate is open:

- calibration stays manual
- one bounded change at a time
- observe again after the change

## Operator Routine

Check the observation block twice per day during the live window.

Morning pass:

- confirm `status`
- read `driftFalsePositiveRate`
- read `decisionConsistency`
- read `recommendation`

Evening pass:

- compare `driftStability`
- compare `opportunityHitRate`
- check whether manual verdict coverage is improving via `decisionOutcomeCoveragePct`

## Stop Conditions

Do not move to calibration if one of these remains true:

- semantic mismatch still dominates the desk read
- runtime drift stays unstable hour to hour
- false positives remain elevated
- opportunity remains mostly constrained by live latency or spread

## Non-Goals

- no automatic threshold tuning
- no auto-promotion to policy changes
- no execution automation rollout
- no replacing the operator with a policy loop

## Related Runbooks

- Use [micro-live-governed-runbook.md](micro-live-governed-runbook.md) when the system is ready to leave pure observation and start bounded live evidence collection under stage, preview, and closure-governance control.