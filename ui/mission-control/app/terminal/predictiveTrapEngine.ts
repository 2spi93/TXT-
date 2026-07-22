import type { DesyncWindowSignal } from "./desyncEngine";
import type { LiquidityTrapSignal } from "./liquidityTrapEngine";

export type PredictiveTrapPhase = "none" | "fragility" | "build_up" | "pre_trigger";
export type PredictiveTrapSide = "long_trap" | "short_trap" | "neutral";

export type PredictiveTrapSignal = {
  imminent: boolean;
  probability: number;
  trapSide: PredictiveTrapSide;
  phase: PredictiveTrapPhase;
  timeToTrap: number;
  fragilityScore: number;
  imbalanceScore: number;
  absorptionScore: number;
  summaryLabel: string;
  detailLabel: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function summary(phase: PredictiveTrapPhase, probability: number): string {
  if (phase === "none") {
    return "PRED TRAP CLEAR";
  }
  return `PRED TRAP ${phase.toUpperCase()} ${Math.round(clamp01(probability) * 100)}%`;
}

export function detectPredictiveTrap(input: {
  cancelRate: number;
  depthDrop: number;
  spreadVolatility: number;
  flowDelta: number;
  depthDelta: number;
  volumeHigh: boolean;
  priceDeltaBps: number;
  bias: "up" | "down" | "neutral";
  attentionState: string;
  temporalAligned: boolean;
  desyncWindow?: DesyncWindowSignal | null;
  liquidityTrap?: LiquidityTrapSignal | null;
}): PredictiveTrapSignal {
  if (input.attentionState !== "stable" || !input.temporalAligned) {
    return {
      imminent: false,
      probability: 0,
      trapSide: "neutral",
      phase: "none",
      timeToTrap: 0,
      fragilityScore: 0,
      imbalanceScore: 0,
      absorptionScore: 0,
      summaryLabel: "PRED TRAP HOLD",
      detailLabel: "Predictive trap logic is disabled until attention and temporal alignment are both stable.",
    };
  }

  const fragilityScore = clamp01(input.cancelRate * 0.4 + input.depthDrop * 0.3 + input.spreadVolatility * 0.3);
  const imbalanceScore = clamp01(Math.abs(input.flowDelta - input.depthDelta));
  const absorptionScore = input.volumeHigh && Math.abs(input.priceDeltaBps) <= 2.5
    ? clamp01(0.65 + (input.desyncWindow?.weightedConfidence || 0) * 0.2)
    : clamp01((input.desyncWindow?.weightedConfidence || 0) * 0.35);
  const trapSide: PredictiveTrapSide = input.bias === "up"
    ? "long_trap"
    : input.bias === "down"
      ? "short_trap"
      : (input.liquidityTrap?.trapDirection || "neutral");

  if (fragilityScore > 0.6 && imbalanceScore > 0.45 && absorptionScore > 0.55) {
    const probability = clamp01(0.82 + (fragilityScore - 0.6) * 0.22 + (imbalanceScore - 0.45) * 0.12);
    return {
      imminent: true,
      probability,
      trapSide,
      phase: "pre_trigger",
      timeToTrap: 1,
      fragilityScore,
      imbalanceScore,
      absorptionScore,
      summaryLabel: summary("pre_trigger", probability),
      detailLabel: "Fragility, imbalance, and absorption are aligned. The trap is likely one candle away from triggering.",
    };
  }

  if (fragilityScore > 0.6 && imbalanceScore > 0.35) {
    const probability = clamp01(0.72 + (fragilityScore - 0.6) * 0.18);
    return {
      imminent: false,
      probability,
      trapSide,
      phase: "build_up",
      timeToTrap: 3,
      fragilityScore,
      imbalanceScore,
      absorptionScore,
      summaryLabel: summary("build_up", probability),
      detailLabel: "Liquidity is thinning and layers are drifting apart. Trap build-up is visible but not yet executable.",
    };
  }

  if (fragilityScore > 0.7) {
    const probability = clamp01(0.6 + (fragilityScore - 0.7) * 0.16);
    return {
      imminent: false,
      probability,
      trapSide,
      phase: "fragility",
      timeToTrap: 5,
      fragilityScore,
      imbalanceScore,
      absorptionScore,
      summaryLabel: summary("fragility", probability),
      detailLabel: "Liquidity withdrawal is forming before price impact. Market structure is fragile enough to expect a trap setup soon.",
    };
  }

  return {
    imminent: false,
    probability: 0,
    trapSide: "neutral",
    phase: "none",
    timeToTrap: 0,
    fragilityScore,
    imbalanceScore,
    absorptionScore,
    summaryLabel: "PRED TRAP CLEAR",
    detailLabel: "No predictive trap phase is mature enough to influence execution timing.",
  };
}