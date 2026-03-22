"use client";

import { CSSProperties, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeriesPartialOptions,
  CandlestickSeriesPartialOptions,
  ColorType,
  CrosshairMode,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineSeriesPartialOptions,
  MouseEventParams,
  Time,
  UTCTimestamp,
  createChart,
} from "lightweight-charts";

import { createDirtyState } from "../../lib/dirtyFlags";
import { createInteractionEngine } from "../../lib/chartInteraction";
import { applyDynamicLod } from "../../lib/lodEngine";
import { RenderScheduler } from "../../lib/renderScheduler";
import { getDensityLevel, getDensityConfig, type DensityLevel } from "../../lib/densityEngine";
import type { IndicatorSeriesData } from "../../lib/indicators/engine";
import { heikinAshi, volumeProfile } from "../../lib/indicators/transforms";

type QuotePoint = { label: string; value: number };
type CandlePoint = { label: string; open: number; high: number; low: number; close: number; volume: number };
type OverlayZone = {
  kind: "fvg" | "ob";
  label: string;
  x1: number;
  x2: number;
  low: number;
  high: number;
  tone: string;
};
type LiquidityZone = { level: number; label: string };
type ChartMotionPreset = "stable" | "balanced" | "aggressive" | "scalping" | "swing" | "auto";

type Props = {
  className?: string;
  symbol: string;
  timeframe: string;
  mode: "line" | "candles" | "footprint";
  interactionMode?: "full" | "lite";
  frozen?: boolean;
  chartMotionPreset?: ChartMotionPreset;
  points: QuotePoint[];
  candles: CandlePoint[];
  overlayZones: OverlayZone[];
  liquidityZones: LiquidityZone[];
  domLevels?: Array<{ side: "bid" | "ask"; price: number; size: number; intensity: number }>;
  heatmapLevels?: Array<{ side: "bid" | "ask"; price: number; size: number; intensity: number }>;
  dayVwap: number;
  weekVwap: number;
  monthVwap: number;
  showSessions?: boolean;
  /** Pre-computed indicator series from computeAllIndicators().  Overlay (pane="main") only rendered here. */
  indicatorSeries?: IndicatorSeriesData[];
  /** Optional compact footprint rows from terminal context (buy/sell delta by price slice). */
  footprintRows?: Array<{ low: number; high: number; buyVolume: number; sellVolume: number; delta: number; timeLabel?: string }>;
  /** Apply a candle transform — "heikin-ashi" transforms OHLCV data before rendering. */
  candleTransform?: "none" | "heikin-ashi";
  onCrosshairMove?: (payload: { price: number; timeLabel: string; timeKey: string } | null) => void;
};

type OverlayBadge = {
  key: string;
  left: number;
  top: number;
  text: string;
  tone: string;
  kind: "zone" | "liquidity";
  detail: string;
  price: number;
};

type CursorState = {
  visible: boolean;
  left: number;
  top: number;
  priceTop: number;
  timeLeft: number;
  price: string;
  time: string;
};

type ActiveCandleOverlay = {
  left: number;
  width: number;
  source: "crosshair" | "live";
};

type LivePulseState = {
  left: number;
  top: number;
  priceLabel: string;
  tick: number;
};

type LivePulseMeta = {
  left: number;
  top: number;
  updatedAt: number;
  lastPulseAt: number;
};

type FormingCandleState = {
  left: number;
  width: number;
  openY: number;
  closeY: number;
  highY: number;
  lowY: number;
  direction: "up" | "down" | "flat";
};

type InertiaState = {
  driftX: number;
  driftY: number;
};

type ChartFeelState = {
  inertiaOpacity: number;
  inertiaScale: number;
};

type OverlayOffset = {
  x: number;
  y: number;
};

type DragState = {
  key: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type CandleRenderPoint = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type ChartMotionTuning = {
  smoothingBase: number;
  smoothingDistanceScale: number;
  smoothingMax: number;
  snapDistance: number;
  inertiaDecayX: number;
  inertiaDecayY: number;
  inertiaImpulseX: number;
  inertiaImpulseY: number;
  inertiaImpulseClamp: number;
  inertiaDriftClampX: number;
  inertiaDriftClampY: number;
  inertiaBlend: number;
  feelBaseOpacity: number;
  feelMaxExtraOpacity: number;
  feelMaxScale: number;
  formingWidthFactor: number;
  formingWidthMax: number;
};

const OVERLAY_OFFSET_STORAGE_PREFIX = "gtix.overlay.offsets.v1";
const DOM_LOCK_STORAGE_PREFIX = "gtix.dom.locked-walls.v1";

const AREA_OPTIONS: AreaSeriesPartialOptions = {
  lineColor: "#7ed7ff",
  lineWidth: 3,
  topColor: "rgba(88,199,255,0.38)",
  bottomColor: "rgba(88,199,255,0.03)",
  priceLineVisible: false,
  lastValueVisible: false,
};

const CANDLE_OPTIONS: CandlestickSeriesPartialOptions = {
  upColor: "rgba(30, 198, 126, 1)",
  downColor: "rgba(237, 74, 74, 1)",
  wickUpColor: "rgba(208, 255, 234, 0.98)",
  wickDownColor: "rgba(255, 226, 226, 0.98)",
  wickVisible: true,
  borderVisible: true,
  borderUpColor: "rgba(240, 255, 249, 1)",
  borderDownColor: "rgba(255, 238, 238, 1)",
  priceLineVisible: false,
  lastValueVisible: false,
};

const DOM_HOLD_THRESHOLD_MS = {
  touch: 340,
  pen: 260,
  mouse: 420,
} as const;

const LAYER_PRIORITY = {
  candle: 3,
  indicator: 2,
  overlay: 1,
};

type AssetContrastClass = "crypto" | "fx" | "other";

function inferAssetContrastClass(symbol: string): AssetContrastClass {
  const normalized = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  if (normalized.includes("BTC") || normalized.includes("ETH") || normalized.includes("SOL") || normalized.includes("XRP") || normalized.includes("DOGE")) {
    return "crypto";
  }
  const fxMajors = ["USD", "EUR", "JPY", "GBP", "AUD", "NZD", "CAD", "CHF"];
  if (normalized.length >= 6) {
    const base = normalized.slice(0, 3);
    const quote = normalized.slice(3, 6);
    if (fxMajors.includes(base) && fxMajors.includes(quote)) {
      return "fx";
    }
  }
  return "other";
}

function inferTimeframeContrastBand(timeframe: string): "fast" | "swing" {
  return timeframe === "1m" || timeframe === "5m" ? "fast" : "swing";
}

function resolveCandleContrastOptions(symbol: string, timeframe: string): Partial<CandlestickSeriesPartialOptions> {
  const assetClass = inferAssetContrastClass(symbol);
  const band = inferTimeframeContrastBand(timeframe);
  if (assetClass === "crypto") {
    return band === "fast"
      ? {
        upColor: "rgba(22, 203, 130, 1)",
        downColor: "rgba(240, 66, 66, 1)",
        wickUpColor: "rgba(220, 255, 238, 1)",
        wickDownColor: "rgba(255, 233, 233, 1)",
        borderUpColor: "rgba(246, 255, 251, 1)",
        borderDownColor: "rgba(255, 242, 242, 1)",
      }
      : {
        upColor: "rgba(28, 194, 128, 0.98)",
        downColor: "rgba(233, 77, 77, 0.98)",
        wickUpColor: "rgba(206, 249, 228, 0.98)",
        wickDownColor: "rgba(255, 224, 224, 0.98)",
        borderUpColor: "rgba(235, 252, 245, 0.98)",
        borderDownColor: "rgba(255, 234, 234, 0.98)",
      };
  }
  if (assetClass === "fx") {
    return band === "fast"
      ? {
        upColor: "rgba(43, 177, 221, 0.96)",
        downColor: "rgba(255, 128, 133, 0.97)",
        wickUpColor: "rgba(205, 238, 255, 0.96)",
        wickDownColor: "rgba(255, 216, 216, 0.96)",
        borderUpColor: "rgba(228, 246, 255, 0.98)",
        borderDownColor: "rgba(255, 229, 229, 0.98)",
      }
      : {
        upColor: "rgba(66, 170, 210, 0.92)",
        downColor: "rgba(236, 129, 129, 0.94)",
        wickUpColor: "rgba(197, 231, 248, 0.9)",
        wickDownColor: "rgba(246, 206, 206, 0.92)",
        borderUpColor: "rgba(223, 243, 253, 0.94)",
        borderDownColor: "rgba(252, 225, 225, 0.94)",
      };
  }
  return {};
}

function timeframeSeconds(timeframe: string): number {
  if (timeframe === "5m") {
    return 300;
  }
  if (timeframe === "15m") {
    return 900;
  }
  return 60;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function domHoldThresholdMs(pointerType: string, viewportWidth: number): number {
  const normalized = pointerType === "pen" ? "pen" : pointerType === "mouse" ? "mouse" : "touch";
  const coarseViewportBoost = viewportWidth < 780 && normalized !== "mouse" ? 35 : 0;
  return DOM_HOLD_THRESHOLD_MS[normalized] + coarseViewportBoost;
}

function formatCursorTime(time: Time): string {
  if (typeof time === "number") {
    return new Date(time * 1000).toISOString().slice(11, 16);
  }
  if (typeof time === "string") {
    return time.includes("T") ? time.slice(11, 16) : time.slice(-5);
  }
  if ("day" in time) {
    const day = String(time.day).padStart(2, "0");
    const month = String(time.month).padStart(2, "0");
    return `${day}/${month}`;
  }
  return "--:--";
}

function timeToBucketKey(time: Time, timeframe: string): string {
  const step = timeframeSeconds(timeframe);
  if (typeof time === "number") {
    return String(Math.floor(time / step) * step * 1000);
  }
  if (typeof time === "string") {
    const parsed = Date.parse(time);
    if (Number.isFinite(parsed)) {
      return String(Math.floor(parsed / (step * 1000)) * step * 1000);
    }
    return "";
  }
  if ("day" in time) {
    const parsed = Date.UTC(time.year, time.month - 1, time.day);
    return String(Math.floor(parsed / (step * 1000)) * step * 1000);
  }
  return "";
}

function formatCompactPrice(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(2);
  }
  return value.toFixed(4);
}

function formatCompactDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) {
    return `${total}s`;
  }
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins < 60) {
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

function normalizeTimes(labels: string[], timeframe: string): UTCTimestamp[] {
  const step = timeframeSeconds(timeframe);
  const fallbackStart = Math.floor(Date.now() / 1000) - Math.max(0, labels.length - 1) * step;
  let previous = 0;

  return labels.map((label, index) => {
    const parsed = Date.parse(label);
    let value = Number.isFinite(parsed)
      ? Math.floor(parsed / 1000)
      : fallbackStart + index * step;

    if (value <= previous) {
      value = previous + step;
    }

    previous = value;
    return value as UTCTimestamp;
  });
}

function estimateRecentVolatility(candles: CandlePoint[], points: QuotePoint[]): number {
  const source = candles.length > 1
    ? candles.slice(-120).map((c) => c.close)
    : points.slice(-120).map((p) => p.value);
  if (source.length < 6) {
    return 0;
  }
  const returns: number[] = [];
  for (let idx = 1; idx < source.length; idx += 1) {
    const prev = source[idx - 1];
    const next = source[idx];
    if (Number.isFinite(prev) && prev > 0 && Number.isFinite(next)) {
      returns.push((next - prev) / prev);
    }
  }
  if (returns.length < 4) {
    return 0;
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  return Math.sqrt(Math.max(0, variance));
}

type AutoMotionInstrumentClass = "btc" | "eth" | "index" | "default";
type AutoMotionMode = "scalping" | "swing";
type AutoStabilityTone = "ok" | "warn" | "hot";
type AutoTargetBand = {
  okFloorSec: number;
  warnFloorSec: number;
  targetSec: number;
};
type AutoStabilityMetrics = {
  switches5m: number;
  switches1h: number;
  avgIntervalSec: number | null;
  lastSwitchAgoSec: number | null;
  sparklineBuckets: number[];
};

type FramePerfState = {
  fps: number;
  frameTimeMs: number;
  cpuLoad: number;
};

type RenderUpdateCounts = {
  candle: number;
  indicator: number;
  overlay: number;
};

type VolumeProfileOverlayRow = {
  key: string;
  top: number;
  height: number;
  priceMid: number;
  totalVol: number;
  widthPct: number;
  buyPct: number;
  imbalance: number;
  isPoc: boolean;
  isVah: boolean;
  isVal: boolean;
  sessionBias: "asia" | "london" | "newyork" | "mixed";
  sessionConfidence: number;
};

type VolumeProfileOverlayState = {
  rows: VolumeProfileOverlayRow[];
  vahY: number | null;
  valY: number | null;
  pocY: number | null;
  degraded: boolean;
  pausedReason: "perf" | "density" | "mode" | "lite" | "frozen" | null;
};

type FootprintOverlayRow = {
  key: string;
  top: number;
  height: number;
  price: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  deltaRatio: number;
  imbalanceSide: "buy" | "sell" | "none";
  imbalanceStrength: number;
  absorption: boolean;
  timeLabel: string;
};

type FootprintOverlayState = {
  rows: FootprintOverlayRow[];
  degraded: boolean;
  pausedReason: "perf" | "density" | "mode" | "lite" | "frozen" | null;
};

type DomOverlayLevel = {
  key: string;
  lockKey: string;
  side: "bid" | "ask";
  price: number;
  size: number;
  intensity: number;
  isWall: boolean;
};

type DomOverlayState = {
  levels: DomOverlayLevel[];
  imbalanceRatio: number;
  degraded: boolean;
  pausedReason: "perf" | "density" | "mode" | "lite" | "frozen" | null;
};

type HeatmapOverlayBand = {
  key: string;
  top: number;
  height: number;
  opacity: number;
  side: "bid" | "ask";
  focus: "core" | "near" | "far";
};

type HeatmapOverlayState = {
  bands: HeatmapOverlayBand[];
  degraded: boolean;
  pausedReason: "perf" | "density" | "mode" | "lite" | "frozen" | null;
};

type OverlayPerfProfile = {
  busyFrameMs: number;
  busyMinFps: number;
  busyCpuLoad: number;
  criticalFrameMs: number;
  criticalMinFps: number;
  criticalCpuLoad: number;
  domLevelsBusy: number;
  domLevelsNormal: number;
  heatmapBandsBusy: number;
  heatmapBandsNormal: number;
};

function autoMotionTargetIntervalSec(symbol: string, timeframe: string): number {
  const instrumentClass = classifyAutoMotionInstrument(symbol);
  const targets: Record<AutoMotionInstrumentClass, { m1: number; m5: number; m15: number }> = {
    btc: { m1: 9 * 60, m5: 15 * 60, m15: 22 * 60 },
    eth: { m1: 8 * 60, m5: 13 * 60, m15: 20 * 60 },
    index: { m1: 14 * 60, m5: 22 * 60, m15: 32 * 60 },
    default: { m1: 10 * 60, m5: 16 * 60, m15: 24 * 60 },
  };
  const target = targets[instrumentClass];
  const tfSeconds = timeframeSeconds(timeframe);
  if (tfSeconds <= 60) {
    return target.m1;
  }
  if (tfSeconds <= 300) {
    return target.m5;
  }
  return target.m15;
}

function autoMotionTargetBand(symbol: string, timeframe: string): AutoTargetBand {
  const targetSec = autoMotionTargetIntervalSec(symbol, timeframe);
  return {
    targetSec,
    okFloorSec: targetSec * 0.85,
    warnFloorSec: targetSec * 0.6,
  };
}

function autoMotionIntervalTone(avgIntervalSec: number | null, targetIntervalSec: number): AutoStabilityTone {
  if (avgIntervalSec === null) {
    return "ok";
  }
  if (avgIntervalSec < targetIntervalSec * 0.6) {
    return "hot";
  }
  if (avgIntervalSec < targetIntervalSec * 0.85) {
    return "warn";
  }
  return "ok";
}

function buildSparklinePath(values: number[], width: number, height: number): string {
  if (values.length === 0) {
    return "";
  }
  const maxValue = Math.max(1, ...values);
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  return values.map((value, index) => {
    const x = Number((index * stepX).toFixed(2));
    const y = Number((height - (value / maxValue) * height).toFixed(2));
    return `${index === 0 ? "M" : "L"}${x},${y}`;
  }).join(" ");
}

function autoMotionBaseThreshold(symbol: string, timeframe: string): number {
  const instrumentClass = classifyAutoMotionInstrument(symbol);
  const thresholds: Record<AutoMotionInstrumentClass, { m1: number; m5: number; m15: number }> = {
    btc: { m1: 0.0018, m5: 0.0028, m15: 0.0036 },
    eth: { m1: 0.0022, m5: 0.0032, m15: 0.0042 },
    index: { m1: 0.00075, m5: 0.00125, m15: 0.0019 },
    default: { m1: 0.0016, m5: 0.0024, m15: 0.0032 },
  };
  const threshold = thresholds[instrumentClass];
  const tfSeconds = timeframeSeconds(timeframe);
  if (tfSeconds <= 60) {
    return threshold.m1;
  }
  if (tfSeconds <= 300) {
    return threshold.m5;
  }
  return threshold.m15;
}

function autoMotionHysteresisBand(threshold: number, sigma: number): number {
  const floor = threshold * 0.09;
  const ceiling = threshold * 0.34;
  const adaptive = threshold * 0.075 + Math.abs(sigma - threshold) * 0.55;
  return clamp(adaptive, floor, ceiling);
}

function classifyAutoMotionInstrument(symbol: string): AutoMotionInstrumentClass {
  const upper = symbol.toUpperCase();
  if (upper.includes("BTC")) {
    return "btc";
  }
  if (upper.includes("ETH")) {
    return "eth";
  }
  if (
    upper.includes("SPX") || upper.includes("SP500") || upper.includes("US500")
    || upper.includes("NAS100") || upper.includes("USTEC") || upper.includes("NDX")
    || upper.includes("US30") || upper.includes("DJI")
    || upper.includes("GER40") || upper.includes("DAX")
    || upper.includes("UK100") || upper.includes("FTSE")
    || upper.includes("JPN225") || upper.includes("N225")
    || upper.includes("HK50") || upper.includes("AUS200")
    || upper.includes("CAC40") || upper.includes("EU50") || upper.includes("STOXX50")
  ) {
    return "index";
  }
  return "default";
}

function resolveAutoMotionPreset(
  symbol: string,
  timeframe: string,
  volatilitySigma: number,
  previousMode?: AutoMotionMode,
): AutoMotionMode {
  const threshold = autoMotionBaseThreshold(symbol, timeframe);
  if (!previousMode) {
    return volatilitySigma >= threshold ? "scalping" : "swing";
  }

  // Adaptive hysteresis: require a stronger move to switch modes, and loosen
  // or tighten the band based on current distance from threshold.
  const band = autoMotionHysteresisBand(threshold, volatilitySigma);
  const enterScalping = threshold + band * 0.5;
  const exitScalping = threshold - band * 0.5;

  if (previousMode === "swing") {
    return volatilitySigma >= enterScalping ? "scalping" : "swing";
  }
  return volatilitySigma <= exitScalping ? "swing" : "scalping";
}

function getChartMotionTuning(preset: ChartMotionPreset): ChartMotionTuning {
  if (preset === "stable" || preset === "swing") {
    return {
      smoothingBase: 0.092,
      smoothingDistanceScale: 0.0105,
      smoothingMax: 0.225,
      snapDistance: 0.26,
      inertiaDecayX: 0.848,
      inertiaDecayY: 0.832,
      inertiaImpulseX: 0.024,
      inertiaImpulseY: 0.018,
      inertiaImpulseClamp: 2.45,
      inertiaDriftClampX: 10,
      inertiaDriftClampY: 7.5,
      inertiaBlend: 0.24,
      feelBaseOpacity: 0.13,
      feelMaxExtraOpacity: 0.18,
      feelMaxScale: 1.008,
      formingWidthFactor: 0.7,
      formingWidthMax: 32,
    };
  }

  if (preset === "aggressive" || preset === "scalping") {
    return {
      smoothingBase: 0.195,
      smoothingDistanceScale: 0.021,
      smoothingMax: 0.47,
      snapDistance: 0.14,
      inertiaDecayX: 0.928,
      inertiaDecayY: 0.908,
      inertiaImpulseX: 0.062,
      inertiaImpulseY: 0.044,
      inertiaImpulseClamp: 6.2,
      inertiaDriftClampX: 26,
      inertiaDriftClampY: 19,
      inertiaBlend: 0.41,
      feelBaseOpacity: 0.25,
      feelMaxExtraOpacity: 0.54,
      feelMaxScale: 1.034,
      formingWidthFactor: 0.94,
      formingWidthMax: 44,
    };
  }

  return {
    smoothingBase: 0.14,
    smoothingDistanceScale: 0.015,
    smoothingMax: 0.34,
    snapDistance: 0.2,
    inertiaDecayX: 0.9,
    inertiaDecayY: 0.88,
    inertiaImpulseX: 0.042,
    inertiaImpulseY: 0.03,
    inertiaImpulseClamp: 4.5,
    inertiaDriftClampX: 18,
    inertiaDriftClampY: 14,
    inertiaBlend: 0.34,
    feelBaseOpacity: 0.2,
    feelMaxExtraOpacity: 0.35,
    feelMaxScale: 1.018,
    formingWidthFactor: 0.8,
    formingWidthMax: 38,
  };
}

function getOverlayPerfProfile(
  preset: ChartMotionPreset,
  resolvedPreset: "stable" | "balanced" | "aggressive" | "scalping" | "swing",
  autoSwitches5m: number,
): OverlayPerfProfile {
  const resolved = resolvedPreset === "aggressive"
    ? "scalping"
    : resolvedPreset === "stable"
      ? "swing"
      : resolvedPreset;

  // Base profile by explicit user intent, then by resolved runtime behavior.
  const profileKey = preset === "auto"
    ? (resolved === "scalping" ? "auto-scalping" : "auto-swing")
    : resolved;

  let profile: OverlayPerfProfile;
  if (profileKey === "scalping" || profileKey === "auto-scalping") {
    profile = {
      busyFrameMs: 18.1,
      busyMinFps: 51,
      busyCpuLoad: 1.08,
      criticalFrameMs: 22.0,
      criticalMinFps: 43,
      criticalCpuLoad: 1.28,
      domLevelsBusy: 12,
      domLevelsNormal: 20,
      heatmapBandsBusy: 10,
      heatmapBandsNormal: 16,
    };
  } else if (profileKey === "swing" || profileKey === "auto-swing") {
    profile = {
      busyFrameMs: 16.6,
      busyMinFps: 56,
      busyCpuLoad: 1.0,
      criticalFrameMs: 19.4,
      criticalMinFps: 48,
      criticalCpuLoad: 1.16,
      domLevelsBusy: 8,
      domLevelsNormal: 16,
      heatmapBandsBusy: 8,
      heatmapBandsNormal: 12,
    };
  } else {
    // balanced / fallback
    profile = {
      busyFrameMs: 17.2,
      busyMinFps: 54,
      busyCpuLoad: 1.04,
      criticalFrameMs: 20.5,
      criticalMinFps: 46,
      criticalCpuLoad: 1.22,
      domLevelsBusy: 10,
      domLevelsNormal: 18,
      heatmapBandsBusy: 9,
      heatmapBandsNormal: 14,
    };
  }

  if (preset === "auto" && autoSwitches5m >= 6) {
    // Auto mode becomes slightly more conservative when switching too often.
    return {
      ...profile,
      busyFrameMs: profile.busyFrameMs - 0.5,
      busyMinFps: profile.busyMinFps + 2,
      busyCpuLoad: profile.busyCpuLoad - 0.03,
      criticalFrameMs: profile.criticalFrameMs - 0.6,
      criticalMinFps: profile.criticalMinFps + 2,
      criticalCpuLoad: profile.criticalCpuLoad - 0.03,
      domLevelsBusy: Math.max(8, profile.domLevelsBusy - 2),
      domLevelsNormal: Math.max(12, profile.domLevelsNormal - 2),
      heatmapBandsBusy: Math.max(6, profile.heatmapBandsBusy - 1),
      heatmapBandsNormal: Math.max(10, profile.heatmapBandsNormal - 1),
    };
  }

  return profile;
}

/**
 * Determine if we can use incremental update() instead of full setData().
 *
 * Returns { useUpdate: true, lastCandle } if only the last candle changed (realtime tick).
 * Returns { useUpdate: false } if data structure changed (new candle or transform).
 */
function shouldUsePartialUpdate(
  newCandles: Array<{ time: number; open: number; high: number; low: number; close: number }>,
  prevCandles: Array<{ time: number; open: number; high: number; low: number; close: number }> | null,
): { useUpdate: boolean; lastCandle?: { time: number; open: number; high: number; low: number; close: number } } {
  if (!prevCandles || prevCandles.length === 0) {
    return { useUpdate: false };
  }

  if (newCandles.length === 0) {
    return { useUpdate: false };
  }

  // Same number of candles + same time → only last candle data changed (live tick)
  if (newCandles.length === prevCandles.length) {
    const lastPrev = prevCandles[prevCandles.length - 1];
    const lastNew = newCandles[newCandles.length - 1];

    if (lastPrev.time === lastNew.time) {
      // ✅ Same time = same candle, just OHLC update (realtime)
      // This is 60x faster than setData()
      return { useUpdate: true, lastCandle: lastNew };
    }
  }

  // Different number or timestamps → full redraw needed (new candle)
  return { useUpdate: false };
}

function resolveBadgeCollisions(badges: OverlayBadge[], width: number, height: number): OverlayBadge[] {
  if (badges.length <= 1) {
    return badges;
  }

  const verticalGap = 24;
  const horizontalBand = 144;
  const topLimit = 14;
  const bottomLimit = Math.max(topLimit, height - 34);

  const placed: OverlayBadge[] = [];
  const sorted = [...badges].sort((a, b) => a.top - b.top);

  for (const badge of sorted) {
    let nextTop = clamp(badge.top, topLimit, bottomLimit);
    const nextLeft = clamp(badge.left, 48, Math.max(48, width - 96));

    for (let pass = 0; pass < 10; pass += 1) {
      const collision = placed.find((candidate) => (
        Math.abs(candidate.left - nextLeft) < horizontalBand
        && Math.abs(candidate.top - nextTop) < verticalGap
      ));
      if (!collision) {
        break;
      }
      nextTop = collision.top + verticalGap;
      if (nextTop > bottomLimit) {
        nextTop = clamp(collision.top - verticalGap, topLimit, bottomLimit);
      }
    }

    placed.push({
      ...badge,
      left: nextLeft,
      top: clamp(nextTop, topLimit, bottomLimit),
    });
  }

  const byKey = new Map(placed.map((badge) => [badge.key, badge]));
  return badges.map((badge) => byKey.get(badge.key) || badge);
}

export default function InstitutionalChart({
  className,
  symbol,
  timeframe,
  mode,
  interactionMode = "full",
  frozen = false,
  chartMotionPreset = "auto",
  points,
  candles,
  overlayZones,
  liquidityZones,
  domLevels,
  heatmapLevels,
  dayVwap,
  weekVwap,
  monthVwap,
  showSessions = true,
  indicatorSeries,
  footprintRows,
  candleTransform = "none",
  onCrosshairMove,
}: Props) {
  const isLiteMode = interactionMode === "lite";
  const autoMotionModeRef = useRef<{ key: string; mode: AutoMotionMode } | null>(null);
  const autoSwitchHistoryRef = useRef<number[]>([]);
  const autoSwitchModeRef = useRef<AutoMotionMode | null>(null);
  const autoSwitchKeyRef = useRef("");
  const autoDebugPostSignatureRef = useRef("");
  const resolvedMotionPreset = useMemo<"stable" | "balanced" | "aggressive" | "scalping" | "swing">(() => {
    if (chartMotionPreset !== "auto") {
      return chartMotionPreset;
    }
    const autoKey = `${classifyAutoMotionInstrument(symbol)}|${timeframe}`;
    const previousMode = autoMotionModeRef.current && autoMotionModeRef.current.key === autoKey
      ? autoMotionModeRef.current.mode
      : undefined;
    const sigma = estimateRecentVolatility(candles, points);
    const nextMode = resolveAutoMotionPreset(symbol, timeframe, sigma, previousMode);
    autoMotionModeRef.current = { key: autoKey, mode: nextMode };
    return nextMode;
  }, [candles, chartMotionPreset, points, symbol, timeframe]);
  const motionTuning = useMemo(() => getChartMotionTuning(resolvedMotionPreset), [resolvedMotionPreset]);
  const [autoStabilityMetrics, setAutoStabilityMetrics] = useState<AutoStabilityMetrics>({
    switches5m: 0,
    switches1h: 0,
    avgIntervalSec: null,
    lastSwitchAgoSec: null,
    sparklineBuckets: new Array(12).fill(0),
  });
  const overlayPerfProfile = useMemo(
    () => getOverlayPerfProfile(chartMotionPreset, resolvedMotionPreset, autoStabilityMetrics.switches5m),
    [autoStabilityMetrics.switches5m, chartMotionPreset, resolvedMotionPreset],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const areaSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const indicatorSeriesMapRef = useRef<Map<string, ISeriesApi<"Line"> | ISeriesApi<"Histogram">>>(new Map());
  const [cursor, setCursor] = useState<CursorState>({
    visible: false,
    left: 0,
    top: 0,
    priceTop: 0,
    timeLeft: 0,
    price: "--",
    time: "--:--",
  });
  const [activeCandleOverlay, setActiveCandleOverlay] = useState<ActiveCandleOverlay | null>(null);
  const [livePulse, setLivePulse] = useState<LivePulseState | null>(null);
  const [smoothedLivePulse, setSmoothedLivePulse] = useState<LivePulseState | null>(null);
  const [formingCandleTarget, setFormingCandleTarget] = useState<FormingCandleState | null>(null);
  const [formingCandle, setFormingCandle] = useState<FormingCandleState | null>(null);
  const [inertia, setInertia] = useState<InertiaState>({ driftX: 0, driftY: 0 });
  const [chartFeel, setChartFeel] = useState<ChartFeelState>({ inertiaOpacity: motionTuning.feelBaseOpacity, inertiaScale: 1 });
  const [overlayBadges, setOverlayBadges] = useState<OverlayBadge[]>([]);
  const [activeBadgeKey, setActiveBadgeKey] = useState<string | null>(null);
  const [overlayOffsets, setOverlayOffsets] = useState<Record<string, OverlayOffset>>({});
  const [draggingBadgeKey, setDraggingBadgeKey] = useState<string | null>(null);
  const [densityLevel, setDensityLevel] = useState<DensityLevel>("normal");
  const [newCandleFlash, setNewCandleFlash] = useState(0);
  const [framePerf, setFramePerf] = useState<FramePerfState>({ fps: 60, frameTimeMs: 16.7, cpuLoad: 1 });
  const [volumeProfileOverlay, setVolumeProfileOverlay] = useState<VolumeProfileOverlayState>({
    rows: [],
    vahY: null,
    valY: null,
    pocY: null,
    degraded: false,
    pausedReason: null,
  });
  const [footprintOverlay, setFootprintOverlay] = useState<FootprintOverlayState>({
    rows: [],
    degraded: false,
    pausedReason: null,
  });
  const [domOverlay, setDomOverlay] = useState<DomOverlayState>({
    levels: [],
    imbalanceRatio: 0,
    degraded: false,
    pausedReason: null,
  });
  const [heatmapOverlay, setHeatmapOverlay] = useState<HeatmapOverlayState>({
    bands: [],
    degraded: false,
    pausedReason: null,
  });
  const [chartViewportWidth, setChartViewportWidth] = useState(1280);
  const [domSelectedKey, setDomSelectedKey] = useState<string | null>(null);
  const [domLockedWalls, setDomLockedWalls] = useState<Record<string, boolean>>({});
  const [domAnchorPrice, setDomAnchorPrice] = useState<number | null>(null);
  const [domAnchorSide, setDomAnchorSide] = useState<"bid" | "ask" | null>(null);
  const [domHoverKey, setDomHoverKey] = useState<string | null>(null);
  const [domTouchPulseKey, setDomTouchPulseKey] = useState<string | null>(null);
  const [domTouchPrimedKey, setDomTouchPrimedKey] = useState<string | null>(null);
  const [vpHoverKey, setVpHoverKey] = useState<string | null>(null);
  const [domToast, setDomToast] = useState<{ id: number; message: string } | null>(null);
  const [workerLatencyMs, setWorkerLatencyMs] = useState<number | null>(null);
  const densityConfig = useMemo(() => getDensityConfig(densityLevel), [densityLevel]);
  const dragStateRef = useRef<DragState | null>(null);
  const candleStepPxRef = useRef(12);
  const lastPriceRef = useRef<number | null>(null);
  const pulseTickRef = useRef(0);
  const livePulseMetaRef = useRef<LivePulseMeta | null>(null);
  const interactionRafRef = useRef<number | null>(null);
  const hasInitializedRangeRef = useRef(false);
  const lastRangeIdentityRef = useRef("");
  const schedulerRef = useRef<RenderScheduler | null>(null);
  const dirtyStateRef = useRef(createDirtyState());
  // sqrt curve + tanh soft-cap → TradingView-like velocity feel
  const interactionXRef = useRef(createInteractionEngine({ friction: 0.9, sensitivity: 0.002, curve: "sqrt", maxVelocity: 0.9 }));
  const interactionYRef = useRef(createInteractionEngine({ friction: 0.92, sensitivity: 0.0024, curve: "sqrt", maxVelocity: 0.7 }));
  const wheelCursorXRef = useRef(0.5);
  const densityLevelRef = useRef<DensityLevel>("normal");
  const prevCandleLengthRef = useRef(0);
  const renderUpdateCountsRef = useRef<RenderUpdateCounts>({ candle: 0, indicator: 0, overlay: 0 });
  const indicatorRequestTsRef = useRef(0);
  const intraCandleRafRef = useRef<number | null>(null);
  const intraCandleCurrentRef = useRef<CandleRenderPoint | null>(null);
  const intraCandleTargetRef = useRef<CandleRenderPoint | null>(null);
  const intraCandleFrameTsRef = useRef(0);
  const toastSeqRef = useRef(0);
  const domHoldTimerRef = useRef<number | null>(null);
  const domPressHandledRef = useRef(false);

  // ── Partial update tracking (setData vs update) ──────────────────────────────
  const prevCandlesRef = useRef<Array<{ time: number; open: number; high: number; low: number; close: number }> | null>(null);
  const prevAreaDataRef = useRef<Array<{ time: number; value: number }> | null>(null);

  const overlayStorageKey = `${OVERLAY_OFFSET_STORAGE_PREFIX}.${symbol}.${timeframe}`;
  const domLockStorageKey = `${DOM_LOCK_STORAGE_PREFIX}.${symbol}.${timeframe}`;

  useEffect(() => {
    if (!schedulerRef.current) {
      schedulerRef.current = new RenderScheduler({ frameBudgetMs: 16.7 });
    }
    return () => {
      schedulerRef.current?.clear();
      if (interactionRafRef.current) {
        window.cancelAnimationFrame(interactionRafRef.current);
        interactionRafRef.current = null;
      }
      if (intraCandleRafRef.current) {
        window.cancelAnimationFrame(intraCandleRafRef.current);
        intraCandleRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || isLiteMode || frozen) {
      setFramePerf({ fps: 60, frameTimeMs: 16.7, cpuLoad: 1 });
      return undefined;
    }

    let rafId = 0;
    let lastTs = 0;
    let emaFrameMs = 16.7;
    let accFrames = 0;
    let accMs = 0;
    let publishAt = performance.now();

    const tick = (frameTs: number) => {
      if (lastTs > 0) {
        const delta = Math.max(1, frameTs - lastTs);
        emaFrameMs = emaFrameMs * 0.88 + delta * 0.12;
        accFrames += 1;
        accMs += delta;
      }
      lastTs = frameTs;

      if (frameTs - publishAt >= 1200) {
        const fps = accMs > 0 ? (accFrames * 1000) / accMs : 60;
        const frameTimeMs = emaFrameMs;
        const cpuLoad = clamp(frameTimeMs / 16.7, 0, 3);
        setFramePerf((prev) => {
          if (
            Math.abs(prev.fps - fps) < 0.6
            && Math.abs(prev.frameTimeMs - frameTimeMs) < 0.25
            && Math.abs(prev.cpuLoad - cpuLoad) < 0.04
          ) {
            return prev;
          }
          return { fps, frameTimeMs, cpuLoad };
        });
        accFrames = 0;
        accMs = 0;
        publishAt = frameTs;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [frozen, isLiteMode]);

  useEffect(() => {
    if (typeof performance === "undefined" || isLiteMode || frozen) {
      return;
    }
    indicatorRequestTsRef.current = performance.now();
  }, [candles, frozen, isLiteMode, points, symbol, timeframe]);

  useEffect(() => {
    if (typeof performance === "undefined") {
      return;
    }
    if (!indicatorSeries || indicatorSeries.length === 0) {
      return;
    }
    if (indicatorRequestTsRef.current <= 0) {
      return;
    }
    const sampleMs = Math.max(0, performance.now() - indicatorRequestTsRef.current);
    setWorkerLatencyMs((prev) => (prev === null ? sampleMs : prev * 0.72 + sampleMs * 0.28));
  }, [indicatorSeries]);

  useEffect(() => {
    const shortWindowMs = 5 * 60 * 1000;
    const hourWindowMs = 60 * 60 * 1000;
    const sparklineBucketsCount = 12;
    const pruneAndSync = (nowTs: number) => {
      autoSwitchHistoryRef.current = autoSwitchHistoryRef.current.filter((ts) => nowTs - ts <= hourWindowMs);
      const history = autoSwitchHistoryRef.current;
      const switches5m = history.filter((ts) => nowTs - ts <= shortWindowMs).length;
      const switches1h = history.length;

      let avgIntervalSec: number | null = null;
      if (history.length >= 2) {
        let totalGapMs = 0;
        for (let idx = 1; idx < history.length; idx += 1) {
          totalGapMs += history[idx] - history[idx - 1];
        }
        avgIntervalSec = totalGapMs / (history.length - 1) / 1000;
      }

      const lastSwitchTs = history.length > 0 ? history[history.length - 1] : null;
      const lastSwitchAgoSec = lastSwitchTs ? (nowTs - lastSwitchTs) / 1000 : null;
      const bucketSpanMs = hourWindowMs / sparklineBucketsCount;
      const windowStartTs = nowTs - hourWindowMs;
      const sparklineBuckets = new Array(sparklineBucketsCount).fill(0) as number[];
      for (const ts of history) {
        const bucketIndex = clamp(Math.floor((ts - windowStartTs) / bucketSpanMs), 0, sparklineBucketsCount - 1);
        sparklineBuckets[bucketIndex] += 1;
      }

      setAutoStabilityMetrics({
        switches5m,
        switches1h,
        avgIntervalSec,
        lastSwitchAgoSec,
        sparklineBuckets,
      });
    };

    if (chartMotionPreset !== "auto") {
      autoSwitchHistoryRef.current = [];
      autoSwitchModeRef.current = null;
      autoSwitchKeyRef.current = "";
      setAutoStabilityMetrics({
        switches5m: 0,
        switches1h: 0,
        avgIntervalSec: null,
        lastSwitchAgoSec: null,
        sparklineBuckets: new Array(12).fill(0),
      });
      return undefined;
    }

    const mode = resolvedMotionPreset === "scalping" || resolvedMotionPreset === "swing"
      ? resolvedMotionPreset
      : null;
    const nextKey = `${symbol.toUpperCase()}|${classifyAutoMotionInstrument(symbol)}|${timeframe}`;
    const now = Date.now();

    if (autoSwitchKeyRef.current !== nextKey) {
      autoSwitchKeyRef.current = nextKey;
      autoSwitchHistoryRef.current = [];
      autoSwitchModeRef.current = mode;
      setAutoStabilityMetrics({
        switches5m: 0,
        switches1h: 0,
        avgIntervalSec: null,
        lastSwitchAgoSec: null,
        sparklineBuckets: new Array(12).fill(0),
      });
    } else {
      if (mode && autoSwitchModeRef.current && mode !== autoSwitchModeRef.current) {
        autoSwitchHistoryRef.current.push(now);
      }
      autoSwitchModeRef.current = mode;
      pruneAndSync(now);
    }

    const intervalId = window.setInterval(() => {
      pruneAndSync(Date.now());
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [chartMotionPreset, resolvedMotionPreset, symbol, timeframe]);

  useEffect(() => {
    if (typeof window === "undefined" || chartMotionPreset !== "auto" || isLiteMode || frozen) {
      autoDebugPostSignatureRef.current = "";
      return;
    }

    const targetBand = autoMotionTargetBand(symbol, timeframe);
    const activeIndicatorCount = indicatorSeriesMapRef.current.size;
    const overlayCount =
      overlayBadges.length
      + volumeProfileOverlay.rows.length
      + footprintOverlay.rows.length
      + domOverlay.levels.length
      + heatmapOverlay.bands.length;
    const budgetUsedPct = clamp((framePerf.frameTimeMs / Math.max(1, overlayPerfProfile.busyFrameMs)) * 100, 0, 200);
    const payload = {
      key: `${symbol.toUpperCase()}|${classifyAutoMotionInstrument(symbol)}|${timeframe}`,
      symbol,
      timeframe,
      instrumentClass: classifyAutoMotionInstrument(symbol),
      resolvedMotionPreset,
      switches5m: autoStabilityMetrics.switches5m,
      switches1h: autoStabilityMetrics.switches1h,
      avgIntervalSec: autoStabilityMetrics.avgIntervalSec,
      lastSwitchAgoSec: autoStabilityMetrics.lastSwitchAgoSec,
      targetBand,
      perfThresholds: {
        busyFrameMs: overlayPerfProfile.busyFrameMs,
        busyMinFps: overlayPerfProfile.busyMinFps,
        busyCpuLoad: overlayPerfProfile.busyCpuLoad,
        criticalFrameMs: overlayPerfProfile.criticalFrameMs,
        criticalMinFps: overlayPerfProfile.criticalMinFps,
        criticalCpuLoad: overlayPerfProfile.criticalCpuLoad,
        domLevelsBusy: overlayPerfProfile.domLevelsBusy,
        domLevelsNormal: overlayPerfProfile.domLevelsNormal,
        heatmapBandsBusy: overlayPerfProfile.heatmapBandsBusy,
        heatmapBandsNormal: overlayPerfProfile.heatmapBandsNormal,
      },
      perfRuntime: {
        fps: framePerf.fps,
        frameTimeMs: framePerf.frameTimeMs,
        cpuLoad: framePerf.cpuLoad,
        budgetUsedPct,
        lodLevel: densityLevel,
        overlayCount,
        activeIndicatorCount,
        updateCounts: {
          candle: renderUpdateCountsRef.current.candle,
          indicator: renderUpdateCountsRef.current.indicator,
          overlay: renderUpdateCountsRef.current.overlay,
        },
        workerLatencyMs,
      },
      sparklineBuckets: autoStabilityMetrics.sparklineBuckets,
      updatedAt: new Date().toISOString(),
    };
    const signature = JSON.stringify(payload);
    if (signature === autoDebugPostSignatureRef.current) {
      return;
    }
    autoDebugPostSignatureRef.current = signature;

    void fetch("/api/system/chart-auto-stability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: signature,
      keepalive: true,
      cache: "no-store",
    }).catch(() => {
      // Debug endpoint is best-effort only.
    });
  }, [
    autoStabilityMetrics.avgIntervalSec,
    autoStabilityMetrics.lastSwitchAgoSec,
    autoStabilityMetrics.sparklineBuckets,
    autoStabilityMetrics.switches1h,
    autoStabilityMetrics.switches5m,
    chartMotionPreset,
    densityLevel,
    domOverlay.levels.length,
    footprintOverlay.rows.length,
    frozen,
    isLiteMode,
    heatmapOverlay.bands.length,
    framePerf.cpuLoad,
    framePerf.fps,
    framePerf.frameTimeMs,
    overlayBadges.length,
    overlayPerfProfile.busyCpuLoad,
    overlayPerfProfile.busyFrameMs,
    overlayPerfProfile.busyMinFps,
    overlayPerfProfile.criticalCpuLoad,
    overlayPerfProfile.criticalFrameMs,
    overlayPerfProfile.criticalMinFps,
    overlayPerfProfile.domLevelsBusy,
    overlayPerfProfile.domLevelsNormal,
    overlayPerfProfile.heatmapBandsBusy,
    overlayPerfProfile.heatmapBandsNormal,
    volumeProfileOverlay.rows.length,
    workerLatencyMs,
    resolvedMotionPreset,
    symbol,
    timeframe,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      setOverlayOffsets({});
      return;
    }

    try {
      const serialized = window.localStorage.getItem(overlayStorageKey);
      if (!serialized) {
        setOverlayOffsets({});
      } else {
        const parsed = JSON.parse(serialized) as Record<string, OverlayOffset>;
        const sanitized = Object.entries(parsed || {}).reduce((acc, [key, value]) => {
          if (!value || typeof value !== "object") {
            return acc;
          }
          const x = Number((value as OverlayOffset).x);
          const y = Number((value as OverlayOffset).y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return acc;
          }
          acc[key] = { x: clamp(x, -180, 180), y: clamp(y, -140, 140) };
          return acc;
        }, {} as Record<string, OverlayOffset>);
        setOverlayOffsets(sanitized);
      }
    } catch {
      setOverlayOffsets({});
    }

    setActiveBadgeKey(null);
    setDraggingBadgeKey(null);
    dragStateRef.current = null;
  }, [overlayStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(overlayStorageKey, JSON.stringify(overlayOffsets));
    } catch {
      // Ignore storage write errors (private mode/quota).
    }
  }, [overlayOffsets, overlayStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      setDomLockedWalls({});
      return;
    }

    try {
      const serialized = window.localStorage.getItem(domLockStorageKey);
      if (!serialized) {
        setDomLockedWalls({});
      } else {
        const parsed = JSON.parse(serialized) as Record<string, unknown>;
        const sanitized = Object.entries(parsed || {}).reduce((acc, [key, value]) => {
          if (typeof value === "boolean") {
            acc[key] = value;
          }
          return acc;
        }, {} as Record<string, boolean>);
        setDomLockedWalls(sanitized);
      }
    } catch {
      setDomLockedWalls({});
    }

    setDomSelectedKey(null);
    setDomAnchorPrice(null);
    setDomAnchorSide(null);
  }, [domLockStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(domLockStorageKey, JSON.stringify(domLockedWalls));
    } catch {
      // Ignore storage write errors (private mode/quota).
    }
  }, [domLockedWalls, domLockStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined" || isLiteMode) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (event.altKey || event.metaKey || event.ctrlKey) {
        return;
      }
      const key = event.key.toLowerCase();

      if (key === "escape") {
        if (!domSelectedKey && domAnchorPrice === null) {
          return;
        }
        event.preventDefault();
        setDomSelectedKey(null);
        setDomAnchorPrice(null);
        toastSeqRef.current += 1;
        setDomToast({ id: toastSeqRef.current, message: "dom focus cleared" });
        return;
      }

      if (key === "r") {
        const hasAnyLocks = Object.values(domLockedWalls).some(Boolean);
        if (!hasAnyLocks) {
          return;
        }
        event.preventDefault();
        setDomLockedWalls({});
        toastSeqRef.current += 1;
        setDomToast({ id: toastSeqRef.current, message: "locks reset" });
        return;
      }

      if (key !== "l") {
        return;
      }

      const visibleWallKeys = domOverlay.levels.filter((level) => level.isWall).map((level) => level.lockKey);
      if (visibleWallKeys.length === 0) {
        return;
      }
      event.preventDefault();
      setDomLockedWalls((current) => {
        const allLocked = visibleWallKeys.every((key) => current[key]);
        const next = { ...current };
        for (const key of visibleWallKeys) {
          next[key] = !allLocked;
        }
        toastSeqRef.current += 1;
        setDomToast({
          id: toastSeqRef.current,
          message: `${allLocked ? "unlock" : "lock"} ${visibleWallKeys.length} walls`,
        });
        return next;
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [domAnchorPrice, domLockedWalls, domOverlay.levels, domSelectedKey, isLiteMode]);

  useEffect(() => {
    if (!domToast || typeof window === "undefined") {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setDomToast((current) => (current?.id === domToast.id ? null : current));
    }, 1350);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [domToast]);

  useEffect(() => () => {
    if (domHoldTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(domHoldTimerRef.current);
      domHoldTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!draggingBadgeKey) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }

      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      setOverlayOffsets((current) => ({
        ...current,
        [dragState.key]: {
          x: clamp(dragState.originX + deltaX, -180, 180),
          y: clamp(dragState.originY + deltaY, -140, 140),
        },
      }));
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
      setDraggingBadgeKey(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [draggingBadgeKey]);

  useEffect(() => {
    if (!livePulse) {
      return undefined;
    }

    let rafId = 0;
    let previousFrameTs = 0;
    const animate = (frameTs: number) => {
      const frameDeltaMs = previousFrameTs > 0 ? frameTs - previousFrameTs : 16.7;
      previousFrameTs = frameTs;
      const frameScale = clamp(frameDeltaMs / 16.7, 0.65, 1.8);

      setSmoothedLivePulse((current) => {
        if (!current) {
          return livePulse;
        }
        const dx = livePulse.left - current.left;
        const dy = livePulse.top - current.top;
        const distance = Math.hypot(dx, dy);
        const alphaBase = clamp(
          motionTuning.smoothingBase + distance * motionTuning.smoothingDistanceScale,
          motionTuning.smoothingBase,
          motionTuning.smoothingMax,
        );
        const alpha = 1 - Math.pow(1 - alphaBase, frameScale);
        const nextLeft = current.left + dx * alpha;
        const nextTop = current.top + dy * alpha;
        const closeEnough =
          Math.abs(nextLeft - livePulse.left) < motionTuning.snapDistance
          && Math.abs(nextTop - livePulse.top) < motionTuning.snapDistance;
        if (closeEnough) {
          return { ...livePulse };
        }
        return {
          left: nextLeft,
          top: nextTop,
          priceLabel: livePulse.priceLabel,
          tick: livePulse.tick,
        };
      });
      rafId = window.requestAnimationFrame(animate);
    };

    rafId = window.requestAnimationFrame(animate);
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [livePulse, motionTuning]);

  useEffect(() => {
    if (isLiteMode) {
      setFormingCandle(null);
      return undefined;
    }

    if (!formingCandleTarget) {
      setFormingCandle(null);
      return undefined;
    }

    let rafId = 0;
    let previousFrameTs = 0;

    const animate = (frameTs: number) => {
      const frameDeltaMs = previousFrameTs > 0 ? frameTs - previousFrameTs : 16.7;
      previousFrameTs = frameTs;
      const frameScale = clamp(frameDeltaMs / 16.7, 0.65, 1.9);

      let shouldContinue = true;
      setFormingCandle((current) => {
        if (!current) {
          return formingCandleTarget;
        }

        const deltaMax = Math.max(
          Math.abs(formingCandleTarget.left - current.left),
          Math.abs(formingCandleTarget.width - current.width),
          Math.abs(formingCandleTarget.openY - current.openY),
          Math.abs(formingCandleTarget.closeY - current.closeY),
          Math.abs(formingCandleTarget.highY - current.highY),
          Math.abs(formingCandleTarget.lowY - current.lowY),
        );
        const alphaBase = clamp(0.18 + deltaMax * 0.011, 0.16, 0.54);
        const alpha = 1 - Math.pow(1 - alphaBase, frameScale);

        const next = {
          left: current.left + (formingCandleTarget.left - current.left) * alpha,
          width: current.width + (formingCandleTarget.width - current.width) * alpha,
          openY: current.openY + (formingCandleTarget.openY - current.openY) * alpha,
          closeY: current.closeY + (formingCandleTarget.closeY - current.closeY) * alpha,
          highY: current.highY + (formingCandleTarget.highY - current.highY) * alpha,
          lowY: current.lowY + (formingCandleTarget.lowY - current.lowY) * alpha,
          direction: formingCandleTarget.direction,
        };

        const settled = Math.max(
          Math.abs(next.left - formingCandleTarget.left),
          Math.abs(next.width - formingCandleTarget.width),
          Math.abs(next.openY - formingCandleTarget.openY),
          Math.abs(next.closeY - formingCandleTarget.closeY),
          Math.abs(next.highY - formingCandleTarget.highY),
          Math.abs(next.lowY - formingCandleTarget.lowY),
        ) < 0.2;

        if (settled) {
          shouldContinue = false;
          return formingCandleTarget;
        }

        return next;
      });

      if (shouldContinue) {
        rafId = window.requestAnimationFrame(animate);
      }
    };

    rafId = window.requestAnimationFrame(animate);
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [formingCandleTarget, isLiteMode]);

  useEffect(() => {
    if (isLiteMode || frozen) {
      return undefined;
    }

    const host = containerRef.current;
    if (!host) {
      return undefined;
    }

    const applyWheelTransform = (driftX: number, driftY: number) => {
      const chart = chartRef.current;
      if (!chart) {
        return;
      }
      const timeScale = chart.timeScale();
      const containerWidth = Math.max(1, containerRef.current?.clientWidth ?? 800);
      if (Math.abs(driftX) > 0.001) {
        const currentScroll = timeScale.scrollPosition();
        const scrollImpulse = Math.sign(driftX) * Math.pow(Math.abs(driftX), 0.92);
        timeScale.scrollToPosition(currentScroll + scrollImpulse * 0.022, false);
      }
      if (Math.abs(driftY) > 0.001) {
        const range = timeScale.getVisibleLogicalRange();
        if (range) {
          const width = Math.max(1, range.to - range.from);
          const stepPxCurrent = clamp(containerWidth / width, 2, 80);
          // Non-linear zoom impulse: calmer micro-steps, stronger long wheel moves
          const zoomImpulse = Math.sign(driftY) * Math.pow(Math.abs(driftY), 1.12);
          const zoomingOut = zoomImpulse > 0;
          // Differentiated easing: zoom-in feels precise, zoom-out feels broader.
          const adaptiveK = zoomingOut
            ? 0.00315 + Math.log1p(width) * 0.00037
            : 0.00245 + Math.log1p(width) * 0.00031;
          const zoomFactor = Math.exp(zoomImpulse * adaptiveK);
          let nextWidth = clamp(width * zoomFactor, 8, 600);
          // Contextual snap on bar spacing: lock to common readable steps when close.
          const spacingTargets = [3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 52, 64];
          const nextStepPx = clamp(containerWidth / nextWidth, 2, 80);
          let bestStep = nextStepPx;
          let bestGap = Number.POSITIVE_INFINITY;
          for (const step of spacingTargets) {
            const gap = Math.abs(step - nextStepPx);
            if (gap < bestGap) {
              bestGap = gap;
              bestStep = step;
            }
          }
          const snapThreshold = clamp(stepPxCurrent * 0.1, 0.35, 1.8);
          if (bestGap <= snapThreshold) {
            nextWidth = clamp(containerWidth / bestStep, 8, 600);
          }
          // Cursor-centered zoom: anchored at mouse position, not chart center
          const cursorFrac = clamp(wheelCursorXRef.current / containerWidth, 0, 1);
          const cursorLogical = range.from + cursorFrac * width;
          const leftFrac = (cursorLogical - range.from) / width;
          const rightFrac = (range.to - cursorLogical) / width;
          timeScale.setVisibleLogicalRange({
            from: cursorLogical - leftFrac * nextWidth,
            to: cursorLogical + rightFrac * nextWidth,
          });
        }
      }
    };

    const settle = () => {
      const x = interactionXRef.current.update();
      const y = interactionYRef.current.update();
      const targetDriftX = clamp(x.delta * 35, -motionTuning.inertiaDriftClampX, motionTuning.inertiaDriftClampX);
      const targetDriftY = clamp(y.delta * 42, -motionTuning.inertiaDriftClampY, motionTuning.inertiaDriftClampY);

      if (Math.abs(x.velocity) < 0.0002 && Math.abs(y.velocity) < 0.0002) {
        setInertia({ driftX: 0, driftY: 0 });
        setChartFeel({ inertiaOpacity: motionTuning.feelBaseOpacity, inertiaScale: 1 });
        interactionRafRef.current = null;
        return;
      }

      applyWheelTransform(targetDriftX, targetDriftY);
      setInertia((current) => ({
        driftX: current.driftX + (targetDriftX - current.driftX) * motionTuning.inertiaBlend,
        driftY: current.driftY + (targetDriftY - current.driftY) * motionTuning.inertiaBlend,
      }));

      const driftPower = clamp(Math.abs(x.velocity) + Math.abs(y.velocity), 0, 1);
      setChartFeel({
        inertiaOpacity: motionTuning.feelBaseOpacity + driftPower * motionTuning.feelMaxExtraOpacity,
        inertiaScale: 1 + driftPower * (motionTuning.feelMaxScale - 1),
      });
      interactionRafRef.current = window.requestAnimationFrame(settle);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Track cursor position for cursor-centered zoom
      const rect = host.getBoundingClientRect();
      wheelCursorXRef.current = clamp(event.clientX - rect.left, 0, rect.width);
      interactionXRef.current.onWheel(-event.deltaX);
      interactionYRef.current.onWheel(-event.deltaY);
      if (!interactionRafRef.current) {
        interactionRafRef.current = window.requestAnimationFrame(settle);
      }
    };

    host.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      host.removeEventListener("wheel", onWheel);
      if (interactionRafRef.current) {
        window.cancelAnimationFrame(interactionRafRef.current);
        interactionRafRef.current = null;
      }
      interactionXRef.current.reset();
      interactionYRef.current.reset();
    };
  }, [frozen, isLiteMode, motionTuning]);

  // ── Indicator series lifecycle with viewport culling ─────────────────────────
  // Sync the indicatorSeriesMap with the current `indicatorSeries` prop.
  // Creates new LineSeries for new indicator outputs, removes stale ones.
  // VIEWPORT CULLING: Skip rendering hidden indicators (lite mode / frozen).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    // Filter: overlay indicators, but SKIP if in lite mode (viewport culling)
    // Only render overlays in full mode
    const overlayOnly = (indicatorSeries ?? [])
      .filter((s) => s.pane === "main")
      .filter((s) => !isLiteMode); // ← VIEWPORT CULLING: skip overlay indicators if lite

    // Filter: sub-chart indicators, but SKIP if frozen (viewport culling)
    // Sub-charts don't render if not visible
    const subOnly = (indicatorSeries ?? [])
      .filter((s) => s.pane === "sub")
      .filter((s) => !frozen); // ← VIEWPORT CULLING: skip sub indicatorif frozen

    // Combine both (but practically, only one set will have data at a time)
    const allDesiredSeries = [...overlayOnly, ...subOnly];
    const desiredKeys = new Set(allDesiredSeries.map((s) => `${s.indicatorId}:${s.outputKey}`));
    const existingMap = indicatorSeriesMapRef.current;

    // Remove series no longer in the desired set (or in viewport)
    for (const [key, series] of existingMap.entries()) {
      if (!desiredKeys.has(key)) {
        try {
          chart.removeSeries(series);
        } catch {
          // Series may already be removed if chart was recreated
        }
        existingMap.delete(key);
      }
    }

    const pendingIndicatorUpdates: Array<{ series: ISeriesApi<"Line">; data: Array<{ time: UTCTimestamp; value: number }> }> = [];

    // Add or update series (only those in viewport)
    for (const s of allDesiredSeries) {
      const key = `${s.indicatorId}:${s.outputKey}`;
      let lwSeries = existingMap.get(key) as ISeriesApi<"Line"> | undefined;
      const options: LineSeriesPartialOptions = {
        color: s.color,
        lineWidth: (s.lineWidth ?? 1) as 1 | 2 | 3 | 4,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceScaleId: "right",
      };

      if (!lwSeries) {
        lwSeries = chart.addLineSeries(options);
        existingMap.set(key, lwSeries);
      } else {
        lwSeries.applyOptions(options);
      }

      const formattedData = s.data.map((point) => ({
        time: point.time as UTCTimestamp,
        value: point.value,
      }));
      pendingIndicatorUpdates.push({ series: lwSeries, data: formattedData });
    }

    if (pendingIndicatorUpdates.length > 0) {
      dirtyStateRef.current.indicator = true;
      const scheduler = schedulerRef.current;
      const applyUpdates = () => {
        if (!dirtyStateRef.current.indicator) {
          return;
        }
        for (const update of pendingIndicatorUpdates) {
          try {
            update.series.setData(update.data);
          } catch {
            // Ignore malformed or transient data order issues.
          }
        }
        renderUpdateCountsRef.current.indicator += 1;
        dirtyStateRef.current.indicator = false;
      };
      if (scheduler) {
        scheduler.enqueue({ type: "indicator", priority: LAYER_PRIORITY.indicator, callback: applyUpdates });
      } else {
        applyUpdates();
      }
    }
  }, [frozen, isLiteMode, indicatorSeries]);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "rgba(7,11,18,0.01)" },
        textColor: "rgba(232,240,249,0.86)",
        fontSize: 12,
      },
      grid: {
        vertLines: { color: "rgba(120,147,188,0.12)" },
        horzLines: { color: "rgba(120,147,188,0.16)" },
      },
      rightPriceScale: {
        borderColor: "rgba(120,147,188,0.24)",
        scaleMargins: { top: 0.1, bottom: 0.12 },
      },
      timeScale: {
        borderColor: "rgba(120,147,188,0.24)",
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: false,
        rightOffset: isLiteMode ? 1.5 : 4,
        barSpacing: isLiteMode ? 9.5 : 13.8,
        minBarSpacing: isLiteMode ? 5.5 : 7.2,
      },
      localization: {
        priceFormatter: formatCompactPrice,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: "rgba(126,215,255,0.72)",
          width: 1,
          labelBackgroundColor: "#0b1524",
        },
        horzLine: {
          color: "rgba(126,215,255,0.72)",
          width: 1,
          labelBackgroundColor: "#0b1524",
        },
      },
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: !isLiteMode,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: false,
        pinch: !isLiteMode,
        axisPressedMouseMove: !isLiteMode,
      },
    });

    const areaSeries = chart.addAreaSeries(AREA_OPTIONS);
    const candleSeries = chart.addCandlestickSeries(CANDLE_OPTIONS);
    chartRef.current = chart;
    areaSeriesRef.current = areaSeries;
    candleSeriesRef.current = candleSeries;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || !chartRef.current) {
        return;
      }
      setChartViewportWidth(Math.floor(entry.contentRect.width));
      chartRef.current.applyOptions({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      });
      chartRef.current.timeScale().fitContent();
    });
    resizeObserver.observe(containerRef.current);

    const handleCrosshair = (param: MouseEventParams<Time>) => {
      if (isLiteMode || frozen) {
        return;
      }

      const container = containerRef.current;
      if (!container || !param.point || !param.time) {
        setCursor((current) => ({ ...current, visible: false }));
        if (onCrosshairMove) {
          onCrosshairMove(null);
        }
        return;
      }

      const activeSeries = mode === "line" ? areaSeriesRef.current : candleSeriesRef.current;
      const rawPrice: unknown = activeSeries ? (param.seriesData as Map<unknown, unknown>).get(activeSeries) : null;
      let price = "--";

      if (typeof rawPrice === "number") {
        price = rawPrice.toFixed(2);
      } else if (rawPrice && typeof rawPrice === "object" && "close" in (rawPrice as Record<string, unknown>)) {
        price = Number((rawPrice as { close: number }).close || 0).toFixed(2);
      }

      setCursor({
        visible: true,
        left: clamp(param.point.x, 0, container.clientWidth),
        top: clamp(param.point.y, 0, container.clientHeight),
        priceTop: clamp(param.point.y, 18, Math.max(18, container.clientHeight - 18)),
        timeLeft: clamp(param.point.x, 58, Math.max(58, container.clientWidth - 58)),
        price,
        time: formatCursorTime(param.time),
      });

      const timeCoord = chart.timeScale().timeToCoordinate(param.time);
      if (timeCoord !== null) {
        setActiveCandleOverlay({
          left: clamp(timeCoord, 0, container.clientWidth),
          width: clamp(candleStepPxRef.current * 0.94, 10, 62),
          source: "crosshair",
        });
      }

      if (onCrosshairMove) {
        const numericPrice = Number(price);
        onCrosshairMove(Number.isFinite(numericPrice)
          ? { price: numericPrice, timeLabel: formatCursorTime(param.time), timeKey: timeToBucketKey(param.time, timeframe) }
          : null);
      }
    };

    if (!isLiteMode) {
      chart.subscribeCrosshairMove(handleCrosshair);
    }

    // ── Density: update overlay complexity on every zoom/scroll ──────────
    const handleRangeChange = () => {
      const c = containerRef.current;
      if (!c) return;
      const r = chart.timeScale().getVisibleLogicalRange();
      if (!r) return;
      const barsVisible = Math.max(1, r.to - r.from);
      const estStepPx = Math.max(2, c.clientWidth / barsVisible);
      candleStepPxRef.current = clamp(estStepPx, 2, 80);
      const next = getDensityLevel(estStepPx);
      if (next !== densityLevelRef.current) {
        densityLevelRef.current = next;
        setDensityLevel(next);
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);

    return () => {
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange);
      if (intraCandleRafRef.current) {
        window.cancelAnimationFrame(intraCandleRafRef.current);
        intraCandleRafRef.current = null;
      }
      intraCandleCurrentRef.current = null;
      intraCandleTargetRef.current = null;
      intraCandleFrameTsRef.current = 0;
      if (!isLiteMode) {
        chart.unsubscribeCrosshairMove(handleCrosshair);
      }
      // Clear all indicator series refs; the chart will be destroyed anyway
      indicatorSeriesMapRef.current.clear();
      chart.remove();
      chartRef.current = null;
      areaSeriesRef.current = null;
      candleSeriesRef.current = null;
    };
  }, [frozen, isLiteMode, mode, onCrosshairMove, timeframe]);

  useEffect(() => {
    const chart = chartRef.current;
    const areaSeries = areaSeriesRef.current;
    const candleSeries = candleSeriesRef.current;
    const container = containerRef.current;
    if (!chart || !areaSeries || !candleSeries || !container) {
      return;
    }

    if (frozen) {
      return;
    }

    const pointTimes = normalizeTimes(points.map((point) => point.label), timeframe);
    const candleLabels = candles.length > 0 ? candles.map((candle) => candle.label) : points.map((point) => point.label);
    const candleTimes = normalizeTimes(candleLabels, timeframe);

    const areaData = points.map((point, index) => ({
      time: pointTimes[index],
      value: point.value,
    }));

    // Build raw OHLCV array then apply LOD + transform if requested
    const rawCandleSource = (candles.length > 0 ? candles : points.map((point) => ({
      label: point.label,
      open: point.value,
      high: point.value,
      low: point.value,
      close: point.value,
      volume: 0,
    })));

    const rawBarsForRender = rawCandleSource.map((c, i) => ({
      time: Number(candleTimes[i]),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    const densityBlocksVolumeProfile = densityLevel === "micro";
    const perfBusy =
      framePerf.frameTimeMs > overlayPerfProfile.busyFrameMs
      || framePerf.fps < overlayPerfProfile.busyMinFps
      || framePerf.cpuLoad > overlayPerfProfile.busyCpuLoad;
    const perfCritical =
      framePerf.frameTimeMs > overlayPerfProfile.criticalFrameMs
      || framePerf.fps < overlayPerfProfile.criticalMinFps
      || framePerf.cpuLoad > overlayPerfProfile.criticalCpuLoad;
    const canRenderVolumeProfile = !isLiteMode && !frozen && mode !== "line" && mode !== "footprint" && !densityBlocksVolumeProfile && !perfCritical;
    const canRenderFootprint = !isLiteMode && !frozen && mode === "footprint" && !densityBlocksVolumeProfile && !perfCritical;
    const canRenderDom = !isLiteMode && !frozen && mode === "candles" && !densityBlocksVolumeProfile && !perfCritical;
    const canRenderHeatmap = !isLiteMode && !frozen && mode === "candles" && !densityBlocksVolumeProfile && !perfCritical;

    if (canRenderHeatmap && heatmapLevels && heatmapLevels.length > 0) {
      const referencePrice = rawBarsForRender[rawBarsForRender.length - 1]?.close ?? points[points.length - 1]?.value ?? 0;
      const maxBands = perfBusy ? overlayPerfProfile.heatmapBandsBusy : overlayPerfProfile.heatmapBandsNormal;
      const levels = [...heatmapLevels]
        .sort((left, right) => right.intensity - left.intensity)
        .slice(0, maxBands);
      const nextBands: HeatmapOverlayBand[] = [];
      for (let index = 0; index < levels.length; index += 1) {
        const level = levels[index];
        const y = candleSeries.priceToCoordinate(level.price);
        if (y === null) {
          continue;
        }
        const distanceRatio = referencePrice > 0 ? Math.abs(level.price - referencePrice) / referencePrice : 0;
        const focus: HeatmapOverlayBand["focus"] = distanceRatio <= 0.001
          ? "core"
          : distanceRatio <= 0.0025
            ? "near"
            : "far";
        const bandHeight = focus === "core" ? (perfBusy ? 9 : 11) : (perfBusy ? 8 : 10);
        const top = clamp(y - bandHeight * 0.5, 0, Math.max(0, container.clientHeight - bandHeight));
        const focusBoost = focus === "core" ? 0.12 : focus === "near" ? 0.05 : -0.04;
        const opacity = clamp(level.intensity * (perfBusy ? 0.33 : 0.42) + focusBoost, 0.08, 0.62);
        nextBands.push({
          key: `hm-${index}-${level.side}`,
          top,
          height: bandHeight,
          opacity,
          side: level.side,
          focus,
        });
      }

      setHeatmapOverlay({
        bands: nextBands,
        degraded: perfBusy,
        pausedReason: null,
      });
    } else {
      const pausedReason: HeatmapOverlayState["pausedReason"] = isLiteMode
        ? "lite"
        : frozen
          ? "frozen"
          : mode !== "candles"
            ? "mode"
            : densityBlocksVolumeProfile
              ? "density"
              : "perf";
      setHeatmapOverlay({ bands: [], degraded: false, pausedReason });
    }

    if (canRenderDom && domLevels && domLevels.length > 0) {
      const levelsLimit = perfBusy ? overlayPerfProfile.domLevelsBusy : overlayPerfProfile.domLevelsNormal;
      const perSide = Math.max(4, Math.floor(levelsLimit / 2));
      const asks = domLevels
        .filter((level) => level.side === "ask")
        .sort((left, right) => left.price - right.price)
        .slice(0, perSide);
      const bids = domLevels
        .filter((level) => level.side === "bid")
        .sort((left, right) => right.price - left.price)
        .slice(0, perSide);
      const merged = [...asks.reverse(), ...bids].slice(0, levelsLimit);

      const askTotal = asks.reduce((sum, level) => sum + Math.max(0, level.size), 0);
      const bidTotal = bids.reduce((sum, level) => sum + Math.max(0, level.size), 0);
      const denom = Math.max(1, askTotal + bidTotal);
      const imbalanceRatio = clamp((bidTotal - askTotal) / denom, -1, 1);
      const maxDomSize = Math.max(1, ...merged.map((level) => Math.max(0, level.size)));

      setDomOverlay({
        levels: merged.map((level, index) => ({
          key: `dom-${index}-${level.side}`,
          lockKey: `${level.side}-${level.price.toFixed(5)}`,
          side: level.side,
          price: level.price,
          size: level.size,
          intensity: clamp(level.intensity, 0.12, 1),
          isWall: level.size >= maxDomSize * 0.74 || level.intensity >= (perfBusy ? 0.88 : 0.82),
        })),
        imbalanceRatio,
        degraded: perfBusy,
        pausedReason: null,
      });
    } else {
      const pausedReason: DomOverlayState["pausedReason"] = isLiteMode
        ? "lite"
        : frozen
          ? "frozen"
          : mode !== "candles"
            ? "mode"
            : densityBlocksVolumeProfile
              ? "density"
              : "perf";
      setDomOverlay({ levels: [], imbalanceRatio: 0, degraded: false, pausedReason });
    }

    if (canRenderFootprint) {
      const fallbackRows = rawBarsForRender.slice(-(perfBusy ? 6 : 8)).map((bar) => {
        const bullish = bar.close >= bar.open;
        const buyVolume = (bullish ? 0.62 : 0.38) * Math.max(0, bar.volume || 0);
        const sellVolume = Math.max(0, bar.volume || 0) - buyVolume;
        return {
          low: bar.low,
          high: bar.high,
          buyVolume,
          sellVolume,
          delta: buyVolume - sellVolume,
          timeLabel: formatCursorTime(bar.time as UTCTimestamp),
        };
      });
      const sourceRows = (footprintRows && footprintRows.length > 0 ? footprintRows : fallbackRows).slice(0, perfBusy ? 6 : 8);
      const mappedRows: FootprintOverlayRow[] = [];
      const totalVolumes = sourceRows
        .map((row) => Math.max(0, row.buyVolume) + Math.max(0, row.sellVolume))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((left, right) => left - right);
      const baselineTotalVolume = totalVolumes.length > 0
        ? totalVolumes[Math.min(totalVolumes.length - 1, Math.floor(totalVolumes.length * 0.6))]
        : 0;
      const absorptionMinVolume = Math.max(1, baselineTotalVolume * 1.15);

      for (let index = 0; index < sourceRows.length; index += 1) {
        const row = sourceRows[index];
        const yHigh = candleSeries.priceToCoordinate(row.high);
        const yLow = candleSeries.priceToCoordinate(row.low);
        if (yHigh === null || yLow === null) {
          continue;
        }
        const top = clamp(Math.min(yHigh, yLow), 0, container.clientHeight);
        const height = clamp(Math.abs(yLow - yHigh), 18, 54);
        const buyVolume = Math.max(0, row.buyVolume);
        const sellVolume = Math.max(0, row.sellVolume);
        const total = Math.max(1, buyVolume + sellVolume);
        const deltaRatio = clamp(row.delta / total, -1, 1);
        const dominant = Math.max(buyVolume, sellVolume);
        const weaker = Math.max(1, Math.min(buyVolume, sellVolume));
        const dominanceRatio = dominant / weaker;
        const imbalanceSide: FootprintOverlayRow["imbalanceSide"] = buyVolume > sellVolume * 1.8
          ? "buy"
          : sellVolume > buyVolume * 1.8
            ? "sell"
            : "none";
        const imbalanceStrength = imbalanceSide === "none"
          ? 0
          : clamp((dominanceRatio - 1.8) / 2.8, 0, 1);
        const absorption = total >= absorptionMinVolume && Math.abs(deltaRatio) <= 0.16;
        mappedRows.push({
          key: `fp-${index}`,
          top,
          height,
          price: (row.low + row.high) / 2,
          buyVolume,
          sellVolume,
          delta: row.delta,
          deltaRatio,
          imbalanceSide,
          imbalanceStrength,
          absorption,
          timeLabel: row.timeLabel || "-",
        });
      }

      setFootprintOverlay({
        rows: mappedRows,
        degraded: perfBusy,
        pausedReason: null,
      });
    } else {
      const pausedReason: FootprintOverlayState["pausedReason"] = isLiteMode
        ? "lite"
        : frozen
          ? "frozen"
          : mode !== "footprint"
            ? "mode"
            : densityBlocksVolumeProfile
              ? "density"
              : "perf";
      setFootprintOverlay({ rows: [], degraded: false, pausedReason });
    }

    if (canRenderVolumeProfile) {
      const profileLookback = perfBusy
        ? (densityLevel === "expanded" ? 96 : densityLevel === "normal" ? 80 : 64)
        : (densityLevel === "expanded" ? 160 : densityLevel === "normal" ? 128 : 96);
      const profileBins = perfBusy
        ? (densityLevel === "expanded" ? 18 : densityLevel === "normal" ? 16 : 12)
        : (densityLevel === "expanded" ? 28 : densityLevel === "normal" ? 24 : 18);
      const profileBars = rawBarsForRender.slice(-profileLookback);
      const profile = volumeProfile(profileBars, profileBins);
      const profileRows: VolumeProfileOverlayRow[] = [];
      const totalProfileVolume = profile.reduce((sum, bin) => sum + Math.max(0, bin.totalVol), 0);
      const pocIndex = profile.findIndex((bin) => bin.isPoc);
      const valueAreaTarget = totalProfileVolume * 0.7;
      const includedIndexes = new Set<number>();
      let vahIndex = -1;
      let valIndex = -1;

      if (profile.length > 0 && pocIndex >= 0) {
        let includedVolume = Math.max(0, profile[pocIndex].totalVol);
        includedIndexes.add(pocIndex);
        let left = pocIndex - 1;
        let right = pocIndex + 1;

        while (includedVolume < valueAreaTarget && (left >= 0 || right < profile.length)) {
          const leftVol = left >= 0 ? Math.max(0, profile[left].totalVol) : -1;
          const rightVol = right < profile.length ? Math.max(0, profile[right].totalVol) : -1;
          if (rightVol > leftVol) {
            includedIndexes.add(right);
            includedVolume += Math.max(0, profile[right].totalVol);
            right += 1;
          } else {
            includedIndexes.add(left);
            includedVolume += Math.max(0, profile[left].totalVol);
            left -= 1;
          }
        }

        const included = [...includedIndexes];
        vahIndex = Math.max(...included);
        valIndex = Math.min(...included);
      }

      const sessionBinTotals: number[][] = [
        Array.from({ length: profile.length }, () => 0),
        Array.from({ length: profile.length }, () => 0),
        Array.from({ length: profile.length }, () => 0),
      ];
      const profileLow = profile.length > 0 ? profile[0].priceLow : 0;
      const profileBinSize = profile.length > 0
        ? Math.max(profile[0].priceHigh - profile[0].priceLow, 0.0001)
        : 1;

      if (profile.length > 0 && profileBars.length > 0) {
        const cut1 = Math.floor(profileBars.length / 3);
        const cut2 = Math.floor((profileBars.length * 2) / 3);
        for (let barIdx = 0; barIdx < profileBars.length; barIdx += 1) {
          const bar = profileBars[barIdx];
          const sessionIndex = barIdx < cut1 ? 0 : barIdx < cut2 ? 1 : 2;
          const startBin = clamp(Math.floor((bar.low - profileLow) / profileBinSize), 0, Math.max(0, profile.length - 1));
          const endBin = clamp(Math.floor((bar.high - profileLow) / profileBinSize), 0, Math.max(0, profile.length - 1));
          const span = Math.max(1, endBin - startBin + 1);
          for (let binIdx = startBin; binIdx <= endBin; binIdx += 1) {
            sessionBinTotals[sessionIndex][binIdx] += Math.max(0, bar.volume) / span;
          }
        }
      }

      let vahY: number | null = null;
      let valY: number | null = null;
      let pocY: number | null = null;

      for (let index = 0; index < profile.length; index += 1) {
        const bin = profile[index];
        if (!Number.isFinite(bin.totalVol) || bin.totalVol <= 0 || bin.pct < 0.025) {
          continue;
        }
        const yHigh = candleSeries.priceToCoordinate(bin.priceHigh);
        const yLow = candleSeries.priceToCoordinate(bin.priceLow);
        if (yHigh === null || yLow === null) {
          continue;
        }
        const top = clamp(Math.min(yHigh, yLow), 0, container.clientHeight);
        const height = clamp(Math.abs(yLow - yHigh), 1.5, 40);
        const buyPct = bin.totalVol > 0 ? clamp(bin.buyVol / bin.totalVol, 0, 1) : 0.5;
        const imbalance = buyPct * 2 - 1;
        const asiaVol = sessionBinTotals[0][index] || 0;
        const londonVol = sessionBinTotals[1][index] || 0;
        const newYorkVol = sessionBinTotals[2][index] || 0;
        const sortedSession = [
          { key: "asia" as const, vol: asiaVol },
          { key: "london" as const, vol: londonVol },
          { key: "newyork" as const, vol: newYorkVol },
        ].sort((left, right) => right.vol - left.vol);
        const primary = sortedSession[0];
        const secondary = sortedSession[1];
        const sessionBias: VolumeProfileOverlayRow["sessionBias"] = primary.vol > 0 && primary.vol > secondary.vol * 1.15
          ? primary.key
          : "mixed";
        const sessionTotal = Math.max(1, asiaVol + londonVol + newYorkVol);
        const sessionConfidence = clamp(primary.vol / sessionTotal, 0, 1);
        const centerY = top + height * 0.5;
        if (bin.isPoc) {
          pocY = centerY;
        }
        if (index === vahIndex) {
          vahY = centerY;
        }
        if (index === valIndex) {
          valY = centerY;
        }
        profileRows.push({
          key: `vp-${index}`,
          top,
          height,
          priceMid: bin.priceMid,
          totalVol: Math.max(0, bin.totalVol),
          widthPct: clamp(bin.pct, 0.04, 1),
          buyPct,
          imbalance,
          isPoc: bin.isPoc,
          isVah: index === vahIndex,
          isVal: index === valIndex,
          sessionBias,
          sessionConfidence,
        });
      }

      setVolumeProfileOverlay({
        rows: profileRows,
        vahY,
        valY,
        pocY,
        degraded: perfBusy,
        pausedReason: null,
      });
    } else {
      const pausedReason: VolumeProfileOverlayState["pausedReason"] = isLiteMode
        ? "lite"
        : frozen
          ? "frozen"
          : mode === "line"
            ? "mode"
            : densityBlocksVolumeProfile
              ? "density"
              : "perf";
      setVolumeProfileOverlay({ rows: [], vahY: null, valY: null, pocY: null, degraded: false, pausedReason });
    }

    const range = chart.timeScale().getVisibleLogicalRange();
    const visibleBars = range ? Math.max(1, Math.ceil(range.to - range.from)) : rawBarsForRender.length;
    const lodBars = applyDynamicLod(rawBarsForRender, visibleBars);

    let candleData: Array<{ time: UTCTimestamp; open: number; high: number; low: number; close: number }>;

    if (candleTransform === "heikin-ashi" && lodBars.length > 0) {
      const ha = heikinAshi(lodBars);
      candleData = ha.map((bar) => ({
        time: bar.time as UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }));
    } else {
      candleData = lodBars.map((bar) => ({
        time: bar.time as UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }));
    }
    // ── New candle flash: detect when a new bar opens ──────────────────
    if (prevCandleLengthRef.current > 0 && candleData.length > prevCandleLengthRef.current) {
      setNewCandleFlash((v) => v + 1);
    }
    prevCandleLengthRef.current = candleData.length;

    dirtyStateRef.current.candle = true;
    const scheduler = schedulerRef.current;

    const stopIntraCandleInterpolation = () => {
      if (intraCandleRafRef.current) {
        window.cancelAnimationFrame(intraCandleRafRef.current);
        intraCandleRafRef.current = null;
      }
      intraCandleFrameTsRef.current = 0;
    };

    const startIntraCandleInterpolation = () => {
      if (intraCandleRafRef.current) {
        return;
      }

      const animate = (frameTs: number) => {
        const target = intraCandleTargetRef.current;
        const current = intraCandleCurrentRef.current;
        const series = candleSeriesRef.current;
        if (!target || !current || !series || mode === "line") {
          intraCandleRafRef.current = null;
          intraCandleFrameTsRef.current = 0;
          return;
        }

        const frameDeltaMs = intraCandleFrameTsRef.current > 0 ? frameTs - intraCandleFrameTsRef.current : 16.7;
        intraCandleFrameTsRef.current = frameTs;
        const frameScale = clamp(frameDeltaMs / 16.7, 0.65, 1.9);

        const spread = Math.max(
          Math.abs(target.open - current.open),
          Math.abs(target.high - current.high),
          Math.abs(target.low - current.low),
          Math.abs(target.close - current.close),
        );
        const alphaBase = clamp(0.2 + spread * 0.01, 0.18, 0.6);
        const alpha = 1 - Math.pow(1 - alphaBase, frameScale);

        const next: CandleRenderPoint = {
          time: target.time,
          open: current.open + (target.open - current.open) * alpha,
          high: current.high + (target.high - current.high) * alpha,
          low: current.low + (target.low - current.low) * alpha,
          close: current.close + (target.close - current.close) * alpha,
        };
        next.high = Math.max(next.high, next.open, next.close);
        next.low = Math.min(next.low, next.open, next.close);

        try {
          series.update(next as any);
        } catch {
          intraCandleRafRef.current = null;
          intraCandleFrameTsRef.current = 0;
          return;
        }

        intraCandleCurrentRef.current = next;
        const settled = Math.max(
          Math.abs(next.open - target.open),
          Math.abs(next.high - target.high),
          Math.abs(next.low - target.low),
          Math.abs(next.close - target.close),
        ) < 1e-4;

        if (settled) {
          intraCandleRafRef.current = null;
          intraCandleFrameTsRef.current = 0;
          intraCandleCurrentRef.current = target;
          return;
        }

        intraCandleRafRef.current = window.requestAnimationFrame(animate);
      };

      intraCandleRafRef.current = window.requestAnimationFrame(animate);
    };

    const applyCandleUpdate = () => {
      if (!dirtyStateRef.current.candle) {
        return;
      }

      const { useUpdate, lastCandle } = shouldUsePartialUpdate(candleData as any, prevCandlesRef.current);
      if (useUpdate && lastCandle && mode !== "line") {
        const lastPoint = {
          time: Number(lastCandle.time),
          open: Number(lastCandle.open),
          high: Number(lastCandle.high),
          low: Number(lastCandle.low),
          close: Number(lastCandle.close),
        } as CandleRenderPoint;
        const previousPoint = intraCandleCurrentRef.current;
        try {
          if (previousPoint && previousPoint.time === lastPoint.time) {
            intraCandleTargetRef.current = lastPoint;
            startIntraCandleInterpolation();
          } else {
            stopIntraCandleInterpolation();
            candleSeries.update(lastPoint as any);
            intraCandleCurrentRef.current = lastPoint;
            intraCandleTargetRef.current = lastPoint;
          }
        } catch {
          stopIntraCandleInterpolation();
          candleSeries.setData(candleData as any);
          intraCandleCurrentRef.current = lastPoint;
          intraCandleTargetRef.current = lastPoint;
        }
      } else {
        stopIntraCandleInterpolation();
        areaSeries.setData(areaData);
        candleSeries.setData(candleData as any);
        const finalPoint = candleData.length > 0 ? candleData[candleData.length - 1] : null;
        intraCandleCurrentRef.current = finalPoint
          ? {
            time: Number(finalPoint.time),
            open: Number(finalPoint.open),
            high: Number(finalPoint.high),
            low: Number(finalPoint.low),
            close: Number(finalPoint.close),
          }
          : null;
        intraCandleTargetRef.current = intraCandleCurrentRef.current;
      }

      areaSeries.applyOptions({ visible: mode === "line" });
      candleSeries.applyOptions({
        ...resolveCandleContrastOptions(symbol, timeframe),
        visible: mode !== "line",
      });
      prevCandlesRef.current = candleData as any;
      prevAreaDataRef.current = areaData;
      renderUpdateCountsRef.current.candle += 1;
      dirtyStateRef.current.candle = false;
    };
    if (scheduler) {
      scheduler.enqueue({ type: "candle", priority: LAYER_PRIORITY.candle, callback: applyCandleUpdate });
    } else {
      applyCandleUpdate();
    }

    const activeSeries = mode === "line" ? areaSeries : candleSeries;
    const timeScale = chart.timeScale();
    const overlaySourceTimes = pointTimes;
    const nextBadges: OverlayBadge[] = [];

    const renderedCandleTimes = candleData.map((entry) => entry.time);
    const activeTimes = mode === "line" ? pointTimes : renderedCandleTimes;
    const activeValues = mode === "line"
      ? areaData.map((entry) => entry.value)
      : candleData.map((entry) => entry.close);

    const rangeIdentity = `${symbol}|${timeframe}|${mode}|${candleTransform}`;
    if (lastRangeIdentityRef.current !== rangeIdentity) {
      hasInitializedRangeRef.current = false;
      lastRangeIdentityRef.current = rangeIdentity;
    }

    if (!hasInitializedRangeRef.current && activeTimes.length > 12) {
      const rightPad = isLiteMode ? 1 : 2;
      const visibleBars = isLiteMode ? 96 : 150;
      const to = activeTimes.length - 1 + rightPad;
      const from = Math.max(0, to - visibleBars);
      chart.timeScale().setVisibleLogicalRange({ from, to });
      hasInitializedRangeRef.current = true;
    }

    const coordinates = activeTimes.reduce<number[]>((acc, time) => {
      const coordinate = timeScale.timeToCoordinate(time);
      if (coordinate !== null) {
        acc.push(Number(coordinate));
      }
      return acc;
    }, []);
    if (coordinates.length >= 2) {
      const deltas: number[] = [];
      for (let idx = 1; idx < coordinates.length; idx += 1) {
        const delta = coordinates[idx] - coordinates[idx - 1];
        if (Number.isFinite(delta) && delta > 0) {
          deltas.push(delta);
        }
      }
      if (deltas.length > 0) {
        const avgDelta = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
        candleStepPxRef.current = clamp(avgDelta, 8, 64);
      }
    }

    const lastTime = activeTimes.length > 0 ? activeTimes[activeTimes.length - 1] : null;
    const lastValue = activeValues.length > 0 ? activeValues[activeValues.length - 1] : null;
    if (!isLiteMode && lastTime && Number.isFinite(lastValue)) {
      const lastX = timeScale.timeToCoordinate(lastTime);
      const lastY = activeSeries.priceToCoordinate(Number(lastValue));
      if (lastX !== null && lastY !== null) {
        const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
        const clampedLeft = clamp(lastX, 0, container.clientWidth);
        const clampedTop = clamp(lastY, 0, container.clientHeight);
        const prevMeta = livePulseMetaRef.current;
        const deltaFromPrev = prevMeta ? Math.hypot(clampedLeft - prevMeta.left, clampedTop - prevMeta.top) : Number.POSITIVE_INFINITY;
        const updateIntervalMs = prevMeta ? nowMs - prevMeta.updatedAt : Number.POSITIVE_INFINITY;

        const skipPulseUpdate = Boolean(prevMeta && updateIntervalMs < 45 && deltaFromPrev < 0.45);

        if (skipPulseUpdate) {
          lastPriceRef.current = Number(lastValue);
        }

        if (!skipPulseUpdate) {
          const significantPriceMove = lastPriceRef.current !== null && Math.abs(Number(lastValue) - lastPriceRef.current) > 1e-9;
          const shouldPulse =
            significantPriceMove
            && (!prevMeta || (deltaFromPrev >= 1.4 && nowMs - prevMeta.lastPulseAt >= 120));

          if (shouldPulse) {
            pulseTickRef.current += 1;
          }

          lastPriceRef.current = Number(lastValue);
          livePulseMetaRef.current = {
            left: clampedLeft,
            top: clampedTop,
            updatedAt: nowMs,
            lastPulseAt: shouldPulse ? nowMs : (prevMeta?.lastPulseAt ?? nowMs),
          };

          setLivePulse({
            left: clampedLeft,
            top: clampedTop,
            priceLabel: formatCompactPrice(Number(lastValue)),
            tick: pulseTickRef.current,
          });
          if (!cursor.visible) {
            setActiveCandleOverlay({
              left: clamp(lastX, 0, container.clientWidth),
              width: clamp(candleStepPxRef.current * 0.98, 11, 64),
              source: "live",
            });
          }
        }
      }
    }

    if (!isLiteMode && candleData.length > 0 && mode !== "line") {
      const forming = candleData[candleData.length - 1];
      const formingX = timeScale.timeToCoordinate(forming.time);
      const openY = activeSeries.priceToCoordinate(forming.open);
      const closeY = activeSeries.priceToCoordinate(forming.close);
      const highY = activeSeries.priceToCoordinate(forming.high);
      const lowY = activeSeries.priceToCoordinate(forming.low);
      if (formingX !== null && openY !== null && closeY !== null && highY !== null && lowY !== null) {
        const direction = forming.close > forming.open ? "up" : forming.close < forming.open ? "down" : "flat";
        setFormingCandleTarget({
          left: clamp(formingX, 0, container.clientWidth),
          width: clamp(candleStepPxRef.current * (motionTuning.formingWidthFactor + 0.08), 11, motionTuning.formingWidthMax + 5),
          openY: clamp(openY, 0, container.clientHeight),
          closeY: clamp(closeY, 0, container.clientHeight),
          highY: clamp(highY, 0, container.clientHeight),
          lowY: clamp(lowY, 0, container.clientHeight),
          direction,
        });
      }
    } else {
      setFormingCandleTarget(null);
    }

    if (!isLiteMode) {
      for (const [index, zone] of overlayZones.entries()) {
        const startTime = overlaySourceTimes[Math.max(0, Math.min(overlaySourceTimes.length - 1, zone.x1))];
        const endTime = overlaySourceTimes[Math.max(0, Math.min(overlaySourceTimes.length - 1, zone.x2))];
        const startX = startTime ? timeScale.timeToCoordinate(startTime) : null;
        const endX = endTime ? timeScale.timeToCoordinate(endTime) : null;
        const y = activeSeries.priceToCoordinate(zone.high);
        if (startX === null || endX === null || y === null) {
          continue;
        }
        nextBadges.push({
          key: `zone-${index}`,
          left: clamp((startX + endX) / 2, 48, container.clientWidth - 128),
          top: clamp(y - 28, 14, container.clientHeight - 56),
          text: zone.label,
          tone: zone.kind === "fvg" ? "good" : "accent",
          kind: "zone",
          detail: `${zone.kind.toUpperCase()} ${zone.low.toFixed(1)}-${zone.high.toFixed(1)}`,
          price: zone.high,
        });
      }

      for (const [index, zone] of liquidityZones.entries()) {
        const y = activeSeries.priceToCoordinate(zone.level);
        if (y === null) {
          continue;
        }
        nextBadges.push({
          key: `liq-${index}`,
          left: clamp(container.clientWidth - 106, 48, container.clientWidth - 106),
          top: clamp(y - 11, 14, container.clientHeight - 34),
          text: `Liq ${zone.level.toFixed(0)}`,
          tone: "warn",
          kind: "liquidity",
          detail: `${zone.label} ${zone.level.toFixed(2)}`,
          price: zone.level,
        });
      }
    }

    dirtyStateRef.current.overlay = true;
    const schedulerForOverlay = schedulerRef.current;
    const applyOverlayUpdate = () => {
      if (!dirtyStateRef.current.overlay) {
        return;
      }

      for (const priceLine of priceLinesRef.current) {
        activeSeries.removePriceLine(priceLine);
      }
      priceLinesRef.current = [];

      for (const [value, color, title] of [
        [dayVwap, "#67e8a5", "VWAP D"],
        [weekVwap, "#58c7ff", "VWAP W"],
        [monthVwap, "#ffd166", "VWAP M"],
      ] as Array<[number, string, string]>) {
        if (value > 0) {
          priceLinesRef.current.push(activeSeries.createPriceLine({ price: value, color, lineStyle: 2, lineWidth: 1, title }));
        }
      }
      for (const zone of liquidityZones) {
        priceLinesRef.current.push(activeSeries.createPriceLine({
          price: zone.level,
          color: "#ff8d8d",
          lineStyle: 1,
          lineWidth: 1,
          title: zone.label,
        }));
      }
      if (domAnchorPrice !== null && domAnchorSide) {
        priceLinesRef.current.push(activeSeries.createPriceLine({
          price: domAnchorPrice,
          color: domAnchorSide === "ask" ? "#ff8f8f" : "#7beab4",
          lineStyle: 2,
          lineWidth: 2,
          title: domAnchorSide === "ask" ? "DOM ASK" : "DOM BID",
        }));
      }

      setOverlayBadges(resolveBadgeCollisions(nextBadges, container.clientWidth, container.clientHeight));
      renderUpdateCountsRef.current.overlay += 1;
      dirtyStateRef.current.overlay = false;
    };

    if (schedulerForOverlay) {
      schedulerForOverlay.enqueue({ type: "overlay", priority: LAYER_PRIORITY.overlay, callback: applyOverlayUpdate });
    } else {
      applyOverlayUpdate();
    }
  }, [
    frozen,
    isLiteMode,
    candles,
    candleTransform,
    cursor.visible,
    dayVwap,
    liquidityZones,
    mode,
    monthVwap,
    motionTuning.formingWidthFactor,
    motionTuning.formingWidthMax,
    framePerf.cpuLoad,
    framePerf.fps,
    framePerf.frameTimeMs,
    overlayPerfProfile.busyCpuLoad,
    overlayPerfProfile.busyFrameMs,
    overlayPerfProfile.busyMinFps,
    overlayPerfProfile.criticalCpuLoad,
    overlayPerfProfile.criticalFrameMs,
    overlayPerfProfile.criticalMinFps,
    overlayPerfProfile.domLevelsBusy,
    overlayPerfProfile.domLevelsNormal,
    overlayPerfProfile.heatmapBandsBusy,
    overlayPerfProfile.heatmapBandsNormal,
    overlayZones,
    points,
    footprintRows,
    domLevels,
    heatmapLevels,
    densityLevel,
    timeframe,
    weekVwap,
    domAnchorPrice,
    domAnchorSide,
  ]);

  const handleDomRowClick = (level: DomOverlayLevel) => {
    if (domPressHandledRef.current) {
      domPressHandledRef.current = false;
      return;
    }
    setDomSelectedKey(level.key);
    setDomAnchorPrice(level.price);
    setDomAnchorSide(level.side);
    if (level.isWall) {
      setDomLockedWalls((current) => ({
        ...current,
        [level.lockKey]: !current[level.lockKey],
      }));
      toastSeqRef.current += 1;
      setDomToast({
        id: toastSeqRef.current,
        message: `${domLockedWalls[level.lockKey] ? "unlock" : "lock"} wall ${formatCompactPrice(level.price)}`,
      });
    } else {
      toastSeqRef.current += 1;
      setDomToast({
        id: toastSeqRef.current,
        message: `anchor ${level.side.toUpperCase()} ${formatCompactPrice(level.price)}`,
      });
    }
  };

  const handleDomRowDoubleClick = () => {
    setDomSelectedKey(null);
    setDomAnchorPrice(null);
    setDomAnchorSide(null);
    toastSeqRef.current += 1;
    setDomToast({ id: toastSeqRef.current, message: "anchor cleared" });
  };

  const handleDomResetLocks = () => {
    setDomLockedWalls({});
    toastSeqRef.current += 1;
    setDomToast({ id: toastSeqRef.current, message: "locks reset" });
  };

  const clearDomHoldTimer = () => {
    if (domHoldTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(domHoldTimerRef.current);
      domHoldTimerRef.current = null;
    }
  };

  const handleDomRowPointerDown = (level: DomOverlayLevel, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") {
      return;
    }
    if (!level.isWall || isLiteMode) {
      return;
    }
    setDomTouchPrimedKey(level.key);
    clearDomHoldTimer();
    const holdThresholdMs = domHoldThresholdMs(event.pointerType, chartViewportWidth);
    domHoldTimerRef.current = window.setTimeout(() => {
      domPressHandledRef.current = true;
      setDomSelectedKey(level.key);
      setDomAnchorPrice(level.price);
      setDomAnchorSide(level.side);
      setDomLockedWalls((current) => {
        const nextLocked = !current[level.lockKey];
        toastSeqRef.current += 1;
        setDomToast({
          id: toastSeqRef.current,
          message: `${nextLocked ? "lock" : "unlock"} wall ${formatCompactPrice(level.price)} (hold)`,
        });
        return {
          ...current,
          [level.lockKey]: nextLocked,
        };
      });
      setDomTouchPulseKey(level.key);
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          setDomTouchPulseKey((current) => (current === level.key ? null : current));
        }, 420);
      }
      setDomTouchPrimedKey(null);
      domHoldTimerRef.current = null;
    }, holdThresholdMs);
  };

  const handleDomRowPointerUp = () => {
    clearDomHoldTimer();
    setDomTouchPrimedKey(null);
  };

  const handleDomRowsPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (domOverlay.levels.length === 0) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.height <= 0) {
      return;
    }
    const localY = clamp(event.clientY - rect.top, 0, rect.height - 1);
    const rowHeight = rect.height / domOverlay.levels.length;
    const rowIndex = clamp(Math.floor(localY / Math.max(rowHeight, 1)), 0, domOverlay.levels.length - 1);
    const snappedKey = domOverlay.levels[rowIndex]?.key ?? null;
    setDomHoverKey((current) => (current === snappedKey ? current : snappedKey));
  };

  const handleVpPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (volumeProfileOverlay.rows.length === 0) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const rowsPer100px = rect.height > 0 ? (volumeProfileOverlay.rows.length / rect.height) * 100 : 0;
    const zoomDensityBoost = clamp(rowsPer100px / 7.5, 0.15, 1.55);
    const zoomCompression = clamp(14 / Math.max(candleStepPxRef.current, 6), 0.72, 1.66);
    const pointerY = event.clientY - rect.top;
    if (vpHoverKey) {
      const currentRow = volumeProfileOverlay.rows.find((row) => row.key === vpHoverKey);
      if (currentRow) {
        const hysteresis = clamp(currentRow.height * 0.34 * zoomDensityBoost * zoomCompression, 2, 18);
        if (pointerY >= currentRow.top - hysteresis && pointerY <= currentRow.top + currentRow.height + hysteresis) {
          return;
        }
      }
    }
    let closestRow = volumeProfileOverlay.rows[0];
    let closestDistance = Math.abs((closestRow.top + closestRow.height * 0.5) - pointerY);
    for (let index = 1; index < volumeProfileOverlay.rows.length; index += 1) {
      const candidate = volumeProfileOverlay.rows[index];
      const distance = Math.abs((candidate.top + candidate.height * 0.5) - pointerY);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestRow = candidate;
      }
    }
    setVpHoverKey((current) => (current === closestRow.key ? current : closestRow.key));
  };

  const handleBadgePointerDown = (badgeKey: string) => (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const offset = overlayOffsets[badgeKey] || { x: 0, y: 0 };
    dragStateRef.current = {
      key: badgeKey,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    setDraggingBadgeKey(badgeKey);
    setActiveBadgeKey(badgeKey);
  };

  const nudgeBadge = (badgeKey: string, deltaX: number, deltaY: number) => {
    setOverlayOffsets((current) => {
      const prev = current[badgeKey] || { x: 0, y: 0 };
      return {
        ...current,
        [badgeKey]: {
          x: clamp(prev.x + deltaX, -180, 180),
          y: clamp(prev.y + deltaY, -140, 140),
        },
      };
    });
  };

  const autoSwitchHeat = autoStabilityMetrics.switches5m >= 9 ? "hot" : autoStabilityMetrics.switches5m >= 4 ? "warn" : "ok";
  const autoTargetBand = chartMotionPreset === "auto" ? autoMotionTargetBand(symbol, timeframe) : null;
  const autoTargetIntervalSec = autoTargetBand?.targetSec ?? null;
  const autoIntervalTone = autoMotionIntervalTone(autoStabilityMetrics.avgIntervalSec, autoTargetIntervalSec ?? 0);
  const autoSparklinePath = buildSparklinePath(autoStabilityMetrics.sparklineBuckets, 120, 24);
  const autoStabilityTooltip = [
    `switches/h: ${autoStabilityMetrics.switches1h}`,
    `band cible: ${autoTargetBand ? `ok >= ${formatCompactDuration(autoTargetBand.okFloorSec)} · warn ${formatCompactDuration(autoTargetBand.warnFloorSec)}-${formatCompactDuration(autoTargetBand.okFloorSec)} · hot < ${formatCompactDuration(autoTargetBand.warnFloorSec)}` : "-"}`,
    `temps moyen entre switches: ${autoStabilityMetrics.avgIntervalSec === null ? "-" : formatCompactDuration(autoStabilityMetrics.avgIntervalSec)}${autoTargetIntervalSec ? ` (cible ${formatCompactDuration(autoTargetIntervalSec)})` : ""}`,
    `dernier switch: ${autoStabilityMetrics.lastSwitchAgoSec === null ? "-" : `il y a ${formatCompactDuration(autoStabilityMetrics.lastSwitchAgoSec)}`}`,
  ].join("\n");

  const overlayLayoutMode = chartViewportWidth < 860 ? "compact" : chartViewportWidth < 1080 ? "tight" : "full";
  const hideDomOverlay = overlayLayoutMode === "compact";
  const hideFootprintOverlay = chartViewportWidth < 980;
  const hideVolumeProfileOverlay = chartViewportWidth < 920;
  const visibleWallKeys = domOverlay.levels.filter((level) => level.isWall).map((level) => level.lockKey);
  const lockedVisibleWallCount = visibleWallKeys.reduce((count, key) => count + (domLockedWalls[key] ? 1 : 0), 0);
  const vpHoverIndex = vpHoverKey ? volumeProfileOverlay.rows.findIndex((row) => row.key === vpHoverKey) : -1;
  const vpHoverRow = vpHoverKey ? (volumeProfileOverlay.rows.find((row) => row.key === vpHoverKey) || null) : null;
  const vpNeighborhoodRows = vpHoverIndex >= 0
    ? volumeProfileOverlay.rows.slice(Math.max(0, vpHoverIndex - 3), Math.min(volumeProfileOverlay.rows.length, vpHoverIndex + 4))
    : [];
  const vpNeighborhoodPath = buildSparklinePath(vpNeighborhoodRows.map((row) => row.totalVol), 64, 18);
  const vpConfidenceTone = vpHoverRow
    ? (vpHoverRow.sessionConfidence >= 0.66 ? "high" : vpHoverRow.sessionConfidence >= 0.5 ? "medium" : "low")
    : "low";
  const collapsedOverlays: string[] = [];
  if (hideDomOverlay && domOverlay.levels.length > 0) collapsedOverlays.push("DOM");
  if (hideFootprintOverlay && footprintOverlay.rows.length > 0) collapsedOverlays.push("FP");
  if (hideVolumeProfileOverlay && volumeProfileOverlay.rows.length > 0) collapsedOverlays.push("VP");

  const assetContrastClass = inferAssetContrastClass(symbol);
  const timeframeContrastBand = inferTimeframeContrastBand(timeframe);

  return (
    <div className={[
      "institutional-chart-root",
      `mode-${mode}`,
      `contrast-${assetContrastClass}-${timeframeContrastBand}`,
      `density-${densityLevel}`,
      `overlay-layout-${overlayLayoutMode}`,
      className,
    ].filter(Boolean).join(" ")}>
      <div className="chart-sessions-layer" aria-hidden="true">
        {showSessions && densityConfig.showSessionBands ? (
          <>
            <div className="chart-session-band chart-session-band-asia"><span>Asia</span></div>
            <div className="chart-session-band chart-session-band-london"><span>London</span></div>
            <div className="chart-session-band chart-session-band-newyork"><span>New York</span></div>
          </>
        ) : null}
      </div>
      <div ref={containerRef} className="chart-canvas-host" aria-label={`${symbol} chart`} />
      <div className="chart-overlay-layer" style={{ "--overlay-alpha": densityConfig.overlayAlpha } as CSSProperties}>
        {!isLiteMode && heatmapOverlay.bands.length > 0 ? (
          <div className={`chart-heatmap-minimal-grid ${heatmapOverlay.degraded ? "chart-heatmap-minimal-grid-degraded" : ""}`} aria-hidden="true">
            {heatmapOverlay.bands.map((band) => (
              <div
                key={band.key}
                className={`chart-heatmap-minimal-band ${band.side} focus-${band.focus}`}
                style={{ top: band.top, height: band.height, opacity: band.opacity }}
              />
            ))}
          </div>
        ) : null}
        {!isLiteMode && heatmapOverlay.pausedReason === "perf" && mode === "candles" ? (
          <div className="chart-heatmap-minimal-paused" aria-live="polite">Heatmap paused: frame budget</div>
        ) : null}
        {!isLiteMode && domOverlay.levels.length > 0 && !hideDomOverlay ? (
          <div className={`chart-dom-ladder-lite ${domOverlay.degraded ? "chart-dom-ladder-lite-degraded" : ""}`}>
            <div className="chart-dom-ladder-lite-head">
              <span className="chart-dom-ladder-lite-kicker">DOM LITE</span>
              <span className={`chart-dom-ladder-lite-imbalance ${domOverlay.imbalanceRatio >= 0 ? "pos" : "neg"}`}>
                imb {domOverlay.imbalanceRatio >= 0 ? "+" : ""}{Math.round(domOverlay.imbalanceRatio * 100)}%
              </span>
              <span className="chart-dom-ladder-lite-lock-count">locks {lockedVisibleWallCount}/{visibleWallKeys.length}</span>
              <button type="button" className="chart-dom-ladder-lite-reset" onClick={handleDomResetLocks}>reset</button>
              <span className="chart-dom-ladder-lite-hotkey">L lock / R reset / Esc clear</span>
            </div>
            <div className="chart-dom-ladder-lite-rows" onMouseMove={handleDomRowsPointerMove} onMouseLeave={() => setDomHoverKey(null)}>
              {domOverlay.levels.map((level) => (
                <button
                  key={level.key}
                  type="button"
                  className={`chart-dom-ladder-lite-row ${level.side} ${level.isWall ? "is-wall" : ""} ${domHoverKey === level.key ? "is-hovered" : ""} ${domSelectedKey === level.key ? "is-selected" : ""} ${domLockedWalls[level.lockKey] ? "is-locked" : ""} ${domTouchPrimedKey === level.key ? "is-hold-primed" : ""} ${domTouchPulseKey === level.key ? "is-hold-pulse" : ""}`}
                  onPointerDown={(event) => handleDomRowPointerDown(level, event)}
                  onPointerUp={handleDomRowPointerUp}
                  onPointerCancel={handleDomRowPointerUp}
                  onClick={() => handleDomRowClick(level)}
                  onDoubleClick={handleDomRowDoubleClick}
                  title={`${level.side.toUpperCase()} ${formatCompactPrice(level.price)} | size ${Math.round(level.size)}${level.isWall ? " | wall" : ""}`}
                >
                  <span className="chart-dom-ladder-lite-side">{level.side === "ask" ? "A" : "B"}{domLockedWalls[level.lockKey] ? "*" : ""}</span>
                  <span className="chart-dom-ladder-lite-price">{formatCompactPrice(level.price)}</span>
                  <span className="chart-dom-ladder-lite-size">{Math.round(level.size)}</span>
                  <span className="chart-dom-ladder-lite-bar"><i style={{ width: `${Math.round(level.intensity * 100)}%` }} /></span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {!isLiteMode && domOverlay.pausedReason === "perf" && mode === "candles" && !hideDomOverlay ? (
          <div className="chart-dom-ladder-lite-paused" aria-live="polite">DOM paused: frame budget</div>
        ) : null}
        {!isLiteMode && domToast ? <div className="chart-dom-action-toast" aria-live="polite">{domToast.message}</div> : null}
        {!isLiteMode && footprintOverlay.rows.length > 0 && !hideFootprintOverlay ? (
          <div className={`chart-footprint-compact-overlay ${footprintOverlay.degraded ? "chart-footprint-compact-overlay-degraded" : ""}`} aria-hidden="true">
            <div className="chart-footprint-compact-kicker">FP{footprintOverlay.degraded ? " LITE" : ""}</div>
            <div className="chart-footprint-compact-head">
              <span>P</span>
              <span>BID</span>
              <span>ASK</span>
              <span>DELTA</span>
              <span>SIG</span>
            </div>
            {footprintOverlay.rows.map((row) => (
              <div key={row.key} className="chart-footprint-compact-row" style={{ top: row.top, minHeight: row.height }}>
                <span className="chart-footprint-compact-price">{formatCompactPrice(row.price)}</span>
                <span className="chart-footprint-compact-buy">{Math.round(row.buyVolume)}</span>
                <span className="chart-footprint-compact-sell">{Math.round(row.sellVolume)}</span>
                <span
                  className={`chart-footprint-compact-delta ${row.delta >= 0 ? "pos" : "neg"}`}
                  style={{ "--fp-delta-abs": String(Math.abs(row.deltaRatio)) } as CSSProperties}
                >
                  {row.delta >= 0 ? "+" : ""}{Math.round(row.delta)}
                </span>
                <span className="chart-footprint-compact-signal-stack">
                  {row.imbalanceSide !== "none" ? (
                    <i
                      className={`chart-footprint-compact-signal chart-footprint-compact-signal-imbalance ${row.imbalanceSide}`}
                      style={{ "--fp-imbalance": String(row.imbalanceStrength) } as CSSProperties}
                    >
                      {row.imbalanceSide === "buy" ? "IMB+" : "IMB-"}
                    </i>
                  ) : null}
                  {row.absorption ? <i className="chart-footprint-compact-signal chart-footprint-compact-signal-absorption">ABS</i> : null}
                </span>
                <span
                  className="chart-footprint-compact-delta-bar"
                  style={{
                    "--fp-delta": String(row.deltaRatio),
                    "--fp-delta-abs": String(Math.abs(row.deltaRatio)),
                  } as CSSProperties}
                />
              </div>
            ))}
          </div>
        ) : null}
        {!isLiteMode && footprintOverlay.pausedReason === "perf" && mode === "footprint" && !hideFootprintOverlay ? (
          <div className="chart-footprint-compact-paused" aria-live="polite">Footprint paused: frame budget</div>
        ) : null}
        {!isLiteMode && volumeProfileOverlay.rows.length > 0 && !hideVolumeProfileOverlay ? (
          <div
            className={`chart-volume-profile ${volumeProfileOverlay.degraded ? "chart-volume-profile-degraded" : ""}`}
            onMouseMove={handleVpPointerMove}
            onMouseLeave={() => setVpHoverKey(null)}
          >
            <div className="chart-volume-profile-kicker">VP{volumeProfileOverlay.degraded ? " LITE" : ""}</div>
            <div className="chart-volume-profile-session-split" aria-hidden="true">
              <span className="asia">ASIA</span>
              <span className="london">LON</span>
              <span className="newyork">NY</span>
            </div>
            {volumeProfileOverlay.vahY !== null ? (
              <span className="chart-volume-profile-guide chart-volume-profile-guide-vah" style={{ top: volumeProfileOverlay.vahY }}>VAH</span>
            ) : null}
            {volumeProfileOverlay.valY !== null ? (
              <span className="chart-volume-profile-guide chart-volume-profile-guide-val" style={{ top: volumeProfileOverlay.valY }}>VAL</span>
            ) : null}
            {volumeProfileOverlay.pocY !== null ? (
              <span className="chart-volume-profile-guide chart-volume-profile-guide-poc" style={{ top: volumeProfileOverlay.pocY }}>POC</span>
            ) : null}
            {volumeProfileOverlay.rows.map((row) => (
              <div
                key={row.key}
                className={`chart-volume-profile-row ${vpHoverKey === row.key ? "chart-volume-profile-row-hovered" : ""} ${row.isPoc ? "chart-volume-profile-row-poc" : ""} ${row.isVah ? "chart-volume-profile-row-vah" : ""} ${row.isVal ? "chart-volume-profile-row-val" : ""} chart-volume-profile-row-session-${row.sessionBias}`}
                title={`price ${formatCompactPrice(row.priceMid)} · buy ${(row.buyPct * 100).toFixed(0)}% · ${row.sessionBias}`}
                style={{ top: row.top, height: row.height, width: `${Math.round(row.widthPct * 100)}%` }}
                onMouseEnter={() => setVpHoverKey(row.key)}
              >
                <span className="chart-volume-profile-row-buy" style={{ width: `${Math.round(row.buyPct * 100)}%` }} />
                <span className="chart-volume-profile-row-sell" style={{ width: `${Math.round((1 - row.buyPct) * 100)}%` }} />
              </div>
            ))}
            {vpHoverRow ? (
              <div className={`chart-volume-profile-hover-panel tone-${vpConfidenceTone} session-${vpHoverRow.sessionBias}`} style={{ top: vpHoverRow.top + vpHoverRow.height * 0.5 }}>
                <strong>{formatCompactPrice(vpHoverRow.priceMid)}</strong>
                <span>total: {Math.round(vpHoverRow.totalVol)}</span>
                <span>buy/sell: {(vpHoverRow.buyPct * 100).toFixed(0)}% / {(100 - vpHoverRow.buyPct * 100).toFixed(0)}%</span>
                <span>imbalance: {vpHoverRow.imbalance >= 0 ? "+" : ""}{(vpHoverRow.imbalance * 100).toFixed(1)}%</span>
                <span>session: {vpHoverRow.sessionBias} ({(vpHoverRow.sessionConfidence * 100).toFixed(0)}%)</span>
                <span className={`chart-volume-profile-confidence chart-volume-profile-confidence-${vpConfidenceTone}`}>confidence {vpConfidenceTone}</span>
                {vpNeighborhoodRows.length > 1 ? (
                  <span className="chart-volume-profile-mini-sparkline" aria-hidden="true">
                    <svg viewBox="0 0 64 18" preserveAspectRatio="none">
                      <path d={vpNeighborhoodPath} />
                    </svg>
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {!isLiteMode && volumeProfileOverlay.pausedReason === "perf" && !hideVolumeProfileOverlay ? (
          <div className="chart-volume-profile-paused" aria-live="polite">VP paused: frame budget</div>
        ) : null}
        {!isLiteMode && collapsedOverlays.length > 0 ? (
          <div className="chart-overlay-collapse-hint" aria-live="polite">
            auto-collapse: {collapsedOverlays.join(" / ")}
          </div>
        ) : null}
        {!isLiteMode && chartMotionPreset === "auto" ? (
          <div
            className={`chart-auto-stability chart-auto-stability-${autoSwitchHeat}`}
            aria-live="polite"
            aria-label={`auto switches in 5 minutes: ${autoStabilityMetrics.switches5m}`}
            title={autoStabilityTooltip}
          >
            <span className="chart-auto-stability-kicker">AUTO</span>
            <strong>{resolvedMotionPreset.toUpperCase()}</strong>
            <em>{autoStabilityMetrics.switches5m} switches / 5m</em>
            <span className="chart-auto-stability-tooltip" role="tooltip">
              <span className="chart-auto-stability-tooltip-band">
                band cible: {autoTargetBand ? `ok >= ${formatCompactDuration(autoTargetBand.okFloorSec)} · warn ${formatCompactDuration(autoTargetBand.warnFloorSec)}-${formatCompactDuration(autoTargetBand.okFloorSec)} · hot < ${formatCompactDuration(autoTargetBand.warnFloorSec)}` : "-"}
              </span>
              <span>switches/h: {autoStabilityMetrics.switches1h}</span>
              <span className={`chart-auto-stability-tooltip-${autoIntervalTone}`}>
                temps moyen: {autoStabilityMetrics.avgIntervalSec === null ? "-" : formatCompactDuration(autoStabilityMetrics.avgIntervalSec)}
                {autoTargetIntervalSec ? ` (cible ${formatCompactDuration(autoTargetIntervalSec)})` : ""}
              </span>
              <span>dernier switch: {autoStabilityMetrics.lastSwitchAgoSec === null ? "-" : `il y a ${formatCompactDuration(autoStabilityMetrics.lastSwitchAgoSec)}`}</span>
              <span className="chart-auto-stability-sparkline-wrap" aria-hidden="true">
                <svg className="chart-auto-stability-sparkline" viewBox="0 0 120 24" preserveAspectRatio="none">
                  <path d={autoSparklinePath} />
                </svg>
              </span>
            </span>
          </div>
        ) : null}
        {!isLiteMode ? (
          <div
            className="chart-inertia-layer"
            style={{
              transform: `translate(${inertia.driftX.toFixed(2)}px, ${inertia.driftY.toFixed(2)}px) scale(${chartFeel.inertiaScale.toFixed(3)})`,
              opacity: Number(chartFeel.inertiaOpacity.toFixed(3)),
            }}
            aria-hidden="true"
          />
        ) : null}
        {activeCandleOverlay ? (
          <div
            className={`chart-active-candle-band ${activeCandleOverlay.source === "crosshair" ? "is-crosshair" : "is-live"}`}
            style={{ left: activeCandleOverlay.left, width: activeCandleOverlay.width }}
            aria-hidden="true"
          >
            <span className="chart-active-candle-core" />
          </div>
        ) : null}
        {newCandleFlash > 0 && !isLiteMode ? (
          <div key={`ncf-${newCandleFlash}`} className="chart-new-candle-flash" aria-hidden="true" />
        ) : null}
        {!isLiteMode && formingCandle && densityConfig.showFormingCandle ? (
          <div
            className={`chart-forming-candle chart-forming-candle-${formingCandle.direction} ${Math.abs(formingCandle.closeY - formingCandle.openY) >= 14 ? "is-volatile" : "is-calm"}`}
            style={{ left: formingCandle.left }}
            aria-hidden="true"
          >
            <span className="chart-forming-candle-wick" style={{ top: formingCandle.highY, height: Math.max(3, formingCandle.lowY - formingCandle.highY) }} />
            <span
              className="chart-forming-candle-body"
              style={{
                width: formingCandle.width,
                top: Math.min(formingCandle.openY, formingCandle.closeY),
                height: Math.max(2, Math.abs(formingCandle.closeY - formingCandle.openY)),
              }}
            />
            <span className="chart-forming-candle-label">forming</span>
          </div>
        ) : null}
        {!isLiteMode && smoothedLivePulse ? (
          <div
            key={`live-pulse-${smoothedLivePulse.tick}`}
            className="chart-live-pulse"
            style={{ left: smoothedLivePulse.left, top: smoothedLivePulse.top }}
            aria-hidden="true"
          >
            <span className="chart-live-pulse-dot" />
            <span className="chart-live-pulse-ring" />
            <span className="chart-live-pulse-ring chart-live-pulse-ring-secondary" />
            <span className="chart-live-pulse-label"><strong>LIVE</strong><em>{smoothedLivePulse.priceLabel}</em></span>
          </div>
        ) : null}
        {!isLiteMode && densityConfig.showBadges ? overlayBadges.map((badge) => {
          const offset = overlayOffsets[badge.key] || { x: 0, y: 0 };
          const anchorPrice = lastPriceRef.current ?? badge.price;
          const relativeDistance = Math.abs(badge.price - anchorPrice) / Math.max(1, Math.abs(anchorPrice) * 0.0045);
          const proximity = clamp(1 - relativeDistance, 0.2, 1);
          const baseIntensity = badge.kind === "liquidity" ? 0.95 : badge.tone === "accent" ? 0.72 : 0.58;
          const intensity = clamp(baseIntensity * 0.72 + proximity * 0.28, 0.35, 1);
          const style = {
            left: badge.left,
            top: badge.top,
            "--badge-dx": `${offset.x}px`,
            "--badge-dy": `${offset.y}px`,
            "--badge-intensity": String(intensity),
            "--badge-scale": String(densityConfig.badgeScale),
          } as CSSProperties;

          return (
            <button
              key={badge.key}
              type="button"
              className={`chart-zone-label chart-zone-label-${badge.tone} chart-zone-label-${badge.kind} ${activeBadgeKey === badge.key ? "chart-zone-label-active" : ""} ${draggingBadgeKey === badge.key ? "chart-zone-label-dragging" : ""}`}
              style={style}
              onMouseEnter={() => setActiveBadgeKey(badge.key)}
              onMouseLeave={() => setActiveBadgeKey((current) => (current === badge.key && draggingBadgeKey !== badge.key ? null : current))}
              onFocus={() => setActiveBadgeKey(badge.key)}
              onBlur={() => setActiveBadgeKey((current) => (current === badge.key ? null : current))}
              onClick={() => setActiveBadgeKey((current) => (current === badge.key ? null : badge.key))}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 12 : 4;
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  nudgeBadge(badge.key, -step, 0);
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  nudgeBadge(badge.key, step, 0);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  nudgeBadge(badge.key, 0, -step);
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  nudgeBadge(badge.key, 0, step);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setActiveBadgeKey(null);
                }
              }}
              aria-label={`${badge.text} ${badge.detail}`}
              aria-description="Use arrow keys to nudge this badge. Hold Shift for larger moves."
            >
              <span className="chart-zone-handle" onPointerDown={handleBadgePointerDown(badge.key)} aria-hidden="true" />
              {badge.text}
              {activeBadgeKey === badge.key ? (
                <span className="chart-zone-tooltip">{badge.detail} · px {badge.price.toFixed(2)} · drag handle</span>
              ) : null}
            </button>
          );
        }) : null}
        {cursor.visible ? (
          <>
            <div className="chart-cursor-v" style={{ left: cursor.left }} />
            <div className="chart-cursor-h" style={{ top: cursor.top }} />
            <div className="chart-cursor-focus" style={{ left: cursor.left, top: cursor.top }} />
            <div className="chart-cursor-price" style={{ top: cursor.priceTop }}>{cursor.price}</div>
            <div className="chart-cursor-time" style={{ left: cursor.timeLeft }}>{cursor.time}</div>
          </>
        ) : null}
      </div>
    </div>
  );
}