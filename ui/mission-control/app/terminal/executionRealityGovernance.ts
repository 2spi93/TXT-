import type { ExecutionEngineSnapshot } from "../../lib/executionEngine";

import type { ExecutionRealityMemorySnapshot } from "./executionRealityMemory";
import type { ExecutionRealitySummary } from "./executionRealityScore";

export type ExecutionRealityGovernanceState = "OPEN" | "CAUTION" | "DEFENSIVE" | "LOCKDOWN";
export type RealityDriftState = "CALM" | "WATCH" | "DIVERGENT" | "BROKEN";
export type SlippageRegime = "NORMAL" | "ELEVATED" | "STRESSED" | "DISLOCATED";
export type VenueStabilityState = "STABLE" | "FRAGILE" | "DEGRADED" | "BROKEN";
export type RoutingFragilityState = "STABLE" | "WATCH" | "FRAGILE" | "BROKEN";
export type LatencyPressureState = "CALM" | "ELEVATED" | "CRITICAL";
export type SpreadDegradationState = "TIGHT" | "ELEVATED" | "WIDE" | "DISLOCATED";
export type FillReliabilityState = "RELIABLE" | "WATCH" | "WEAK" | "BROKEN";
export type MicrostructureIntegrityState = "INTACT" | "WATCH" | "FRAGILE" | "BROKEN";
export type ExecutionRealityGovernanceDriver = "NONE" | "REALITY_DRIFT" | "SLIPPAGE" | "ROUTING" | "LATENCY" | "SPREAD" | "FILL" | "VENUE" | "MICROSTRUCTURE";

export type ExecutionRealityGovernanceSummary = {
  schema_version?: "execution-reality-governance/v1";
  state: ExecutionRealityGovernanceState;
  score_pct: number;
  allow_new_risk: boolean;
  blocks_execution: boolean;
  size_cap_pct: number;
  summary_label: string;
  reasons: string[];
  dominant_driver: ExecutionRealityGovernanceDriver;
  reality_drift: RealityDriftState;
  slippage_regime: SlippageRegime;
  venue_stability: VenueStabilityState;
  routing_fragility: RoutingFragilityState;
  latency_pressure: LatencyPressureState;
  spread_degradation: SpreadDegradationState;
  fill_reliability: FillReliabilityState;
  microstructure_integrity: MicrostructureIntegrityState;
  metrics: {
    execution_quality_score_pct: number;
    venue_stability_pct: number;
    routing_fragility_pct: number;
    latency_pressure_pct: number;
    spread_degradation_pct: number;
    fill_reliability_pct: number;
    microstructure_integrity_pct: number;
    reality_drift_pct: number;
  };
};

type BuildExecutionRealityGovernanceInput = {
  executionReality: ExecutionRealitySummary;
  executionRealityMemory?: ExecutionRealityMemorySnapshot | null;
  executionEngine: ExecutionEngineSnapshot;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function classifyRealityDrift(value: number): RealityDriftState {
  if (value >= 78) {
    return "BROKEN";
  }
  if (value >= 52) {
    return "DIVERGENT";
  }
  if (value >= 24) {
    return "WATCH";
  }
  return "CALM";
}

function classifySlippageRegime(value: number): SlippageRegime {
  if (value >= 78) {
    return "DISLOCATED";
  }
  if (value >= 54) {
    return "STRESSED";
  }
  if (value >= 28) {
    return "ELEVATED";
  }
  return "NORMAL";
}

function classifyVenueStability(value: number): VenueStabilityState {
  if (value < 28) {
    return "BROKEN";
  }
  if (value < 48) {
    return "DEGRADED";
  }
  if (value < 72) {
    return "FRAGILE";
  }
  return "STABLE";
}

function classifyRoutingFragility(value: number): RoutingFragilityState {
  if (value >= 82) {
    return "BROKEN";
  }
  if (value >= 58) {
    return "FRAGILE";
  }
  if (value >= 28) {
    return "WATCH";
  }
  return "STABLE";
}

function classifyLatencyPressure(value: number): LatencyPressureState {
  if (value >= 70) {
    return "CRITICAL";
  }
  if (value >= 38) {
    return "ELEVATED";
  }
  return "CALM";
}

function classifySpreadDegradation(value: number): SpreadDegradationState {
  if (value >= 80) {
    return "DISLOCATED";
  }
  if (value >= 56) {
    return "WIDE";
  }
  if (value >= 30) {
    return "ELEVATED";
  }
  return "TIGHT";
}

function classifyFillReliability(value: number): FillReliabilityState {
  if (value < 28) {
    return "BROKEN";
  }
  if (value < 52) {
    return "WEAK";
  }
  if (value < 74) {
    return "WATCH";
  }
  return "RELIABLE";
}

function classifyMicrostructureIntegrity(value: number): MicrostructureIntegrityState {
  if (value < 24) {
    return "BROKEN";
  }
  if (value < 46) {
    return "FRAGILE";
  }
  if (value < 72) {
    return "WATCH";
  }
  return "INTACT";
}

function memoryStress(memory?: ExecutionRealityMemorySnapshot | null): number {
  if (!memory) {
    return 0;
  }
  switch (memory.memory_state) {
    case "LOCKDOWN":
      return 1;
    case "PERSISTENT":
      return 0.68;
    case "RECOVERING":
      return 0.34;
    case "EPISODIC":
      return 0.22;
    default:
      return 0;
  }
}

function realityStress(reality: ExecutionRealitySummary): number {
  switch (reality.state) {
    case "HALT":
      return 1;
    case "DEGRADED":
      return 0.72;
    case "CAUTION":
      return 0.36;
    default:
      return 0.08;
  }
}

function engineActionStress(snapshot: ExecutionEngineSnapshot): number {
  return snapshot.action === "BLOCK"
    ? 1
    : snapshot.action === "WAIT"
      ? 0.58
      : 0.18;
}

function repricingTriggerStress(snapshot: ExecutionEngineSnapshot): number {
  switch (snapshot.repricing.trigger) {
    case "spread_expansion":
      return 0.9;
    case "latency_drift":
      return 0.82;
    case "partial_fill":
      return 0.7;
    case "queue_decay":
      return 0.44;
    default:
      return 0.08;
  }
}

export function buildExecutionRealityGovernanceSummary(input: BuildExecutionRealityGovernanceInput): ExecutionRealityGovernanceSummary {
  const memory = input.executionRealityMemory || null;
  const reasons: string[] = [];
  const expectedVsBudgetRatio = clamp(
    input.executionEngine.slippage.budgetBps > 0
      ? input.executionEngine.slippage.expectedBps / input.executionEngine.slippage.budgetBps
      : 0,
    0,
    3,
  );
  const currentVsBudgetRatio = clamp(
    input.executionEngine.slippage.budgetBps > 0
      ? input.executionReality.metrics.slippage_bps / input.executionEngine.slippage.budgetBps
      : 0,
    0,
    3,
  );
  const slippageStressPct = Math.round(clamp(Math.max(expectedVsBudgetRatio, currentVsBudgetRatio) / 1.45, 0, 1) * 100);
  const fillReliabilityPct = Math.round(clamp(
    (input.executionReality.metrics.fill_rate_pct / 100) * 0.5
      + input.executionEngine.partialFillHandling.expectedFillRatio * 0.3
      + input.executionEngine.partialFillHandling.recentFillRatio * 0.2,
    0,
    1,
  ) * 100);
  const venueStabilityPct = Math.round(clamp(
    (input.executionEngine.shadow.status === "promote" ? 1 : input.executionEngine.shadow.status === "shadow" ? 0.62 : 0.18) * 0.42
      + input.executionEngine.shadow.confidence * 0.34
      + (input.executionEngine.action === "PLACE" ? 1 : input.executionEngine.action === "WAIT" ? 0.52 : 0.1) * 0.24,
    0,
    1,
  ) * 100);
  const routingFragilityPct = Math.round(clamp(
    engineActionStress(input.executionEngine) * 0.28
      + repricingTriggerStress(input.executionEngine) * 0.18
      + (input.executionEngine.repricing.enabled ? 0.68 : 0.08) * 0.16
      + (1 - input.executionEngine.partialFillHandling.expectedFillRatio) * 0.22
      + (1 - input.executionEngine.shadow.confidence) * 0.16,
    0,
    1,
  ) * 100);
  const latencyPressurePct = Math.round(clamp(
    clamp(input.executionEngine.latency.currentMs / Math.max(input.executionEngine.latency.guardMs, 1), 0, 2) / 1.2 * 0.62
      + clamp(input.executionReality.metrics.latency_ms / 650, 0, 1) * 0.38,
    0,
    1,
  ) * 100);
  const spreadDegradationPct = Math.round(clamp(
    clamp(input.executionEngine.entry.targetSpreadBps / Math.max(input.executionEngine.slippage.budgetBps, 1), 0, 2) / 1.18 * 0.68
      + clamp(input.executionEngine.slippage.expectedBps / Math.max(input.executionEngine.slippage.budgetBps, 1), 0, 2) / 1.3 * 0.32,
    0,
    1,
  ) * 100);
  const executionQualityScorePct = Math.round(clamp(
    (input.executionReality.score_pct / 100) * 0.7
      + input.executionEngine.shadow.confidence * 0.3,
    0,
    1,
  ) * 100);
  const microstructureIntegrityPct = Math.round(clamp(
    1 - (
      (routingFragilityPct / 100) * 0.32
      + (latencyPressurePct / 100) * 0.18
      + (spreadDegradationPct / 100) * 0.18
      + (slippageStressPct / 100) * 0.14
      + (1 - venueStabilityPct / 100) * 0.18
    ),
    0,
    1,
  ) * 100);
  const liveStress = clamp(
    (routingFragilityPct / 100) * 0.22
      + (latencyPressurePct / 100) * 0.16
      + (spreadDegradationPct / 100) * 0.14
      + (slippageStressPct / 100) * 0.14
      + (1 - fillReliabilityPct / 100) * 0.12
      + (1 - venueStabilityPct / 100) * 0.12
      + (1 - microstructureIntegrityPct / 100) * 0.1,
    0,
    1,
  );
  const baselineStress = clamp(realityStress(input.executionReality) * 0.64 + memoryStress(memory) * 0.36, 0, 1);
  const realityDriftPct = Math.round(clamp(Math.max(0, liveStress - baselineStress * 0.9), 0, 1) * 100);

  const realityDrift = classifyRealityDrift(realityDriftPct);
  const slippageRegime = classifySlippageRegime(slippageStressPct);
  const venueStability = classifyVenueStability(venueStabilityPct);
  const routingFragility = classifyRoutingFragility(routingFragilityPct);
  const latencyPressure = classifyLatencyPressure(latencyPressurePct);
  const spreadDegradation = classifySpreadDegradation(spreadDegradationPct);
  const fillReliability = classifyFillReliability(fillReliabilityPct);
  const microstructureIntegrity = classifyMicrostructureIntegrity(microstructureIntegrityPct);

  if (realityDrift !== "CALM") {
    reasons.push(`execution_reality_governance_drift:${realityDrift.toLowerCase()}`);
  }
  if (slippageRegime !== "NORMAL") {
    reasons.push(`execution_reality_governance_slippage:${slippageRegime.toLowerCase()}`);
  }
  if (routingFragility !== "STABLE") {
    reasons.push(`execution_reality_governance_routing:${routingFragility.toLowerCase()}`);
  }
  if (latencyPressure !== "CALM") {
    reasons.push(`execution_reality_governance_latency:${latencyPressure.toLowerCase()}`);
  }
  if (spreadDegradation !== "TIGHT") {
    reasons.push(`execution_reality_governance_spread:${spreadDegradation.toLowerCase()}`);
  }
  if (fillReliability !== "RELIABLE") {
    reasons.push(`execution_reality_governance_fill:${fillReliability.toLowerCase()}`);
  }
  if (venueStability !== "STABLE") {
    reasons.push(`execution_reality_governance_venue:${venueStability.toLowerCase()}`);
  }
  if (microstructureIntegrity !== "INTACT") {
    reasons.push(`execution_reality_governance_microstructure:${microstructureIntegrity.toLowerCase()}`);
  }
  if (input.executionEngine.repricing.trigger !== "none") {
    reasons.push(`execution_reality_governance_repricing:${input.executionEngine.repricing.trigger}`);
  }
  if (memory && memory.memory_state !== "CLEAR") {
    reasons.push(`execution_reality_governance_memory:${memory.memory_state.toLowerCase()}`);
  }

  const state: ExecutionRealityGovernanceState = input.executionReality.blocks_execution
    || Boolean(memory?.blocks_execution)
    || input.executionEngine.action === "BLOCK"
    || realityDrift === "BROKEN"
    ? "LOCKDOWN"
    : input.executionReality.state === "DEGRADED"
      || realityDrift === "DIVERGENT"
      || routingFragility === "FRAGILE"
      || spreadDegradation === "DISLOCATED"
      || latencyPressure === "CRITICAL"
      || fillReliability === "WEAK"
      || memory?.memory_state === "PERSISTENT"
      ? "DEFENSIVE"
      : input.executionReality.state === "CAUTION"
        || memory?.memory_state === "RECOVERING"
        || memory?.memory_state === "EPISODIC"
        || input.executionEngine.action === "WAIT"
        || realityDrift === "WATCH"
        || routingFragility === "WATCH"
        || spreadDegradation === "ELEVATED"
        || latencyPressure === "ELEVATED"
        || fillReliability === "WATCH"
        || venueStability === "FRAGILE"
        || microstructureIntegrity === "WATCH"
        ? "CAUTION"
        : "OPEN";
  const stateCapPct = state === "LOCKDOWN"
    ? 0
    : state === "DEFENSIVE"
      ? 35
      : state === "CAUTION"
        ? 72
        : 100;
  const sizeCapPct = Math.min(stateCapPct, input.executionReality.size_cap_pct, memory?.size_cap_pct ?? 100);
  const scorePct = Math.round(clamp(
    (executionQualityScorePct / 100) * 0.22
      + (venueStabilityPct / 100) * 0.12
      + (fillReliabilityPct / 100) * 0.14
      + (microstructureIntegrityPct / 100) * 0.16
      + (1 - routingFragilityPct / 100) * 0.12
      + (1 - latencyPressurePct / 100) * 0.08
      + (1 - spreadDegradationPct / 100) * 0.08
      + (1 - realityDriftPct / 100) * 0.08,
    0,
    1,
  ) * 100);

  const dominantDriverEntries: Array<[ExecutionRealityGovernanceDriver, number]> = [
    ["REALITY_DRIFT", realityDriftPct / 100],
    ["SLIPPAGE", slippageStressPct / 100],
    ["ROUTING", routingFragilityPct / 100],
    ["LATENCY", latencyPressurePct / 100],
    ["SPREAD", spreadDegradationPct / 100],
    ["FILL", 1 - fillReliabilityPct / 100],
    ["VENUE", 1 - venueStabilityPct / 100],
    ["MICROSTRUCTURE", 1 - microstructureIntegrityPct / 100],
  ];
  const [dominantDriver, dominantScore] = dominantDriverEntries.reduce(
    (best, current) => current[1] > best[1] ? current : best,
    ["NONE", 0] as [ExecutionRealityGovernanceDriver, number],
  );

  return {
    schema_version: "execution-reality-governance/v1",
    state,
    score_pct: scorePct,
    allow_new_risk: state === "OPEN",
    blocks_execution: state === "LOCKDOWN",
    size_cap_pct: sizeCapPct,
    summary_label: `EXEC GOV ${state} ${scorePct}% · drift ${realityDrift}`,
    reasons: dedupe(reasons),
    dominant_driver: dominantScore >= 0.18 ? dominantDriver : "NONE",
    reality_drift: realityDrift,
    slippage_regime: slippageRegime,
    venue_stability: venueStability,
    routing_fragility: routingFragility,
    latency_pressure: latencyPressure,
    spread_degradation: spreadDegradation,
    fill_reliability: fillReliability,
    microstructure_integrity: microstructureIntegrity,
    metrics: {
      execution_quality_score_pct: executionQualityScorePct,
      venue_stability_pct: venueStabilityPct,
      routing_fragility_pct: routingFragilityPct,
      latency_pressure_pct: latencyPressurePct,
      spread_degradation_pct: spreadDegradationPct,
      fill_reliability_pct: fillReliabilityPct,
      microstructure_integrity_pct: microstructureIntegrityPct,
      reality_drift_pct: realityDriftPct,
    },
  };
}