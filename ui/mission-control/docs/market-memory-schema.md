# Market Memory Schema

Status: Draft v1
Scope: exact schema for structured market memory used by the oracle, readiness surfaces, and future state maps.

## Purpose

Market Memory is not a trade ledger.

It is a structured memory of:
- regimes
- transitions
- anomalies
- execution degradations
- false contexts
- recurrence patterns

Its job is to inform present admissibility, not to replay past trades.

## Design Goals

The memory must be:
- measured
- contextual
- hierarchical
- compressed
- queryable by regime and condition
- explainable to operators
- safe to use as evidence, not mythology

## Canonical Separation

Market Memory must never replace:
- present market truth
- current state measurement

It only provides contextual recall.

The present still outranks the past.

## Memory Layers

### L0. Truth Snapshots

Atomic snapshots of the market state at a timestamp.

Role:
- preserve measured local state before any compression

### L1. Events

Single meaningful events extracted from snapshots.

Examples:
- regime transition
- entropy collapse
- execution latency spike
- coherence break
- inadmissibility trigger

### L2. Episodes

Grouped event sequences representing one coherent market episode.

Examples:
- liquidity stress episode
- false breakout episode
- trend exhaustion episode
- execution degradation episode

### L3. Regime Memory

Compressed summaries of recurring patterns within a regime family.

Examples:
- TREND plus low entropy plus stable execution
- RANGE plus high entropy plus weak coherence

### L4. Memory Capsules

Operator-facing and oracle-facing compressed outputs.

Purpose:
- carry only what is useful for current admissibility

## Exact Canonical Objects

```ts
type MarketTruthSnapshot = {
  snapshotId: string;
  capturedAtIso: string;
  symbol: string;
  venue: string;
  timeframe: string;
  strategy: string;
  regime: string;
  regimeConfidencePct: number;
  truthQualityPct: number;
  admissibilityState: "ADMISSIBLE" | "THIN" | "DEGRADED" | "INADMISSIBLE";
  informationDensityPct: number;
  entropyPct: number;
  coherencePct: number;
  freshnessPct: number;
  executionQualityPct: number;
  edgeEligibilityPct: number;
  oracleReasons: string[];
  anomalyFlags: string[];
  transitionFlags: string[];
};

type MarketTransitionEvent = {
  eventId: string;
  startedAtIso: string;
  detectedAtIso: string;
  symbol: string;
  venue: string;
  timeframe: string;
  transitionType:
    | "REGIME_SHIFT"
    | "ENTROPY_COLLAPSE"
    | "COHERENCE_BREAK"
    | "LIQUIDITY_STRESS"
    | "EXECUTION_DEGRADATION"
    | "RECOVERY"
    | "FALSE_BREAKOUT_SETUP";
  fromState: string;
  toState: string;
  severity: "info" | "warn" | "critical";
  confidencePct: number;
  leadIndicators: string[];
  confirmationMetrics: string[];
  explanation: string;
};

type MarketAnomalyEvent = {
  eventId: string;
  detectedAtIso: string;
  symbol: string;
  venue: string;
  timeframe: string;
  anomalyType:
    | "SPOOFING"
    | "VACUUM"
    | "MICRO_NOISE"
    | "TOXIC_FLOW"
    | "ORDERBOOK_DISLOCATION"
    | "DEPTH_COLLAPSE"
    | "CROSS_VENUE_DIVERGENCE";
  severity: "info" | "warn" | "critical";
  evidenceMetrics: Record<string, number>;
  explanation: string;
};

type ExecutionDegradationEvent = {
  eventId: string;
  detectedAtIso: string;
  symbol: string;
  venue: string;
  timeframe: string;
  degradationType:
    | "LATENCY_SPIKE"
    | "SLIPPAGE_EXPANSION"
    | "FILL_QUALITY_DROP"
    | "ROUTING_INSTABILITY"
    | "SPREAD_COST_EXPANSION";
  executionQualityPct: number;
  costImpactBps: number;
  blockedEdgeCount: number;
  explanation: string;
};

type FalseContextEvent = {
  eventId: string;
  detectedAtIso: string;
  symbol: string;
  venue: string;
  timeframe: string;
  contextType:
    | "FALSE_BREAKOUT"
    | "FAKE_TREND"
    | "NOISY_MEAN_REVERSION"
    | "UNTRUSTWORTHY_RECOVERY"
    | "EXECUTION_DESTROYS_EDGE";
  preconditions: string[];
  observedOutcome: string;
  damageClass: "low" | "medium" | "high";
  explanation: string;
};

type MemoryEpisode = {
  episodeId: string;
  startedAtIso: string;
  endedAtIso: string;
  symbol: string;
  venue: string;
  timeframe: string;
  episodeType:
    | "LIQUIDITY_STRESS"
    | "TRANSITION_CLUSTER"
    | "EXECUTION_BREAKDOWN"
    | "FALSE_CONTEXT_CLUSTER"
    | "RECOVERY_SEQUENCE";
  dominantRegime: string;
  severity: "info" | "warn" | "critical";
  eventIds: string[];
  summary: string;
  recurrenceKey: string;
};

type RegimeMemory = {
  regimeKey: string;
  symbolScope: string;
  venueScope: string;
  timeframeScope: string;
  sampleCount: number;
  admissibleSharePct: number;
  inadmissibleSharePct: number;
  commonTransitions: string[];
  commonAnomalies: string[];
  commonExecutionFailures: string[];
  falseContextPatterns: string[];
  memoryConfidencePct: number;
  updatedAtIso: string;
};

type MarketMemoryCapsule = {
  capsuleId: string;
  generatedAtIso: string;
  contextKey: string;
  currentRegime: string;
  currentVenue: string;
  currentTimeframe: string;
  memoryConfidencePct: number;
  recurrenceScorePct: number;
  riskOfFalseContextPct: number;
  expectedExecutionStressPct: number;
  supportingEpisodes: string[];
  explanation: string[];
};
```

## Required Indexes

The memory store must support indexing by:
- symbol
- venue
- timeframe
- regime
- transition type
- anomaly type
- execution degradation type
- admissibility state
- recurrence key
- time window

## Write Policy

### Snapshot Writes

Write a truth snapshot when one of these occurs:
- regime changes
- admissibility changes
- truth quality changes materially
- execution quality degrades materially
- anomaly cluster appears

### Event Writes

Write an event only when the system can explain why.

No event is allowed without:
- evidence metrics
- a type
- a timestamp
- a context scope
- an explanation

### Episode Promotion

Promote raw events into an episode only if:
- multiple related events cluster in time
- they describe a coherent degradation or transition
- the cluster changes operator trust or oracle admissibility

## Compression Policy

The memory must be compressed in stages.

### Hot memory

Window:
- last 24h to 7d

Purpose:
- direct use in present admissibility and state maps

Granularity:
- snapshots + events + episodes

### Warm memory

Window:
- last 7d to 30d

Purpose:
- recurrence, transition frequency, regime similarity

Granularity:
- event aggregates + episodes + regime summaries

### Cold memory

Window:
- 30d+

Purpose:
- research, crisis archetypes, structural recurrence

Granularity:
- capsules + regime memory summaries + anomaly archetypes

## Query Contract

The oracle and surfaces should query Market Memory through four question families:

1. What has happened in similar contexts?
2. What usually degrades first in this regime?
3. Which false contexts recur here?
4. Is present execution stress part of a known pattern?

## Current Integration Anchors

Existing sources that should progressively feed this memory:
- /opt/txt/ui/mission-control/app/api/terminal/tradability/analytics/route.ts
- /opt/txt/ui/mission-control/app/terminal/page.tsx
- /opt/txt/ui/mission-control/app/terminal/finalDecisionTruth.ts
- /opt/txt/ui/mission-control/lib/tradabilityAnalytics.ts
- /opt/txt/ui/mission-control/lib/edgeObservation.ts

## Acceptance Criteria

The Market Memory implementation is acceptable only if:

1. It stores regimes, transitions, anomalies, and execution degradations explicitly.
2. It never reduces memory to trades only.
3. It can explain each memory recall through evidence and recurrence.
4. It supports hierarchical compression without losing context.
5. It remains subordinate to present measurement.