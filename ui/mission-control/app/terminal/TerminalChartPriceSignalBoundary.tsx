"use client";

import { useMemo, type ReactNode } from "react";

import type { PriceSignalBand } from "../../lib/engine/gpu-chart/PriceSignalLayer";
import type { FlowEvent, FlowIntelligenceSnapshot } from "../../lib/flowIntelligence";

type JsonMap = Record<string, unknown>;

type ExecutionEngineSnapshotLike = {
  entry: {
    referencePrice?: number | null;
    price?: number | null;
  };
  slippage: {
    expectedBps?: number | null;
    recentBps?: number | null;
    budgetBps?: number | null;
  };
  latency: {
    currentMs?: number | null;
    guardMs?: number | null;
  };
  partialFillHandling: {
    recentFillRatio?: number | null;
    expectedFillRatio?: number | null;
  };
};

type PerceptualExecutionSignalLike = {
  partialFillRatio?: number | null;
  confidence?: number | null;
};

type MarketSimulationLike = {
  t250ms?: {
    price?: number | null;
  } | null;
  cone?: {
    expected?: number | null;
  } | null;
  confidence?: number | null;
};

type LiquidityAISnapshotLike = {
  directionalBias: number;
  wallFormationProbability: number;
  confidence: number;
  liquidityVacuumProbability: number;
  absorptionFailureProbability: number;
};

type DOMSnapshotLevelLike = {
  side?: string | null;
  price?: number | null;
  size?: number | null;
  intensity?: number | null;
};

type DOMSnapshotLike = {
  spoofingRisk?: number | null;
};

type ExecutionOverlaySnapshot = {
  expectedPrice: number;
  actualPrice: number | null;
  referencePrice: number;
  expectedSlippageBps: number;
  realizedSlippageBps: number;
  latencyMs: number;
  fillRatio: number;
  confidence: number;
  side: "buy" | "sell";
  time: number;
};

type LiquidityPredictionLevel = {
  kind: "wall" | "vacuum" | "trap";
  price: number;
  strength: number;
};

type ArbitrageSnapshotLike = {
  executable: boolean;
  buyPrice: number;
  sellPrice: number;
  opportunityScore: number;
  netSpreadBps: number;
} | null;

type TerminalChartPriceSignalBoundaryProps = {
  executionEngineSnapshot: ExecutionEngineSnapshotLike;
  executionTelemetryChartRows: JsonMap[];
  executionChartOutcomesRows: JsonMap[];
  selectedChartSymbol: string;
  chartTimeframe: string;
  activeTimeKey: string;
  liveTimeKey: string;
  fallbackPrice: number;
  defaultSide: "buy" | "sell";
  activeExecutionSignal: PerceptualExecutionSignalLike | null;
  chartMarketSimulation: MarketSimulationLike | null;
  liquidityAiSnapshot: LiquidityAISnapshotLike;
  activeHeatmapLevels: DOMSnapshotLevelLike[];
  activeDomSnapshot: DOMSnapshotLike | null;
  flowIntelligenceSnapshot: FlowIntelligenceSnapshot | null;
  multiVenueArbitrageSnapshot: ArbitrageSnapshotLike;
  children: (payload: { priceSignalBands: PriceSignalBand[] }) => ReactNode;
};

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseFrameTimeMs(value: string | number | null | undefined, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function parseTimestampLike(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }
    return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function timeframeSeconds(timeframe: string): number {
  const match = /^([0-9]+)(s|m|h|d)$/i.exec(String(timeframe || "").trim());
  if (!match) {
    return 60;
  }
  const value = Math.max(1, Number(match[1]));
  const unit = match[2].toLowerCase();
  if (unit === "s") {
    return value;
  }
  if (unit === "m") {
    return value * 60;
  }
  if (unit === "h") {
    return value * 3600;
  }
  return value * 86400;
}

function toTimeBucketKey(value: string | number, timeframe: string): string {
  const stepMs = timeframeSeconds(timeframe) * 1000;
  const parsed = typeof value === "number" ? value : parseTimestampLike(value);
  if (!parsed || !Number.isFinite(parsed)) {
    return "";
  }
  return String(Math.floor(parsed / stepMs) * stepMs);
}

function pickTimestamp(item: JsonMap, candidates: string[]): string {
  for (const key of candidates) {
    const value = String(item[key] || "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function normalizeInstrument(symbol: string): string {
  return symbol.replace("-PERP", "").replace("/", "").replace(/-/g, "").toUpperCase();
}

function instrumentLabel(item: JsonMap): string {
  return String(item.symbol || item.instrument || item.strategy_id || item.ticket_key || "-");
}

function resolveExecutionOverlaySide(payload: JsonMap, fallback: "buy" | "sell"): "buy" | "sell" {
  const raw = String(payload.side || payload.action || payload.intent_side || payload.order_side || payload.direction || payload.position_side || "").toLowerCase();
  if (raw.includes("sell") || raw.includes("short")) {
    return "sell";
  }
  if (raw.includes("buy") || raw.includes("long")) {
    return "buy";
  }
  return fallback;
}

function resolveExecutionOverlayPrice(payload: JsonMap, fallback = Number.NaN): number {
  return toNumber(
    payload.executed_price ?? payload.avg_price ?? payload.fill_price ?? payload.entry_price ?? payload.reference_price ?? payload.price,
    fallback,
  );
}

function resolveExecutionOverlayFillRatio(payload: JsonMap, fallback = 0): number {
  const status = String(payload.status || payload.execution_status || payload.order_status || "").toLowerCase();
  return clamp(
    toNumber(payload.fill_ratio ?? payload.executed_ratio, /partial/.test(status) ? 0.5 : /fill|closed|done|complete/.test(status) ? 1 : fallback),
    0,
    1,
  );
}

function resolveExecutionOverlayTimeKey(payload: JsonMap, timeframe: string): string {
  return toTimeBucketKey(
    pickTimestamp(payload, ["ts_fill_final", "ts_fill_partial", "executed_at", "filled_at", "closed_at", "approved_at", "created_at", "submitted_at", "timestamp", "ts"]),
    timeframe,
  );
}

function priceFromExecutionBps(referencePrice: number, slippageBps: number, side: "buy" | "sell"): number {
  if (!(referencePrice > 0) || !Number.isFinite(slippageBps)) {
    return Number.NaN;
  }
  const signedBps = slippageBps < 0 ? slippageBps : side === "buy" ? Math.abs(slippageBps) : -Math.abs(slippageBps);
  return referencePrice * (1 + signedBps / 10000);
}

function buildExecutionOverlaySnapshot(input: {
  snapshot: ExecutionEngineSnapshotLike;
  telemetry: JsonMap[];
  outcomes: JsonMap[];
  symbol: string;
  timeframe: string;
  activeTimeKey: string;
  liveTimeKey: string;
  fallbackPrice: number;
  defaultSide: "buy" | "sell";
  activeExecutionSignal: PerceptualExecutionSignalLike | null;
}): ExecutionOverlaySnapshot | null {
  const selectedSymbolKey = normalizeInstrument(input.symbol);
  const candidates = [...input.telemetry, ...input.outcomes.slice(0, 24)]
    .filter((item) => {
      const instrument = normalizeInstrument(String(item.instrument || item.symbol || item.symbol_key || instrumentLabel(item)));
      if (instrument && selectedSymbolKey && instrument !== selectedSymbolKey) {
        return false;
      }
      const itemTimeframe = String(item.timeframe || item.chart_timeframe || item.strategy_timeframe || item.tf || "").trim();
      return !itemTimeframe || itemTimeframe === input.timeframe;
    })
    .map((item) => ({
      item,
      timeKey: resolveExecutionOverlayTimeKey(item, input.timeframe),
      timeMs: parseFrameTimeMs(
        pickTimestamp(item, ["ts_fill_final", "ts_fill_partial", "executed_at", "filled_at", "closed_at", "approved_at", "created_at", "submitted_at", "timestamp", "ts"]),
        0,
      ),
    }))
    .sort((left, right) => {
      const leftScore = left.timeKey === input.activeTimeKey ? 3 : left.timeKey === input.liveTimeKey ? 2 : 0;
      const rightScore = right.timeKey === input.activeTimeKey ? 3 : right.timeKey === input.liveTimeKey ? 2 : 0;
      return rightScore - leftScore || right.timeMs - left.timeMs;
    });

  const payload = candidates[0]?.item || null;
  const side = payload ? resolveExecutionOverlaySide(payload, input.defaultSide) : input.defaultSide;
  const referencePrice = Math.max(
    0,
    toNumber(
      payload?.reference_price ?? payload?.entry_price ?? payload?.price,
      input.snapshot.entry.referencePrice ?? input.snapshot.entry.price ?? input.fallbackPrice,
    ),
  );
  const expectedSlippageBps = Math.abs(toNumber(payload?.expected_slippage_bps ?? payload?.slippage_expected_bps, input.snapshot.slippage.expectedBps ?? 0));
  const expectedPriceRaw = toNumber(payload?.execution_engine_entry_price ?? payload?.entry_price, input.snapshot.entry.price ?? Number.NaN);
  const expectedPrice = expectedPriceRaw > 0
    ? expectedPriceRaw
    : priceFromExecutionBps(referencePrice, expectedSlippageBps, side);
  const realizedSlippageBps = toNumber(payload?.realized_slippage_bps ?? payload?.slippage_real_bps ?? payload?.slippage_bps, input.snapshot.slippage.recentBps ?? 0);
  const actualPriceRaw = payload ? resolveExecutionOverlayPrice(payload, Number.NaN) : Number.NaN;
  const actualPrice = actualPriceRaw > 0
    ? actualPriceRaw
    : (referencePrice > 0 && Number.isFinite(realizedSlippageBps)
      ? priceFromExecutionBps(referencePrice, realizedSlippageBps, side)
      : null);
  const latencyMs = Math.max(0, toNumber(payload?.latency_e2e_ms ?? payload?.latency_ms ?? payload?.execution_latency_ms, input.snapshot.latency.currentMs ?? 0));
  const fillRatio = payload
    ? resolveExecutionOverlayFillRatio(payload, input.snapshot.partialFillHandling.recentFillRatio ?? 0)
    : clamp(
      input.activeExecutionSignal?.partialFillRatio
        ?? input.snapshot.partialFillHandling.recentFillRatio
        ?? input.snapshot.partialFillHandling.expectedFillRatio
        ?? 0,
      0,
      1,
    );
  const confidence = clamp(
    input.activeExecutionSignal?.confidence
      ?? (fillRatio * 0.42 + Math.max(0, 1 - Math.abs(realizedSlippageBps) / Math.max(8, input.snapshot.slippage.budgetBps || 8)) * 0.28 + Math.max(0, 1 - latencyMs / Math.max(200, (input.snapshot.latency.guardMs || 0) * 2 || 200)) * 0.3),
    0,
    1,
  );
  const time = payload
    ? parseFrameTimeMs(
      pickTimestamp(payload, ["ts_fill_final", "ts_fill_partial", "executed_at", "filled_at", "closed_at", "approved_at", "created_at", "submitted_at", "timestamp", "ts"]),
      Date.now(),
    )
    : Date.now();

  if (!(referencePrice > 0) || !(expectedPrice > 0)) {
    return null;
  }

  return {
    expectedPrice,
    actualPrice: actualPrice && actualPrice > 0 ? actualPrice : null,
    referencePrice,
    expectedSlippageBps,
    realizedSlippageBps,
    latencyMs,
    fillRatio,
    confidence,
    side,
    time,
  };
}

function buildExecutionSlippageBands(input: {
  telemetry: JsonMap[];
  outcomes: JsonMap[];
  symbol: string;
  timeframe: string;
  defaultSide: "buy" | "sell";
  fallbackReferencePrice: number;
}): PriceSignalBand[] {
  const selectedSymbolKey = normalizeInstrument(input.symbol);
  return [...input.telemetry, ...input.outcomes.slice(0, 20)]
    .filter((item) => {
      const instrument = normalizeInstrument(String(item.instrument || item.symbol || item.symbol_key || instrumentLabel(item)));
      if (instrument && selectedSymbolKey && instrument !== selectedSymbolKey) {
        return false;
      }
      const itemTimeframe = String(item.timeframe || item.chart_timeframe || item.strategy_timeframe || item.tf || "").trim();
      return !itemTimeframe || itemTimeframe === input.timeframe;
    })
    .slice(0, 12)
    .map((item, index, array) => {
      const side = resolveExecutionOverlaySide(item, input.defaultSide);
      const referencePrice = Math.max(0, toNumber(item.reference_price ?? item.entry_price ?? item.price, input.fallbackReferencePrice));
      const slippageBps = toNumber(item.realized_slippage_bps ?? item.slippage_real_bps ?? item.slippage_bps, Number.NaN);
      const fillRatio = resolveExecutionOverlayFillRatio(item, 0.5);
      const latencyMs = Math.max(0, toNumber(item.latency_e2e_ms ?? item.latency_ms ?? item.execution_latency_ms, 0));
      const explicitPrice = resolveExecutionOverlayPrice(item, Number.NaN);
      const price = explicitPrice > 0 ? explicitPrice : priceFromExecutionBps(referencePrice, slippageBps, side);
      if (!(price > 0) || !Number.isFinite(slippageBps)) {
        return null;
      }
      const recencyWeight = 1 - index / Math.max(1, array.length);
      return {
        price,
        strength: clamp(Math.abs(slippageBps) / 10, 0.12, 1) * 0.58 + fillRatio * 0.18 + Math.max(0, 1 - latencyMs / 900) * 0.14 + recencyWeight * 0.1,
        kind: "slippage" as const,
        xStart: 0.48,
        xEnd: 1,
        thickness: 0.0045 + clamp(fillRatio, 0, 1) * 0.0065,
      } satisfies PriceSignalBand;
    })
    .filter((item) => item !== null)
    .slice(0, 10) as PriceSignalBand[];
}

function buildLiquidityPredictionLevels(input: {
  simulation: MarketSimulationLike | null;
  liquidityAi: LiquidityAISnapshotLike;
  heatmapLevels: DOMSnapshotLevelLike[];
  domSnapshot: DOMSnapshotLike | null;
  currentPrice: number;
}): LiquidityPredictionLevel[] {
  if (!(input.currentPrice > 0)) {
    return [];
  }

  const forwardSide: "bid" | "ask" = input.liquidityAi.directionalBias >= 0 ? "ask" : "bid";
  const forwardLevels = input.heatmapLevels
    .filter((level) => level.side === forwardSide && (forwardSide === "ask" ? toNumber(level.price, 0) >= input.currentPrice : toNumber(level.price, 0) <= input.currentPrice))
    .sort((left, right) => (toNumber(right.size, 0) * Math.max(toNumber(right.intensity, 0), 0.1)) - (toNumber(left.size, 0) * Math.max(toNumber(left.intensity, 0), 0.1)));
  const opposingLevels = input.heatmapLevels
    .filter((level) => level.side !== forwardSide && (forwardSide === "ask" ? toNumber(level.price, 0) <= input.currentPrice : toNumber(level.price, 0) >= input.currentPrice))
    .sort((left, right) => (toNumber(right.size, 0) * Math.max(toNumber(right.intensity, 0), 0.1)) - (toNumber(left.size, 0) * Math.max(toNumber(left.intensity, 0), 0.1)));

  const wallLevel = forwardLevels[0];
  const trapLevel = opposingLevels[0];
  const vacuumPrice = input.simulation?.t250ms?.price ?? input.simulation?.cone?.expected ?? 0;
  const levels: LiquidityPredictionLevel[] = [];

  if (wallLevel && input.liquidityAi.wallFormationProbability >= 0.45) {
    levels.push({
      kind: "wall",
      price: toNumber(wallLevel.price, 0),
      strength: clamp(input.liquidityAi.wallFormationProbability * 0.7 + input.liquidityAi.confidence * 0.3, 0.2, 1),
    });
  }
  if (vacuumPrice > 0 && input.liquidityAi.liquidityVacuumProbability >= 0.42) {
    levels.push({
      kind: "vacuum",
      price: vacuumPrice,
      strength: clamp(input.liquidityAi.liquidityVacuumProbability * 0.72 + toNumber(input.simulation?.confidence, 0) * 0.28, 0.18, 1),
    });
  }
  if (trapLevel && Math.max(input.liquidityAi.absorptionFailureProbability, toNumber(input.domSnapshot?.spoofingRisk, 0)) >= 0.38) {
    levels.push({
      kind: "trap",
      price: toNumber(trapLevel.price, 0),
      strength: clamp(Math.max(input.liquidityAi.absorptionFailureProbability, toNumber(input.domSnapshot?.spoofingRisk, 0)) * 0.75 + input.liquidityAi.confidence * 0.25, 0.18, 1),
    });
  }

  return levels;
}

function mapFlowEventKindToBandKind(kind: FlowEvent["kind"]): PriceSignalBand["kind"] {
  switch (kind) {
    case "absorption":
      return "flow-absorption";
    case "exhaustion":
      return "flow-exhaustion";
    case "spoof":
      return "flow-spoof";
    case "breakout":
    case "sweep":
      return "flow-sweep";
    case "reversion":
      return "flow-memory";
    default:
      return "flow-memory";
  }
}

function buildFlowSignalBands(input: {
  snapshot: FlowIntelligenceSnapshot | null;
}): PriceSignalBand[] {
  if (!input.snapshot) {
    return [];
  }

  const eventBands = input.snapshot.recentEvents.slice(0, 3).map((event, index) => ({
    price: event.price,
    strength: clamp(event.score * 0.82 + event.persistence * 0.18, 0.16, 1),
    kind: mapFlowEventKindToBandKind(event.kind),
    xStart: event.kind === "spoof"
      ? -1
      : event.side === "buy"
        ? -1
        : -0.18,
    xEnd: event.kind === "spoof"
      ? 1
      : event.side === "buy"
        ? 0.22
        : 1,
    thickness: clamp(0.0048 + event.score * 0.006 + index * 0.0004, 0.0048, 0.013),
  } satisfies PriceSignalBand));

  const liquidityBands = input.snapshot.liquidityZones.slice(0, 4).map((zone, index) => ({
    price: zone.price,
    strength: clamp(zone.strength * 0.76 + zone.persistence * 0.24, 0.14, 1),
    kind: "flow-memory" as const,
    xStart: zone.side === "bid" ? -1 : -0.12,
    xEnd: zone.side === "bid" ? 0.16 : 1,
    thickness: clamp(0.0035 + zone.persistence * 0.0038 - index * 0.00015, 0.0032, 0.0095),
  }));

  return [...eventBands, ...liquidityBands].slice(0, 8);
}

function buildArbitrageSignalBands(input: {
  snapshot: ArbitrageSnapshotLike;
}): PriceSignalBand[] {
  if (!input.snapshot?.executable || !(input.snapshot.buyPrice > 0) || !(input.snapshot.sellPrice > 0)) {
    return [];
  }
  const strength = clamp(
    input.snapshot.opportunityScore / 120 * 0.55 + Math.max(0, input.snapshot.netSpreadBps) / 12 * 0.45,
    0.18,
    1,
  );
  return [
    {
      price: input.snapshot.buyPrice,
      strength,
      kind: "arb-buy",
      xStart: -1,
      xEnd: 0.14,
      thickness: 0.0065,
    },
    {
      price: input.snapshot.sellPrice,
      strength,
      kind: "arb-sell",
      xStart: -0.14,
      xEnd: 1,
      thickness: 0.0065,
    },
  ];
}

function buildPriceSignalBands(input: {
  executionOverlay: ExecutionOverlaySnapshot | null;
  slippageBands: PriceSignalBand[];
  liquidityLevels: LiquidityPredictionLevel[];
  flowBands?: PriceSignalBand[];
  arbitrageBands?: PriceSignalBand[];
}): PriceSignalBand[] {
  const bands: PriceSignalBand[] = [];
  if (input.executionOverlay) {
    bands.push({
      price: input.executionOverlay.expectedPrice,
      strength: clamp(input.executionOverlay.confidence * 0.82 + input.executionOverlay.fillRatio * 0.18, 0.18, 1),
      kind: "execution-expected",
      xStart: -1,
      xEnd: 1,
      thickness: 0.0045,
    });
    if (input.executionOverlay.actualPrice && input.executionOverlay.actualPrice > 0) {
      bands.push({
        price: input.executionOverlay.actualPrice,
        strength: clamp(input.executionOverlay.confidence * 0.72 + Math.min(1, Math.abs(input.executionOverlay.realizedSlippageBps) / 12) * 0.28, 0.2, 1),
        kind: "execution-actual",
        xStart: -1,
        xEnd: 1,
        thickness: 0.007,
      });
    }
  }

  bands.push(...input.slippageBands);
  bands.push(...(input.flowBands || []));
  bands.push(...(input.arbitrageBands || []));

  input.liquidityLevels.forEach((level) => {
    bands.push({
      price: level.price,
      strength: level.strength,
      kind: level.kind,
      xStart: level.kind === "wall" ? -0.2 : level.kind === "vacuum" ? 0.2 : 0.08,
      xEnd: 1,
      thickness: level.kind === "wall" ? 0.009 : level.kind === "vacuum" ? 0.011 : 0.008,
    });
  });

  return bands.slice(0, 32);
}

export function TerminalChartPriceSignalBoundary({
  executionEngineSnapshot,
  executionTelemetryChartRows,
  executionChartOutcomesRows,
  selectedChartSymbol,
  chartTimeframe,
  activeTimeKey,
  liveTimeKey,
  fallbackPrice,
  defaultSide,
  activeExecutionSignal,
  chartMarketSimulation,
  liquidityAiSnapshot,
  activeHeatmapLevels,
  activeDomSnapshot,
  flowIntelligenceSnapshot,
  multiVenueArbitrageSnapshot,
  children,
}: TerminalChartPriceSignalBoundaryProps) {
  const chartExecutionOverlay = useMemo(() => buildExecutionOverlaySnapshot({
    snapshot: executionEngineSnapshot,
    telemetry: executionTelemetryChartRows,
    outcomes: executionChartOutcomesRows,
    symbol: selectedChartSymbol,
    timeframe: chartTimeframe,
    activeTimeKey,
    liveTimeKey,
    fallbackPrice,
    defaultSide,
    activeExecutionSignal,
  }), [activeExecutionSignal, activeTimeKey, chartTimeframe, defaultSide, executionChartOutcomesRows, executionEngineSnapshot, executionTelemetryChartRows, fallbackPrice, liveTimeKey, selectedChartSymbol]);

  const chartExecutionSlippageBands = useMemo(() => buildExecutionSlippageBands({
    telemetry: executionTelemetryChartRows,
    outcomes: executionChartOutcomesRows,
    symbol: selectedChartSymbol,
    timeframe: chartTimeframe,
    defaultSide,
    fallbackReferencePrice: chartExecutionOverlay?.referencePrice || fallbackPrice,
  }), [chartExecutionOverlay?.referencePrice, chartTimeframe, defaultSide, executionChartOutcomesRows, executionTelemetryChartRows, fallbackPrice, selectedChartSymbol]);

  const chartLiquidityPredictionLevels = useMemo(() => buildLiquidityPredictionLevels({
    simulation: chartMarketSimulation,
    liquidityAi: liquidityAiSnapshot,
    heatmapLevels: activeHeatmapLevels,
    domSnapshot: activeDomSnapshot,
    currentPrice: fallbackPrice,
  }), [activeDomSnapshot, activeHeatmapLevels, chartMarketSimulation, fallbackPrice, liquidityAiSnapshot]);

  const chartFlowSignalBands = useMemo(() => buildFlowSignalBands({
    snapshot: flowIntelligenceSnapshot,
  }), [flowIntelligenceSnapshot]);

  const chartArbitrageSignalBands = useMemo(() => buildArbitrageSignalBands({
    snapshot: multiVenueArbitrageSnapshot,
  }), [multiVenueArbitrageSnapshot]);

  const priceSignalBands = useMemo(() => buildPriceSignalBands({
    executionOverlay: chartExecutionOverlay,
    slippageBands: chartExecutionSlippageBands,
    liquidityLevels: chartLiquidityPredictionLevels,
    flowBands: chartFlowSignalBands,
    arbitrageBands: chartArbitrageSignalBands,
  }), [chartArbitrageSignalBands, chartExecutionOverlay, chartExecutionSlippageBands, chartFlowSignalBands, chartLiquidityPredictionLevels]);

  return <>{children({ priceSignalBands })}</>;
}