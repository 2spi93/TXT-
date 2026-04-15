# Runtime Decision Mini Dashboard Live Spec

## Objective

Build a compact operator-facing dashboard layer for execution refusals before any EMS extraction.
The goal is not to explain fills. The goal is to answer, in less than 10 seconds:

- Is NO_TRADE dominated by market scarcity, runtime degradation, or policy governance?
- Are we looking at real protection or logging debt?
- What should the desk inspect first right now?

## Current baseline

Baseline taken from the current runtime journal analysis:

- Total rows: 565
- Execution rows: 188
- NO_TRADE rows: 188
- Canonical native rows: 10
- Normalized legacy rows: 178
- Effective canonical coverage: 100%
- Top codes:
  - routing-score-zero: 102 (54.26%)
  - fallback-mode: 30 (15.96%)
  - engine-v4-off: 20 (10.64%)
  - runtime-live-readiness-degraded: 19 (10.11%)
  - runtime-recovery-lockdown: 14 (7.45%)
  - routing-blocked: 3 (1.60%)
- Bucket mix:
  - market: 105
  - runtime: 63
  - policy: 20
- Semantic mismatch candidates: 19 (10.11%)
- False positive candidates: 22 (11.70%)

## Placement

Phase 1 should land in the canonical dashboard surface at `/`, because `/dashboard` is now only an alias redirect.
Phase 1.5 can mirror a compact version inside the terminal secondary panels for operators already working in `/terminal`.

## Primary cards

The mini dashboard should expose 6 top cards:

1. NO_TRADE rate
   Formula: `noTradeRows / executionRows`
   Example baseline: `188 / 188 = 100%`

2. Dominant bucket
   Formula: `max(byBucket)`
   Example baseline: `market = 55.85%`

3. Dominant code
   Formula: `max(topCodes)`
   Example baseline: `routing-score-zero = 54.26%`

4. Canonical coverage
   Formula: `canonicalRows / noTradeRows` and `effectiveCanonicalCoveragePct`
   Operator meaning: how much of the reading is natively trustworthy vs reconstructed

5. Semantic mismatch rate
   Formula: `semanticMismatchCandidates / noTradeRows`
   Operator meaning: logging debt or contradictory refusal narration

6. False positive candidate rate
   Formula: `falsePositiveCandidates / noTradeRows`
   Operator meaning: fraction of refusals worth replay or policy review

## Main visuals

### 1. Bucket split timeline

Stacked area or stacked bars over rolling windows:

- market
- runtime
- policy
- broker
- confidence
- external-governance

Question answered:
Is the refusal profile shifting from opportunity scarcity to platform fragility?

### 2. Canonical code Pareto

Horizontal bar chart sorted descending by count.
Must show:

- code
- count
- sharePct
- bucket color

Question answered:
Which refusal reason actually dominates the desk today?

### 3. Context heatmap

Heatmap crossing:

- attentionState
- volatilityRegime

Colored by NO_TRADE count or share.

Question answered:
Are refusals clustered in compressed regimes, or happening in states that should remain tradable?

### 4. Hygiene panel

Two mini bars and a drill list:

- semantic mismatch rate
- false positive candidate rate

Sample rows must show:

- createdAtIso
- action
- canonical code
- detail
- attentionState
- busSeq
- depthAgeMs

Question answered:
Is the issue really policy/runtime, or are we reading broken narration?

## Data contract

Phase 1 should consume the JSON emitted by `npm run analyze:runtime-log:json`.
The UI contract can mirror the current analyzer output:

- totals
- topCodes
- byBucket
- byFamily
- marketContext.volatilityRegime
- marketContext.attentionState
- marketContext.tripleValidationState
- semanticMismatchCandidates
- falsePositiveCandidates

If we need a UI route later, expose the same payload shape through a thin API wrapper instead of inventing a second schema.

## Thresholds

Use simple desk thresholds in Phase 1:

- NO_TRADE rate > 70%: red
- runtime bucket share > 25%: red
- policy bucket share > 15%: amber
- semantic mismatch rate > 5%: amber
- false positive candidate rate > 10%: amber
- canonical native coverage < 80%: amber

These are operator thresholds, not model thresholds.

## Operator actions

The dashboard should map directly to desk actions:

- Dominant market bucket: inspect routing score quality and lack-of-edge logic first.
- Dominant runtime bucket: inspect readiness, watchdog, recovery, fallback, bridge health.
- Dominant policy bucket: inspect explicit governance guards before discussing execution engine extraction.
- High mismatch rate: fix journaling truth before changing policy.
- High false positive rate: replay stable-state refusals and review guard thresholds.

## Delivery phases

Phase 1:

- Static dashboard block on `/`
- Backed by analyzer JSON or a small route wrapper
- Cards + Pareto + hygiene panel

Phase 1.5:

- Compact mirror inside terminal secondary panels
- Last-run operator note link

Phase 2:

- Time-window selector
- Per-code drilldown
- Shift-to-shift comparison

## Non-goals

- No EMS extraction in this phase
- No fill-quality analytics in this phase
- No new execution policy engine in this phase
- No attempt to infer market alpha from refusal logs alone