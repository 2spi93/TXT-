export type ConfidencePolicyMode = "standard" | "opportunistic";

export type ConfidenceModeProfile = {
  mode: ConfidencePolicyMode;
  label: string;
  weights: {
    regime: number;
    liquidity: number;
    volatility: number;
    signalClarity: number;
  };
  goThresholdPct: number;
  cautionThresholdPct: number;
  minimumActionThresholdPct: number;
  minimumExecutionFitPct: number;
  arbWatchBoostPct: number;
  inefficiencyBoostPct: number;
  invalidDivergencePenaltyPct: number;
  recommendedRiskMultiplier: number;
};

export function resolveConfidenceModeProfile(mode: ConfidencePolicyMode): ConfidenceModeProfile {
  if (mode === "opportunistic") {
    return {
      mode,
      label: "OPPORTUNISTIC",
      weights: {
        regime: 0.26,
        liquidity: 0.27,
        volatility: 0.23,
        signalClarity: 0.24,
      },
      goThresholdPct: 64,
      cautionThresholdPct: 50,
      minimumActionThresholdPct: 44,
      minimumExecutionFitPct: 48,
      arbWatchBoostPct: 7,
      inefficiencyBoostPct: 12,
      invalidDivergencePenaltyPct: 8,
      recommendedRiskMultiplier: 0.86,
    };
  }

  return {
    mode: "standard",
    label: "STANDARD",
    weights: {
      regime: 0.3,
      liquidity: 0.25,
      volatility: 0.2,
      signalClarity: 0.25,
    },
    goThresholdPct: 72,
    cautionThresholdPct: 58,
    minimumActionThresholdPct: 50,
    minimumExecutionFitPct: 55,
    arbWatchBoostPct: 4,
    inefficiencyBoostPct: 6,
    invalidDivergencePenaltyPct: 10,
    recommendedRiskMultiplier: 1,
  };
}