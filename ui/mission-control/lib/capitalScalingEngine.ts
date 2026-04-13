export type CapitalScalingInputs = {
  accountEquity: number;
  intentScore: number;
  executionQuality: number;
  attentionScore: number;
  temporalStability: number;
  desyncAlphaScore: number;
  volatility: number;
  drawdown: number;
  currentPortfolioRisk: number;
  recentWinrate: number;
  openTradeCount: number;
  unrealizedPnlPct?: number;
  hardBlock?: boolean;
};

export type CapitalScalingDecision = {
  allow: boolean;
  status: "BLOCKED" | "DEFENSIVE" | "BALANCED" | "AGGRESSIVE";
  baseRiskPct: number;
  edgeScore: number;
  edgeMultiplier: number;
  riskFactor: number;
  performanceFactor: number;
  portfolioHeatFactor: number;
  scaleAdjustmentFactor: number;
  multiplier: number;
  recommendedRiskUsd: number;
  reasons: string[];
};

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function computeEdgeMultiplier(score: number): number {
  if (score > 0.8) {
    return 1.8;
  }
  if (score > 0.6) {
    return 1.2;
  }
  if (score > 0.4) {
    return 0.8;
  }
  return 0.3;
}

export function computeCapitalScalingDecision(input: CapitalScalingInputs): CapitalScalingDecision {
  const baseRiskPct = 0.01;
  const accountEquity = Math.max(0, input.accountEquity);
  const edgeScore = clamp01(
    clamp01(input.intentScore) * 0.25
      + clamp01(input.executionQuality) * 0.25
      + clamp01(input.attentionScore) * 0.2
      + clamp01(input.temporalStability) * 0.2
      + clamp01(input.desyncAlphaScore) * 0.1,
  );
  const reasons: string[] = [];

  if (input.hardBlock || input.attentionScore < 0.3 || input.temporalStability < 0.3) {
    reasons.push("capital_engine_hard_block");
    return {
      allow: false,
      status: "BLOCKED",
      baseRiskPct,
      edgeScore,
      edgeMultiplier: 0,
      riskFactor: 0,
      performanceFactor: 0,
      portfolioHeatFactor: 0,
      scaleAdjustmentFactor: 0,
      multiplier: 0,
      recommendedRiskUsd: 0,
      reasons,
    };
  }

  const edgeMultiplier = computeEdgeMultiplier(edgeScore);
  if (edgeMultiplier >= 1.8) {
    reasons.push("edge_high");
  } else if (edgeMultiplier <= 0.3) {
    reasons.push("edge_low");
  }

  let riskFactor = 1;
  const drawdown = Math.max(0, input.drawdown);
  if (drawdown > 0.1) {
    riskFactor *= 0.5;
    reasons.push("drawdown_over_10pct");
  }
  if (drawdown > 0.2) {
    riskFactor *= 0.25;
    reasons.push("drawdown_over_20pct");
  }
  if (input.volatility > 0.7) {
    riskFactor *= 0.6;
    reasons.push("high_volatility_capital_reduction");
  }

  let portfolioHeatFactor = 1;
  const currentPortfolioRisk = Math.max(0, input.currentPortfolioRisk);
  if (currentPortfolioRisk > 0.06) {
    portfolioHeatFactor *= 0.55;
    reasons.push("portfolio_heat_over_6pct");
  }
  if (input.openTradeCount >= 3) {
    portfolioHeatFactor *= 0.75;
    reasons.push("open_trade_limit_pressure");
  }

  let performanceFactor = 1;
  const recentWinrate = clamp01(input.recentWinrate);
  if (recentWinrate > 0.65) {
    performanceFactor *= 1.2;
    reasons.push("recent_performance_support");
  } else if (recentWinrate < 0.4) {
    performanceFactor *= 0.6;
    reasons.push("recent_performance_drawback");
  }

  let scaleAdjustmentFactor = 1;
  const unrealizedPnlPct = input.unrealizedPnlPct ?? 0;
  if (input.executionQuality > 0.8 && unrealizedPnlPct > 0) {
    scaleAdjustmentFactor *= 1.2;
    reasons.push("scale_in_winner");
  }
  if (input.executionQuality < 0.4) {
    scaleAdjustmentFactor *= 0.5;
    reasons.push("execution_quality_scale_down");
  }

  const baseRiskUsd = accountEquity * baseRiskPct;
  const recommendedRiskUsd = baseRiskUsd * edgeMultiplier * riskFactor * portfolioHeatFactor * performanceFactor * scaleAdjustmentFactor;
  const multiplier = clamp(
    baseRiskUsd > 0 ? recommendedRiskUsd / baseRiskUsd : 0,
    0,
    2.4,
  );

  const status: CapitalScalingDecision["status"] = multiplier >= 1.4
    ? "AGGRESSIVE"
    : multiplier >= 0.85
      ? "BALANCED"
      : "DEFENSIVE";

  return {
    allow: multiplier > 0,
    status,
    baseRiskPct,
    edgeScore,
    edgeMultiplier,
    riskFactor,
    performanceFactor,
    portfolioHeatFactor,
    scaleAdjustmentFactor,
    multiplier,
    recommendedRiskUsd,
    reasons,
  };
}