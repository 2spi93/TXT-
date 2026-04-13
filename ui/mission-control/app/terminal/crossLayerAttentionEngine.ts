export type AttentionLayerName = "ohlcv" | "bus" | "depth" | "trades";

export type AttentionTone = "good" | "warn" | "bad";

export type AttentionState = "stable" | "degraded" | "fragile" | "blocked";

export type LayerSignal = {
  name: AttentionLayerName;
  freshnessMs: number | null;
  quality: number;
  latencyMs: number | null;
  confidence: number;
  value?: Record<string, unknown> | null;
};

export type AttentionVolatilityRegime = "compressed" | "normal" | "expanding" | "extreme";

export type MarketCrossLayerAttentionContextInput = {
  volatilityRegime?: AttentionVolatilityRegime | null;
  manipulationRisk?: number | null;
  executionQualityScore?: number | null;
  flowAgreementScore?: number | null;
  priceVelocityScore?: number | null;
  temporalDriftMs?: number | null;
  temporalAligned?: boolean | null;
  eventKind?: string | null;
};

export type MarketCrossLayerAttentionContext = {
  volatilityRegime: AttentionVolatilityRegime;
  manipulationRisk: number;
  executionQualityScore: number;
  flowAgreementScore: number;
  priceVelocityScore: number;
  temporalDriftMs: number;
  temporalAligned: boolean;
  eventKind: string | null;
};

export type AttentionOutput = {
  weights: Record<AttentionLayerName, number>;
  layerScores: Record<AttentionLayerName, number>;
  dominantLayer: AttentionLayerName;
  dominantReason: string;
  reliabilityScore: number;
  coherenceScore: number;
  context: MarketCrossLayerAttentionContext;
  mergedState: Record<string, unknown>;
};

export type MarketCrossLayerAttention = AttentionOutput & {
  state: AttentionState;
  tone: AttentionTone;
  renderable: boolean;
  shouldBlockTrading: boolean;
  preferredRenderSource: "ohlcv" | "bus";
  summaryLabel: string;
  detailLabel: string;
};

export type MarketCrossLayerAttentionInput = {
  localFeedSignal: "OHLCV_RENDERABLE" | "OHLCV_PARTIAL" | "OHLCV_UNUSABLE";
  renderableRows: number;
  marketBusHealthStatus: string;
  marketBusOhlcvContiguous: boolean;
  marketBusOhlcvLatestSeq: number;
  ohlcvFreshnessMs: number | null;
  depthFreshnessMs: number | null;
  tradesFreshnessMs: number | null;
  context?: MarketCrossLayerAttentionContextInput | null;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function asFinite(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? Number(value) : null;
}

function resolveFreshnessScore(freshnessMs: number | null, decayMs: number): number {
  if (!Number.isFinite(freshnessMs) || freshnessMs == null || freshnessMs < 0) {
    return 0;
  }
  return clamp01(Math.exp(-freshnessMs / decayMs));
}

function resolveLatencyScore(latencyMs: number | null): number {
  if (!Number.isFinite(latencyMs) || latencyMs == null || latencyMs < 0) {
    return 1;
  }
  return clamp01(Math.exp(-latencyMs / 250));
}

function normalizeVolatilityRegime(regime: string | null | undefined): AttentionVolatilityRegime {
  if (regime === "compressed" || regime === "normal" || regime === "expanding" || regime === "extreme") {
    return regime;
  }
  return "normal";
}

function normalizeAttentionContext(input?: MarketCrossLayerAttentionContextInput | null): MarketCrossLayerAttentionContext {
  return {
    volatilityRegime: normalizeVolatilityRegime(input?.volatilityRegime),
    manipulationRisk: clamp01(Number(input?.manipulationRisk ?? 0)),
    executionQualityScore: clamp01(Number(input?.executionQualityScore ?? 0.5)),
    flowAgreementScore: clamp01(Number(input?.flowAgreementScore ?? 0.5)),
    priceVelocityScore: clamp01(Number(input?.priceVelocityScore ?? 0.25)),
    temporalDriftMs: Math.max(0, Number(input?.temporalDriftMs ?? 0)),
    temporalAligned: input?.temporalAligned !== false,
    eventKind: typeof input?.eventKind === "string" && input.eventKind.trim().length > 0 ? input.eventKind.trim() : null,
  };
}

function buildContextualBias(context: MarketCrossLayerAttentionContext): {
  bias: Record<AttentionLayerName, number>;
  reasons: string[];
} {
  const bias: Record<AttentionLayerName, number> = {
    ohlcv: 0,
    bus: 0,
    depth: 0,
    trades: 0,
  };
  const reasons: string[] = [];

  if (context.volatilityRegime === "compressed") {
    bias.ohlcv += 0.08;
    bias.bus += 0.05;
    bias.depth -= 0.03;
    bias.trades -= 0.02;
    reasons.push("Volatility compressed, structural layers remain primary.");
  } else if (context.volatilityRegime === "expanding") {
    bias.depth += 0.07;
    bias.trades += 0.1;
    bias.ohlcv -= 0.04;
    reasons.push("Volatility expanding, microstructure layers gain priority.");
  } else if (context.volatilityRegime === "extreme") {
    bias.bus += 0.06;
    bias.depth += 0.04;
    bias.trades += 0.12;
    bias.ohlcv -= 0.08;
    reasons.push("Extreme volatility favors bus confirmation and live tape over slow structure.");
  }

  if (context.manipulationRisk >= 0.55) {
    bias.bus += 0.14;
    bias.ohlcv += 0.08;
    bias.depth -= 0.16;
    bias.trades -= 0.08;
    reasons.push("Manipulation risk elevated, visible depth is discounted in favor of confirmed structure.");
  }

  if (context.executionQualityScore >= 0.68) {
    bias.depth += 0.05;
    bias.trades += 0.08;
    reasons.push("Execution quality is supportive, live depth and trades can drive the decision.");
  } else if (context.executionQualityScore <= 0.45) {
    bias.ohlcv += 0.05;
    bias.bus += 0.08;
    bias.depth -= 0.05;
    bias.trades -= 0.08;
    reasons.push("Execution quality is weak, attention shifts back to slower confirmation layers.");
  }

  if (!context.temporalAligned || context.temporalDriftMs >= 1_200) {
    bias.bus += 0.12;
    bias.ohlcv -= 0.04;
    bias.depth -= 0.04;
    bias.trades -= 0.04;
    reasons.push("Temporal drift is elevated, sequenced bus confirmation gets more weight.");
  }

  if (context.flowAgreementScore >= 0.65) {
    bias.depth += 0.05;
    bias.trades += 0.05;
    reasons.push("Flow agreement is strong across layers, microstructure confirmation is more trustworthy.");
  } else if (context.flowAgreementScore <= 0.35) {
    bias.bus += 0.06;
    bias.ohlcv += 0.04;
    bias.depth -= 0.04;
    bias.trades -= 0.05;
    reasons.push("Flow disagreement is elevated, attention falls back to more stable structural layers.");
  }

  if (context.priceVelocityScore >= 0.65) {
    bias.trades += 0.07;
    reasons.push("Price velocity is high, tape becomes more informative than static bars.");
  }

  if (context.eventKind) {
    const normalizedEvent = context.eventKind.toLowerCase();
    if (normalizedEvent.includes("absorp")) {
      bias.depth += 0.04;
      bias.trades += 0.06;
      reasons.push("Absorption context increases the value of tape and depth.");
    } else if (normalizedEvent.includes("sweep") || normalizedEvent.includes("liquidity") || normalizedEvent.includes("trap")) {
      bias.trades += 0.08;
      bias.bus += 0.03;
      bias.ohlcv -= 0.04;
      reasons.push("Liquidity event detected, immediate tape and bus confirmation dominate.");
    }
  }

  return { bias, reasons };
}

function buildDominantReason(dominantLayer: AttentionLayerName, reasons: string[]): string {
  if (reasons.length > 0) {
    return reasons[0];
  }
  return `${dominantLayer.toUpperCase()} remains dominant on base quality, confidence, freshness, and latency.`;
}

function softmax(scores: number[]): number[] {
  if (scores.length === 0) {
    return [];
  }
  const bounded = scores.map((score) => (Number.isFinite(score) ? score : 0));
  const maxScore = Math.max(...bounded);
  const expScores = bounded.map((score) => Math.exp(score - maxScore));
  const total = expScores.reduce((sum, score) => sum + score, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return bounded.map(() => 1 / bounded.length);
  }
  return expScores.map((score) => score / total);
}

function resolveFreshnessQuality(freshnessMs: number | null): number {
  if (!Number.isFinite(freshnessMs) || freshnessMs == null || freshnessMs < 0) {
    return 0.08;
  }
  if (freshnessMs <= 15_000) {
    return 1;
  }
  if (freshnessMs <= 60_000) {
    return 0.72;
  }
  if (freshnessMs <= 180_000) {
    return 0.42;
  }
  return 0.12;
}

function resolveBusQuality(status: string, contiguous: boolean, latestSeq: number): number {
  if (status === "ok") {
    if (contiguous && latestSeq > 0) {
      return 0.95;
    }
    return 0.68;
  }
  if (status === "degraded") {
    return 0.42;
  }
  return 0.1;
}

function resolveBusConfidence(status: string, contiguous: boolean, latestSeq: number): number {
  if (status === "ok" && contiguous && latestSeq > 0) {
    return 0.92;
  }
  if (status === "ok") {
    return 0.55;
  }
  if (status === "degraded") {
    return 0.35;
  }
  return 0.14;
}

function buildAttentionSummary(dominantLayer: AttentionLayerName, reliabilityScore: number, state: AttentionState): string {
  return `ATTN ${dominantLayer.toUpperCase()} ${Math.round(clamp01(reliabilityScore) * 100)}% ${state.toUpperCase()}`;
}

function buildAttentionDetail(state: AttentionState, preferredRenderSource: "ohlcv" | "bus", shouldBlockTrading: boolean, dominantReason: string): string {
  if (state === "blocked") {
    return `Cross-layer blocked: market render is not trustworthy. ${dominantReason}`;
  }
  if (state === "fragile") {
    return shouldBlockTrading
      ? `Cross-layer fragile: render can fall back to ${preferredRenderSource.toUpperCase()}, trading should stay blocked. ${dominantReason}`
      : `Cross-layer fragile: render can fall back to ${preferredRenderSource.toUpperCase()}, microstructure is weak. ${dominantReason}`;
  }
  if (state === "degraded") {
    return `Cross-layer degraded: render is anchored on ${preferredRenderSource.toUpperCase()} with partial supporting layers. ${dominantReason}`;
  }
  return `Cross-layer stable: ${preferredRenderSource.toUpperCase()} is confirmed by supporting layers. ${dominantReason}`;
}

export function computeAttention(layers: LayerSignal[], contextInput?: MarketCrossLayerAttentionContextInput | null): AttentionOutput {
  const context = normalizeAttentionContext(contextInput);
  const { bias: contextualBias, reasons: contextualReasons } = buildContextualBias(context);
  const normalizedLayers = layers.map((layer) => {
    const freshnessScore = resolveFreshnessScore(layer.freshnessMs, 30_000);
    const latencyScore = resolveLatencyScore(layer.latencyMs);
    const quality = clamp01(layer.quality);
    const confidence = clamp01(layer.confidence);
    const baseScore = (
      0.4 * quality +
      0.3 * confidence +
      0.2 * freshnessScore +
      0.1 * latencyScore
    );
    const rawScore = baseScore + (contextualBias[layer.name] || 0);
    return {
      ...layer,
      freshnessScore,
      latencyScore,
      baseScore,
      rawScore,
    };
  });

  const weightsArray = softmax(normalizedLayers.map((layer) => layer.rawScore));
  const weights = normalizedLayers.reduce<Record<AttentionLayerName, number>>((accumulator, layer, index) => {
    accumulator[layer.name] = weightsArray[index] || 0;
    return accumulator;
  }, {
    ohlcv: 0,
    bus: 0,
    depth: 0,
    trades: 0,
  });
  const layerScores = normalizedLayers.reduce<Record<AttentionLayerName, number>>((accumulator, layer) => {
    accumulator[layer.name] = layer.rawScore;
    return accumulator;
  }, {
    ohlcv: 0,
    bus: 0,
    depth: 0,
    trades: 0,
  });
  const dominantLayer = (Object.entries(weights).sort((left, right) => right[1] - left[1])[0]?.[0] || "ohlcv") as AttentionLayerName;
  const dominantReason = buildDominantReason(dominantLayer, contextualReasons);
  const reliabilityScore = Math.max(...Object.values(weights));
  const coherenceScore = normalizedLayers.reduce((sum, layer, index) => sum + layer.rawScore * (weightsArray[index] || 0), 0);
  const mergedState = normalizedLayers.reduce<Record<string, unknown>>((accumulator, layer, index) => {
    if (layer.value && typeof layer.value === "object") {
      Object.assign(accumulator, layer.value);
    }
    accumulator[`${layer.name}Weight`] = weightsArray[index] || 0;
    accumulator[`${layer.name}Score`] = layer.rawScore;
    return accumulator;
  }, {});
  mergedState.attentionDominantReason = dominantReason;
  mergedState.attentionContext = context;

  return {
    weights,
    layerScores,
    dominantLayer,
    dominantReason,
    reliabilityScore,
    coherenceScore,
    context,
    mergedState,
  };
}

export function deriveMarketCrossLayerAttention(input: MarketCrossLayerAttentionInput): MarketCrossLayerAttention {
  const ohlcvQuality = input.localFeedSignal === "OHLCV_RENDERABLE"
    ? 1
    : input.localFeedSignal === "OHLCV_PARTIAL"
      ? 0.55
      : 0.12;
  const ohlcvConfidence = input.renderableRows >= 20
    ? 0.95
    : input.renderableRows > 0
      ? 0.45
      : 0.1;
  const busQuality = resolveBusQuality(String(input.marketBusHealthStatus || "offline"), input.marketBusOhlcvContiguous, input.marketBusOhlcvLatestSeq);
  const busConfidence = resolveBusConfidence(String(input.marketBusHealthStatus || "offline"), input.marketBusOhlcvContiguous, input.marketBusOhlcvLatestSeq);
  const depthQuality = resolveFreshnessQuality(asFinite(input.depthFreshnessMs));
  const tradesQuality = resolveFreshnessQuality(asFinite(input.tradesFreshnessMs));

  const baseAttention = computeAttention([
    {
      name: "ohlcv",
      freshnessMs: asFinite(input.ohlcvFreshnessMs),
      latencyMs: null,
      quality: ohlcvQuality,
      confidence: ohlcvConfidence,
      value: {
        renderableRows: input.renderableRows,
        localFeedSignal: input.localFeedSignal,
      },
    },
    {
      name: "bus",
      freshnessMs: asFinite(input.ohlcvFreshnessMs),
      latencyMs: null,
      quality: busQuality,
      confidence: busConfidence,
      value: {
        marketBusHealthStatus: input.marketBusHealthStatus,
        marketBusOhlcvContiguous: input.marketBusOhlcvContiguous,
        marketBusOhlcvLatestSeq: input.marketBusOhlcvLatestSeq,
      },
    },
    {
      name: "depth",
      freshnessMs: asFinite(input.depthFreshnessMs),
      latencyMs: null,
      quality: depthQuality,
      confidence: depthQuality,
      value: {
        depthFreshnessMs: input.depthFreshnessMs,
      },
    },
    {
      name: "trades",
      freshnessMs: asFinite(input.tradesFreshnessMs),
      latencyMs: null,
      quality: tradesQuality,
      confidence: tradesQuality,
      value: {
        tradesFreshnessMs: input.tradesFreshnessMs,
      },
    },
  ], input.context);

  const renderable = ohlcvQuality >= 0.55 && input.renderableRows > 0;
  const microstructureCollapsed = depthQuality < 0.25 && tradesQuality < 0.25;
  const supportingLayerWeak = busQuality < 0.45 || depthQuality < 0.45 || tradesQuality < 0.45;
  const shouldBlockTrading = !renderable || (microstructureCollapsed && busQuality < 0.45);
  let state: AttentionState = "stable";
  if (!renderable) {
    state = "blocked";
  } else if (shouldBlockTrading || (microstructureCollapsed && baseAttention.reliabilityScore < 0.62)) {
    state = "fragile";
  } else if (supportingLayerWeak) {
    state = "degraded";
  }

  const preferredRenderSource = baseAttention.weights.ohlcv >= baseAttention.weights.bus ? "ohlcv" : "bus";
  const tone: AttentionTone = state === "stable" ? "good" : state === "blocked" ? "bad" : "warn";

  return {
    ...baseAttention,
    state,
    tone,
    renderable,
    shouldBlockTrading,
    preferredRenderSource,
    summaryLabel: buildAttentionSummary(baseAttention.dominantLayer, baseAttention.reliabilityScore, state),
    detailLabel: buildAttentionDetail(state, preferredRenderSource, shouldBlockTrading, baseAttention.dominantReason),
  };
}