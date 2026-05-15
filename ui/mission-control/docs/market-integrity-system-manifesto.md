# TXT Market Integrity System Manifesto

Status: Draft v1
Scope: Mission Control, terminal, readiness, observation, market memory, execution governance.

## Thesis

TXT does not exist to predict price first.

TXT exists to measure whether the current market state is informationally admissible, operationally trustworthy, and execution-safe enough to deserve a decision.

The system therefore behaves as an inspector of market truth, not as a retail predictor stack.

## Product Position

Retail trading usually asks:
- Where will price go?

TXT asks first:
- Is the present market state exploitable?
- Is the information coherent enough to trust?
- Is the execution layer strong enough to preserve edge?
- Is the current regime stable, transitional, or deceptive?

This is a different product category.

TXT should be treated as a market integrity system.

## Core Doctrine

### 1. Never assume. Always measure.

No intuition, no hidden heuristics, no untraceable guess.

Every important verdict must come from observable metrics, explicit transitions, and auditable evidence.

### 2. Always separate three layers.

TXT must never collapse these into one number:
- Market truth: how reliable and coherent the market state is.
- Market memory: what similar states, transitions, anomalies, and degradations already taught us.
- Market state now: the current regime, local conditions, and operational risk at this instant.

### 3. Explain every verdict.

Each evaluation must be explainable through:
- metrics
- anomalies
- transitions
- coherence checks
- execution quality checks

No silent score is allowed to drive a meaningful action.

### 4. Context before signal.

A signal has no standalone value.

It only has meaning inside:
- a market regime
- an entropy state
- a liquidity condition
- an execution condition
- a trust envelope

### 5. Detect transitions before signals.

The system must care more about:
- regime shifts
- entropy collapses
- execution degradation
- coherence breaks
- false breakout contexts

than about adding another predictor.

### 6. Quality gates outrank opportunity.

If the market is not admissible:
- no decision
- no analysis pretending certainty
- no action

Admissibility is upstream of opportunity.

### 7. Memory must stay alive.

Market memory is not a trade archive.

It is a compressed, hierarchical, contextual memory of:
- regimes
- transitions
- anomalies
- execution degradations
- false contexts
- recurring crisis patterns

### 8. AI is subordinate to the oracle.

Any AI layer added after this point must:
- consume the oracle
- explain through the oracle
- never compete with the oracle
- never create a second decision truth

TXT must remain oracle-governed, not model-governed.

## System Identity

TXT is not:
- another trading AI wrapper
- another signal aggregator
- another predictor dashboard
- another latency race against HFT firms

TXT is:
- a measurement system for market exploitability
- an admissibility oracle
- a memory system for market states and transitions
- a cartography of market quality across layers, venues, and timeframes

## Canonical Separation Of Responsibilities

### Market Truth Layer

Purpose:
- measure the reliability of the present market state

Inputs:
- tradability
- entropy
- information density
- coherence
- freshness
- microstructure anomalies
- execution quality

Output:
- truth quality state
- admissibility state
- explanation payload

Current anchors:
- /opt/txt/ui/mission-control/app/terminal/finalDecisionTruth.ts
- /opt/txt/ui/mission-control/lib/tradabilityAnalytics.ts

### Market Memory Layer

Purpose:
- remember what similar market states and transitions previously meant

Inputs:
- journal snapshots
- transition events
- anomaly episodes
- execution degradations
- false context outcomes

Output:
- contextual memory capsules
- recurrence and similarity signals
- confidence adjustments for present truth

### Market State Layer

Purpose:
- expose the current state as a map, not just as a verdict

Inputs:
- truth layer
- memory layer
- observation layer
- edge observation layer

Output:
- cross-venue
- cross-timeframe
- cross-regime
- cross-quality cartography

Current anchors:
- /opt/txt/ui/mission-control/app/live-readiness/page.tsx
- /opt/txt/ui/mission-control/app/live-readiness/edge-map/page.tsx
- /opt/txt/ui/mission-control/components/ui/RuntimeObservationDashboard.tsx

## Hard Product Rules

Any new component is rejected if it violates one of these rules:

1. It adds signal but does not improve truth quality.
2. It creates a second source of decision truth.
3. It mixes opportunity scoring with reliability scoring.
4. It cannot explain its verdict with metrics and transitions.
5. It treats memory as raw history instead of structured contextual recall.
6. It optimizes action while bypassing admissibility.
7. It introduces AI authority above the oracle.

## Research Direction

The next strategic frontier is not more prediction.

The next frontier is stronger market integrity through:
- market truth quality
- market memory
- market state maps
- execution-aware admissibility
- transition detection
- information governance

This should be considered a stricter and rarer research direction than generic trading AI.

## Delivery Consequences

The roadmap should follow this order:

1. Formalize Market Truth Quality as a dedicated reliability construct.
2. Specify and persist Market Memory as a first-class schema.
3. Build the Market State Map as the primary observational surface.
4. Expand explanation and no-trade governance before any new model work.
5. Allow AI layers only after they are provably subordinate to the oracle.

## Operating Principle

The system wins not by being fastest.

It wins if it sees earlier than others when market information stops being reliable, when execution destroys apparent edge, and when a market stops deserving a decision.

That is the identity to preserve.