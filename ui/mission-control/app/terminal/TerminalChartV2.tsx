"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import GpuChartV4Surface from "./GpuChartV4Surface";
import type { SmartDecisionHudShape } from "./chartHudTypes";
import { applyDecisionStability, createDecisionStabilityEngine } from "./decisionStabilityEngine";
import { resolveSmartDecision } from "./decisionEngine";
import InstitutionalChart from "./InstitutionalChart";
import { buildLiquidityOverlayZones, detectLiquidity } from "./liquidityEngine";
import { buildRegimeSnapshot } from "./regimeEngine";
import SmartDecisionSummary from "./SmartDecisionSummary";
import { buildSmartDecisionHud } from "./smartDecisionHud";
import { buildStructureOverlayZones, detectStructure } from "./structureEngine";
import type { ChartPerceptualTelemetry, GpuPerceptualTelemetry } from "./chartPerceptual";
import type { PerceptualExecutionSignal } from "./chartPerceptualEngine";
import type { MarketSimulation } from "./marketSimulationEngine";
import type { PriceSignalBand } from "../../lib/engine/gpu-chart/PriceSignalLayer";
import type { LiveChartFrameMeta } from "../../lib/chartFrameFeed";
import { DEFAULT_MIN_RENDERABLE_BARS } from "../../lib/ohlcvIntegrity";
import { timeframeToMs } from "../../lib/ohlcvDataEngine";
import { computePredictionV5, type PredictionV5 } from "../../lib/predictionEngineV5";

type CandlePoint = { label: string; open: number; high: number; low: number; close: number; volume: number };
type DomLevel = { side: "bid" | "ask"; price: number; size: number; intensity: number };
type FootprintRow = { low: number; high: number; buyVolume: number; sellVolume: number; delta: number; timeLabel?: string; timeKey?: string };
type DomHistoryFrame = { time: number; levels: Array<{ side: "bid" | "ask"; price: number; size: number; intensity: number }>; spoofingRisk?: number };
type TradeBubbleVisual = { time: number; price: number; volume: number; side: "buy" | "sell"; intensity?: number; kind?: "trade" | "spoof" };
type IndicatorSeries = { indicatorId: string; outputKey: string; label: string; color: string; type: string; pane: "main" | "sub"; lineWidth: number; data: Array<{ time: number; value: number }> };

type AutoExecutionMode = "assisted" | "semi-auto" | "full-auto";
type V2Intent = "observe" | "analyze" | "execute";
type ChartEngineMode = "v3" | "v4";
type GpuViewportGrid = 1 | 4 | 16 | "auto";
type ChartSmoothingMs = 0 | 80 | 140 | 220;
type AnchorType = "candle" | "zone";
type RiskAction = { ts: string; action: string; detail: string };
type RiskJournalEntry = {
  id: string;
  createdAtIso: string;
  symbol: string;
  timeframe: string;
  strategy: string;
  action: string;
  detail: string;
};

type FlowInsight = {
  label: string;
  dominantSide: "buy" | "sell" | "neutral";
  score: number;
  liquidityBias: number;
  eventKind: string | null;
};

const MIN_RENDER_CANDLES = DEFAULT_MIN_RENDERABLE_BARS;

// ── Auto Trader V5 types ────────────────────────────────────────────────────
type AutoTraderV5Mode = "standby" | "watching" | "in-trade" | "paused";

type AutoTraderV5Position = {
  side: "long" | "short";
  entryPrice: number;
  size: number;          // notionnel USD (paper)
  trailingStop: number;
  partialClosed: boolean;
  entryTs: string;
  invalidation: number | null;
};

type AutoTraderV5State = {
  enabled: boolean;
  mode: AutoTraderV5Mode;
  position: AutoTraderV5Position | null;
  totalTrades: number;
  wins: number;
  pnlUsd: number;
  currentDrawdownPct: number;
  lastAction: string | null;
};

export type TerminalAutoTraderV5Observation = {
  enabled: boolean;
  mode: AutoTraderV5Mode;
  drawdownPaused: boolean;
  blockedReasons: string[];
  currentDrawdownPct: number;
  lastAction: string | null;
};

const INIT_AUTO_TRADER: AutoTraderV5State = {
  enabled: false,
  mode: "standby",
  position: null,
  totalTrades: 0,
  wins: 0,
  pnlUsd: 0,
  currentDrawdownPct: 0,
  lastAction: null,
};

type Props = {
  enabled: boolean;
  onToggleEnabled: () => void;
  hasSidecar?: boolean;
  sidecarStack?: ReactNode;
  symbol: string;
  timeframe: string;
  onTimeframeChange: (timeframe: string) => void;
  chartWindow: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  liveFeedKey?: string;
  candles: CandlePoint[];
  analyticsCandles?: CandlePoint[];
  isPreviewMode?: boolean;
  suspendDecisionLayer?: boolean;
  fallbackPrice: number;
  loading: boolean;
  autoExecutionMode: AutoExecutionMode;
  onAutoExecutionModeChange: (mode: AutoExecutionMode) => void;
  routingCandidates: Array<{ venue: string; instrument: string; spread: number; last: number; score: number }>;
  routeVenue: string;
  routeScorePct: number | null;
  depthState: "offline" | "connecting" | "live";
  renderMode?: "line" | "candles" | "footprint";
  deskModeLabel: string;
  deskModeLocked: boolean;
  effectiveBarMode: "time" | "delta" | "event";
  lowFlowEdgeBlocked: boolean;
  flowConfidenceLabel: string;
  domLevels: DomLevel[];
  heatmapLevels: DomLevel[];
  domHistory?: DomHistoryFrame[];
  tradeBubbles?: TradeBubbleVisual[];
  priceSignalBands?: PriceSignalBand[];
  footprintRows?: FootprintRow[];
  executionSignals?: PerceptualExecutionSignal[];
  marketSimulation?: MarketSimulation | null;
  riskMissRatioPct: number;
  riskHardAlert: boolean;
  riskGuardEnabled: boolean;
  onToggleRiskGuard: () => void;
  maxLossUsd: number;
  onSetMaxLossUsd: (value: number) => void;
  targetGainUsd: number;
  onSetTargetGainUsd: (value: number) => void;
  riskLossExceeded: boolean;
  riskTargetMiss: boolean;
  strategyLabel: string;
  onAutoReduce: () => void;
  onAutoClose: () => void;
  onDomEntryFromLevel: (price: number, side: "bid" | "ask") => void;
  onDomExitFromLevel: (price: number, side: "bid" | "ask") => void;
  chartLinkSymbolEnabled: boolean;
  onToggleChartLinkSymbol: () => void;
  chartLinkTimeframeEnabled: boolean;
  onToggleChartLinkTimeframe: () => void;
  selectedVenue: string;
  availableVenues: string[];
  onSelectVenue: (venue: string | null) => void;
  advancedControlsOpen?: boolean;
  aiHeadline: string;
  aiScenario: string;
  aiConfidencePct: number;
  aiExplanation: string;
  marketSyncGate?: {
    state: "VALID" | "WAIT" | "NO_TRADE";
    reason: string;
    confidence: number;
    summaryLabel: string;
    detailLabel: string;
    temporalSummaryLabel: string;
    attentionSummaryLabel: string;
    desyncSummaryLabel: string;
    intentSummaryLabel: string;
    executionSummaryLabel: string;
  } | null;
  flowInsight?: FlowInsight | null;
  indicatorSeries?: IndicatorSeries[];
  chartEngineMode?: ChartEngineMode;
  gpuViewportGrid?: GpuViewportGrid;
  chartSmoothingMs?: ChartSmoothingMs;
  chartTruth?: {
    sourceLabel: string;
    modeLabel: string;
    truthStatusLabel?: string;
    truthStatusTone?: "good" | "warn" | "bad" | "neutral";
    truthStatusReasonLabel?: string;
    clockLabel: string;
    feedStatusLabel: string;
    feedStatusTone: "good" | "warn" | "bad" | "neutral";
    exchangeStatusLabel: string;
    exchangeStatusTone: "good" | "warn" | "bad" | "neutral";
    exchangeStatusEmphasis?: "default" | "secondary";
    lagLabel: string;
    freshnessLabel: string;
    routeLabel: string;
    lagTone: "good" | "warn" | "bad" | "neutral";
  } | null;
  onChartPerceptualTelemetry?: (payload: ChartPerceptualTelemetry) => void;
  onGpuPerceptualTelemetry?: (payload: GpuPerceptualTelemetry) => void;
  onGpuViewportFrameMetaChange?: (payload: Record<string, LiveChartFrameMeta>) => void;
  onSmartDecisionHudChange?: (payload: SmartDecisionHudShape) => void;
  onAutoTraderV5ObservationChange?: (payload: TerminalAutoTraderV5Observation) => void;
};

function ensureVisibleCandles(candles: CandlePoint[], _fallbackPrice: number): CandlePoint[] {
  return candles.filter((candle) => (
    Number.isFinite(candle.open)
    && Number.isFinite(candle.high)
    && Number.isFinite(candle.low)
    && Number.isFinite(candle.close)
    && candle.high >= Math.max(candle.open, candle.close)
    && candle.low <= Math.min(candle.open, candle.close)
  ));
}

function resolveFlatCandleNotice(candles: CandlePoint[], timeframe: string): string | null {
  const recent = candles.slice(-Math.min(120, candles.length));
  if (recent.length < 24) {
    return null;
  }

  let validCount = 0;
  let flatCount = 0;
  for (const candle of recent) {
    if (![candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0)) {
      continue;
    }
    validCount += 1;
    const anchor = Math.max(Math.abs(candle.close), Math.abs(candle.open), 1);
    const range = Math.max(candle.high, candle.open, candle.close) - Math.min(candle.low, candle.open, candle.close);
    if (range <= Math.max(anchor * 0.0000002, 1e-8)) {
      flatCount += 1;
    }
  }

  if (validCount < 24 || flatCount / validCount < 0.72) {
    return null;
  }
  return `Bougies plates sur ${timeframe}: le flux recu contient surtout open=high=low=close. Le prix est affiche, mais TXT attend des klines completes pour dessiner de vrais corps de bougie.`;
}

function deriveRouteScorePct(routeScorePct: number | null, depthState: "offline" | "connecting" | "live"): number {
  if (Number.isFinite(routeScorePct)) {
    return Math.max(0, Math.min(100, Number(routeScorePct)));
  }
  if (depthState === "live") {
    return 72;
  }
  if (depthState === "connecting") {
    return 48;
  }
  return 30;
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function parseHistoryLabelMs(label: string): number | null {
  const parsed = Date.parse(label);
  return Number.isFinite(parsed) ? parsed : null;
}

function timeframeMs(timeframe: string): number {
  const match = String(timeframe || "").trim().match(/^(\d+)([smhdwM])$/);
  if (!match) {
    return 60_000;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return 60_000;
  }
  switch (match[2]) {
    case "s": return value * 1_000;
    case "m": return value * 60_000;
    case "h": return value * 3_600_000;
    case "d": return value * 86_400_000;
    case "w": return value * 604_800_000;
    case "M": return value * 2_592_000_000;
    default: return 60_000;
  }
}

export default function TerminalChartV2(props: Props) {
  const {
    enabled,
    onToggleEnabled,
    hasSidecar = false,
    sidecarStack = null,
    symbol,
    timeframe,
    onTimeframeChange,
    chartWindow,
    onZoomIn,
    onZoomOut,
    liveFeedKey,
    candles,
    fallbackPrice,
    loading,
    autoExecutionMode,
    onAutoExecutionModeChange,
    routingCandidates,
    routeVenue,
    routeScorePct,
    depthState,
    renderMode = "candles",
    deskModeLabel,
    deskModeLocked,
    effectiveBarMode,
    lowFlowEdgeBlocked,
    flowConfidenceLabel,
    domLevels,
    heatmapLevels,
    domHistory,
    tradeBubbles,
    priceSignalBands,
    footprintRows,
    executionSignals,
    marketSimulation,
    riskMissRatioPct,
    riskHardAlert,
    riskGuardEnabled,
    onToggleRiskGuard,
    maxLossUsd,
    onSetMaxLossUsd,
    targetGainUsd,
    onSetTargetGainUsd,
    riskLossExceeded,
    riskTargetMiss,
    strategyLabel,
    onAutoReduce,
    onAutoClose,
    onDomEntryFromLevel,
    onDomExitFromLevel,
    chartLinkSymbolEnabled,
    onToggleChartLinkSymbol,
    chartLinkTimeframeEnabled,
    onToggleChartLinkTimeframe,
    selectedVenue,
    availableVenues,
    onSelectVenue,
    advancedControlsOpen = false,
    aiHeadline,
    aiScenario,
    aiConfidencePct,
    aiExplanation,
    marketSyncGate,
    flowInsight,
    indicatorSeries: indicatorSeriesProp = [],
    chartEngineMode = "v3",
    gpuViewportGrid = "auto",
    chartSmoothingMs = 140,
    chartTruth = null,
    onChartPerceptualTelemetry,
    onGpuPerceptualTelemetry,
    onGpuViewportFrameMetaChange,
    onSmartDecisionHudChange,
    onAutoTraderV5ObservationChange,
  } = props;

  const analyticsCandlesInput = props.analyticsCandles ?? props.candles;
  const isPreviewMode = Boolean(props.isPreviewMode);
  const suspendDecisionLayer = Boolean(props.suspendDecisionLayer);
  const deferredAnalyticsCandlesInput = useDeferredValue(analyticsCandlesInput);
  const deferredDomLevels = useDeferredValue(domLevels);
  const deferredHeatmapLevels = useDeferredValue(heatmapLevels);
  const effectiveChartSmoothingMs: ChartSmoothingMs = useMemo(
    () => (timeframeToMs(timeframe) <= 5_000 ? 0 : chartSmoothingMs),
    [chartSmoothingMs, timeframe],
  );

  const [intent, setIntent] = useState<V2Intent>("observe");
  const [crosshairText, setCrosshairText] = useState("--");
  const [riskActionLog, setRiskActionLog] = useState<RiskAction[]>([]);
  const [riskJournal, setRiskJournal] = useState<RiskJournalEntry[]>([]);
  const [assistantAnchor, setAssistantAnchor] = useState<{ type: AnchorType; label: string; detail: string } | null>(null);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessages, setAssistantMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [decisionClockMs, setDecisionClockMs] = useState(() => Date.now());
  const lastStableRenderCandlesRef = useRef<CandlePoint[]>([]);
  const lastStableAnalyticsCandlesRef = useRef<CandlePoint[]>([]);
  const decisionStabilityEngineRef = useRef(createDecisionStabilityEngine());

  const handleCrosshairMove = useCallback((payload: { price: number; timeLabel: string; timeKey: string } | null) => {
    if (!payload) {
      setCrosshairText("--");
      return;
    }
    setCrosshairText(`${payload.price.toFixed(2)} @ ${payload.timeLabel}`);
  }, []);

  // ── Prediction V5 + Auto Trader V5 ─────────────────────────────────────────
  const prevAiConfRef = useRef(aiConfidencePct);
  const [autoTraderV5, setAutoTraderV5] = useState<AutoTraderV5State>(INIT_AUTO_TRADER);
  const autoTraderRef  = useRef<AutoTraderV5State>(INIT_AUTO_TRADER);
  autoTraderRef.current = autoTraderV5; // sync stable ref
  const atLastCheckRef = useRef(0);     // throttle: max 1 check / 10s

  // Auto-scroll to bring the V2 shell into viewport on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      const shell = document.querySelector(".terminal-v2-shell");
      if (shell) {
        shell.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDecisionClockMs(Date.now());
    }, 350);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const stable = ensureVisibleCandles(candles, fallbackPrice);
    const previous = lastStableRenderCandlesRef.current;
    const previousLen = previous.length;
    const nextLen = stable.length;
    if (nextLen >= MIN_RENDER_CANDLES || nextLen > previousLen) {
      lastStableRenderCandlesRef.current = stable;
    }
  }, [candles, fallbackPrice]);

  useEffect(() => {
    const stable = ensureVisibleCandles(deferredAnalyticsCandlesInput, fallbackPrice);
    const previous = lastStableAnalyticsCandlesRef.current;
    const previousLen = previous.length;
    const nextLen = stable.length;
    if (nextLen >= MIN_RENDER_CANDLES || nextLen > previousLen) {
      lastStableAnalyticsCandlesRef.current = stable;
    }
  }, [deferredAnalyticsCandlesInput, fallbackPrice]);

  const safeRenderCandles = useMemo(() => {
    const stable = ensureVisibleCandles(candles, fallbackPrice);
    if (stable.length >= MIN_RENDER_CANDLES) {
      return stable;
    }
    const previous = lastStableRenderCandlesRef.current;
    if (previous.length > stable.length) {
      return previous;
    }
    return stable;
  }, [candles, fallbackPrice]);
  const safeAnalyticsCandles = useMemo(() => {
    const stable = ensureVisibleCandles(deferredAnalyticsCandlesInput, fallbackPrice);
    if (stable.length >= MIN_RENDER_CANDLES) {
      return stable;
    }
    const previous = lastStableAnalyticsCandlesRef.current;
    if (!isPreviewMode && previous.length > stable.length) {
      return previous;
    }
    return stable;
  }, [deferredAnalyticsCandlesInput, fallbackPrice, isPreviewMode]);
  const flatCandleNotice = useMemo(() => resolveFlatCandleNotice(safeRenderCandles, timeframe), [safeRenderCandles, timeframe]);
  const analyticsEligibleCandles = suspendDecisionLayer ? [] : safeAnalyticsCandles;
  const analyticsReady = analyticsEligibleCandles.length >= MIN_RENDER_CANDLES;
  const structureSourceCandles = useMemo(
    () => (analyticsReady ? analyticsEligibleCandles : suspendDecisionLayer ? [] : safeRenderCandles),
    [analyticsEligibleCandles, analyticsReady, safeRenderCandles, suspendDecisionLayer],
  );
  const structureSnapshot = useMemo(
    () => detectStructure(structureSourceCandles),
    [structureSourceCandles],
  );
  const liquiditySnapshot = useMemo(
    () => detectLiquidity(structureSourceCandles, structureSnapshot),
    [structureSnapshot, structureSourceCandles],
  );
  const structureOverlayZones = useMemo(
    () => buildStructureOverlayZones(structureSnapshot),
    [structureSnapshot],
  );
  const liquidityOverlayZones = useMemo(
    () => buildLiquidityOverlayZones(liquiditySnapshot),
    [liquiditySnapshot],
  );
  const regimeSnapshot = useMemo(
    () => buildRegimeSnapshot(structureSourceCandles),
    [structureSourceCandles],
  );
  const effectiveRouteScore = deriveRouteScorePct(routeScorePct, depthState);
  const simulationTone = useMemo(() => {
    if (!marketSimulation) {
      return "neutral";
    }
    if (marketSimulation.stateLabel === "chaos") {
      return "warn";
    }
    if (marketSimulation.decision.shouldExecute) {
      return "good";
    }
    return "neutral";
  }, [marketSimulation]);

  const rankedRoutes = useMemo(() => {
    return [...routingCandidates]
      .filter((item) => Number.isFinite(item.spread) && item.spread < Number.MAX_SAFE_INTEGER)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6);
  }, [routingCandidates]);

  const domStats = useMemo(() => {
    const bids = deferredDomLevels.filter((level) => level.side === "bid");
    const asks = deferredDomLevels.filter((level) => level.side === "ask");
    const bidVol = bids.reduce((sum, level) => sum + Math.max(0, level.size), 0);
    const askVol = asks.reduce((sum, level) => sum + Math.max(0, level.size), 0);
    const total = Math.max(0.0000001, bidVol + askVol);
    const imbalance = (bidVol - askVol) / total;
    const avgSize = deferredDomLevels.length > 0
      ? deferredDomLevels.reduce((sum, level) => sum + Math.max(0, level.size), 0) / deferredDomLevels.length
      : 0;
    const spoofCount = deferredDomLevels.filter((level) => level.intensity > 0.9 && level.size > avgSize * 2.2).length;
    const icebergCount = deferredDomLevels.filter((level) => level.intensity >= 0.45 && level.intensity <= 0.8 && level.size > avgSize * 1.25).length;
    return { bids, asks, imbalance, spoofCount, icebergCount };
  }, [deferredDomLevels]);

  const dominantDomLevelKeys = useMemo(() => {
    return new Set(
      [...deferredDomLevels]
        .sort((left, right) => (right.size * Math.max(0.2, right.intensity)) - (left.size * Math.max(0.2, left.intensity)))
        .slice(0, 3)
        .map((level) => `${level.side}:${level.price.toFixed(4)}`),
    );
  }, [deferredDomLevels]);

  const heatmapTop = useMemo(() => {
    return [...deferredHeatmapLevels]
      .sort((left, right) => (right.intensity * 0.58 + Math.log1p(Math.max(0, right.size)) * 0.42) - (left.intensity * 0.58 + Math.log1p(Math.max(0, left.size)) * 0.42))
      .slice(0, 8);
  }, [deferredHeatmapLevels]);

  const dominantHeatmapKeys = useMemo(() => {
    return new Set(
      heatmapTop
        .slice(0, 3)
        .map((level) => `${level.side}:${level.price.toFixed(4)}`),
    );
  }, [heatmapTop]);

  // ── Prediction Engine V5 ────────────────────────────────────────────────────
  const predictionV5 = useMemo((): PredictionV5 => {
    return computePredictionV5(
      analyticsEligibleCandles,
      deferredDomLevels,
      deferredHeatmapLevels,
      aiConfidencePct,
      prevAiConfRef.current,
    );
  }, [analyticsEligibleCandles, deferredDomLevels, deferredHeatmapLevels, aiConfidencePct]);

  useEffect(() => {
    prevAiConfRef.current = aiConfidencePct;
  }, [aiConfidencePct]);
  // Hiérarchie émotionnelle V5 : 3 niveaux
  const urgencyTier: "low" | "medium" | "high" = useMemo(() => {
    if (predictionV5.probability >= 70 && predictionV5.timing !== "weak") return "high";
    if (predictionV5.probability >= 45) return "medium";
    return "low";
  }, [predictionV5.probability, predictionV5.timing]);

  const urgencyLabel = useMemo(() => {
    if (urgencyTier === "high") {
      return predictionV5.direction === "LONG"  ? "⚡ LONG NOW"
           : predictionV5.direction === "SHORT" ? "⚡ SHORT NOW"
           : "⏳ WAIT";
    }
    if (urgencyTier === "medium") {
      return predictionV5.direction === "LONG"  ? "POTENTIAL LONG"
           : predictionV5.direction === "SHORT" ? "POTENTIAL SHORT"
           : "NEUTRAL";
    }
    return "WAIT";
  }, [urgencyTier, predictionV5.direction]);
  const recentCandleAnchors = useMemo(() => {
    return analyticsEligibleCandles.slice(-6).map((candle) => ({
      type: "candle" as const,
      label: candle.label.slice(11, 16),
      detail: `O:${candle.open.toFixed(2)} H:${candle.high.toFixed(2)} L:${candle.low.toFixed(2)} C:${candle.close.toFixed(2)}`,
    }));
  }, [analyticsEligibleCandles]);

  const decisionLatencyMs = useMemo(() => {
    const lastLabel = structureSourceCandles[structureSourceCandles.length - 1]?.label;
    const lastTimestamp = lastLabel ? parseHistoryLabelMs(lastLabel) : null;
    if (!lastTimestamp) {
      return null;
    }
    return Math.max(0, Date.now() - lastTimestamp);
  }, [structureSourceCandles]);
  const smartDecision = useMemo(() => resolveSmartDecision({
    regime: regimeSnapshot,
    structure: structureSnapshot,
    liquidity: liquiditySnapshot,
    predictionDirection: predictionV5.direction,
    predictionProbability: predictionV5.probability,
    predictionTrigger: predictionV5.trigger,
    predictionInvalidation: predictionV5.invalidation,
    lowFlowEdgeBlocked,
    routeScorePct: effectiveRouteScore,
    domImbalance: domStats.imbalance,
    decisionLatencyMs,
    suspended: suspendDecisionLayer || !analyticsReady,
    suspendedReason: suspendDecisionLayer || !analyticsReady
      ? suspendDecisionLayer
        ? "Flux canonique degrade: decision suspendue jusqu'au retour d'un flux affichable"
        : "Mode apercu: decision suspendue"
      : null,
    externalGate: marketSyncGate ? {
      state: marketSyncGate.state,
      reason: marketSyncGate.detailLabel,
    } : null,
  }), [analyticsReady, decisionLatencyMs, domStats.imbalance, effectiveRouteScore, liquiditySnapshot, lowFlowEdgeBlocked, marketSyncGate, predictionV5.direction, predictionV5.invalidation, predictionV5.probability, predictionV5.trigger, regimeSnapshot, structureSnapshot, suspendDecisionLayer]);
  const stableSmartDecision = useMemo(
    () => applyDecisionStability(smartDecision, decisionStabilityEngineRef.current.update(smartDecision.state, decisionClockMs)),
    [decisionClockMs, smartDecision],
  );
  const smartDecisionHud = useMemo(() => buildSmartDecisionHud(stableSmartDecision), [stableSmartDecision]);

  useEffect(() => {
    if (onSmartDecisionHudChange) {
      onSmartDecisionHudChange(smartDecisionHud);
    }
  }, [onSmartDecisionHudChange, smartDecisionHud]);

  const assistantContext = useMemo(() => {
    const base = `${smartDecisionHud.assistantSummary} ${aiExplanation} | desequilibre DOM ${(domStats.imbalance * 100).toFixed(1)}%, route ${routeVenue || "--"}, confiance ${aiConfidencePct.toFixed(0)}%.`;
    if (!assistantAnchor) {
      return base;
    }
    return `${base} Repere ${assistantAnchor.type}: ${assistantAnchor.label} (${assistantAnchor.detail}).`;
  }, [aiConfidencePct, aiExplanation, assistantAnchor, domStats.imbalance, routeVenue, smartDecisionHud.assistantSummary]);

  // ── Auto Trader V5 — machine d'état ────────────────────────────────────────
  const updateAT = useCallback((updater: (s: AutoTraderV5State) => AutoTraderV5State) => {
    setAutoTraderV5(prev => {
      const next = updater(prev);
      autoTraderRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!onAutoTraderV5ObservationChange) {
      return;
    }
    const blockedReasons: string[] = [];
    if (isPreviewMode) {
      blockedReasons.push("preview_mode");
    }
    if (suspendDecisionLayer) {
      blockedReasons.push("feed_degraded");
    }
    if (!analyticsReady) {
      blockedReasons.push("canonical_feed_required");
    }
    if (autoTraderV5.mode === "paused") {
      blockedReasons.push("drawdown_pause");
    }
    if ((autoTraderV5.lastAction || "").toLowerCase().includes("feed degrade")) {
      blockedReasons.push("feed_degraded");
    }
    onAutoTraderV5ObservationChange({
      enabled: autoTraderV5.enabled,
      mode: autoTraderV5.mode,
      drawdownPaused: autoTraderV5.mode === "paused",
      blockedReasons,
      currentDrawdownPct: autoTraderV5.currentDrawdownPct,
      lastAction: autoTraderV5.lastAction,
    });
  }, [analyticsReady, autoTraderV5, isPreviewMode, onAutoTraderV5ObservationChange, suspendDecisionLayer]);

  // Mémoire de perte : réduit la confiance effective pour les 2 prochains trades
  const lossMemoryRef = useRef(0);

  useEffect(() => {
    const now = Date.now();
    if (now - atLastCheckRef.current < 10_000) return;
    atLastCheckRef.current = now;

    const at = autoTraderRef.current;
    if (!at.enabled || at.mode === "paused") return;
    if (!analyticsReady) {
      if (at.mode !== "standby") {
        updateAT((state) => ({ ...state, mode: "standby", lastAction: "Preview / feed degrade — execution logic paused" }));
      }
      return;
    }

    const lastCandle = analyticsEligibleCandles[analyticsEligibleCandles.length - 1];
    if (!lastCandle) return;
    const price = lastCandle.close;
    const pred  = predictionV5;
    const atr   = analyticsEligibleCandles.slice(-20).reduce((s, c) => s + (c.high - c.low), 0)
                  / Math.max(1, Math.min(20, analyticsEligibleCandles.length));

    // standby → watching
    if (at.mode === "standby") {
      updateAT(s => ({ ...s, mode: "watching", lastAction: "⏳ Scanning market…" }));
      return;
    }

    // ── En position : gestion de sortie ───────────────────────────────────────
    if (at.mode === "in-trade" && at.position) {
      const pos = at.position;
      const pnlPct = pos.side === "long"
        ? (price - pos.entryPrice) / pos.entryPrice * 100
        : (pos.entryPrice - price) / pos.entryPrice * 100;

      // Trailing stop adaptatif
      const trailDist  = pred.confluenceCount >= 3 ? atr * 1.8 : atr * 1.2;
      const newStop    = pos.side === "long"
        ? Math.max(pos.trailingStop, price - trailDist)
        : Math.min(pos.trailingStop, price + trailDist);

      // Partial close : exhaustion + profit > 0.15%
      if (!pos.partialClosed && pred.signal === "EXHAUSTION" && pnlPct > 0.15) {
        const partialPnl = (pnlPct / 100) * pos.size * 0.5;
        updateAT(s => {
          if (!s.position) return s;
          return {
            ...s,
            pnlUsd: s.pnlUsd + partialPnl,
            position: { ...s.position, partialClosed: true, size: s.position.size * 0.5, trailingStop: newStop },
            lastAction: `⚡ PARTIAL CLOSE 50% @ ${price.toFixed(2)} | +${partialPnl.toFixed(2)}$`,
          };
        });
        return;
      }

      // Conditions de sortie totale
      const stopHit      = pos.side === "long" ? price <= newStop : price >= newStop;
      const invalHit     = pos.invalidation !== null && (pos.side === "long" ? price <= pos.invalidation : price >= pos.invalidation);
      const signalFlip   = pred.direction !== "WAIT" && pred.direction !== (pos.side === "long" ? "LONG" : "SHORT") && pred.confluenceCount >= 3;

      if (stopHit || invalHit || signalFlip) {
        const finalPnl = (pnlPct / 100) * pos.size;
        const isWin    = finalPnl > 0;
        const reason   = stopHit ? "trailing stop" : invalHit ? "invalidation" : "signal flip";
        // Régulation comportementale : malus de confiance après perte
        if (!isWin) lossMemoryRef.current = 2;
        else if (lossMemoryRef.current > 0) lossMemoryRef.current -= 1;
        updateAT(s => ({
          ...s,
          mode: "watching",
          position: null,
          totalTrades: s.totalTrades + 1,
          wins: s.wins + (isWin ? 1 : 0),
          pnlUsd: s.pnlUsd + finalPnl,
          currentDrawdownPct: isWin ? Math.max(0, s.currentDrawdownPct - 0.5) : s.currentDrawdownPct + Math.abs(pnlPct) * 0.5,
          lastAction: `${isWin ? "✓" : "✗"} EXIT [${reason}] @ ${price.toFixed(2)} ${finalPnl >= 0 ? "+" : ""}${finalPnl.toFixed(2)}$`,
        }));
        return;
      }

      // Mise à jour stop
      if (newStop !== pos.trailingStop) {
        updateAT(s => ({
          ...s,
          position: s.position ? { ...s.position, trailingStop: newStop } : null,
        }));
      }
      return;
    }

    // ── Watching → Entry ────────────────────────────────────────────────────────
    if (at.mode === "watching" && !at.position) {
      const effectiveProb = lossMemoryRef.current > 0 ? pred.probability - 10 : pred.probability;
      if (effectiveProb > 70 && pred.direction !== "WAIT" && pred.timing !== "weak") {
        // Safety : drawdown max
        if (at.currentDrawdownPct > 10) {
          updateAT(s => ({ ...s, mode: "paused", lastAction: "⛔ Drawdown max — pause" }));
          return;
        }
        const side      = pred.direction === "LONG" ? "long" : "short";
        const volRatio  = Math.max(0.5, Math.min(2.5, atr / Math.max(1e-9, price) * 1000));
        const baseSize  = Math.min(maxLossUsd * 0.25, 200);
        const size      = Math.max(10, Math.round((baseSize * (pred.probability / 100) / volRatio) * 100) / 100);
        const trailDist = atr * 1.5;
        updateAT(s => ({
          ...s,
          mode: "in-trade",
          position: {
            side,
            entryPrice: price,
            size,
            trailingStop: side === "long" ? price - trailDist : price + trailDist,
            partialClosed: false,
            entryTs: new Date().toISOString(),
            invalidation: pred.invalidation,
          },
          lastAction: `⚡ ENTER ${side.toUpperCase()} @ ${price.toFixed(2)} | ${size.toFixed(0)}$ | conf ${pred.probability.toFixed(0)}%`,
        }));
      }
    }
  }, [analyticsEligibleCandles, analyticsReady, predictionV5, maxLossUsd, updateAT]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const query = new URLSearchParams();
      query.set("symbol", symbol);
      query.set("timeframe", timeframe);
      query.set("strategy", strategyLabel);
      query.set("limit", "40");
      const response = await fetch(`/api/terminal/v2-risk-journal?${query.toString()}`, { cache: "no-store" }).catch(() => null);
      const payload = response ? await response.json().catch(() => null) : null;
      if (!cancelled && payload && Array.isArray(payload.entries)) {
        setRiskJournal(payload.entries as RiskJournalEntry[]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [strategyLabel, symbol, timeframe]);

  const appendRiskAction = async (action: string, detail: string, meta?: Record<string, unknown>) => {
    const nowIso = new Date().toISOString();
    setRiskActionLog((current) => [
      { ts: nowIso, action, detail },
      ...current,
    ].slice(0, 14));

    const response = await fetch("/api/terminal/v2-risk-journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        timeframe,
        strategy: strategyLabel,
        action,
        detail,
        meta: meta || {},
      }),
    }).catch(() => null);

    const payload = response ? await response.json().catch(() => null) : null;
    if (payload?.entry) {
      setRiskJournal((current) => [payload.entry as RiskJournalEntry, ...current].slice(0, 40));
    }
  };

  const askAssistant = () => {
    const prompt = assistantInput.trim();
    if (!prompt) {
      return;
    }
    const response = `Lecture causale: ${assistantContext} Demande: ${prompt}. Scenario de base ${aiScenario}. Posture suggeree: ${riskHardAlert ? "risque reduit, exposition a baisser" : "execution controlee"}.`;
    setAssistantMessages((current) => [
      ...current,
      { role: "user" as const, text: prompt },
      { role: "assistant" as const, text: response },
    ].slice(-10));
    setAssistantInput("");
  };

  return (
    <div className="terminal-v2-shell">
      {/* ─── ROW 1: Context Toolbar (adaptive) ─── */}
      <div className="terminal-v2-head">
        <div className="terminal-v2-brand">
          <span className="terminal-v2-kicker">TXT</span>
          <strong>{symbol} {timeframe}</strong>
          <span className="terminal-v2-crosshair">{crosshairText}</span>
        </div>
        {advancedControlsOpen ? <div className="terminal-v2-head-actions">
          <button type="button" className={`chart-chip ${enabled ? "active" : ""}`} onClick={onToggleEnabled}>V2</button>
          <span className="chart-chip active">Assistance</span>
        </div> : null}
      </div>

      <div className="terminal-v2-toolbar" role="group" aria-label="Barre chart adaptative">
        <button type="button" className={`chart-chip ${intent === "observe" ? "active" : ""}`} onClick={() => setIntent("observe")}>Observer</button>
        <button type="button" className={`chart-chip ${intent === "analyze" ? "active" : ""}`} onClick={() => setIntent("analyze")}>Analyser</button>
        <button type="button" className={`chart-chip ${intent === "execute" ? "active" : ""}`} onClick={() => setIntent("execute")}>Executer</button>

        {intent === "execute" ? (
          <>
            <span className="terminal-v2-sep" />
            <button type="button" className={`chart-chip ${autoExecutionMode === "assisted" ? "active" : ""}`} onClick={() => onAutoExecutionModeChange("assisted")}>Humain</button>
            <button type="button" className={`chart-chip ${autoExecutionMode === "semi-auto" ? "active" : ""}`} onClick={() => onAutoExecutionModeChange("semi-auto")}>Hybride</button>
            <button type="button" className={`chart-chip ${autoExecutionMode === "full-auto" ? "active" : ""}`} onClick={() => onAutoExecutionModeChange("full-auto")}>AI</button>
          </>
        ) : null}

        <span className="terminal-v2-sep" />
        <span className="chart-chip active">{deskModeLabel}</span>
        {advancedControlsOpen ? <span className="chart-chip active">Bars {effectiveBarMode.toUpperCase()}</span> : null}
        {lowFlowEdgeBlocked ? <span className="chart-chip chart-chip-warn">Flux trop faible</span> : null}
        {advancedControlsOpen ? <span className="terminal-v2-intent-label">{lowFlowEdgeBlocked ? `${flowConfidenceLabel} · execution bloquee` : intent === "observe" ? "lecture du marche" : intent === "analyze" ? "analyse structure" : "mode execution"}</span> : null}
      </div>
      {chartTruth ? (
        <div className="terminal-v2-truth-strip" aria-live="polite">
          <span className="terminal-v2-truth-pill terminal-v2-truth-pill-source">{chartTruth.sourceLabel}</span>
          <span className="terminal-v2-truth-pill">{chartTruth.modeLabel}</span>
          {chartTruth.truthStatusLabel ? (
            <span
              className={`terminal-v2-truth-pill terminal-v2-truth-pill-${chartTruth.truthStatusTone || "neutral"}`}
              title={chartTruth.truthStatusReasonLabel || undefined}
            >
              {chartTruth.truthStatusLabel}
            </span>
          ) : null}
          <span className="terminal-v2-truth-pill">{chartTruth.clockLabel}</span>
          <span className={`terminal-v2-truth-pill terminal-v2-truth-pill-${chartTruth.feedStatusTone}`}>{chartTruth.feedStatusLabel}</span>
          <span className={`terminal-v2-truth-pill terminal-v2-truth-pill-${chartTruth.exchangeStatusTone}${chartTruth.exchangeStatusEmphasis === "secondary" ? " terminal-v2-truth-pill-secondary" : ""}`}>{chartTruth.exchangeStatusLabel}</span>
          <span className={`terminal-v2-truth-pill terminal-v2-truth-pill-${chartTruth.lagTone}`}>{chartTruth.lagLabel}</span>
          <span className="terminal-v2-truth-pill">{chartTruth.freshnessLabel}</span>
          <span className="terminal-v2-truth-pill">{chartTruth.routeLabel}</span>
        </div>
      ) : null}

      {/* ─── ROW 2: CHART CORE + AI HUD ─── */}
      <div className={`terminal-v2-core${hasSidecar ? " has-sidecar" : ""}`}>
        <div className={`terminal-v2-chart-col${aiConfidencePct >= 70 ? " chart-focus-mode" : ""}${lowFlowEdgeBlocked ? " is-flow-confidence-low" : ""}`}>
          {loading ? <div className="chart-loader">Changement de symbole...</div> : null}
          {chartEngineMode === "v4" ? (
            <GpuChartV4Surface
              className="chart-stage-premium terminal-v2-chart"
              symbol={symbol}
              timeframe={timeframe}
              mode={renderMode}
              chartMotionPreset="balanced"
              visualMode="clean"
              liveFeedKey={liveFeedKey}
              candles={safeRenderCandles}
              overlayZones={structureOverlayZones}
              liquidityZones={liquidityOverlayZones}
              domLevels={domLevels}
              heatmapLevels={heatmapLevels}
              domHistory={domHistory}
              tradeBubbles={tradeBubbles}
              priceSignalBands={priceSignalBands}
              footprintRows={footprintRows}
              executionSignals={analyticsReady ? executionSignals : undefined}
              dayVwap={0}
              weekVwap={0}
              monthVwap={0}
              indicatorSeries={indicatorSeriesProp as any}
              showSessions={false}
              candleTransform="none"
              engineMode="v4"
              showDiagnostics={advancedControlsOpen}
              viewportGrid={gpuViewportGrid}
              viewportWindowHint={chartWindow}
              smoothingMs={effectiveChartSmoothingMs}
              multiSymbolFeeds={[]}
              onCrosshairMove={handleCrosshairMove}
              onPerceptualTelemetry={onGpuPerceptualTelemetry}
              onViewportFrameMetaChange={onGpuViewportFrameMetaChange}
            />
          ) : (
            <InstitutionalChart
              className="chart-stage-premium terminal-v2-chart"
              symbol={symbol}
              timeframe={timeframe}
              mode={renderMode}
              chartMotionPreset="balanced"
              visualMode="clean"
              liveFeedKey={liveFeedKey}
              candles={safeRenderCandles}
              overlayZones={structureOverlayZones}
              liquidityZones={liquidityOverlayZones}
              domLevels={domLevels}
              heatmapLevels={heatmapLevels}
              domHistory={domHistory}
              tradeBubbles={tradeBubbles}
              priceSignalBands={priceSignalBands}
              footprintRows={footprintRows}
              executionSignals={analyticsReady ? executionSignals : undefined}
              marketSimulation={analyticsReady ? marketSimulation : null}
              dayVwap={0}
              weekVwap={0}
              monthVwap={0}
              indicatorSeries={indicatorSeriesProp as any}
              showSessions={false}
              candleTransform="none"
              onCrosshairMove={handleCrosshairMove}
              onPerceptualTelemetry={analyticsReady ? onChartPerceptualTelemetry : undefined}
            />
          )}
          {flatCandleNotice ? <div className="terminal-v2-alert terminal-v2-chart-alert">{flatCandleNotice}</div> : null}
        </div>

        <aside className="terminal-v2-ai-hud" aria-label="AI perception HUD">
          <div className="terminal-v2-card terminal-v2-card-decision" data-testid="terminal-v2-decision-state">
            <span className="terminal-v2-card-kicker">Moteur decision V2</span>
            <SmartDecisionSummary decision={smartDecisionHud} variant="hero" />
            {marketSyncGate && marketSyncGate.state !== "VALID" ? (
              <div className="terminal-v2-alert">{marketSyncGate.summaryLabel} · {marketSyncGate.temporalSummaryLabel} · {marketSyncGate.desyncSummaryLabel} · {marketSyncGate.intentSummaryLabel}</div>
            ) : null}
          </div>

          {/* ── PERCEPTION ENGINE V5 — prédictif ── */}
          <div className={`terminal-v2-card terminal-v2-card-perception${
            predictionV5.probability >= 70 ? " perception-focus" : ""
          }`}>
            <span className="terminal-v2-card-kicker">Perception V5</span>
            {isPreviewMode || suspendDecisionLayer || !analyticsReady ? (
              <div className="terminal-v2-meta" style={{ marginBottom: 8 }}>
                {isPreviewMode
                  ? "Mode apercu: perception et execution suspendues."
                  : suspendDecisionLayer
                    ? "Feed canonique degrade: chart visible, mais perception et execution restent suspendues."
                    : "Flux canonique requis: perception et execution suspendues."}
              </div>
            ) : null}

            {/* direction + probabilité + drift */}
            <div className="perception-direction">
              <span className={`perception-dir-badge ${
                predictionV5.direction === "LONG" ? "long" :
                predictionV5.direction === "SHORT" ? "short" : "wait"
              } urgency-${urgencyTier}`}>{urgencyLabel}</span>
              <span className="perception-conf">{predictionV5.probability.toFixed(0)}%</span>
              <span className="perception-arrow">
                {predictionV5.confidenceDrift === "rising"  ? "↑↑" :
                 predictionV5.confidenceDrift === "falling" ? "↓"  : "→"}
              </span>
            </div>

            {/* signal + timing */}
            <div className="perception-scenario">
              {predictionV5.signal !== "NONE" ? predictionV5.signal : (aiScenario || "—")}
            </div>

            {predictionV5.timing === "imminent" && (
              <div className="perception-imminent">Mouvement possible</div>
            )}

            {/* trigger + invalidation */}
            {predictionV5.trigger !== null && (
              <div className="perception-levels">
                <div className="perception-level">
                  <span className="perception-label">TRIGGER</span>
                  <span className="perception-value">→ {predictionV5.trigger.toFixed(2)}</span>
                </div>
                {predictionV5.invalidation !== null && (
                  <div className="perception-level">
                    <span className="perception-label">STOP</span>
                    <span className="perception-value warn">✗ {predictionV5.invalidation.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            {/* confluence dots */}
            {predictionV5.confluenceCount > 0 && (
              <div className="perception-confluence">
                {[0, 1, 2, 3, 4].slice(0, 5).map(i => (
                  <span key={i} className={`conf-dot${i < predictionV5.confluenceCount ? " active" : ""}`} />
                ))}
                <span className="perception-label">{predictionV5.confluenceCount}/5</span>
              </div>
            )}

            {/* focus mode */}
            {predictionV5.probability >= 70 && predictionV5.timing !== "weak" && (
              <div className="perception-focus-badge">Mode focus</div>
            )}
          </div>
          <div className="terminal-v2-card terminal-v2-card-ai">
            <span className="terminal-v2-card-kicker">Simulation V6</span>
            <strong className={simulationTone}>{marketSimulation ? marketSimulation.stateLabel.replace(/_/g, " ") : "standby"}</strong>
            <span className="terminal-v2-meta">
              {marketSimulation
                ? `${marketSimulation.decision.shouldExecute ? "executer" : "attendre"} · conf ${(marketSimulation.confidence * 100).toFixed(0)}%`
                : "en attente du marche"}
            </span>
            <span className="terminal-v2-meta">
              {marketSimulation
                ? `fill ${(marketSimulation.execution.fillProb * 100).toFixed(0)}% · slip ${marketSimulation.execution.slippage.toFixed(1)}bps · lat ${marketSimulation.execution.latency.toFixed(0)}ms`
                : "pas d'apercu execution"}
            </span>
            {flowInsight ? (
              <div className={`terminal-v2-flow-chip ${flowInsight.dominantSide}`}>
                <strong>Flux</strong>
                <span>{flowInsight.label}</span>
                <span>{(flowInsight.score * 100).toFixed(0)}% · bias {(Math.abs(flowInsight.liquidityBias) * 100).toFixed(0)}%</span>
              </div>
            ) : null}
            {lowFlowEdgeBlocked ? <div className="terminal-v2-alert">Flux trop faible · execution bloquee</div> : null}
            <p className="terminal-v2-ai-copy">
              {marketSimulation
                ? `100ms ${marketSimulation.t100ms.price.toFixed(2)} · 250ms ${marketSimulation.t250ms.price.toFixed(2)} · 500ms ${marketSimulation.t500ms.price.toFixed(2)} · cone ${marketSimulation.cone.best.toFixed(2)} / ${marketSimulation.cone.expected.toFixed(2)} / ${marketSimulation.cone.worst.toFixed(2)}`
                : "Le moteur V6 projette le flow observé sur 100/250/500ms avant décision exécutable."}
            </p>
          </div>
          <div className="terminal-v2-card terminal-v2-card-ai">
            <span className="terminal-v2-card-kicker">IA contextuelle</span>
            <strong>{aiHeadline}</strong>
            <span className="terminal-v2-meta">{smartDecisionHud.displayStateLabel} · {smartDecisionHud.confidenceBand} · {aiScenario}</span>
            <span className="terminal-v2-meta">confiance {aiConfidencePct.toFixed(0)}% · regime {regimeSnapshot.state}</span>
            {marketSyncGate ? <span className="terminal-v2-meta">{marketSyncGate.summaryLabel} · {marketSyncGate.attentionSummaryLabel} · {marketSyncGate.intentSummaryLabel} · {marketSyncGate.executionSummaryLabel}</span> : null}
            <p className="terminal-v2-ai-copy">{assistantContext}</p>
            <div className="terminal-v2-chat-row">
              <input
                value={assistantInput}
                onChange={(event) => setAssistantInput(event.target.value)}
                placeholder="Demander a l'IA le contexte marche..."
                onKeyDown={(event) => { if (event.key === "Enter") askAssistant(); }}
              />
              <button type="button" className="chart-chip" onClick={askAssistant}>Envoyer</button>
            </div>
            <div className="terminal-v2-chat-log">
              {assistantMessages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`terminal-v2-chat-msg ${message.role}`}>
                  <strong>{message.role === "assistant" ? "IA" : "Toi"}</strong>
                  <span>{message.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="terminal-v2-card terminal-v2-card-anchors">
            <span className="terminal-v2-card-kicker">Reperes</span>
            <div className="terminal-v2-anchor-chips">
              {recentCandleAnchors.map((anchor) => (
                <button key={`cand-${anchor.label}`} type="button" className="chart-chip" onClick={() => setAssistantAnchor(anchor)}>{anchor.label}</button>
              ))}
              {heatmapTop.slice(0, 4).map((level, index) => (
                <button
                  key={`zone-${index}`}
                  type="button"
                  className="chart-chip"
                  onClick={() => setAssistantAnchor({ type: "zone", label: `${level.price.toFixed(1)}`, detail: `${level.side} intensity ${(level.intensity * 100).toFixed(0)}%` })}
                >Z {level.price.toFixed(0)}</button>
              ))}
            </div>
          </div>

          <div className="terminal-v2-card terminal-v2-card-sync">
            <span className="terminal-v2-card-kicker">Lien chart</span>
            <div className="terminal-v2-inline-actions">
              <button type="button" className={`chart-chip ${chartLinkSymbolEnabled ? "active" : ""}`} onClick={onToggleChartLinkSymbol}>Sym</button>
              <button type="button" className={`chart-chip ${chartLinkTimeframeEnabled ? "active" : ""}`} onClick={onToggleChartLinkTimeframe}>TF</button>
            </div>
          </div>
        </aside>
        {sidecarStack}
      </div>

      {/* ─── ROW 3: EXECUTION / DOM / ACTION ─── */}
      <div className="terminal-v2-execution-strip">
        <div className="terminal-v2-exec-card">
          <span className="terminal-v2-card-kicker">Routage</span>
          <div className="terminal-v2-exec-head">
            <strong>{routeVenue || "--"}</strong>
            <div className="terminal-v2-meter"><div className="terminal-v2-meter-fill" style={{ width: `${effectiveRouteScore.toFixed(0)}%` }} /></div>
            <span className="terminal-v2-meta">score {effectiveRouteScore.toFixed(0)}%</span>
          </div>
          <div className="terminal-v2-table">
            {rankedRoutes.slice(0, 3).map((route) => (
              <div key={`${route.venue}-${route.instrument}`} className="terminal-v2-row">
                <span>{route.venue}</span>
                <span>{route.spread.toFixed(2)}</span>
                <span>{route.score.toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="terminal-v2-exec-card">
          <span className="terminal-v2-card-kicker">Risque</span>
          <div className="terminal-v2-exec-head">
            <strong className={riskHardAlert ? "warn" : "good"}>{riskHardAlert ? "ALERT" : "OK"}</strong>
            <span className="terminal-v2-meta">miss {riskMissRatioPct.toFixed(1)}%</span>
          </div>
          <div className="terminal-v2-inline-actions">
            <button type="button" className={`chart-chip ${riskGuardEnabled ? "active" : ""}`} onClick={onToggleRiskGuard}>Garde</button>
            <label className="terminal-v2-input-chip">Perte<input type="number" value={maxLossUsd} onChange={(event) => onSetMaxLossUsd(Math.max(10, Number(event.target.value || 0)))} /></label>
            <label className="terminal-v2-input-chip">Target<input type="number" value={targetGainUsd} onChange={(event) => onSetTargetGainUsd(Math.max(10, Number(event.target.value || 0)))} /></label>
          </div>
          <div className="terminal-v2-inline-actions">
            <button type="button" className="chart-chip" disabled={lowFlowEdgeBlocked} onClick={() => { onAutoReduce(); void appendRiskAction("auto-reduce", "Reduction par garde-risque", { ratioMiss: riskMissRatioPct }); }}>Reduire</button>
            <button type="button" className="chart-chip chart-sell-btn" disabled={lowFlowEdgeBlocked} onClick={() => { onAutoClose(); void appendRiskAction("auto-close", "Fermeture et kill-switch armes", { ratioMiss: riskMissRatioPct }); }}>Fermer</button>
          </div>
          {lowFlowEdgeBlocked ? <span className="terminal-v2-alert">Flux trop faible</span> : null}
          {riskLossExceeded ? <span className="terminal-v2-alert">Perte depassee</span> : null}
          {riskTargetMiss ? <span className="terminal-v2-alert">Objectif manque</span> : null}
        </div>

        <div className="terminal-v2-exec-card terminal-v2-exec-card-dom">
          <span className="terminal-v2-card-kicker">DOM</span>
          <div className="terminal-v2-exec-head">
            <strong className={depthState === "live" ? "good" : "warn"}>{depthState.toUpperCase()}</strong>
            <span className="terminal-v2-meta">imb {(domStats.imbalance * 100).toFixed(1)}%</span>
            <span className="terminal-v2-meta">sp {domStats.spoofCount} ic {domStats.icebergCount}</span>
          </div>
          <div className="terminal-v2-ladder">
            {[...domStats.asks.slice(0, 4), ...domStats.bids.slice(0, 4)]
              .sort((left, right) => right.price - left.price)
              .map((level, index) => {
                const key = `${level.side}:${level.price.toFixed(4)}`;
                return (
                <div key={`${level.side}-${level.price}-${index}`} className={`terminal-v2-ladder-row ${level.side} ${dominantDomLevelKeys.has(key) ? "dominant" : ""}`}>
                  <span>{level.price.toFixed(2)}</span>
                  <span>{level.size.toFixed(0)}</span>
                  <span>{(level.intensity * 100).toFixed(0)}%</span>
                  <button type="button" className="chart-chip" onClick={() => onDomEntryFromLevel(level.price, level.side)}>E</button>
                  <button type="button" className="chart-chip" onClick={() => onDomExitFromLevel(level.price, level.side)}>X</button>
                </div>
              );})}
          </div>
        </div>

        <div className="terminal-v2-exec-card terminal-v2-exec-card-heatmap">
          <span className="terminal-v2-card-kicker">Heatmap</span>
          <div className="terminal-v2-heatmap">
            {heatmapTop.slice(0, 6).map((level, index) => {
              const key = `${level.side}:${level.price.toFixed(4)}`;
              return (
              <div key={`${level.side}-${level.price}-${index}`} className={`terminal-v2-heatmap-row ${dominantHeatmapKeys.has(key) ? "dominant" : ""}`}>
                <span>{level.price.toFixed(1)}</span>
                <div className="terminal-v2-meter"><div className="terminal-v2-meter-fill" style={{ width: `${Math.max(4, level.intensity * 100)}%` }} /></div>
              </div>
            );})}
          </div>
        </div>
      </div>

      {/* ─── AUTO TRADER V5 (PAPER MODE) ─── */}
      <div className="terminal-v2-autotrader">
        <div className="terminal-v2-at-head">
          <div className="terminal-v2-at-title">
            <span className="terminal-v2-card-kicker">Auto Trader V5</span>
            <span className="terminal-v2-at-paper">PAPER</span>
          </div>
          <div className="terminal-v2-inline-actions">
            <button
              type="button"
              className={`chart-chip ${autoTraderV5.enabled ? "active" : ""}`}
              disabled={!analyticsReady}
              title={analyticsReady ? "Activer ou couper l'auto-trading" : "Flux canonique requis"}
              onClick={() => updateAT(s => ({
                ...s,
                enabled: !s.enabled,
                mode:    !s.enabled ? "watching" : "standby",
                lastAction: !s.enabled ? "Scan du marche en cours..." : "Desactive",
              }))}
            >{autoTraderV5.enabled ? "ACTIF" : "DEMARRER"}</button>
            {autoTraderV5.mode === "paused" && (
              <button type="button" className="chart-chip"
                onClick={() => updateAT(s => ({ ...s, mode: "watching", currentDrawdownPct: 0, lastAction: "Reinitialise: surveillance" }))}
              >REINITIALISER</button>
            )}
          </div>
        </div>

        <div className="terminal-v2-at-strip">
          <div className="terminal-v2-at-stat">
            <span>Mode</span>
            <strong className={`at-mode at-mode-${autoTraderV5.mode}`}>{autoTraderV5.mode.toUpperCase()}</strong>
          </div>
          <div className="terminal-v2-at-stat">
            <span>P&amp;L</span>
            <strong className={autoTraderV5.pnlUsd >= 0 ? "good" : "warn"}>
              {autoTraderV5.pnlUsd >= 0 ? "+" : ""}{autoTraderV5.pnlUsd.toFixed(2)}$
            </strong>
          </div>
          <div className="terminal-v2-at-stat">
            <span>Win%</span>
            <strong>{autoTraderV5.totalTrades > 0
              ? ((autoTraderV5.wins / autoTraderV5.totalTrades) * 100).toFixed(0)
              : "--"}%</strong>
          </div>
          <div className="terminal-v2-at-stat">
            <span>Trades</span>
            <strong>{autoTraderV5.totalTrades}</strong>
          </div>
          <div className="terminal-v2-at-stat">
            <span>DD</span>
            <strong className={autoTraderV5.currentDrawdownPct > 5 ? "warn" : "good"}>
              -{autoTraderV5.currentDrawdownPct.toFixed(1)}%
            </strong>
          </div>
        </div>

        {autoTraderV5.position && (
          <div className={`terminal-v2-at-position ${autoTraderV5.position.side}`}>
            <span className={`at-pos-side ${autoTraderV5.position.side}`}>
              {autoTraderV5.position.side.toUpperCase()}
            </span>
            <span>@ {autoTraderV5.position.entryPrice.toFixed(2)}</span>
            <span>{autoTraderV5.position.size.toFixed(0)}$</span>
            <span>stop {autoTraderV5.position.trailingStop.toFixed(2)}</span>
            {autoTraderV5.position.partialClosed && <span className="at-partial">moitie fermee</span>}
          </div>
        )}

        {autoTraderV5.lastAction && (
          <div className="terminal-v2-at-action">{autoTraderV5.lastAction}</div>
        )}
      </div>
    </div>
  );
}

function buildCandlesFromHistory(
  history: Array<{ label: string; value: number }>,
  fallbackPrice: number,
): CandlePoint[] {
  void fallbackPrice;
  if (!Array.isArray(history) || history.length < 4) {
    return [];
  }

  const candles: CandlePoint[] = [];
  for (let index = 0; index < history.length; index += 1) {
    const point = history[index];
    const prev = history[index - 1] || point;
    const open = Number(prev.value);
    const close = Number(point.value);
    const localWindow = history
      .slice(Math.max(0, index - 3), index + 1)
      .map((item) => Number(item.value))
      .filter((value) => Number.isFinite(value) && value > 0);
    const high = Math.max(open, close, ...(localWindow.length > 0 ? localWindow : [open, close]));
    const low = Math.min(open, close, ...(localWindow.length > 0 ? localWindow : [open, close]));
    candles.push({
      label: point.label,
      open,
      high,
      low,
      close,
      volume: Math.max(1, Math.abs(close - open) * 1000),
    });
  }
  return candles;
}
