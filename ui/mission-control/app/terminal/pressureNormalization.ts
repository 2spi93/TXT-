export type PressureNormalizationDirection = "PROTECTION" | "OPPORTUNITY";

export type PressureNormalizationSignal = {
  key: string;
  direction: PressureNormalizationDirection;
  raw_pct: number;
  confidence_pct: number;
  recency_pct?: number;
  prior_pct?: number;
  floor_pct?: number;
  ceiling_pct?: number;
};

export type PressureNormalizationSource = {
  key: string;
  direction: PressureNormalizationDirection;
  raw_pct: number;
  clipped_pct: number;
  decayed_pct: number;
  hysteresis_pct: number;
  weighted_pct: number;
  normalized_pct: number;
  confidence_pct: number;
};

export type PressureNormalizationSummary = {
  schema_version: "pressure-normalization/v1";
  generated_at_iso: string;
  normalized_protection_pct: number;
  normalized_opportunity_pct: number;
  conflict_pct: number;
  arbitration_state: "PROTECTION_DOMINANT" | "OPPORTUNITY_DOMINANT" | "BALANCED" | "CONFLICTED";
  dominant_pressure_key: string;
  sources: PressureNormalizationSource[];
  summary_label: string;
  reasons: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeSignal(signal: PressureNormalizationSignal): PressureNormalizationSource {
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
  const weightedPct = clamp(hysteresisPct * (0.42 + confidencePct / 100 * 0.58), 0, 100);
  return {
    key: signal.key,
    direction: signal.direction,
    raw_pct: Math.round(rawPct),
    clipped_pct: Math.round(clippedPct),
    decayed_pct: Math.round(decayedPct),
    hysteresis_pct: Math.round(hysteresisPct),
    weighted_pct: Math.round(weightedPct),
    normalized_pct: Math.round(weightedPct),
    confidence_pct: Math.round(confidencePct),
  };
}

function aggregateDirectional(sources: PressureNormalizationSource[]): number {
  if (!sources.length) {
    return 0;
  }
  const ranked = sources.slice().sort((left, right) => right.normalized_pct - left.normalized_pct);
  const head = ranked.slice(0, 3);
  const tail = ranked.slice(3);
  const headWeight = head.reduce((sum, source) => sum + source.confidence_pct, 0) || head.length;
  const headScore = head.reduce((sum, source) => sum + source.normalized_pct * source.confidence_pct, 0) / headWeight;
  const tailScore = tail.length
    ? tail.reduce((sum, source) => sum + source.normalized_pct, 0) / tail.length * 0.22
    : 0;
  const inflationPenalty = Math.max(0, ranked.length - 3) * 1.8;
  return Math.round(clamp(headScore + tailScore - inflationPenalty, 0, 100));
}

export function buildPressureNormalizationSummary(input: {
  signals: PressureNormalizationSignal[];
  nowMs?: number;
}): PressureNormalizationSummary {
  const sources = input.signals.map(normalizeSignal);
  const protectionSources = sources.filter((source) => source.direction === "PROTECTION");
  const opportunitySources = sources.filter((source) => source.direction === "OPPORTUNITY");
  let normalizedProtectionPct = aggregateDirectional(protectionSources);
  let normalizedOpportunityPct = aggregateDirectional(opportunitySources);
  const directionalGap = Math.abs(normalizedProtectionPct - normalizedOpportunityPct);
  const conflictPct = Math.round(clamp(Math.min(normalizedProtectionPct, normalizedOpportunityPct) - directionalGap * 0.45, 0, 100));

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
    .sort((left, right) => right.normalized_pct - left.normalized_pct)[0]?.key || "none";

  return {
    schema_version: "pressure-normalization/v1",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    normalized_protection_pct: normalizedProtectionPct,
    normalized_opportunity_pct: normalizedOpportunityPct,
    conflict_pct: conflictPct,
    arbitration_state: arbitrationState,
    dominant_pressure_key: dominantPressureKey,
    sources,
    summary_label: `PRESSURE ${arbitrationState} P${normalizedProtectionPct}/O${normalizedOpportunityPct}`,
    reasons: dedupe([
      conflictPct >= 24 ? `pressure_normalization_conflict:${conflictPct}pct` : "",
      arbitrationState === "CONFLICTED" ? "pressure_normalization_arbitration:conflicted" : "",
      arbitrationState === "PROTECTION_DOMINANT" ? "pressure_normalization_arbitration:protect" : "",
      arbitrationState === "OPPORTUNITY_DOMINANT" ? "pressure_normalization_arbitration:opportunity" : "",
      `pressure_normalization_dominant:${dominantPressureKey}`,
    ]),
  };
}