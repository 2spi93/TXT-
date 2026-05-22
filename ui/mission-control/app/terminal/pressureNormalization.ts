import { buildPressureConflictArbitration, type PressureConflictArbitrationResult } from "./pressureConflictArbitration";
import {
  type PressureDecisionDirection,
  type PressurePriorityTier,
  type PressureSourceType,
  assertPressureSourceTierInvariant,
} from "./pressurePriorityTiers";
import {
  buildPressurePersistenceMemorySummary,
  type PressurePersistenceMemorySummary,
  type PressurePersistenceProfile,
} from "./pressurePersistenceMemory";

export type PressureNormalizationDirection = PressureDecisionDirection;

export type PressureNormalizationSignal = {
  key: string;
  direction: PressureNormalizationDirection;
  tier: PressurePriorityTier;
  source_type: PressureSourceType;
  raw_pct: number;
  confidence_pct: number;
  recency_pct?: number;
  prior_pct?: number;
  floor_pct?: number;
  ceiling_pct?: number;
  persistence_profile: PressurePersistenceProfile;
  first_seen_ms?: number;
  last_seen_ms?: number;
  observation_count?: number;
};

export type PressureNormalizationSource = {
  key: string;
  direction: PressureNormalizationDirection;
  tier: PressurePriorityTier;
  source_type: PressureSourceType;
  raw_pct: number;
  clipped_pct: number;
  decayed_pct: number;
  hysteresis_pct: number;
  persistence_profile: PressurePersistenceProfile;
  persistence_pct: number;
  persistence_proof: boolean;
  weighted_pct: number;
  normalized_pct: number;
  effective_pct: number;
  suppressed: boolean;
  suppressed_by: string | null;
  suppression_reason: string | null;
  confidence_pct: number;
};

export type PressureNormalizationSummary = {
  schema_version: "pressure-normalization/v2";
  generated_at_iso: string;
  normalized_protection_pct: number;
  normalized_opportunity_pct: number;
  conflict_pct: number;
  arbitration_state: "PROTECTION_DOMINANT" | "OPPORTUNITY_DOMINANT" | "BALANCED" | "CONFLICTED";
  winning_tier: PressurePriorityTier | "none";
  suppressed_sources: string[];
  unresolved_conflicts: string[];
  arbitration_trace: string[];
  dominant_pressure_key: string;
  sources: PressureNormalizationSource[];
  persistence_memory: PressurePersistenceMemorySummary;
  arbitration: PressureConflictArbitrationResult;
  summary_label: string;
  reasons: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeSignal(
  signal: PressureNormalizationSignal,
  persistenceMemory: PressurePersistenceMemorySummary,
): PressureNormalizationSource {
  assertPressureSourceTierInvariant(signal.source_type, signal.tier);
  const rawPct = clamp(signal.raw_pct, 0, 100);
  const clippedPct = clamp(rawPct, signal.floor_pct ?? 0, signal.ceiling_pct ?? 96);
  const recencyWeight = 0.62 + clamp(signal.recency_pct ?? 72, 0, 100) / 100 * 0.38;
  const decayedPct = clamp(clippedPct * recencyWeight, 0, 100);
  const priorPct = clamp(signal.prior_pct ?? (signal.direction === "PROTECTION" ? clippedPct * 0.84 : clippedPct * 0.9), 0, 100);
  const delta = Math.abs(decayedPct - priorPct);
  const hysteresisPct = delta <= 8
    ? priorPct * 0.64 + decayedPct * 0.36
    : delta <= 18
      ? priorPct * 0.34 + decayedPct * 0.66
      : decayedPct;
  const confidencePct = clamp(signal.confidence_pct, 0, 100);
  const persistenceSource = persistenceMemory.sources.find((source) => source.key === signal.key);
  const persistencePct = persistenceSource?.persistence_pct ?? 0;
  const persistenceProof = persistenceSource?.persistence_proof ?? false;
  const weightedPct = clamp(hysteresisPct * (0.42 + confidencePct / 100 * 0.58), 0, 100);
  const persistenceWeightedPct = clamp(
    weightedPct * (signal.direction === "PROTECTION"
      ? 0.76 + persistencePct / 100 * 0.24
      : 0.62 + persistencePct / 100 * 0.38),
    0,
    100,
  );
  return {
    key: signal.key,
    direction: signal.direction,
    tier: signal.tier,
    source_type: signal.source_type,
    raw_pct: Math.round(rawPct),
    clipped_pct: Math.round(clippedPct),
    decayed_pct: Math.round(decayedPct),
    hysteresis_pct: Math.round(hysteresisPct),
    persistence_profile: signal.persistence_profile,
    persistence_pct: Math.round(persistencePct),
    persistence_proof: persistenceProof,
    weighted_pct: Math.round(weightedPct),
    normalized_pct: Math.round(persistenceWeightedPct),
    effective_pct: Math.round(persistenceWeightedPct),
    suppressed: false,
    suppressed_by: null,
    suppression_reason: null,
    confidence_pct: Math.round(confidencePct),
  };
}

function aggregateDirectional(sources: PressureNormalizationSource[]): number {
  if (!sources.length) {
    return 0;
  }
  const ranked = sources.slice().sort((left, right) => right.effective_pct - left.effective_pct);
  const head = ranked.slice(0, 3);
  const tail = ranked.slice(3);
  const headWeight = head.reduce((sum, source) => sum + source.confidence_pct, 0) || head.length;
  const headScore = head.reduce((sum, source) => sum + source.effective_pct * source.confidence_pct, 0) / headWeight;
  const tailScore = tail.length
    ? tail.reduce((sum, source) => sum + source.effective_pct, 0) / tail.length * 0.22
    : 0;
  const inflationPenalty = Math.max(0, ranked.length - 3) * 1.8;
  return Math.round(clamp(headScore + tailScore - inflationPenalty, 0, 100));
}

export function buildPressureNormalizationSummary(input: {
  signals: PressureNormalizationSignal[];
  persistenceMemory?: PressurePersistenceMemorySummary;
  nowMs?: number;
}): PressureNormalizationSummary {
  const persistenceMemory = input.persistenceMemory || buildPressurePersistenceMemorySummary({
    signals: input.signals.map((signal) => ({
      key: signal.key,
      direction: signal.direction,
      tier: signal.tier,
      source_type: signal.source_type,
      raw_pct: signal.raw_pct,
      profile: signal.persistence_profile,
      first_seen_ms: signal.first_seen_ms,
      last_seen_ms: signal.last_seen_ms,
      observation_count: signal.observation_count,
    })),
    nowMs: input.nowMs,
  });
  const normalizedSources = input.signals.map((signal) => normalizeSignal(signal, persistenceMemory));
  const rawProtectionPct = aggregateDirectional(
    normalizedSources.filter((source) => source.direction === "PROTECTION"),
  );
  const rawOpportunityPct = aggregateDirectional(
    normalizedSources.filter((source) => source.direction === "OPPORTUNITY"),
  );
  const arbitration = buildPressureConflictArbitration({ sources: normalizedSources });
  const sources = normalizedSources.map((source) => {
    const resolved = arbitration.sources.find((candidate) => candidate.key === source.key);
    return resolved
      ? {
          ...source,
          effective_pct: resolved.effective_pct,
          suppressed: resolved.suppressed,
          suppressed_by: resolved.suppressed_by,
          suppression_reason: resolved.suppression_reason,
        }
      : source;
  });
  const protectionSources = sources.filter((source) => source.direction === "PROTECTION");
  const opportunitySources = sources.filter((source) => source.direction === "OPPORTUNITY");
  let normalizedProtectionPct = aggregateDirectional(protectionSources);
  let normalizedOpportunityPct = aggregateDirectional(opportunitySources);
  const directionalGap = Math.abs(normalizedProtectionPct - normalizedOpportunityPct);
  const rawDirectionalGap = Math.abs(rawProtectionPct - rawOpportunityPct);
  const rawConflictPct = Math.min(rawProtectionPct, rawOpportunityPct) - rawDirectionalGap * 0.45;
  const effectiveConflictPct = Math.min(normalizedProtectionPct, normalizedOpportunityPct) - directionalGap * 0.45;
  const conflictPct = Math.round(clamp(
    Math.max(rawConflictPct, effectiveConflictPct)
      + arbitration.unresolved_conflicts.length * 6,
    0,
    100,
  ));

  if (conflictPct >= 24) {
    if (directionalGap <= 10) {
      normalizedProtectionPct = Math.round(clamp(normalizedProtectionPct * 0.92, 0, 100));
      normalizedOpportunityPct = Math.round(clamp(normalizedOpportunityPct * 0.92, 0, 100));
    } else if (normalizedProtectionPct > normalizedOpportunityPct) {
      normalizedProtectionPct = Math.round(clamp(normalizedProtectionPct * 0.96, 0, 100));
      normalizedOpportunityPct = Math.round(clamp(normalizedOpportunityPct * 0.86, 0, 100));
    } else {
      normalizedProtectionPct = Math.round(clamp(normalizedProtectionPct * 0.86, 0, 100));
      normalizedOpportunityPct = Math.round(clamp(normalizedOpportunityPct * 0.96, 0, 100));
    }
  }

  const arbitrationState: PressureNormalizationSummary["arbitration_state"] = conflictPct >= 32 && directionalGap <= 12
    ? "CONFLICTED"
    : directionalGap <= 8
      ? "BALANCED"
      : normalizedProtectionPct > normalizedOpportunityPct
        ? "PROTECTION_DOMINANT"
        : "OPPORTUNITY_DOMINANT";
  const dominantPressureKey = sources
    .slice()
    .sort((left, right) => right.effective_pct - left.effective_pct)[0]?.key || "none";

  return {
    schema_version: "pressure-normalization/v2",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    normalized_protection_pct: normalizedProtectionPct,
    normalized_opportunity_pct: normalizedOpportunityPct,
    conflict_pct: conflictPct,
    arbitration_state: arbitrationState,
    winning_tier: arbitration.winning_tier,
    suppressed_sources: arbitration.suppressed_sources,
    unresolved_conflicts: arbitration.unresolved_conflicts,
    arbitration_trace: arbitration.arbitration_trace,
    dominant_pressure_key: dominantPressureKey,
    sources,
    persistence_memory: persistenceMemory,
    arbitration,
    summary_label: `PRESSURE ${arbitrationState} ${arbitration.winning_tier} P${normalizedProtectionPct}/O${normalizedOpportunityPct}`,
    reasons: dedupe([
      conflictPct > 0 ? `pressure_normalization_conflict:${conflictPct}pct` : "",
      arbitrationState === "CONFLICTED" ? "pressure_normalization_arbitration:conflicted" : "",
      arbitrationState === "PROTECTION_DOMINANT" ? "pressure_normalization_arbitration:protect" : "",
      arbitrationState === "OPPORTUNITY_DOMINANT" ? "pressure_normalization_arbitration:opportunity" : "",
      arbitration.winning_tier !== "none" ? `pressure_normalization_winning_tier:${arbitration.winning_tier.toLowerCase()}` : "",
      ...arbitration.unresolved_conflicts.map((conflict) => `pressure_normalization_unresolved:${conflict}`),
      `pressure_normalization_dominant:${dominantPressureKey}`,
      ...persistenceMemory.reasons,
    ]),
  };
}