# Market State Map Specification

Status: Draft v1
Scope: objects, metrics, APIs, and UI surfaces for TXT Market State Map.

## Goal

The Market State Map is the primary observational surface for market quality.

It should answer:
- where the market is trustworthy
- where it is degrading
- where execution destroys edge
- where transitions are starting
- where the oracle should refuse action

It is not a predictor map.

It is a cartography of market quality.

## Non-Goals

The Market State Map must not:
- produce a second oracle
- optimize for directional prediction
- hide transitions behind a single alpha score
- override the canonical decision truth

## Canonical Dimensions

Each map cell should be addressable by these dimensions:
- symbol
- venue
- timeframe
- regime
- entropy band
- information density band
- execution quality band
- freshness band

Optional later dimensions:
- route family
- liquidity tier
- session segment
- cross-venue divergence bucket

## Core Objects

```ts
type MarketStateCellKey = {
  symbol: string;
  venue: string;
  timeframe: string;
  regime: string;
  entropyBand: "LOW" | "MEDIUM" | "HIGH";
  densityBand: "THIN" | "BALANCED" | "RICH";
  executionBand: "WEAK" | "STABLE" | "STRONG";
  freshnessBand: "STALE" | "AGING" | "FRESH";
};

type MarketStateCell = {
  key: MarketStateCellKey;
  sampleCount: number;
  truthQualityPct: number;
  admissibilityPct: number;
  opportunityPct: number;
  informationDensityPct: number;
  entropyPct: number;
  coherencePct: number;
  freshnessPct: number;
  executionQualityPct: number;
  falseContextRiskPct: number;
  transitionPressurePct: number;
  memoryConfidencePct: number;
  state:
    | "ADMISSIBLE"
    | "WATCH"
    | "THIN"
    | "DEGRADED"
    | "INADMISSIBLE";
  reasons: string[];
  updatedAtIso: string;
};

type MarketStateTransition = {
  transitionId: string;
  symbol: string;
  venue: string;
  timeframe: string;
  regimeFrom: string;
  regimeTo: string;
  transitionPressurePct: number;
  leadIndicators: string[];
  detectedAtIso: string;
  explanation: string;
};

type MarketStateMapSnapshot = {
  generatedAtIso: string;
  scope: {
    symbols: string[];
    venues: string[];
    timeframes: string[];
    windowHours: number;
  };
  cells: MarketStateCell[];
  transitions: MarketStateTransition[];
  inadmissibleZones: Array<{
    zoneKey: string;
    reason: string;
    severity: "warn" | "critical";
  }>;
  summary: {
    admissibleCells: number;
    watchCells: number;
    degradedCells: number;
    inadmissibleCells: number;
    dominantFailureModes: string[];
  };
};
```

## Metric Families

### 1. Truth Quality

Purpose:
- measure whether the current market state is reliable enough to trust

Inputs:
- information density
- entropy stability
- coherence
- freshness
- anomaly burden
- execution stability

Output:
- truthQualityPct

Important rule:
- truth quality must be separate from opportunity

### 2. Admissibility

Purpose:
- decide whether the market deserves a decision

Inputs:
- truth quality
- execution quality
- information density calibration
- transition pressure
- false context risk

Output:
- admissibilityPct
- state

Current anchors:
- /opt/txt/ui/mission-control/app/terminal/finalDecisionTruth.ts
- /opt/txt/ui/mission-control/lib/tradabilityAnalytics.ts

### 3. Opportunity

Purpose:
- estimate exploitable setup quality only after admissibility passes

Inputs:
- spread
- depth
- route latency
- fill probability
- regime support

Output:
- opportunityPct

Rule:
- opportunity must never rescue an inadmissible market

### 4. Transition Pressure

Purpose:
- show whether the market is moving between states

Inputs:
- regime instability
- entropy acceleration
- coherence break frequency
- anomaly cluster density
- execution degradation onset

Output:
- transitionPressurePct

### 5. False Context Risk

Purpose:
- measure how likely the current state is to look tradable while being deceptive

Inputs:
- memory recurrence of false contexts
- microstructure anomalies
- execution damage recurrence
- weak coherence plus apparent opportunity

Output:
- falseContextRiskPct

### 6. Memory Confidence

Purpose:
- indicate how much the memory layer can be trusted for this cell

Inputs:
- sample count
- recurrence quality
- regime similarity
- recency of supporting episodes

Output:
- memoryConfidencePct

## API Surface

### Existing API anchors to reuse

- GET /api/terminal/tradability/analytics
  - source for tradability windows, calibration, drift, sensitivity, impact weight

- GET /api/system/observation/edge-map
  - source for classified edge observation

### New APIs to add

#### GET /api/market-truth/quality

Returns:
- truth quality summary
- dominant degradations
- cross-layer reliability metrics

#### GET /api/market-memory/summary

Returns:
- recent episodes
- recurrence keys
- false context archetypes
- execution degradation archetypes

#### GET /api/market-state-map

Returns:
- MarketStateMapSnapshot

Use cases:
- dashboard overview
- readiness state desk
- dedicated state map page

#### GET /api/market-state-map/cells

Query params:
- symbol
- venue
- timeframe
- regime
- state
- minTruthQualityPct

Returns:
- filtered MarketStateCell[]

#### GET /api/market-state-map/transitions

Query params:
- symbol
- venue
- timeframe
- sinceHours

Returns:
- MarketStateTransition[]

#### GET /api/market-state-map/inadmissible-zones

Returns:
- active inadmissible zones
- blocking reasons
- time decay

## UI Surfaces

### 1. Terminal

Purpose:
- show the current local cell and why it is admissible or not

Surface additions:
- current cell coordinates
- truth quality block
- transition pressure strip
- false context risk badge
- memory recall explanation

Current anchor:
- /opt/txt/ui/mission-control/app/terminal/TerminalSecondaryPanels.tsx

### 2. Live Readiness

Purpose:
- cross-system monitoring for current admissibility health

Surface additions:
- state map summary
- inadmissible zones panel
- transition feed
- truth quality health board

Current anchor:
- /opt/txt/ui/mission-control/app/live-readiness/page.tsx

### 3. Edge Map Desk

Purpose:
- dedicated observational desk for state quality and edge observation

Surface additions:
- map cells by venue and timeframe
- overlays for truth quality and execution quality
- recurrence overlays from Market Memory
- transition lanes

Current anchor:
- /opt/txt/ui/mission-control/app/live-readiness/edge-map/page.tsx

### 4. Dashboard Observation

Purpose:
- audit trail for why the system should observe, wait, or block

Surface additions:
- compact state map summary
- impact weight trace
- memory confidence trace
- dominant failure modes

Current anchor:
- /opt/txt/ui/mission-control/components/ui/RuntimeObservationDashboard.tsx

### 5. Future Memory Desk

Purpose:
- operator and research surface for memory episodes and recurrences

Surface blocks:
- transition timeline
- anomaly clusters
- execution degradation clusters
- false context archetypes
- recurrence confidence table

## Rollout Order

1. Keep canonical oracle ownership in FinalDecisionTruth.
2. Add truth quality as its own measured family.
3. Persist Market Memory objects and recurrence capsules.
4. Build state map API from truth plus memory plus observation layers.
5. Expose summary in dashboard and readiness before adding denser map views.
6. Only after this, consider AI helpers that summarize or investigate cells.

## Acceptance Criteria

The Market State Map is acceptable only if:

1. It measures quality before opportunity.
2. It shows transitions before conclusions.
3. It exposes inadmissible zones explicitly.
4. It remains traceable back to metrics, anomalies, and memory evidence.
5. It never becomes a second decision oracle.