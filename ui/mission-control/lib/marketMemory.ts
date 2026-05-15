type JsonMap = Record<string, unknown>;

export type MarketMemorySnapshot = {
  id: string;
  createdAtIso: string;
  oracleFingerprint: string | null;
  symbol: string;
  timeframe: string;
  venue: string;
  routeMode: string;
  regime: string;
  marketSession: string;
  marketTruthState: string;
  truthQualityPct: number;
  admissibilityState: string;
  informationDensityState: string;
  edgeState: string;
  blockingLayer: string;
  coherencePct: number;
  freshnessPct: number;
  informationDensityPct: number;
  executionQualityPct: number;
  anomalyBurdenPct: number;
  falseContextFamily: string | null;
  falseContextNoTrade: boolean;
  falseContextTriggerLayer: string;
  falseContextReasons: string[];
};

export type MarketMemoryTransition = {
  id: string;
  createdAtIso: string;
  transitionType: string;
  fromRegime: string;
  toRegime: string;
  fromMarketTruthState: string;
  toMarketTruthState: string;
  fromAdmissibilityState: string;
  toAdmissibilityState: string;
  fromBlockingLayer: string;
  toBlockingLayer: string;
  fromDensityState: string;
  toDensityState: string;
  fromEdgeState: string;
  toEdgeState: string;
  truthQualityDeltaPct: number;
};

export type MarketExecutionDegradation = {
  id: string;
  createdAtIso: string;
  symbol: string;
  timeframe: string;
  venue: string;
  routeMode: string;
  degradationType: string;
  regime: string;
  marketTruthState: string;
  edgeState: string;
  blockingLayer: string;
  executionQualityPct: number;
  detail: string;
};

export type MarketMicrostructureAnomaly = {
  id: string;
  createdAtIso: string;
  symbol: string;
  timeframe: string;
  venue: string;
  routeMode: string;
  anomalyType: string;
  anomalyFamily: string;
  operatorFamily: string;
  regime: string;
  severity: "info" | "warn" | "critical";
  marketTruthState: string;
  blockingLayer: string;
  evidenceMetrics: {
    persistencePct: number;
    confidencePct: number;
  };
  detail: string;
};

export type MarketMemoryRegimeRow = {
  regime: string;
  sampleCount: number;
  avgTruthQualityPct: number;
  avgCoherencePct: number;
  avgFreshnessPct: number;
  avgInformationDensityPct: number;
  avgExecutionQualityPct: number;
  avgAnomalyBurdenPct: number;
  inadmissibleSharePct: number;
  degradationSharePct: number;
  memoryConfidencePct: number;
  lastMarketTruthState: string;
  lastSeenIso: string;
};

export type MarketMemoryLayerSummary = {
  layer: "hot" | "warm" | "cold";
  windowLabel: "last_7d" | "last_30d" | "older_than_30d";
  snapshotCount: number;
  transitionCount: number;
  anomalyCount: number;
  degradationCount: number;
  regimeCount: number;
  dominantRegime: string | null;
  dominantFalseContextFamily: string | null;
  dominantAnomalyFamily: string | null;
  memoryConfidencePct: number;
  sampleIds: string[];
  explanation: string[];
};

export type MarketTemperatureState = "COLD" | "WARM" | "HOT" | "OVERHEATED";

export type MarketTemperatureDriver = {
  code: "execution_stress" | "false_context_pressure" | "transition_pressure" | "admissibility_pressure";
  label: string;
  valuePct: number;
  contributionPct: number;
  detail: string;
};

export type MarketTemperatureSummary = {
  state: MarketTemperatureState;
  scorePct: number;
  confidencePct: number;
  dominantRegime: string | null;
  hottestContextKey: string | null;
  drivers: MarketTemperatureDriver[];
  explanation: string[];
};

export type MarketMemoryCapsule = {
  capsuleId: string;
  generatedAtIso: string;
  contextKey: string;
  layer: "hot" | "warm" | "cold";
  currentRegime: string;
  currentVenue: string;
  currentTimeframe: string;
  memoryConfidencePct: number;
  recurrenceScorePct: number;
  riskOfFalseContextPct: number;
  expectedExecutionStressPct: number;
  transitionPressurePct: number;
  admissibilityShiftCount: number;
  marketTemperaturePct: number;
  marketTemperatureState: MarketTemperatureState;
  lastAdmissibilityState: string;
  lastOracleFingerprint: string | null;
  transitionTypes: string[];
  supportingEpisodes: string[];
  explanation: string[];
};

export type MarketMemorySummary = {
  generatedAtIso: string;
  sampleCount: number;
  latestSnapshot: MarketMemorySnapshot | null;
  snapshots: MarketMemorySnapshot[];
  regimeRows: MarketMemoryRegimeRow[];
  transitions: MarketMemoryTransition[];
  microstructureAnomalies: MarketMicrostructureAnomaly[];
  executionDegradations: MarketExecutionDegradation[];
  falseContextFamilies: Array<{
    family: string;
    symbol: string;
    timeframe: string;
    venue: string;
    routeMode: string;
    count: number;
    noTradeCount: number;
    latestAtIso: string;
    triggerLayers: string[];
    reasons: string[];
  }>;
  windows: {
    last_24h: {
      snapshotCount: number;
      transitionCount: number;
      anomalyCount: number;
      degradationCount: number;
    };
  };
  marketTemperature: MarketTemperatureSummary;
  hierarchicalCompression: {
    hot: MarketMemoryLayerSummary;
    warm: MarketMemoryLayerSummary;
    cold: MarketMemoryLayerSummary;
    capsules: MarketMemoryCapsule[];
  };
};

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function classifyAnomalyFamily(anomalyType: string): { anomalyFamily: string; operatorFamily: string } {
  const normalized = anomalyType.toUpperCase();
  if (normalized.includes("LIQUIDITY")) {
    return { anomalyFamily: "LIQUIDITY_TRAP", operatorFamily: "liquidity" };
  }
  if (normalized.includes("DESYNCHRONIZATION")) {
    return { anomalyFamily: "VENUE_DESYNC", operatorFamily: "venue" };
  }
  if (normalized.includes("INTENT") || normalized.includes("PREDICTIVE_TRAP")) {
    return { anomalyFamily: "FALSE_INTENT", operatorFamily: "intent" };
  }
  return { anomalyFamily: "UNKNOWN", operatorFamily: "unknown" };
}

function withinHours(iso: string, hours: number): boolean {
  const createdAtMs = Date.parse(iso);
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }
  return createdAtMs >= Date.now() - hours * 60 * 60 * 1000;
}

function ageHours(iso: string, nowMs: number): number | null {
  const createdAtMs = Date.parse(iso);
  if (!Number.isFinite(createdAtMs)) {
    return null;
  }
  return Math.max(0, (nowMs - createdAtMs) / (60 * 60 * 1000));
}

function withinAgeWindow(iso: string, nowMs: number, minimumHours: number, maximumHours: number | null): boolean {
  const value = ageHours(iso, nowMs);
  if (value === null) {
    return false;
  }
  if (value < minimumHours) {
    return false;
  }
  if (maximumHours !== null && value > maximumHours) {
    return false;
  }
  return true;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function admissibilityPressureFromState(value: string): number {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "INADMISSIBLE") {
    return 92;
  }
  if (normalized === "DEGRADED") {
    return 72;
  }
  if (normalized === "WATCH") {
    return 46;
  }
  if (normalized === "ADMISSIBLE") {
    return 18;
  }
  return 36;
}

function marketTemperatureStateFromPct(value: number): MarketTemperatureState {
  if (value >= 78) {
    return "OVERHEATED";
  }
  if (value >= 56) {
    return "HOT";
  }
  if (value >= 32) {
    return "WARM";
  }
  return "COLD";
}

function sortByCreatedAtIso<T extends { createdAtIso: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => Date.parse(right.createdAtIso) - Date.parse(left.createdAtIso));
}

function pickDominantLabel(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || null;
}

function buildLayerSummary(input: {
  layer: MarketMemoryLayerSummary["layer"];
  windowLabel: MarketMemoryLayerSummary["windowLabel"];
  snapshots: MarketMemorySnapshot[];
  transitions: MarketMemoryTransition[];
  anomalies: MarketMicrostructureAnomaly[];
  degradations: MarketExecutionDegradation[];
}): MarketMemoryLayerSummary {
  const dominantRegime = pickDominantLabel([
    ...input.snapshots.map((snapshot) => snapshot.regime),
    ...input.degradations.map((degradation) => degradation.regime),
    ...input.transitions.flatMap((transition) => [transition.toRegime, transition.fromRegime]),
  ]);
  const dominantFalseContextFamily = pickDominantLabel(input.snapshots.map((snapshot) => snapshot.falseContextFamily || "").filter(Boolean));
  const dominantAnomalyFamily = pickDominantLabel(input.anomalies.map((anomaly) => anomaly.anomalyFamily));
  const avgTruthQualityPct = average(input.snapshots.map((snapshot) => snapshot.truthQualityPct));
  const avgExecutionQualityPct = average(input.snapshots.map((snapshot) => snapshot.executionQualityPct));
  const avgAnomalyBurdenPct = average(input.snapshots.map((snapshot) => snapshot.anomalyBurdenPct));
  const sampleIds = sortByCreatedAtIso([
    ...input.snapshots,
    ...input.transitions,
    ...input.anomalies,
    ...input.degradations,
  ]).map((row) => row.id).slice(0, 6);
  const memoryConfidencePct = Math.round(clamp(
    (input.snapshots.length / 10) * 40
      + (avgTruthQualityPct / 100) * 35
      + (avgExecutionQualityPct / 100) * 15
      + ((100 - avgAnomalyBurdenPct) / 100) * 10,
    0,
    100,
  ));
  const explanation: string[] = [];
  if (dominantRegime) {
    explanation.push(`regime ${dominantRegime.toLowerCase()} dominates this ${input.layer} memory layer`);
  }
  if (dominantFalseContextFamily) {
    explanation.push(`false context ${dominantFalseContextFamily.toLowerCase()} recurs in compressed recall`);
  }
  if (dominantAnomalyFamily) {
    explanation.push(`anomaly family ${dominantAnomalyFamily.toLowerCase()} remains part of the layer signature`);
  }
  if (input.degradations.length > 0) {
    explanation.push(`execution stress appears in ${input.degradations.length} degradation event(s)`);
  }
  if (explanation.length === 0) {
    explanation.push("no recallable market memory in this layer yet");
  }
  return {
    layer: input.layer,
    windowLabel: input.windowLabel,
    snapshotCount: input.snapshots.length,
    transitionCount: input.transitions.length,
    anomalyCount: input.anomalies.length,
    degradationCount: input.degradations.length,
    regimeCount: new Set(input.snapshots.map((snapshot) => snapshot.regime)).size,
    dominantRegime,
    dominantFalseContextFamily,
    dominantAnomalyFamily,
    memoryConfidencePct,
    sampleIds,
    explanation,
  };
}

function resolveCapsuleLayer(createdAtIso: string, nowMs: number): MarketMemoryCapsule["layer"] {
  if (withinAgeWindow(createdAtIso, nowMs, 0, 24 * 7)) {
    return "hot";
  }
  if (withinAgeWindow(createdAtIso, nowMs, 24 * 7, 24 * 30)) {
    return "warm";
  }
  return "cold";
}

function buildMarketTemperatureSummary(input: {
  capsules: MarketMemoryCapsule[];
  snapshots: MarketMemorySnapshot[];
  transitions: MarketMemoryTransition[];
}): MarketTemperatureSummary {
  const avgExecutionStressPct = input.capsules.length > 0
    ? average(input.capsules.map((capsule) => capsule.expectedExecutionStressPct))
    : average(input.snapshots.map((snapshot) => Math.max(0, 100 - snapshot.executionQualityPct)));
  const avgFalseContextPressurePct = input.capsules.length > 0
    ? average(input.capsules.map((capsule) => capsule.riskOfFalseContextPct))
    : average(input.snapshots.map((snapshot) => snapshot.falseContextNoTrade ? 84 : snapshot.falseContextFamily ? 56 : 18));
  const avgTransitionPressurePct = input.capsules.length > 0
    ? average(input.capsules.map((capsule) => capsule.transitionPressurePct))
    : clamp(input.transitions.length * 14, 0, 100);
  const avgAdmissibilityPressurePct = input.capsules.length > 0
    ? average(input.capsules.map((capsule) => admissibilityPressureFromState(capsule.lastAdmissibilityState)))
    : average(input.snapshots.map((snapshot) => admissibilityPressureFromState(snapshot.admissibilityState)));
  const drivers: MarketTemperatureDriver[] = [
    {
      code: "execution_stress",
      label: "Execution Stress",
      valuePct: Math.round(avgExecutionStressPct),
      contributionPct: Math.round(avgExecutionStressPct * 0.32),
      detail: `execution stress averages ${Math.round(avgExecutionStressPct)}% across recallable contexts`,
    },
    {
      code: "false_context_pressure",
      label: "False Context Pressure",
      valuePct: Math.round(avgFalseContextPressurePct),
      contributionPct: Math.round(avgFalseContextPressurePct * 0.28),
      detail: `false context pressure averages ${Math.round(avgFalseContextPressurePct)}%`,
    },
    {
      code: "transition_pressure",
      label: "Transition Pressure",
      valuePct: Math.round(avgTransitionPressurePct),
      contributionPct: Math.round(avgTransitionPressurePct * 0.2),
      detail: `transition pressure averages ${Math.round(avgTransitionPressurePct)}%`,
    },
    {
      code: "admissibility_pressure",
      label: "Admissibility Pressure",
      valuePct: Math.round(avgAdmissibilityPressurePct),
      contributionPct: Math.round(avgAdmissibilityPressurePct * 0.2),
      detail: `admissibility pressure averages ${Math.round(avgAdmissibilityPressurePct)}%`,
    },
  ];
  drivers.sort((left, right) => right.contributionPct - left.contributionPct || left.code.localeCompare(right.code));
  const scorePct = Math.round(clamp(drivers.reduce((sum, driver) => sum + driver.contributionPct, 0), 0, 100));
  const hottestCapsule = [...input.capsules]
    .sort((left, right) => right.marketTemperaturePct - left.marketTemperaturePct || right.memoryConfidencePct - left.memoryConfidencePct || left.contextKey.localeCompare(right.contextKey))[0] || null;
  const confidencePct = Math.round(clamp(
    (input.snapshots.length / 12) * 35
      + (input.capsules.length > 0 ? average(input.capsules.map((capsule) => capsule.memoryConfidencePct)) : 0) * 0.65,
    0,
    100,
  ));
  const state = marketTemperatureStateFromPct(scorePct);
  return {
    state,
    scorePct,
    confidencePct,
    dominantRegime: hottestCapsule?.currentRegime || pickDominantLabel(input.capsules.map((capsule) => capsule.currentRegime)),
    hottestContextKey: hottestCapsule?.contextKey || null,
    drivers,
    explanation: [
      `market temperature ${state.toLowerCase()} at ${scorePct}%`,
      hottestCapsule
        ? `${hottestCapsule.currentRegime.toLowerCase()} on ${hottestCapsule.currentTimeframe} is the hottest structural context`
        : "temperature awaits recallable structural contexts",
      drivers[0] ? `${drivers[0].label.toLowerCase()} contributes ${drivers[0].contributionPct}%` : "no dominant temperature driver yet",
    ],
  } satisfies MarketTemperatureSummary;
}

export function parseMarketMemorySnapshots(entries: Array<Record<string, unknown>>): MarketMemorySnapshot[] {
  return entries
    .map((entry) => {
      if (asString(entry.action).toLowerCase() !== "market-memory-snapshot") {
        return null;
      }
      const meta = asRecord(entry.meta);
      const snapshot = asRecord(meta.market_memory_snapshot);
      const finalDecisionTruth = asRecord(meta.final_decision_truth);
      const marketTruth = asRecord(finalDecisionTruth.market_truth);
      const marketTruthMetrics = asRecord(marketTruth.metrics);
      const informationDensity = asRecord(finalDecisionTruth.information_density);
      const edgeEligibility = asRecord(finalDecisionTruth.edge_eligibility);
      const regime = asString(snapshot.volatility_regime || snapshot.regime, "UNKNOWN").toUpperCase();
      return {
        id: asString(entry.id, `${entry.createdAtIso || "snapshot"}`),
        createdAtIso: asString(entry.createdAtIso),
        oracleFingerprint: asString(snapshot.oracle_fingerprint, asString(finalDecisionTruth.oracle_fingerprint)) || null,
        symbol: asString(entry.symbol, "UNKNOWN").toUpperCase(),
        timeframe: asString(entry.timeframe, "UNKNOWN"),
        venue: asString(snapshot.venue, asString(finalDecisionTruth.preferred_venue, "MULTI")).toUpperCase(),
        routeMode: asString(snapshot.route_mode, asString(finalDecisionTruth.route_mode, "unknown")).toLowerCase(),
        regime,
        marketSession: asString(snapshot.market_session, "UNKNOWN").toUpperCase(),
        marketTruthState: asString(snapshot.market_truth_state || marketTruth.state, "WATCH").toUpperCase(),
        truthQualityPct: asNumber(snapshot.truth_quality_pct, asNumber(marketTruth.score_pct, 0)),
        admissibilityState: asString(snapshot.admissibility_state, asString(edgeEligibility.state, "OBSERVE")).toUpperCase(),
        informationDensityState: asString(snapshot.information_density_state, asString(informationDensity.state, "SUFFICIENT")).toUpperCase(),
        edgeState: asString(snapshot.edge_state, asString(edgeEligibility.state, "OBSERVE")).toUpperCase(),
        blockingLayer: asString(snapshot.blocking_layer, asString(finalDecisionTruth.blocking_layer, "none")).toLowerCase(),
        coherencePct: asNumber(snapshot.coherence_pct, asNumber(marketTruthMetrics.coherence_pct, 0)),
        freshnessPct: asNumber(snapshot.freshness_pct, asNumber(marketTruthMetrics.freshness_pct, 0)),
        informationDensityPct: asNumber(snapshot.information_density_pct, asNumber(marketTruthMetrics.information_density_pct, 0)),
        executionQualityPct: asNumber(snapshot.execution_quality_pct, asNumber(marketTruthMetrics.execution_quality_pct, 0)),
        anomalyBurdenPct: asNumber(snapshot.anomaly_burden_pct, asNumber(marketTruthMetrics.anomaly_burden_pct, 0)),
        falseContextFamily: asString(snapshot.false_context_family, asString(asRecord(finalDecisionTruth.false_context).family)).toUpperCase() || null,
        falseContextNoTrade: Boolean(snapshot.false_context_no_trade ?? asRecord(finalDecisionTruth.false_context).no_trade),
        falseContextTriggerLayer: asString(snapshot.false_context_trigger_layer, asString(asRecord(finalDecisionTruth.false_context).trigger_layer, "none")).toLowerCase(),
        falseContextReasons: (() => {
          const rawReasons = snapshot.false_context_reasons ?? asRecord(finalDecisionTruth.false_context).reasons;
          return Array.isArray(rawReasons)
            ? rawReasons.map((reason) => asString(reason)).filter(Boolean)
            : [];
        })(),
      } satisfies MarketMemorySnapshot;
    })
    .filter((value): value is MarketMemorySnapshot => Boolean(value))
    .sort((left, right) => Date.parse(right.createdAtIso) - Date.parse(left.createdAtIso));
}

export function parseMarketMemoryTransitions(entries: Array<Record<string, unknown>>): MarketMemoryTransition[] {
  return entries
    .map((entry) => {
      if (asString(entry.action).toLowerCase() !== "market-transition") {
        return null;
      }
      const transition = asRecord(asRecord(entry.meta).market_transition);
      return {
        id: asString(entry.id, `${entry.createdAtIso || "transition"}`),
        createdAtIso: asString(entry.createdAtIso),
        transitionType: asString(transition.transition_type, "UNKNOWN").toUpperCase(),
        fromRegime: asString(transition.from_regime, "UNKNOWN").toUpperCase(),
        toRegime: asString(transition.to_regime, "UNKNOWN").toUpperCase(),
        fromMarketTruthState: asString(transition.from_market_truth_state, "UNKNOWN").toUpperCase(),
        toMarketTruthState: asString(transition.to_market_truth_state, "UNKNOWN").toUpperCase(),
        fromAdmissibilityState: asString(transition.from_admissibility_state, "UNKNOWN").toUpperCase(),
        toAdmissibilityState: asString(transition.to_admissibility_state, "UNKNOWN").toUpperCase(),
        fromBlockingLayer: asString(transition.from_blocking_layer, "none").toLowerCase(),
        toBlockingLayer: asString(transition.to_blocking_layer, "none").toLowerCase(),
        fromDensityState: asString(transition.from_density_state, "UNKNOWN").toUpperCase(),
        toDensityState: asString(transition.to_density_state, "UNKNOWN").toUpperCase(),
        fromEdgeState: asString(transition.from_edge_state, "UNKNOWN").toUpperCase(),
        toEdgeState: asString(transition.to_edge_state, "UNKNOWN").toUpperCase(),
        truthQualityDeltaPct: asNumber(transition.truth_quality_delta_pct, 0),
      } satisfies MarketMemoryTransition;
    })
    .filter((value): value is MarketMemoryTransition => Boolean(value))
    .sort((left, right) => Date.parse(right.createdAtIso) - Date.parse(left.createdAtIso));
}

export function parseMarketExecutionDegradations(entries: Array<Record<string, unknown>>): MarketExecutionDegradation[] {
  return entries
    .map((entry) => {
      if (asString(entry.action).toLowerCase() !== "market-execution-degradation") {
        return null;
      }
      const degradation = asRecord(asRecord(entry.meta).execution_degradation);
      return {
        id: asString(entry.id, `${entry.createdAtIso || "degradation"}`),
        createdAtIso: asString(entry.createdAtIso),
        symbol: asString(entry.symbol, "UNKNOWN").toUpperCase(),
        timeframe: asString(entry.timeframe, "UNKNOWN"),
        venue: asString(degradation.venue, "MULTI").toUpperCase(),
        routeMode: asString(degradation.route_mode, "unknown").toLowerCase(),
        degradationType: asString(degradation.degradation_type, "UNKNOWN").toUpperCase(),
        regime: asString(degradation.regime, "UNKNOWN").toUpperCase(),
        marketTruthState: asString(degradation.market_truth_state, "UNKNOWN").toUpperCase(),
        edgeState: asString(degradation.edge_state, "UNKNOWN").toUpperCase(),
        blockingLayer: asString(degradation.blocking_layer, "none").toLowerCase(),
        executionQualityPct: asNumber(degradation.execution_quality_pct, 0),
        detail: asString(degradation.detail),
      } satisfies MarketExecutionDegradation;
    })
    .filter((value): value is MarketExecutionDegradation => Boolean(value))
    .sort((left, right) => Date.parse(right.createdAtIso) - Date.parse(left.createdAtIso));
}

export function parseMarketMicrostructureAnomalies(entries: Array<Record<string, unknown>>): MarketMicrostructureAnomaly[] {
  return entries
    .map((entry) => {
      if (asString(entry.action).toLowerCase() !== "market-microstructure-anomaly") {
        return null;
      }
      const anomaly = asRecord(asRecord(entry.meta).microstructure_anomaly);
      const anomalyType = asString(anomaly.anomaly_type, "UNKNOWN").toUpperCase();
      const taxonomy = classifyAnomalyFamily(anomalyType);
      const severityRaw = asString(anomaly.severity, "warn").toLowerCase();
      const severity: MarketMicrostructureAnomaly["severity"] = severityRaw === "critical"
        ? "critical"
        : severityRaw === "info"
          ? "info"
          : "warn";
      return {
        id: asString(entry.id, `${entry.createdAtIso || "anomaly"}`),
        createdAtIso: asString(entry.createdAtIso),
        symbol: asString(entry.symbol, "UNKNOWN").toUpperCase(),
        timeframe: asString(entry.timeframe, "UNKNOWN"),
        venue: asString(anomaly.venue, "MULTI").toUpperCase(),
        routeMode: asString(anomaly.route_mode, "unknown").toLowerCase(),
        anomalyType,
        anomalyFamily: asString(anomaly.anomaly_family, taxonomy.anomalyFamily).toUpperCase(),
        operatorFamily: asString(anomaly.operator_family, taxonomy.operatorFamily).toLowerCase(),
        regime: asString(anomaly.regime, "UNKNOWN").toUpperCase(),
        severity,
        marketTruthState: asString(anomaly.market_truth_state, "UNKNOWN").toUpperCase(),
        blockingLayer: asString(anomaly.blocking_layer, "none").toLowerCase(),
        evidenceMetrics: {
          persistencePct: asNumber(asRecord(anomaly.evidence_metrics).persistence_pct, 0),
          confidencePct: asNumber(asRecord(anomaly.evidence_metrics).confidence_pct, 0),
        },
        detail: asString(anomaly.detail),
      } satisfies MarketMicrostructureAnomaly;
    })
    .filter((value): value is MarketMicrostructureAnomaly => Boolean(value))
    .sort((left, right) => Date.parse(right.createdAtIso) - Date.parse(left.createdAtIso));
}

export function buildMarketMemorySummary(entries: Array<Record<string, unknown>>, options?: { nowMs?: number }): MarketMemorySummary {
  const nowMs = options?.nowMs ?? Date.now();
  const snapshots = parseMarketMemorySnapshots(entries);
  const transitions = parseMarketMemoryTransitions(entries);
  const microstructureAnomalies = parseMarketMicrostructureAnomalies(entries);
  const executionDegradations = parseMarketExecutionDegradations(entries);
  const recentSnapshots = snapshots.filter((snapshot) => withinHours(snapshot.createdAtIso, 24));
  const recentTransitions = transitions.filter((transition) => withinHours(transition.createdAtIso, 24));
  const recentAnomalies = microstructureAnomalies.filter((anomaly) => withinHours(anomaly.createdAtIso, 24));
  const recentDegradations = executionDegradations.filter((degradation) => withinHours(degradation.createdAtIso, 24));

  const grouped = new Map<string, {
    sampleCount: number;
    truthQualitySum: number;
    coherenceSum: number;
    freshnessSum: number;
    informationDensitySum: number;
    executionQualitySum: number;
    anomalyBurdenSum: number;
    inadmissibleCount: number;
    degradationCount: number;
    lastMarketTruthState: string;
    lastSeenIso: string;
  }>();

  for (const snapshot of snapshots) {
    const bucket = grouped.get(snapshot.regime) || {
      sampleCount: 0,
      truthQualitySum: 0,
      coherenceSum: 0,
      freshnessSum: 0,
      informationDensitySum: 0,
      executionQualitySum: 0,
      anomalyBurdenSum: 0,
      inadmissibleCount: 0,
      degradationCount: 0,
      lastMarketTruthState: snapshot.marketTruthState,
      lastSeenIso: snapshot.createdAtIso,
    };
    bucket.sampleCount += 1;
    bucket.truthQualitySum += snapshot.truthQualityPct;
    bucket.coherenceSum += snapshot.coherencePct;
    bucket.freshnessSum += snapshot.freshnessPct;
    bucket.informationDensitySum += snapshot.informationDensityPct;
    bucket.executionQualitySum += snapshot.executionQualityPct;
    bucket.anomalyBurdenSum += snapshot.anomalyBurdenPct;
    if (snapshot.admissibilityState === "INADMISSIBLE" || snapshot.marketTruthState === "UNTRUSTWORTHY" || snapshot.edgeState === "BLOCKED") {
      bucket.inadmissibleCount += 1;
    }
    if (snapshot.executionQualityPct < 60 || snapshot.blockingLayer === "execution_lock") {
      bucket.degradationCount += 1;
    }
    if (Date.parse(snapshot.createdAtIso) >= Date.parse(bucket.lastSeenIso)) {
      bucket.lastSeenIso = snapshot.createdAtIso;
      bucket.lastMarketTruthState = snapshot.marketTruthState;
    }
    grouped.set(snapshot.regime, bucket);
  }

  const regimeRows: MarketMemoryRegimeRow[] = [...grouped.entries()]
    .map(([regime, bucket]) => {
      const memoryConfidencePct = Math.round(clamp(
        (bucket.sampleCount / 12) * 55
          + ((bucket.truthQualitySum / bucket.sampleCount) / 100) * 30
          + (1 - (bucket.anomalyBurdenSum / bucket.sampleCount) / 100) * 15,
        0,
        100,
      ));
      return {
        regime,
        sampleCount: bucket.sampleCount,
        avgTruthQualityPct: Math.round(bucket.truthQualitySum / bucket.sampleCount),
        avgCoherencePct: Math.round(bucket.coherenceSum / bucket.sampleCount),
        avgFreshnessPct: Math.round(bucket.freshnessSum / bucket.sampleCount),
        avgInformationDensityPct: Math.round(bucket.informationDensitySum / bucket.sampleCount),
        avgExecutionQualityPct: Math.round(bucket.executionQualitySum / bucket.sampleCount),
        avgAnomalyBurdenPct: Math.round(bucket.anomalyBurdenSum / bucket.sampleCount),
        inadmissibleSharePct: Math.round((bucket.inadmissibleCount / bucket.sampleCount) * 100),
        degradationSharePct: Math.round((bucket.degradationCount / bucket.sampleCount) * 100),
        memoryConfidencePct,
        lastMarketTruthState: bucket.lastMarketTruthState,
        lastSeenIso: bucket.lastSeenIso,
      } satisfies MarketMemoryRegimeRow;
    })
    .sort((left, right) => right.sampleCount - left.sampleCount || right.inadmissibleSharePct - left.inadmissibleSharePct || left.regime.localeCompare(right.regime));

  const falseContextFamilies = [...new Map(snapshots.filter((snapshot) => Boolean(snapshot.falseContextFamily)).map((snapshot) => {
    const key = [
      snapshot.falseContextFamily,
        snapshot.oracleFingerprint,
      snapshot.symbol,
      snapshot.timeframe,
      snapshot.venue,
      snapshot.routeMode,
    ].join(":" );
    return [key, key];
  })).values()]
    .map((key) => {
      const group = snapshots.filter((snapshot) => {
        const snapshotKey = [
          snapshot.falseContextFamily,
          snapshot.oracleFingerprint,
          snapshot.symbol,
          snapshot.timeframe,
          snapshot.venue,
          snapshot.routeMode,
        ].join(":");
        return snapshotKey === key;
      });
      const first = group[0];
      return {
        family: first?.falseContextFamily || "UNKNOWN",
        symbol: first?.symbol || "UNKNOWN",
        timeframe: first?.timeframe || "UNKNOWN",
        venue: first?.venue || "MULTI",
        routeMode: first?.routeMode || "unknown",
        count: group.length,
        noTradeCount: group.filter((snapshot) => snapshot.falseContextNoTrade).length,
        latestAtIso: group[0]?.createdAtIso || "",
        triggerLayers: [...new Map(group.map((snapshot) => [snapshot.falseContextTriggerLayer, snapshot.falseContextTriggerLayer])).values()].filter(Boolean).slice(0, 3),
        reasons: [...new Map(group.flatMap((snapshot) => snapshot.falseContextReasons).map((reason) => [reason, reason])).values()].slice(0, 5),
      };
    })
    .sort((left, right) => right.count - left.count || right.noTradeCount - left.noTradeCount || left.family.localeCompare(right.family));

  const hotSnapshots = snapshots.filter((snapshot) => withinAgeWindow(snapshot.createdAtIso, nowMs, 0, 24 * 7));
  const warmSnapshots = snapshots.filter((snapshot) => withinAgeWindow(snapshot.createdAtIso, nowMs, 24 * 7, 24 * 30));
  const coldSnapshots = snapshots.filter((snapshot) => withinAgeWindow(snapshot.createdAtIso, nowMs, 24 * 30, null));
  const hotTransitions = transitions.filter((transition) => withinAgeWindow(transition.createdAtIso, nowMs, 0, 24 * 7));
  const warmTransitions = transitions.filter((transition) => withinAgeWindow(transition.createdAtIso, nowMs, 24 * 7, 24 * 30));
  const coldTransitions = transitions.filter((transition) => withinAgeWindow(transition.createdAtIso, nowMs, 24 * 30, null));
  const hotAnomalies = microstructureAnomalies.filter((anomaly) => withinAgeWindow(anomaly.createdAtIso, nowMs, 0, 24 * 7));
  const warmAnomalies = microstructureAnomalies.filter((anomaly) => withinAgeWindow(anomaly.createdAtIso, nowMs, 24 * 7, 24 * 30));
  const coldAnomalies = microstructureAnomalies.filter((anomaly) => withinAgeWindow(anomaly.createdAtIso, nowMs, 24 * 30, null));
  const hotDegradations = executionDegradations.filter((degradation) => withinAgeWindow(degradation.createdAtIso, nowMs, 0, 24 * 7));
  const warmDegradations = executionDegradations.filter((degradation) => withinAgeWindow(degradation.createdAtIso, nowMs, 24 * 7, 24 * 30));
  const coldDegradations = executionDegradations.filter((degradation) => withinAgeWindow(degradation.createdAtIso, nowMs, 24 * 30, null));

  const hot = buildLayerSummary({
    layer: "hot",
    windowLabel: "last_7d",
    snapshots: hotSnapshots,
    transitions: hotTransitions,
    anomalies: hotAnomalies,
    degradations: hotDegradations,
  });
  const warm = buildLayerSummary({
    layer: "warm",
    windowLabel: "last_30d",
    snapshots: warmSnapshots,
    transitions: warmTransitions,
    anomalies: warmAnomalies,
    degradations: warmDegradations,
  });
  const cold = buildLayerSummary({
    layer: "cold",
    windowLabel: "older_than_30d",
    snapshots: coldSnapshots,
    transitions: coldTransitions,
    anomalies: coldAnomalies,
    degradations: coldDegradations,
  });

  const maxCapsuleSampleCount = Math.max(1, ...snapshots.map((snapshot) => 1));
  const capsuleBuckets = new Map<string, {
    snapshots: MarketMemorySnapshot[];
    transitions: MarketMemoryTransition[];
    anomalies: MarketMicrostructureAnomaly[];
    degradations: MarketExecutionDegradation[];
  }>();
  for (const snapshot of snapshots) {
    const key = [snapshot.symbol, snapshot.venue, snapshot.timeframe, snapshot.regime].join(":");
    const bucket = capsuleBuckets.get(key) || { snapshots: [], transitions: [], anomalies: [], degradations: [] };
    bucket.snapshots.push(snapshot);
    capsuleBuckets.set(key, bucket);
  }
  for (const anomaly of microstructureAnomalies) {
    const key = [anomaly.symbol, anomaly.venue, anomaly.timeframe, anomaly.regime].join(":");
    const bucket = capsuleBuckets.get(key) || { snapshots: [], transitions: [], anomalies: [], degradations: [] };
    bucket.anomalies.push(anomaly);
    capsuleBuckets.set(key, bucket);
  }
  for (const degradation of executionDegradations) {
    const key = [degradation.symbol, degradation.venue, degradation.timeframe, degradation.regime].join(":");
    const bucket = capsuleBuckets.get(key) || { snapshots: [], transitions: [], anomalies: [], degradations: [] };
    bucket.degradations.push(degradation);
    capsuleBuckets.set(key, bucket);
  }
  for (const transition of transitions) {
    for (const [key, bucket] of capsuleBuckets.entries()) {
      if (key.endsWith(`:${transition.toRegime}`) || key.endsWith(`:${transition.fromRegime}`)) {
        bucket.transitions.push(transition);
      }
    }
  }

  const capsules: MarketMemoryCapsule[] = [...capsuleBuckets.entries()]
    .map(([contextKey, bucket]) => {
      const orderedSnapshots = sortByCreatedAtIso(bucket.snapshots);
      const latestSnapshot = orderedSnapshots[0];
      if (!latestSnapshot) {
        return null;
      }
      const snapshotCount = orderedSnapshots.length;
      const noTradeCount = orderedSnapshots.filter((snapshot) => snapshot.falseContextNoTrade).length;
      const falseContextCount = orderedSnapshots.filter((snapshot) => Boolean(snapshot.falseContextFamily)).length;
      const avgTruthQualityPct = average(orderedSnapshots.map((snapshot) => snapshot.truthQualityPct));
      const avgExecutionQualityPct = average(orderedSnapshots.map((snapshot) => snapshot.executionQualityPct));
      const avgAnomalyBurdenPct = average(orderedSnapshots.map((snapshot) => snapshot.anomalyBurdenPct));
      const degradationSharePct = snapshotCount > 0 ? (bucket.degradations.length / snapshotCount) * 100 : 0;
      const admissibilityShiftCount = bucket.transitions.filter((transition) => transition.transitionType === "ADMISSIBILITY_SHIFT").length;
      const transitionPressurePct = Math.round(clamp(
        bucket.transitions.length * 10
          + admissibilityShiftCount * 18
          + bucket.anomalies.length * 4,
        0,
        100,
      ));
      const recurrenceScorePct = Math.round(clamp(
        (snapshotCount / maxCapsuleSampleCount) * 55
          + bucket.transitions.length * 8
          + bucket.anomalies.length * 6
          + bucket.degradations.length * 7,
        0,
        100,
      ));
      const riskOfFalseContextPct = Math.round(clamp(
        (falseContextCount / Math.max(snapshotCount, 1)) * 60
          + (noTradeCount / Math.max(snapshotCount, 1)) * 25
          + avgAnomalyBurdenPct * 0.15,
        0,
        100,
      ));
      const expectedExecutionStressPct = Math.round(clamp(
        (100 - avgExecutionQualityPct) * 0.6
          + degradationSharePct * 0.4,
        0,
        100,
      ));
      const memoryConfidencePct = Math.round(clamp(
        avgTruthQualityPct * 0.45
          + recurrenceScorePct * 0.35
          + (100 - avgAnomalyBurdenPct) * 0.2,
        0,
        100,
      ));
      const lastAdmissibilityState = latestSnapshot.admissibilityState;
      const marketTemperaturePct = Math.round(clamp(
        expectedExecutionStressPct * 0.3
          + riskOfFalseContextPct * 0.25
          + transitionPressurePct * 0.2
          + admissibilityPressureFromState(lastAdmissibilityState) * 0.25,
        0,
        100,
      ));
      const transitionTypes = [...new Map(bucket.transitions.map((transition) => [transition.transitionType, transition.transitionType])).values()].slice(0, 4);
      const supportingEpisodes = sortByCreatedAtIso([
        ...orderedSnapshots,
        ...bucket.transitions,
        ...bucket.anomalies,
        ...bucket.degradations,
      ]).map((row) => row.id).slice(0, 5);
      const explanation = [
        `${latestSnapshot.regime.toLowerCase()} memory recalls ${snapshotCount} snapshot(s) on ${latestSnapshot.timeframe}`,
        `${latestSnapshot.marketTruthState.toLowerCase()} truth ${Math.round(avgTruthQualityPct)}% with execution ${Math.round(avgExecutionQualityPct)}%`,
        falseContextCount > 0
          ? `${latestSnapshot.falseContextFamily?.toLowerCase() || "false context"} recurs in ${falseContextCount} snapshot(s)`
          : "no false context recurrence recorded in this capsule",
        `temperature ${marketTemperatureStateFromPct(marketTemperaturePct).toLowerCase()} ${marketTemperaturePct}% with admissibility ${lastAdmissibilityState.toLowerCase()}`,
      ];
      return {
        capsuleId: `capsule:${contextKey}`,
        generatedAtIso: new Date(nowMs).toISOString(),
        contextKey,
        layer: resolveCapsuleLayer(latestSnapshot.createdAtIso, nowMs),
        currentRegime: latestSnapshot.regime,
        currentVenue: latestSnapshot.venue,
        currentTimeframe: latestSnapshot.timeframe,
        memoryConfidencePct,
        recurrenceScorePct,
        riskOfFalseContextPct,
        expectedExecutionStressPct,
        transitionPressurePct,
        admissibilityShiftCount,
        marketTemperaturePct,
        marketTemperatureState: marketTemperatureStateFromPct(marketTemperaturePct),
        lastAdmissibilityState,
        lastOracleFingerprint: latestSnapshot.oracleFingerprint,
        transitionTypes,
        supportingEpisodes,
        explanation,
      } satisfies MarketMemoryCapsule;
    })
    .filter((value): value is MarketMemoryCapsule => Boolean(value))
    .sort((left, right) => right.marketTemperaturePct - left.marketTemperaturePct || right.recurrenceScorePct - left.recurrenceScorePct || right.memoryConfidencePct - left.memoryConfidencePct || left.contextKey.localeCompare(right.contextKey))
    .slice(0, 6);

  const marketTemperature = buildMarketTemperatureSummary({
    capsules,
    snapshots,
    transitions,
  });

  return {
    generatedAtIso: new Date().toISOString(),
    sampleCount: snapshots.length,
    latestSnapshot: snapshots[0] || null,
    snapshots,
    regimeRows,
    transitions: transitions.slice(0, 24),
    microstructureAnomalies: microstructureAnomalies.slice(0, 24),
    executionDegradations: executionDegradations.slice(0, 24),
    falseContextFamilies,
    windows: {
      last_24h: {
        snapshotCount: recentSnapshots.length,
        transitionCount: recentTransitions.length,
        anomalyCount: recentAnomalies.length,
        degradationCount: recentDegradations.length,
      },
    },
    marketTemperature,
    hierarchicalCompression: {
      hot,
      warm,
      cold,
      capsules,
    },
  };
}