export type DesyncSignalType = "NONE" | "FAKE_MOVE" | "ABSORPTION" | "BREAKOUT" | "LIQUIDITY_TRAP";
export type DesyncTradeBias = "long" | "short" | "neutral";
export type DesyncState = "aligned" | "opportunity" | "risk";
export type ValidationGateState = "VALID" | "WAIT" | "NO_TRADE";
export type ValidationGateTone = "good" | "warn" | "bad";

export type DesyncSignal = {
  type: DesyncSignalType;
  state: DesyncState;
  tradeBias: DesyncTradeBias;
  strength: number;
  confidence: number;
  decayConfidence: number;
  shouldBlockTrading: boolean;
  summaryLabel: string;
  detailLabel: string;
};

export type DesyncWindowFrame = {
  atMs: number;
  signal: DesyncSignal;
};

export type DesyncWindowClassification = "alpha" | "risk" | "neutral";

export type DesyncWindowSignal = {
  dominantType: DesyncSignalType;
  dominantState: DesyncState;
  dominantBias: DesyncTradeBias;
  classification: DesyncWindowClassification;
  persistenceScore: number;
  weightedConfidence: number;
  weightedStrength: number;
  weightedBlockProbability: number;
  halfLifeCandles: number;
  sampleCount: number;
  shouldBlockTrading: boolean;
  summaryLabel: string;
  detailLabel: string;
};

export type TripleValidationGate = {
  state: ValidationGateState;
  reason: string;
  confidence: number;
  tone: ValidationGateTone;
  summaryLabel: string;
  detailLabel: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function toneFromState(state: ValidationGateState): ValidationGateTone {
  if (state === "VALID") {
    return "good";
  }
  if (state === "WAIT") {
    return "warn";
  }
  return "bad";
}

function normalizePricePressure(priceDeltaBps: number): number {
  return clamp(priceDeltaBps / 12, -1, 1);
}

function buildDesyncSummary(type: DesyncSignalType, confidence: number): string {
  if (type === "NONE") {
    return `DESYNC OK ${Math.round(clamp01(confidence) * 100)}%`;
  }
  return `DESYNC ${type.replace(/_/g, " ")} ${Math.round(clamp01(confidence) * 100)}%`;
}

function isAlphaType(type: DesyncSignalType): boolean {
  return type === "ABSORPTION" || type === "BREAKOUT";
}

function isRiskType(type: DesyncSignalType): boolean {
  return type === "FAKE_MOVE" || type === "LIQUIDITY_TRAP";
}

export function buildDesyncWindowSignal(input: {
  frames: DesyncWindowFrame[];
  halfLifeCandles?: number;
}): DesyncWindowSignal {
  const halfLifeCandles = Math.max(1, Math.round(input.halfLifeCandles ?? 3));
  const frames = input.frames.filter((frame) => frame && frame.signal).slice(-Math.max(2, halfLifeCandles * 3));
  if (frames.length === 0) {
    return {
      dominantType: "NONE",
      dominantState: "aligned",
      dominantBias: "neutral",
      classification: "neutral",
      persistenceScore: 0,
      weightedConfidence: 0,
      weightedStrength: 0,
      weightedBlockProbability: 0,
      halfLifeCandles,
      sampleCount: 0,
      shouldBlockTrading: false,
      summaryLabel: "DESYNC WIN EMPTY",
      detailLabel: "No recent desync frames available yet.",
    };
  }

  const latestFirst = [...frames].reverse();
  const weightedByType = new Map<DesyncSignalType, number>();
  const biasWeights = new Map<DesyncTradeBias, number>();
  let totalWeight = 0;
  let weightedConfidence = 0;
  let weightedStrength = 0;
  let weightedBlockProbability = 0;
  let weightedRisk = 0;
  let weightedAlpha = 0;
  let weightedPersistent = 0;

  latestFirst.forEach((frame, index) => {
    const weight = Math.exp(-index / halfLifeCandles);
    totalWeight += weight;
    weightedConfidence += frame.signal.decayConfidence * weight;
    weightedStrength += frame.signal.strength * weight;
    weightedBlockProbability += (frame.signal.shouldBlockTrading ? 1 : 0) * weight;
    weightedByType.set(frame.signal.type, (weightedByType.get(frame.signal.type) || 0) + weight * (frame.signal.decayConfidence * 0.6 + frame.signal.strength * 0.4));
    biasWeights.set(frame.signal.tradeBias, (biasWeights.get(frame.signal.tradeBias) || 0) + weight * frame.signal.decayConfidence);
    if (isRiskType(frame.signal.type) || frame.signal.state === "risk") {
      weightedRisk += weight * Math.max(frame.signal.decayConfidence, frame.signal.strength);
    }
    if (isAlphaType(frame.signal.type) && frame.signal.state !== "risk") {
      weightedAlpha += weight * Math.max(frame.signal.decayConfidence, frame.signal.strength);
    }
    if (frame.signal.type !== "NONE") {
      weightedPersistent += weight;
    }
  });

  const dominantType = [...weightedByType.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || "NONE";
  const dominantFrame = latestFirst.find((frame) => frame.signal.type === dominantType)?.signal || latestFirst[0].signal;
  const dominantBias = [...biasWeights.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || dominantFrame.tradeBias;
  const normalizedConfidence = totalWeight > 0 ? clamp01(weightedConfidence / totalWeight) : 0;
  const normalizedStrength = totalWeight > 0 ? clamp01(weightedStrength / totalWeight) : 0;
  const normalizedBlockProbability = totalWeight > 0 ? clamp01(weightedBlockProbability / totalWeight) : 0;
  const persistenceScore = totalWeight > 0 ? clamp01(weightedPersistent / totalWeight) : 0;
  const normalizedRisk = totalWeight > 0 ? clamp01(weightedRisk / totalWeight) : 0;
  const normalizedAlpha = totalWeight > 0 ? clamp01(weightedAlpha / totalWeight) : 0;
  const classification: DesyncWindowClassification = normalizedRisk > Math.max(0.5, normalizedAlpha + 0.08)
    ? "risk"
    : normalizedAlpha > Math.max(0.42, normalizedRisk + 0.05)
      ? "alpha"
      : "neutral";
  const shouldBlockTrading = classification === "risk" && (normalizedBlockProbability > 0.42 || persistenceScore > 0.5);
  const summaryLabel = classification === "neutral"
    ? `DESYNC WIN NEUTRAL ${Math.round(normalizedConfidence * 100)}%`
    : `DESYNC WIN ${classification.toUpperCase()} ${Math.round(normalizedConfidence * 100)}%`;
  const detailLabel = `Sliding desync window over ${frames.length} frame(s): dominant ${dominantType.replace(/_/g, " ")}, persistence ${Math.round(persistenceScore * 100)}%, confidence ${Math.round(normalizedConfidence * 100)}%, strength ${Math.round(normalizedStrength * 100)}%.`;

  return {
    dominantType,
    dominantState: dominantFrame.state,
    dominantBias,
    classification,
    persistenceScore,
    weightedConfidence: normalizedConfidence,
    weightedStrength: normalizedStrength,
    weightedBlockProbability: normalizedBlockProbability,
    halfLifeCandles,
    sampleCount: frames.length,
    shouldBlockTrading,
    summaryLabel,
    detailLabel,
  };
}

export function computeExecutionQualityScore(input: {
  fillProb: number;
  slippageBps: number;
  latencyMs: number;
  confidence: number;
}): number {
  const fillScore = clamp01(input.fillProb);
  const slippageScore = clamp01(1 - Math.abs(input.slippageBps) / 10);
  const latencyScore = clamp01(1 - input.latencyMs / 600);
  const confidenceScore = clamp01(input.confidence);
  return clamp01(
    fillScore * 0.42
    + slippageScore * 0.26
    + latencyScore * 0.16
    + confidenceScore * 0.16,
  );
}

export function computeDesyncAlpha(input: {
  priceDeltaBps: number;
  flowImbalance: number;
  depthImbalance: number;
  tradeImbalance: number;
  tradeVolume: number;
  temporalAligned: boolean;
  temporalDriftMs: number;
  spoofRisk?: number;
  eventKind?: string | null;
  sourceAgeMs?: number;
  decayMs?: number;
}): DesyncSignal {
  const pricePressure = normalizePricePressure(input.priceDeltaBps);
  const flowDelta = clamp(input.flowImbalance, -1, 1);
  const depthDelta = clamp(input.depthImbalance, -1, 1);
  const tradeDelta = clamp(input.tradeImbalance, -1, 1);
  const spoofRisk = clamp01(input.spoofRisk ?? 0);
  const tradeActivity = clamp01(input.tradeVolume / 2_500);
  const priceFlowGap = pricePressure - flowDelta;
  const flowDepthGap = flowDelta - depthDelta;
  const tradePriceGap = tradeDelta - pricePressure;
  const strength = clamp01(
    Math.abs(priceFlowGap) * 0.4
    + Math.abs(flowDepthGap) * 0.3
    + Math.abs(tradePriceGap) * 0.2
    + spoofRisk * 0.1,
  );

  let type: DesyncSignalType = "NONE";
  let state: DesyncState = "aligned";
  let tradeBias: DesyncTradeBias = "neutral";
  let shouldBlockTrading = false;
  let detailLabel = "Cross-layer movement stays coherent enough to trust the current trigger.";
  let confidence = clamp01((1 - Math.min(1, input.temporalDriftMs / 2_000)) * 0.3 + (1 - strength) * 0.7);

  if (Math.abs(pricePressure) >= 0.3 && Math.abs(flowDelta) >= 0.18 && Math.sign(pricePressure) !== Math.sign(flowDelta)) {
    type = "FAKE_MOVE";
    state = "risk";
    tradeBias = pricePressure > 0 ? "short" : "long";
    shouldBlockTrading = true;
    confidence = clamp01(0.58 + Math.abs(priceFlowGap) * 0.34 + spoofRisk * 0.08);
    detailLabel = `Price moved ${input.priceDeltaBps.toFixed(1)}bps while flow leans ${flowDelta >= 0 ? "buy" : "sell"}. This is a classic fake move profile.`;
  } else if (Math.abs(tradeDelta) >= 0.22 && Math.abs(pricePressure) <= 0.12 && tradeActivity >= 0.1) {
    type = "ABSORPTION";
    state = input.temporalAligned ? "opportunity" : "risk";
    tradeBias = tradeDelta > 0 ? "short" : "long";
    shouldBlockTrading = !input.temporalAligned;
    confidence = clamp01(0.54 + Math.abs(tradeDelta) * 0.28 + tradeActivity * 0.18);
    detailLabel = `Trades stay aggressive (${(tradeDelta * 100).toFixed(0)}%) but price is not following. Absorption is building on the ${tradeBias} side.`;
  } else if (Math.abs(depthDelta) >= 0.24 && Math.abs(flowDelta) <= 0.14) {
    type = "BREAKOUT";
    state = input.temporalAligned ? "opportunity" : "risk";
    tradeBias = depthDelta > 0 ? "long" : "short";
    shouldBlockTrading = !input.temporalAligned;
    confidence = clamp01(0.5 + Math.abs(depthDelta) * 0.24 + Math.max(0, 1 - Math.abs(flowDelta)) * 0.16);
    detailLabel = `Depth disappears ahead of tape confirmation. This can become a ${tradeBias} breakout if execution quality holds.`;
  } else if (spoofRisk >= 0.55 || (Math.abs(flowDepthGap) >= 0.32 && Math.abs(depthDelta) <= 0.12 && Math.abs(flowDelta) >= 0.2)) {
    type = "LIQUIDITY_TRAP";
    state = "risk";
    tradeBias = "neutral";
    shouldBlockTrading = true;
    confidence = clamp01(0.56 + Math.abs(flowDepthGap) * 0.24 + spoofRisk * 0.2);
    detailLabel = `Liquidity and flow disagree too sharply${input.eventKind ? ` around ${input.eventKind}` : ""}. Trap probability is elevated.`;
  }

  const decayMs = Math.max(500, input.decayMs ?? 4_000);
  const sourceAgeMs = Math.max(0, input.sourceAgeMs ?? 0);
  const decayConfidence = clamp01(confidence * Math.exp(-sourceAgeMs / decayMs));

  return {
    type,
    state,
    tradeBias,
    strength,
    confidence,
    decayConfidence,
    shouldBlockTrading,
    summaryLabel: buildDesyncSummary(type, decayConfidence),
    detailLabel,
  };
}

export function computeTripleValidationGate(input: {
  marketState: ValidationGateState;
  marketReason: string;
  marketConfidence: number;
  attentionReliability: number;
  temporalAligned: boolean;
  executionQualityScore: number;
  desync: DesyncSignal;
  desyncWindow?: DesyncWindowSignal | null;
}): TripleValidationGate {
  if (input.desyncWindow?.shouldBlockTrading) {
    return {
      state: "NO_TRADE",
      reason: "DESYNC_WINDOW_RISK",
      confidence: clamp01(input.desyncWindow.weightedConfidence * 0.35),
      tone: "bad",
      summaryLabel: `TRIPLE NO_TRADE ${Math.round(input.desyncWindow.weightedConfidence * 100)}%`,
      detailLabel: input.desyncWindow.detailLabel,
    };
  }

  if (input.marketState === "NO_TRADE") {
    return {
      state: "NO_TRADE",
      reason: input.marketReason,
      confidence: 0,
      tone: "bad",
      summaryLabel: "TRIPLE NO_TRADE 0%",
      detailLabel: input.marketReason,
    };
  }

  if (input.executionQualityScore < 0.5) {
    return {
      state: "NO_TRADE",
      reason: "EXECUTION_QUALITY_TOO_LOW",
      confidence: clamp01(input.executionQualityScore * 0.3),
      tone: "bad",
      summaryLabel: `TRIPLE NO_TRADE ${Math.round(input.executionQualityScore * 100)}%`,
      detailLabel: `Execution quality is too weak (${Math.round(input.executionQualityScore * 100)}%). Fill/slippage/latency do not justify a live trigger.`,
    };
  }

  if (input.desync.shouldBlockTrading) {
    return {
      state: "NO_TRADE",
      reason: input.desync.type,
      confidence: clamp01(input.desync.decayConfidence * 0.4),
      tone: "bad",
      summaryLabel: `TRIPLE NO_TRADE ${Math.round(input.desync.decayConfidence * 100)}%`,
      detailLabel: input.desync.detailLabel,
    };
  }

  if (
    (input.desync.type === "ABSORPTION" || input.desync.type === "BREAKOUT")
    && input.attentionReliability >= 0.6
    && input.temporalAligned
    && input.executionQualityScore >= 0.55
  ) {
    const confidence = clamp01(
      input.marketConfidence * 0.46
      + input.executionQualityScore * 0.26
      + input.desync.decayConfidence * 0.28,
    );
    return {
      state: "VALID",
      reason: input.desync.type,
      confidence,
      tone: "good",
      summaryLabel: `TRIPLE VALID ${Math.round(confidence * 100)}%`,
      detailLabel: `${input.desync.detailLabel} Triple validation is satisfied: attention, temporal sync, and execution quality all agree.`,
    };
  }

  if (
    input.desyncWindow
    && input.desyncWindow.classification === "alpha"
    && input.desyncWindow.persistenceScore >= 0.5
    && input.attentionReliability >= 0.6
    && input.temporalAligned
    && input.executionQualityScore >= 0.55
  ) {
    const confidence = clamp01(
      input.marketConfidence * 0.4
      + input.executionQualityScore * 0.24
      + input.desyncWindow.weightedConfidence * 0.2
      + input.desyncWindow.persistenceScore * 0.16,
    );
    return {
      state: "VALID",
      reason: "DESYNC_WINDOW_ALPHA",
      confidence,
      tone: "good",
      summaryLabel: `TRIPLE VALID ${Math.round(confidence * 100)}%`,
      detailLabel: `${input.desyncWindow.detailLabel} Persistence confirms the desync as an alpha candidate, not a transient spike.`,
    };
  }

  if (
    input.marketState === "WAIT"
    || input.executionQualityScore < 0.62
    || input.attentionReliability < 0.6
    || !input.temporalAligned
    || input.desync.state === "risk"
  ) {
    const confidence = clamp01(
      input.marketConfidence * 0.5
      + input.executionQualityScore * 0.25
      + input.desync.decayConfidence * 0.25,
    );
    return {
      state: "WAIT",
      reason: input.desync.type === "NONE" ? "PARTIAL_VALIDATION" : input.desync.type,
      confidence,
      tone: "warn",
      summaryLabel: `TRIPLE WAIT ${Math.round(confidence * 100)}%`,
      detailLabel: input.desync.type === "NONE"
        ? "The market is usable but one layer is still below the execution threshold."
        : `${input.desync.detailLabel} Wait for the remaining validation layers to align.`,
    };
  }

  const confidence = clamp01(
    input.marketConfidence * 0.64
    + input.executionQualityScore * 0.26
    + (1 - input.desync.strength) * 0.1,
  );
  return {
    state: "VALID",
    reason: "ALIGNED",
    confidence,
    tone: toneFromState("VALID"),
    summaryLabel: `TRIPLE VALID ${Math.round(confidence * 100)}%`,
    detailLabel: "Attention, temporal sync, and execution quality remain aligned enough for a valid trigger.",
  };
}