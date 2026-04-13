import type { DesyncWindowSignal } from "./desyncEngine";
import type { LiquidityTrapSignal } from "./liquidityTrapEngine";
import type { PredictiveTrapSignal } from "./predictiveTrapEngine";

export type MarketIntent = "NONE" | "ACCUMULATION" | "DISTRIBUTION" | "LIQUIDITY_HUNT" | "FAKE_ACTIVITY";
export type IntentState = "neutral" | "alpha" | "risk";
export type IntentTradeBias = "buy" | "sell" | "neutral";

export type IntentSignal = {
  intent: MarketIntent;
  confidence: number;
  persistence: number;
  aggressiveness: number;
  isInstitutional: boolean;
  tradeBias: IntentTradeBias;
  state: IntentState;
  shouldBlockTrading: boolean;
  summaryLabel: string;
  detailLabel: string;
};

export type IntentWindowFrame = {
  atMs: number;
  signal: IntentSignal;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function summary(intent: MarketIntent, confidence: number): string {
  if (intent === "NONE") {
    return `INTENT CLEAR ${Math.round(clamp01(confidence) * 100)}%`;
  }
  return `INTENT ${intent.replace(/_/g, " ")} ${Math.round(clamp01(confidence) * 100)}%`;
}

function dominantBias(frames: IntentWindowFrame[]): IntentTradeBias {
  const score = new Map<IntentTradeBias, number>();
  frames.forEach((frame, index) => {
    const weight = Math.exp(-index / 3);
    score.set(frame.signal.tradeBias, (score.get(frame.signal.tradeBias) || 0) + weight * frame.signal.confidence);
  });
  return [...score.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || "neutral";
}

export function detectMarketIntent(input: {
  priceDeltaBps: number;
  flowDelta: number;
  depthImbalance: number;
  tradeImbalance: number;
  tradeVolume: number;
  volumeHigh: boolean;
  absorption: boolean;
  breakout: boolean;
  reversalSpeedBps: number;
  liquiditySweep: boolean;
  depthSpoofingRisk: number;
  depthAdded: boolean;
  depthRemoved: boolean;
  flowMismatch: boolean;
  desyncWindow?: DesyncWindowSignal | null;
  liquidityTrap?: LiquidityTrapSignal | null;
  predictiveTrap?: PredictiveTrapSignal | null;
  attentionState: string;
  temporalAligned: boolean;
}): IntentSignal {
  if (input.attentionState !== "stable" || !input.temporalAligned) {
    return {
      intent: "NONE",
      confidence: 0,
      persistence: 0,
      aggressiveness: 0,
      isInstitutional: false,
      tradeBias: "neutral",
      state: "neutral",
      shouldBlockTrading: false,
      summaryLabel: "INTENT HOLD",
      detailLabel: "Intent inference is disabled until attention and temporal alignment are stable.",
    };
  }

  const flowDelta = clamp(input.flowDelta, -1, 1);
  const depthDelta = clamp(input.depthImbalance, -1, 1);
  const tradeDelta = clamp(input.tradeImbalance, -1, 1);
  const priceStable = Math.abs(input.priceDeltaBps) <= 2.5;
  const priceUp = input.priceDeltaBps >= 3;
  const priceDown = input.priceDeltaBps <= -3;
  const spoofRisk = clamp01(input.depthSpoofingRisk);
  const desyncAlpha = input.desyncWindow?.classification === "alpha" ? input.desyncWindow.weightedConfidence : 0;
  const desyncRisk = input.desyncWindow?.classification === "risk" ? input.desyncWindow.weightedConfidence : 0;

  if (
    spoofRisk >= 0.66
    || (input.depthAdded && input.depthRemoved && input.flowMismatch)
    || input.liquidityTrap?.type === "SPOOF_TRAP"
  ) {
    const confidence = clamp01(0.72 + spoofRisk * 0.18 + desyncRisk * 0.08);
    return {
      intent: "FAKE_ACTIVITY",
      confidence,
      persistence: 0.24,
      aggressiveness: 0.3,
      isInstitutional: false,
      tradeBias: "neutral",
      state: "risk",
      shouldBlockTrading: true,
      summaryLabel: summary("FAKE_ACTIVITY", confidence),
      detailLabel: "Displayed liquidity looks manipulative or unstable. Flow and visible depth do not carry trustworthy intent.",
    };
  }

  if (
    flowDelta >= 0.28
    && priceStable
    && (input.absorption || tradeDelta >= 0.18)
    && depthDelta >= -0.08
  ) {
    const confidence = clamp01(0.76 + flowDelta * 0.12 + desyncAlpha * 0.08);
    return {
      intent: "ACCUMULATION",
      confidence,
      persistence: 0.62,
      aggressiveness: clamp01(0.52 + Math.abs(flowDelta) * 0.18),
      isInstitutional: true,
      tradeBias: "buy",
      state: "alpha",
      shouldBlockTrading: false,
      summaryLabel: summary("ACCUMULATION", confidence),
      detailLabel: "Aggressive buying is being absorbed while price stays stable. This matches an institutional accumulation profile.",
    };
  }

  if (
    (priceUp || priceDown)
    && input.volumeHigh
    && ((priceUp && flowDelta <= 0.08) || (priceDown && flowDelta >= -0.08))
  ) {
    const confidence = clamp01(0.72 + Math.abs(input.priceDeltaBps) / 35 + input.tradeVolume / 8_000);
    return {
      intent: "DISTRIBUTION",
      confidence,
      persistence: 0.58,
      aggressiveness: 0.5,
      isInstitutional: true,
      tradeBias: priceUp ? "sell" : "buy",
      state: "alpha",
      shouldBlockTrading: false,
      summaryLabel: summary("DISTRIBUTION", confidence),
      detailLabel: "Price is extending but aggressive flow is not confirming. This looks more like discreet inventory distribution than healthy continuation.",
    };
  }

  if (
    (input.breakout && input.liquiditySweep && Math.abs(input.reversalSpeedBps) >= 5)
    || input.liquidityTrap?.type === "FAKE_BREAKOUT"
    || input.liquidityTrap?.type === "STOP_HUNT"
  ) {
    const confidence = clamp01(0.82 + Math.abs(input.reversalSpeedBps) / 24 + (input.predictiveTrap?.probability || 0) * 0.06);
    return {
      intent: "LIQUIDITY_HUNT",
      confidence,
      persistence: 0.4,
      aggressiveness: 0.95,
      isInstitutional: true,
      tradeBias: input.priceDeltaBps >= 0 ? "sell" : "buy",
      state: "alpha",
      shouldBlockTrading: false,
      summaryLabel: summary("LIQUIDITY_HUNT", confidence),
      detailLabel: "A fast breakout-sweep-reversal sequence is visible. The move looks like liquidity harvesting, not price discovery.",
    };
  }

  return {
    intent: "NONE",
    confidence: clamp01(1 - Math.max(desyncAlpha, desyncRisk) * 0.4),
    persistence: 0,
    aggressiveness: 0,
    isInstitutional: false,
    tradeBias: "neutral",
    state: "neutral",
    shouldBlockTrading: false,
    summaryLabel: summary("NONE", 0.55),
    detailLabel: "No persistent market intent is strong enough to alter execution.",
  };
}

export function buildPersistentIntentSignal(input: {
  frames: IntentWindowFrame[];
  halfLifeCandles?: number;
}): IntentSignal {
  const halfLifeCandles = Math.max(1, Math.round(input.halfLifeCandles ?? 4));
  const frames = input.frames.filter((frame) => frame && frame.signal).slice(-Math.max(2, halfLifeCandles * 3));
  if (frames.length === 0) {
    return {
      intent: "NONE",
      confidence: 0,
      persistence: 0,
      aggressiveness: 0,
      isInstitutional: false,
      tradeBias: "neutral",
      state: "neutral",
      shouldBlockTrading: false,
      summaryLabel: "INTENT WIN EMPTY",
      detailLabel: "No recent intent frames available yet.",
    };
  }

  const latestFirst = [...frames].reverse();
  const weights = new Map<MarketIntent, number>();
  let totalWeight = 0;
  let confidence = 0;
  let aggressiveness = 0;
  let institutionalWeight = 0;
  let activeWeight = 0;
  let riskWeight = 0;

  latestFirst.forEach((frame, index) => {
    const weight = Math.exp(-index / halfLifeCandles);
    totalWeight += weight;
    confidence += frame.signal.confidence * weight;
    aggressiveness += frame.signal.aggressiveness * weight;
    if (frame.signal.isInstitutional) {
      institutionalWeight += weight;
    }
    if (frame.signal.intent !== "NONE") {
      activeWeight += weight;
    }
    if (frame.signal.state === "risk") {
      riskWeight += weight * frame.signal.confidence;
    }
    weights.set(frame.signal.intent, (weights.get(frame.signal.intent) || 0) + weight * Math.max(frame.signal.confidence, frame.signal.aggressiveness));
  });

  const intent = [...weights.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || "NONE";
  const normalizedConfidence = totalWeight > 0 ? clamp01(confidence / totalWeight) : 0;
  const normalizedAggressiveness = totalWeight > 0 ? clamp01(aggressiveness / totalWeight) : 0;
  const persistence = totalWeight > 0 ? clamp01(activeWeight / totalWeight) : 0;
  const state: IntentState = riskWeight > totalWeight * 0.36
    ? "risk"
    : intent === "NONE"
      ? "neutral"
      : "alpha";
  const bias = dominantBias(latestFirst);
  const isInstitutional = institutionalWeight >= totalWeight * 0.5;
  const shouldBlockTrading = intent === "FAKE_ACTIVITY" && normalizedConfidence >= 0.62;
  const detailLabel = `Intent window over ${frames.length} frame(s): dominant ${intent.replace(/_/g, " ")}, persistence ${Math.round(persistence * 100)}%, confidence ${Math.round(normalizedConfidence * 100)}%, aggressiveness ${Math.round(normalizedAggressiveness * 100)}%.`;

  return {
    intent,
    confidence: normalizedConfidence,
    persistence,
    aggressiveness: normalizedAggressiveness,
    isInstitutional,
    tradeBias: intent === "NONE" ? "neutral" : bias,
    state,
    shouldBlockTrading,
    summaryLabel: intent === "NONE"
      ? `INTENT CLEAR ${Math.round(normalizedConfidence * 100)}%`
      : `INTENT ${intent.replace(/_/g, " ")} ${Math.round(normalizedConfidence * 100)}%`,
    detailLabel,
  };
}