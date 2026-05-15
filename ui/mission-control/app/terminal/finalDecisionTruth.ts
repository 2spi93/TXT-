import type { TradabilityCalibrationThresholds } from "../../lib/tradabilityAnalytics";

import { coerceCrossMarketTruthSummary, type CrossMarketTruthSummary } from "./crossMarketTruth";
import type { CapitalScarMemorySummary } from "./capitalScarMemory";
import type { DynamicCapitalPressureSummary } from "./dynamicCapitalPressure";
import type { ExecutionRealityGovernanceSummary } from "./executionRealityGovernance";
import type { ExecutionRealitySummary } from "./executionRealityScore";
import type { ExecutionRealityMemorySnapshot } from "./executionRealityMemory";
import type { SelfPreservationSummary } from "./selfPreservation";

export type FrameTruthShape = {
  integrity_status: string;
  sync_status: string;
  freshness: string;
  reconstruction_flag: string;
  confidence: number;
  tradable: boolean;
  decision_allowed: boolean;
  reasons: string[];
};

export type FinalDecisionAction = "EXECUTE" | "REDUCE" | "WAIT" | "BLOCK";
export type FinalDecisionState = "TRADABLE" | "DECISION_READY" | "OBSERVE_ONLY" | "UNAVAILABLE";
export type FinalDecisionBlockingLayer = "truth" | "attention" | "smart_decision" | "confidence" | "execution_lock" | "information_density" | "router" | "risk" | "feedback" | "self_preservation" | "execution_reality" | null;
export type EdgeEligibilityState = "ELIGIBLE" | "OBSERVE" | "BLOCKED";
export type FinalDecisionInformationDensityState = "SUFFICIENT" | "THIN" | "DEGRADED";
export type MarketTruthState = "RELIABLE" | "WATCH" | "DEGRADED" | "UNTRUSTWORTHY";
export type FalseContextFamily = "FALSE_INTENT" | "FALSE_LIQUIDITY" | "FALSE_SYNC" | "FALSE_EXECUTION_CONTEXT";
export type FalseContextOperatorFamily = "intent" | "liquidity" | "sync" | "execution";
export type FalseContextArchetype = "INTENT_DISLOCATION" | "ANOMALY_DRIVEN_INTENT" | "THIN_BOOK" | "VACUUM_SWEEP" | "DESYNCHRONIZED_TRUTH" | "STALE_RECONSTRUCTION" | "EXECUTION_DEGRADATION" | "ROUTING_CONTEXT_DRIFT";
export type FalseContextSeverity = "WATCH" | "NO_TRADE";

export type FinalDecisionFalseContextTaxonomy = {
  operator_family: FalseContextOperatorFamily;
  archetype: FalseContextArchetype;
  severity: FalseContextSeverity;
  label: string;
  evidence_tags: string[];
};

export type FinalDecisionVerdictExplanation = {
  code: "contract" | "market_truth" | "information_density" | "false_context" | "attention" | "confidence";
  label: string;
  detail: string;
  tone: "good" | "subtle" | "warn";
};

export type FinalDecisionProof = {
  code: "contract" | "market_truth" | "information_density" | "false_context";
  label: string;
  value: string;
  evidence: string[];
  tone: "good" | "subtle" | "warn";
};

export type FinalDecisionTruth = {
  schema_version: "final-decision-truth/v1";
  generated_at_iso: string;
  oracle_fingerprint: string;
  state: FinalDecisionState;
  action: FinalDecisionAction;
  tradable: boolean;
  decision_allowed: boolean;
  should_trade: boolean;
  execution_allowed: boolean;
  allow_dual_venue_execution: boolean;
  preferred_venue: string | null;
  route_mode: string;
  blocking_layer: FinalDecisionBlockingLayer;
  risk_multiplier: number;
  summary_label: string;
  detail_label: string;
  reasons: string[];
  verdict_explanation: FinalDecisionVerdictExplanation[];
  proofs: FinalDecisionProof[];
  truth: FrameTruthShape | null;
  smart_decision: {
    state: string;
    confidence_band: string;
    headline: string;
    reason: string;
  } | null;
  confidence: {
    action_state: string;
    final_score_pct: number;
    quality_label: string;
    hard_veto: boolean;
    reasons: string[];
  };
  attention: {
    state: string;
    should_block_trading: boolean;
    summary_label: string;
    detail_label: string;
  };
  market_truth: {
    state: MarketTruthState;
    score_pct: number;
    reasons: string[];
    metrics: {
      coherence_pct: number;
      freshness_pct: number;
      information_density_pct: number;
      execution_quality_pct: number;
      anomaly_burden_pct: number;
    };
  };
  cross_market: CrossMarketTruthSummary | null;
  execution_reality: ExecutionRealitySummary | null;
  execution_reality_governance: ExecutionRealityGovernanceSummary | null;
  execution_reality_memory: ExecutionRealityMemorySnapshot | null;
  capital_scar: CapitalScarMemorySummary | null;
  capital_pressure: DynamicCapitalPressureSummary | null;
  self_preservation: SelfPreservationSummary | null;
  false_context: {
    family: FalseContextFamily | null;
    no_trade: boolean;
    trigger_layer: FinalDecisionBlockingLayer | "market_truth" | "none";
    reasons: string[];
    taxonomy: FinalDecisionFalseContextTaxonomy | null;
  };
  information_density: {
    state: FinalDecisionInformationDensityState;
    score_pct: number;
    entropy_pct: number;
    reasons: string[];
    calibration: {
      thin_score_floor_pct: number;
      degraded_score_floor_pct: number;
      thin_entropy_ceiling_pct: number;
      degraded_entropy_ceiling_pct: number;
    };
  };
  edge_eligibility: {
    state: EdgeEligibilityState;
    score_pct: number;
    reasons: string[];
    calibration: {
      information_density_weight_pct: number;
      base_signal_weight_pct: number;
    };
  };
};

export type FinalDecisionOracleExecutionView = {
  blocks_execution: boolean;
  action: FinalDecisionAction;
  summary_label: string;
  detail_label: string;
  blocking_layer: FinalDecisionBlockingLayer;
  reason_tags: string[];
};

export type FinalDecisionOracleObservabilityView = {
  market_state: "VALID" | "WAIT" | "NO_TRADE";
  reason_code: string;
  confidence: number;
  tone: "good" | "warn" | "bad";
  summary_label: string;
  detail_label: string;
  execution_summary_label: string;
  execution_detail_label: string;
};

type BuildFinalDecisionTruthInput = {
  frameTruth: FrameTruthShape | null;
  smartDecision?: {
    state?: string | null;
    confidenceBand?: string | null;
    headline?: string | null;
    reason?: string | null;
  } | null;
  confidence: {
    actionState: string;
    finalScorePct: number;
    qualityLabel: string;
    hardVeto: boolean;
    hardVetoReasons: string[];
  };
  attention: {
    state: string;
    shouldBlockTrading: boolean;
    summaryLabel: string;
    detailLabel: string;
  };
  executionLock: {
    active: boolean;
    code?: string | null;
    detailLabel?: string | null;
  };
  informationDensity?: {
    orderflowQuality: number;
    domDensity: number;
    touchDensity: number;
    liquidityVacuum: number;
    sweepRisk: number;
    syntheticReliability: number;
    microNoise: number;
  } | null;
  informationDensityCalibration?: TradabilityCalibrationThresholds | null;
  informationDensityImpactWeight?: number | null;
  crossMarket?: CrossMarketTruthSummary | null;
  executionReality?: ExecutionRealitySummary | null;
  executionRealityGovernance?: ExecutionRealityGovernanceSummary | null;
  executionRealityMemory?: ExecutionRealityMemorySnapshot | null;
  capitalScar?: CapitalScarMemorySummary | null;
  capitalPressure?: DynamicCapitalPressureSummary | null;
  selfPreservation?: SelfPreservationSummary | null;
  riskMultiplier: number;
  preferredVenue?: string | null;
  truthExecutionVenue?: string | null;
  marketTruthLockEnabled: boolean;
  generatedAtIso?: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asTextArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown): string {
  return String(value || "").trim();
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fdt-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function buildOracleFingerprint(value: Omit<FinalDecisionTruth, "generated_at_iso" | "oracle_fingerprint">): string {
  return hashString(stableSerialize(value));
}

function statusScore(value: unknown, mapping: Record<string, number>, fallback: number): number {
  const normalized = String(value || "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(mapping, normalized) ? mapping[normalized] : fallback;
}

function inferFalseContextFamily(input: {
  frameTruth: FrameTruthShape | null;
  blockingLayer: FinalDecisionBlockingLayer;
  smartDecisionState: string;
  informationDensityState: FinalDecisionInformationDensityState;
  informationDensityReasons: string[];
  marketTruthReasons: string[];
  executionLockActive: boolean;
  truthSyncScore: number;
  truthFreshnessScore: number;
  executionQualityScore: number;
}): { family: FalseContextFamily | null; reasons: string[]; triggerLayer: FinalDecisionBlockingLayer | "market_truth" | "none" } {
  const syncReasons = [
    ...input.marketTruthReasons.filter((reason) => reason === "missing_frame_truth" || reason === "freshness_degraded"),
    ...asTextArray(input.frameTruth?.reasons).filter((reason) => /sync|desync|stale|reconstruct/i.test(reason)),
  ];
  if (input.blockingLayer === "execution_lock" || input.executionLockActive || input.executionQualityScore < 0.55) {
    return {
      family: "FALSE_EXECUTION_CONTEXT",
      reasons: ["execution_quality_degraded", ...(input.marketTruthReasons.includes("execution_quality_degraded") ? [] : ["execution_context_unstable"])],
      triggerLayer: input.blockingLayer || "market_truth",
    };
  }
  if (input.truthSyncScore < 0.55 || input.truthFreshnessScore < 0.55 || syncReasons.length > 0) {
    return {
      family: "FALSE_SYNC",
      reasons: syncReasons.length > 0 ? syncReasons : ["freshness_degraded"],
      triggerLayer: input.blockingLayer === "truth" ? "truth" : "market_truth",
    };
  }
  if (input.informationDensityState !== "SUFFICIENT" || input.informationDensityReasons.some((reason) => reason.includes("liquidity") || reason.includes("dom_density") || reason.includes("touch_density"))) {
    return {
      family: "FALSE_LIQUIDITY",
      reasons: input.informationDensityReasons.length > 0 ? input.informationDensityReasons : [`information_density_${input.informationDensityState.toLowerCase()}`],
      triggerLayer: input.blockingLayer === "information_density" ? "information_density" : "market_truth",
    };
  }
  if (input.smartDecisionState === "NO_TRADE" || input.marketTruthReasons.includes("anomaly_burden_elevated")) {
    return {
      family: "FALSE_INTENT",
      reasons: input.smartDecisionState === "NO_TRADE" ? ["smart_no_trade"] : ["anomaly_burden_elevated"],
      triggerLayer: input.blockingLayer === "smart_decision" ? "smart_decision" : "market_truth",
    };
  }
  return {
    family: null,
    reasons: [],
    triggerLayer: "none",
  };
}

function buildFalseContextTaxonomy(input: {
  family: FalseContextFamily | null;
  reasons: string[];
  noTrade: boolean;
  triggerLayer: FinalDecisionBlockingLayer | "market_truth" | "none";
}): FinalDecisionFalseContextTaxonomy | null {
  if (!input.family) {
    return null;
  }
  const evidencePool = input.reasons;
  const evidenceTags = (() => {
    if (input.family === "FALSE_LIQUIDITY") {
      return [
        ...evidencePool.filter((reason) => /vacuum|sweep/i.test(reason)),
        ...evidencePool.filter((reason) => !/vacuum|sweep/i.test(reason)),
      ].slice(0, 3);
    }
    if (input.family === "FALSE_EXECUTION_CONTEXT") {
      return [
        ...evidencePool.filter((reason) => /lock|unstable|context/i.test(reason)),
        ...evidencePool.filter((reason) => !/lock|unstable|context/i.test(reason)),
      ].slice(0, 3);
    }
    return evidencePool.slice(0, 3);
  })();
  if (input.family === "FALSE_SYNC") {
    const stale = evidencePool.some((reason) => /fresh|stale|reconstruct/i.test(reason));
    const archetype: FalseContextArchetype = stale ? "STALE_RECONSTRUCTION" : "DESYNCHRONIZED_TRUTH";
    return {
      operator_family: "sync",
      archetype,
      severity: input.noTrade ? "NO_TRADE" : "WATCH",
      label: stale ? "stale reconstruction" : "desynchronized truth",
      evidence_tags: evidenceTags,
    };
  }
  if (input.family === "FALSE_LIQUIDITY") {
    const vacuum = evidencePool.some((reason) => /vacuum|sweep/i.test(reason));
    const archetype: FalseContextArchetype = vacuum ? "VACUUM_SWEEP" : "THIN_BOOK";
    return {
      operator_family: "liquidity",
      archetype,
      severity: input.noTrade ? "NO_TRADE" : "WATCH",
      label: vacuum ? "vacuum sweep" : "thin book",
      evidence_tags: evidenceTags,
    };
  }
  if (input.family === "FALSE_EXECUTION_CONTEXT") {
    const drift = input.triggerLayer === "execution_lock" || evidencePool.some((reason) => /lock|unstable|context/i.test(reason));
    const archetype: FalseContextArchetype = drift ? "ROUTING_CONTEXT_DRIFT" : "EXECUTION_DEGRADATION";
    return {
      operator_family: "execution",
      archetype,
      severity: input.noTrade ? "NO_TRADE" : "WATCH",
      label: drift ? "routing context drift" : "execution degradation",
      evidence_tags: evidenceTags,
    };
  }
  const anomalyDriven = evidencePool.some((reason) => /anomaly/i.test(reason));
  const archetype: FalseContextArchetype = anomalyDriven ? "ANOMALY_DRIVEN_INTENT" : "INTENT_DISLOCATION";
  return {
    operator_family: "intent",
    archetype,
    severity: input.noTrade ? "NO_TRADE" : "WATCH",
    label: anomalyDriven ? "anomaly driven intent" : "intent dislocation",
    evidence_tags: evidenceTags,
  };
}

function buildVerdictExplanation(input: {
  action: FinalDecisionAction;
  executionAllowed: boolean;
  shouldTrade: boolean;
  blockingLayer: FinalDecisionBlockingLayer;
  marketTruthState: MarketTruthState;
  marketTruthScorePct: number;
  informationDensityState: FinalDecisionInformationDensityState;
  informationDensityScorePct: number;
  falseContext: { family: FalseContextFamily | null; noTrade: boolean; reasons: string[]; taxonomy: FinalDecisionFalseContextTaxonomy | null };
  attention: { state: string; shouldBlockTrading: boolean };
  confidence: { actionState: string; finalScorePct: number; hardVeto: boolean };
}): FinalDecisionVerdictExplanation[] {
  const rows: FinalDecisionVerdictExplanation[] = [];
  const contractTone: FinalDecisionVerdictExplanation["tone"] = !input.executionAllowed
    ? "warn"
    : input.shouldTrade
      ? "good"
      : "subtle";
  rows.push({
    code: "contract",
    label: "Contract",
    detail: !input.executionAllowed
      ? `oracle ${input.action.toLowerCase()} via ${input.blockingLayer || "contract"}`
      : input.shouldTrade
        ? "oracle authorizes guarded execution"
        : `oracle keeps the desk in ${input.action.toLowerCase()}`,
    tone: contractTone,
  });
  rows.push({
    code: "market_truth",
    label: "Market truth",
    detail: `${input.marketTruthState.toLowerCase()} ${input.marketTruthScorePct}%`,
    tone: input.marketTruthState === "DEGRADED" || input.marketTruthState === "UNTRUSTWORTHY"
      ? "warn"
      : input.marketTruthState === "WATCH"
        ? "subtle"
        : "good",
  });
  rows.push({
    code: "information_density",
    label: "Information density",
    detail: `${input.informationDensityState.toLowerCase()} ${input.informationDensityScorePct}%`,
    tone: input.informationDensityState === "DEGRADED"
      ? "warn"
      : input.informationDensityState === "THIN"
        ? "subtle"
        : "good",
  });
  rows.push({
    code: "false_context",
    label: "False context",
    detail: input.falseContext.family
      ? `${input.falseContext.family.toLowerCase()}${input.falseContext.taxonomy ? ` · ${input.falseContext.taxonomy.archetype.toLowerCase()}` : ""}${input.falseContext.reasons.length > 0 ? ` · ${input.falseContext.reasons[0]}` : ""}`
      : "none detected",
    tone: input.falseContext.family ? (input.falseContext.noTrade ? "warn" : "subtle") : "good",
  });
  if (input.attention.shouldBlockTrading || input.attention.state) {
    rows.push({
      code: "attention",
      label: "Attention",
      detail: `${String(input.attention.state || "unknown").toLowerCase()}${input.attention.shouldBlockTrading ? " · block" : " · observe"}`,
      tone: input.attention.shouldBlockTrading ? "warn" : "subtle",
    });
  }
  rows.push({
    code: "confidence",
    label: "Confidence",
    detail: `${input.confidence.actionState.toLowerCase()} ${input.confidence.finalScorePct}%${input.confidence.hardVeto ? " · veto" : ""}`,
    tone: input.confidence.hardVeto || input.confidence.actionState === "blocked"
      ? "warn"
      : input.confidence.actionState === "watch" || input.confidence.actionState === "caution"
        ? "subtle"
        : "good",
  });
  return rows;
}

function buildFinalDecisionProofs(input: {
  action: FinalDecisionAction;
  blockingLayer: FinalDecisionBlockingLayer;
  executionAllowed: boolean;
  shouldTrade: boolean;
  reasonList: string[];
  marketTruth: FinalDecisionTruth["market_truth"];
  informationDensity: FinalDecisionTruth["information_density"];
  falseContext: FinalDecisionTruth["false_context"];
}): FinalDecisionProof[] {
  const contractTone: FinalDecisionProof["tone"] = !input.executionAllowed
    ? "warn"
    : input.shouldTrade
      ? "good"
      : "subtle";
  const proofs: FinalDecisionProof[] = [
    {
      code: "contract",
      label: "Contract",
      value: `${input.action}${input.blockingLayer ? ` via ${input.blockingLayer}` : ""}`,
      evidence: input.reasonList.slice(0, 3),
      tone: contractTone,
    },
    {
      code: "market_truth",
      label: "Market truth",
      value: `${input.marketTruth.state} ${input.marketTruth.score_pct}%`,
      evidence: [
        `coh ${input.marketTruth.metrics.coherence_pct}%`,
        `fresh ${input.marketTruth.metrics.freshness_pct}%`,
        `exec ${input.marketTruth.metrics.execution_quality_pct}%`,
      ],
      tone: input.marketTruth.state === "DEGRADED" || input.marketTruth.state === "UNTRUSTWORTHY"
        ? "warn"
        : input.marketTruth.state === "WATCH"
          ? "subtle"
          : "good",
    },
    {
      code: "information_density",
      label: "Information density",
      value: `${input.informationDensity.state} ${input.informationDensity.score_pct}% / H ${input.informationDensity.entropy_pct}%`,
      evidence: input.informationDensity.reasons.slice(0, 3),
      tone: input.informationDensity.state === "DEGRADED"
        ? "warn"
        : input.informationDensity.state === "THIN"
          ? "subtle"
          : "good",
    },
  ];
  if (input.falseContext.family) {
    proofs.push({
      code: "false_context",
      label: "False context",
      value: input.falseContext.taxonomy
        ? `${input.falseContext.taxonomy.label} · ${input.falseContext.taxonomy.severity}`
        : `${input.falseContext.family} · ${input.falseContext.no_trade ? "NO_TRADE" : "WATCH"}`,
      evidence: input.falseContext.taxonomy?.evidence_tags || input.falseContext.reasons.slice(0, 3),
      tone: input.falseContext.no_trade ? "warn" : "subtle",
    });
  }
  return proofs;
}

export function buildFinalDecisionTruth(input: BuildFinalDecisionTruthInput): FinalDecisionTruth {
  const reasons = new Set<string>();
  const frameTruth = input.frameTruth;
  const confidenceAction = String(input.confidence.actionState || "watch").trim().toLowerCase();
  const smartDecisionState = String(input.smartDecision?.state || "").trim().toUpperCase();
  const informationDensity = input.informationDensity;
  const truthState: FinalDecisionState = !frameTruth
    ? "UNAVAILABLE"
    : frameTruth.tradable
      ? "TRADABLE"
      : frameTruth.decision_allowed
        ? "DECISION_READY"
        : "OBSERVE_ONLY";

  const informationDensityScore = informationDensity
    ? clamp(
      clamp(informationDensity.orderflowQuality, 0, 1) * 0.3
        + clamp(informationDensity.domDensity, 0, 1) * 0.14
        + clamp(informationDensity.touchDensity, 0, 1) * 0.18
        + clamp(informationDensity.syntheticReliability, 0, 1) * 0.18
        + (1 - clamp(informationDensity.liquidityVacuum, 0, 1)) * 0.08
        + (1 - clamp(informationDensity.sweepRisk, 0, 1)) * 0.07
        + (1 - clamp(informationDensity.microNoise, 0, 1)) * 0.05,
      0,
      1,
    )
    : 0.5;
  const informationEntropy = informationDensity
    ? clamp(
      clamp(informationDensity.liquidityVacuum, 0, 1) * 0.28
        + clamp(informationDensity.sweepRisk, 0, 1) * 0.24
        + (1 - clamp(informationDensity.touchDensity, 0, 1)) * 0.16
        + (1 - clamp(informationDensity.domDensity, 0, 1)) * 0.1
        + (1 - clamp(informationDensity.syntheticReliability, 0, 1)) * 0.12
        + clamp(informationDensity.microNoise, 0, 1) * 0.1,
      0,
      1,
    )
    : 0.5;
  const informationDensityReasons: string[] = [];
  const informationDensityThresholds = input.informationDensityCalibration || {
    thinScoreFloor: 0.5,
    degradedScoreFloor: 0.28,
    thinEntropyCeiling: 0.58,
    degradedEntropyCeiling: 0.72,
  };
  const informationDensityImpactWeight = clamp(input.informationDensityImpactWeight ?? 0.18, 0.08, 0.3);
  const baseSignalWeight = clamp(1 - informationDensityImpactWeight, 0.7, 0.92);
  if (informationDensity) {
    if (informationDensity.touchDensity < 0.35) {
      informationDensityReasons.push("thin_touch_density");
    }
    if (informationDensity.domDensity < 0.25) {
      informationDensityReasons.push("low_dom_density");
    }
    if (informationDensity.orderflowQuality < 0.38) {
      informationDensityReasons.push("weak_orderflow_quality");
    }
    if (informationDensity.syntheticReliability < 0.42) {
      informationDensityReasons.push("synthetic_orderflow_unreliable");
    }
    if (informationDensity.liquidityVacuum > 0.58) {
      informationDensityReasons.push("liquidity_vacuum");
    }
    if (informationDensity.sweepRisk > 0.64) {
      informationDensityReasons.push("elevated_sweep_risk");
    }
    if (informationDensity.microNoise > 0.68) {
      informationDensityReasons.push("micro_noise_elevated");
    }
  }
  const informationDensityState: FinalDecisionInformationDensityState = !informationDensity
    ? "SUFFICIENT"
    : informationDensityScore < informationDensityThresholds.degradedScoreFloor || informationEntropy > informationDensityThresholds.degradedEntropyCeiling
      ? "DEGRADED"
      : informationDensityScore < informationDensityThresholds.thinScoreFloor || informationEntropy > informationDensityThresholds.thinEntropyCeiling
        ? "THIN"
        : "SUFFICIENT";
  const truthIntegrityScore = frameTruth
    ? statusScore(frameTruth.integrity_status, {
      OK: 0.92,
      VALID: 0.9,
      STABLE: 0.84,
      PARTIAL: 0.56,
      DEGRADED: 0.36,
      INVALID: 0.16,
      UNKNOWN: 0.5,
    }, 0.5)
    : 0.22;
  const truthSyncScore = frameTruth
    ? statusScore(frameTruth.sync_status, {
      SYNCED: 0.92,
      LIVE: 0.88,
      OK: 0.84,
      PARTIAL: 0.58,
      DELAYED: 0.38,
      DESYNC: 0.16,
      UNKNOWN: 0.5,
    }, 0.5)
    : 0.22;
  const truthFreshnessScore = frameTruth
    ? statusScore(frameTruth.freshness, {
      FRESH: 0.94,
      LIVE: 0.9,
      OK: 0.82,
      AGING: 0.58,
      STALE: 0.26,
      UNKNOWN: 0.5,
    }, 0.5)
    : 0.22;
  const reconstructionScore = frameTruth
    ? statusScore(frameTruth.reconstruction_flag, {
      CLEAN: 0.9,
      OK: 0.82,
      RECONSTRUCTED: 0.56,
      DEGRADED: 0.34,
      FAILED: 0.16,
      UNKNOWN: 0.5,
    }, 0.5)
    : 0.22;
  const coherenceScore = clamp(
    (frameTruth?.confidence ?? 0.5) * 0.42
      + truthIntegrityScore * 0.22
      + truthSyncScore * 0.2
      + reconstructionScore * 0.16,
    0,
    1,
  );
  const anomalyBurdenScore = informationDensity
    ? clamp(
      clamp(informationDensity.liquidityVacuum, 0, 1) * 0.38
        + clamp(informationDensity.sweepRisk, 0, 1) * 0.34
        + clamp(informationDensity.microNoise, 0, 1) * 0.28,
      0,
      1,
    )
    : 0.32;
  const executionQualityScore = clamp(
    clamp(input.riskMultiplier, 0, 1) * 0.6
      + (!input.executionLock.active ? 0.3 : 0.08)
      + (!input.attention.shouldBlockTrading ? 0.1 : 0),
    0,
    1,
  );
  const crossMarket = input.crossMarket || null;
  const executionReality = input.executionReality || null;
  const executionRealityGovernance = input.executionRealityGovernance || null;
  const executionRealityMemory = input.executionRealityMemory || null;
  const capitalScar = input.capitalScar || null;
  const capitalPressure = input.capitalPressure || null;
  const selfPreservation = input.selfPreservation || null;
  const crossMarketScore = crossMarket && crossMarket.state !== "UNAVAILABLE"
    ? clamp(crossMarket.score_pct / 100, 0, 1)
    : null;
  const baseMarketTruthScore = clamp(
    coherenceScore * 0.34
      + truthFreshnessScore * 0.22
      + informationDensityScore * 0.2
      + executionQualityScore * 0.16
      + (1 - anomalyBurdenScore) * 0.08,
    0,
    1,
  );
  const marketTruthScore = crossMarketScore === null
    ? baseMarketTruthScore
    : clamp(baseMarketTruthScore * 0.88 + crossMarketScore * 0.12, 0, 1);
  const marketTruthState: MarketTruthState = marketTruthScore >= 0.74
    ? "RELIABLE"
    : marketTruthScore >= 0.58
      ? "WATCH"
      : marketTruthScore >= 0.4
        ? "DEGRADED"
        : "UNTRUSTWORTHY";
  const marketTruthReasons: string[] = [];
  if (!frameTruth) {
    marketTruthReasons.push("missing_frame_truth");
  }
  if (coherenceScore < 0.55) {
    marketTruthReasons.push("coherence_weak");
  }
  if (truthFreshnessScore < 0.55) {
    marketTruthReasons.push("freshness_degraded");
  }
  if (informationDensityScore < 0.5) {
    marketTruthReasons.push("information_density_weak");
  }
  if (executionQualityScore < 0.55) {
    marketTruthReasons.push("execution_quality_degraded");
  }
  if (anomalyBurdenScore > 0.55) {
    marketTruthReasons.push("anomaly_burden_elevated");
  }
  if (crossMarket && crossMarket.state !== "UNAVAILABLE") {
    if (crossMarket.state === "INCOHERENT") {
      marketTruthReasons.push("cross_market_incoherent");
    } else if (crossMarket.state === "WATCH") {
      marketTruthReasons.push("cross_market_watch");
    }
    if (crossMarket.metrics.freshness_pct < 55) {
      marketTruthReasons.push("cross_market_stale");
    }
    if (crossMarket.metrics.coverage_pct < 55) {
      marketTruthReasons.push("cross_market_coverage_thin");
    }
  }

  let blockingLayer: FinalDecisionBlockingLayer = null;
  if (!frameTruth?.decision_allowed) {
    blockingLayer = "truth";
    asTextArray(frameTruth?.reasons).forEach((reason) => reasons.add(reason));
  }
  if (input.attention.shouldBlockTrading && !blockingLayer) {
    blockingLayer = "attention";
    if (input.attention.summaryLabel) {
      reasons.add(input.attention.summaryLabel);
    }
  }
  if (smartDecisionState === "NO_TRADE" && !blockingLayer) {
    blockingLayer = "smart_decision";
    if (input.smartDecision?.headline) {
      reasons.add(String(input.smartDecision.headline));
    }
    if (input.smartDecision?.reason) {
      reasons.add(String(input.smartDecision.reason));
    }
  }
  if ((input.confidence.hardVeto || confidenceAction === "blocked" || confidenceAction === "watch") && !blockingLayer) {
    blockingLayer = "confidence";
    input.confidence.hardVetoReasons.forEach((reason) => reasons.add(reason));
  }
  if (input.executionLock.active && !blockingLayer) {
    blockingLayer = "execution_lock";
    if (input.executionLock.detailLabel) {
      reasons.add(String(input.executionLock.detailLabel));
    }
    if (input.executionLock.code) {
      reasons.add(`execution_lock:${input.executionLock.code}`);
    }
  }
  if (informationDensityState === "DEGRADED" && !blockingLayer) {
    blockingLayer = "information_density";
  }
  if (capitalPressure?.blocks_execution && !blockingLayer) {
    blockingLayer = "risk";
  }
  if (selfPreservation?.blocks_execution && !blockingLayer) {
    blockingLayer = "self_preservation";
  }
  if (executionRealityGovernance?.blocks_execution && !blockingLayer) {
    blockingLayer = "execution_reality";
  }
  if (executionRealityMemory?.blocks_execution && !blockingLayer) {
    blockingLayer = "execution_reality";
  }
  if (executionReality?.blocks_execution && !blockingLayer) {
    blockingLayer = "execution_reality";
  }
  if (informationDensityState !== "SUFFICIENT") {
    informationDensityReasons.forEach((reason) => reasons.add(reason));
    reasons.add(`information_density:${informationDensityState.toLowerCase()}`);
  }
  if (crossMarket && crossMarket.state !== "CONFIRMED" && crossMarket.state !== "UNAVAILABLE") {
    reasons.add(`cross_market:${crossMarket.state.toLowerCase()}`);
    crossMarket.reasons.forEach((reason) => reasons.add(reason));
  }
  if (executionReality && executionReality.state !== "ALIGNED") {
    reasons.add(`execution_reality:${executionReality.state.toLowerCase()}`);
    executionReality.reasons.forEach((reason) => reasons.add(reason));
  }
  if (executionRealityGovernance && executionRealityGovernance.state !== "OPEN") {
    reasons.add(`execution_reality_governance:${executionRealityGovernance.state.toLowerCase()}`);
    reasons.add(`reality_drift:${executionRealityGovernance.reality_drift.toLowerCase()}`);
    executionRealityGovernance.reasons.forEach((reason) => reasons.add(reason));
  }
  if (executionRealityMemory && executionRealityMemory.memory_state !== "CLEAR") {
    reasons.add(`execution_reality_memory:${executionRealityMemory.memory_state.toLowerCase()}`);
    executionRealityMemory.reasons.forEach((reason) => reasons.add(reason));
  }
  if (capitalScar && capitalScar.state !== "CLEAN") {
    reasons.add(`capital_scar:${capitalScar.state.toLowerCase()}`);
    capitalScar.reasons.forEach((reason) => reasons.add(reason));
  }
  if (capitalPressure && capitalPressure.state !== "BALANCED" && capitalPressure.state !== "RELIEF") {
    reasons.add(`capital_pressure:${capitalPressure.state.toLowerCase()}`);
    capitalPressure.reasons.forEach((reason) => reasons.add(reason));
  }
  if (selfPreservation && selfPreservation.state !== "OPEN") {
    reasons.add(`self_preservation:${selfPreservation.state.toLowerCase()}`);
    selfPreservation.reasons.forEach((reason) => reasons.add(reason));
  }

  const decisionAllowed = Boolean(frameTruth?.decision_allowed);
  const tradable = Boolean(frameTruth?.tradable);
  const confidenceAllowsExecution = !input.confidence.hardVeto && confidenceAction !== "blocked" && confidenceAction !== "watch";
  const informationDensityAllowsExecution = informationDensityState !== "DEGRADED";
  const informationDensitySupportsTrade = informationDensityState === "SUFFICIENT";
  const crossMarketSupportsTrade = !crossMarket
    || crossMarket.state === "UNAVAILABLE"
    || crossMarket.state === "CONFIRMED"
    || (crossMarket.state === "WATCH" && crossMarket.score_pct >= 56);
  const executionAllowed = decisionAllowed
    && confidenceAllowsExecution
    && !input.attention.shouldBlockTrading
    && !input.executionLock.active
    && informationDensityAllowsExecution
    && !Boolean(executionRealityGovernance?.blocks_execution)
    && !Boolean(executionRealityMemory?.blocks_execution)
    && !Boolean(executionReality?.blocks_execution)
    && !Boolean(capitalPressure?.blocks_execution)
    && !Boolean(selfPreservation?.blocks_execution)
    && smartDecisionState !== "NO_TRADE";
  const shouldTrade = executionAllowed
    && tradable
    && confidenceAction === "go"
    && smartDecisionState === "ENTRY_VALID"
    && informationDensitySupportsTrade
    && (executionRealityGovernance?.allow_new_risk ?? true)
    && (executionRealityMemory?.allow_new_risk ?? true)
    && (!executionReality || executionReality.state === "ALIGNED")
    && (executionReality?.allow_new_risk ?? true)
    && (capitalScar?.allow_new_risk ?? true)
    && (capitalPressure?.allow_new_risk ?? true)
    && (selfPreservation?.allow_new_risk ?? true)
    && crossMarketSupportsTrade;
  const riskMultiplier = clamp(input.riskMultiplier, 0, 1);
  const allowDualVenueExecution = executionAllowed && !input.marketTruthLockEnabled;
  const baseEdgeEligibilityScore = clamp(
    (frameTruth?.confidence ?? 0) * 0.4
      + clamp(input.confidence.finalScorePct / 100, 0, 1) * 0.4
      + (smartDecisionState === "ENTRY_VALID" ? 0.2 : smartDecisionState === "WAIT_CONFIRMATION" ? 0.1 : 0),
    0,
    1,
  );
  const edgeEligibilityScorePct = Math.round(clamp(
    baseEdgeEligibilityScore * baseSignalWeight + informationDensityScore * informationDensityImpactWeight,
    0,
    1,
  ) * 100);
  const edgeEligibilityState: EdgeEligibilityState = !executionAllowed
    ? "BLOCKED"
    : shouldTrade
      ? "ELIGIBLE"
      : "OBSERVE";
  const edgeEligibilityReasons = [
    tradable ? "frame_truth_tradable" : decisionAllowed ? "frame_truth_decision_ready" : "frame_truth_observe_only",
    `confidence_${confidenceAction || "watch"}`,
    smartDecisionState ? `smart_${smartDecisionState.toLowerCase()}` : "smart_pending",
    `information_density_${informationDensityState.toLowerCase()}`,
    crossMarket ? `cross_market_${crossMarket.state.toLowerCase()}` : "cross_market_unavailable",
    ...(crossMarket?.reasons || []),
  ];
  const observeOnlyFromCrossMarket = Boolean(crossMarket && crossMarket.state === "INCOHERENT");
  const action: FinalDecisionAction = !executionAllowed
    ? "BLOCK"
    : shouldTrade
      ? "EXECUTE"
      : observeOnlyFromCrossMarket || executionRealityGovernance?.state === "DEFENSIVE" || executionRealityMemory?.memory_state === "PERSISTENT" || executionRealityMemory?.memory_state === "LOCKDOWN" || executionReality?.state === "DEGRADED" || capitalScar?.state === "TRAUMA" || capitalPressure?.state === "CONSTRAINED" || selfPreservation?.state === "PROTECT"
        ? "WAIT"
      : confidenceAction === "caution" || riskMultiplier < 0.99 || informationDensityState === "THIN" || executionRealityGovernance?.state === "CAUTION" || executionRealityMemory?.memory_state === "RECOVERING" || executionReality?.state === "CAUTION" || capitalScar?.state === "SCARRED" || capitalPressure?.state === "ELEVATED" || selfPreservation?.state === "DEFENSIVE"
        ? "REDUCE"
        : "WAIT";
  const reasonList = [...reasons];
  const summaryLabel = `${action} · ${truthState} · edge ${edgeEligibilityScorePct}%`;
  const detailLabel = reasonList.length > 0
    ? reasonList.join(" · ")
    : action === "EXECUTE"
      ? "canonical contract authorizes guarded execution"
      : action === "REDUCE"
        ? "canonical contract allows only guarded micro-size"
        : action === "WAIT"
          ? "canonical contract keeps the desk in observation"
          : "canonical contract blocks execution";
  const falseContext = inferFalseContextFamily({
    frameTruth,
    blockingLayer,
    smartDecisionState,
    informationDensityState,
    informationDensityReasons,
    marketTruthReasons,
    executionLockActive: input.executionLock.active,
    truthSyncScore,
    truthFreshnessScore,
    executionQualityScore,
  });
  const falseContextNoTrade = action === "BLOCK" || action === "WAIT";
  const falseContextTaxonomy = buildFalseContextTaxonomy({
    family: falseContext.family,
    reasons: falseContext.reasons,
    noTrade: falseContextNoTrade,
    triggerLayer: falseContext.triggerLayer,
  });
  const verdictExplanation = buildVerdictExplanation({
    action,
    executionAllowed,
    shouldTrade,
    blockingLayer,
    marketTruthState,
    marketTruthScorePct: Math.round(marketTruthScore * 100),
    informationDensityState,
    informationDensityScorePct: Math.round(informationDensityScore * 100),
    falseContext: {
      family: falseContext.family,
      noTrade: falseContextNoTrade,
      reasons: falseContext.reasons,
      taxonomy: falseContextTaxonomy,
    },
    attention: {
      state: String(input.attention.state || ""),
      shouldBlockTrading: Boolean(input.attention.shouldBlockTrading),
    },
    confidence: {
      actionState: confidenceAction,
      finalScorePct: Math.round(clamp(input.confidence.finalScorePct, 0, 100)),
      hardVeto: Boolean(input.confidence.hardVeto),
    },
  });
  const marketTruthPayload: FinalDecisionTruth["market_truth"] = {
    state: marketTruthState,
    score_pct: Math.round(marketTruthScore * 100),
    reasons: marketTruthReasons,
    metrics: {
      coherence_pct: Math.round(coherenceScore * 100),
      freshness_pct: Math.round(truthFreshnessScore * 100),
      information_density_pct: Math.round(informationDensityScore * 100),
      execution_quality_pct: Math.round(executionQualityScore * 100),
      anomaly_burden_pct: Math.round(anomalyBurdenScore * 100),
    },
  };
  const falseContextPayload: FinalDecisionTruth["false_context"] = {
    family: falseContext.family,
    no_trade: falseContextNoTrade,
    trigger_layer: falseContext.triggerLayer,
    reasons: falseContext.reasons,
    taxonomy: falseContextTaxonomy,
  };
  const informationDensityPayload: FinalDecisionTruth["information_density"] = {
    state: informationDensityState,
    score_pct: Math.round(informationDensityScore * 100),
    entropy_pct: Math.round(informationEntropy * 100),
    reasons: informationDensityReasons,
    calibration: {
      thin_score_floor_pct: Math.round(informationDensityThresholds.thinScoreFloor * 100),
      degraded_score_floor_pct: Math.round(informationDensityThresholds.degradedScoreFloor * 100),
      thin_entropy_ceiling_pct: Math.round(informationDensityThresholds.thinEntropyCeiling * 100),
      degraded_entropy_ceiling_pct: Math.round(informationDensityThresholds.degradedEntropyCeiling * 100),
    },
  };
  const proofs = buildFinalDecisionProofs({
    action,
    blockingLayer,
    executionAllowed,
    shouldTrade,
    reasonList,
    marketTruth: marketTruthPayload,
    informationDensity: informationDensityPayload,
    falseContext: falseContextPayload,
  });

  const generatedAtIso = asString(input.generatedAtIso) || new Date().toISOString();
  const baseTruth = {
    schema_version: "final-decision-truth/v1",
    state: truthState,
    action,
    tradable,
    decision_allowed: decisionAllowed,
    should_trade: shouldTrade,
    execution_allowed: executionAllowed,
    allow_dual_venue_execution: allowDualVenueExecution,
    preferred_venue: input.truthExecutionVenue || input.preferredVenue || null,
    route_mode: input.marketTruthLockEnabled ? "single_venue_locked" : "best_available",
    blocking_layer: blockingLayer,
    risk_multiplier: riskMultiplier,
    summary_label: summaryLabel,
    detail_label: detailLabel,
    reasons: reasonList,
    verdict_explanation: verdictExplanation,
    proofs,
    truth: frameTruth,
    smart_decision: input.smartDecision ? {
      state: String(input.smartDecision.state || ""),
      confidence_band: String(input.smartDecision.confidenceBand || ""),
      headline: String(input.smartDecision.headline || ""),
      reason: String(input.smartDecision.reason || ""),
    } : null,
    confidence: {
      action_state: confidenceAction,
      final_score_pct: Math.round(clamp(input.confidence.finalScorePct, 0, 100)),
      quality_label: String(input.confidence.qualityLabel || ""),
      hard_veto: Boolean(input.confidence.hardVeto),
      reasons: input.confidence.hardVetoReasons,
    },
    attention: {
      state: String(input.attention.state || ""),
      should_block_trading: Boolean(input.attention.shouldBlockTrading),
      summary_label: String(input.attention.summaryLabel || ""),
      detail_label: String(input.attention.detailLabel || ""),
    },
    market_truth: marketTruthPayload,
    cross_market: crossMarket,
    execution_reality: executionReality,
    execution_reality_governance: executionRealityGovernance,
    execution_reality_memory: executionRealityMemory,
    capital_scar: capitalScar,
    capital_pressure: capitalPressure,
    self_preservation: selfPreservation,
    false_context: falseContextPayload,
    information_density: informationDensityPayload,
    edge_eligibility: {
      state: edgeEligibilityState,
      score_pct: edgeEligibilityScorePct,
      reasons: edgeEligibilityReasons,
      calibration: {
        information_density_weight_pct: Math.round(informationDensityImpactWeight * 100),
        base_signal_weight_pct: Math.round(baseSignalWeight * 100),
      },
    },
  } satisfies Omit<FinalDecisionTruth, "generated_at_iso" | "oracle_fingerprint">;
  return {
    ...baseTruth,
    generated_at_iso: generatedAtIso,
    oracle_fingerprint: buildOracleFingerprint(baseTruth),
  };
}

export function coerceFinalDecisionTruth(value: unknown): FinalDecisionTruth | null {
  const record = asRecord(value);
  if (record.schema_version !== "final-decision-truth/v1") {
    return null;
  }
  const truth = asRecord(record.truth);
  const smartDecision = asRecord(record.smart_decision);
  const confidence = asRecord(record.confidence);
  const attention = asRecord(record.attention);
  const marketTruth = asRecord(record.market_truth);
  const marketTruthMetrics = asRecord(marketTruth.metrics);
  const crossMarket = coerceCrossMarketTruthSummary(record.cross_market);
  const executionReality = asRecord(record.execution_reality);
  const executionRealityMetrics = asRecord(executionReality.metrics);
  const executionRealityGovernance = asRecord(record.execution_reality_governance);
  const executionRealityGovernanceMetrics = asRecord(executionRealityGovernance.metrics);
  const executionRealityMemory = asRecord(record.execution_reality_memory);
  const executionRealityMemoryMetrics = asRecord(executionRealityMemory.metrics);
  const capitalScar = asRecord(record.capital_scar);
  const capitalScarMetrics = asRecord(capitalScar.metrics);
  const capitalPressure = asRecord(record.capital_pressure);
  const capitalPressureMetrics = asRecord(capitalPressure.metrics);
  const selfPreservation = asRecord(record.self_preservation);
  const selfPreservationMetrics = asRecord(selfPreservation.metrics);
  const falseContext = asRecord(record.false_context);
  const falseContextTaxonomy = asRecord(falseContext.taxonomy);
  const informationDensity = asRecord(record.information_density);
  const informationDensityCalibration = asRecord(informationDensity.calibration);
  const edgeEligibility = asRecord(record.edge_eligibility);
  const edgeEligibilityCalibration = asRecord(edgeEligibility.calibration);
  const baseTruth = {
    schema_version: "final-decision-truth/v1",
    state: (asString(record.state) || "UNAVAILABLE") as FinalDecisionState,
    action: (asString(record.action) || "WAIT") as FinalDecisionAction,
    tradable: asBoolean(record.tradable),
    decision_allowed: asBoolean(record.decision_allowed),
    should_trade: asBoolean(record.should_trade),
    execution_allowed: asBoolean(record.execution_allowed),
    allow_dual_venue_execution: asBoolean(record.allow_dual_venue_execution),
    preferred_venue: asString(record.preferred_venue) || null,
    route_mode: asString(record.route_mode),
    blocking_layer: (asString(record.blocking_layer) || null) as FinalDecisionBlockingLayer,
    risk_multiplier: asNumber(record.risk_multiplier, 0),
    summary_label: asString(record.summary_label),
    detail_label: asString(record.detail_label),
    reasons: asTextArray(record.reasons),
    verdict_explanation: Array.isArray(record.verdict_explanation)
      ? record.verdict_explanation
        .map((item) => asRecord(item))
        .filter((item) => Object.keys(item).length > 0)
        .map((item) => ({
          code: (asString(item.code) || "contract") as FinalDecisionVerdictExplanation["code"],
          label: asString(item.label),
          detail: asString(item.detail),
          tone: (asString(item.tone) || "subtle") as FinalDecisionVerdictExplanation["tone"],
        }))
      : [],
    proofs: Array.isArray(record.proofs)
      ? record.proofs
        .map((item) => asRecord(item))
        .filter((item) => Object.keys(item).length > 0)
        .map((item) => ({
          code: (asString(item.code) || "contract") as FinalDecisionProof["code"],
          label: asString(item.label),
          value: asString(item.value),
          evidence: asTextArray(item.evidence),
          tone: (asString(item.tone) || "subtle") as FinalDecisionProof["tone"],
        }))
      : [],
    truth: Object.keys(truth).length > 0 ? {
      integrity_status: asString(truth.integrity_status),
      sync_status: asString(truth.sync_status),
      freshness: asString(truth.freshness),
      reconstruction_flag: asString(truth.reconstruction_flag),
      confidence: asNumber(truth.confidence, 0),
      tradable: asBoolean(truth.tradable),
      decision_allowed: asBoolean(truth.decision_allowed),
      reasons: asTextArray(truth.reasons),
    } : null,
    smart_decision: Object.keys(smartDecision).length > 0 ? {
      state: asString(smartDecision.state),
      confidence_band: asString(smartDecision.confidence_band),
      headline: asString(smartDecision.headline),
      reason: asString(smartDecision.reason),
    } : null,
    confidence: {
      action_state: asString(confidence.action_state),
      final_score_pct: asNumber(confidence.final_score_pct, 0),
      quality_label: asString(confidence.quality_label),
      hard_veto: asBoolean(confidence.hard_veto),
      reasons: asTextArray(confidence.reasons),
    },
    attention: {
      state: asString(attention.state),
      should_block_trading: asBoolean(attention.should_block_trading),
      summary_label: asString(attention.summary_label),
      detail_label: asString(attention.detail_label),
    },
    market_truth: {
      state: (asString(marketTruth.state) || "WATCH") as MarketTruthState,
      score_pct: asNumber(marketTruth.score_pct, 50),
      reasons: asTextArray(marketTruth.reasons),
      metrics: {
        coherence_pct: asNumber(marketTruthMetrics.coherence_pct, 50),
        freshness_pct: asNumber(marketTruthMetrics.freshness_pct, 50),
        information_density_pct: asNumber(marketTruthMetrics.information_density_pct, 50),
        execution_quality_pct: asNumber(marketTruthMetrics.execution_quality_pct, 50),
        anomaly_burden_pct: asNumber(marketTruthMetrics.anomaly_burden_pct, 50),
      },
    },
    cross_market: crossMarket,
    execution_reality: Object.keys(executionReality).length > 0 ? {
      state: (asString(executionReality.state) || "ALIGNED") as ExecutionRealitySummary["state"],
      score_pct: asNumber(executionReality.score_pct, 0),
      allow_new_risk: asBoolean(executionReality.allow_new_risk, true),
      blocks_execution: asBoolean(executionReality.blocks_execution),
      size_cap_pct: asNumber(executionReality.size_cap_pct, 100),
      summary_label: asString(executionReality.summary_label),
      reasons: asTextArray(executionReality.reasons),
      dominant_drag: (asString(executionReality.dominant_drag) || "NONE") as ExecutionRealitySummary["dominant_drag"],
      metrics: {
        execution_samples: asNumber(executionRealityMetrics.execution_samples, 0),
        liquidity_samples: asNumber(executionRealityMetrics.liquidity_samples, 0),
        slippage_bps: asNumber(executionRealityMetrics.slippage_bps, 0),
        latency_ms: asNumber(executionRealityMetrics.latency_ms, 0),
        fill_rate_pct: asNumber(executionRealityMetrics.fill_rate_pct, 0),
        liquidity_accuracy_pct: asNumber(executionRealityMetrics.liquidity_accuracy_pct, 0),
        stability_mode: (asString(executionRealityMetrics.stability_mode) || "live") as ExecutionRealitySummary["metrics"]["stability_mode"],
        stability_monitor_pct: asNumber(executionRealityMetrics.stability_monitor_pct, 0),
        drift_watchdog: (asString(executionRealityMetrics.drift_watchdog) || "CALM") as ExecutionRealitySummary["metrics"]["drift_watchdog"],
        optimization_action: (asString(executionRealityMetrics.optimization_action) || "hold") as ExecutionRealitySummary["metrics"]["optimization_action"],
      },
    } : null,
    execution_reality_governance: Object.keys(executionRealityGovernance).length > 0 ? {
      state: (asString(executionRealityGovernance.state) || "OPEN") as ExecutionRealityGovernanceSummary["state"],
      score_pct: asNumber(executionRealityGovernance.score_pct, 0),
      allow_new_risk: asBoolean(executionRealityGovernance.allow_new_risk, true),
      blocks_execution: asBoolean(executionRealityGovernance.blocks_execution),
      size_cap_pct: asNumber(executionRealityGovernance.size_cap_pct, 100),
      summary_label: asString(executionRealityGovernance.summary_label),
      reasons: asTextArray(executionRealityGovernance.reasons),
      dominant_driver: (asString(executionRealityGovernance.dominant_driver) || "NONE") as ExecutionRealityGovernanceSummary["dominant_driver"],
      reality_drift: (asString(executionRealityGovernance.reality_drift) || "CALM") as ExecutionRealityGovernanceSummary["reality_drift"],
      slippage_regime: (asString(executionRealityGovernance.slippage_regime) || "NORMAL") as ExecutionRealityGovernanceSummary["slippage_regime"],
      venue_stability: (asString(executionRealityGovernance.venue_stability) || "STABLE") as ExecutionRealityGovernanceSummary["venue_stability"],
      routing_fragility: (asString(executionRealityGovernance.routing_fragility) || "STABLE") as ExecutionRealityGovernanceSummary["routing_fragility"],
      latency_pressure: (asString(executionRealityGovernance.latency_pressure) || "CALM") as ExecutionRealityGovernanceSummary["latency_pressure"],
      spread_degradation: (asString(executionRealityGovernance.spread_degradation) || "TIGHT") as ExecutionRealityGovernanceSummary["spread_degradation"],
      fill_reliability: (asString(executionRealityGovernance.fill_reliability) || "RELIABLE") as ExecutionRealityGovernanceSummary["fill_reliability"],
      microstructure_integrity: (asString(executionRealityGovernance.microstructure_integrity) || "INTACT") as ExecutionRealityGovernanceSummary["microstructure_integrity"],
      metrics: {
        execution_quality_score_pct: asNumber(executionRealityGovernanceMetrics.execution_quality_score_pct, 0),
        venue_stability_pct: asNumber(executionRealityGovernanceMetrics.venue_stability_pct, 0),
        routing_fragility_pct: asNumber(executionRealityGovernanceMetrics.routing_fragility_pct, 0),
        latency_pressure_pct: asNumber(executionRealityGovernanceMetrics.latency_pressure_pct, 0),
        spread_degradation_pct: asNumber(executionRealityGovernanceMetrics.spread_degradation_pct, 0),
        fill_reliability_pct: asNumber(executionRealityGovernanceMetrics.fill_reliability_pct, 0),
        microstructure_integrity_pct: asNumber(executionRealityGovernanceMetrics.microstructure_integrity_pct, 0),
        reality_drift_pct: asNumber(executionRealityGovernanceMetrics.reality_drift_pct, 0),
      },
    } : null,
    execution_reality_memory: Object.keys(executionRealityMemory).length > 0 ? {
      memory_state: (asString(executionRealityMemory.memory_state) || "CLEAR") as ExecutionRealityMemorySnapshot["memory_state"],
      regime: asString(executionRealityMemory.regime) || "UNKNOWN",
      current_state: (asString(executionRealityMemory.current_state) || "ALIGNED") as ExecutionRealityMemorySnapshot["current_state"],
      dominant_drag: (asString(executionRealityMemory.dominant_drag) || "NONE") as ExecutionRealityMemorySnapshot["dominant_drag"],
      dominant_reason: asString(executionRealityMemory.dominant_reason),
      persistence_score_pct: asNumber(executionRealityMemory.persistence_score_pct, 0),
      recurrence_count: asNumber(executionRealityMemory.recurrence_count, 0),
      persistent_cycles: asNumber(executionRealityMemory.persistent_cycles, 0),
      size_cap_pct: asNumber(executionRealityMemory.size_cap_pct, 100),
      allow_new_risk: asBoolean(executionRealityMemory.allow_new_risk, true),
      blocks_execution: asBoolean(executionRealityMemory.blocks_execution),
      summary_label: asString(executionRealityMemory.summary_label),
      reasons: asTextArray(executionRealityMemory.reasons),
      metrics: {
        current_score_pct: asNumber(executionRealityMemoryMetrics.current_score_pct, 0),
        current_size_cap_pct: asNumber(executionRealityMemoryMetrics.current_size_cap_pct, 100),
        current_slippage_bps: asNumber(executionRealityMemoryMetrics.current_slippage_bps, 0),
        current_fill_rate_pct: asNumber(executionRealityMemoryMetrics.current_fill_rate_pct, 0),
        stability_mode: (asString(executionRealityMemoryMetrics.stability_mode) || "live") as ExecutionRealityMemorySnapshot["metrics"]["stability_mode"],
        stability_monitor_pct: asNumber(executionRealityMemoryMetrics.stability_monitor_pct, 0),
        drift_watchdog: (asString(executionRealityMemoryMetrics.drift_watchdog) || "CALM") as ExecutionRealityMemorySnapshot["metrics"]["drift_watchdog"],
      },
    } : null,
    capital_scar: Object.keys(capitalScar).length > 0 ? {
      state: (asString(capitalScar.state) || "CLEAN") as CapitalScarMemorySummary["state"],
      score_pct: asNumber(capitalScar.score_pct, 0),
      allow_new_risk: asBoolean(capitalScar.allow_new_risk, true),
      pressure_bias_pct: asNumber(capitalScar.pressure_bias_pct, 0),
      summary_label: asString(capitalScar.summary_label),
      reasons: asTextArray(capitalScar.reasons),
      dominant_scar: (asString(capitalScar.dominant_scar) || "NONE") as CapitalScarMemorySummary["dominant_scar"],
      metrics: {
        regime: asString(capitalScarMetrics.regime) || "UNKNOWN",
        regime_trade_count: asNumber(capitalScarMetrics.regime_trade_count, 0),
        regime_pnl_usd: asNumber(capitalScarMetrics.regime_pnl_usd, 0),
        regime_expectancy_usd: asNumber(capitalScarMetrics.regime_expectancy_usd, 0),
        regime_drawdown_pct: asNumber(capitalScarMetrics.regime_drawdown_pct, 0),
        global_drawdown_pct: asNumber(capitalScarMetrics.global_drawdown_pct, 0),
        execution_slippage_bps: asNumber(capitalScarMetrics.execution_slippage_bps, 0),
        execution_fill_rate_pct: asNumber(capitalScarMetrics.execution_fill_rate_pct, 0),
        liquidity_accuracy_pct: asNumber(capitalScarMetrics.liquidity_accuracy_pct, 0),
      },
    } : null,
    capital_pressure: Object.keys(capitalPressure).length > 0 ? {
      state: (asString(capitalPressure.state) || "BALANCED") as DynamicCapitalPressureSummary["state"],
      score_pct: asNumber(capitalPressure.score_pct, 0),
      allow_new_risk: asBoolean(capitalPressure.allow_new_risk),
      blocks_execution: asBoolean(capitalPressure.blocks_execution),
      summary_label: asString(capitalPressure.summary_label),
      reasons: asTextArray(capitalPressure.reasons),
      dominant_constraint: (asString(capitalPressure.dominant_constraint) || "NONE") as DynamicCapitalPressureSummary["dominant_constraint"],
      metrics: {
        capital_multiplier_pct: asNumber(capitalPressureMetrics.capital_multiplier_pct, 0),
        recommended_risk_usd: asNumber(capitalPressureMetrics.recommended_risk_usd, 0),
        drawdown_pct: asNumber(capitalPressureMetrics.drawdown_pct, 0),
        exposure_pct: asNumber(capitalPressureMetrics.exposure_pct, 0),
        open_trade_count: asNumber(capitalPressureMetrics.open_trade_count, 0),
        session_window_pass: asBoolean(capitalPressureMetrics.session_window_pass),
        symbol_loss_pass: asBoolean(capitalPressureMetrics.symbol_loss_pass),
        symbol_loss_usd: asNumber(capitalPressureMetrics.symbol_loss_usd, 0),
        kill_switch_active: asBoolean(capitalPressureMetrics.kill_switch_active),
        journal_scaling_blocked: asBoolean(capitalPressureMetrics.journal_scaling_blocked),
      },
    } : null,
    self_preservation: Object.keys(selfPreservation).length > 0 ? {
      state: (asString(selfPreservation.state) || "OPEN") as SelfPreservationSummary["state"],
      score_pct: asNumber(selfPreservation.score_pct, 0),
      allow_new_risk: asBoolean(selfPreservation.allow_new_risk),
      blocks_execution: asBoolean(selfPreservation.blocks_execution),
      summary_label: asString(selfPreservation.summary_label),
      reasons: asTextArray(selfPreservation.reasons),
      dominant_trigger: (asString(selfPreservation.dominant_trigger) || "NONE") as SelfPreservationSummary["dominant_trigger"],
      metrics: {
        stability_mode: (asString(selfPreservationMetrics.stability_mode) || "live") as SelfPreservationSummary["metrics"]["stability_mode"],
        stability_monitor_pct: asNumber(selfPreservationMetrics.stability_monitor_pct, 0),
        drift_watchdog: (asString(selfPreservationMetrics.drift_watchdog) || "CALM") as SelfPreservationSummary["metrics"]["drift_watchdog"],
        runtime_guard_active: asBoolean(selfPreservationMetrics.runtime_guard_active),
        runtime_guard_code: asString(selfPreservationMetrics.runtime_guard_code),
        watchdog_status: asString(selfPreservationMetrics.watchdog_status) || "OK",
        governance_mode: asString(selfPreservationMetrics.governance_mode) || "ADAPTIVE",
        opportunity_gate_count: asNumber(selfPreservationMetrics.opportunity_gate_count, 0),
        mt5_review_required: asBoolean(selfPreservationMetrics.mt5_review_required),
        mt5_review_acknowledged: asBoolean(selfPreservationMetrics.mt5_review_acknowledged),
        halt_new_exposure: asBoolean(selfPreservationMetrics.halt_new_exposure),
        close_only: asBoolean(selfPreservationMetrics.close_only),
        learning_frozen: asBoolean(selfPreservationMetrics.learning_frozen),
        persistence_available: asBoolean(selfPreservationMetrics.persistence_available, true),
      },
    } : null,
    false_context: {
      family: (asString(falseContext.family) || null) as FalseContextFamily | null,
      no_trade: asBoolean(falseContext.no_trade),
      trigger_layer: (asString(falseContext.trigger_layer) || "none") as FinalDecisionBlockingLayer | "market_truth" | "none",
      reasons: asTextArray(falseContext.reasons),
      taxonomy: Object.keys(falseContextTaxonomy).length > 0 ? {
        operator_family: (asString(falseContextTaxonomy.operator_family) || "intent") as FalseContextOperatorFamily,
        archetype: (asString(falseContextTaxonomy.archetype) || "INTENT_DISLOCATION") as FalseContextArchetype,
        severity: (asString(falseContextTaxonomy.severity) || "WATCH") as FalseContextSeverity,
        label: asString(falseContextTaxonomy.label),
        evidence_tags: asTextArray(falseContextTaxonomy.evidence_tags),
      } : null,
    },
    information_density: {
      state: (asString(informationDensity.state) || "SUFFICIENT") as FinalDecisionInformationDensityState,
      score_pct: asNumber(informationDensity.score_pct, 50),
      entropy_pct: asNumber(informationDensity.entropy_pct, 50),
      reasons: asTextArray(informationDensity.reasons),
      calibration: {
        thin_score_floor_pct: asNumber(informationDensityCalibration.thin_score_floor_pct, 50),
        degraded_score_floor_pct: asNumber(informationDensityCalibration.degraded_score_floor_pct, 28),
        thin_entropy_ceiling_pct: asNumber(informationDensityCalibration.thin_entropy_ceiling_pct, 58),
        degraded_entropy_ceiling_pct: asNumber(informationDensityCalibration.degraded_entropy_ceiling_pct, 72),
      },
    },
    edge_eligibility: {
      state: (asString(edgeEligibility.state) || "OBSERVE") as EdgeEligibilityState,
      score_pct: asNumber(edgeEligibility.score_pct, 0),
      reasons: asTextArray(edgeEligibility.reasons),
      calibration: {
        information_density_weight_pct: asNumber(edgeEligibilityCalibration.information_density_weight_pct, 18),
        base_signal_weight_pct: asNumber(edgeEligibilityCalibration.base_signal_weight_pct, 82),
      },
    },
  } satisfies Omit<FinalDecisionTruth, "generated_at_iso" | "oracle_fingerprint">;
  return {
    ...baseTruth,
    generated_at_iso: asString(record.generated_at_iso) || new Date().toISOString(),
    oracle_fingerprint: asString(record.oracle_fingerprint) || buildOracleFingerprint(baseTruth),
  };
}

export function findFinalDecisionTruth(...values: unknown[]): FinalDecisionTruth | null {
  for (const value of values) {
    const direct = coerceFinalDecisionTruth(value);
    if (direct) {
      return direct;
    }
    const record = asRecord(value);
    const nested = coerceFinalDecisionTruth(record.final_decision_truth);
    if (nested) {
      return nested;
    }
    const meta = asRecord(record.meta);
    const metaNested = coerceFinalDecisionTruth(meta.final_decision_truth);
    if (metaNested) {
      return metaNested;
    }
    const orderIntent = asRecord(record.order_intent);
    const orderNested = coerceFinalDecisionTruth(orderIntent.final_decision_truth);
    if (orderNested) {
      return orderNested;
    }
    const metadata = asRecord(record.metadata);
    const metadataNested = coerceFinalDecisionTruth(metadata.final_decision_truth);
    if (metadataNested) {
      return metadataNested;
    }
  }
  return null;
}

export function buildFinalDecisionOracleExecutionView(value: FinalDecisionTruth): FinalDecisionOracleExecutionView {
  return {
    blocks_execution: !value.execution_allowed,
    action: value.action,
    summary_label: value.summary_label || `${value.action} · ${value.state}`,
    detail_label: value.detail_label || "Final decision contract blocked execution.",
    blocking_layer: value.blocking_layer,
    reason_tags: [
      `final_decision:${value.action.toLowerCase()}`,
      value.blocking_layer ? `final_blocking_layer:${value.blocking_layer}` : "final_blocking_layer:contract",
      ...value.reasons,
    ],
  };
}

export function buildFinalDecisionOracleObservabilityView(value: FinalDecisionTruth): FinalDecisionOracleObservabilityView {
  const confidence = value.execution_allowed
    ? clamp(value.edge_eligibility.score_pct / 100, 0, 1)
    : 0;
  const marketState = !value.execution_allowed
    ? "NO_TRADE"
    : value.action === "WAIT" || value.action === "REDUCE"
      ? "WAIT"
      : "VALID";
  const tone = marketState === "NO_TRADE"
    ? "bad"
    : marketState === "WAIT"
      ? "warn"
      : "good";
  const reasonCode = !value.execution_allowed
    ? value.blocking_layer ? `FINAL_${value.blocking_layer.toUpperCase()}` : "FINAL_BLOCK"
    : value.action === "REDUCE"
      ? "FINAL_REDUCE"
      : value.action === "WAIT"
        ? "FINAL_WAIT"
        : "FINAL_VALID";

  return {
    market_state: marketState,
    reason_code: reasonCode,
    confidence,
    tone,
    summary_label: `SYNC ${marketState} ${Math.round(confidence * 100)}%`,
    detail_label: value.detail_label || "Final decision contract is observing the market.",
    execution_summary_label: value.summary_label || `${value.action} · ${value.state}`,
    execution_detail_label: value.detail_label || "Final decision contract is observing the market.",
  };
}
