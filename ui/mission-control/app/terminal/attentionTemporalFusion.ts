import type { AttentionTone, MarketCrossLayerAttention } from "./crossLayerAttentionEngine";
import type { TemporalState } from "./temporalSyncEngine";

export type SmartMarketStateValue = "VALID" | "WAIT" | "NO_TRADE";

export type SmartMarketState = {
  state: SmartMarketStateValue;
  reason: "MARKET_NOT_RENDERABLE" | "TEMPORAL_DESYNC" | "CROSS_LAYER_RISK" | "LOW_SIGNAL_QUALITY" | "PARTIAL_LAYER_SYNC" | "VALID";
  confidence: number;
  tone: AttentionTone;
  summaryLabel: string;
  detailLabel: string;
  meta: {
    attention: MarketCrossLayerAttention;
    temporal: TemporalState;
  };
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function buildSummary(state: SmartMarketStateValue, confidence: number): string {
  return `SYNC ${state} ${Math.round(clamp01(confidence) * 100)}%`;
}

export function computeSmartState(input: {
  attention: MarketCrossLayerAttention;
  temporal: TemporalState;
}): SmartMarketState {
  const { attention, temporal } = input;
  const confidence = clamp01(
    attention.reliabilityScore * 0.65
    + attention.coherenceScore * 0.2
    + temporal.freshnessScore * 0.15,
  );

  if (!attention.renderable) {
    return {
      state: "NO_TRADE",
      reason: "MARKET_NOT_RENDERABLE",
      confidence: 0,
      tone: "bad",
      summaryLabel: buildSummary("NO_TRADE", 0),
      detailLabel: "Render state is not trustworthy enough to trade or project forward.",
      meta: input,
    };
  }

  if (temporal.degraded) {
    return {
      state: "NO_TRADE",
      reason: "TEMPORAL_DESYNC",
      confidence: 0,
      tone: "bad",
      summaryLabel: buildSummary("NO_TRADE", 0),
      detailLabel: `Temporal desync detected: drift ${Math.round(temporal.driftMs)}ms, seq gap ${temporal.seqGap}, freshness ${(temporal.freshnessScore * 100).toFixed(0)}%.`,
      meta: input,
    };
  }

  if (attention.shouldBlockTrading) {
    return {
      state: "NO_TRADE",
      reason: "CROSS_LAYER_RISK",
      confidence: clamp01(confidence * 0.25),
      tone: "bad",
      summaryLabel: buildSummary("NO_TRADE", confidence * 0.25),
      detailLabel: attention.detailLabel,
      meta: input,
    };
  }

  if (attention.reliabilityScore < 0.4 || attention.state === "fragile") {
    return {
      state: "WAIT",
      reason: "LOW_SIGNAL_QUALITY",
      confidence: clamp01(confidence * 0.7),
      tone: "warn",
      summaryLabel: buildSummary("WAIT", confidence * 0.7),
      detailLabel: `Signal quality is still too weak for execution. ${attention.detailLabel}`,
      meta: input,
    };
  }

  if (!temporal.aligned || attention.state === "degraded") {
    return {
      state: "WAIT",
      reason: "PARTIAL_LAYER_SYNC",
      confidence: clamp01(confidence * 0.82),
      tone: "warn",
      summaryLabel: buildSummary("WAIT", confidence * 0.82),
      detailLabel: `Market is renderable but not fully aligned yet. Drift ${Math.round(temporal.driftMs)}ms, dominant ${temporal.dominantSource}.`,
      meta: input,
    };
  }

  return {
    state: "VALID",
    reason: "VALID",
    confidence,
    tone: "good",
    summaryLabel: buildSummary("VALID", confidence),
    detailLabel: `Layers agree in time and quality. Dominant layer ${attention.dominantLayer.toUpperCase()}, dominant source ${temporal.dominantSource}.`,
    meta: input,
  };
}