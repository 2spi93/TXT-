type JsonMap = Record<string, unknown>;

import { computeSmartState, type SmartMarketStateValue } from "./attentionTemporalFusion";
import {
  deriveMarketCrossLayerAttention,
  type AttentionLayerName,
  type AttentionState,
  type AttentionTone,
  type MarketCrossLayerAttentionContext,
  type MarketCrossLayerAttentionContextInput,
} from "./crossLayerAttentionEngine";
import { computeTemporalSync } from "./temporalSyncEngine";

export type FreshnessState = "fresh" | "stale" | "degraded" | "hard-fail";
export type HealthTone = "good" | "warn" | "bad";

export type MarketFlowAlert = {
  label: "bars" | "depth" | "trades";
  state: FreshnessState;
  age: string;
};

export type TerminalMarketHealthSnapshot = {
  marketBusHealth: JsonMap | null;
  marketBusHealthComponents: JsonMap | null;
  marketBusSequencing: JsonMap | null;
  marketBusOhlcvHealth: JsonMap | null;
  marketBusDepthHealth: JsonMap | null;
  marketBusTradesHealth: JsonMap | null;
  marketBusHealthStatus: string;
  marketBusHealthTone: HealthTone;
  marketBusOhlcvLatestSeq: number;
  marketBusDepthUpdateId: number;
  marketBusOhlcvContiguous: boolean;
  marketBusSyncLabel: string;
  crossLayerAttentionWeights: Record<AttentionLayerName, number>;
  crossLayerAttentionLayerScores: Record<AttentionLayerName, number>;
  crossLayerAttentionDominantLayer: AttentionLayerName;
  crossLayerAttentionDominantReason: string;
  crossLayerAttentionReliabilityScore: number;
  crossLayerAttentionCoherenceScore: number;
  crossLayerAttentionContext: MarketCrossLayerAttentionContext;
  crossLayerAttentionState: AttentionState;
  crossLayerAttentionTone: AttentionTone;
  crossLayerAttentionRenderable: boolean;
  crossLayerAttentionShouldBlockTrading: boolean;
  crossLayerAttentionPreferredRenderSource: "ohlcv" | "bus";
  crossLayerAttentionSummaryLabel: string;
  crossLayerAttentionDetailLabel: string;
  temporalSyncAligned: boolean;
  temporalSyncDriftMs: number;
  temporalSyncSeqGap: number;
  temporalSyncFreshnessScore: number;
  temporalSyncDominantSource: string;
  temporalSyncDegraded: boolean;
  temporalSyncSourceCount: number;
  temporalSyncBufferedSourceCount: number;
  temporalSyncBufferWindowMs: number;
  temporalSyncSummaryLabel: string;
  temporalSyncDetailLabel: string;
  smartMarketState: SmartMarketStateValue;
  smartMarketReason: string;
  smartMarketConfidence: number;
  smartMarketTone: AttentionTone;
  smartMarketSummaryLabel: string;
  smartMarketDetailLabel: string;
  ohlcvFreshnessState: FreshnessState;
  depthFreshnessState: FreshnessState;
  tradesFreshnessState: FreshnessState;
  publicChartHardFailOnlyAlerts: boolean;
  marketFlowAlerts: MarketFlowAlert[];
  chartOverlayCompactMode: boolean;
  chartUltraCleanCandles: boolean;
  publicHostAutoCleanCandles: boolean;
  chartFlowAlertText: string;
  chartCompactAlertLabel: string;
};

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatClock(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}:${String(parsed.getSeconds()).padStart(2, "0")}`;
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampFromFreshnessMs(freshnessMs: unknown): number | null {
  const value = Number(freshnessMs);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return Date.now() - value;
}

function buildTemporalSummaryLabel(input: { aligned: boolean; degraded: boolean; driftMs: number; dominantSource: string }): string {
  if (input.degraded) {
    return `TEMP DESYNC ${Math.round(input.driftMs)}ms ${input.dominantSource.toUpperCase()}`;
  }
  if (!input.aligned) {
    return `TEMP PARTIAL ${Math.round(input.driftMs)}ms ${input.dominantSource.toUpperCase()}`;
  }
  return `TEMP OK ${Math.round(input.driftMs)}ms ${input.dominantSource.toUpperCase()}`;
}

function buildTemporalDetailLabel(input: { driftMs: number; seqGap: number; freshnessScore: number; sourceCount: number; bufferedSourceCount: number; bufferWindowMs: number }): string {
  return `Temporal sync: drift ${Math.round(input.driftMs)}ms, seq gap ${input.seqGap}, freshness ${(input.freshnessScore * 100).toFixed(0)}%, sources ${input.bufferedSourceCount}/${input.sourceCount} within ${input.bufferWindowMs}ms buffer.`;
}

export function formatFreshness(value: unknown): string {
  const freshnessMs = Number(value);
  if (!Number.isFinite(freshnessMs) || freshnessMs < 0) {
    return "n/a";
  }
  if (freshnessMs <= 1000) {
    return `${Math.round(freshnessMs)}ms`;
  }
  if (freshnessMs <= 60_000) {
    return `${Math.round(freshnessMs / 1000)}s`;
  }
  if (freshnessMs <= 3_600_000) {
    return `${Math.round(freshnessMs / 60_000)}m`;
  }
  return `${Math.round(freshnessMs / 3_600_000)}h`;
}

export function streamStateTone(state: string): HealthTone {
  if (state === "live") {
    return "good";
  }
  if (state === "connecting") {
    return "warn";
  }
  return "bad";
}

export function classifyFreshnessState(value: unknown): FreshnessState {
  const freshnessMs = Number(value);
  if (!Number.isFinite(freshnessMs) || freshnessMs < 0) {
    return "hard-fail";
  }
  if (freshnessMs <= 15_000) {
    return "fresh";
  }
  if (freshnessMs <= 60_000) {
    return "stale";
  }
  if (freshnessMs <= 180_000) {
    return "degraded";
  }
  return "hard-fail";
}

export function classifyFreshnessTone(state: FreshnessState): HealthTone {
  if (state === "fresh") {
    return "good";
  }
  if (state === "stale") {
    return "warn";
  }
  return "bad";
}

export function deriveTerminalMarketHealth(input: {
  marketBusMeta: JsonMap | null;
  marketBusLastSyncAt: string | null;
  localFeedSignal: "OHLCV_RENDERABLE" | "OHLCV_PARTIAL" | "OHLCV_UNUSABLE";
  renderableRows: number;
  chartMode: "line" | "candles" | "footprint";
  chartVisualMode: "auto" | "clean" | "full";
  publicBrowserHost: boolean;
  attentionContext?: MarketCrossLayerAttentionContextInput | null;
}): TerminalMarketHealthSnapshot {
  const { marketBusMeta, marketBusLastSyncAt, localFeedSignal, renderableRows, chartMode, chartVisualMode, publicBrowserHost, attentionContext } = input;
  const marketBusHealth = (marketBusMeta?.health as JsonMap | undefined) || null;
  const marketBusHealthComponents = (marketBusHealth?.components as JsonMap | undefined) || null;
  const marketBusSequencing = (marketBusMeta?.sequencing as JsonMap | undefined) || null;
  const marketBusOhlcvHealth = (marketBusHealthComponents?.ohlcv as JsonMap | undefined) || null;
  const marketBusDepthHealth = (marketBusHealthComponents?.depth as JsonMap | undefined) || null;
  const marketBusTradesHealth = (marketBusHealthComponents?.trades as JsonMap | undefined) || null;
  const marketBusHealthStatus = String(marketBusHealth?.status || "offline");
  const marketBusHealthTone = marketBusHealthStatus === "ok" ? "good" : marketBusHealthStatus === "degraded" ? "warn" : "bad";
  const marketBusOhlcvSequence = (marketBusSequencing?.ohlcv as JsonMap | undefined) || null;
  const marketBusDepthSequence = (marketBusSequencing?.depth as JsonMap | undefined) || null;
  const marketBusOhlcvLatestSeq = toNumber(marketBusOhlcvSequence?.latest_seq, 0);
  const marketBusDepthUpdateId = toNumber(marketBusDepthSequence?.last_update_id, 0);
  const marketBusOhlcvContiguous = Boolean(marketBusOhlcvSequence?.contiguous);
  const marketBusSyncLabel = marketBusLastSyncAt ? formatClock(marketBusLastSyncAt) : "--:--:--";
  const temporalSync = computeTemporalSync([
    {
      name: "ohlcv",
      timestamp: timestampFromFreshnessMs(marketBusOhlcvHealth?.freshness_ms) ?? 0,
      latency: 0,
      data: { signal: localFeedSignal },
    },
    {
      name: "bus",
      timestamp: parseTimestampMs(marketBusLastSyncAt) ?? (timestampFromFreshnessMs(marketBusOhlcvHealth?.freshness_ms) ?? 0),
      seq: marketBusOhlcvLatestSeq > 0 ? marketBusOhlcvLatestSeq : undefined,
      latency: 0,
      data: { status: marketBusHealthStatus },
    },
    {
      name: "depth",
      timestamp: timestampFromFreshnessMs(marketBusDepthHealth?.freshness_ms) ?? 0,
      latency: 0,
      data: { updateId: marketBusDepthUpdateId },
    },
    {
      name: "trades",
      timestamp: timestampFromFreshnessMs(marketBusTradesHealth?.freshness_ms) ?? 0,
      latency: 0,
    },
  ].filter((item) => item.timestamp > 0));
  const crossLayerAttention = deriveMarketCrossLayerAttention({
    localFeedSignal,
    renderableRows,
    marketBusHealthStatus,
    marketBusOhlcvContiguous,
    marketBusOhlcvLatestSeq,
    ohlcvFreshnessMs: toNumber(marketBusOhlcvHealth?.freshness_ms, Number.NaN),
    depthFreshnessMs: toNumber(marketBusDepthHealth?.freshness_ms, Number.NaN),
    tradesFreshnessMs: toNumber(marketBusTradesHealth?.freshness_ms, Number.NaN),
    context: {
      ...attentionContext,
      temporalDriftMs: temporalSync.driftMs,
      temporalAligned: temporalSync.aligned,
    },
  });
  const temporalSyncSummaryLabel = buildTemporalSummaryLabel(temporalSync);
  const temporalSyncDetailLabel = buildTemporalDetailLabel(temporalSync);
  const smartMarketState = computeSmartState({
    attention: crossLayerAttention,
    temporal: temporalSync,
  });
  const ohlcvFreshnessState = classifyFreshnessState(marketBusOhlcvHealth?.freshness_ms);
  const depthFreshnessState = classifyFreshnessState(marketBusDepthHealth?.freshness_ms);
  const tradesFreshnessState = classifyFreshnessState(marketBusTradesHealth?.freshness_ms);
  const publicChartHardFailOnlyAlerts = publicBrowserHost && chartMode === "candles";
  const marketFlowCandidates: MarketFlowAlert[] = [
    { label: "bars", state: ohlcvFreshnessState, age: formatFreshness(marketBusOhlcvHealth?.freshness_ms) },
    { label: "depth", state: depthFreshnessState, age: formatFreshness(marketBusDepthHealth?.freshness_ms) },
    { label: "trades", state: tradesFreshnessState, age: formatFreshness(marketBusTradesHealth?.freshness_ms) },
  ];
  const marketFlowAlerts = marketFlowCandidates.filter((item) => (publicChartHardFailOnlyAlerts ? item.state === "hard-fail" : item.state === "degraded" || item.state === "hard-fail"));
  const chartOverlayCompactMode = chartMode === "candles" && chartVisualMode !== "full";
  const chartUltraCleanCandles = chartMode === "candles" && chartVisualMode === "clean";
  const publicHostAutoCleanCandles = publicBrowserHost && chartMode === "candles" && chartVisualMode === "auto";
  const chartFlowAlertText = marketFlowAlerts.map((item) => `${item.label}:${item.state}@${item.age}`).join(" · ");
  const chartCompactAlertLabel = marketFlowAlerts.length > 0
    ? `MD ${marketFlowAlerts.length} ALERT${marketFlowAlerts.length > 1 ? "S" : ""}`
    : "MD OK";

  return {
    marketBusHealth,
    marketBusHealthComponents,
    marketBusSequencing,
    marketBusOhlcvHealth,
    marketBusDepthHealth,
    marketBusTradesHealth,
    marketBusHealthStatus,
    marketBusHealthTone,
    marketBusOhlcvLatestSeq,
    marketBusDepthUpdateId,
    marketBusOhlcvContiguous,
    marketBusSyncLabel,
    crossLayerAttentionWeights: crossLayerAttention.weights,
    crossLayerAttentionLayerScores: crossLayerAttention.layerScores,
    crossLayerAttentionDominantLayer: crossLayerAttention.dominantLayer,
    crossLayerAttentionDominantReason: crossLayerAttention.dominantReason,
    crossLayerAttentionReliabilityScore: crossLayerAttention.reliabilityScore,
    crossLayerAttentionCoherenceScore: crossLayerAttention.coherenceScore,
    crossLayerAttentionContext: crossLayerAttention.context,
    crossLayerAttentionState: crossLayerAttention.state,
    crossLayerAttentionTone: crossLayerAttention.tone,
    crossLayerAttentionRenderable: crossLayerAttention.renderable,
    crossLayerAttentionShouldBlockTrading: crossLayerAttention.shouldBlockTrading,
    crossLayerAttentionPreferredRenderSource: crossLayerAttention.preferredRenderSource,
    crossLayerAttentionSummaryLabel: crossLayerAttention.summaryLabel,
    crossLayerAttentionDetailLabel: crossLayerAttention.detailLabel,
    temporalSyncAligned: temporalSync.aligned,
    temporalSyncDriftMs: temporalSync.driftMs,
    temporalSyncSeqGap: temporalSync.seqGap,
    temporalSyncFreshnessScore: temporalSync.freshnessScore,
    temporalSyncDominantSource: temporalSync.dominantSource,
    temporalSyncDegraded: temporalSync.degraded,
    temporalSyncSourceCount: temporalSync.sourceCount,
    temporalSyncBufferedSourceCount: temporalSync.bufferedSourceCount,
    temporalSyncBufferWindowMs: temporalSync.bufferWindowMs,
    temporalSyncSummaryLabel,
    temporalSyncDetailLabel,
    smartMarketState: smartMarketState.state,
    smartMarketReason: smartMarketState.reason,
    smartMarketConfidence: smartMarketState.confidence,
    smartMarketTone: smartMarketState.tone,
    smartMarketSummaryLabel: smartMarketState.summaryLabel,
    smartMarketDetailLabel: smartMarketState.detailLabel,
    ohlcvFreshnessState,
    depthFreshnessState,
    tradesFreshnessState,
    publicChartHardFailOnlyAlerts,
    marketFlowAlerts,
    chartOverlayCompactMode,
    chartUltraCleanCandles,
    publicHostAutoCleanCandles,
    chartFlowAlertText,
    chartCompactAlertLabel,
  };
}