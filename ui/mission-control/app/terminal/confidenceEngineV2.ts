type ConfidenceWeights = {
  regime: number;
  liquidity: number;
  volatility: number;
  signalClarity: number;
};

export type ConfidenceEngineV2Input = {
  weights: ConfidenceWeights;
  regimeAlignment: number;
  regimeStability: number;
  horizonAgreement: number;
  liquidityDepth: number;
  absorptionQuality: number;
  sweepRejectQuality: number;
  spreadExecutability: number;
  volatilityState: number;
  volatilityExpansion: number;
  volatilityNoiseControl: number;
  distanceToLevel: number;
  impulseQuality: number;
  structureClarity: number;
  invalidationReadability: number;
  executionQuality: number;
  latencyFit: number;
  truthReliability: number;
  truthLockConsistency: number;
};

export type ConfidenceEngineV2Snapshot = {
  regimeScorePct: number;
  liquidityScorePct: number;
  volatilityScorePct: number;
  signalClarityScorePct: number;
  baseScorePct: number;
  adjustedScorePct: number;
  executionFitScorePct: number;
  truthConsistencyScorePct: number;
  qualityLabel: "LOW" | "MEDIUM" | "HIGH";
  weakLinks: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pct(value: number): number {
  return Math.round(clamp(value, 0, 1) * 100);
}

function weightedAverage(values: Array<{ value: number; weight: number }>): number {
  const totalWeight = values.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (!(totalWeight > 0)) {
    return 0;
  }
  const total = values.reduce((sum, item) => sum + clamp(item.value, 0, 1) * Math.max(0, item.weight), 0);
  return total / totalWeight;
}

export function buildConfidenceEngineV2(input: ConfidenceEngineV2Input): ConfidenceEngineV2Snapshot {
  const regimeScore = weightedAverage([
    { value: input.regimeAlignment, weight: 0.4 },
    { value: input.regimeStability, weight: 0.35 },
    { value: input.horizonAgreement, weight: 0.25 },
  ]);
  const liquidityScore = weightedAverage([
    { value: input.liquidityDepth, weight: 0.35 },
    { value: input.absorptionQuality, weight: 0.25 },
    { value: input.sweepRejectQuality, weight: 0.2 },
    { value: input.spreadExecutability, weight: 0.2 },
  ]);
  const volatilityScore = weightedAverage([
    { value: input.volatilityState, weight: 0.45 },
    { value: input.volatilityExpansion, weight: 0.35 },
    { value: input.volatilityNoiseControl, weight: 0.2 },
  ]);
  const signalClarityScore = weightedAverage([
    { value: input.distanceToLevel, weight: 0.35 },
    { value: input.impulseQuality, weight: 0.25 },
    { value: input.structureClarity, weight: 0.25 },
    { value: input.invalidationReadability, weight: 0.15 },
  ]);
  const executionFitScore = weightedAverage([
    { value: input.executionQuality, weight: 0.55 },
    { value: input.latencyFit, weight: 0.2 },
    { value: input.spreadExecutability, weight: 0.25 },
  ]);
  const truthConsistencyScore = weightedAverage([
    { value: input.truthReliability, weight: 0.7 },
    { value: input.truthLockConsistency, weight: 0.3 },
  ]);
  const baseScore = weightedAverage([
    { value: regimeScore, weight: input.weights.regime },
    { value: liquidityScore, weight: input.weights.liquidity },
    { value: volatilityScore, weight: input.weights.volatility },
    { value: signalClarityScore, weight: input.weights.signalClarity },
  ]);
  const executionModifier = 0.78 + executionFitScore * 0.32;
  const truthModifier = 0.75 + truthConsistencyScore * 0.35;
  const adjustedScore = clamp(baseScore * executionModifier * truthModifier, 0, 1);
  const weakLinks: string[] = [];
  if (regimeScore < 0.55) {
    weakLinks.push("regime");
  }
  if (liquidityScore < 0.55) {
    weakLinks.push("liquidity");
  }
  if (volatilityScore < 0.55) {
    weakLinks.push("volatility");
  }
  if (signalClarityScore < 0.55) {
    weakLinks.push("signal");
  }
  if (executionFitScore < 0.55) {
    weakLinks.push("execution-fit");
  }
  if (truthConsistencyScore < 0.6) {
    weakLinks.push("truth");
  }
  const qualityLabel: ConfidenceEngineV2Snapshot["qualityLabel"] = adjustedScore >= 0.72
    ? "HIGH"
    : adjustedScore >= 0.55
      ? "MEDIUM"
      : "LOW";

  return {
    regimeScorePct: pct(regimeScore),
    liquidityScorePct: pct(liquidityScore),
    volatilityScorePct: pct(volatilityScore),
    signalClarityScorePct: pct(signalClarityScore),
    baseScorePct: pct(baseScore),
    adjustedScorePct: pct(adjustedScore),
    executionFitScorePct: pct(executionFitScore),
    truthConsistencyScorePct: pct(truthConsistencyScore),
    qualityLabel,
    weakLinks,
  };
}