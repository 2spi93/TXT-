"use client";

import Link from "next/link";
import JSZip from "jszip";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelGroupHandle } from "react-resizable-panels";

import HelpHint from "../../components/HelpHint";
import HelpTooltip from "../../components/ui/HelpTooltip";
import ModuleGuide from "../../components/ui/ModuleGuide";
import PanelShell from "../../components/ui/PanelShell";
import {
  applyLocalUserUiPreferences,
  fetchBackendUserUiPreferences,
  readLocalUserUiPreferencesUpdatedAt,
  readLocalUserUiPreferences,
  saveBackendUserUiPreferences,
  setLocalUserUiPreferencesUpdatedAt,
  useChartHapticMode,
  useChartMotionPreset,
  useChartReleaseSendMode,
  useChartSnapEnabled,
  useChartSnapPriority,
  useUiMode,
} from "../../lib/userUiPrefs";
import type { ChartMotionPreset, ChartReleaseSendMode, ChartSnapPriority, UserUiPreferencesProfile } from "../../lib/userUiPrefs";
import InstitutionalChart from "./InstitutionalChart";
import { barArrayHash, type Bar } from "../../lib/dataEngine";
import { indicatorWorkerAdapter } from "../../lib/indicators/workerAdapter";
import type { ActiveIndicator, IndicatorSeriesData } from "../../lib/indicators/engine";

type JsonMap = Record<string, unknown>;
type QuotePoint = { label: string; value: number };
type QuoteHistoryMap = Record<string, QuotePoint[]>;
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
type DomLevel = { side: "bid" | "ask"; price: number; size: number; intensity: number };
type FootprintRow = { low: number; high: number; buyVolume: number; sellVolume: number; delta: number; timeLabel?: string; timeKey?: string };
type TapePrint = { label: string; price: number; delta: number; side: "buy" | "sell" | "flat"; volume: number; timeKey?: string };
type MarketSignalDirection = "buy" | "sell" | "neutral";
type MarketSignalSeverity = "info" | "warn" | "critical";
type MarketSignalEvent = {
  id: "imbalance" | "absorption" | "fake-breakout" | "liquidity-trap" | "continuation" | "exhaustion";
  label: string;
  detail: string;
  reasonCode: string;
  direction: MarketSignalDirection;
  severity: MarketSignalSeverity;
  confidence: number;
};
type SignalConfidenceDrift = "UP" | "FLAT" | "DOWN";
type MarketSignalSnapshot = {
  buyPressurePct: number;
  sellPressurePct: number;
  directionalLongPct: number;
  directionalShortPct: number;
  directionalConfidencePct: number;
  directionalConfidenceLabel: "LOW" | "MEDIUM" | "HIGH";
  dominantDirection: MarketSignalDirection;
  headline: string;
  convictionLabel: string;
  focusMode: boolean;
  calibrationLabel: string;
  criticalSignalCount: number;
  criticalSignalIds: string[];
  signals: MarketSignalEvent[];
};
type MarketEvidenceComponent = {
  id: "dom" | "footprint" | "liquidity" | "price-action";
  label: string;
  scorePct: number;
  direction: MarketSignalDirection;
  detail: string;
};
type MarketEvidenceWeightKey = MarketEvidenceComponent["id"];
type MarketConfluenceWeights = Record<MarketEvidenceWeightKey, number>;
type MarketDecisionScenario = "continuation" | "reversal" | "balance";
type LearningRegimeV4 = "trend" | "chop" | "volatile";
type SignalDisplayMode = "classic" | "augmented" | "ai-dominant";
type ExecutionAdaptMode = "auto" | "confirm" | "manual";
type AutoExecutionMode = "assisted" | "semi-auto" | "full-auto";
type MarketSuggestedBracket = {
  side: "buy" | "sell";
  entry: number;
  sl: number;
  tp: number;
  rr: number;
  label: string;
};
type MarketHistoricalLearning = {
  sampleSize: number;
  scopeLabel: string;
  winratePct: number;
  learnedWeights: MarketConfluenceWeights;
};
type SelfLearningV4DriftSnapshot = {
  status: "WARMUP" | "STABLE" | "DRIFT";
  shortSamples: number;
  longSamples: number;
  shortWinratePct: number;
  longWinratePct: number;
  winrateDropPct: number;
  shortBrier: number | null;
  longBrier: number | null;
  brierRise: number;
  shortLossCount: number;
  enoughSamples: boolean;
  shouldDemote: boolean;
  signature: string;
};
type SelfLearningV4PersistedState = {
  version: number;
  accountId: string;
  symbol: string;
  timeframe: string;
  enabled: boolean;
  autoAdaptEnabled: boolean;
  modelUpdatedAt: string | null;
  driftAutoDemotedAt: string | null;
  filters: {
    regime: "all" | LearningRegimeV4;
    scenario: "all" | MarketDecisionScenario;
  };
  snapshot: {
    regime: LearningRegimeV4;
    scenarioHint: MarketDecisionScenario;
    active: boolean;
    profile: MarketHistoricalLearning;
    adaptiveWeights: MarketConfluenceWeights;
    effectiveWeights: MarketConfluenceWeights;
    drift: SelfLearningV4DriftSnapshot;
  };
  journal: SelfLearningJournalEventV4[];
  updatedAt: string;
};
type SelfLearningV4ScopeSummary = {
  accountId: string;
  symbol: string;
  timeframe: string;
  updatedAt: string;
  journalSize: number;
  enabled: boolean;
  autoAdaptEnabled: boolean;
  driftStatus: "WARMUP" | "STABLE" | "DRIFT";
};
type SelfLearningV4Storage = "control-plane" | "local-fallback" | "unknown";
type SelfLearningV4PersistenceStatus = {
  storage: SelfLearningV4Storage;
  healthy: boolean;
  stateLoadedAt: string | null;
  stateSavedAt: string | null;
  scopesLoadedAt: string | null;
  scopeCount: number;
  message: string;
};
type MarketDecisionSnapshot = {
  scenario: MarketDecisionScenario;
  scenarioLabel: string;
  scenarioProbabilityPct: number;
  probableReversalZone: number | null;
  probableReversalZoneLabel: string;
  globalConfidencePct: number;
  biasDirection: MarketSignalDirection;
  criticalConfirmed: boolean;
  evidence: MarketEvidenceComponent[];
  confluenceScorePct: number;
  actionTitle: string;
  actionBody: string;
  suggestedBracket: MarketSuggestedBracket | null;
  historicalLearning: MarketHistoricalLearning;
  executionPlan: {
    snapPriority: ChartSnapPriority;
    preset: ChartOrderPreset;
    guardEnabled: boolean;
  };
};
type MarketSignalAlertToast = {
  key: string;
  title: string;
  detail: string;
  direction: MarketSignalDirection;
  zoneLabel: string;
  critical: boolean;
};
type ChartCursorPayload = { price: number; timeLabel: string; timeKey: string } | null;
type MarketMetric = {
  fundingRate: number;
  openInterest: number;
  volume: number;
  depthImbalance: number;
  tapeAcceleration: number;
};
type GovernanceSort = "severity" | "label" | "value";
type IncidentSort = "severity" | "status" | "sla";
type LayoutPreset = "scalp" | "swing" | "monitoring";
type DockZone = "micro" | "lower" | "monitoring";
type DockPanelId = "dom" | "footprint" | "tape" | "heatmap" | "blotter" | "brokers" | "alerts" | "incidents" | "governance" | "readiness" | "risktimeline";
type FloatingPanelState = { id: DockPanelId; fromZone: DockZone; x: number; y: number; w: number; h: number };
type ReplaySpeed = 1 | 2 | 4 | 8;
type ReplayFrame = {
  timeKey: string;
  timeLabel: string;
  quoteValue?: number;
  tapeEvents?: TapePrint[];
  footprintRows?: FootprintRow[];
  domLevels?: DomLevel[];
  heatmapLevels?: DomLevel[];
};
type ReplayBufferMap = Record<string, ReplayFrame[]>;
type ReplayState = {
  enabled: boolean;
  playing: boolean;
  speed: ReplaySpeed;
  cursorIndex: number;
  timeKey: string | null;
};
type ChartOrderPreset = "scalp" | "swing" | "low-risk" | "custom";
type ChartOrderLineKey = "entry" | "sl" | "tp";
type ChartSnapFamily = "execution" | "vwap" | "liquidity" | "manual";
type ChartDragState = {
  line: ChartOrderLineKey;
  rectTop: number;
  rectHeight: number;
  pointerId: number;
  pointerType: string;
  startPrice: number;
  fineMode: boolean;
  moved: boolean;
};
type ChartSnapState = { label: string; price: number; family: ChartSnapFamily } | null;
type ChartReleaseTicketState = { line: ChartOrderLineKey; top: number; price: number; snapLabel: string; fineMode: boolean; armed: boolean } | null;
type ChartOrderTicket = {
  side: "buy" | "sell";
  preset: ChartOrderPreset;
  entry: number;
  sl: number;
  tp: number;
  oco: boolean;
  active: boolean;
};
type ChartGroupId = "A" | "B" | "C";
type ChartSyncPriorityMode = "leader" | "last-edited";
type ChartPropagationMode = "both" | "symbol-only" | "timeframe-only";
type ChartSyncSourceLabel = "manual" | "leader" | "last-edited" | "storage" | "workspace";
type ChartPanelState = {
  symbol: string;
  timeframe: "1m" | "5m" | "15m";
  source: ChartSyncSourceLabel;
  sourceFrom: ChartGroupId | null;
  updatedAt: string;
};
type ChartPanelData = {
  points: QuotePoint[];
  candles: Array<{ label: string; open: number; high: number; low: number; close: number; volume: number }>;
  loading: boolean;
};
type ChartSendHistoryEntry = {
  atIso: string;
  symbol: string;
  side: "buy" | "sell";
  rr: number;
  riskUsd: number;
  rewardUsd: number;
  maxLossUsd: number;
  targetGainUsd: number;
  compliant: boolean;
  outcome: "submitted" | "blocked-loss" | "confirmation-required";
  source?: "local" | "backend";
};
type RiskTimelineFilter = "all" | "compliant" | "miss";
type RiskHistorySummary = {
  count_ok: number;
  count_miss: number;
  last_block_reason: string;
  window_size: number;
  miss_in_window: number;
  ratio_miss_window: number;
  miss_threshold: number;
  alert: boolean;
};
type RiskPollingStatus = {
  lastRefreshIso: string | null;
  latencyMs: number | null;
  source: "summary" | "history" | null;
};
type ReplayEventMarker = {
  id: string;
  label: string;
  kind: "intent" | "approval" | "fill" | "incident" | "routing" | "outcome" | "other";
  timeKey: string;
  frameIndex: number;
  critical: boolean;
  detail: string;
};
type MetaRiskAuditEvent = {
  id: string;
  timestampIso: string;
  tierFrom: string;
  tierTo: string;
  capitalFromPct: number;
  capitalToPct: number;
  reason: string;
  healthScore: number;
  blockedRegimes: string[];
  venue: string;
};

type AutoTuningAuditEvent = {
  id: string;
  timestampIso: string;
  actor: string;
  dryRun: boolean;
  status: "accepted" | "rejected" | "failed";
  recommendationCount: number;
  summary: string;
};

type AutoExecutionAuditEvent = {
  id: string;
  timestampIso: string;
  symbol: string;
  timeframe: string;
  mode: AutoExecutionMode;
  gateState: "READY" | "BLOCKED" | "KILLED";
  metaPass: boolean;
  riskPass: boolean;
  sessionPass: boolean;
  symbolLossPass: boolean;
  killSwitch: boolean;
  sizeUsd: number;
  qualityScore: number;
  reasons: string[];
};

type SelfLearningJournalEventV4 = {
  id: string;
  timestampIso: string;
  symbol: string;
  timeframe: string;
  regime: LearningRegimeV4;
  scenario: MarketDecisionScenario;
  outcome: "win" | "loss";
  pnl: number;
  mfe: number;
  mae: number;
  weights: MarketConfluenceWeights;
};

type RollbackGuardSession = {
  id: string;
  startedAtIso: string;
  baselineHealth: number;
  baselineBrier: number | null;
  baselineWeights: Array<{ strategyId: string; pct: number }>;
  windowMin: number;
  healthDropThreshold: number;
  brierRiseThreshold: number;
  source: string;
  reason: string;
  status: "active" | "closed";
  closeReason?: string;
  closedAtIso?: string;
  observations?: Array<{
    timestampIso: string;
    currentHealth: number;
    currentBrier: number | null;
    healthDrop: number;
    brierRise: number;
    degradeHealth: boolean;
    degradeBrier: boolean;
    shouldProposeRollback: boolean;
  }>;
};

type TerminalLayoutConfig = {
  preset: LayoutPreset;
  coreSplit: number;
  microOrder: DockPanelId[];
  lowerOrder: DockPanelId[];
  monitoringOrder: DockPanelId[];
  floatingPanels: FloatingPanelState[];
  chartLink: {
    group: "A" | "B" | "C";
    symbol: boolean;
    timeframe: boolean;
    sync: "light";
    priority: ChartSyncPriorityMode;
    leader: ChartGroupId;
    density: 2 | 3;
    propagationByGroup: Record<ChartGroupId, ChartPropagationMode>;
  };
  riskAlert: {
    window: number;
    missThreshold: number;
    refreshSec: 5 | 15 | 30;
    hardAlertEnabled: boolean;
    hardAlertThresholdPct: number;
  };
};

type TerminalWorkspaceBundle = {
  active: string;
  workspaces: Record<string, TerminalLayoutConfig>;
};

const AUTO_TUNING_WRITEBACK_ENABLED = process.env.NEXT_PUBLIC_AUTO_TUNING_WRITEBACK === "1";
const ROLLBACK_GUARD_WINDOW_MIN = Number(process.env.NEXT_PUBLIC_ROLLBACK_GUARD_WINDOW_MIN || 90);
const ROLLBACK_GUARD_HEALTH_DROP = Number(process.env.NEXT_PUBLIC_ROLLBACK_GUARD_HEALTH_DROP || 0.08);
const ROLLBACK_GUARD_BRIER_RISE = Number(process.env.NEXT_PUBLIC_ROLLBACK_GUARD_BRIER_RISE || 0.035);

const DEBUG_TIME_SYNC = process.env.NEXT_PUBLIC_DEBUG_TIME_SYNC === "1";
const TERMINAL_LAYOUT_STORAGE_PREFIX = "txt.terminal.layout.v1";
const TERMINAL_WORKSPACES_STORAGE_PREFIX = "txt.terminal.workspaces.v1";
const TERMINAL_CHART_LINK_STORAGE_PREFIX = "txt.terminal.chart-link.v1";
const DEFAULT_RISK_ALERT_WINDOW = 10;
const DEFAULT_RISK_ALERT_MISS_THRESHOLD = 3;
const DEFAULT_RISK_REFRESH_SEC: 5 | 15 | 30 = 15;
const DEFAULT_HARD_ALERT_RATIO_PCT = 60;
const FLOATING_GRID_SIZE = 16;
const FLOATING_MIN_W = 260;
const FLOATING_MIN_H = 180;
const DEFAULT_CHART_LINK = {
  group: "A" as const,
  symbol: true,
  timeframe: true,
  sync: "light" as const,
  priority: "last-edited" as const,
  leader: "A" as const,
  density: 3 as const,
  propagationByGroup: {
    A: "both" as const,
    B: "both" as const,
    C: "both" as const,
  },
};
const CHART_ORDER_PRESETS: Record<Exclude<ChartOrderPreset, "custom">, { slPct: number; tpPct: number; notional: number; maxSpread: number }> = {
  scalp: { slPct: 0.003, tpPct: 0.006, notional: 10000, maxSpread: 10 },
  swing: { slPct: 0.008, tpPct: 0.016, notional: 15000, maxSpread: 18 },
  "low-risk": { slPct: 0.0025, tpPct: 0.004, notional: 8000, maxSpread: 9 },
};
const DEFAULT_CONFLUENCE_WEIGHTS: MarketConfluenceWeights = {
  dom: 1,
  footprint: 1.15,
  liquidity: 1.1,
  "price-action": 0.95,
};
const CHART_GROUPS: ChartGroupId[] = ["A", "B", "C"];
const CHART_TIMEFRAMES: Array<"1m" | "5m" | "15m"> = ["1m", "5m", "15m"];

function riskAlertDefaultsForPreset(preset: LayoutPreset): { window: number; missThreshold: number; refreshSec: 5 | 15 | 30; hardAlertEnabled: boolean; hardAlertThresholdPct: number } {
  if (preset === "scalp") {
    return { window: 12, missThreshold: 4, refreshSec: DEFAULT_RISK_REFRESH_SEC, hardAlertEnabled: false, hardAlertThresholdPct: DEFAULT_HARD_ALERT_RATIO_PCT };
  }
  if (preset === "monitoring") {
    return { window: 8, missThreshold: 2, refreshSec: DEFAULT_RISK_REFRESH_SEC, hardAlertEnabled: false, hardAlertThresholdPct: DEFAULT_HARD_ALERT_RATIO_PCT };
  }
  return { window: 10, missThreshold: 3, refreshSec: DEFAULT_RISK_REFRESH_SEC, hardAlertEnabled: false, hardAlertThresholdPct: DEFAULT_HARD_ALERT_RATIO_PCT };
}

const MICRO_PANEL_IDS: DockPanelId[] = ["dom", "footprint", "tape", "heatmap"];
const LOWER_PANEL_IDS: DockPanelId[] = ["blotter", "brokers"];
const MONITORING_PANEL_IDS: DockPanelId[] = ["alerts", "incidents", "governance", "readiness", "risktimeline"];
const ALL_DOCK_PANEL_IDS: DockPanelId[] = [
  "dom",
  "footprint",
  "tape",
  "heatmap",
  "blotter",
  "brokers",
  "alerts",
  "incidents",
  "governance",
  "readiness",
  "risktimeline",
];

function getPriceStepDecimals(step: number): number {
  if (!Number.isFinite(step) || step >= 1) {
    return 0;
  }
  const serialized = step.toString();
  if (serialized.includes("e-")) {
    const exponent = Number(serialized.split("e-")[1] || 0);
    return Number.isFinite(exponent) ? exponent : 0;
  }
  const fraction = serialized.split(".")[1];
  return fraction ? fraction.length : 0;
}

function inferChartPriceStep(symbol: string, referencePrice: number): number {
  const normalizedSymbol = symbol.toUpperCase();
  if (normalizedSymbol.includes("JPY")) {
    return 0.01;
  }
  if (referencePrice >= 50000) {
    return 5;
  }
  if (referencePrice >= 5000) {
    return 1;
  }
  if (referencePrice >= 500) {
    return 0.1;
  }
  if (referencePrice >= 50) {
    return 0.01;
  }
  if (referencePrice >= 5) {
    return 0.001;
  }
  if (referencePrice >= 0.5) {
    return 0.0001;
  }
  return 0.00001;
}

function screenLayoutProfile(width: number): "sm" | "md" | "lg" | "xl" {
  if (width < 900) return "sm";
  if (width < 1300) return "md";
  if (width < 1760) return "lg";
  return "xl";
}

function quantizePriceToStep(price: number, step: number): number {
  const safeStep = Math.max(0.00000001, step);
  const decimals = getPriceStepDecimals(safeStep);
  return Number((Math.round(price / safeStep) * safeStep).toFixed(decimals));
}

function buildLayoutPreset(preset: LayoutPreset, novice: boolean): TerminalLayoutConfig {
  const defaultRiskAlert = riskAlertDefaultsForPreset(preset);
  if (preset === "scalp") {
    return {
      preset,
      coreSplit: novice ? 70 : 76,
      microOrder: ["dom", "tape", "footprint", "heatmap"],
      lowerOrder: ["blotter", "brokers"],
      monitoringOrder: ["alerts", "governance", "incidents", "readiness", "risktimeline"],
      floatingPanels: [],
      chartLink: { ...DEFAULT_CHART_LINK },
      riskAlert: defaultRiskAlert,
    };
  }
  if (preset === "monitoring") {
    return {
      preset,
      coreSplit: novice ? 62 : 66,
      microOrder: ["heatmap", "dom", "footprint", "tape"],
      lowerOrder: ["brokers", "blotter"],
      monitoringOrder: ["governance", "incidents", "alerts", "readiness", "risktimeline"],
      floatingPanels: [],
      chartLink: { ...DEFAULT_CHART_LINK },
      riskAlert: defaultRiskAlert,
    };
  }
  return {
    preset: "swing",
    coreSplit: novice ? 72 : 78,
    microOrder: ["dom", "footprint", "tape", "heatmap"],
    lowerOrder: ["blotter", "brokers"],
    monitoringOrder: ["alerts", "incidents", "governance", "readiness", "risktimeline"],
    floatingPanels: [],
    chartLink: { ...DEFAULT_CHART_LINK },
    riskAlert: defaultRiskAlert,
  };
}

function normalizeChartLinkConfig(raw: unknown, fallback: TerminalLayoutConfig["chartLink"]): TerminalLayoutConfig["chartLink"] {
  if (!raw || typeof raw !== "object") {
    return fallback;
  }
  const entry = raw as Partial<TerminalLayoutConfig["chartLink"]>;
  const group = entry.group === "B" || entry.group === "C" ? entry.group : "A";
  const priority = entry.priority === "leader" ? "leader" : "last-edited";
  const leader = entry.leader === "B" || entry.leader === "C" ? entry.leader : "A";
  const density = entry.density === 2 ? 2 : 3;
  const rawPropagation = entry.propagationByGroup;
  const normalizePropagation = (groupId: ChartGroupId): ChartPropagationMode => {
    if (!rawPropagation || typeof rawPropagation !== "object") {
      return fallback.propagationByGroup[groupId];
    }
    const candidate = (rawPropagation as Record<string, unknown>)[groupId];
    if (candidate === "symbol-only" || candidate === "timeframe-only") {
      return candidate;
    }
    if (candidate === "both") {
      return "both";
    }
    return fallback.propagationByGroup[groupId];
  };
  return {
    group,
    symbol: typeof entry.symbol === "boolean" ? entry.symbol : fallback.symbol,
    timeframe: typeof entry.timeframe === "boolean" ? entry.timeframe : fallback.timeframe,
    sync: "light",
    priority,
    leader,
    density,
    propagationByGroup: {
      A: normalizePropagation("A"),
      B: normalizePropagation("B"),
      C: normalizePropagation("C"),
    },
  };
}

function reorderIds(ids: DockPanelId[], sourceId: DockPanelId, targetId: DockPanelId): DockPanelId[] {
  if (sourceId === targetId) {
    return ids;
  }
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return ids;
  }
  const next = [...ids];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

function orderMap(ids: DockPanelId[]): Record<string, number> {
  return ids.reduce<Record<string, number>>((acc, id, index) => {
    acc[id] = index;
    return acc;
  }, {});
}

function snapFloatingValue(value: number): number {
  return Math.round(value / FLOATING_GRID_SIZE) * FLOATING_GRID_SIZE;
}

function clampFloatingPanel(panel: FloatingPanelState): FloatingPanelState {
  if (typeof window === "undefined") {
    return {
      ...panel,
      x: snapFloatingValue(Math.max(0, panel.x)),
      y: snapFloatingValue(Math.max(0, panel.y)),
      w: snapFloatingValue(Math.max(FLOATING_MIN_W, panel.w)),
      h: snapFloatingValue(Math.max(FLOATING_MIN_H, panel.h)),
    };
  }
  const maxW = Math.max(FLOATING_MIN_W, window.innerWidth - 32);
  const maxH = Math.max(FLOATING_MIN_H, window.innerHeight - 48);
  const nextW = Math.min(maxW, Math.max(FLOATING_MIN_W, panel.w));
  const nextH = Math.min(maxH, Math.max(FLOATING_MIN_H, panel.h));
  const maxX = Math.max(0, window.innerWidth - nextW - 16);
  const maxY = Math.max(0, window.innerHeight - nextH - 16);
  return {
    ...panel,
    x: snapFloatingValue(Math.min(maxX, Math.max(0, panel.x))),
    y: snapFloatingValue(Math.min(maxY, Math.max(0, panel.y))),
    w: snapFloatingValue(nextW),
    h: snapFloatingValue(nextH),
  };
}

function normalizeFloatingPanels(input: unknown): FloatingPanelState[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const used = new Set<DockPanelId>();
  const next: FloatingPanelState[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const entry = raw as Partial<FloatingPanelState>;
    const id = entry.id as DockPanelId | undefined;
    const fromZone = entry.fromZone as DockZone | undefined;
    if (!id || used.has(id) || !ALL_DOCK_PANEL_IDS.includes(id)) {
      continue;
    }
    if (fromZone !== "micro" && fromZone !== "lower" && fromZone !== "monitoring") {
      continue;
    }
    used.add(id);
    next.push(clampFloatingPanel({
      id,
      fromZone,
      x: Number.isFinite(entry.x) ? Number(entry.x) : 128,
      y: Number.isFinite(entry.y) ? Number(entry.y) : 96,
      w: Number.isFinite(entry.w) ? Number(entry.w) : 368,
      h: Number.isFinite(entry.h) ? Number(entry.h) : 320,
    }));
  }
  return next;
}

function normalizeDockLayout(parsed: Partial<TerminalLayoutConfig>, fallback: TerminalLayoutConfig): TerminalLayoutConfig {
  const used = new Set<DockPanelId>();
  const floatingPanels = normalizeFloatingPanels(parsed.floatingPanels);
  for (const panel of floatingPanels) {
    used.add(panel.id);
  }
  const pickZone = (input: unknown, fallbackZone: DockPanelId[]): DockPanelId[] => {
    const source = Array.isArray(input) ? input : fallbackZone;
    const next: DockPanelId[] = [];
    for (const raw of source) {
      const id = raw as DockPanelId;
      if (!ALL_DOCK_PANEL_IDS.includes(id)) {
        continue;
      }
      if (used.has(id)) {
        continue;
      }
      used.add(id);
      next.push(id);
    }
    return next;
  };

  const microOrder = pickZone(parsed.microOrder, fallback.microOrder);
  const lowerOrder = pickZone(parsed.lowerOrder, fallback.lowerOrder);
  const monitoringOrder = pickZone(parsed.monitoringOrder, fallback.monitoringOrder);

  for (const panelId of ALL_DOCK_PANEL_IDS) {
    if (used.has(panelId)) {
      continue;
    }
    if (microOrder.length <= lowerOrder.length && microOrder.length <= monitoringOrder.length) {
      microOrder.push(panelId);
    } else if (lowerOrder.length <= monitoringOrder.length) {
      lowerOrder.push(panelId);
    } else {
      monitoringOrder.push(panelId);
    }
  }

  const resolvedPreset: LayoutPreset = parsed.preset === "scalp" || parsed.preset === "monitoring"
    ? parsed.preset
    : (parsed.preset === "swing" ? "swing" : fallback.preset);
  const riskDefaults = riskAlertDefaultsForPreset(resolvedPreset);
  const riskWindow = Number.isFinite(parsed.riskAlert?.window)
    ? Math.max(3, Math.min(100, Number(parsed.riskAlert?.window)))
    : riskDefaults.window;
  const riskThresholdRaw = Number.isFinite(parsed.riskAlert?.missThreshold)
    ? Math.max(1, Math.min(100, Number(parsed.riskAlert?.missThreshold)))
    : riskDefaults.missThreshold;
  const refreshRaw = Number(parsed.riskAlert?.refreshSec);
  const riskRefreshSec: 5 | 15 | 30 = refreshRaw === 5 || refreshRaw === 30 ? refreshRaw : 15;
  const riskHardAlertEnabled = typeof parsed.riskAlert?.hardAlertEnabled === "boolean"
    ? parsed.riskAlert.hardAlertEnabled
    : riskDefaults.hardAlertEnabled;
  const riskHardAlertThresholdPct = Number.isFinite(parsed.riskAlert?.hardAlertThresholdPct)
    ? Math.max(20, Math.min(95, Number(parsed.riskAlert?.hardAlertThresholdPct)))
    : riskDefaults.hardAlertThresholdPct;

  return {
    preset: parsed.preset === "scalp" || parsed.preset === "monitoring" ? parsed.preset : fallback.preset,
    coreSplit: Number.isFinite(parsed.coreSplit) ? Math.max(52, Math.min(85, Number(parsed.coreSplit))) : fallback.coreSplit,
    microOrder,
    lowerOrder,
    monitoringOrder,
    floatingPanels,
    chartLink: normalizeChartLinkConfig(parsed.chartLink, fallback.chartLink),
    riskAlert: {
      window: riskWindow,
      missThreshold: Math.min(riskWindow, riskThresholdRaw),
      refreshSec: riskRefreshSec,
      hardAlertEnabled: riskHardAlertEnabled,
      hardAlertThresholdPct: riskHardAlertThresholdPct,
    },
  };
}

function normalizeInstrument(symbol: string): string {
  return symbol.replace("-PERP", "").replace("/", "").replace(/-/g, "").toUpperCase();
}

const TEAM_PRESETS: Record<string, TerminalLayoutConfig> = {
  "⬡ Scalp HF": buildLayoutPreset("scalp", false),
  "⬡ Swing Day": buildLayoutPreset("swing", false),
  "⬡ Risk Monitor": buildLayoutPreset("monitoring", false),
};
const TEAM_PRESET_NAMES = Object.keys(TEAM_PRESETS);
function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function instrumentLabel(item: JsonMap): string {
  return String(item.symbol || item.instrument || item.strategy_id || item.ticket_key || "-");
}

function classifyInstrument(symbol: string): string {
  const normalized = symbol.toUpperCase();
  if (["BTC", "ETH", "SOL", "XRP", "BNB", "AVAX", "DOGE", "ADA"].some((token) => normalized.includes(token))) {
    return "crypto";
  }
  if (/^[A-Z]{6}$/.test(normalized)) {
    return "fx";
  }
  if (["US30", "SPX", "NAS", "NQ", "DAX", "GER40", "UK100", "DJI"].some((token) => normalized.includes(token))) {
    return "indices";
  }
  if (["XAU", "XAG", "WTI", "BRENT", "OIL"].some((token) => normalized.includes(token))) {
    return "cfd";
  }
  if (["PERP", "FUT", "ES", "CL", "GC"].some((token) => normalized.includes(token))) {
    return "futures";
  }
  return "other";
}

function volumeFromDelta(delta: number, index: number): number {
  return Math.max(1, Math.round(Math.abs(delta) * 140 + 14 + (index % 5) * 6));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function quantileSortedAsc(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const qq = Math.max(0, Math.min(1, q));
  const pos = (values.length - 1) * qq;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return values[lower];
  const weight = pos - lower;
  return values[lower] * (1 - weight) + values[upper] * weight;
}

function downloadJsonFile(filename: string, payload: unknown): void {
  if (typeof window === "undefined") return;
  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(href);
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const escaped = text.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function downloadCsvFile(filename: string, rows: Array<Array<string | number>>): void {
  if (typeof window === "undefined") return;
  const csv = rows.map((row) => row.map((cell) => csvCell(cell)).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(href);
}

async function fetchSelfLearningV4State(scope: { accountId: string; symbol: string; timeframe: string }): Promise<{
  state: SelfLearningV4PersistedState | null;
  storage: SelfLearningV4Storage;
  updatedAt: string | null;
  unauthorized: boolean;
}> {
  const params = new URLSearchParams({
    account_id: scope.accountId,
    symbol: scope.symbol,
    timeframe: scope.timeframe,
  });
  const response = await fetch(`/api/strategies/self-learning-v4?${params.toString()}`, { cache: "no-store" });
  if (response.status === 401) {
    return {
      state: null,
      storage: "unknown",
      updatedAt: null,
      unauthorized: true,
    };
  }
  if (!response.ok) {
    throw new Error(`self_learning_v4_get_${response.status}`);
  }
  const payload = await response.json() as {
    state?: SelfLearningV4PersistedState | null;
    storage?: SelfLearningV4Storage;
    updatedAt?: string | null;
  };
  return {
    state: payload.state || null,
    storage: payload.storage || "unknown",
    updatedAt: payload.updatedAt || payload.state?.updatedAt || null,
    unauthorized: false,
  };
}

async function saveSelfLearningV4State(state: Omit<SelfLearningV4PersistedState, "version" | "updatedAt">): Promise<{
  state: SelfLearningV4PersistedState;
  storage: SelfLearningV4Storage;
  updatedAt: string | null;
}> {
  const response = await fetch("/api/strategies/self-learning-v4", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(state),
  });
  if (!response.ok) {
    throw new Error(`self_learning_v4_put_${response.status}`);
  }
  const payload = await response.json() as {
    state: SelfLearningV4PersistedState;
    storage?: SelfLearningV4Storage;
    updatedAt?: string | null;
  };
  return {
    state: payload.state,
    storage: payload.storage || "unknown",
    updatedAt: payload.updatedAt || payload.state?.updatedAt || null,
  };
}

async function fetchSelfLearningV4Scopes(params: {
  accountId?: string;
  symbol?: string;
  timeframe?: string;
  limit?: number;
}): Promise<{
  items: SelfLearningV4ScopeSummary[];
  storage: SelfLearningV4Storage;
}> {
  const query = new URLSearchParams();
  if (params.accountId) {
    query.set("account_id", params.accountId);
  }
  if (params.symbol) {
    query.set("symbol", params.symbol);
  }
  if (params.timeframe) {
    query.set("timeframe", params.timeframe);
  }
  query.set("limit", String(params.limit || 120));
  const response = await fetch(`/api/strategies/self-learning-v4/scopes?${query.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`self_learning_v4_scopes_${response.status}`);
  }
  const payload = await response.json() as {
    items?: SelfLearningV4ScopeSummary[];
    storage?: SelfLearningV4Storage;
  };
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    storage: payload.storage || "unknown",
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function openPrintPdfReport(title: string, lines: string[]): void {
  if (typeof window === "undefined") return;
  const report = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
  if (!report) return;
  const body = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  report.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{font-size:20px;margin:0 0 12px}ul{padding-left:18px}li{margin:6px 0;font-size:13px}small{color:#666}</style></head><body><h1>${escapeHtml(title)}</h1><ul>${body}</ul><small>Use Print -> Save as PDF</small></body></html>`);
  report.document.close();
  report.focus();
  report.print();
}

// ── PORTFOLIO CORRELATION LAYER ───────────────────────────────────────────────
// Utilities for correlation matrix, shrinkage, and cluster detection

function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length < 2 || y.length < 2 || x.length !== y.length) return NaN;
  const n = x.length;
  const meanX = average(x);
  const meanY = average(y);
  let numerator = 0;
  let sumSqX = 0;
  let sumSqY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    sumSqX += dx * dx;
    sumSqY += dy * dy;
  }
  const denominator = Math.sqrt(sumSqX * sumSqY);
  return denominator === 0 ? NaN : numerator / denominator;
}

function shrinkageCorrelation(rawCorr: number, sampleSize: number, shrinkStrength: number = 10): number {
  if (!Number.isFinite(rawCorr)) return NaN;
  // Shrink towards 0: corr_shrunk = rawCorr * (n / (n + k))
  const shrinkFactor = sampleSize / (sampleSize + shrinkStrength);
  return rawCorr * shrinkFactor;
}

function sigmoidPenalty(x: number, scale: number = 2): number {
  // Sigmoid-like: 1 - exp(-scale * x)
  // Smooth, no jagged transitions, asymptotic to 1
  return 1 - Math.exp(-scale * Math.max(0, x));
}

function confidenceInterval(winrate: number, n: number, zScore: number = 1.96): {low: number; high: number; width: number} {
  if (n < 2) return { low: 0, high: 1, width: 1 };
  const p = winrate;
  const margin = zScore * Math.sqrt((p * (1 - p)) / n);
  return {
    low: Math.max(0, p - margin),
    high: Math.min(1, p + margin),
    width: margin * 2,
  };
}

function emaLast(values: number[], period: number): number {
  if (!values.length) return 0;
  const alpha = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = alpha * values[i] + (1 - alpha) * ema;
  }
  return ema;
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

function nextChartMotionPreset(current: ChartMotionPreset): ChartMotionPreset {
  if (current === "scalping") return "swing";
  if (current === "swing") return "auto";
  if (current === "auto") return "scalping";
  if (current === "stable") return "swing";
  if (current === "aggressive") return "scalping";
  return "auto";
}

function toV41MotionPreset(preset: ChartMotionPreset): ChartMotionPreset {
  if (preset === "aggressive") return "scalping";
  if (preset === "stable") return "swing";
  if (preset === "balanced") return "auto";
  return preset;
}

function parseTimestampLike(value: string): number | null {
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const clockMatch = value.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!clockMatch) {
    return null;
  }

  const now = new Date();
  now.setHours(Number(clockMatch[1]), Number(clockMatch[2]), Number(clockMatch[3] || "0"), 0);
  return now.getTime();
}

function toTimeBucketKey(value: string | number, timeframe: string): string {
  const stepMs = timeframeSeconds(timeframe) * 1000;
  const parsed = typeof value === "number" ? value : parseTimestampLike(value);
  if (!parsed || !Number.isFinite(parsed)) {
    return "";
  }
  return String(Math.floor(parsed / stepMs) * stepMs);
}

function incidentSeverityLabel(item: JsonMap): string {
  return String(item.severity || item.level || item.priority || "info").toLowerCase();
}

function incidentSeverityRank(item: JsonMap): number {
  const severity = incidentSeverityLabel(item);
  if (["critical", "sev1", "p1", "high"].includes(severity)) {
    return 4;
  }
  if (["major", "sev2", "p2", "medium"].includes(severity)) {
    return 3;
  }
  if (["minor", "sev3", "p3", "low", "warning", "warn"].includes(severity)) {
    return 2;
  }
  return 1;
}

function incidentStatusRank(item: JsonMap): number {
  const status = String(item.status || "open").toLowerCase();
  if (["open", "new", "triggered"].includes(status)) {
    return 5;
  }
  if (["investigating", "triage", "mitigating"].includes(status)) {
    return 4;
  }
  if (["monitoring", "watching"].includes(status)) {
    return 3;
  }
  if (["resolved", "mitigated"].includes(status)) {
    return 2;
  }
  if (["closed", "done"].includes(status)) {
    return 1;
  }
  return 3;
}

function incidentSlaLabel(item: JsonMap): string {
  return Boolean(item.sla_breached) ? "breach" : "within";
}

function volatilityRegime(points: QuotePoint[]): "low" | "medium" | "high" {
  if (points.length < 6) {
    return "low";
  }
  const returns: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1].value;
    const current = points[index].value;
    if (previous > 0) {
      returns.push((current - previous) / previous);
    }
  }
  const mean = average(returns);
  const variance = average(returns.map((item) => (item - mean) ** 2));
  const sigma = Math.sqrt(Math.max(0, variance));
  if (sigma > 0.006) {
    return "high";
  }
  if (sigma > 0.0025) {
    return "medium";
  }
  return "low";
}

function weightedVwap(points: QuotePoint[]): number {
  if (points.length === 0) {
    return 0;
  }
  let weightedPrice = 0;
  let weightedVolume = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[index - 1]?.value ?? current.value;
    const volume = volumeFromDelta(current.value - previous, index);
    weightedPrice += current.value * volume;
    weightedVolume += volume;
  }
  return weightedVolume === 0 ? points[points.length - 1].value : weightedPrice / weightedVolume;
}

function buildOverlayZones(points: QuotePoint[]): OverlayZone[] {
  if (points.length < 6) {
    return [];
  }

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const zones: OverlayZone[] = [];

  for (let index = 2; index < points.length - 1; index += 1) {
    const previous = points[index - 1].value;
    const current = points[index].value;
    const next = points[index + 1].value;
    const jump = current - previous;
    if (Math.abs(jump) > range * 0.11) {
      const low = Math.min(previous, current);
      const high = Math.max(previous, current);
      zones.push({
        kind: "fvg",
        label: jump > 0 ? "FVG up" : "FVG down",
        x1: index - 1,
        x2: Math.min(index + 2, points.length - 1),
        low,
        high,
        tone: jump > 0 ? "rgba(103, 232, 165, 0.18)" : "rgba(255, 209, 102, 0.18)",
      });
    }

    const reversal = (current - previous) * (next - current) < 0;
    if (reversal && zones.filter((zone) => zone.kind === "ob").length < 2) {
      const window = points.slice(Math.max(0, index - 2), Math.min(points.length, index + 2));
      zones.push({
        kind: "ob",
        label: next > current ? "Bullish OB" : "Bearish OB",
        x1: Math.max(0, index - 2),
        x2: Math.min(points.length - 1, index + 3),
        low: Math.min(...window.map((point) => point.value)),
        high: Math.max(...window.map((point) => point.value)),
        tone: next > current ? "rgba(88, 199, 255, 0.14)" : "rgba(255, 125, 125, 0.14)",
      });
    }
  }

  return zones.slice(0, 4);
}

function buildLiquidityZones(points: QuotePoint[]): LiquidityZone[] {
  if (points.length === 0) {
    return [];
  }
  const counts = new Map<number, number>();
  for (const point of points) {
    const bucket = Number(point.value.toFixed(1));
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([level], index) => ({ level, label: index === 0 ? "Liquidity pool" : "Resting liquidity" }));
}

function buildTape(points: QuotePoint[], timeframe: string): TapePrint[] {
  return points.slice(-12).map((point, index, array) => {
    const previous = index === 0 ? point.value : array[index - 1].value;
    const delta = point.value - previous;
    const side: TapePrint["side"] = delta > 0 ? "buy" : delta < 0 ? "sell" : "flat";
    return {
      label: point.label,
      price: point.value,
      delta,
      side,
      volume: volumeFromDelta(delta, index),
      timeKey: toTimeBucketKey(point.label, timeframe),
    };
  }).reverse();
}

function buildFootprint(points: QuotePoint[]): FootprintRow[] {
  if (points.length === 0) {
    return [];
  }
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const step = range / 6;
  const rows: FootprintRow[] = Array.from({ length: 6 }, (_, index) => ({
    low: min + step * index,
    high: min + step * (index + 1),
    buyVolume: 0,
    sellVolume: 0,
    delta: 0,
  }));

  for (let index = 1; index < points.length; index += 1) {
    const price = points[index].value;
    const delta = price - points[index - 1].value;
    const volume = volumeFromDelta(delta, index);
    const bucket = Math.min(rows.length - 1, Math.max(0, Math.floor(((price - min) / range) * rows.length)));
    if (delta >= 0) {
      rows[bucket].buyVolume += volume;
    } else {
      rows[bucket].sellVolume += volume;
    }
    rows[bucket].delta = rows[bucket].buyVolume - rows[bucket].sellVolume;
  }

  return rows.reverse();
}

function buildDomLevels(orderbook: JsonMap | null): DomLevel[] {
  const bid = toNumber(orderbook?.bid, 0);
  const ask = toNumber(orderbook?.ask, 0);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : Math.max(bid, ask, 1);
  const spread = Math.max(Math.abs(ask - bid), mid * 0.0004);
  const levels: DomLevel[] = [];

  for (let index = 0; index < 8; index += 1) {
    const bidDistance = spread * (index + 0.5);
    const askDistance = spread * (index + 0.5);
    const bidSize = Math.round(80 - index * 8 + (index % 3) * 6);
    const askSize = Math.round(78 - index * 7 + ((index + 1) % 3) * 7);
    levels.push({ side: "bid", price: Number((mid - bidDistance).toFixed(2)), size: bidSize, intensity: Math.max(0.2, bidSize / 90) });
    levels.push({ side: "ask", price: Number((mid + askDistance).toFixed(2)), size: askSize, intensity: Math.max(0.2, askSize / 90) });
  }

  return levels.sort((left, right) => right.price - left.price);
}

function buildDomLevelsFromDepth(depth: JsonMap | null): DomLevel[] {
  const payload = (depth?.depth_payload as JsonMap | undefined) || {};
  const bids = (payload.bids as unknown[] | undefined) || [];
  const asks = (payload.asks as unknown[] | undefined) || [];
  const toLevels = (rows: unknown[], side: "bid" | "ask") => rows.slice(0, 12).map((row) => {
    const level = Array.isArray(row) ? row : [];
    const price = toNumber(level[0], 0);
    const size = toNumber(level[1], 0);
    return {
      side,
      price,
      size,
      intensity: Math.max(0.15, Math.min(1, size / 40)),
    };
  });
  return [...toLevels(asks, "ask"), ...toLevels(bids, "bid")].sort((left, right) => right.price - left.price);
}

function buildTapeFromTrades(trades: JsonMap[], timeframe: string): TapePrint[] {
  return trades.slice(0, 18).map((trade) => {
    const sideRaw = String(trade.side || "flat").toLowerCase();
    const side: TapePrint["side"] = sideRaw === "buy" || sideRaw === "sell" ? sideRaw : "flat";
    const label = String(trade.traded_at || "-");
    return {
      label,
      price: toNumber(trade.price, 0),
      delta: 0,
      side,
      volume: Math.max(1, Math.round(toNumber(trade.size, 0) * 1000)),
      timeKey: toTimeBucketKey(label, timeframe),
    };
  });
}

function buildFootprintFromOhlcv(rows: JsonMap[], timeframe: string): FootprintRow[] {
  return rows.slice(-8).map((row) => {
    const low = toNumber(row.low, 0);
    const high = toNumber(row.high, low);
    const volume = Math.max(0, toNumber(row.volume, 0));
    const open = toNumber(row.open, low);
    const close = toNumber(row.close, low);
    const bullish = close >= open;
    const buyVolume = bullish ? volume * 0.62 : volume * 0.38;
    const sellVolume = volume - buyVolume;
    const sourceTime = String(row.bucket_start || "-");
    return {
      low,
      high,
      buyVolume,
      sellVolume,
      delta: buyVolume - sellVolume,
      timeLabel: formatClock(sourceTime),
      timeKey: toTimeBucketKey(sourceTime, timeframe),
    };
  }).reverse();
}

async function fetchJson(path: string, options?: { allowUnauthorized?: boolean }): Promise<unknown | null> {
  const response = await fetch(path, { cache: "no-store" });
  if (response.status === 401 && options?.allowUnauthorized) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Impossible de charger ${path}`);
  }
  return response.json();
}

async function fetchWsToken(): Promise<string | null> {
  const response = await fetch("/api/auth/ws-token", { cache: "no-store" });
  if (response.status === 401) {
    return "__UNAUTHORIZED__";
  }
  if (!response.ok) {
    return null;
  }
  const payload = await response.json();
  return typeof payload?.token === "string" && payload.token ? payload.token : null;
}

function depthRowToTuple(row: unknown): [number, number] | null {
  if (!Array.isArray(row)) {
    return null;
  }
  const price = toNumber(row[0], 0);
  const size = toNumber(row[1], 0);
  if (price <= 0) {
    return null;
  }
  return [price, Math.max(0, size)];
}

function depthRowsToMap(rows: unknown[]): Map<string, number> {
  const levels = new Map<string, number>();
  for (const row of rows) {
    const parsed = depthRowToTuple(row);
    if (!parsed) {
      continue;
    }
    const [price, size] = parsed;
    levels.set(price.toFixed(8), size);
  }
  return levels;
}

function mapToDepthRows(levels: Map<string, number>, side: "bid" | "ask"): number[][] {
  const rows = [...levels.entries()]
    .map(([price, size]) => [toNumber(price, 0), size] as number[])
    .filter((row) => row[0] > 0 && row[1] > 0)
    .sort((left, right) => (side === "bid" ? right[0] - left[0] : left[0] - right[0]));
  return rows.slice(0, 40);
}

function mergeDepthDelta(currentDepth: JsonMap | null, deltaPayload: JsonMap): JsonMap {
  const currentPayload = (currentDepth?.depth_payload as JsonMap | undefined) || {};
  const bidsMap = depthRowsToMap((currentPayload.bids as unknown[] | undefined) || []);
  const asksMap = depthRowsToMap((currentPayload.asks as unknown[] | undefined) || []);

  for (const row of ((deltaPayload.bids as unknown[] | undefined) || [])) {
    const parsed = depthRowToTuple(row);
    if (!parsed) {
      continue;
    }
    const [price, size] = parsed;
    const key = price.toFixed(8);
    if (size <= 0) {
      bidsMap.delete(key);
    } else {
      bidsMap.set(key, size);
    }
  }

  for (const row of ((deltaPayload.asks as unknown[] | undefined) || [])) {
    const parsed = depthRowToTuple(row);
    if (!parsed) {
      continue;
    }
    const [price, size] = parsed;
    const key = price.toFixed(8);
    if (size <= 0) {
      asksMap.delete(key);
    } else {
      asksMap.set(key, size);
    }
  }

  const bids = mapToDepthRows(bidsMap, "bid");
  const asks = mapToDepthRows(asksMap, "ask");
  const bestBid = bids.length > 0 ? toNumber(bids[0][0], 0) : 0;
  const bestAsk = asks.length > 0 ? toNumber(asks[0][0], 0) : 0;
  const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
  const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10_000 : 0;
  const eventTime = toNumber(deltaPayload.event_time, Date.now());

  return {
    ...(currentDepth || {}),
    venue: String(deltaPayload.venue || currentDepth?.venue || "binance-public"),
    instrument: String(deltaPayload.instrument || currentDepth?.instrument || "UNKNOWN"),
    snapshot_at: new Date(eventTime).toISOString(),
    best_bid: bestBid,
    best_ask: bestAsk,
    spread_bps: spreadBps,
    depth_payload: {
      bids,
      asks,
      lastUpdateId: toNumber(deltaPayload.update_id, toNumber((currentPayload as JsonMap).lastUpdateId, 0)),
      event_time: eventTime,
      reason: "ws-delta",
    },
    source: "depth-ws-delta",
  };
}

function buildMarketDepthWsUrl(instrument: string, venue: string): string {
  if (typeof window === "undefined") {
    return "";
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const base = `${protocol}://${window.location.host}`;
  return `${base}/ws/v1/market/orderbook/depth/${encodeURIComponent(instrument)}?venue=${encodeURIComponent(venue)}`;
}

function buildExecutionTelemetryWsUrl(
  token: string,
  limit: number,
  context?: {
    requestType?: string;
    priority?: string;
    volatility?: string;
    signalState?: string;
    symbol?: string;
  },
): string {
  if (typeof window === "undefined") {
    return "";
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const base = `${protocol}://${window.location.host}`;
  const params = new URLSearchParams({
    token,
    limit: String(limit),
  });
  if (context?.requestType) params.set("request_type", context.requestType);
  if (context?.priority) params.set("priority", context.priority);
  if (context?.volatility) params.set("volatility", context.volatility);
  if (context?.signalState) params.set("signal_state", context.signalState);
  if (context?.symbol) params.set("symbol", context.symbol);
  return `${base}/ws/v1/execution/telemetry?${params.toString()}`;
}

function buildControlPlaneWsBase(): string {
  const configured =
    process.env.NEXT_PUBLIC_CONTROL_PLANE_WS_BASE?.trim() ||
    process.env.NEXT_PUBLIC_CONTROL_PLANE_URL?.trim() ||
    "http://localhost:8000";

  try {
    const parsed = new URL(configured);
    const protocol = parsed.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${parsed.host}`;
  } catch {
    return "ws://localhost:8000";
  }
}

function buildMarketQuotesWsUrl(token: string, instrument?: string): string {
  if (typeof window === "undefined") {
    return "";
  }
  const base = buildControlPlaneWsBase();
  const instrumentPart = instrument ? `&instrument=${encodeURIComponent(instrument)}` : "";
  return `${base}/ws/v1/market/quotes?token=${encodeURIComponent(token)}${instrumentPart}`;
}

function resolveSignalCalibration(symbol: string, timeframe: string): {
  assetClass: "crypto" | "fx" | "index" | "other";
  label: string;
  imbalanceRatio: number;
  absorptionDeltaRatio: number;
  absorptionMovePctMax: number;
  continuationDeltaRatio: number;
  continuationMovePctMin: number;
  breakoutPct: number;
  trapSweepPct: number;
} {
  const upper = symbol.toUpperCase();
  const assetClass =
    /(BTC|ETH|SOL|XRP|DOGE|ADA|AVAX|BNB)/.test(upper) ? "crypto"
      : /^[A-Z]{6}$/.test(upper) || /(EUR|USD|JPY|GBP|CHF|AUD|NZD|CAD)/.test(upper) ? "fx"
        : /(NAS|SPX|DAX|DJI|NQ|US30|GER40|XAU|XAG)/.test(upper) ? "index"
          : "other";

  const base =
    assetClass === "crypto"
      ? { imbalanceRatio: 2.7, absorptionDeltaRatio: 0.17, absorptionMovePctMax: 0.0009, continuationDeltaRatio: 0.2, continuationMovePctMin: 0.0011, breakoutPct: 0.0008, trapSweepPct: 0.00115 }
      : assetClass === "fx"
        ? { imbalanceRatio: 3.25, absorptionDeltaRatio: 0.22, absorptionMovePctMax: 0.00045, continuationDeltaRatio: 0.25, continuationMovePctMin: 0.0007, breakoutPct: 0.00045, trapSweepPct: 0.0007 }
        : assetClass === "index"
          ? { imbalanceRatio: 2.95, absorptionDeltaRatio: 0.2, absorptionMovePctMax: 0.00065, continuationDeltaRatio: 0.23, continuationMovePctMin: 0.00095, breakoutPct: 0.00065, trapSweepPct: 0.00095 }
          : { imbalanceRatio: 3, absorptionDeltaRatio: 0.2, absorptionMovePctMax: 0.0006, continuationDeltaRatio: 0.22, continuationMovePctMin: 0.0009, breakoutPct: 0.0006, trapSweepPct: 0.0009 };

  const tfFactor = timeframe === "1m" ? 0.94 : timeframe === "5m" ? 1 : 1.1;
  return {
    assetClass,
    label: `${assetClass.toUpperCase()} ${timeframe}`,
    imbalanceRatio: base.imbalanceRatio * tfFactor,
    absorptionDeltaRatio: base.absorptionDeltaRatio * (timeframe === "15m" ? 1.08 : 1),
    absorptionMovePctMax: base.absorptionMovePctMax * (timeframe === "1m" ? 1.15 : timeframe === "15m" ? 0.9 : 1),
    continuationDeltaRatio: base.continuationDeltaRatio * (timeframe === "1m" ? 0.96 : 1.05),
    continuationMovePctMin: base.continuationMovePctMin * (timeframe === "15m" ? 1.12 : 1),
    breakoutPct: base.breakoutPct * (timeframe === "15m" ? 1.15 : 1),
    trapSweepPct: base.trapSweepPct * (timeframe === "15m" ? 1.1 : 1),
  };
}

function decisionIdFrom(item: JsonMap): string {
  return String(item.decision_id || "").trim();
}

function sortIsoAscending(left: string, right: string): number {
  return new Date(left).getTime() - new Date(right).getTime();
}

function formatClock(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}:${String(parsed.getSeconds()).padStart(2, "0")}`;
}

function formatTimeKeyLabel(timeKey: string | null): string {
  if (!timeKey) {
    return "--:--:--";
  }
  const parsed = Number(timeKey);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "--:--:--";
  }
  return formatClock(new Date(parsed).toISOString());
}

function clampIndex(value: number, maxIndex: number): number {
  return Math.max(0, Math.min(maxIndex, value));
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

export default function TradingTerminalPage() {
  const [layoutEditMode, setLayoutEditMode] = useState(false);
  const [snapshot, setSnapshot] = useState<JsonMap | null>(null);
  const [readiness, setReadiness] = useState<JsonMap | null>(null);
  const [aiHealth, setAiHealth] = useState<JsonMap | null>(null);
  const [overview, setOverview] = useState<JsonMap | null>(null);
  const [mt5Health, setMt5Health] = useState<JsonMap | null>(null);
  const [incidents, setIncidents] = useState<JsonMap[]>([]);
  const [pendingLive, setPendingLive] = useState<JsonMap[]>([]);
  const [outcomes, setOutcomes] = useState<JsonMap[]>([]);
  const [quotes, setQuotes] = useState<JsonMap[]>([]);
  const [positions, setPositions] = useState<JsonMap[]>([]);
  const [balance, setBalance] = useState<JsonMap | null>(null);
  const [orderbook, setOrderbook] = useState<JsonMap | null>(null);
  const [marketDepth, setMarketDepth] = useState<JsonMap | null>(null);
  const [marketMicro, setMarketMicro] = useState<JsonMap | null>(null);
  const [ohlcvBars, setOhlcvBars] = useState<JsonMap[]>([]);
  const [nativeTrades, setNativeTrades] = useState<JsonMap[]>([]);
  const [sessionState, setSessionState] = useState<JsonMap | null>(null);
  const [routingScore, setRoutingScore] = useState<JsonMap | null>(null);
  const [executionTelemetry, setExecutionTelemetry] = useState<JsonMap[]>([]);
  const [depthStreamState, setDepthStreamState] = useState<"offline" | "connecting" | "live">("offline");
  const [telemetryStreamState, setTelemetryStreamState] = useState<"offline" | "connecting" | "live">("offline");
  const [replayDecisionId, setReplayDecisionId] = useState("");
  const [replayPayload, setReplayPayload] = useState<JsonMap | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [authSessionRequired, setAuthSessionRequired] = useState(false);
  const [quoteHistory, setQuoteHistory] = useState<QuoteHistoryMap>({});
  const [error, setError] = useState<string | null>(null);
  const [signalActionToast, setSignalActionToast] = useState<MarketSignalAlertToast | null>(null);
  const [signalAlertBadgeCount, setSignalAlertBadgeCount] = useState(0);
  const [signalConfidenceDrift, setSignalConfidenceDrift] = useState<SignalConfidenceDrift>("FLAT");
  const [busy, setBusy] = useState(false);
  const [tradeResult, setTradeResult] = useState<JsonMap | null>(null);

  const [environmentFilter, setEnvironmentFilter] = useState("all");
  const [marketFilter, setMarketFilter] = useState("all");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [uiMode, setUiMode] = useUiMode();
  const [chartMotionPreset, setChartMotionPreset] = useChartMotionPreset();
  const chartMotionClass = chartMotionPreset === "scalping"
    ? "aggressive"
    : chartMotionPreset === "swing"
      ? "stable"
      : chartMotionPreset === "auto"
        ? "balanced"
        : chartMotionPreset;
  const [chartSnapEnabled, setChartSnapEnabled] = useChartSnapEnabled();
  const [chartSnapPriority, setChartSnapPriority] = useChartSnapPriority();
  const [chartReleaseSendMode, setChartReleaseSendMode] = useChartReleaseSendMode();
  const [chartHapticMode, setChartHapticMode] = useChartHapticMode();
  const [layoutPreset, setLayoutPreset] = useState<LayoutPreset>("swing");
  const [layoutWorkspaceName, setLayoutWorkspaceName] = useState("Swing-NY");
  const [layoutWorkspaceOptions, setLayoutWorkspaceOptions] = useState<string[]>(["Scalp-1", "Swing-NY", "Monitoring-Risk"]);
  const [workspaceHintBadge, setWorkspaceHintBadge] = useState<string | null>(null);
    const [layoutScreenProfile, setLayoutScreenProfile] = useState<"sm" | "md" | "lg" | "xl">("lg");
  const [layoutCoreSplit, setLayoutCoreSplit] = useState(uiMode === "novice" ? 72 : 78);
  const [layoutMicroOrder, setLayoutMicroOrder] = useState<DockPanelId[]>([...MICRO_PANEL_IDS]);
  const [layoutLowerOrder, setLayoutLowerOrder] = useState<DockPanelId[]>([...LOWER_PANEL_IDS]);
  const [layoutMonitoringOrder, setLayoutMonitoringOrder] = useState<DockPanelId[]>([...MONITORING_PANEL_IDS]);
  const [floatingPanels, setFloatingPanels] = useState<FloatingPanelState[]>([]);
  const [layoutDropPreview, setLayoutDropPreview] = useState<{ zone: DockZone; targetId?: DockPanelId; mode: "zone" | "panel" } | null>(null);
  const [selectedChartSymbol, setSelectedChartSymbol] = useState("BTCUSD");
  const [chartLinkGroup, setChartLinkGroup] = useState<"A" | "B" | "C">("A");
  const [chartLinkSymbolEnabled, setChartLinkSymbolEnabled] = useState(true);
  const [chartLinkTimeframeEnabled, setChartLinkTimeframeEnabled] = useState(true);
  const [chartViewDensity, setChartViewDensity] = useState<2 | 3>(2);
  const [chartPerfMode, setChartPerfMode] = useState<"auto" | "balanced" | "ultra">("auto");
  const [activeIndicators, setActiveIndicators] = useState<ActiveIndicator[]>([]);
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);
  const [indicatorSeriesForChart, setIndicatorSeriesForChart] = useState<IndicatorSeriesData[]>([]);
  const indicatorComputeSeqRef = useRef(0);
  const signalAlertSignatureRef = useRef("");
  const signalConfidenceTrailRef = useRef<number[]>([]);
  const executionAdaptationSignatureRef = useRef("");

  const INDICATOR_CATALOG = [
    { category: "trend",      ids: ["ema9","ema21","ema50","ema200","sma","wma","dema","vwap"] },
    { category: "momentum",   ids: ["rsi","macd","stoch","cci","momentum","roc"] },
    { category: "volatility", ids: ["bb","atr","keltner","donchian"] },
    { category: "volume",     ids: ["obv","volsma","cvd","cmf"] },
    { category: "custom",     ids: ["supertrend","market_structure"] },
  ];

  function toggleIndicator(id: string) {
    setActiveIndicators((prev) => {
      const exists = prev.some((a) => a.id === id);
      return exists ? prev.filter((a) => a.id !== id) : [...prev, { id, params: {} }];
    });
  }
  const [chartPropagationByGroup, setChartPropagationByGroup] = useState<Record<ChartGroupId, ChartPropagationMode>>({
    A: "both",
    B: "both",
    C: "both",
  });
  const [chartSyncPriorityMode, setChartSyncPriorityMode] = useState<ChartSyncPriorityMode>("last-edited");
  const [chartSyncLeaderGroup, setChartSyncLeaderGroup] = useState<ChartGroupId>("A");
  const [chartPanels, setChartPanels] = useState<Record<ChartGroupId, ChartPanelState>>({
    A: { symbol: "BTCUSD", timeframe: "1m", source: "workspace", sourceFrom: null, updatedAt: new Date().toISOString() },
    B: { symbol: "BTCUSD", timeframe: "5m", source: "workspace", sourceFrom: null, updatedAt: new Date().toISOString() },
    C: { symbol: "BTCUSD", timeframe: "15m", source: "workspace", sourceFrom: null, updatedAt: new Date().toISOString() },
  });
  const [chartPanelData, setChartPanelData] = useState<Record<ChartGroupId, ChartPanelData>>({
    A: { points: [], candles: [], loading: false },
    B: { points: [], candles: [], loading: false },
    C: { points: [], candles: [], loading: false },
  });

  const [accountId, setAccountId] = useState("mt5-demo-01");
  const [symbol, setSymbol] = useState("BTCUSD");
  const [side, setSide] = useState("buy");
  const [lots, setLots] = useState(0.1);
  const [notional, setNotional] = useState(15000);
  const [maxSpread, setMaxSpread] = useState(15);
  const [rationale, setRationale] = useState("Breakout confirme + risque controle");
  const [chartMode, setChartMode] = useState<"line" | "candles" | "footprint">("candles");
  const [chartTimeframe, setChartTimeframe] = useState("1m");
  const [chartWindow, setChartWindow] = useState(80);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartOrderTicket, setChartOrderTicket] = useState<ChartOrderTicket>({
    side: "buy",
    preset: "scalp",
    entry: 0,
    sl: 0,
    tp: 0,
    oco: true,
    active: true,
  });
  const [chartSnapState, setChartSnapState] = useState<ChartSnapState>(null);
  const [chartActiveSnapLine, setChartActiveSnapLine] = useState<ChartOrderLineKey | null>(null);
  const [chartSnapPulseLine, setChartSnapPulseLine] = useState<ChartOrderLineKey | null>(null);
  const [chartReleaseTicket, setChartReleaseTicket] = useState<ChartReleaseTicketState>(null);
  const [chartReleaseValidationPulse, setChartReleaseValidationPulse] = useState(false);
  const [chartOrderPreviewOpen, setChartOrderPreviewOpen] = useState(false);
  const [chartRiskGuardEnabled, setChartRiskGuardEnabled] = useState(true);
  const [chartMaxLossUsd, setChartMaxLossUsd] = useState(uiMode === "novice" ? 120 : 250);
  const [chartTargetGainUsd, setChartTargetGainUsd] = useState(uiMode === "novice" ? 220 : 500);
  const [signalDisplayMode, setSignalDisplayMode] = useState<SignalDisplayMode>("augmented");
  const [confluenceWeights, setConfluenceWeights] = useState<MarketConfluenceWeights>({ ...DEFAULT_CONFLUENCE_WEIGHTS });
  const [showReasonLegend, setShowReasonLegend] = useState(false);
  const [showConfluenceTune, setShowConfluenceTune] = useState(false);
  const [showDecisionSecondary, setShowDecisionSecondary] = useState(false);
  const [executionAdaptMode, setExecutionAdaptMode] = useState<ExecutionAdaptMode>("auto");
  const [autoExecutionMode, setAutoExecutionMode] = useState<AutoExecutionMode>("semi-auto");
  const [autoExecutionKillSwitch, setAutoExecutionKillSwitch] = useState(false);
  const [autoSessionGuardEnabled, setAutoSessionGuardEnabled] = useState(true);
  const [autoSessionStartHour, setAutoSessionStartHour] = useState(7);
  const [autoSessionEndHour, setAutoSessionEndHour] = useState(22);
  const [autoSymbolLossCapUsd, setAutoSymbolLossCapUsd] = useState(600);
  const [autoSymbolAutoDisabled, setAutoSymbolAutoDisabled] = useState<Record<string, string>>({});
  const [autoExecutionAuditTrail, setAutoExecutionAuditTrail] = useState<AutoExecutionAuditEvent[]>([]);
  const [autoExecutionAuditStateFilter, setAutoExecutionAuditStateFilter] = useState<"all" | "READY" | "BLOCKED" | "KILLED">("all");
  const [autoExecutionAuditReasonSearch, setAutoExecutionAuditReasonSearch] = useState("");
  const [selfLearningV4Enabled, setSelfLearningV4Enabled] = useState(true);
  const [selfLearningAutoAdaptEnabled, setSelfLearningAutoAdaptEnabled] = useState(true);
  const [selfLearningModelUpdatedAt, setSelfLearningModelUpdatedAt] = useState<string | null>(null);
  const [selfLearningDriftAutoDemotedAt, setSelfLearningDriftAutoDemotedAt] = useState<string | null>(null);
  const [selfLearningJournalV4Trail, setSelfLearningJournalV4Trail] = useState<SelfLearningJournalEventV4[]>([]);
  const [selfLearningJournalV4RegimeFilter, setSelfLearningJournalV4RegimeFilter] = useState<"all" | LearningRegimeV4>("all");
  const [selfLearningJournalV4ScenarioFilter, setSelfLearningJournalV4ScenarioFilter] = useState<"all" | MarketDecisionScenario>("all");
  const [selfLearningV4ScopeSummaries, setSelfLearningV4ScopeSummaries] = useState<SelfLearningV4ScopeSummary[]>([]);
  const [selfLearningV4PersistenceStatus, setSelfLearningV4PersistenceStatus] = useState<SelfLearningV4PersistenceStatus>({
    storage: "unknown",
    healthy: false,
    stateLoadedAt: null,
    stateSavedAt: null,
    scopesLoadedAt: null,
    scopeCount: 0,
    message: "init",
  });
  const [pendingExecutionAdaptation, setPendingExecutionAdaptation] = useState<{
    signature: string;
    plan: MarketDecisionSnapshot["executionPlan"];
  } | null>(null);
  const [chartHudConfirmArmed, setChartHudConfirmArmed] = useState(false);
  const [chartSendHistory, setChartSendHistory] = useState<ChartSendHistoryEntry[]>([]);
  const [chartSendHistoryBackend, setChartSendHistoryBackend] = useState<ChartSendHistoryEntry[]>([]);
  const [riskTimelineFilter, setRiskTimelineFilter] = useState<RiskTimelineFilter>("all");
  const [riskTimelineFrom, setRiskTimelineFrom] = useState("");
  const [riskTimelineTo, setRiskTimelineTo] = useState("");
  const [riskAlertWindow, setRiskAlertWindow] = useState(DEFAULT_RISK_ALERT_WINDOW);
  const [riskAlertMissThreshold, setRiskAlertMissThreshold] = useState(DEFAULT_RISK_ALERT_MISS_THRESHOLD);
  const [riskTimelineRefreshSec, setRiskTimelineRefreshSec] = useState<5 | 15 | 30>(DEFAULT_RISK_REFRESH_SEC);
  const [riskHardAlertEnabled, setRiskHardAlertEnabled] = useState(false);
  const [riskHardAlertThresholdPct, setRiskHardAlertThresholdPct] = useState(DEFAULT_HARD_ALERT_RATIO_PCT);
  const [riskSummary, setRiskSummary] = useState<RiskHistorySummary | null>(null);
  const [riskPollingStatus, setRiskPollingStatus] = useState<RiskPollingStatus>({
    lastRefreshIso: null,
    latencyMs: null,
    source: null,
  });
  const [riskPollingFailures, setRiskPollingFailures] = useState(0);
  const [riskPollAgeSec, setRiskPollAgeSec] = useState(0);
  const [crosshair, setCrosshair] = useState<ChartCursorPayload>(null);
  const [marketMetricsBySymbol, setMarketMetricsBySymbol] = useState<Record<string, MarketMetric>>({});
  const [governanceSort, setGovernanceSort] = useState<GovernanceSort>("severity");
  const [incidentSort, setIncidentSort] = useState<IncidentSort>("severity");
  const [governanceOnlyAlerts, setGovernanceOnlyAlerts] = useState(false);
  const [governanceFilterText, setGovernanceFilterText] = useState("");
  const [showVwap, setShowVwap] = useState(true);
  const [showFvgOb, setShowFvgOb] = useState(true);
  const [showLiquidity, setShowLiquidity] = useState(true);
  const [showSessions, setShowSessions] = useState(true);
  const [replayBuffers, setReplayBuffers] = useState<ReplayBufferMap>({});
  const [replayState, setReplayState] = useState<ReplayState>({
    enabled: false,
    playing: false,
    speed: 1,
    cursorIndex: 0,
    timeKey: null,
  });
  const [replayFilterKinds, setReplayFilterKinds] = useState<string[]>([]);
  const [replayFilterCritical, setReplayFilterCritical] = useState<boolean>(false);
  const [strategyCooldowns, setStrategyCooldowns] = useState<Record<string, {demoteTime?: number, reduceTime?: number}>>({});
  const [metaRiskAuditTrail, setMetaRiskAuditTrail] = useState<MetaRiskAuditEvent[]>([]);
  const [metaRiskAuditShowOnlyDrops, setMetaRiskAuditShowOnlyDrops] = useState(false);
  const [metaRiskAuditDropSort, setMetaRiskAuditDropSort] = useState<"recent" | "largest">("recent");
  const [metaRiskHealthHistory, setMetaRiskHealthHistory] = useState<number[]>([]);
  const [autoTuningAuditTrail, setAutoTuningAuditTrail] = useState<AutoTuningAuditEvent[]>([]);
  const [autoTuningBusy, setAutoTuningBusy] = useState(false);
  const [autoTuningStatus, setAutoTuningStatus] = useState("");
  const [autoTuningAdminKey, setAutoTuningAdminKey] = useState("");
  const [autoTuningIdempotencyKey, setAutoTuningIdempotencyKey] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-idempotency`,
  );
  const [autoTuningMinConfidence, setAutoTuningMinConfidence] = useState(0.35);
  const [autoTuningMaxRecommendations, setAutoTuningMaxRecommendations] = useState(8);
  const [autoTuningWeightFloorPct, setAutoTuningWeightFloorPct] = useState(0);
  const [autoTuningWeightCapPct, setAutoTuningWeightCapPct] = useState(30);
  const [autoTuningRenormalize, setAutoTuningRenormalize] = useState(true);
  const [rollbackGuardSession, setRollbackGuardSession] = useState<RollbackGuardSession | null>(null);
  const [rollbackGuardHistory, setRollbackGuardHistory] = useState<RollbackGuardSession[]>([]);
  const [rollbackGuardWindowMin, setRollbackGuardWindowMin] = useState(
    Number.isFinite(ROLLBACK_GUARD_WINDOW_MIN) ? Math.max(10, Math.min(480, Math.round(ROLLBACK_GUARD_WINDOW_MIN))) : 90,
  );
  const [rollbackGuardHealthDrop, setRollbackGuardHealthDrop] = useState(
    Number.isFinite(ROLLBACK_GUARD_HEALTH_DROP) ? Math.max(0.01, Math.min(0.5, ROLLBACK_GUARD_HEALTH_DROP)) : 0.08,
  );
  const [rollbackGuardBrierRise, setRollbackGuardBrierRise] = useState(
    Number.isFinite(ROLLBACK_GUARD_BRIER_RISE) ? Math.max(0.005, Math.min(0.2, ROLLBACK_GUARD_BRIER_RISE)) : 0.035,
  );
  const rollbackGuardClosedRef = useRef<string>("");
  const chartStageRef = useRef<HTMLDivElement | null>(null);
  const decisionSecondaryRef = useRef<HTMLDivElement | null>(null);
  const chartOrderDragRef = useRef<ChartDragState | null>(null);
  const chartLongPressTimerRef = useRef<number | null>(null);
  const chartOrderTicketRef = useRef<ChartOrderTicket>(chartOrderTicket);
  const chartSnapStateRef = useRef<ChartSnapState>(null);
  const chartSnapHapticSignatureRef = useRef("");
  const marketBurstAbortRef = useRef<AbortController | null>(null);
  const marketBurstTimerRef = useRef<number | null>(null);
  const marketBurstLastKeyRef = useRef("");
  const marketBurstLastStartedAtRef = useRef(0);
  const routingScoreCacheRef = useRef<Map<string, { timestamp: number; promise: Promise<JsonMap | null> }>>(new Map());
  const chartPanelsAbortRef = useRef<AbortController | null>(null);
  const marketMetricsAbortRef = useRef<AbortController | null>(null);
  const quotesRef = useRef<JsonMap[]>([]);
  const backendPrefsReadyRef = useRef(false);
  const backendUpdatedAtRef = useRef<string | null>(null);
  const backendPrefsRef = useRef<Partial<UserUiPreferencesProfile> | null>(null);
  const termCoreGroupRef = useRef<ImperativePanelGroupHandle | null>(null);
  const layoutImportInputRef = useRef<HTMLInputElement | null>(null);
  const layoutDragRef = useRef<{ zone: DockZone; id: DockPanelId } | null>(null);
  const floatingDragRef = useRef<{ id: DockPanelId; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const hotkeyActionsRef = useRef({
    applyLayoutPreset: (p: LayoutPreset) => { void p; },
    toggleEditMode: () => {},
    saveLayout: () => {},
    restoreLayout: () => {},
    resetFloating: () => {},
    cycleWorkspace: (_direction: 1 | -1) => {},
  });
  const metaRiskPrevRef = useRef<{
    tier: string;
    capitalMultiplier: number;
    blockedRegimesKey: string;
    venueLabel: string;
  } | null>(null);

  const layoutStorageKey = `${TERMINAL_LAYOUT_STORAGE_PREFIX}.${accountId || "default"}`;
  const layoutWorkspaceStorageKey = `${TERMINAL_WORKSPACES_STORAGE_PREFIX}.${accountId || "default"}`;
  const chartLinkStorageKey = `${TERMINAL_CHART_LINK_STORAGE_PREFIX}.${accountId || "default"}.${chartLinkGroup}`;
  const coreSplitByScreenStorageKey = `${layoutStorageKey}.core-split-by-screen.v1`;
  const signalEngineStorageKey = `${layoutStorageKey}.signal-engine.v1.${layoutWorkspaceName}`;
  const reasonLegendStorageKey = `${signalEngineStorageKey}.reason-codes-legend.v1`;
  const termCoreAutoSaveId = `txt-terminal-core-split-v2.${accountId || "default"}.${layoutWorkspaceName}.${layoutScreenProfile}`;
  const autoExecutionSignatureRef = useRef("");
  const autoExecutionLastAtRef = useRef(0);
  const autoExecutionAuditSignatureRef = useRef("");
  const selfLearningModelSignatureRef = useRef("");
  const selfLearningDriftSignatureRef = useRef("");
  const selfLearningJournalSignatureRef = useRef("");
  const selfLearningBackendReadyRef = useRef(false);
  const selfLearningBackendScopeRef = useRef("");
  const authBackoffUntilRef = useRef(0);

  const markUnauthorizedBackoff = () => {
    authBackoffUntilRef.current = Date.now() + 30_000;
    setAuthSessionRequired(true);
  };

  const buildRoutingRequestHeaders = (requestType: "ui" | "ai" | "execution", symbolValue: string): HeadersInit => {
    const signalState = marketDecisionV1.scenario === "reversal"
      ? "reversal"
      : marketDecisionV1.criticalConfirmed
        ? "fast"
        : "normal";
    const volatility = overlayDecisionRegime === "high"
      ? "high"
      : overlayDecisionRegime === "medium"
        ? "medium"
        : "low";
    return {
      "x-mc-request-type": requestType,
      "x-mc-priority": requestType === "execution" ? "execution" : requestType === "ai" ? "high" : "low",
      "x-mc-market-volatility": volatility,
      "x-mc-signal-state": signalState,
      "x-mc-symbol": normalizeInstrument(symbolValue),
      "x-mc-origin": "terminal",
    };
  };

  const fetchRoutingScoreCached = (symbolValue: string, requestType: "ui" | "ai" | "execution" = "ui"): Promise<JsonMap | null> => {
    const key = symbolValue.trim().toUpperCase();
    const now = Date.now();
    const ttlMs = 1500;
    const cache = routingScoreCacheRef.current;
    if (requestType === "execution") {
      return fetch(`/api/execution/routing/score?symbol=${encodeURIComponent(symbolValue)}`, {
        cache: "no-store",
        headers: buildRoutingRequestHeaders("execution", symbolValue),
      }).then((response) => (response.ok ? response.json() : null)).catch(() => null) as Promise<JsonMap | null>;
    }
    const cached = cache.get(key);
    if (cached && now - cached.timestamp < ttlMs) {
      return cached.promise;
    }

    const contextualPromise = fetch(`/api/execution/routing/score?symbol=${encodeURIComponent(symbolValue)}`, {
      cache: "no-store",
      headers: buildRoutingRequestHeaders(requestType, symbolValue),
    })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null) as Promise<JsonMap | null>;

    cache.set(key, { timestamp: now, promise: contextualPromise });
    if (cache.size > 32) {
      for (const [cacheKey, value] of cache.entries()) {
        if (now - value.timestamp > ttlMs) {
          cache.delete(cacheKey);
        }
        if (cache.size <= 24) {
          break;
        }
      }
    }
    return contextualPromise;
  };

  useEffect(() => {
    chartOrderTicketRef.current = chartOrderTicket;
  }, [chartOrderTicket]);

  useEffect(() => {
    chartSnapStateRef.current = chartSnapState;
  }, [chartSnapState]);

  useEffect(() => {
    quotesRef.current = quotes;
  }, [quotes]);

  useEffect(() => () => {
    if (chartLongPressTimerRef.current !== null) {
      window.clearTimeout(chartLongPressTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!showDecisionSecondary || typeof window === "undefined") {
      return;
    }
    if (!window.matchMedia("(max-width: 680px)").matches) {
      return;
    }
    const timer = window.setTimeout(() => {
      const target = decisionSecondaryRef.current;
      if (!target) {
        return;
      }
      const hud = target.closest(".chart-order-hud");
      if (hud instanceof HTMLElement) {
        const hudRect = hud.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const rawDelta = targetRect.top - hudRect.top - 34;
        const shortDelta = Math.max(-56, Math.min(118, rawDelta));
        if (Math.abs(shortDelta) > 7) {
          hud.scrollTo({ top: hud.scrollTop + shortDelta, behavior: "smooth" });
        }
        return;
      }
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 90);
    return () => window.clearTimeout(timer);
  }, [showDecisionSecondary]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const refreshProfile = () => {
      setLayoutScreenProfile(screenLayoutProfile(window.innerWidth));
    };
    refreshProfile();
    window.addEventListener("resize", refreshProfile);
    return () => {
      window.removeEventListener("resize", refreshProfile);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const serialized = window.localStorage.getItem(coreSplitByScreenStorageKey);
      if (!serialized) {
        return;
      }
      const parsed = JSON.parse(serialized) as Record<string, number>;
      const key = `${layoutWorkspaceName}::${layoutScreenProfile}`;
      const stored = parsed[key];
      if (!Number.isFinite(stored)) {
        return;
      }
      const next = Math.max(52, Math.min(85, Number(stored)));
      setLayoutCoreSplit(next);
      if (termCoreGroupRef.current) {
        termCoreGroupRef.current.setLayout([next, 100 - next]);
      }
    } catch {
      // noop
    }
  }, [coreSplitByScreenStorageKey, layoutScreenProfile, layoutWorkspaceName]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const raw = window.localStorage.getItem(signalEngineStorageKey);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as {
        confluenceWeights?: Partial<MarketConfluenceWeights>;
        executionAdaptMode?: ExecutionAdaptMode;
        signalDisplayMode?: SignalDisplayMode;
        autoExecutionMode?: AutoExecutionMode;
        autoExecutionKillSwitch?: boolean;
        autoSessionGuardEnabled?: boolean;
        autoSessionStartHour?: number;
        autoSessionEndHour?: number;
        autoSymbolLossCapUsd?: number;
        autoSymbolAutoDisabled?: Record<string, string>;
        selfLearningV4Enabled?: boolean;
        selfLearningAutoAdaptEnabled?: boolean;
        selfLearningDriftAutoDemotedAt?: string | null;
      };
      if (parsed.confluenceWeights && typeof parsed.confluenceWeights === "object") {
        setConfluenceWeights({
          dom: Number(parsed.confluenceWeights.dom) || DEFAULT_CONFLUENCE_WEIGHTS.dom,
          footprint: Number(parsed.confluenceWeights.footprint) || DEFAULT_CONFLUENCE_WEIGHTS.footprint,
          liquidity: Number(parsed.confluenceWeights.liquidity) || DEFAULT_CONFLUENCE_WEIGHTS.liquidity,
          "price-action": Number(parsed.confluenceWeights["price-action"]) || DEFAULT_CONFLUENCE_WEIGHTS["price-action"],
        });
      }
      if (parsed.executionAdaptMode === "auto" || parsed.executionAdaptMode === "confirm" || parsed.executionAdaptMode === "manual") {
        setExecutionAdaptMode(parsed.executionAdaptMode);
      }
      if (parsed.signalDisplayMode === "classic" || parsed.signalDisplayMode === "augmented" || parsed.signalDisplayMode === "ai-dominant") {
        setSignalDisplayMode(parsed.signalDisplayMode);
      }
      if (parsed.autoExecutionMode === "assisted" || parsed.autoExecutionMode === "semi-auto" || parsed.autoExecutionMode === "full-auto") {
        setAutoExecutionMode(parsed.autoExecutionMode);
      }
      if (typeof parsed.autoExecutionKillSwitch === "boolean") {
        setAutoExecutionKillSwitch(parsed.autoExecutionKillSwitch);
      }
      if (typeof parsed.autoSessionGuardEnabled === "boolean") {
        setAutoSessionGuardEnabled(parsed.autoSessionGuardEnabled);
      }
      if (Number.isFinite(parsed.autoSessionStartHour)) {
        setAutoSessionStartHour(Math.max(0, Math.min(23, Number(parsed.autoSessionStartHour))));
      }
      if (Number.isFinite(parsed.autoSessionEndHour)) {
        setAutoSessionEndHour(Math.max(0, Math.min(23, Number(parsed.autoSessionEndHour))));
      }
      if (Number.isFinite(parsed.autoSymbolLossCapUsd)) {
        setAutoSymbolLossCapUsd(Math.max(50, Number(parsed.autoSymbolLossCapUsd)));
      }
      if (parsed.autoSymbolAutoDisabled && typeof parsed.autoSymbolAutoDisabled === "object") {
        setAutoSymbolAutoDisabled(parsed.autoSymbolAutoDisabled);
      }
      if (typeof parsed.selfLearningV4Enabled === "boolean") {
        setSelfLearningV4Enabled(parsed.selfLearningV4Enabled);
      }
      if (typeof parsed.selfLearningAutoAdaptEnabled === "boolean") {
        setSelfLearningAutoAdaptEnabled(parsed.selfLearningAutoAdaptEnabled);
      }
      if (typeof parsed.selfLearningDriftAutoDemotedAt === "string" || parsed.selfLearningDriftAutoDemotedAt === null) {
        setSelfLearningDriftAutoDemotedAt(parsed.selfLearningDriftAutoDemotedAt || null);
      }
    } catch {
      // noop
    }
  }, [signalEngineStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const payload = {
      confluenceWeights,
      executionAdaptMode,
      signalDisplayMode,
      autoExecutionMode,
      autoExecutionKillSwitch,
      autoSessionGuardEnabled,
      autoSessionStartHour,
      autoSessionEndHour,
      autoSymbolLossCapUsd,
      autoSymbolAutoDisabled,
      selfLearningV4Enabled,
      selfLearningAutoAdaptEnabled,
      selfLearningDriftAutoDemotedAt,
    };
    window.localStorage.setItem(signalEngineStorageKey, JSON.stringify(payload));
  }, [
    autoExecutionKillSwitch,
    autoExecutionMode,
    autoSessionEndHour,
    autoSessionGuardEnabled,
    autoSessionStartHour,
    autoSymbolAutoDisabled,
    autoSymbolLossCapUsd,
    confluenceWeights,
    executionAdaptMode,
    selfLearningDriftAutoDemotedAt,
    selfLearningAutoAdaptEnabled,
    selfLearningV4Enabled,
    signalDisplayMode,
    signalEngineStorageKey,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const seen = window.localStorage.getItem(reasonLegendStorageKey) === "1";
      if (!seen) {
        setShowReasonLegend(true);
        window.localStorage.setItem(reasonLegendStorageKey, "1");
      }
    } catch {
      // noop
    }
  }, [reasonLegendStorageKey]);

  useEffect(() => {
    if (!showReasonLegend || typeof window === "undefined") {
      return;
    }
    const timer = window.setTimeout(() => setShowReasonLegend(false), 4200);
    return () => window.clearTimeout(timer);
  }, [showReasonLegend]);

  useEffect(() => {
    if (signalDisplayMode === "classic") {
      setShowConfluenceTune(false);
      setShowDecisionSecondary(false);
    }
  }, [signalDisplayMode]);

  useEffect(() => {
    let cancelled = false;
    void fetchBackendUserUiPreferences().then((payload) => {
      if (cancelled) {
        return;
      }
      const profile = payload?.preferences;
      backendUpdatedAtRef.current = payload?.updatedAt || null;
      if (payload?.updatedAt) {
        setLocalUserUiPreferencesUpdatedAt(payload.updatedAt);
      }
      if (profile) {
        backendPrefsRef.current = profile;
        applyLocalUserUiPreferences(profile);
        applyBackendTerminalProfile(profile);
        if (profile.uiMode === "novice" || profile.uiMode === "expert") {
          setUiMode(profile.uiMode);
        }
        if (
          profile.chartMotionPreset === "stable"
          || profile.chartMotionPreset === "balanced"
          || profile.chartMotionPreset === "aggressive"
          || profile.chartMotionPreset === "scalping"
          || profile.chartMotionPreset === "swing"
          || profile.chartMotionPreset === "auto"
        ) {
          setChartMotionPreset(toV41MotionPreset(profile.chartMotionPreset));
        }
        if (typeof profile.chartSnapEnabled === "boolean") {
          setChartSnapEnabled(profile.chartSnapEnabled);
        }
        if (profile.chartSnapPriority === "execution" || profile.chartSnapPriority === "vwap" || profile.chartSnapPriority === "liquidity") {
          setChartSnapPriority(profile.chartSnapPriority);
        }
        if (profile.chartReleaseSendMode === "one-click" || profile.chartReleaseSendMode === "confirm-required") {
          setChartReleaseSendMode(profile.chartReleaseSendMode);
        }
        if (profile.chartHapticMode === "off" || profile.chartHapticMode === "light" || profile.chartHapticMode === "medium") {
          setChartHapticMode(profile.chartHapticMode);
        }
        restoreSavedLayout();
        restoreWorkspaceBundle();
      }
      backendPrefsReadyRef.current = true;
    }).catch(() => {
      backendPrefsReadyRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, layoutStorageKey, layoutWorkspaceStorageKey]);

  useEffect(() => {
    if (!backendPrefsReadyRef.current) {
      return;
    }
    const baseProfile = backendPrefsRef.current || {};
    const accountKey = accountId || "default";
    const currentWorkspaceBundle = readCurrentAccountWorkspaceBundle() || { active: layoutWorkspaceName, workspaces: { [layoutWorkspaceName]: currentLayoutSnapshot() } };
    const floatingPresetMap = Object.entries(currentWorkspaceBundle.workspaces || {}).reduce<Record<string, unknown>>((acc, [name, layout]) => {
      const floating = Array.isArray(layout?.floatingPanels) ? layout.floatingPanels : [];
      acc[name] = floating;
      return acc;
    }, {});
    const nextProfile: UserUiPreferencesProfile = {
      ...baseProfile,
      ...readLocalUserUiPreferences(),
      terminalLayoutByAccount: {
        ...((baseProfile.terminalLayoutByAccount as Record<string, Record<string, unknown>> | undefined) || {}),
        [accountKey]: currentLayoutSnapshot() as unknown as Record<string, unknown>,
      },
      terminalWorkspacesByAccount: {
        ...((baseProfile.terminalWorkspacesByAccount as Record<string, Record<string, unknown>> | undefined) || {}),
        [accountKey]: (currentWorkspaceBundle as unknown as Record<string, unknown>),
      },
      terminalFloatingPresetsByAccount: {
        ...((baseProfile.terminalFloatingPresetsByAccount as Record<string, Record<string, unknown>> | undefined) || {}),
        [accountKey]: floatingPresetMap,
      },
    };
    backendPrefsRef.current = nextProfile;
    const clientUpdatedAt = new Date().toISOString();
    void saveBackendUserUiPreferences(nextProfile, {
      baseUpdatedAt: backendUpdatedAtRef.current,
      clientUpdatedAt,
    }).then((result) => {
      if (result.ok) {
        backendUpdatedAtRef.current = result.updatedAt;
        if (result.updatedAt) {
          setLocalUserUiPreferencesUpdatedAt(result.updatedAt);
        }
        return;
      }
      if (result.conflict && result.preferences) {
        backendPrefsRef.current = result.preferences;
        applyLocalUserUiPreferences(result.preferences);
        applyBackendTerminalProfile(result.preferences);
        restoreSavedLayout();
        restoreWorkspaceBundle();
        if (result.updatedAt) {
          backendUpdatedAtRef.current = result.updatedAt;
          setLocalUserUiPreferencesUpdatedAt(result.updatedAt);
        }
        return;
      }
      const fallbackLocalTs = readLocalUserUiPreferencesUpdatedAt() || clientUpdatedAt;
      setLocalUserUiPreferencesUpdatedAt(fallbackLocalTs);
    }).catch(() => {
      const fallbackLocalTs = readLocalUserUiPreferencesUpdatedAt() || clientUpdatedAt;
      setLocalUserUiPreferencesUpdatedAt(fallbackLocalTs);
    });
  }, [accountId, chartHapticMode, chartLinkGroup, chartLinkSymbolEnabled, chartLinkTimeframeEnabled, chartMotionPreset, chartPropagationByGroup, chartReleaseSendMode, chartSnapEnabled, chartSnapPriority, chartSyncLeaderGroup, chartSyncPriorityMode, chartViewDensity, floatingPanels, layoutCoreSplit, layoutLowerOrder, layoutMicroOrder, layoutMonitoringOrder, layoutPreset, layoutWorkspaceName, riskAlertMissThreshold, riskAlertWindow, riskHardAlertEnabled, riskHardAlertThresholdPct, riskTimelineRefreshSec, uiMode]);

  useEffect(() => {
    let cancelled = false;
    if (authSessionRequired) {
      setSelfLearningV4PersistenceStatus((current) => ({
        ...current,
        healthy: true,
        message: "state-unauthorized",
      }));
      selfLearningBackendReadyRef.current = true;
      return () => {
        cancelled = true;
      };
    }
    const scope = {
      accountId: accountId || "default",
      symbol: selectedChartSymbol || "BTCUSD",
      timeframe: chartTimeframe || "1m",
    };
    const scopeKey = [scope.accountId, scope.symbol, scope.timeframe].join(":");
    selfLearningBackendReadyRef.current = false;
    selfLearningBackendScopeRef.current = scopeKey;
    setSelfLearningJournalV4Trail([]);
    setSelfLearningJournalV4RegimeFilter("all");
    setSelfLearningJournalV4ScenarioFilter("all");
    setSelfLearningModelUpdatedAt(null);
    setSelfLearningDriftAutoDemotedAt(null);

    void fetchSelfLearningV4State(scope).then((result) => {
      if (cancelled || selfLearningBackendScopeRef.current !== scopeKey) {
        return;
      }
      const persisted = result.state;
      if (result.unauthorized) {
        markUnauthorizedBackoff();
        setSelfLearningV4PersistenceStatus((current) => ({
          ...current,
          storage: result.storage,
          healthy: true,
          message: "state-unauthorized",
        }));
        selfLearningBackendReadyRef.current = true;
        return;
      }
      if (persisted) {
        setSelfLearningV4Enabled(persisted.enabled);
        setSelfLearningAutoAdaptEnabled(persisted.autoAdaptEnabled);
        setSelfLearningModelUpdatedAt(persisted.modelUpdatedAt);
        setSelfLearningDriftAutoDemotedAt(persisted.driftAutoDemotedAt);
        setSelfLearningJournalV4RegimeFilter(persisted.filters.regime);
        setSelfLearningJournalV4ScenarioFilter(persisted.filters.scenario);
        setSelfLearningJournalV4Trail(Array.isArray(persisted.journal) ? persisted.journal : []);
      }
      setSelfLearningV4PersistenceStatus((current) => ({
        ...current,
        storage: result.storage,
        healthy: true,
        stateLoadedAt: result.updatedAt || new Date().toISOString(),
        message: persisted ? "state-loaded" : "state-empty",
      }));
      selfLearningBackendReadyRef.current = true;
    }).catch(() => {
      if (cancelled || selfLearningBackendScopeRef.current !== scopeKey) {
        return;
      }
      setSelfLearningV4PersistenceStatus((current) => ({
        ...current,
        healthy: false,
        message: "state-load-failed",
      }));
      selfLearningBackendReadyRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, [accountId, chartTimeframe, selectedChartSymbol]);

  const currentLayoutSnapshot = (): TerminalLayoutConfig => ({
    preset: layoutPreset,
    coreSplit: layoutCoreSplit,
    microOrder: layoutMicroOrder,
    lowerOrder: layoutLowerOrder,
    monitoringOrder: layoutMonitoringOrder,
    floatingPanels,
    chartLink: {
      group: chartLinkGroup,
      symbol: chartLinkSymbolEnabled,
      timeframe: chartLinkTimeframeEnabled,
      sync: "light",
      priority: chartSyncPriorityMode,
      leader: chartSyncLeaderGroup,
      density: chartViewDensity,
      propagationByGroup: chartPropagationByGroup,
    },
    riskAlert: {
      window: Math.max(3, Math.min(100, riskAlertWindow)),
      missThreshold: Math.max(1, Math.min(100, riskAlertMissThreshold)),
      refreshSec: riskTimelineRefreshSec,
      hardAlertEnabled: riskHardAlertEnabled,
      hardAlertThresholdPct: Math.max(20, Math.min(95, riskHardAlertThresholdPct)),
    },
  });

  const readCurrentAccountWorkspaceBundle = (): TerminalWorkspaceBundle | null => {
    if (typeof window === "undefined") {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(layoutWorkspaceStorageKey);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as TerminalWorkspaceBundle;
    } catch {
      return null;
    }
  };

  const applyBackendTerminalProfile = (profile: Partial<UserUiPreferencesProfile>): void => {
    if (typeof window === "undefined") {
      return;
    }

      useEffect(() => {
        if (typeof window === "undefined") {
          return;
        }
        try {
          const raw = window.localStorage.getItem(coreSplitByScreenStorageKey);
          const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
          const key = `${layoutWorkspaceName}::${layoutScreenProfile}`;
          parsed[key] = layoutCoreSplit;
          window.localStorage.setItem(coreSplitByScreenStorageKey, JSON.stringify(parsed));
        } catch {
          // noop
        }
      }, [coreSplitByScreenStorageKey, layoutCoreSplit, layoutScreenProfile, layoutWorkspaceName]);
    const layoutMap = profile.terminalLayoutByAccount;
    const workspaceMap = profile.terminalWorkspacesByAccount;
    const floatingPresetMap = profile.terminalFloatingPresetsByAccount;
    const accountKey = accountId || "default";
    const layoutPayload = layoutMap && typeof layoutMap[accountKey] === "object" ? layoutMap[accountKey] : null;
    const workspacePayloadRaw = workspaceMap && typeof workspaceMap[accountKey] === "object" ? workspaceMap[accountKey] : null;
    const floatingPayload = floatingPresetMap && typeof floatingPresetMap[accountKey] === "object" ? floatingPresetMap[accountKey] : null;
    let workspacePayload = workspacePayloadRaw;
    if (workspacePayloadRaw && floatingPayload) {
      const source = workspacePayloadRaw as { active?: string; workspaces?: Record<string, { floatingPanels?: unknown[] }> };
      const floatingByWorkspace = floatingPayload as Record<string, unknown[]>;
      const mergedWorkspaces = Object.entries(source.workspaces || {}).reduce<Record<string, unknown>>((acc, [name, layout]) => {
        const floatingPanels = Array.isArray(layout?.floatingPanels) && layout.floatingPanels.length > 0
          ? layout.floatingPanels
          : (Array.isArray(floatingByWorkspace[name]) ? floatingByWorkspace[name] : []);
        acc[name] = {
          ...(layout || {}),
          floatingPanels,
        };
        return acc;
      }, {});
      workspacePayload = {
        active: source.active,
        workspaces: mergedWorkspaces,
      };
    }
    if (layoutPayload) {
      window.localStorage.setItem(layoutStorageKey, JSON.stringify(layoutPayload));
    }
    if (workspacePayload) {
      window.localStorage.setItem(layoutWorkspaceStorageKey, JSON.stringify(workspacePayload));
    }
  };

  const applyLayoutPreset = (preset: LayoutPreset) => {
    const next = buildLayoutPreset(preset, uiMode === "novice");
    setLayoutPreset(next.preset);
    setLayoutCoreSplit(next.coreSplit);
    setLayoutMicroOrder(next.microOrder);
    setLayoutLowerOrder(next.lowerOrder);
    setLayoutMonitoringOrder(next.monitoringOrder);
    setFloatingPanels(next.floatingPanels);
    if (termCoreGroupRef.current) {
      termCoreGroupRef.current.setLayout([next.coreSplit, 100 - next.coreSplit]);
    }
  };

  const resetFloatingPanels = () => {
    setFloatingPanels((current) => {
      for (const panel of current) {
        insertDockPanel(panel.fromZone, panel.id);
      }
      return [];
    });
  };

  const restoreSavedLayout = () => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const raw = window.localStorage.getItem(layoutStorageKey);
      if (!raw) {
        applyLayoutPreset("swing");
        return;
      }
      const parsed = JSON.parse(raw) as Partial<TerminalLayoutConfig>;
      const baseline = buildLayoutPreset(parsed.preset === "scalp" || parsed.preset === "monitoring" ? parsed.preset : "swing", uiMode === "novice");
      const normalized = normalizeDockLayout(parsed, baseline);

      setLayoutPreset(normalized.preset);
      setLayoutCoreSplit(normalized.coreSplit);
      setLayoutMicroOrder(normalized.microOrder);
      setLayoutLowerOrder(normalized.lowerOrder);
      setLayoutMonitoringOrder(normalized.monitoringOrder);
      setFloatingPanels(normalized.floatingPanels);
      setChartLinkGroup(normalized.chartLink.group);
      setChartLinkSymbolEnabled(normalized.chartLink.symbol);
      setChartLinkTimeframeEnabled(normalized.chartLink.timeframe);
      setChartSyncPriorityMode(normalized.chartLink.priority);
      setChartSyncLeaderGroup(normalized.chartLink.leader);
      setChartViewDensity(normalized.chartLink.density);
      setChartPropagationByGroup(normalized.chartLink.propagationByGroup);
      setRiskAlertWindow(normalized.riskAlert.window);
      setRiskAlertMissThreshold(Math.min(normalized.riskAlert.window, normalized.riskAlert.missThreshold));
      setRiskTimelineRefreshSec(normalized.riskAlert.refreshSec);
      setRiskHardAlertEnabled(normalized.riskAlert.hardAlertEnabled);
      setRiskHardAlertThresholdPct(normalized.riskAlert.hardAlertThresholdPct);
      if (termCoreGroupRef.current) {
        termCoreGroupRef.current.setLayout([normalized.coreSplit, 100 - normalized.coreSplit]);
      }
    } catch {
      applyLayoutPreset("swing");
    }
  };

  const saveWorkspaceBundle = (activeName: string, layout: TerminalLayoutConfig) => {
    if (typeof window === "undefined") {
      return;
    }
    let bundle: TerminalWorkspaceBundle = { active: activeName, workspaces: {} };
    try {
      const raw = window.localStorage.getItem(layoutWorkspaceStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as TerminalWorkspaceBundle;
        if (parsed && parsed.workspaces && typeof parsed.workspaces === "object") {
          bundle = parsed;
        }
      }
    } catch {
      // noop: fallback to fresh bundle
    }
    const isNewWorkspace = !Object.prototype.hasOwnProperty.call(bundle.workspaces, activeName);
    let nextLayout = layout;
    if (isNewWorkspace && uiMode === "novice") {
      const noviceRiskDefaults = riskAlertDefaultsForPreset(layout.preset);
      nextLayout = {
        ...layout,
        chartLink: {
          ...layout.chartLink,
          group: "A",
          leader: "A",
          density: 2,
          propagationByGroup: {
            ...layout.chartLink.propagationByGroup,
            A: "symbol-only",
          },
        },
        riskAlert: noviceRiskDefaults,
      };
      setChartLinkGroup("A");
      setChartSyncLeaderGroup("A");
      setChartViewDensity(2);
      setChartPropagationByGroup((current) => ({ ...current, A: "symbol-only" }));
      setRiskAlertWindow(noviceRiskDefaults.window);
      setRiskAlertMissThreshold(noviceRiskDefaults.missThreshold);
      setRiskTimelineRefreshSec(noviceRiskDefaults.refreshSec);
      setRiskHardAlertEnabled(noviceRiskDefaults.hardAlertEnabled);
      setRiskHardAlertThresholdPct(noviceRiskDefaults.hardAlertThresholdPct);
      setWorkspaceHintBadge("Novice preset applied: 2V + A sym-only");
    }
    bundle.active = activeName;
    bundle.workspaces = {
      ...bundle.workspaces,
      [activeName]: nextLayout,
    };
    window.localStorage.setItem(layoutWorkspaceStorageKey, JSON.stringify(bundle));
    setLayoutWorkspaceOptions(Object.keys(bundle.workspaces));
    setLayoutWorkspaceName(activeName);
  };

  const resetWorkspaceRiskAlert = () => {
    const defaults = riskAlertDefaultsForPreset(layoutPreset);
    setRiskAlertWindow(defaults.window);
    setRiskAlertMissThreshold(defaults.missThreshold);
    setRiskTimelineRefreshSec(defaults.refreshSec);
    setRiskHardAlertEnabled(defaults.hardAlertEnabled);
    setRiskHardAlertThresholdPct(defaults.hardAlertThresholdPct);
    setWorkspaceHintBadge(`Risk alert reset: ${defaults.missThreshold}/${defaults.window}`);
  };

  const restoreWorkspaceBundle = () => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const raw = window.localStorage.getItem(layoutWorkspaceStorageKey);
      if (!raw) {
        setLayoutWorkspaceOptions(["Scalp-1", "Swing-NY", "Monitoring-Risk"]);
        setLayoutWorkspaceName("Swing-NY");
        return;
      }
      const parsed = JSON.parse(raw) as TerminalWorkspaceBundle;
      const names = Object.keys(parsed.workspaces || {});
      if (names.length === 0) {
        setLayoutWorkspaceOptions(["Scalp-1", "Swing-NY", "Monitoring-Risk"]);
        setLayoutWorkspaceName("Swing-NY");
        return;
      }
      setLayoutWorkspaceOptions(names);
      const active = parsed.active && names.includes(parsed.active) ? parsed.active : names[0];
      setLayoutWorkspaceName(active);
      const fallback = buildLayoutPreset("swing", uiMode === "novice");
      const normalized = normalizeDockLayout(parsed.workspaces[active], fallback);
      setLayoutPreset(normalized.preset);
      setLayoutCoreSplit(normalized.coreSplit);
      setLayoutMicroOrder(normalized.microOrder);
      setLayoutLowerOrder(normalized.lowerOrder);
      setLayoutMonitoringOrder(normalized.monitoringOrder);
      setFloatingPanels(normalized.floatingPanels);
      setChartLinkGroup(normalized.chartLink.group);
      setChartLinkSymbolEnabled(normalized.chartLink.symbol);
      setChartLinkTimeframeEnabled(normalized.chartLink.timeframe);
      setChartSyncPriorityMode(normalized.chartLink.priority);
      setChartSyncLeaderGroup(normalized.chartLink.leader);
      setChartViewDensity(normalized.chartLink.density);
      setChartPropagationByGroup(normalized.chartLink.propagationByGroup);
      setRiskAlertWindow(normalized.riskAlert.window);
      setRiskAlertMissThreshold(Math.min(normalized.riskAlert.window, normalized.riskAlert.missThreshold));
      setRiskTimelineRefreshSec(normalized.riskAlert.refreshSec);
      setRiskHardAlertEnabled(normalized.riskAlert.hardAlertEnabled);
      setRiskHardAlertThresholdPct(normalized.riskAlert.hardAlertThresholdPct);
      if (termCoreGroupRef.current) {
        termCoreGroupRef.current.setLayout([normalized.coreSplit, 100 - normalized.coreSplit]);
      }
    } catch {
      setLayoutWorkspaceOptions(["Scalp-1", "Swing-NY", "Monitoring-Risk"]);
      setLayoutWorkspaceName("Swing-NY");
    }
  };

  const applyChartPanelUpdate = (
    originGroup: ChartGroupId,
    update: Partial<Pick<ChartPanelState, "symbol" | "timeframe">>,
    source: ChartSyncSourceLabel,
  ) => {
    const normalizedTimeframe = update.timeframe && CHART_TIMEFRAMES.includes(update.timeframe)
      ? update.timeframe
      : undefined;
    const now = new Date().toISOString();
    setChartPanels((current) => {
      const originCurrent = current[originGroup];
      const nextSymbol = (update.symbol || originCurrent.symbol || "BTCUSD").trim() || "BTCUSD";
      const nextTimeframe = normalizedTimeframe || originCurrent.timeframe;
      let changed = nextSymbol !== originCurrent.symbol || nextTimeframe !== originCurrent.timeframe || source !== originCurrent.source;
      const next: Record<ChartGroupId, ChartPanelState> = {
        ...current,
        [originGroup]: {
          ...originCurrent,
          symbol: nextSymbol,
          timeframe: nextTimeframe,
          source,
          sourceFrom: source === "leader" || source === "last-edited" ? originGroup : null,
          updatedAt: now,
        },
      };

      const canPropagate = chartSyncPriorityMode === "last-edited" || originGroup === chartSyncLeaderGroup;
      const propagationMode = chartPropagationByGroup[originGroup] || "both";
      const propagateSymbol = chartLinkSymbolEnabled && propagationMode !== "timeframe-only";
      const propagateTimeframe = chartLinkTimeframeEnabled && propagationMode !== "symbol-only";
      if (canPropagate) {
        for (const group of CHART_GROUPS) {
          if (group === originGroup) {
            continue;
          }
          const target = current[group];
          const propagatedSymbol = propagateSymbol ? nextSymbol : target.symbol;
          const propagatedTimeframe = propagateTimeframe ? nextTimeframe : target.timeframe;
          if (propagatedSymbol !== target.symbol || propagatedTimeframe !== target.timeframe) {
            changed = true;
            next[group] = {
              ...target,
              symbol: propagatedSymbol,
              timeframe: propagatedTimeframe,
              source: chartSyncPriorityMode === "leader" ? "leader" : "last-edited",
              sourceFrom: originGroup,
              updatedAt: now,
            };
          }
        }
      }

      return changed ? next : current;
    });
  };

  useEffect(() => {
    if (chartViewDensity === 3) {
      return;
    }
    if (chartLinkGroup === "C") {
      setChartLinkGroup("A");
    }
    if (chartSyncLeaderGroup === "C") {
      setChartSyncLeaderGroup("A");
    }
  }, [chartLinkGroup, chartSyncLeaderGroup, chartViewDensity]);

  useEffect(() => {
    if (!workspaceHintBadge) {
      return;
    }
    const timer = window.setTimeout(() => {
      setWorkspaceHintBadge(null);
    }, 2800);
    return () => window.clearTimeout(timer);
  }, [workspaceHintBadge]);

  const setActiveChartSymbol = (symbolValue: string, source: ChartSyncSourceLabel = "manual") => {
    applyChartPanelUpdate(chartLinkGroup, { symbol: symbolValue }, source);
  };

  const setActiveChartTimeframe = (timeframeValue: "1m" | "5m" | "15m", source: ChartSyncSourceLabel = "manual") => {
    applyChartPanelUpdate(chartLinkGroup, { timeframe: timeframeValue }, source);
  };

  useEffect(() => {
    const activePanel = chartPanels[chartLinkGroup];
    if (activePanel.symbol !== selectedChartSymbol) {
      setSelectedChartSymbol(activePanel.symbol);
    }
    if (activePanel.timeframe !== chartTimeframe) {
      setChartTimeframe(activePanel.timeframe);
    }
  }, [chartLinkGroup, chartPanels, chartTimeframe, selectedChartSymbol]);

  useEffect(() => {
    const activePanel = chartPanels[chartLinkGroup];
    if (selectedChartSymbol && selectedChartSymbol !== activePanel.symbol) {
      applyChartPanelUpdate(chartLinkGroup, { symbol: selectedChartSymbol }, "manual");
    }
    if ((chartTimeframe === "1m" || chartTimeframe === "5m" || chartTimeframe === "15m") && chartTimeframe !== activePanel.timeframe) {
      applyChartPanelUpdate(chartLinkGroup, { timeframe: chartTimeframe }, "manual");
    }
  }, [chartLinkGroup, chartPanels, chartTimeframe, selectedChartSymbol]);

  useEffect(() => {
    restoreSavedLayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutStorageKey, uiMode]);

  useEffect(() => {
    restoreWorkspaceBundle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutWorkspaceStorageKey, uiMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const payload = currentLayoutSnapshot();
    window.localStorage.setItem(layoutStorageKey, JSON.stringify(payload));
    saveWorkspaceBundle(layoutWorkspaceName, payload);
  }, [chartLinkGroup, chartLinkSymbolEnabled, chartLinkTimeframeEnabled, chartPropagationByGroup, chartSyncLeaderGroup, chartSyncPriorityMode, chartViewDensity, floatingPanels, layoutCoreSplit, layoutLowerOrder, layoutMicroOrder, layoutMonitoringOrder, layoutPreset, layoutStorageKey, riskAlertMissThreshold, riskAlertWindow, riskHardAlertEnabled, riskHardAlertThresholdPct, riskTimelineRefreshSec]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const raw = window.localStorage.getItem(chartLinkStorageKey);
      if (!raw) {
        return;
      }
      const payload = JSON.parse(raw) as { symbol?: string; timeframe?: string };
      applyChartPanelUpdate(chartLinkGroup, {
        symbol: chartLinkSymbolEnabled ? payload.symbol : undefined,
        timeframe: chartLinkTimeframeEnabled && (payload.timeframe === "1m" || payload.timeframe === "5m" || payload.timeframe === "15m") ? payload.timeframe : undefined,
      }, "storage");
    } catch {
      // noop
    }
  }, [chartLinkGroup, chartLinkStorageKey, chartLinkSymbolEnabled, chartLinkTimeframeEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const accountKey = accountId || "default";
      for (const group of CHART_GROUPS) {
        const key = `${TERMINAL_CHART_LINK_STORAGE_PREFIX}.${accountKey}.${group}`;
        const raw = window.localStorage.getItem(key);
        const previous = raw ? JSON.parse(raw) as Record<string, unknown> : {};
        const panel = chartPanels[group];
        const payload = {
          ...previous,
          updatedAt: new Date().toISOString(),
          workspace: layoutWorkspaceName,
          symbol: chartLinkSymbolEnabled ? panel.symbol : previous.symbol,
          timeframe: chartLinkTimeframeEnabled ? panel.timeframe : previous.timeframe,
        };
        window.localStorage.setItem(key, JSON.stringify(payload));
      }
    } catch {
      // noop
    }
  }, [accountId, chartLinkGroup, chartLinkStorageKey, chartLinkSymbolEnabled, chartLinkTimeframeEnabled, chartPanels, layoutWorkspaceName]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== chartLinkStorageKey || !event.newValue) {
        return;
      }
      try {
        const payload = JSON.parse(event.newValue) as { symbol?: string; timeframe?: string };
        applyChartPanelUpdate(chartLinkGroup, {
          symbol: chartLinkSymbolEnabled ? payload.symbol : undefined,
          timeframe: chartLinkTimeframeEnabled && (payload.timeframe === "1m" || payload.timeframe === "5m" || payload.timeframe === "15m") ? payload.timeframe : undefined,
        }, "storage");
      } catch {
        // noop
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [chartLinkGroup, chartLinkStorageKey, chartLinkSymbolEnabled, chartLinkTimeframeEnabled]);

  const saveCurrentLayout = () => {
    if (typeof window === "undefined") {
      return;
    }
    const payload = currentLayoutSnapshot();
    window.localStorage.setItem(layoutStorageKey, JSON.stringify(payload));
    saveWorkspaceBundle(layoutWorkspaceName, payload);
  };

  const saveNamedWorkspace = () => {
    const name = layoutWorkspaceName.trim();
    if (!name) {
      return;
    }
    saveWorkspaceBundle(name, currentLayoutSnapshot());
  };

  const cycleWorkspace = (direction: 1 | -1) => {
    if (layoutWorkspaceOptions.length === 0) {
      return;
    }
    const currentIndex = Math.max(0, layoutWorkspaceOptions.indexOf(layoutWorkspaceName));
    const nextIndex = (currentIndex + direction + layoutWorkspaceOptions.length) % layoutWorkspaceOptions.length;
    loadNamedWorkspace(layoutWorkspaceOptions[nextIndex]);
  };

  const loadNamedWorkspace = (name: string) => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const raw = window.localStorage.getItem(layoutWorkspaceStorageKey);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as TerminalWorkspaceBundle;
      const layout = parsed.workspaces?.[name];
      if (!layout) {
        return;
      }
      const fallback = buildLayoutPreset("swing", uiMode === "novice");
      const normalized = normalizeDockLayout(layout, fallback);
      setLayoutWorkspaceName(name);
      setLayoutPreset(normalized.preset);
      setLayoutCoreSplit(normalized.coreSplit);
      setLayoutMicroOrder(normalized.microOrder);
      setLayoutLowerOrder(normalized.lowerOrder);
      setLayoutMonitoringOrder(normalized.monitoringOrder);
      setFloatingPanels(normalized.floatingPanels);
      setChartLinkGroup(normalized.chartLink.group);
      setChartLinkSymbolEnabled(normalized.chartLink.symbol);
      setChartLinkTimeframeEnabled(normalized.chartLink.timeframe);
      setChartSyncPriorityMode(normalized.chartLink.priority);
      setChartSyncLeaderGroup(normalized.chartLink.leader);
      setChartViewDensity(normalized.chartLink.density);
      setChartPropagationByGroup(normalized.chartLink.propagationByGroup);
      setRiskAlertWindow(normalized.riskAlert.window);
      setRiskAlertMissThreshold(Math.min(normalized.riskAlert.window, normalized.riskAlert.missThreshold));
      setRiskTimelineRefreshSec(normalized.riskAlert.refreshSec);
      setRiskHardAlertEnabled(normalized.riskAlert.hardAlertEnabled);
      setRiskHardAlertThresholdPct(normalized.riskAlert.hardAlertThresholdPct);
      if (termCoreGroupRef.current) {
        termCoreGroupRef.current.setLayout([normalized.coreSplit, 100 - normalized.coreSplit]);
      }
      saveWorkspaceBundle(name, normalized);
    } catch {
      // noop
    }
  };

  const deleteNamedWorkspace = () => {
    if (typeof window === "undefined") {
      return;
    }
    const name = layoutWorkspaceName.trim();
    if (!name) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(layoutWorkspaceStorageKey);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as TerminalWorkspaceBundle;
      if (!parsed.workspaces?.[name]) {
        return;
      }
      delete parsed.workspaces[name];
      const names = Object.keys(parsed.workspaces);
      const nextActive = names.includes(parsed.active) ? parsed.active : names[0] || "Swing-NY";
      parsed.active = nextActive;
      window.localStorage.setItem(layoutWorkspaceStorageKey, JSON.stringify(parsed));
      setLayoutWorkspaceOptions(names.length > 0 ? names : ["Scalp-1", "Swing-NY", "Monitoring-Risk"]);
      setLayoutWorkspaceName(nextActive);
      if (names.length > 0) {
        loadNamedWorkspace(nextActive);
      } else {
        applyLayoutPreset("swing");
      }
    } catch {
      // noop
    }
  };

  const exportLayoutsJson = () => {
    if (typeof window === "undefined") {
      return;
    }
    const layout = currentLayoutSnapshot();
    const payload = {
      exportedAt: new Date().toISOString(),
      activeWorkspace: layoutWorkspaceName,
      currentLayout: layout,
      workspaceStorageKey: layoutWorkspaceStorageKey,
    };
    downloadJsonFile(`txt-layouts-${accountId || "default"}.json`, payload);
  };

  const importLayoutsJson = async (file: File) => {
    const text = await file.text();
    const parsed = JSON.parse(text) as {
      activeWorkspace?: string;
      currentLayout?: Partial<TerminalLayoutConfig>;
      workspaces?: Record<string, Partial<TerminalLayoutConfig>>;
    };
    const fallback = buildLayoutPreset("swing", uiMode === "novice");
    if (parsed.workspaces && Object.keys(parsed.workspaces).length > 0) {
      const normalizedWorkspaces = Object.entries(parsed.workspaces).reduce<Record<string, TerminalLayoutConfig>>((acc, [name, layout]) => {
        if (!name.trim()) {
          return acc;
        }
        acc[name] = normalizeDockLayout(layout, fallback);
        return acc;
      }, {});
      const names = Object.keys(normalizedWorkspaces);
      const active = parsed.activeWorkspace && names.includes(parsed.activeWorkspace) ? parsed.activeWorkspace : names[0];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(layoutWorkspaceStorageKey, JSON.stringify({ active, workspaces: normalizedWorkspaces } satisfies TerminalWorkspaceBundle));
      }
      setLayoutWorkspaceOptions(names);
      setLayoutWorkspaceName(active);
      loadNamedWorkspace(active);
      return;
    }
    if (parsed.currentLayout) {
      const normalized = normalizeDockLayout(parsed.currentLayout, fallback);
      setLayoutPreset(normalized.preset);
      setLayoutCoreSplit(normalized.coreSplit);
      setLayoutMicroOrder(normalized.microOrder);
      setLayoutLowerOrder(normalized.lowerOrder);
      setLayoutMonitoringOrder(normalized.monitoringOrder);
      setFloatingPanels(normalized.floatingPanels);
      setChartLinkGroup(normalized.chartLink.group);
      setChartLinkSymbolEnabled(normalized.chartLink.symbol);
      setChartLinkTimeframeEnabled(normalized.chartLink.timeframe);
      setChartSyncPriorityMode(normalized.chartLink.priority);
      setChartSyncLeaderGroup(normalized.chartLink.leader);
      setChartViewDensity(normalized.chartLink.density);
      setChartPropagationByGroup(normalized.chartLink.propagationByGroup);
      setRiskAlertWindow(normalized.riskAlert.window);
      setRiskAlertMissThreshold(Math.min(normalized.riskAlert.window, normalized.riskAlert.missThreshold));
      setRiskTimelineRefreshSec(normalized.riskAlert.refreshSec);
      setRiskHardAlertEnabled(normalized.riskAlert.hardAlertEnabled);
      setRiskHardAlertThresholdPct(normalized.riskAlert.hardAlertThresholdPct);
      if (termCoreGroupRef.current) {
        termCoreGroupRef.current.setLayout([normalized.coreSplit, 100 - normalized.coreSplit]);
      }
      saveWorkspaceBundle(layoutWorkspaceName || "Imported", normalized);
    }
  };

  const removeDockPanel = (sourceZone: DockZone, panelId: DockPanelId) => {
    if (sourceZone === "micro") {
      setLayoutMicroOrder((current) => current.filter((id) => id !== panelId));
      return;
    }
    if (sourceZone === "lower") {
      setLayoutLowerOrder((current) => current.filter((id) => id !== panelId));
      return;
    }
    setLayoutMonitoringOrder((current) => current.filter((id) => id !== panelId));
  };

  const insertDockPanel = (targetZone: DockZone, panelId: DockPanelId, beforeId?: DockPanelId) => {
    const insert = (current: DockPanelId[]) => {
      const base = current.filter((id) => id !== panelId);
      if (!beforeId || !base.includes(beforeId)) {
        return [...base, panelId];
      }
      const index = base.indexOf(beforeId);
      const next = [...base];
      next.splice(index, 0, panelId);
      return next;
    };

    if (targetZone === "micro") {
      setLayoutMicroOrder(insert);
      return;
    }
    if (targetZone === "lower") {
      setLayoutLowerOrder(insert);
      return;
    }
    setLayoutMonitoringOrder(insert);
  };

  const handleLayoutDrop = (zone: DockZone, targetId: DockPanelId) => {
    if (!layoutEditMode || !layoutDragRef.current) {
      return;
    }
    const drag = layoutDragRef.current;
    setLayoutDropPreview(null);
    layoutDragRef.current = null;
    if (drag.zone === zone) {
      if (zone === "micro") {
        setLayoutMicroOrder((current) => reorderIds(current, drag.id, targetId));
        return;
      }
      if (zone === "lower") {
        setLayoutLowerOrder((current) => reorderIds(current, drag.id, targetId));
        return;
      }
      setLayoutMonitoringOrder((current) => reorderIds(current, drag.id, targetId));
      return;
    }
    removeDockPanel(drag.zone, drag.id);
    insertDockPanel(zone, drag.id, targetId);
  };

  const handleLayoutDropToZone = (zone: DockZone) => {
    if (!layoutEditMode || !layoutDragRef.current) {
      return;
    }
    const drag = layoutDragRef.current;
    setLayoutDropPreview({ zone, mode: "zone" });
    layoutDragRef.current = null;
    if (drag.zone !== zone) {
      removeDockPanel(drag.zone, drag.id);
      insertDockPanel(zone, drag.id);
      setLayoutDropPreview(null);
      return;
    }
    insertDockPanel(zone, drag.id);
    setLayoutDropPreview(null);
  };


  // ─── Floating panel detach / dock ────────────────────────────────────────
  const detachPanel = (id: DockPanelId, zone: DockZone) => {
    removeDockPanel(zone, id);
    const cx = typeof window !== "undefined" ? Math.max(60, window.innerWidth / 2 - 185) : 200;
    const cy = typeof window !== "undefined" ? Math.max(60, window.innerHeight / 2 - 155) : 150;
    setFloatingPanels((prev) => [...prev.filter((fp) => fp.id !== id), clampFloatingPanel({ id, fromZone: zone, x: cx, y: cy, w: 368, h: 320 })]);
  };

  const dockPanel = (id: DockPanelId) => {
    const fp = floatingPanels.find((f) => f.id === id);
    if (!fp) return;
    setFloatingPanels((prev) => prev.filter((f) => f.id !== id));
    insertDockPanel(fp.fromZone, id);
  };

  // floating drag — global mouse listeners
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = floatingDragRef.current;
      if (!drag) return;
      setFloatingPanels((prev) =>
        prev.map((fp) =>
          fp.id === drag.id
            ? clampFloatingPanel({ ...fp, x: drag.origX + e.clientX - drag.startX, y: drag.origY + e.clientY - drag.startY })
            : fp,
        ),
      );
    };
    const onUp = () => { floatingDragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ─── Hotkeys — Alt+1 Scalp  Alt+2 Swing  Alt+3 Monitoring  Alt+E Edit ──
  useEffect(() => {
    hotkeyActionsRef.current = {
      applyLayoutPreset,
      toggleEditMode: () => setLayoutEditMode((v) => !v),
      saveLayout: saveCurrentLayout,
      restoreLayout: restoreSavedLayout,
      resetFloating: resetFloatingPanels,
      cycleWorkspace,
    };
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "1") { e.preventDefault(); hotkeyActionsRef.current.applyLayoutPreset("scalp"); }
      else if (e.key === "2") { e.preventDefault(); hotkeyActionsRef.current.applyLayoutPreset("swing"); }
      else if (e.key === "3") { e.preventDefault(); hotkeyActionsRef.current.applyLayoutPreset("monitoring"); }
      else if (e.key === "e" || e.key === "E") { e.preventDefault(); hotkeyActionsRef.current.toggleEditMode(); }
      else if (e.key === "s" || e.key === "S") { e.preventDefault(); hotkeyActionsRef.current.saveLayout(); }
      else if (e.key === "r" || e.key === "R") { e.preventDefault(); hotkeyActionsRef.current.restoreLayout(); }
      else if (e.key === "0") { e.preventDefault(); hotkeyActionsRef.current.resetFloating(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); hotkeyActionsRef.current.cycleWorkspace(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); hotkeyActionsRef.current.cycleWorkspace(1); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const microOrderById = orderMap(layoutMicroOrder);
  const lowerOrderById = orderMap(layoutLowerOrder);
  const monitoringOrderById = orderMap(layoutMonitoringOrder);

  async function loadAll(): Promise<void> {
    if (Date.now() < authBackoffUntilRef.current) {
      return;
    }
    let sawUnauthorized = false;
    const fetchMaybeUnauthorized = async (path: string): Promise<unknown | null> => {
      try {
        const payload = await fetchJson(path, { allowUnauthorized: true });
        if (payload === null) {
          sawUnauthorized = true;
        }
        return payload;
      } catch {
        return null;
      }
    };
    const fetchArrayFallback = async (path: string): Promise<unknown[]> => {
      try {
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) {
          return [];
        }
        const payload = await response.json();
        return Array.isArray(payload) ? payload : [];
      } catch {
        return [];
      }
    };

    const [snapshotPayload, readinessPayload, aiPayload, overviewPayload, incidentPayload, pendingPayload, outcomePayload, mt5Payload, quotesPayload, positionsPayload, balancePayload] = await Promise.all([
      fetchMaybeUnauthorized("/api/connectors/status"),
      fetchMaybeUnauthorized("/api/live-readiness/overview"),
      fetchMaybeUnauthorized("/api/ai/health"),
      fetchMaybeUnauthorized("/api/dashboard/overview"),
      fetchMaybeUnauthorized("/api/incidents"),
      fetchArrayFallback("/api/mt5/orders/live-pending"),
      fetchArrayFallback("/api/outcomes/recent?limit=20"),
      fetchMaybeUnauthorized("/api/mt5/health"),
      fetchMaybeUnauthorized("/api/market/quotes"),
      fetchMaybeUnauthorized("/api/broker/positions"),
      fetchMaybeUnauthorized("/api/broker/balance"),
    ]);

    if (sawUnauthorized) {
      markUnauthorizedBackoff();
      setError(null);
      return;
    }

    setAuthSessionRequired(false);

    const nextQuotes = Array.isArray(quotesPayload) ? (quotesPayload as JsonMap[]) : [];

    setSnapshot(snapshotPayload && typeof snapshotPayload === "object" ? (snapshotPayload as JsonMap) : null);
    setReadiness(readinessPayload && typeof readinessPayload === "object" ? (readinessPayload as JsonMap) : null);
    setAiHealth(aiPayload && typeof aiPayload === "object" ? (aiPayload as JsonMap) : null);
    setOverview(overviewPayload && typeof overviewPayload === "object" ? (overviewPayload as JsonMap) : null);
    const incidentItems = incidentPayload && typeof incidentPayload === "object"
      ? ((((incidentPayload as JsonMap).items as JsonMap[] | undefined) || []).slice(0, 12))
      : [];
    setIncidents(incidentItems);
    setPendingLive(Array.isArray(pendingPayload) ? (pendingPayload as JsonMap[]) : []);
    setOutcomes(Array.isArray(outcomePayload) ? (outcomePayload as JsonMap[]) : []);
    setMt5Health(mt5Payload && typeof mt5Payload === "object" ? (mt5Payload as JsonMap) : null);
    setQuotes(nextQuotes);
    setPositions(Array.isArray(positionsPayload) ? (positionsPayload as JsonMap[]) : []);
    setBalance(balancePayload && typeof balancePayload === "object" ? (balancePayload as JsonMap) : null);

    setQuoteHistory((current) => {
      const updated: QuoteHistoryMap = { ...current };
      const timestamp = new Date();
      const label = `${String(timestamp.getHours()).padStart(2, "0")}:${String(timestamp.getMinutes()).padStart(2, "0")}:${String(timestamp.getSeconds()).padStart(2, "0")}`;
      for (const quote of nextQuotes) {
        const quoteSymbol = instrumentLabel(quote);
        const nextPoint = { label, value: toNumber(quote.last, 0) };
        const existing = updated[quoteSymbol] || [];
        updated[quoteSymbol] = [...existing, nextPoint].slice(-40);
      }
      return updated;
    });
  }

  useEffect(() => {
    loadAll().catch((err) => setError(err instanceof Error ? err.message : "Erreur inconnue"));
    const timer = window.setInterval(() => {
      void loadAll().catch((err) => setError(err instanceof Error ? err.message : "Erreur inconnue"));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!AUTO_TUNING_WRITEBACK_ENABLED) return;

    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/strategies/auto-tuning", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (!active) return;
        const rows = Array.isArray(payload?.entries) ? payload.entries : [];
        setAutoTuningAuditTrail(rows.slice(0, 20));
      } catch {
        // keep silent in UI; write-back is optional
      }
    };

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 45_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let closedByUnmount = false;

    const connect = async () => {
      if (closedByUnmount) {
        return;
      }
      const token = await fetchWsToken();
      if (token === "__UNAUTHORIZED__") {
        markUnauthorizedBackoff();
        reconnectTimer = window.setTimeout(() => {
          void connect();
        }, 30_000);
        return;
      }
      if (!token) {
        reconnectTimer = window.setTimeout(() => {
          void connect();
        }, 4000);
        return;
      }
      setAuthSessionRequired(false);
      socket = new WebSocket(buildMarketQuotesWsUrl(token));

      socket.onopen = () => {
        pingTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send("ping");
          }
        }, 20_000);
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data || "{}"));
          if (!payload || payload.type !== "snapshot") {
            return;
          }
          const nextQuotes = ((payload.items as JsonMap[] | undefined) || []);
          setQuotes(nextQuotes);

          setQuoteHistory((current) => {
            const updated: QuoteHistoryMap = { ...current };
            const timestamp = new Date();
            const label = `${String(timestamp.getHours()).padStart(2, "0")}:${String(timestamp.getMinutes()).padStart(2, "0")}:${String(timestamp.getSeconds()).padStart(2, "0")}`;
            for (const quote of nextQuotes) {
              const quoteSymbol = instrumentLabel(quote);
              const nextPoint = { label, value: toNumber(quote.last, 0) };
              const existing = updated[quoteSymbol] || [];
              updated[quoteSymbol] = [...existing, nextPoint].slice(-160);
            }
            return updated;
          });
        } catch {
          // Ignore malformed websocket frames.
        }
      };

      socket.onclose = () => {
        if (pingTimer) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        if (closedByUnmount) {
          return;
        }
        reconnectTimer = window.setTimeout(() => {
          void connect();
        }, 2500);
      };
    };

    void connect();

    return () => {
      closedByUnmount = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      if (pingTimer) {
        window.clearInterval(pingTimer);
      }
      socket?.close();
    };
  }, []);

  useEffect(() => {
    const hasSelected = quotes.some((quote) => instrumentLabel(quote) === selectedChartSymbol);
    if (!hasSelected && quotes.length > 0) {
      setActiveChartSymbol(instrumentLabel(quotes[0]), "workspace");
    }
  }, [quotes, selectedChartSymbol]);

  useEffect(() => {
    if (authSessionRequired) {
      setOhlcvBars([]);
      setNativeTrades([]);
      setMarketMicro(null);
      setSessionState(null);
      setRoutingScore(null);
      setOrderbook(null);
      setChartLoading(false);
      return;
    }
    if (marketBurstTimerRef.current !== null) {
      window.clearTimeout(marketBurstTimerRef.current);
      marketBurstTimerRef.current = null;
    }
    marketBurstAbortRef.current?.abort();
    const controller = new AbortController();
    marketBurstAbortRef.current = controller;
    const selectedQuote = quotes.find((quote) => instrumentLabel(quote) === selectedChartSymbol);
    const venue = String(selectedQuote?.venue || "binance-public");
    const instrument = normalizeInstrument(String(selectedQuote?.instrument || selectedChartSymbol || "BTCUSD"));
    const burstKey = `${instrument}|${venue}|${chartTimeframe}`;
    const now = Date.now();
    if (marketBurstLastKeyRef.current === burstKey && now - marketBurstLastStartedAtRef.current < 350) {
      return () => {
        controller.abort();
      };
    }

    setMarketDepth(null);
    setChartLoading(true);

    marketBurstTimerRef.current = window.setTimeout(() => {
      marketBurstTimerRef.current = null;
      marketBurstLastKeyRef.current = burstKey;
      marketBurstLastStartedAtRef.current = Date.now();

      Promise.allSettled([
        fetch(`/api/market/ohlcv?instrument=${encodeURIComponent(instrument)}&venue=${encodeURIComponent(venue)}&timeframe=${encodeURIComponent(chartTimeframe)}&limit=500`, {
          cache: "no-store",
          signal: controller.signal,
          headers: buildRoutingRequestHeaders("ai", instrument),
        }).then((response) => (response.ok ? response.json() : [])),
        fetch(`/api/market/trades?instrument=${encodeURIComponent(instrument)}&venue=${encodeURIComponent(venue)}&limit=200`, {
          cache: "no-store",
          signal: controller.signal,
          headers: buildRoutingRequestHeaders("ai", instrument),
        }).then((response) => (response.ok ? response.json() : [])),
        fetch(`/api/market/microstructure?instrument=${encodeURIComponent(instrument)}&venue=${encodeURIComponent(venue)}&lookback_minutes=60`, {
          cache: "no-store",
          signal: controller.signal,
          headers: buildRoutingRequestHeaders("ai", instrument),
        }).then((response) => (response.ok ? response.json() : null)),
        fetch(`/api/market/session-state?instrument=${encodeURIComponent(instrument)}`, {
          cache: "no-store",
          signal: controller.signal,
          headers: buildRoutingRequestHeaders("ai", instrument),
        }).then((response) => (response.ok ? response.json() : null)),
        fetchRoutingScoreCached(instrument, "ai"),
        fetch(`/api/broker/orderbook/${encodeURIComponent(venue)}/${encodeURIComponent(instrument)}`, {
          cache: "no-store",
          signal: controller.signal,
          headers: buildRoutingRequestHeaders("ai", instrument),
        }).then((response) => (response.ok ? response.json() : null)),
      ])
        .then((results) => {
          if (controller.signal.aborted) {
            return;
          }
          const resolveResult = <T,>(index: number, fallback: T): T => {
            const result = results[index];
            return result?.status === "fulfilled" ? (result.value as T) : fallback;
          };
          setOhlcvBars((resolveResult<JsonMap[]>(0, []) as JsonMap[]) || []);
          setNativeTrades((resolveResult<JsonMap[]>(1, []) as JsonMap[]) || []);
          setMarketMicro(resolveResult<JsonMap | null>(2, null));
          setSessionState(resolveResult<JsonMap | null>(3, null));
          setRoutingScore(resolveResult<JsonMap | null>(4, null));
          setOrderbook(resolveResult<JsonMap | null>(5, null));
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setChartLoading(false);
          }
        });
    }, 180);

    return () => {
      if (marketBurstTimerRef.current !== null) {
        window.clearTimeout(marketBurstTimerRef.current);
        marketBurstTimerRef.current = null;
      }
      controller.abort();
    };
  }, [authSessionRequired, chartTimeframe, selectedChartSymbol]);

  useEffect(() => {
    if (authSessionRequired) {
      setChartPanelData((current) => ({
        A: { ...current.A, loading: false },
        B: { ...current.B, loading: false },
        C: { ...current.C, loading: false },
      }));
      return;
    }
    chartPanelsAbortRef.current?.abort();
    const controller = new AbortController();
    chartPanelsAbortRef.current = controller;
    let closed = false;
    const fetchGroup = async (group: ChartGroupId) => {
      const panel = chartPanels[group];
      setChartPanelData((current) => ({
        ...current,
        [group]: {
          ...current[group],
          loading: true,
        },
      }));

      const selectedQuote = quotesRef.current.find((quote) => instrumentLabel(quote) === panel.symbol);
      const venue = String(selectedQuote?.venue || "binance-public");
      const instrument = normalizeInstrument(String(selectedQuote?.instrument || panel.symbol || "BTCUSD"));
      try {
        const response = await fetch(`/api/market/ohlcv?instrument=${encodeURIComponent(instrument)}&venue=${encodeURIComponent(venue)}&timeframe=${encodeURIComponent(panel.timeframe)}&limit=320`, {
          cache: "no-store",
          signal: controller.signal,
          headers: buildRoutingRequestHeaders("ui", instrument),
        });
        const payload = response.ok ? await response.json() : [];
        if (closed || controller.signal.aborted) {
          return;
        }
        const bars = (payload as JsonMap[]) || [];
        const points = bars
          .map((bar) => ({ label: String(bar.bucket_start || "-"), value: toNumber(bar.close, 0) }))
          .filter((point) => point.value > 0)
          .slice(-280);
        const candles = bars
          .map((bar) => ({
            label: String(bar.bucket_start || "-"),
            open: toNumber(bar.open, 0),
            high: toNumber(bar.high, 0),
            low: toNumber(bar.low, 0),
            close: toNumber(bar.close, 0),
            volume: toNumber(bar.volume, 0),
          }))
          .slice(-280);
        setChartPanelData((current) => ({
          ...current,
          [group]: {
            points,
            candles,
            loading: false,
          },
        }));
      } catch {
        if (closed || controller.signal.aborted) {
          return;
        }
        setChartPanelData((current) => ({
          ...current,
          [group]: {
            points: current[group].points,
            candles: current[group].candles,
            loading: false,
          },
        }));
      }
    };

    for (const group of CHART_GROUPS) {
      void fetchGroup(group);
    }

    return () => {
      closed = true;
      controller.abort();
    };
  }, [authSessionRequired, chartPanels]);

  useEffect(() => {
    marketMetricsAbortRef.current?.abort();
    const controller = new AbortController();
    marketMetricsAbortRef.current = controller;
    const matrixQuotes = quotes
      .filter((quote) => {
        const quoteSymbol = instrumentLabel(quote);
        const market = classifyInstrument(quoteSymbol);
        const matchesSymbol = !symbolFilter || quoteSymbol.toLowerCase().includes(symbolFilter.toLowerCase());
        const matchesMarket = marketFilter === "all" || market === marketFilter;
        return matchesSymbol && matchesMarket;
      })
      .filter((quote, index, rows) => rows.findIndex((candidate) => instrumentLabel(candidate) === instrumentLabel(quote)) === index)
      .slice(0, 7);

    if (matrixQuotes.length === 0) {
      controller.abort();
      return;
    }

    let closed = false;
    Promise.all(matrixQuotes.map(async (quote) => {
      const symbolKey = instrumentLabel(quote);
      const venue = String(quote.venue || "binance-public");
      const instrument = normalizeInstrument(String(quote.instrument || symbolKey));
      const payload = await fetch(`/api/market/microstructure?instrument=${encodeURIComponent(instrument)}&venue=${encodeURIComponent(venue)}&lookback_minutes=60`, {
        cache: "no-store",
        signal: controller.signal,
        headers: buildRoutingRequestHeaders("ui", instrument),
      })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      return {
        symbolKey,
        metric: {
          fundingRate: toNumber((payload as JsonMap | null)?.funding_rate, 0),
          openInterest: toNumber((payload as JsonMap | null)?.open_interest, 0),
          volume: toNumber((payload as JsonMap | null)?.buy_volume, 0) + toNumber((payload as JsonMap | null)?.sell_volume, 0),
          depthImbalance: toNumber((payload as JsonMap | null)?.depth_imbalance, 0),
          tapeAcceleration: toNumber((payload as JsonMap | null)?.tape_acceleration, 0),
        },
      };
    })).then((rows) => {
      if (closed || controller.signal.aborted) {
        return;
      }
      setMarketMetricsBySymbol((current) => {
        const next = { ...current };
        for (const row of rows) {
          next[row.symbolKey] = row.metric;
        }
        return next;
      });
    });

    return () => {
      closed = true;
      controller.abort();
    };
  }, [marketFilter, quotes, symbolFilter]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let closedByUnmount = false;

    const connect = async () => {
      if (closedByUnmount) {
        return;
      }
      setTelemetryStreamState("connecting");
      const token = await fetchWsToken();
      if (token === "__UNAUTHORIZED__") {
        markUnauthorizedBackoff();
        setTelemetryStreamState("offline");
        reconnectTimer = window.setTimeout(() => {
          void connect();
        }, 30_000);
        return;
      }
      if (!token) {
        setTelemetryStreamState("offline");
        reconnectTimer = window.setTimeout(() => {
          void connect();
        }, 4000);
        return;
      }
      setAuthSessionRequired(false);
      const wsUrl = buildExecutionTelemetryWsUrl(token, 20, {
        requestType: "execution",
        priority: "high",
        volatility: overlayDecisionRegime === "high" ? "high" : overlayDecisionRegime === "medium" ? "medium" : "low",
        signalState: marketDecisionV1.scenario === "reversal" ? "reversal" : marketDecisionV1.criticalConfirmed ? "fast" : "normal",
        symbol: normalizeInstrument(selectedChartSymbol),
      });
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        setTelemetryStreamState("live");
        pingTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send("ping");
          }
        }, 20_000);
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data || "{}"));
          if (!payload || typeof payload !== "object") {
            return;
          }
          if (payload.type === "snapshot") {
            setExecutionTelemetry(((payload.items as JsonMap[] | undefined) || []).slice(0, 20));
            return;
          }
          if (payload.type === "telemetry") {
            const item = (payload.item as JsonMap | undefined) || null;
            if (!item) {
              return;
            }
            setExecutionTelemetry((current) => {
              const currentId = String(item.telemetry_id || "");
              const nextItems = [item, ...current.filter((entry) => String(entry.telemetry_id || "") !== currentId)];
              return nextItems.slice(0, 20);
            });
          }
        } catch {
          // Ignore malformed websocket frames.
        }
      };

      socket.onerror = () => {
        setTelemetryStreamState("offline");
      };

      socket.onclose = () => {
        if (pingTimer) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        if (closedByUnmount) {
          return;
        }
        setTelemetryStreamState("offline");
        reconnectTimer = window.setTimeout(() => {
          void connect();
        }, 2500);
      };
    };

    void connect();

    return () => {
      closedByUnmount = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      if (pingTimer) {
        window.clearInterval(pingTimer);
      }
      socket?.close();
    };
  }, []);

  useEffect(() => {
    const selectedQuote = quotes.find((quote) => instrumentLabel(quote) === selectedChartSymbol);
    const venue = String(selectedQuote?.venue || "binance-public");
    const instrument = normalizeInstrument(String(selectedQuote?.instrument || selectedChartSymbol || "BTCUSD"));
    const wsUrl = buildMarketDepthWsUrl(instrument, venue);
    if (!wsUrl) {
      setDepthStreamState("offline");
      return;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let closedByUnmount = false;

    const connect = () => {
      if (closedByUnmount) {
        return;
      }
      setDepthStreamState("connecting");
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        setDepthStreamState("live");
        pingTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send("ping");
          }
        }, 20_000);
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data || "{}"));
          if (!payload || typeof payload !== "object") {
            return;
          }
          if (payload.type === "snapshot") {
            setMarketDepth(payload as JsonMap);
            return;
          }
          if (payload.type === "delta") {
            setMarketDepth((current) => mergeDepthDelta(current, payload as JsonMap));
          }
        } catch {
          // Ignore malformed websocket frames.
        }
      };

      socket.onerror = () => {
        setDepthStreamState("offline");
      };

      socket.onclose = () => {
        if (pingTimer) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        if (closedByUnmount) {
          return;
        }
        setDepthStreamState("offline");
        reconnectTimer = window.setTimeout(connect, 2500);
      };
    };

    connect();

    return () => {
      closedByUnmount = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      if (pingTimer) {
        window.clearInterval(pingTimer);
      }
      socket?.close();
    };
  }, [selectedChartSymbol]);

  useEffect(() => {
    const candidateIds = (executionTelemetry.length > 0 ? executionTelemetry : outcomes)
      .map((item) => decisionIdFrom(item))
      .filter((id) => id.length > 0);
    if (candidateIds.length === 0) {
      setReplayDecisionId("");
      setReplayPayload(null);
      setReplayError(null);
      return;
    }
    if (!candidateIds.includes(replayDecisionId)) {
      setReplayDecisionId(candidateIds[0]);
    }
  }, [executionTelemetry, outcomes, replayDecisionId]);

  useEffect(() => {
    if (!replayDecisionId) {
      setReplayPayload(null);
      setReplayError(null);
      return;
    }
    let cancelled = false;
    setReplayLoading(true);
    setReplayError(null);
    fetch(`/api/execution/replay/${encodeURIComponent(replayDecisionId)}`, {
      cache: "no-store",
      headers: buildRoutingRequestHeaders("ai", selectedChartSymbol),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Replay indisponible (${response.status})`);
        }
        return response.json();
      })
      .then((payload) => {
        if (!cancelled) {
          setReplayPayload((payload || null) as JsonMap | null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setReplayPayload(null);
          setReplayError(err instanceof Error ? err.message : "Replay indisponible");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReplayLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [replayDecisionId]);

  async function submitTradeTicket(overrides?: {
    symbol?: string;
    side?: "buy" | "sell";
    lots?: number;
    notional?: number;
    maxSpread?: number;
    rationale?: string;
    orderIntent?: JsonMap;
    metadata?: JsonMap;
  }): Promise<void> {
    if (replayState.enabled) {
      setError("Replay Mode actif — execution live desactivee.");
      return;
    }
    setBusy(true);
    setError(null);
    setTradeResult(null);
    try {
      void fetchRoutingScoreCached(overrides?.symbol || symbol, "execution");
      const response = await fetch("/api/mt5/orders/filter", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildRoutingRequestHeaders("execution", overrides?.symbol || symbol),
        },
        body: JSON.stringify({
          account_id: accountId,
          symbol: overrides?.symbol || symbol,
          side: overrides?.side || side,
          lots: Number.isFinite(overrides?.lots) ? overrides?.lots : lots,
          estimated_notional_usd: Number.isFinite(overrides?.notional) ? overrides?.notional : notional,
          max_spread_bps: Number.isFinite(overrides?.maxSpread) ? overrides?.maxSpread : maxSpread,
          rationale: overrides?.rationale || rationale,
          order_intent: overrides?.orderIntent,
          metadata: overrides?.metadata,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(String(payload?.detail || "Ticket d'ordre rejete"));
      }
      setTradeResult(payload);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function submitChartOrder(confirmAck = false): Promise<void> {
    if (!(chartOrderTicket.entry > 0) || !(chartRiskPerUnit > 0) || !(chartRewardPerUnit > 0)) {
      setError("Bracket invalide: verifier Entry / SL / TP avant envoi.");
      return;
    }
    if (chartRiskLossExceeded) {
      setError(`Perte max depassee: ${chartRiskUsd.toFixed(2)}$ > ${chartMaxLossUsd.toFixed(2)}$`);
      pushChartSendHistory("blocked-loss");
      return;
    }
    const sideValue = chartOrderTicket.side;
    const rr = chartRiskReward > 0 ? chartRiskReward.toFixed(2) : "0.00";
    const rationaleAddon = `ChartBracket entry=${chartOrderTicket.entry.toFixed(4)} sl=${chartOrderTicket.sl.toFixed(4)} tp=${chartOrderTicket.tp.toFixed(4)} oco=${chartOrderTicket.oco ? "on" : "off"} riskUSD=${chartRiskUsd.toFixed(2)} rewardUSD=${chartRewardUsd.toFixed(2)} rr=${rr} maxLoss=${chartMaxLossUsd.toFixed(2)} targetGain=${chartTargetGainUsd.toFixed(2)} riskGuard=${chartRiskGuardEnabled ? "on" : "off"}`;
    const orderIntent: JsonMap = {
      source: "terminal-chart",
      mode: "bracket",
      preset: chartOrderTicket.preset,
      oco: {
        enabled: chartOrderTicket.oco,
        group_id: chartOrderTicket.oco ? `oco-${Date.now()}-${Math.floor(Math.random() * 100000)}` : "",
        cancel_policy: "cancel-other-on-fill",
      },
      bracket: {
        entry: chartOrderTicket.entry,
        stop_loss: chartOrderTicket.sl,
        take_profit: chartOrderTicket.tp,
        rr_ratio: chartRiskReward,
        risk_usd: chartRiskUsd,
        reward_usd: chartRewardUsd,
      },
      risk_preview: {
        qty: chartOrderQty,
        notional,
        max_spread_bps: maxSpread,
        max_loss_usd: chartMaxLossUsd,
        target_gain_usd: chartTargetGainUsd,
        target_rr: chartRiskTargetRr,
        guard_enabled: chartRiskGuardEnabled,
        confirm_ack: confirmAck,
      },
    };
    await submitTradeTicket({
      symbol: selectedChartSymbol,
      side: sideValue,
      notional,
      rationale: `${rationale || "Chart order"} | ${rationaleAddon}`,
      orderIntent,
      metadata: {
        ui_feature: "chart-trading-v2",
      },
    });
    pushChartSendHistory("submitted");
    setChartHudConfirmArmed(false);
    setChartOrderPreviewOpen(false);
  }

  const connectors = (snapshot?.connectors as JsonMap[] | undefined) || [];
  const alerts = (snapshot?.alerts as JsonMap[] | undefined) || [];
  const providerRows = (((aiHealth?.providers as JsonMap | undefined)?.providers as JsonMap[] | undefined) || []).slice(0, 8);
  const drift = (readiness?.drift as JsonMap | undefined) || {};
  const suspended = (drift.suspended_strategies as JsonMap[] | undefined) || [];
  const driftItems = (drift.items as JsonMap[] | undefined) || [];
  const memorySummary = (((readiness?.memory_kpi as JsonMap | undefined)?.summary as JsonMap | undefined) || {});
  const balances = ((balance?.balances as JsonMap[] | undefined) || []).slice(0, 6);

  const filteredQuotes = quotes.filter((quote) => {
    const quoteSymbol = instrumentLabel(quote);
    const market = classifyInstrument(quoteSymbol);
    const matchesSymbol = !symbolFilter || quoteSymbol.toLowerCase().includes(symbolFilter.toLowerCase());
    const matchesMarket = marketFilter === "all" || market === marketFilter;
    return matchesSymbol && matchesMarket;
  });

  const filteredOutcomes = outcomes.filter((item) => {
    const outcomeSymbol = instrumentLabel(item);
    const market = classifyInstrument(outcomeSymbol);
    const matchesSymbol = !symbolFilter || outcomeSymbol.toLowerCase().includes(symbolFilter.toLowerCase());
    const matchesMarket = marketFilter === "all" || market === marketFilter;
    const status = String(item.status || "").toLowerCase();
    const matchesEnvironment = environmentFilter === "all" || status.includes(environmentFilter);
    return matchesSymbol && matchesMarket && matchesEnvironment;
  });

  const filteredAlerts = alerts.filter((item) => severityFilter === "all" || String(item.level || "").toLowerCase() === severityFilter);

  const signalHistoricalLearningBundle = useMemo(() => {
    const normalizedSymbol = normalizeInstrument(selectedChartSymbol);
    const currentMarket = classifyInstrument(selectedChartSymbol);
    const readOutcomeTf = (item: JsonMap): string | null => {
      const raw = String(item.timeframe || item.chart_timeframe || item.strategy_timeframe || item.tf || "").trim();
      return raw === "1m" || raw === "5m" || raw === "15m" ? raw : null;
    };
    const inferOutcomeScenario = (item: JsonMap): MarketDecisionScenario | null => {
      const text = [
        item.scenario,
        item.scenario_type,
        item.setup,
        item.pattern,
        item.tag,
        item.signal,
        item.strategy_name,
        item.strategy_id,
        item.strategy,
      ].map((value) => String(value || "").toLowerCase()).join(" ");
      if (/reversal|mean\s*reversion|fade|trap|sweep|absorption|fake\s*breakout/.test(text)) {
        return "reversal";
      }
      if (/continuation|breakout|momentum|trend|follow\s*through|impulse/.test(text)) {
        return "continuation";
      }
      const mfe = Math.abs(toNumber(item.mfe_bps, NaN));
      const mae = Math.abs(toNumber(item.mae_bps, NaN));
      if (Number.isFinite(mfe) && Number.isFinite(mae) && mfe > 0 && mae > 0) {
        const ratio = mfe / Math.max(1, mae);
        if (ratio >= 2.1) {
          return "continuation";
        }
        if (ratio <= 0.95) {
          return "reversal";
        }
      }
      return "balance";
    };
    const buildLearning = (sample: JsonMap[], scopeLabel: string): MarketHistoricalLearning => {
      if (sample.length === 0) {
        return {
          sampleSize: 0,
          scopeLabel,
          winratePct: 50,
          learnedWeights: { ...DEFAULT_CONFLUENCE_WEIGHTS },
        };
      }
      const winrate = sample.filter((item) => toNumber(item.pnl_usd, toNumber(item.net_result_usd, 0)) >= 0).length / sample.length;
      const avgPnlPct = average(sample.map((item) => toNumber(item.pnl_pct, 0)));
      const avgMfe = average(sample.map((item) => toNumber(item.mfe_bps, 0)));
      const avgMae = average(sample.map((item) => Math.abs(toNumber(item.mae_bps, 0))));
      const avgSlip = average(sample.map((item) => Math.abs(toNumber(item.realized_slippage_bps || item.slippage_real_bps, 0))));
      const confidence = clamp(sample.length / 28, 0.22, 1);
      const learnedWeights: MarketConfluenceWeights = {
        dom: clamp(0.9 + (winrate - 0.5) * 0.7 + Math.max(0, 12 - avgSlip) * 0.015 * confidence, 0.72, 1.35),
        footprint: clamp(0.92 + (winrate - 0.5) * 0.9 + avgPnlPct * 0.018 * confidence, 0.72, 1.42),
        liquidity: clamp(0.9 + Math.max(0, 18 - avgMae) * 0.01 * confidence + Math.max(0, 10 - avgSlip) * 0.02 * confidence, 0.74, 1.46),
        "price-action": clamp(0.9 + avgMfe * 0.002 * confidence + (winrate - 0.5) * 0.55, 0.74, 1.36),
      };
      return {
        sampleSize: sample.length,
        scopeLabel,
        winratePct: winrate * 100,
        learnedWeights,
      };
    };
    const withPnl = filteredOutcomes.filter((item) => Number.isFinite(toNumber(item.pnl_usd, NaN)) || Number.isFinite(toNumber(item.net_result_usd, NaN)));
    const exact = withPnl.filter((item) => normalizeInstrument(instrumentLabel(item)) === normalizedSymbol && (!readOutcomeTf(item) || readOutcomeTf(item) === chartTimeframe));
    const fallback = withPnl.filter((item) => classifyInstrument(instrumentLabel(item)) === currentMarket);
    const scoped = (exact.length >= 6 ? exact : fallback).slice(0, 120);
    const scopeLabel = exact.length >= 6 ? `${selectedChartSymbol} ${chartTimeframe}` : `${currentMarket} fallback`;
    const mixed = buildLearning(scoped.slice(0, 80), scopeLabel);
    const byScenario: Record<MarketDecisionScenario, MarketHistoricalLearning> = {
      reversal: buildLearning(scoped.filter((item) => inferOutcomeScenario(item) === "reversal").slice(0, 80), `${scopeLabel} · reversal`),
      continuation: buildLearning(scoped.filter((item) => inferOutcomeScenario(item) === "continuation").slice(0, 80), `${scopeLabel} · continuation`),
      balance: buildLearning(scoped.filter((item) => inferOutcomeScenario(item) === "balance").slice(0, 80), `${scopeLabel} · balance`),
    };
    for (const scenario of ["reversal", "continuation", "balance"] as const) {
      if (byScenario[scenario].sampleSize >= 4) {
        continue;
      }
      byScenario[scenario] = {
        sampleSize: mixed.sampleSize,
        scopeLabel: `${scopeLabel} · ${scenario} fallback`,
        winratePct: mixed.winratePct,
        learnedWeights: { ...mixed.learnedWeights },
      };
    }
    return { mixed, byScenario };
  }, [chartTimeframe, filteredOutcomes, selectedChartSymbol]);
  const signalHistoricalLearning = signalHistoricalLearningBundle.mixed;

  const marketBuckets = ["crypto", "fx", "indices", "cfd", "futures"].map((market) => {
    const bucketQuotes = filteredQuotes.filter((quote) => classifyInstrument(instrumentLabel(quote)) === market);
    const bucketOutcomes = filteredOutcomes.filter((item) => classifyInstrument(instrumentLabel(item)) === market);
    const bucketPositions = positions.filter((item) => classifyInstrument(instrumentLabel(item)) === market);

    const pnl = bucketOutcomes.reduce((sum, item) => sum + toNumber(item.net_result_usd, 0), 0);
    const exposure = bucketPositions.reduce((sum, item) => sum + toNumber(item.net_notional_usd, 0), 0);

    return {
      market,
      quoteCount: bucketQuotes.length,
      pnl,
      exposure,
    };
  });

  const replayTelemetry = (replayPayload?.telemetry as JsonMap | undefined) || null;
  const replayFills = ((replayPayload?.fills as JsonMap[] | undefined) || []).slice(0, 60);
  const replayTimeline = replayTelemetry
    ? [
      { label: "Decision", timestamp: String(replayTelemetry.ts_decision || "") },
      { label: "Intent", timestamp: String(replayTelemetry.ts_intent || "") },
      { label: "Routing", timestamp: String(replayTelemetry.ts_routing || "") },
      { label: "Approval", timestamp: String(replayTelemetry.ts_broker_accept || "") },
      { label: "Fill partial", timestamp: String(replayTelemetry.ts_fill_partial || "") },
      { label: "Fill final", timestamp: String(replayTelemetry.ts_fill_final || "") },
    ].filter((item) => item.timestamp)
      .sort((left, right) => sortIsoAscending(left.timestamp, right.timestamp))
    : [];

  const nativeSeries = ohlcvBars.map((bar) => ({ label: String(bar.bucket_start || "-"), value: toNumber(bar.close, 0) })).filter((point) => point.value > 0);
  const chartSeriesRaw = nativeSeries.length > 0 ? nativeSeries : (quoteHistory[selectedChartSymbol] || []);
  const chartSeries = chartSeriesRaw.slice(-Math.max(20, Math.min(chartWindow, 500)));
  const chartCandles = ohlcvBars.slice(-Math.max(20, Math.min(chartWindow, 500))).map((bar) => ({
    label: String(bar.bucket_start || "-"),
    open: toNumber(bar.open, 0),
    high: toNumber(bar.high, 0),
    low: toNumber(bar.low, 0),
    close: toNumber(bar.close, 0),
    volume: toNumber(bar.volume, 0),
  }));

  // ── Memoized indicator computation (PERF) ──────────────────────────────────
  // Hash-based memoization: only recompute if bars or active indicators actually change
  const barHash = useMemo(() => barArrayHash(chartCandles.map((c) => ({
    time: Math.floor(new Date(c.label).getTime() / 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }))), [chartCandles]);

  const barsForIndicators = useMemo(() => chartCandles.map((c) => ({
    time: Math.floor(new Date(c.label).getTime() / 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  })), [chartCandles]);
  const activeIndicatorKey = useMemo(() => activeIndicators.map((a) => `${a.id}:${JSON.stringify(a.params || {})}`).join("|"), [activeIndicators]);

  useEffect(() => {
    const seq = indicatorComputeSeqRef.current + 1;
    indicatorComputeSeqRef.current = seq;

    if (barsForIndicators.length === 0 || activeIndicators.length === 0) {
      setIndicatorSeriesForChart([]);
      return;
    }

    let cancelled = false;
    indicatorWorkerAdapter.compute(barsForIndicators as Bar[], activeIndicators)
      .then((result) => {
        if (cancelled || indicatorComputeSeqRef.current !== seq) {
          return;
        }
        setIndicatorSeriesForChart(result);
      })
      .catch(() => {
        if (!cancelled && indicatorComputeSeqRef.current === seq) {
          setIndicatorSeriesForChart([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [barHash, activeIndicatorKey, barsForIndicators, activeIndicators]);
  const latestQuote = filteredQuotes.find((quote) => instrumentLabel(quote) === selectedChartSymbol) || quotes.find((quote) => instrumentLabel(quote) === selectedChartSymbol) || null;
  const selectedQuoteRows = quotes.filter((quote) => instrumentLabel(quote) === selectedChartSymbol);
  const chartValues = chartMode === "candles"
    ? chartCandles.flatMap((candle) => [candle.low, candle.high]).filter((value) => Number.isFinite(value) && value > 0)
    : chartSeries.map((point) => point.value);
  const chartFirstValue = chartMode === "candles"
    ? (chartCandles[0]?.close ?? 0)
    : (chartSeries[0]?.value ?? 0);
  const chartLastValue = chartMode === "candles"
    ? (chartCandles[chartCandles.length - 1]?.close ?? chartFirstValue)
    : (chartSeries[chartSeries.length - 1]?.value ?? chartFirstValue);
  const chartMin = chartValues.length > 0 ? Math.min(...chartValues) : 0;
  const chartMax = chartValues.length > 0 ? Math.max(...chartValues) : 0;
  const chartChange = chartLastValue - chartFirstValue;
  const chartChangePct = chartFirstValue !== 0 ? (chartChange / chartFirstValue) * 100 : 0;
  const chartAnchorPrice = toNumber(latestQuote?.last, chartLastValue || chartFirstValue || 0);
  const chartRangePad = chartMax > chartMin ? (chartMax - chartMin) * 0.08 : Math.max(1, chartAnchorPrice * 0.015);
  const chartPriceRangeMin = Math.max(0.0000001, (chartMin || chartAnchorPrice || 1) - chartRangePad);
  const chartPriceRangeMax = (chartMax || chartAnchorPrice || 1) + chartRangePad;
  const chartOrderQty = chartOrderTicket.entry > 0 ? Math.max(0, notional / chartOrderTicket.entry) : 0;
  const chartRiskPerUnit = chartOrderTicket.side === "buy"
    ? Math.max(0, chartOrderTicket.entry - chartOrderTicket.sl)
    : Math.max(0, chartOrderTicket.sl - chartOrderTicket.entry);
  const chartRewardPerUnit = chartOrderTicket.side === "buy"
    ? Math.max(0, chartOrderTicket.tp - chartOrderTicket.entry)
    : Math.max(0, chartOrderTicket.entry - chartOrderTicket.tp);
  const chartRiskUsd = chartRiskPerUnit * chartOrderQty;
  const chartRewardUsd = chartRewardPerUnit * chartOrderQty;
  const chartRiskReward = chartRiskUsd > 0 ? chartRewardUsd / chartRiskUsd : 0;
  const chartRiskTargetRr = chartMaxLossUsd > 0 ? chartTargetGainUsd / chartMaxLossUsd : 0;
  const chartRiskLossExceeded = chartRiskGuardEnabled && chartMaxLossUsd > 0 && chartRiskUsd > chartMaxLossUsd;
  const chartRiskTargetMiss = chartRiskGuardEnabled && chartTargetGainUsd > 0 && chartRewardUsd < chartTargetGainUsd;
  const chartEffectiveSendMode: ChartReleaseSendMode = chartRiskTargetMiss ? "confirm-required" : chartReleaseSendMode;
  const accountFreeUsd = (() => {
    const freeCandidates = [
      toNumber(balance?.free_usd, NaN),
      toNumber(balance?.equity_usd, NaN),
      toNumber(balance?.balance_usd, NaN),
    ];
    const usdBalance = ((balance?.balances as JsonMap[] | undefined) || []).find((item) => String(item.currency || "").toUpperCase() === "USD");
    if (usdBalance) {
      freeCandidates.push(toNumber(usdBalance.free, NaN));
      freeCandidates.push(toNumber(usdBalance.balance, NaN));
    }
    for (const value of freeCandidates) {
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    return Math.max(1, notional * 10);
  })();
  const openTradesCount = positions.filter((position) => Math.abs(toNumber(position.net_notional_usd, 0)) > 1).length;
  const grossExposureUsd = positions.reduce((sum, position) => sum + Math.abs(toNumber(position.net_notional_usd, 0)), 0);
  const exposureRatio = grossExposureUsd / Math.max(1, accountFreeUsd);
  const dailyPnLUsd = (() => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    return outcomes.reduce((sum, item) => {
      const ts = Date.parse(String(item.closed_at || item.timestamp || item.ts || ""));
      if (Number.isFinite(ts) && now - ts <= oneDayMs) {
        return sum + toNumber(item.pnl_usd, toNumber(item.net_result_usd, 0));
      }
      return sum;
    }, 0);
  })();
  const dailyDrawdownPct = accountFreeUsd > 0 ? Math.max(0, (-dailyPnLUsd / accountFreeUsd) * 100) : 0;
  const dayVwap = weightedVwap(chartSeries.slice(-12));
  const weekVwap = weightedVwap(chartSeries.slice(-24));
  const monthVwap = weightedVwap(chartSeries);
  const overlayZones = buildOverlayZones(chartSeries);
  const liquidityZones = buildLiquidityZones(chartSeries);
  const chartPriceStep = inferChartPriceStep(selectedChartSymbol, chartAnchorPrice > 0 ? chartAnchorPrice : chartLastValue || chartFirstValue || 1);
  const chartPriceDigits = getPriceStepDecimals(chartPriceStep);
  const chartRoundMagnetStep = Math.max(chartPriceStep, chartPriceStep >= 1 ? chartPriceStep * 10 : chartPriceStep * 50);
  const chartSnapThreshold = Math.max(chartPriceStep * 4, (chartPriceRangeMax - chartPriceRangeMin) * 0.005);
  const chartAtrLocalPct = useMemo(() => {
    if (chartCandles.length < 3) {
      return 0;
    }
    const sample = chartCandles.slice(-14);
    let totalTr = 0;
    for (let index = 0; index < sample.length; index += 1) {
      const current = sample[index];
      const prevClose = index > 0 ? sample[index - 1].close : current.close;
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - prevClose),
        Math.abs(current.low - prevClose),
      );
      totalTr += Math.max(0, tr);
    }
    const atr = totalTr / Math.max(1, sample.length);
    const reference = Math.max(0.0000001, chartLastValue || sample[sample.length - 1].close || 1);
    return atr / reference;
  }, [chartCandles, chartLastValue]);
  const activeChartPanel = chartPanels[chartLinkGroup];
  const visibleChartGroups = chartViewDensity === 2 ? CHART_GROUPS.slice(0, 2) : CHART_GROUPS;
  const chartSyncModeLabel = chartSyncPriorityMode === "leader" ? `leader ${chartSyncLeaderGroup}` : "last-edited";
  const chartSyncSourceLabel = (panel: ChartPanelState): string => {
    if (panel.source === "leader") {
      return `leader:${panel.sourceFrom || chartSyncLeaderGroup}`;
    }
    if (panel.source === "last-edited") {
      return `last:${panel.sourceFrom || "?"}`;
    }
    if (panel.source === "storage") {
      return "storage";
    }
    if (panel.source === "workspace") {
      return "workspace";
    }
    return "manual";
  };

  const applyChartOrderPreset = (preset: ChartOrderPreset, nextSide?: "buy" | "sell") => {
    const config = preset === "custom" ? null : CHART_ORDER_PRESETS[preset];
    const sideValue = nextSide || chartOrderTicket.side;
    const entry = chartAnchorPrice > 0 ? chartAnchorPrice : chartLastValue;
    const slPct = config?.slPct ?? (chartOrderTicket.side === "buy" ? Math.max(0.001, (chartOrderTicket.entry - chartOrderTicket.sl) / Math.max(0.0000001, chartOrderTicket.entry)) : Math.max(0.001, (chartOrderTicket.sl - chartOrderTicket.entry) / Math.max(0.0000001, chartOrderTicket.entry)));
    const tpPct = config?.tpPct ?? (chartOrderTicket.side === "buy" ? Math.max(0.001, (chartOrderTicket.tp - chartOrderTicket.entry) / Math.max(0.0000001, chartOrderTicket.entry)) : Math.max(0.001, (chartOrderTicket.entry - chartOrderTicket.tp) / Math.max(0.0000001, chartOrderTicket.entry)));
    const sl = sideValue === "buy" ? entry * (1 - slPct) : entry * (1 + slPct);
    const tp = sideValue === "buy" ? entry * (1 + tpPct) : entry * (1 - tpPct);
    setChartOrderTicket((current) => ({
      ...current,
      side: sideValue,
      preset,
      entry,
      sl,
      tp,
      active: true,
    }));
    setSymbol(selectedChartSymbol);
    setSide(sideValue);
    if (config) {
      setNotional(config.notional);
      setMaxSpread(config.maxSpread);
    }
  };

  const applyExecutionAdaptationPlan = (plan: MarketDecisionSnapshot["executionPlan"]) => {
    if (chartSnapPriority !== plan.snapPriority) {
      setChartSnapPriority(plan.snapPriority);
    }
    if (chartRiskGuardEnabled !== plan.guardEnabled) {
      setChartRiskGuardEnabled(plan.guardEnabled);
    }
    if (chartOrderTicket.preset !== "custom" && chartOrderTicket.preset !== plan.preset) {
      applyChartOrderPreset(plan.preset);
    }
  };

  const applySuggestedScenarioBracket = (bracket: MarketSuggestedBracket | null) => {
    if (!bracket) {
      return;
    }
    setChartOrderTicket((current) => ({
      ...current,
      side: bracket.side,
      preset: "custom",
      entry: bracket.entry,
      sl: bracket.sl,
      tp: bracket.tp,
      active: true,
    }));
    setSymbol(selectedChartSymbol);
    setSide(bracket.side);
  };

  const pushChartSendHistory = (outcome: ChartSendHistoryEntry["outcome"]) => {
    const entry: ChartSendHistoryEntry = {
      atIso: new Date().toISOString(),
      symbol: selectedChartSymbol,
      side: chartOrderTicket.side,
      rr: chartRiskReward,
      riskUsd: chartRiskUsd,
      rewardUsd: chartRewardUsd,
      maxLossUsd: chartMaxLossUsd,
      targetGainUsd: chartTargetGainUsd,
      compliant: !chartRiskLossExceeded && !chartRiskTargetMiss,
      outcome,
      source: "local",
    };
    setChartSendHistory((current) => [entry, ...current].slice(0, 5));
  };

  const approveAllAndSend = async (): Promise<void> => {
    if (!marketDecisionV1.suggestedBracket) {
      return;
    }
    setShowDecisionSecondary(false);
    applySuggestedScenarioBracket(marketDecisionV1.suggestedBracket);
    applyExecutionAdaptationPlan(marketDecisionV1.executionPlan);
    setPendingExecutionAdaptation(null);
    if (chartEffectiveSendMode === "confirm-required" && !chartHudConfirmArmed) {
      setChartHudConfirmArmed(true);
      pushChartSendHistory("confirmation-required");
      setError("Risk target not met: confirm-required armed. Press Approve All + Send again to confirm.");
      return;
    }
    const ack = chartEffectiveSendMode !== "confirm-required" || chartHudConfirmArmed;
    setChartHudConfirmArmed(false);
    await submitChartOrder(ack);
  };

  useEffect(() => {
    let closed = false;
    let inFlight = false;
    const mapAuditEntry = (item: JsonMap): ChartSendHistoryEntry | null => {
      const category = String(item.category || "");
      const payload = (item.payload && typeof item.payload === "object") ? (item.payload as JsonMap) : {};
      const riskContext = (payload.risk_context && typeof payload.risk_context === "object") ? (payload.risk_context as JsonMap) : {};
      const timestamp = String(item.timestamp || "").trim();
      if (!timestamp) {
        return null;
      }

      if (category === "mt5_order_accepted") {
        return {
          atIso: timestamp,
          symbol: String(payload.symbol || selectedChartSymbol || "BTCUSD"),
          side: String(payload.side || "buy") === "sell" ? "sell" : "buy",
          rr: toNumber(riskContext.target_rr, 0),
          riskUsd: toNumber(riskContext.risk_usd, 0),
          rewardUsd: toNumber(riskContext.reward_usd, 0),
          maxLossUsd: toNumber(riskContext.max_loss_usd, 0),
          targetGainUsd: toNumber(riskContext.target_gain_usd, 0),
          compliant: Boolean(riskContext.compliant),
          outcome: "submitted",
          source: "backend",
        };
      }

      if (category === "mt5_order_blocked_risk_max_loss") {
        return {
          atIso: timestamp,
          symbol: String(payload.symbol || selectedChartSymbol || "BTCUSD"),
          side: String(payload.side || "buy") === "sell" ? "sell" : "buy",
          rr: 0,
          riskUsd: toNumber(payload.risk_usd, 0),
          rewardUsd: 0,
          maxLossUsd: toNumber(payload.max_loss_usd, 0),
          targetGainUsd: 0,
          compliant: false,
          outcome: "blocked-loss",
          source: "backend",
        };
      }

      if (category === "mt5_order_requires_confirm_target_gain") {
        return {
          atIso: timestamp,
          symbol: String(payload.symbol || selectedChartSymbol || "BTCUSD"),
          side: String(payload.side || "buy") === "sell" ? "sell" : "buy",
          rr: 0,
          riskUsd: 0,
          rewardUsd: toNumber(payload.reward_usd, 0),
          maxLossUsd: 0,
          targetGainUsd: toNumber(payload.target_gain_usd, 0),
          compliant: false,
          outcome: "confirmation-required",
          source: "backend",
        };
      }

      return null;
    };

    const loadAuditHistory = async () => {
      if (closed || inFlight) {
        return;
      }
      if (authSessionRequired || Date.now() < authBackoffUntilRef.current) {
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      inFlight = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => {
        controller.abort();
      }, 12000);
      try {
        const startedAt = Date.now();
        const params = new URLSearchParams();
        params.set("limit", "120");
        params.set("symbol", selectedChartSymbol);
        params.set("account_id", accountId);
        if (riskTimelineFrom.trim()) {
          params.set("from", new Date(riskTimelineFrom).toISOString());
        }
        if (riskTimelineTo.trim()) {
          params.set("to", new Date(riskTimelineTo).toISOString());
        }
        const response = await fetch(`/api/mt5/orders/risk-history?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
          headers: buildRoutingRequestHeaders("ui", selectedChartSymbol),
        });
        if (response.status === 401) {
          markUnauthorizedBackoff();
          return;
        }
        if (!response.ok) {
          return;
        }
        const payload = await response.json();
        if (closed || !Array.isArray(payload)) {
          return;
        }
        const mapped = payload
          .map((item) => mapAuditEntry((item && typeof item === "object") ? (item as JsonMap) : {}))
          .filter((item): item is ChartSendHistoryEntry => Boolean(item))
          .sort((a, b) => new Date(b.atIso).getTime() - new Date(a.atIso).getTime())
          .slice(0, 5);
        setChartSendHistoryBackend(mapped);
        setRiskPollingStatus({
          lastRefreshIso: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
          source: "history",
        });
      } catch {
        // noop
      } finally {
        window.clearTimeout(timeout);
        inFlight = false;
      }
    };

    void loadAuditHistory();
    const timer = window.setInterval(() => {
      void loadAuditHistory();
    }, riskTimelineRefreshSec * 1000);
    return () => {
      closed = true;
      window.clearInterval(timer);
    };
  }, [accountId, authSessionRequired, riskTimelineFrom, riskTimelineRefreshSec, riskTimelineTo, selectedChartSymbol]);

  useEffect(() => {
    let closed = false;
    let inFlight = false;

    const loadRiskSummary = async () => {
      if (closed || inFlight) {
        return;
      }
      if (authSessionRequired || Date.now() < authBackoffUntilRef.current) {
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      inFlight = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => {
        controller.abort();
      }, 12000);
      try {
        const startedAt = Date.now();
        const params = new URLSearchParams();
        params.set("window", String(Math.max(3, Math.min(100, riskAlertWindow))));
        params.set("miss_threshold", String(Math.max(1, Math.min(Math.max(3, Math.min(100, riskAlertWindow)), riskAlertMissThreshold))));
        params.set("symbol", selectedChartSymbol);
        params.set("account_id", accountId);
        if (riskTimelineFrom.trim()) {
          params.set("from", new Date(riskTimelineFrom).toISOString());
        }
        if (riskTimelineTo.trim()) {
          params.set("to", new Date(riskTimelineTo).toISOString());
        }
        const response = await fetch(`/api/mt5/orders/risk-history/summary?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
          headers: buildRoutingRequestHeaders("ui", selectedChartSymbol),
        });
        if (response.status === 401) {
          markUnauthorizedBackoff();
          return;
        }
        if (!response.ok) {
          setRiskPollingFailures((current) => current + 1);
          return;
        }
        const payload = await response.json();
        if (closed || !payload || typeof payload !== "object") {
          setRiskPollingFailures((current) => current + 1);
          return;
        }
        setRiskSummary(payload as RiskHistorySummary);
        setRiskPollingFailures(0);
        setRiskPollingStatus({
          lastRefreshIso: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
          source: "summary",
        });
      } catch {
        setRiskPollingFailures((current) => current + 1);
      } finally {
        window.clearTimeout(timeout);
        inFlight = false;
      }
    };

    void loadRiskSummary();
    const timer = window.setInterval(() => {
      void loadRiskSummary();
    }, riskTimelineRefreshSec * 1000);

    return () => {
      closed = true;
      window.clearInterval(timer);
    };
  }, [accountId, authSessionRequired, riskAlertMissThreshold, riskAlertWindow, riskTimelineFrom, riskTimelineRefreshSec, riskTimelineTo, selectedChartSymbol]);

  useEffect(() => {
    if (!riskPollingStatus.lastRefreshIso) {
      setRiskPollAgeSec(0);
      return;
    }
    const updateAge = () => {
      const refreshedAt = new Date(riskPollingStatus.lastRefreshIso || "").getTime();
      if (!Number.isFinite(refreshedAt)) {
        setRiskPollAgeSec(0);
        return;
      }
      const elapsedMs = Date.now() - refreshedAt;
      setRiskPollAgeSec(Math.max(0, Math.floor(elapsedMs / 1000)));
    };
    updateAge();
    const timer = window.setInterval(updateAge, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [riskPollingStatus.lastRefreshIso]);

  const buildRiskExportParams = (format: "json" | "csv"): URLSearchParams => {
    const params = new URLSearchParams();
    params.set("format", format);
    params.set("limit", "1000");
    params.set("symbol", selectedChartSymbol);
    params.set("account_id", accountId);
    if (riskTimelineFrom.trim()) {
      params.set("from", new Date(riskTimelineFrom).toISOString());
    }
    if (riskTimelineTo.trim()) {
      params.set("to", new Date(riskTimelineTo).toISOString());
    }
    return params;
  };

  const fetchRiskExport = async (format: "json" | "csv"): Promise<unknown | string | null> => {
    const response = await fetch(`/api/mt5/orders/risk-history/export?${buildRiskExportParams(format).toString()}`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    if (format === "json") {
      return response.json();
    }
    return response.text();
  };

  const exportRiskHistory = async (format: "json" | "csv") => {
    try {
      const payload = await fetchRiskExport(format);
      if (payload === null) {
        return;
      }
      if (format === "json") {
        downloadJsonFile(`risk-history-${selectedChartSymbol}-${accountId}.json`, payload);
        return;
      }
      if (typeof payload !== "string") {
        return;
      }
      const blob = new Blob([payload], { type: "text/csv;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `risk-history-${selectedChartSymbol}-${accountId}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(href);
    } catch {
      // noop
    }
  };

  const exportComplianceZip = async () => {
    try {
      const [jsonPayload, csvPayload] = await Promise.all([
        fetchRiskExport("json"),
        fetchRiskExport("csv"),
      ]);
      const settingsPayload = {
        exportedAt: new Date().toISOString(),
        accountId,
        symbol: selectedChartSymbol,
        from: riskTimelineFrom || null,
        to: riskTimelineTo || null,
        window: riskAlertWindow,
        missThreshold: riskAlertMissThreshold,
        refreshSec: riskTimelineRefreshSec,
        hardAlertEnabled: riskHardAlertEnabled,
        hardAlertThresholdPct: riskHardAlertThresholdPct,
        layoutPreset,
        summary: riskSummary,
      };

      const zip = new JSZip();
      if (jsonPayload !== null) {
        zip.file("risk-history.json", JSON.stringify(jsonPayload, null, 2));
      }
      if (typeof csvPayload === "string") {
        zip.file("risk-history.csv", csvPayload);
      }
      zip.file("risk-settings.json", JSON.stringify(settingsPayload, null, 2));

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const href = URL.createObjectURL(zipBlob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `risk-compliance-${selectedChartSymbol}-${accountId}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(href);
    } catch {
      // noop
    }
  };

  const exportAutoExecutionAudit = (format: "json" | "csv") => {
    if (autoExecutionAuditTrail.length === 0) {
      return;
    }
    const filenameBase = `auto-exec-audit-${selectedChartSymbol}-${accountId}`;
    if (format === "json") {
      downloadJsonFile(`${filenameBase}.json`, {
        exportedAt: new Date().toISOString(),
        symbol: selectedChartSymbol,
        accountId,
        mode: autoExecutionMode,
        killSwitch: autoExecutionKillSwitch,
        sessionGuard: {
          enabled: autoSessionGuardEnabled,
          startHour: autoSessionStartHour,
          endHour: autoSessionEndHour,
        },
        symbolLossCapUsd: autoSymbolLossCapUsd,
        events: autoExecutionAuditTrail,
      });
      return;
    }
    const rows: Array<Array<string | number>> = [
      [
        "timestamp",
        "symbol",
        "timeframe",
        "mode",
        "gate_state",
        "meta_pass",
        "risk_pass",
        "session_pass",
        "symbol_loss_pass",
        "kill_switch",
        "size_usd",
        "quality_score",
        "reasons",
      ],
      ...autoExecutionAuditTrail.map((event) => [
        event.timestampIso,
        event.symbol,
        event.timeframe,
        event.mode,
        event.gateState,
        event.metaPass ? "1" : "0",
        event.riskPass ? "1" : "0",
        event.sessionPass ? "1" : "0",
        event.symbolLossPass ? "1" : "0",
        event.killSwitch ? "1" : "0",
        event.sizeUsd.toFixed(2),
        event.qualityScore.toFixed(3),
        event.reasons.join(" | "),
      ]),
    ];
    downloadCsvFile(`${filenameBase}.csv`, rows);
  };
  const exportSelfLearningJournalV4 = (format: "json" | "csv") => {
    if (selfLearningJournalV4Trail.length === 0) {
      return;
    }
    const filenameBase = `self-learning-v4-journal-${selectedChartSymbol}-${accountId}`;
    if (format === "json") {
      downloadJsonFile(`${filenameBase}.json`, {
        exportedAt: new Date().toISOString(),
        symbol: selectedChartSymbol,
        timeframe: chartTimeframe,
        drift: {
          status: selfLearningV4DriftLabel,
          winrateDropPct: selfLearningDriftV4.winrateDropPct,
          brierRise: selfLearningDriftV4.brierRise,
          shortLossCount: selfLearningDriftV4.shortLossCount,
          shortSamples: selfLearningDriftV4.shortSamples,
          longSamples: selfLearningDriftV4.longSamples,
        },
        autoDemotedAt: selfLearningDriftAutoDemotedAt,
        events: selfLearningJournalV4Trail,
      });
      return;
    }
    const rows: Array<Array<string | number>> = [
      [
        "timestamp",
        "symbol",
        "timeframe",
        "regime",
        "scenario",
        "outcome",
        "pnl_usd",
        "mfe_bps",
        "mae_bps",
        "w_dom",
        "w_footprint",
        "w_liquidity",
        "w_price_action",
      ],
      ...selfLearningJournalV4Trail.map((event) => [
        event.timestampIso,
        event.symbol,
        event.timeframe,
        event.regime,
        event.scenario,
        event.outcome,
        event.pnl.toFixed(2),
        event.mfe.toFixed(2),
        event.mae.toFixed(2),
        event.weights.dom.toFixed(4),
        event.weights.footprint.toFixed(4),
        event.weights.liquidity.toFixed(4),
        event.weights["price-action"].toFixed(4),
      ]),
    ];
    downloadCsvFile(`${filenameBase}.csv`, rows);
  };
  const filteredSelfLearningJournalV4Trail = selfLearningJournalV4Trail.filter((event) => {
    if (selfLearningJournalV4RegimeFilter !== "all" && event.regime !== selfLearningJournalV4RegimeFilter) {
      return false;
    }
    if (selfLearningJournalV4ScenarioFilter !== "all" && event.scenario !== selfLearningJournalV4ScenarioFilter) {
      return false;
    }
    return true;
  });
  const selfLearningCurrentScopeCount = selfLearningV4ScopeSummaries.filter(
    (item) => item.accountId === accountId && item.symbol === selectedChartSymbol && item.timeframe === chartTimeframe,
  ).length;
  const selfLearningStorageLabel = selfLearningV4PersistenceStatus.storage === "control-plane"
    ? "CP"
    : selfLearningV4PersistenceStatus.storage === "local-fallback"
      ? "LOCAL"
      : "UNKNOWN";
  const selfLearningStorageTone = !selfLearningV4PersistenceStatus.healthy
    ? "bad"
    : selfLearningV4PersistenceStatus.storage === "control-plane"
      ? "good"
      : selfLearningV4PersistenceStatus.storage === "local-fallback"
        ? "warn"
        : "warn";
  const filteredAutoExecutionAuditTrail = autoExecutionAuditTrail.filter((event) => {
    if (autoExecutionAuditStateFilter !== "all" && event.gateState !== autoExecutionAuditStateFilter) {
      return false;
    }
    const reasonQuery = autoExecutionAuditReasonSearch.trim().toLowerCase();
    if (!reasonQuery) {
      return true;
    }
    return event.reasons.join(" ").toLowerCase().includes(reasonQuery);
  });

  const mergedChartSendHistory = [...chartSendHistory, ...chartSendHistoryBackend]
    .sort((a, b) => new Date(b.atIso).getTime() - new Date(a.atIso).getTime())
    .slice(0, 5);
  const riskTimelineRows = [...chartSendHistoryBackend, ...chartSendHistory]
    .sort((a, b) => new Date(b.atIso).getTime() - new Date(a.atIso).getTime())
    .filter((entry) => {
      if (riskTimelineFilter === "compliant") {
        return entry.compliant;
      }
      if (riskTimelineFilter === "miss") {
        return !entry.compliant;
      }
      return true;
    })
    .slice(0, 24);

  const chartPriceToY = (price: number, height: number): number => {
    const range = Math.max(0.0000001, chartPriceRangeMax - chartPriceRangeMin);
    const pct = (chartPriceRangeMax - price) / range;
    return Math.max(0, Math.min(height, pct * height));
  };

  const chartYToPrice = (y: number, height: number): number => {
    const safeHeight = Math.max(1, height);
    const pct = Math.max(0, Math.min(1, y / safeHeight));
    return chartPriceRangeMax - (chartPriceRangeMax - chartPriceRangeMin) * pct;
  };

  const chartLongPressThresholdMs = (pointerType: string): number => {
    const coarsePointer = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    const base = pointerType === "pen" ? 240 : pointerType === "mouse" ? 460 : 320;
    return coarsePointer && pointerType !== "mouse" ? base + 35 : base;
  };
  const activePricePre = crosshair?.price ?? chartLastValue;

  const suggestedLiquidityHighlight = (() => {
    const bracket = marketDecisionV1?.suggestedBracket || null;
    if (!bracket || liquidityZones.length === 0) {
      return null;
    }
    if (bracket.side === "buy") {
      return liquidityZones
        .filter((zone) => zone.level >= Math.min(bracket.tp, bracket.entry))
        .sort((a, b) => Math.abs(a.level - bracket.tp) - Math.abs(b.level - bracket.tp))[0] || null;
    }
    return liquidityZones
      .filter((zone) => zone.level <= Math.max(bracket.tp, bracket.entry))
      .sort((a, b) => Math.abs(a.level - bracket.tp) - Math.abs(b.level - bracket.tp))[0] || null;
  })();
  const suggestedLiquidityExactTpMatch = (() => {
    const bracket = marketDecisionV1?.suggestedBracket || null;
    if (!bracket || !suggestedLiquidityHighlight) {
      return false;
    }
    const tolerance = Math.max(chartPriceStep * 1.5, Math.abs(bracket.tp) * 0.00005);
    return Math.abs(suggestedLiquidityHighlight.level - bracket.tp) <= tolerance;
  })();
  const perceptionTopSignal = (marketSignalV1?.signals || [])[0] || null;
  const perceptionCoreLabel = (() => {
    if (!perceptionTopSignal) {
      return "WAIT · no dominant signal";
    }
    if (perceptionTopSignal.id === "liquidity-trap") {
      return "TRAP DETECTED";
    }
    if (perceptionTopSignal.id === "absorption") {
      return perceptionTopSignal.direction === "buy" ? "BUYER ABSORPTION" : "SELLER ABSORPTION";
    }
    if (perceptionTopSignal.id === "imbalance") {
      return perceptionTopSignal.direction === "buy" ? "STRONG BUY PRESSURE" : "STRONG SELL PRESSURE";
    }
    if (perceptionTopSignal.id === "continuation") {
      return perceptionTopSignal.direction === "buy" ? "BULL CONTINUATION" : "BEAR CONTINUATION";
    }
    if (perceptionTopSignal.id === "exhaustion") {
      return perceptionTopSignal.direction === "buy" ? "SELLERS EXHAUSTED" : "BUYERS EXHAUSTED";
    }
    return perceptionTopSignal.label.toUpperCase();
  })();
  const perceptionTargetLabel = (() => {
    const bracket = marketDecisionV1?.suggestedBracket || null;
    if (!bracket) {
      return "TARGET -> pending";
    }
    const liqSuffix = suggestedLiquidityExactTpMatch ? " (LIQ)" : "";
    return `TARGET -> ${bracket.tp.toFixed(chartPriceDigits)}${liqSuffix}`;
  })();
  const perceptionActionLabel = (() => {
    const bracket = marketDecisionV1?.suggestedBracket || null;
    if (!bracket) {
      return "WAIT CONFIRMATION";
    }
    return `${bracket.side === "buy" ? "BUY" : "SELL"} ABOVE ${bracket.entry.toFixed(chartPriceDigits)} · SL ${bracket.sl.toFixed(chartPriceDigits)} · TP ${bracket.tp.toFixed(chartPriceDigits)} · RR ${bracket.rr.toFixed(2)}`;
  })();
  const perceptionMotionClass = (() => {
    const signals = marketSignalV1?.signals || [];
    const hasTrap = signals.some((signal) => signal.id === "liquidity-trap");
    const hasAbsorption = signals.some((signal) => signal.id === "absorption");
    const hasImbalance = signals.some((signal) => signal.id === "imbalance");
    const hasExhaustion = signals.some((signal) => signal.id === "exhaustion");
    if (hasTrap) {
      return "trap";
    }
    if (hasAbsorption) {
      return "absorption";
    }
    if (hasImbalance) {
      return "imbalance";
    }
    if (hasExhaustion) {
      return "exhaustion";
    }
    return "calm";
  })();
  const perceptionReasonCode = perceptionTopSignal?.reasonCode || null;
  const compactPerceptionReasonLegendThreshold = signalDisplayMode === "ai-dominant"
    ? 80
    : signalDisplayMode === "augmented"
      ? 84
      : 999;
  const compactPerceptionReasonLegend = (signalConfidenceDrift === "UP" || signalConfidenceDrift === "FLAT")
    && (marketSignalV1?.directionalConfidencePct ?? 0) >= compactPerceptionReasonLegendThreshold;
  const perceptionReasonLegend = (() => {
    if (!perceptionReasonCode) {
      return null;
    }
    const normalizedCode = perceptionReasonCode.toUpperCase();
    if (normalizedCode.startsWith("EXH")) {
      return {
        line1: perceptionTopSignal?.direction === "buy" ? "sellers exhausted" : "buyers exhausted",
        line2: null as string | null,
      };
    }
    if (normalizedCode.startsWith("TRAP")) {
      return {
        line1: "liquidity trap active",
        line2: "avoid late chase",
      };
    }
    if (normalizedCode.startsWith("ABS")) {
      return {
        line1: "passive absorption",
        line2: compactPerceptionReasonLegend ? null : "breakout conviction weaker",
      };
    }
    if (normalizedCode.startsWith("IMB")) {
      return {
        line1: "aggressive imbalance",
        line2: compactPerceptionReasonLegend ? null : (perceptionTopSignal?.direction === "buy" ? "buyers in control" : "sellers in control"),
      };
    }
    if (normalizedCode.startsWith("CONT")) {
      return {
        line1: "continuation structure",
        line2: compactPerceptionReasonLegend ? null : "favor pullback entry",
      };
    }
    return {
      line1: "signal context",
      line2: normalizedCode,
    };
  })();
  const perceptionSetupReady = (() => {
    const signals = marketSignalV1?.signals || [];
    const hasImbalance = signals.some((signal) => signal.id === "imbalance");
    const hasAbsorptionOrTrap = signals.some((signal) => signal.id === "absorption" || signal.id === "liquidity-trap");
    return hasImbalance && Boolean(suggestedLiquidityHighlight) && hasAbsorptionOrTrap;
  })();
  const signalImbalance = (marketSignalV1?.signals || []).find((signal) => signal.id === "imbalance") || null;
  const signalAbsorption = (marketSignalV1?.signals || []).find((signal) => signal.id === "absorption") || null;
  const signalTrap = (marketSignalV1?.signals || []).find((signal) => signal.id === "liquidity-trap") || null;
  const signalContinuation = (marketSignalV1?.signals || []).find((signal) => signal.id === "continuation") || null;
  const signalExhaustion = (marketSignalV1?.signals || []).find((signal) => signal.id === "exhaustion") || null;
  const nearLiquidityForEntry = (() => {
    const bracket = marketDecisionV1?.suggestedBracket || null;
    if (!bracket || !suggestedLiquidityHighlight) {
      return false;
    }
    const threshold = Math.max(chartPriceStep * 10, Math.abs(activePricePre) * 0.0012);
    return Math.abs(suggestedLiquidityHighlight.level - bracket.entry) <= threshold;
  })();
  const momentumConfirmed = Boolean(
    signalImbalance
    && signalImbalance.confidence >= 0.62
    && (marketSignalV1?.dominantDirection || "neutral") !== "neutral",
  );
  const trapConfirm = Boolean(signalTrap && signalTrap.confidence >= 0.58);
  const absorptionBlock = Boolean(signalAbsorption && !signalContinuation);
  const continuationAligned = Boolean(
    signalContinuation
    && (marketDecisionV1?.biasDirection || "neutral") !== "neutral"
    && signalContinuation.direction === (marketDecisionV1?.biasDirection || "neutral"),
  );
  const absorptionAgainstPosition = Boolean(
    signalAbsorption
    && (marketDecisionV1?.biasDirection || "neutral") !== "neutral"
    && signalAbsorption.direction !== "neutral"
    && signalAbsorption.direction !== (marketDecisionV1?.biasDirection || "neutral"),
  );
  const trapOppositeBias = Boolean(
    signalTrap
    && (marketDecisionV1?.biasDirection || "neutral") !== "neutral"
    && signalTrap.direction !== "neutral"
    && signalTrap.direction !== (marketDecisionV1?.biasDirection || "neutral"),
  );
  const entryTimingV3 = (() => {
    const baseDirectional = clamp((marketSignalV1?.directionalConfidencePct || 50) / 100, 0.45, 0.95);
    if (momentumConfirmed && nearLiquidityForEntry) {
      return {
        status: "TRIGGER",
        tone: "good",
        detail: "momentum + liquidity",
        confidence: clamp((signalImbalance?.confidence || baseDirectional) * 0.75 + 0.17, 0.62, 0.93),
      };
    }
    if (absorptionBlock && trapConfirm) {
      return {
        status: "READY",
        tone: "warn",
        detail: "absorption + trap",
        confidence: clamp(((signalAbsorption?.confidence || 0.58) + (signalTrap?.confidence || 0.58)) / 2, 0.56, 0.89),
      };
    }
    return {
      status: "WAIT",
      tone: "neutral",
      detail: "await cleaner tape",
      confidence: clamp(baseDirectional * 0.72, 0.41, 0.68),
    };
  })();
  const tradeManagementV3 = (() => {
    const baseDirectional = clamp((marketSignalV1?.directionalConfidencePct || 50) / 100, 0.45, 0.95);
    if (absorptionAgainstPosition) {
      return {
        status: "EXIT NOW",
        tone: "bad",
        detail: "absorption against",
        confidence: clamp((signalAbsorption?.confidence || 0.62) * 0.9 + 0.08, 0.62, 0.94),
      };
    }
    if (signalExhaustion && signalExhaustion.confidence >= 0.6) {
      return {
        status: "REDUCE",
        tone: "warn",
        detail: "exhaustion detected",
        confidence: clamp(signalExhaustion.confidence * 0.9 + 0.04, 0.58, 0.9),
      };
    }
    if (continuationAligned) {
      return {
        status: "HOLD",
        tone: "good",
        detail: "continuation intact",
        confidence: clamp((signalContinuation?.confidence || baseDirectional) * 0.88 + 0.06, 0.57, 0.9),
      };
    }
    return {
      status: "NEUTRAL",
      tone: "neutral",
      detail: "no strong edge",
      confidence: clamp(baseDirectional * 0.7, 0.4, 0.7),
    };
  })();
  const intelligentExitV3 = (() => {
    const baseDirectional = clamp((marketSignalV1?.directionalConfidencePct || 50) / 100, 0.45, 0.95);
    const bracket = marketDecisionV1?.suggestedBracket || null;
    const targetHit = Boolean(
      bracket
      && (
        (bracket.side === "buy" && activePricePre >= bracket.tp)
        || (bracket.side === "sell" && activePricePre <= bracket.tp)
      ),
    );
    if (targetHit) {
      return {
        status: "TAKE PROFIT",
        tone: "good",
        detail: "target liquidity hit",
        confidence: clamp(baseDirectional * 0.9 + 0.07, 0.67, 0.95),
      };
    }
    if (signalExhaustion && signalConfidenceDrift === "DOWN") {
      return {
        status: "EXIT EARLY",
        tone: "warn",
        detail: "confidence fading",
        confidence: clamp(signalExhaustion.confidence * 0.86 + 0.08, 0.6, 0.9),
      };
    }
    if (trapOppositeBias) {
      return {
        status: "REVERSE",
        tone: "bad",
        detail: "opposite trap",
        confidence: clamp((signalTrap?.confidence || 0.62) * 0.9 + 0.08, 0.62, 0.93),
      };
    }
    return {
      status: "HOLD",
      tone: "neutral",
      detail: "structure still valid",
      confidence: clamp(baseDirectional * 0.74, 0.43, 0.74),
    };
  })();
  const confidencePillTone = (value: number): "high" | "low" | "mid" => {
    if (value >= 0.8) {
      return "high";
    }
    if (value <= 0.55) {
      return "low";
    }
    return "mid";
  };
  const trailingV3 = (() => {
    const trailingAtr = Math.max(chartPriceStep * 6, Math.max(activePricePre * Math.max(chartAtrLocalPct, 0.0012), chartPriceStep * 10));
    let multiplier = 1.2;
    if (continuationAligned || momentumConfirmed) {
      multiplier = 2.0;
    }
    if (signalExhaustion) {
      multiplier = 0.8;
    }
    const side = marketDecisionV1?.suggestedBracket?.side || ((marketDecisionV1?.biasDirection || "neutral") === "sell" ? "sell" : "buy");
    const stop = side === "buy"
      ? activePricePre - trailingAtr * multiplier
      : activePricePre + trailingAtr * multiplier;
    const status = multiplier >= 1.8 ? "LOOSE" : multiplier <= 0.9 ? "TIGHT" : "ACTIVE";
    const tone = multiplier >= 1.8 ? "good" : multiplier <= 0.9 ? "warn" : "neutral";
    return {
      status,
      tone,
      detail: `${side === "buy" ? "SL" : "BS"} ${stop.toFixed(chartPriceDigits)}`,
    };
  })();
  const autoMetaFilter = (() => {
    const directionalConfidencePct = marketSignalV1?.directionalConfidencePct || 50;
    const confidencePass = directionalConfidencePct >= 60;
    const confluenceScorePct = marketDecisionV1?.confluenceScorePct || 0;
    const scenario = marketDecisionV1?.scenario || "balance";
    const confluencePass = confluenceScorePct >= 50;
    const regimeChoppy = scenario === "balance" && confluenceScorePct < 58;
    const pass = confidencePass && confluencePass && !regimeChoppy;
    return {
      pass,
      confidencePass,
      confluencePass,
      regimeChoppy,
      qualityScore: clamp(
        (directionalConfidencePct / 100) * 0.45
        + (confluenceScorePct / 100) * 0.35
        + entryTimingV3.confidence * 0.2,
        0.35,
        0.96,
      ),
    };
  })();
  const autoRiskEngine = (() => {
    const maxDailyLossPct = 3;
    const killSwitchDrawdownPct = 5;
    const maxOpenTrades = 3;
    const maxExposurePct = 10;
    const dailyLossBreached = dailyDrawdownPct > maxDailyLossPct;
    const drawdownKillTriggered = dailyDrawdownPct > killSwitchDrawdownPct;
    const openTradesBreached = openTradesCount >= maxOpenTrades;
    const exposureBreached = exposureRatio > maxExposurePct / 100;
    const riskUsdBreached = chartRiskLossExceeded;
    const hardPass = !dailyLossBreached && !openTradesBreached && !exposureBreached && !riskUsdBreached;
    const killSwitchActive = autoExecutionKillSwitch || drawdownKillTriggered;
    return {
      hardPass,
      killSwitchActive,
      maxDailyLossPct,
      maxOpenTrades,
      maxExposurePct,
      dailyLossBreached,
      openTradesBreached,
      exposureBreached,
      riskUsdBreached,
      drawdownKillTriggered,
    };
  })();
  const autoSizingV3 = (() => {
    const atrAbs = Math.max(chartPriceStep * 6, Math.max(activePricePre * Math.max(chartAtrLocalPct, 0.0012), chartPriceStep * 10));
    const stopDistance = Math.max(chartPriceStep, atrAbs * 1.5);
    const riskPerTradeUsd = accountFreeUsd * 0.01;
    const rawSizeUnits = riskPerTradeUsd / Math.max(chartPriceStep, stopDistance);
    const confidenceSize = rawSizeUnits * autoMetaFilter.qualityScore;
    const notionalEstimate = confidenceSize * Math.max(activePricePre, chartPriceStep);
    const notionalCap = accountFreeUsd * 0.1;
    const finalNotional = clamp(notionalEstimate, chartPriceStep * 50, Math.max(chartPriceStep * 50, notionalCap));
    return {
      stopDistance,
      finalNotional,
      sizeUnits: confidenceSize,
    };
  })();
  const autoSessionGuard = (() => {
    const currentHour = new Date().getHours();
    const start = Math.max(0, Math.min(23, autoSessionStartHour));
    const end = Math.max(0, Math.min(23, autoSessionEndHour));
    const inWindow = start <= end
      ? currentHour >= start && currentHour <= end
      : currentHour >= start || currentHour <= end;
    return {
      currentHour,
      inWindow,
      pass: !autoSessionGuardEnabled || inWindow,
      label: `${start.toString().padStart(2, "0")}-${end.toString().padStart(2, "0")}`,
    };
  })();
  const autoSymbolLoss = (() => {
    const normalizedSymbol = normalizeInstrument(selectedChartSymbol);
    const cumulativeLossUsd = outcomes.reduce((sum, item) => {
      if (normalizeInstrument(instrumentLabel(item)) !== normalizedSymbol) {
        return sum;
      }
      const pnl = toNumber(item.pnl_usd, toNumber(item.net_result_usd, 0));
      return pnl < 0 ? sum + Math.abs(pnl) : sum;
    }, 0);
    const overCap = cumulativeLossUsd >= Math.max(50, autoSymbolLossCapUsd);
    const disabledAtIso = autoSymbolAutoDisabled[normalizedSymbol] || null;
    const localDisabled = Boolean(disabledAtIso);
    return {
      normalizedSymbol,
      cumulativeLossUsd,
      overCap,
      localDisabled,
      disabledAtIso,
      pass: !overCap && !localDisabled,
    };
  })();
  const autoEntryReady = entryTimingV3.status === "READY" || entryTimingV3.status === "TRIGGER";
  const autoExecutionGate = (() => {
    const ready = autoMetaFilter.pass
      && autoRiskEngine.hardPass
      && !autoRiskEngine.killSwitchActive
      && autoSessionGuard.pass
      && autoSymbolLoss.pass
      && autoEntryReady
      && Boolean(marketDecisionV1?.suggestedBracket)
      && !replayState.enabled;
    const autoState = autoRiskEngine.killSwitchActive
      ? "KILLED"
      : ready
        ? "READY"
        : "BLOCKED";
    return {
      ready,
      autoState,
      riskLabel: autoRiskEngine.hardPass ? "OK" : "BLOCKED",
      sizeLabel: `${autoSizingV3.finalNotional.toFixed(0)} USD`,
      ruleLabel: autoRiskEngine.killSwitchActive
        ? "kill switch"
        : !autoSessionGuard.pass
          ? `session ${autoSessionGuard.label}`
          : !autoSymbolLoss.pass
            ? "symbol loss cap"
            : autoMetaFilter.regimeChoppy
              ? "regime choppy"
              : autoMetaFilter.pass ? "meta pass" : "meta blocked",
    };
  })();
  const selfLearningScopedOutcomesV4 = useMemo(() => {
    const normalizedSymbol = normalizeInstrument(selectedChartSymbol);
    const readOutcomeTf = (item: JsonMap): string | null => {
      const raw = String(item.timeframe || item.chart_timeframe || item.strategy_timeframe || item.tf || "").trim();
      return raw === "1m" || raw === "5m" || raw === "15m" ? raw : null;
    };
    return filteredOutcomes
      .filter((item) => {
        if (normalizeInstrument(instrumentLabel(item)) !== normalizedSymbol) {
          return false;
        }
        const timeframe = readOutcomeTf(item);
        if (timeframe && timeframe !== chartTimeframe) {
          return false;
        }
        return Number.isFinite(toNumber(item.pnl_usd, toNumber(item.net_result_usd, NaN)));
      })
      .map((item) => {
        const timestampIso = String(item.closed_at || item.executed_at || item.filled_at || item.timestamp || item.created_at || new Date().toISOString());
        const timestampMs = Number.isFinite(Date.parse(timestampIso)) ? Date.parse(timestampIso) : 0;
        const pnl = toNumber(item.pnl_usd, toNumber(item.net_result_usd, 0));
        const score = clamp(toNumber(item.ai_score ?? item.score, 0.5), 0, 1);
        const regimeRaw = String(item.regime || item.market_regime || "").toLowerCase();
        return {
          key: String(item.id || item.trade_id || item.position_id || item.execution_id || `${timestampIso}:${pnl.toFixed(2)}`),
          timestampIso,
          timestampMs,
          pnl,
          score,
          win: pnl >= 0,
          mfe: Math.abs(toNumber(item.mfe_bps, 0)),
          mae: Math.abs(toNumber(item.mae_bps, 0)),
          regimeRaw,
          raw: item,
        };
      })
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .slice(0, 160);
  }, [chartTimeframe, filteredOutcomes, selectedChartSymbol]);
  const selfLearningDriftV4 = useMemo(() => {
    const samples = [...selfLearningScopedOutcomesV4].sort((a, b) => a.timestampMs - b.timestampMs);
    const shortWindow = samples.slice(-8);
    const longWindow = samples.slice(-24, -8);
    const calcWinrate = (windowItems: typeof samples) => (
      windowItems.length === 0 ? null : windowItems.filter((item) => item.win).length / windowItems.length
    );
    const calcBrier = (windowItems: typeof samples) => {
      if (windowItems.length === 0) {
        return null;
      }
      return average(windowItems.map((item) => (item.score - (item.win ? 1 : 0)) ** 2));
    };
    const shortWinrate = calcWinrate(shortWindow);
    const longWinrate = calcWinrate(longWindow);
    const shortBrier = calcBrier(shortWindow);
    const longBrier = calcBrier(longWindow);
    const winrateDrop = shortWinrate !== null && longWinrate !== null ? Math.max(0, longWinrate - shortWinrate) : 0;
    const brierRise = shortBrier !== null && longBrier !== null ? Math.max(0, shortBrier - longBrier) : 0;
    const shortLossCount = shortWindow.filter((item) => !item.win).length;
    const enoughSamples = shortWindow.length >= 6 && longWindow.length >= 10;
    const severeDeterioration = shortLossCount >= 6 || (winrateDrop >= 0.2 && brierRise >= 0.04) || brierRise >= 0.1;
    const moderateDeterioration = winrateDrop >= 0.14 && brierRise >= 0.03;
    const shouldDemote = enoughSamples && (severeDeterioration || moderateDeterioration);
    const latestKey = shortWindow[shortWindow.length - 1]?.key || "na";
    const signature = [latestKey, shortLossCount, Math.round(winrateDrop * 100), Math.round(brierRise * 1000)].join(":");
    return {
      shortSamples: shortWindow.length,
      longSamples: longWindow.length,
      shortWinratePct: shortWinrate !== null ? shortWinrate * 100 : 0,
      longWinratePct: longWinrate !== null ? longWinrate * 100 : 0,
      winrateDropPct: winrateDrop * 100,
      shortBrier,
      longBrier,
      brierRise,
      shortLossCount,
      enoughSamples,
      shouldDemote,
      signature,
    };
  }, [selfLearningScopedOutcomesV4]);
  const selfLearningV4DriftLabel = selfLearningDriftV4.shouldDemote ? "DRIFT" : selfLearningDriftV4.enoughSamples ? "STABLE" : "WARMUP";
  const selfLearningV4Active = selfLearningV4Enabled && selfLearningScopedOutcomesV4.length >= 4;
  const selfLearningV4WeightsLabel = selfLearningAutoAdaptEnabled ? "ADAPTED" : "MANUAL";
  const selfLearningV4ModelLabel = selfLearningModelUpdatedAt ? "UPDATED" : "BOOTING";
  const suggestedBracketOverlay = (() => {
    const bracket = marketDecisionV1?.suggestedBracket;
    if (!bracket) {
      return null;
    }
    const stageHeight = chartStageRef.current?.clientHeight || 500;
    const entryY = chartPriceToY(bracket.entry, stageHeight);
    const slY = chartPriceToY(bracket.sl, stageHeight);
    const tpY = chartPriceToY(bracket.tp, stageHeight);
    const liquidityY = suggestedLiquidityHighlight ? chartPriceToY(suggestedLiquidityHighlight.level, stageHeight) : null;
    return {
      entryY,
      slY,
      tpY,
      liquidityY,
      rewardTop: Math.min(entryY, tpY),
      rewardHeight: Math.max(2, Math.abs(tpY - entryY)),
      riskTop: Math.min(entryY, slY),
      riskHeight: Math.max(2, Math.abs(slY - entryY)),
    };
  })();

  const snapChartOrderPrice = (rawPrice: number, line: ChartOrderLineKey, current: ChartOrderTicket): { price: number; label: string; family: ChartSnapFamily } => {
    const clampedRawPrice = Math.max(chartPriceRangeMin, Math.min(chartPriceRangeMax, rawPrice));
    const stepPrice = quantizePriceToStep(clampedRawPrice, chartPriceStep);
    if (!chartSnapEnabled) {
      return { price: stepPrice, label: `STEP ${chartPriceStep.toFixed(chartPriceDigits)}`, family: "manual" };
    }

    const roundPrice = quantizePriceToStep(Math.round(clampedRawPrice / chartRoundMagnetStep) * chartRoundMagnetStep, chartPriceStep);
    const executionCandidates: Array<{ price: number; label: string }> = [
      { price: quantizePriceToStep(chartAnchorPrice, chartPriceStep), label: "LIVE" },
      { price: roundPrice, label: `ROUND ${roundPrice.toFixed(chartPriceDigits)}` },
    ];
    if (chartMode === "candles" && chartCandles.length > 0) {
      for (const candle of chartCandles.slice(-36)) {
        executionCandidates.push(
          { price: quantizePriceToStep(candle.close, chartPriceStep), label: "CLOSE" },
          { price: quantizePriceToStep(candle.high, chartPriceStep), label: "HIGH" },
          { price: quantizePriceToStep(candle.low, chartPriceStep), label: "LOW" },
        );
      }
    }
    const vwapCandidates: Array<{ price: number; label: string }> = [];
    const liquidityCandidates: Array<{ price: number; label: string }> = [];
    if (showVwap) {
      vwapCandidates.push(
        { price: quantizePriceToStep(dayVwap, chartPriceStep), label: "VWAP D" },
        { price: quantizePriceToStep(weekVwap, chartPriceStep), label: "VWAP W" },
        { price: quantizePriceToStep(monthVwap, chartPriceStep), label: "VWAP M" },
      );
    }
    if (showLiquidity) {
      for (const zone of liquidityZones) {
        liquidityCandidates.push({ price: quantizePriceToStep(zone.level, chartPriceStep), label: zone.label.toUpperCase() });
      }
    }
    if (crosshair?.price) {
      executionCandidates.push({ price: quantizePriceToStep(crosshair.price, chartPriceStep), label: "CURSOR" });
    }

    const candidateGroups: Record<ChartSnapPriority, Array<{ price: number; label: string }>> = {
      execution: executionCandidates,
      vwap: vwapCandidates,
      liquidity: liquidityCandidates,
    };
    const priorityOrder: ChartSnapPriority[] = [
      chartSnapPriority,
      ...(["execution", "vwap", "liquidity"] as const).filter((key) => key !== chartSnapPriority),
    ];

    let snapped = stepPrice;
    let label = `STEP ${chartPriceStep.toFixed(chartPriceDigits)}`;
    let family: ChartSnapFamily = "manual";
    const atrWeight = clamp(1.16 - chartAtrLocalPct * 40, 0.52, 1.14);
    const lineWeight = line === "entry" ? 0.9 : 1;
    const adaptiveSnapThreshold = chartSnapThreshold * atrWeight * lineWeight;

    for (const groupName of priorityOrder) {
      let bestDistance = Number.POSITIVE_INFINITY;
      let groupWinner: { price: number; label: string } | null = null;
      for (const candidate of candidateGroups[groupName]) {
        if (!Number.isFinite(candidate.price) || candidate.price <= 0) {
          continue;
        }
        if (line !== "entry" && Math.abs(candidate.price - current.entry) < chartPriceStep) {
          continue;
        }
        const distance = Math.abs(clampedRawPrice - candidate.price);
        if (distance <= adaptiveSnapThreshold && distance < bestDistance) {
          groupWinner = candidate;
          bestDistance = distance;
        }
      }
      if (groupWinner) {
        snapped = groupWinner.price;
        label = groupWinner.label;
        family = groupName;
        break;
      }
    }
    return { price: snapped, label, family };
  };

  const moveChartOrderLine = (current: ChartOrderTicket, line: ChartOrderLineKey, rawPrice: number): ChartOrderTicket => {
    const snapped = snapChartOrderPrice(rawPrice, line, current);
    const referencePrice = Math.max(0.0000001, current.entry || chartAnchorPrice || chartLastValue || 1);
    const minGap = Math.max(chartPriceStep * 2, referencePrice * 0.0004);
    const next: ChartOrderTicket = { ...current, preset: "custom" };

    if (line === "entry") {
      const delta = snapped.price - current.entry;
      next.entry = snapped.price;
      next.sl = current.sl + delta;
      next.tp = current.tp + delta;
    } else {
      next[line] = snapped.price;
    }

    next.entry = Math.max(chartPriceStep, quantizePriceToStep(next.entry, chartPriceStep));
    next.sl = Math.max(chartPriceStep, quantizePriceToStep(next.sl, chartPriceStep));
    next.tp = Math.max(chartPriceStep, quantizePriceToStep(next.tp, chartPriceStep));

    if (next.side === "buy") {
      if (next.sl >= next.entry - minGap) {
        next.sl = quantizePriceToStep(next.entry - minGap, chartPriceStep);
      }
      if (next.tp <= next.entry + minGap) {
        next.tp = quantizePriceToStep(next.entry + minGap, chartPriceStep);
      }
    } else {
      if (next.sl <= next.entry + minGap) {
        next.sl = quantizePriceToStep(next.entry + minGap, chartPriceStep);
      }
      if (next.tp >= next.entry - minGap) {
        next.tp = quantizePriceToStep(next.entry - minGap, chartPriceStep);
      }
    }

    chartOrderTicketRef.current = next;
    if (snapped.family !== "manual") {
      triggerChartHaptic(`${snapped.label}:${snapped.price.toFixed(chartPriceDigits)}`);
      setChartSnapPulseLine(line);
    }
    chartSnapStateRef.current = { label: snapped.label, price: snapped.price, family: snapped.family };
    setChartSnapState(chartSnapStateRef.current);
    return next;
  };

  const clearChartLongPressTimer = () => {
    if (chartLongPressTimerRef.current !== null) {
      window.clearTimeout(chartLongPressTimerRef.current);
      chartLongPressTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!chartSnapPulseLine) {
      return;
    }
    const timer = window.setTimeout(() => setChartSnapPulseLine(null), 240);
    return () => {
      window.clearTimeout(timer);
    };
  }, [chartSnapPulseLine]);

  useEffect(() => {
    if (!chartReleaseValidationPulse) {
      return;
    }
    const timer = window.setTimeout(() => setChartReleaseValidationPulse(false), 380);
    return () => {
      window.clearTimeout(timer);
    };
  }, [chartReleaseValidationPulse]);

  const triggerChartHaptic = (signature: string, pattern?: number | number[]) => {
    if (chartHapticMode === "off") {
      return;
    }
    if (chartSnapHapticSignatureRef.current === signature) {
      return;
    }
    chartSnapHapticSignatureRef.current = signature;
    const resolvedPattern = pattern ?? (chartHapticMode === "medium" ? [16, 30, 16] : 12);
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(resolvedPattern);
    }
  };

  const openChartReleaseTicket = (line: ChartOrderLineKey, snapLabel: string, fineMode: boolean) => {
    const rectHeight = chartStageRef.current?.clientHeight || 500;
    const top = Math.max(14, Math.min(rectHeight - 132, chartPriceToY(chartOrderTicketRef.current[line], rectHeight) - 38));
    setChartReleaseTicket({
      line,
      top,
      price: chartOrderTicketRef.current[line],
      snapLabel,
      fineMode,
      armed: false,
    });
  };

  const beginChartOrderDrag = (event: React.PointerEvent<HTMLDivElement | HTMLButtonElement>, line: ChartOrderLineKey, forceFineMode = false) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = chartStageRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    clearChartLongPressTimer();
    chartSnapHapticSignatureRef.current = "";
    setChartReleaseTicket(null);
    setChartActiveSnapLine(line);
    const nextDrag: ChartDragState = {
      line,
      rectTop: rect.top,
      rectHeight: rect.height,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startPrice: chartOrderTicketRef.current[line],
      fineMode: forceFineMode,
      moved: false,
    };
    chartOrderDragRef.current = nextDrag;
    if ((event.pointerType === "touch" || event.pointerType === "pen") && !forceFineMode) {
      const holdThresholdMs = chartLongPressThresholdMs(event.pointerType);
      chartLongPressTimerRef.current = window.setTimeout(() => {
        const activeDrag = chartOrderDragRef.current;
        if (activeDrag && activeDrag.pointerId === event.pointerId) {
          activeDrag.fineMode = true;
          triggerChartHaptic(`fine:${line}`, [8, 24, 8]);
          chartSnapStateRef.current = { label: "FINE", price: chartOrderTicketRef.current[line], family: "manual" };
          setChartSnapState(chartSnapStateRef.current);
        }
      }, holdThresholdMs);
    } else {
      chartSnapStateRef.current = forceFineMode ? { label: "FINE", price: chartOrderTicketRef.current[line], family: "manual" } : null;
      setChartSnapState(chartSnapStateRef.current);
    }
  };

  useEffect(() => {
    if (chartOrderTicket.entry > 0 && chartOrderTicket.active) {
      return;
    }
    if (chartAnchorPrice <= 0) {
      return;
    }
    applyChartOrderPreset(chartOrderTicket.preset === "custom" ? "scalp" : chartOrderTicket.preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartAnchorPrice, selectedChartSymbol]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = chartOrderDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const y = Math.max(0, Math.min(drag.rectHeight, event.clientY - drag.rectTop));
      const rawPrice = chartYToPrice(y, drag.rectHeight);
      const adjustedPrice = drag.fineMode
        ? drag.startPrice + (rawPrice - drag.startPrice) * 0.28
        : rawPrice;
      drag.moved = true;
      clearChartLongPressTimer();
      setChartOrderTicket((current) => moveChartOrderLine(current, drag.line, adjustedPrice));
    };
    const onUp = (event: PointerEvent) => {
      const drag = chartOrderDragRef.current;
      if (drag && drag.pointerId !== event.pointerId) {
        return;
      }
      clearChartLongPressTimer();
      if (drag?.moved) {
        openChartReleaseTicket(drag.line, chartSnapStateRef.current?.label || (drag.fineMode ? "FINE" : "MANUAL"), drag.fineMode);
      }
      chartOrderDragRef.current = null;
      chartSnapHapticSignatureRef.current = "";
      chartSnapStateRef.current = null;
      setChartActiveSnapLine(null);
      setChartSnapState(null);
    };
    const onCancel = () => {
      clearChartLongPressTimer();
      chartOrderDragRef.current = null;
      chartSnapHapticSignatureRef.current = "";
      chartSnapStateRef.current = null;
      setChartActiveSnapLine(null);
      setChartSnapState(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [chartPriceDigits, chartPriceRangeMax, chartPriceRangeMin, chartPriceStep, chartRoundMagnetStep, chartSnapEnabled, chartSnapThreshold, chartAnchorPrice, chartLastValue, crosshair, showLiquidity, showVwap, dayVwap, weekVwap, monthVwap, liquidityZones, chartSnapState]);
  const tape = nativeTrades.length > 0 ? buildTapeFromTrades(nativeTrades, chartTimeframe) : buildTape(chartSeries, chartTimeframe);
  const footprintRows = ohlcvBars.length > 0 ? buildFootprintFromOhlcv(ohlcvBars, chartTimeframe) : buildFootprint(chartSeries);
  const domLevels = marketDepth ? buildDomLevelsFromDepth(marketDepth) : buildDomLevels(orderbook);
  const domDisplayLevels = domLevels.slice(0, 14);
  const buyLevels = domLevels.filter((level) => level.side === "bid");
  const sellLevels = domLevels.filter((level) => level.side === "ask");
  const heatmapLevels = [...[...sellLevels].reverse(), ...buyLevels].slice(0, 20);
  const tapeByTimeKey = tape.reduce((acc, entry) => {
    if (entry.timeKey) {
      acc.set(entry.timeKey, [...(acc.get(entry.timeKey) || []), entry]);
    }
    return acc;
  }, new Map<string, TapePrint[]>());
  const footprintByTimeKey = footprintRows.reduce((acc, entry) => {
    if (entry.timeKey) {
      acc.set(entry.timeKey, [...(acc.get(entry.timeKey) || []), entry]);
    }
    return acc;
  }, new Map<string, FootprintRow[]>());
  const depthPayload = (marketDepth?.depth_payload as JsonMap | undefined) || {};
  const depthEventTime = toNumber(depthPayload.event_time, 0);
  const depthSnapshotAt = String(marketDepth?.snapshot_at || "");
  const depthTimeKey = depthEventTime > 0
    ? toTimeBucketKey(depthEventTime, chartTimeframe)
    : depthSnapshotAt
      ? toTimeBucketKey(depthSnapshotAt, chartTimeframe)
      : "";
  const replayBufferKey = `${selectedChartSymbol}:${chartTimeframe}`;

  useEffect(() => {
    const nextFramesByKey = chartSeries
      .map((point) => ({
        timeKey: toTimeBucketKey(point.label, chartTimeframe),
        timeLabel: formatClock(point.label),
        quoteValue: point.value,
      }))
      .filter((frame) => frame.timeKey);

    setReplayBuffers((current) => {
      const existing = current[replayBufferKey] || [];
      const frameMap = new Map<string, ReplayFrame>(existing.map((frame) => [frame.timeKey, { ...frame }]));

      for (const frame of nextFramesByKey) {
        const currentFrame = frameMap.get(frame.timeKey) || { timeKey: frame.timeKey, timeLabel: frame.timeLabel };
        currentFrame.timeLabel = frame.timeLabel;
        currentFrame.quoteValue = frame.quoteValue;
        if (tapeByTimeKey.has(frame.timeKey)) {
          currentFrame.tapeEvents = (tapeByTimeKey.get(frame.timeKey) || []).slice(0, 12);
        }
        if (footprintByTimeKey.has(frame.timeKey)) {
          currentFrame.footprintRows = (footprintByTimeKey.get(frame.timeKey) || []).slice(0, 8);
        }
        frameMap.set(frame.timeKey, currentFrame);
      }

      if (depthTimeKey) {
        const depthFrame = frameMap.get(depthTimeKey) || { timeKey: depthTimeKey, timeLabel: formatTimeKeyLabel(depthTimeKey) };
        depthFrame.domLevels = domDisplayLevels.slice(0, 14);
        depthFrame.heatmapLevels = heatmapLevels.slice(0, 20);
        frameMap.set(depthTimeKey, depthFrame);
      }

      const nextFrames = [...frameMap.values()]
        .sort((left, right) => Number(left.timeKey) - Number(right.timeKey))
        .slice(-320);

      const unchanged = existing.length === nextFrames.length
        && existing.every((frame, index) => {
          const next = nextFrames[index];
          if (!next) {
            return false;
          }
          return frame.timeKey === next.timeKey
            && frame.timeLabel === next.timeLabel
            && frame.quoteValue === next.quoteValue
            && (frame.tapeEvents?.length || 0) === (next.tapeEvents?.length || 0)
            && (frame.footprintRows?.length || 0) === (next.footprintRows?.length || 0)
            && (frame.domLevels?.length || 0) === (next.domLevels?.length || 0)
            && (frame.heatmapLevels?.length || 0) === (next.heatmapLevels?.length || 0);
        });

      if (unchanged) {
        return current;
      }

      return { ...current, [replayBufferKey]: nextFrames };
    });
  }, [chartSeries, chartTimeframe, depthTimeKey, domDisplayLevels, footprintByTimeKey, heatmapLevels, replayBufferKey, tapeByTimeKey]);

  const replayFrames = replayBuffers[replayBufferKey] || [];
  const replayMaxIndex = Math.max(0, replayFrames.length - 1);
  const frameIndexByTimeKey = replayFrames.reduce((acc, frame, index) => {
    acc.set(frame.timeKey, index);
    return acc;
  }, new Map<string, number>());

  const resolveFrameIndexForEvent = (timeKey: string): number => {
    const exact = frameIndexByTimeKey.get(timeKey);
    if (typeof exact === "number") {
      return exact;
    }
    if (replayFrames.length === 0) {
      return 0;
    }
    const target = Number(timeKey);
    if (!Number.isFinite(target)) {
      return replayMaxIndex;
    }
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < replayFrames.length; index += 1) {
      const candidate = Number(replayFrames[index].timeKey);
      const distance = Math.abs(candidate - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return bestIndex;
  };

  const replayEventMarkers = (() => {
    const markers: ReplayEventMarker[] = [];

    for (const [index, item] of replayTimeline.entries()) {
      const timeKey = toTimeBucketKey(item.timestamp, chartTimeframe);
      if (!timeKey) {
        continue;
      }
      const lower = item.label.toLowerCase();
      const kind = lower.includes("intent")
        ? "intent"
        : lower.includes("approval") || lower.includes("broker")
          ? "approval"
          : lower.includes("fill")
            ? "fill"
            : lower.includes("routing")
              ? "routing"
              : "other";
      markers.push({
        id: `timeline-${index}-${timeKey}`,
        label: item.label,
        kind,
        timeKey,
        frameIndex: resolveFrameIndexForEvent(timeKey),
        critical: false,
        detail: `${item.label} ${formatClock(item.timestamp)}`,
      });
    }

    for (const [index, fill] of replayFills.slice(0, 12).entries()) {
      const fillTime = String(fill.traded_at || fill.created_at || "");
      const timeKey = toTimeBucketKey(fillTime, chartTimeframe);
      if (!timeKey) {
        continue;
      }
      const venue = String(fill.venue || "venue");
      markers.push({
        id: `fill-${index}-${timeKey}`,
        label: "Fill",
        kind: "fill",
        timeKey,
        frameIndex: resolveFrameIndexForEvent(timeKey),
        critical: false,
        detail: `${venue} ${toNumber(fill.price, 0).toFixed(2)} ${toNumber(fill.size, 0).toFixed(3)}`,
      });
    }

    for (const [index, approval] of pendingLive.slice(0, 10).entries()) {
      const approvalTs = pickTimestamp(approval, ["approved_at", "created_at", "submitted_at", "timestamp"]);
      const timeKey = toTimeBucketKey(approvalTs, chartTimeframe);
      if (!timeKey) {
        continue;
      }
      markers.push({
        id: `approval-${index}-${timeKey}`,
        label: "Approval",
        kind: "approval",
        timeKey,
        frameIndex: resolveFrameIndexForEvent(timeKey),
        critical: false,
        detail: String(approval.approval_id || approval.id || "approval"),
      });
    }

    for (const [index, incident] of incidents.slice(0, 16).entries()) {
      const incidentTs = pickTimestamp(incident, ["created_at", "opened_at", "updated_at", "timestamp"]);
      const timeKey = toTimeBucketKey(incidentTs, chartTimeframe);
      if (!timeKey) {
        continue;
      }
      const severity = incidentSeverityLabel(incident);
      const critical = incidentSeverityRank(incident) >= 4 || Boolean(incident.sla_breached);
      markers.push({
        id: `incident-${index}-${timeKey}`,
        label: "Incident",
        kind: "incident",
        timeKey,
        frameIndex: resolveFrameIndexForEvent(timeKey),
        critical,
        detail: `${String(incident.ticket_key || "incident")} ${severity}`,
      });
    }

    // ── OUTCOME markers ─────────────────────────────────────────────────
    for (const [index, outcome] of filteredOutcomes.slice(0, 15).entries()) {
      const outcomeTs = pickTimestamp(outcome, ["executed_at", "filled_at", "closed_at", "created_at"]);
      const timeKey = toTimeBucketKey(outcomeTs, chartTimeframe);
      if (!timeKey) {
        continue;
      }
      const pnl = toNumber(outcome.pnl_usd, NaN);
      const pnlPct = toNumber(outcome.pnl_pct, 0);
      const pnlSign = Number.isFinite(pnl) ? (pnl >= 0 ? "+" : "") : "";
      const label = Number.isFinite(pnl) ? `${pnlSign}${pnl.toFixed(0)}$` : "PnL";
      markers.push({
        id: `outcome-${index}-${timeKey}`,
        label,
        kind: "outcome",
        timeKey,
        frameIndex: resolveFrameIndexForEvent(timeKey),
        critical: Number.isFinite(pnl) && pnl < -500,
        detail: `${instrumentLabel(outcome)} ${pnlSign}${pnlPct.toFixed(2)}% MAE:${toNumber(outcome.mae_bps, 0).toFixed(0)}bps MFE:${toNumber(outcome.mfe_bps, 0).toFixed(0)}bps`,
      });
    }

    return markers
      .filter((marker, index, rows) => rows.findIndex((candidate) => candidate.id === marker.id) === index)
      .sort((left, right) => left.frameIndex - right.frameIndex)
      .slice(0, 60);
  })();

  const criticalReplayFrameIndexes = replayEventMarkers
    .filter((marker) => marker.critical)
    .map((marker) => marker.frameIndex);
  const criticalReplayFrameSet = new Set<number>(criticalReplayFrameIndexes);
  const criticalReplayFrameKey = criticalReplayFrameIndexes.join(",");

  const visibleReplayMarkers = replayEventMarkers.filter((m) => {
    if (replayFilterCritical && !m.critical) return false;
    if (replayFilterKinds.length > 0 && !replayFilterKinds.includes(m.kind)) return false;
    return true;
  });
  const toggleReplayFilterKind = (kind: string) =>
    setReplayFilterKinds((prev) => prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]);

  useEffect(() => {
    if (replayFrames.length === 0) {
      if (replayState.enabled || replayState.playing || replayState.cursorIndex !== 0 || replayState.timeKey) {
        setReplayState((current) => ({ ...current, enabled: false, playing: false, cursorIndex: 0, timeKey: null }));
      }
      return;
    }

    if (!replayState.enabled) {
      return;
    }

    const nextIndex = clampIndex(replayState.cursorIndex, replayMaxIndex);
    const nextTimeKey = replayFrames[nextIndex]?.timeKey || null;
    if (nextIndex !== replayState.cursorIndex || nextTimeKey !== replayState.timeKey) {
      setReplayState((current) => ({ ...current, cursorIndex: nextIndex, timeKey: nextTimeKey }));
    }
  }, [replayFrames, replayMaxIndex, replayState.cursorIndex, replayState.enabled, replayState.playing, replayState.timeKey]);

  useEffect(() => {
    if (!replayState.enabled || !replayState.playing || replayFrames.length === 0) {
      return;
    }

    const intervalMs = Math.max(125, Math.floor(1000 / replayState.speed));
    const timer = window.setInterval(() => {
      setReplayState((current) => {
        const maxIndex = Math.max(0, replayFrames.length - 1);
        const nextIndex = clampIndex(current.cursorIndex + 1, maxIndex);
        const reachedEnd = nextIndex >= maxIndex;
        const reachedCritical = criticalReplayFrameSet.has(nextIndex);
        return {
          ...current,
          cursorIndex: nextIndex,
          timeKey: replayFrames[nextIndex]?.timeKey || current.timeKey,
          playing: reachedEnd || reachedCritical ? false : current.playing,
        };
      });
    }, intervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [criticalReplayFrameKey, replayFrames, replayState.enabled, replayState.playing, replayState.speed]);

  const liveTimeKey = depthTimeKey || (chartSeries.length > 0 ? toTimeBucketKey(chartSeries[chartSeries.length - 1].label, chartTimeframe) : "");
  const crosshairTimeKey = crosshair?.timeKey || "";
  const replayTimeKey = replayState.enabled ? replayState.timeKey || "" : "";
  const activeTimeKey = replayState.enabled ? replayTimeKey : (crosshairTimeKey || liveTimeKey);
  const replayFrame = replayState.enabled && replayFrames.length > 0
    ? replayFrames[clampIndex(replayState.cursorIndex, replayMaxIndex)] || null
    : null;
  const activeDomLevels = replayState.enabled
    ? (replayFrame?.domLevels || [])
    : domDisplayLevels;
  const activeHeatmapLevels = replayState.enabled
    ? (replayFrame?.heatmapLevels || [])
    : heatmapLevels;
  const activeFootprintRows = replayState.enabled
    ? (replayFrame?.footprintRows || [])
    : footprintRows.slice(0, 8);
  const activeTape = replayState.enabled
    ? (replayFrame?.tapeEvents || [])
    : tape.slice(0, 12);
  const activePrice = replayState.enabled
    ? toNumber(replayFrame?.quoteValue, chartLastValue)
    : (crosshair?.price ?? chartLastValue);
  var marketSignalV1 = useMemo<MarketSignalSnapshot>(() => {
    const calibration = resolveSignalCalibration(selectedChartSymbol, chartTimeframe);
    const bidDepth = activeDomLevels
      .filter((level) => level.side === "bid")
      .reduce((sum, level) => sum + Math.max(0, level.size), 0);
    const askDepth = activeDomLevels
      .filter((level) => level.side === "ask")
      .reduce((sum, level) => sum + Math.max(0, level.size), 0);
    const domImbalanceRatio = (bidDepth + 1) / (askDepth + 1);

    const footprintBuy = activeFootprintRows.reduce((sum, row) => sum + Math.max(0, row.buyVolume), 0);
    const footprintSell = activeFootprintRows.reduce((sum, row) => sum + Math.max(0, row.sellVolume), 0);
    const footprintTotal = footprintBuy + footprintSell;
    const footprintDelta = footprintBuy - footprintSell;
    const deltaRatio = footprintTotal > 0 ? Math.abs(footprintDelta) / footprintTotal : 0;

    const recentPoints = chartSeries.slice(-8);
    const firstRecent = recentPoints[0]?.value ?? activePrice;
    const lastRecent = recentPoints[recentPoints.length - 1]?.value ?? activePrice;
    const recentMove = lastRecent - firstRecent;
    const recentMovePct = firstRecent > 0 ? Math.abs(recentMove) / firstRecent : 0;
    const lowDisplacementThreshold = Math.max(calibration.absorptionMovePctMax, chartAtrLocalPct * 0.36);
    const continuationThreshold = Math.max(calibration.continuationMovePctMin, chartAtrLocalPct * 0.46);

    const lastCandle = chartCandles[chartCandles.length - 1];
    const prevCandle = chartCandles[chartCandles.length - 2];

    const aboveLiquidity = liquidityZones
      .filter((zone) => zone.level > activePrice)
      .sort((a, b) => a.level - b.level)[0] || null;
    const belowLiquidity = liquidityZones
      .filter((zone) => zone.level < activePrice)
      .sort((a, b) => b.level - a.level)[0] || null;
    const nearestLiquidityDistance = Math.min(
      aboveLiquidity ? Math.abs(aboveLiquidity.level - activePrice) : Number.POSITIVE_INFINITY,
      belowLiquidity ? Math.abs(activePrice - belowLiquidity.level) : Number.POSITIVE_INFINITY,
    );
    const nearKeyLevel = Number.isFinite(nearestLiquidityDistance)
      && nearestLiquidityDistance <= Math.max(chartPriceStep * 8, activePrice * 0.0008);
    const deltaOppositePrice = Math.sign(footprintDelta) !== 0 && Math.sign(recentMove) !== 0
      && Math.sign(footprintDelta) !== Math.sign(recentMove);
    const stackedImbalanceStrength = Math.max(0, Math.abs(Math.log(domImbalanceRatio)) - Math.log(Math.max(1.0001, calibration.imbalanceRatio)));

    const signals: MarketSignalEvent[] = [];

    if (domImbalanceRatio >= calibration.imbalanceRatio) {
      signals.push({
        id: "imbalance",
        label: "Strong Buy Pressure",
        detail: `bid/ask ${domImbalanceRatio.toFixed(2)}x`,
        reasonCode: "IMB↑",
        direction: "buy",
        severity: "warn",
        confidence: clamp((domImbalanceRatio - calibration.imbalanceRatio) / calibration.imbalanceRatio, 0.45, 1),
      });
    } else if (domImbalanceRatio <= 1 / calibration.imbalanceRatio) {
      signals.push({
        id: "imbalance",
        label: "Strong Sell Pressure",
        detail: `ask/bid ${(1 / Math.max(domImbalanceRatio, 0.0001)).toFixed(2)}x`,
        reasonCode: "IMB↓",
        direction: "sell",
        severity: "warn",
        confidence: clamp(((1 / Math.max(domImbalanceRatio, 0.0001)) - calibration.imbalanceRatio) / calibration.imbalanceRatio, 0.45, 1),
      });
    }

    const hasAbsorption = footprintTotal > 0 && deltaRatio >= calibration.absorptionDeltaRatio && recentMovePct <= lowDisplacementThreshold;
    if (hasAbsorption) {
      const absorptionDirection: MarketSignalDirection = footprintDelta >= 0 ? "sell" : "buy";
      const absorptionContextBoost =
        (nearKeyLevel ? 0.12 : 0)
        + (deltaOppositePrice ? 0.1 : 0)
        + Math.min(0.08, stackedImbalanceStrength * 0.22);
      const absorptionConfidence = clamp(
        (deltaRatio - calibration.absorptionDeltaRatio) / 0.24 + absorptionContextBoost,
        0.5,
        1,
      );
      signals.push({
        id: "absorption",
        label: absorptionDirection === "sell" ? "Seller Absorbing V2" : "Buyer Absorbing V2",
        detail: `delta ${footprintDelta >= 0 ? "+" : ""}${footprintDelta.toFixed(0)} / move ${(recentMovePct * 100).toFixed(2)}%${nearKeyLevel ? " · key level" : ""}${deltaOppositePrice ? " · divergence" : ""}`,
        reasonCode: deltaOppositePrice ? "ABS↔" : absorptionDirection === "buy" ? "ABS↑" : "ABS↓",
        direction: absorptionDirection,
        severity: "critical",
        confidence: absorptionConfidence,
      });
    }

    const brokeAbove = Boolean(aboveLiquidity && lastCandle && lastCandle.high > aboveLiquidity.level * (1 + calibration.breakoutPct));
    const brokeBelow = Boolean(belowLiquidity && lastCandle && lastCandle.low < belowLiquidity.level * (1 - calibration.breakoutPct));
    const absorptionSignal = signals.find((signal) => signal.id === "absorption") || null;
    if (absorptionSignal && brokeAbove && absorptionSignal.direction === "sell") {
      signals.push({
        id: "fake-breakout",
        label: "Fake Breakout Up",
        detail: `break above ${aboveLiquidity?.level.toFixed(2) || "level"} then absorb`,
        reasonCode: "TRAP!",
        direction: "sell",
        severity: "critical",
        confidence: clamp(absorptionSignal.confidence + 0.12, 0.55, 1),
      });
    } else if (absorptionSignal && brokeBelow && absorptionSignal.direction === "buy") {
      signals.push({
        id: "fake-breakout",
        label: "Fake Breakout Down",
        detail: `break below ${belowLiquidity?.level.toFixed(2) || "level"} then absorb`,
        reasonCode: "TRAP!",
        direction: "buy",
        severity: "critical",
        confidence: clamp(absorptionSignal.confidence + 0.12, 0.55, 1),
      });
    }

    if (lastCandle && prevCandle && aboveLiquidity) {
      const sweptAbove = lastCandle.high > aboveLiquidity.level * (1 + calibration.trapSweepPct);
      const rejectedAbove = lastCandle.close < aboveLiquidity.level && prevCandle.close <= aboveLiquidity.level * (1 + calibration.breakoutPct * 0.82);
      const rejectionMovePct = lastCandle.high > 0 ? Math.abs((lastCandle.high - lastCandle.close) / lastCandle.high) : 0;
      const fastRejection = rejectionMovePct >= Math.max(chartAtrLocalPct * 0.26, calibration.breakoutPct * 0.9);
      const absorptionAfterBreakout = Boolean(absorptionSignal && absorptionSignal.direction === "sell");
      if (sweptAbove && rejectedAbove) {
        signals.push({
          id: "liquidity-trap",
          label: "Liquidity Trap Above V2",
          detail: `sweep ${aboveLiquidity.level.toFixed(2)} then reject${fastRejection ? " fast" : ""}${absorptionAfterBreakout ? " + absorb" : ""}`,
          reasonCode: "TRAP!",
          direction: "sell",
          severity: "critical",
          confidence: clamp(0.68 + (fastRejection ? 0.14 : 0) + Math.min(0.1, stackedImbalanceStrength * 0.28) + (absorptionAfterBreakout ? 0.12 : 0), 0.62, 0.97),
        });
      }
    }
    if (lastCandle && prevCandle && belowLiquidity) {
      const sweptBelow = lastCandle.low < belowLiquidity.level * (1 - calibration.trapSweepPct);
      const rejectedBelow = lastCandle.close > belowLiquidity.level && prevCandle.close >= belowLiquidity.level * (1 - calibration.breakoutPct * 0.82);
      const rejectionMovePct = lastCandle.low > 0 ? Math.abs((lastCandle.close - lastCandle.low) / lastCandle.low) : 0;
      const fastRejection = rejectionMovePct >= Math.max(chartAtrLocalPct * 0.26, calibration.breakoutPct * 0.9);
      const absorptionAfterBreakout = Boolean(absorptionSignal && absorptionSignal.direction === "buy");
      if (sweptBelow && rejectedBelow) {
        signals.push({
          id: "liquidity-trap",
          label: "Liquidity Trap Below V2",
          detail: `sweep ${belowLiquidity.level.toFixed(2)} then reject${fastRejection ? " fast" : ""}${absorptionAfterBreakout ? " + absorb" : ""}`,
          reasonCode: "TRAP!",
          direction: "buy",
          severity: "critical",
          confidence: clamp(0.68 + (fastRejection ? 0.14 : 0) + Math.min(0.1, stackedImbalanceStrength * 0.28) + (absorptionAfterBreakout ? 0.12 : 0), 0.62, 0.97),
        });
      }
    }

    const candleVolumes = chartCandles
      .slice(-12)
      .map((candle) => toNumber((candle as unknown as JsonMap).volume, NaN))
      .filter((volume) => Number.isFinite(volume) && volume > 0);
    const lastVolume = candleVolumes[candleVolumes.length - 1] || 0;
    const avgVolume = average(candleVolumes.slice(0, -1));
    const volumeDrop = lastVolume > 0 && avgVolume > 0 && lastVolume < avgVolume * 0.62;
    const tapeAbsDelta = activeTape.map((item) => Math.abs(toNumber(item.delta, 0))).filter((value) => value > 0);
    const recentTapeDeltaAbs = average(tapeAbsDelta.slice(-3));
    const baselineTapeDeltaAbs = average(tapeAbsDelta.slice(-9, -3).length > 0 ? tapeAbsDelta.slice(-9, -3) : tapeAbsDelta);
    const deltaDrop = recentTapeDeltaAbs > 0 && baselineTapeDeltaAbs > 0 && recentTapeDeltaAbs < baselineTapeDeltaAbs * 0.55;
    const priceStillMoving = recentMovePct >= Math.max(chartAtrLocalPct * 0.34, 0.0012);
    if (volumeDrop && deltaDrop && priceStillMoving) {
      const exhaustionDirection: MarketSignalDirection = recentMove > 0 ? "sell" : recentMove < 0 ? "buy" : "neutral";
      if (exhaustionDirection !== "neutral") {
        const exhaustionConfidence = clamp(
          0.6
          + (deltaOppositePrice ? 0.2 : 0)
          + (nearKeyLevel ? 0.08 : 0)
          + Math.min(0.1, stackedImbalanceStrength * 0.24),
          0.52,
          0.94,
        );
        signals.push({
          id: "exhaustion",
          label: exhaustionDirection === "sell" ? "Buyers Exhausted" : "Sellers Exhausted",
          detail: `vol drop ${(lastVolume / Math.max(1, avgVolume)).toFixed(2)}x · delta drop ${(recentTapeDeltaAbs / Math.max(1, baselineTapeDeltaAbs)).toFixed(2)}x${deltaOppositePrice ? " · divergence" : ""}`,
          reasonCode: deltaOppositePrice ? "EXH↔" : exhaustionDirection === "buy" ? "EXH↑" : "EXH↓",
          direction: exhaustionDirection,
          severity: deltaOppositePrice ? "critical" : "warn",
          confidence: exhaustionConfidence,
        });
      }
    }

    const moveDirection: MarketSignalDirection = recentMove > 0 ? "buy" : recentMove < 0 ? "sell" : "neutral";
    if (
      moveDirection !== "neutral"
      && deltaRatio >= calibration.continuationDeltaRatio
      && recentMovePct >= continuationThreshold
      && Math.sign(recentMove) === Math.sign(footprintDelta)
    ) {
      signals.push({
        id: "continuation",
        label: moveDirection === "buy" ? "Momentum Continuation Up" : "Momentum Continuation Down",
        detail: `delta sync ${(deltaRatio * 100).toFixed(0)}%`,
        reasonCode: moveDirection === "buy" ? "CONT↑" : "CONT↓",
        direction: moveDirection,
        severity: "info",
        confidence: clamp((deltaRatio - calibration.continuationDeltaRatio) / 0.26, 0.45, 1),
      });
    }

    const weightedScore = signals.reduce((score, signal) => {
      const weight =
        signal.id === "imbalance" ? 18
          : signal.id === "absorption" ? 21
            : signal.id === "fake-breakout" ? 18
              : signal.id === "liquidity-trap" ? 22
                : signal.id === "exhaustion" ? 19
                : 16;
      if (signal.direction === "buy") {
        return score + weight * signal.confidence;
      }
      if (signal.direction === "sell") {
        return score - weight * signal.confidence;
      }
      return score;
    }, 0);

    const buyPressurePct = clamp(50 + weightedScore, 0, 100);
    const sellPressurePct = 100 - buyPressurePct;
    const directionalLongPct = Math.round(buyPressurePct);
    const directionalShortPct = Math.round(sellPressurePct);
    const directionalConfidencePct = Math.round(Math.max(buyPressurePct, sellPressurePct));
    const directionalConfidenceLabel: MarketSignalSnapshot["directionalConfidenceLabel"] =
      directionalConfidencePct >= 72 ? "HIGH"
        : directionalConfidencePct >= 61 ? "MEDIUM"
          : "LOW";
    const conviction = Math.abs(buyPressurePct - 50);
    const dominantDirection: MarketSignalDirection =
      buyPressurePct >= 56 ? "buy"
        : buyPressurePct <= 44 ? "sell"
          : "neutral";

    const headline =
      dominantDirection === "buy" ? `Strong Buy Pressure ${buyPressurePct.toFixed(0)}%`
        : dominantDirection === "sell" ? `Strong Sell Pressure ${sellPressurePct.toFixed(0)}%`
          : `Balanced Flow ${buyPressurePct.toFixed(0)} / ${sellPressurePct.toFixed(0)}`;

    const convictionLabel =
      conviction >= 22 ? "high conviction"
        : conviction >= 12 ? "moderate conviction"
          : "low conviction";

    const focusMode = signals.some((signal) => signal.severity === "critical") || conviction >= 12;
    const sortedSignals = signals
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 4);
    const criticalSignals = sortedSignals.filter((signal) => signal.severity === "critical");

    return {
      buyPressurePct,
      sellPressurePct,
      directionalLongPct,
      directionalShortPct,
      directionalConfidencePct,
      directionalConfidenceLabel,
      dominantDirection,
      headline,
      convictionLabel,
      focusMode,
      calibrationLabel: calibration.label,
      criticalSignalCount: criticalSignals.length,
      criticalSignalIds: criticalSignals.map((signal) => signal.id),
      signals: sortedSignals,
    };
  }, [activeDomLevels, activeFootprintRows, activePrice, chartAtrLocalPct, chartCandles, chartPriceStep, chartSeries, chartTimeframe, liquidityZones, selectedChartSymbol]);
  const selfLearningRegimeV4 = useMemo<LearningRegimeV4>(() => {
    const points = chartSeries.slice(-24);
    if (points.length < 8) {
      return "chop";
    }
    const prices = points.map((point) => point.value).filter((value) => Number.isFinite(value) && value > 0);
    if (prices.length < 8) {
      return "chop";
    }
    const returns: number[] = [];
    for (let index = 1; index < prices.length; index += 1) {
      const prev = prices[index - 1];
      const next = prices[index];
      returns.push((next - prev) / Math.max(0.0000001, prev));
    }
    const vol = Math.sqrt(average(returns.map((value) => value * value)));
    const xMean = (prices.length - 1) / 2;
    const yMean = average(prices);
    let num = 0;
    let den = 0;
    for (let index = 0; index < prices.length; index += 1) {
      const dx = index - xMean;
      num += dx * (prices[index] - yMean);
      den += dx * dx;
    }
    const slopePct = yMean > 0 ? Math.abs((num / Math.max(1, den)) / yMean) : 0;
    if (vol >= 0.0045 && slopePct <= 0.0009) {
      return "volatile";
    }
    if (slopePct >= 0.0018) {
      return "trend";
    }
    return "chop";
  }, [chartSeries]);
  const selfLearningScenarioHint: MarketDecisionScenario = marketSignalV1.signals.some((signal) => signal.id === "continuation")
    ? "continuation"
    : marketSignalV1.signals.some((signal) => signal.id === "absorption" || signal.id === "fake-breakout" || signal.id === "liquidity-trap" || signal.id === "exhaustion")
      ? "reversal"
      : "balance";
  const selfLearningProfile = signalHistoricalLearningBundle.byScenario[selfLearningScenarioHint] || signalHistoricalLearningBundle.mixed;
  const selfLearningRegimeTemplate: MarketConfluenceWeights = selfLearningRegimeV4 === "trend"
    ? { dom: 1.18, footprint: 1.04, liquidity: 0.88, "price-action": 1.22 }
    : selfLearningRegimeV4 === "chop"
      ? { dom: 0.9, footprint: 1.15, liquidity: 1.2, "price-action": 0.88 }
      : { dom: 0.82, footprint: 1.2, liquidity: 1.24, "price-action": 0.94 };
  const selfLearningAdaptiveWeights: MarketConfluenceWeights = {
    dom: clamp(selfLearningProfile.learnedWeights.dom * selfLearningRegimeTemplate.dom, 0.72, 1.55),
    footprint: clamp(selfLearningProfile.learnedWeights.footprint * selfLearningRegimeTemplate.footprint, 0.72, 1.6),
    liquidity: clamp(selfLearningProfile.learnedWeights.liquidity * selfLearningRegimeTemplate.liquidity, 0.72, 1.62),
    "price-action": clamp(selfLearningProfile.learnedWeights["price-action"] * selfLearningRegimeTemplate["price-action"], 0.72, 1.58),
  };
  const selfLearningEffectiveWeights: MarketConfluenceWeights = selfLearningAutoAdaptEnabled
    ? {
      dom: clamp(confluenceWeights.dom * selfLearningAdaptiveWeights.dom, 0.2, 2.4),
      footprint: clamp(confluenceWeights.footprint * selfLearningAdaptiveWeights.footprint, 0.2, 2.4),
      liquidity: clamp(confluenceWeights.liquidity * selfLearningAdaptiveWeights.liquidity, 0.2, 2.4),
      "price-action": clamp(confluenceWeights["price-action"] * selfLearningAdaptiveWeights["price-action"], 0.2, 2.4),
    }
    : { ...confluenceWeights };

  var marketDecisionV1 = useMemo<MarketDecisionSnapshot>(() => {
    const topSignal = marketSignalV1.signals[0] || null;
    const hasAbsorption = marketSignalV1.criticalSignalIds.includes("absorption");
    const hasTrap = marketSignalV1.criticalSignalIds.includes("liquidity-trap");
    const hasFakeBreakout = marketSignalV1.criticalSignalIds.includes("fake-breakout");
    const hasContinuation = marketSignalV1.signals.some((signal) => signal.id === "continuation");
    const hasImbalance = marketSignalV1.signals.some((signal) => signal.id === "imbalance");
    const criticalConfirmed = marketSignalV1.criticalSignalCount >= 2 && hasAbsorption && (hasTrap || hasFakeBreakout);

    const bidDepth = activeDomLevels
      .filter((level) => level.side === "bid")
      .reduce((sum, level) => sum + Math.max(0, level.size), 0);
    const askDepth = activeDomLevels
      .filter((level) => level.side === "ask")
      .reduce((sum, level) => sum + Math.max(0, level.size), 0);
    const domRatio = (bidDepth + 1) / (askDepth + 1);
    const domDirection: MarketSignalDirection = domRatio >= 1.06 ? "buy" : domRatio <= 0.94 ? "sell" : "neutral";
    const domScorePct = Math.round(clamp(Math.abs(Math.log(domRatio)) * 72, 8, 96));

    const footprintBuy = activeFootprintRows.reduce((sum, row) => sum + Math.max(0, row.buyVolume), 0);
    const footprintSell = activeFootprintRows.reduce((sum, row) => sum + Math.max(0, row.sellVolume), 0);
    const footprintTotal = footprintBuy + footprintSell;
    const footprintDelta = footprintBuy - footprintSell;
    const footprintRatio = footprintTotal > 0 ? Math.abs(footprintDelta) / footprintTotal : 0;
    const footprintDirection: MarketSignalDirection = footprintDelta > 0 ? "buy" : footprintDelta < 0 ? "sell" : "neutral";
    const footprintScorePct = Math.round(clamp(footprintRatio * 220, 6, 95));

    const recentPoints = chartSeries.slice(-8);
    const firstRecent = recentPoints[0]?.value ?? activePrice;
    const lastRecent = recentPoints[recentPoints.length - 1]?.value ?? activePrice;
    const recentMove = lastRecent - firstRecent;
    const recentMovePct = firstRecent > 0 ? Math.abs(recentMove) / firstRecent : 0;
    const priceActionDirection: MarketSignalDirection = recentMove > 0 ? "buy" : recentMove < 0 ? "sell" : "neutral";
    const priceActionScorePct = Math.round(clamp((chartAtrLocalPct > 0 ? recentMovePct / chartAtrLocalPct : 0.35) * 42, 8, 94));

    const aboveLiquidity = liquidityZones
      .filter((zone) => zone.level > activePrice)
      .sort((a, b) => a.level - b.level)[0] || null;
    const belowLiquidity = liquidityZones
      .filter((zone) => zone.level < activePrice)
      .sort((a, b) => b.level - a.level)[0] || null;
    const nearestLiquidity = [aboveLiquidity, belowLiquidity]
      .filter((zone): zone is LiquidityZone => Boolean(zone))
      .sort((a, b) => Math.abs(a.level - activePrice) - Math.abs(b.level - activePrice))[0] || null;
    const liquidityDirection: MarketSignalDirection =
      hasTrap || hasFakeBreakout
        ? (topSignal?.direction || marketSignalV1.dominantDirection)
        : nearestLiquidity && nearestLiquidity.level > activePrice ? "buy" : nearestLiquidity && nearestLiquidity.level < activePrice ? "sell" : "neutral";
    const liquidityScorePct = Math.round(clamp(
      (hasTrap || hasFakeBreakout ? 78 : 42)
      + (nearestLiquidity ? Math.max(0, 22 - Math.abs(nearestLiquidity.level - activePrice) / Math.max(chartPriceStep, activePrice * 0.0004)) : 0),
      12,
      95,
    ));

    const evidence: MarketEvidenceComponent[] = [
      { id: "dom", label: "DOM", scorePct: domScorePct, direction: domDirection, detail: `depth ${domRatio.toFixed(2)}x` },
      { id: "footprint", label: "Footprint", scorePct: footprintScorePct, direction: footprintDirection, detail: `delta ${footprintDelta >= 0 ? "+" : ""}${footprintDelta.toFixed(0)}` },
      { id: "liquidity", label: "Liquidity", scorePct: liquidityScorePct, direction: liquidityDirection, detail: nearestLiquidity ? `near ${nearestLiquidity.level.toFixed(2)}` : "no nearby pool" },
      { id: "price-action", label: "Price", scorePct: priceActionScorePct, direction: priceActionDirection, detail: `${recentMove >= 0 ? "+" : ""}${(recentMovePct * 100).toFixed(2)}%` },
    ];
    const resolveScenario = (confluenceScorePct: number): { scenario: MarketDecisionScenario; scenarioLabel: string; scenarioProbabilityPct: number } => {
      let scenario: MarketDecisionScenario = "balance";
      let scenarioLabel = "Balanced auction";
      let scenarioProbabilityPct = Math.round(clamp(confluenceScorePct * 0.52 + Math.abs(marketSignalV1.buyPressurePct - 50) * 0.6, 48, 90));
      if (criticalConfirmed) {
        scenario = "reversal";
        scenarioLabel = "Probable reversal zone";
        scenarioProbabilityPct = Math.round(clamp(64 + confluenceScorePct * 0.22 + marketSignalV1.criticalSignalCount * 6, 68, 94));
      } else if (hasContinuation && hasImbalance && marketSignalV1.dominantDirection !== "neutral") {
        scenario = "continuation";
        scenarioLabel = marketSignalV1.dominantDirection === "buy" ? "Continuation haussiere probable" : "Continuation baissiere probable";
        scenarioProbabilityPct = Math.round(clamp(56 + confluenceScorePct * 0.3 + Math.abs(marketSignalV1.buyPressurePct - 50) * 0.28, 62, 90));
      }
      return { scenario, scenarioLabel, scenarioProbabilityPct };
    };
    const computeConfluence = (learning: MarketHistoricalLearning): number => {
      const effectiveWeights = evidence.reduce((acc, item) => {
        acc[item.id] = Math.max(0.2, selfLearningEffectiveWeights[item.id] * learning.learnedWeights[item.id]);
        return acc;
      }, {} as MarketConfluenceWeights);
      const weightSum = evidence.reduce((sum, item) => sum + effectiveWeights[item.id], 0);
      return Math.round(evidence.reduce((sum, item) => {
        const weight = effectiveWeights[item.id];
        return sum + item.scorePct * weight;
      }, 0) / Math.max(1, weightSum));
    };
    const baselineScore = computeConfluence(signalHistoricalLearning);
    const provisionalScenario = resolveScenario(baselineScore);
    const provisionalLearning = signalHistoricalLearningBundle.byScenario[provisionalScenario.scenario] || signalHistoricalLearning;
    const firstPassConfluence = computeConfluence(provisionalLearning);
    const firstPassScenario = resolveScenario(firstPassConfluence);
    const scenarioLearning = signalHistoricalLearningBundle.byScenario[firstPassScenario.scenario] || provisionalLearning;
    const confluenceScorePct = computeConfluence(scenarioLearning);
    const { scenario, scenarioLabel, scenarioProbabilityPct } = resolveScenario(confluenceScorePct);
    const selectedLearning = signalHistoricalLearningBundle.byScenario[scenario] || scenarioLearning;

    const probableReversalZone = (() => {
      if (liquidityZones.length === 0) {
        return null;
      }
      if (scenario === "reversal") {
        if (marketSignalV1.dominantDirection === "buy") {
          return liquidityZones.filter((zone) => zone.level < activePrice).sort((a, b) => b.level - a.level)[0]?.level ?? null;
        }
        if (marketSignalV1.dominantDirection === "sell") {
          return liquidityZones.filter((zone) => zone.level > activePrice).sort((a, b) => a.level - b.level)[0]?.level ?? null;
        }
      }
      return liquidityZones.reduce((closest, zone) => {
        if (closest === null) {
          return zone.level;
        }
        return Math.abs(zone.level - activePrice) < Math.abs(closest - activePrice) ? zone.level : closest;
      }, null as number | null);
    })();

    const probableReversalZoneLabel = probableReversalZone !== null
      ? `Reversal zone ${probableReversalZone.toFixed(2)}`
      : "No reversal zone";
    const globalConfidencePct = Math.round(clamp(scenarioProbabilityPct * 0.52 + confluenceScorePct * 0.3 + (topSignal?.confidence || 0.5) * 18, 44, 95));
    const biasDirection =
      scenario === "reversal"
        ? (topSignal?.direction && topSignal.direction !== "neutral" ? topSignal.direction : marketSignalV1.dominantDirection)
        : marketSignalV1.dominantDirection;
    const atrAbs = Math.max(chartPriceStep * 6, Math.max(activePrice * Math.max(chartAtrLocalPct, 0.0012), chartPriceStep * 10));
    const suggestedBracket = (() => {
      if (biasDirection === "neutral") {
        return null;
      }
      const side: MarketSuggestedBracket["side"] = biasDirection === "buy" ? "buy" : "sell";
      let entry = activePrice;
      let sl = activePrice;
      let tp = activePrice;
      if (scenario === "reversal") {
        entry = probableReversalZone ?? (side === "buy" ? (belowLiquidity?.level ?? activePrice) : (aboveLiquidity?.level ?? activePrice));
        sl = side === "buy" ? entry - atrAbs * 0.9 : entry + atrAbs * 0.9;
        tp = side === "buy"
          ? (aboveLiquidity?.level ?? entry + atrAbs * 1.9)
          : (belowLiquidity?.level ?? entry - atrAbs * 1.9);
      } else if (scenario === "continuation") {
        entry = activePrice;
        sl = side === "buy" ? entry - atrAbs * 0.8 : entry + atrAbs * 0.8;
        tp = side === "buy"
          ? (aboveLiquidity?.level ?? entry + atrAbs * 1.7)
          : (belowLiquidity?.level ?? entry - atrAbs * 1.7);
      } else {
        entry = activePrice;
        sl = side === "buy" ? entry - atrAbs * 0.75 : entry + atrAbs * 0.75;
        tp = side === "buy" ? entry + atrAbs * 1.2 : entry - atrAbs * 1.2;
      }
      const risk = side === "buy" ? Math.max(chartPriceStep, entry - sl) : Math.max(chartPriceStep, sl - entry);
      const reward = side === "buy" ? Math.max(chartPriceStep, tp - entry) : Math.max(chartPriceStep, entry - tp);
      return {
        side,
        entry: Number(entry.toFixed(chartPriceDigits)),
        sl: Number(sl.toFixed(chartPriceDigits)),
        tp: Number(tp.toFixed(chartPriceDigits)),
        rr: reward / Math.max(chartPriceStep, risk),
        label: scenario === "reversal" ? "Reversal bracket" : scenario === "continuation" ? "Continuation bracket" : "Balanced bracket",
      } satisfies MarketSuggestedBracket;
    })();

    const actionTitle = (() => {
      if (hasAbsorption && aboveLiquidity && topSignal?.direction === "sell") {
        return `Seller absorbing above ${aboveLiquidity.level.toFixed(2)}`;
      }
      if (hasAbsorption && belowLiquidity && topSignal?.direction === "buy") {
        return `Buyer absorbing below ${belowLiquidity.level.toFixed(2)}`;
      }
      if (hasTrap && aboveLiquidity) {
        return `Liquidity swept above ${aboveLiquidity.level.toFixed(2)}`;
      }
      if (hasTrap && belowLiquidity) {
        return `Liquidity swept below ${belowLiquidity.level.toFixed(2)}`;
      }
      if (hasContinuation && biasDirection === "buy") {
        return `Buy continuation through ${activePrice.toFixed(2)}`;
      }
      if (hasContinuation && biasDirection === "sell") {
        return `Sell continuation through ${activePrice.toFixed(2)}`;
      }
      return "Wait for auction confirmation";
    })();

    const actionBody = criticalConfirmed
      ? `Two critical sources aligned. Favor ${biasDirection === "buy" ? "long response" : biasDirection === "sell" ? "short response" : "selective execution"} near ${probableReversalZone !== null ? probableReversalZone.toFixed(2) : activePrice.toFixed(2)}.`
      : scenario === "continuation"
        ? `DOM and footprint are aligned. Use tighter execution and hold above ${activePrice.toFixed(2)} only if price action confirms.`
        : `Auction is mixed. Reduce aggression and wait for confirmation around ${probableReversalZone !== null ? probableReversalZone.toFixed(2) : activePrice.toFixed(2)}.`;

    const executionPlan = {
      snapPriority: scenario === "reversal" ? "liquidity" : scenario === "continuation" ? "execution" : "vwap",
      preset: scenario === "reversal" ? "low-risk" : chartTimeframe === "15m" ? "swing" : scenario === "continuation" ? "scalp" : "swing",
      guardEnabled: scenario !== "continuation" || globalConfidencePct < 78,
    } satisfies MarketDecisionSnapshot["executionPlan"];

    return {
      scenario,
      scenarioLabel,
      scenarioProbabilityPct,
      probableReversalZone,
      probableReversalZoneLabel,
      globalConfidencePct,
      biasDirection,
      criticalConfirmed,
      evidence,
      confluenceScorePct,
      actionTitle,
      actionBody,
      suggestedBracket,
      historicalLearning: selectedLearning,
      executionPlan,
    };
  }, [activeDomLevels, activeFootprintRows, activePrice, chartAtrLocalPct, chartPriceDigits, chartPriceStep, chartSeries, chartTimeframe, liquidityZones, marketSignalV1, selfLearningEffectiveWeights, signalHistoricalLearning, signalHistoricalLearningBundle]);
  useEffect(() => {
    signalConfidenceTrailRef.current = [];
    setSignalConfidenceDrift("FLAT");
  }, [selectedChartSymbol, chartTimeframe]);
  useEffect(() => {
    const value = marketSignalV1.directionalConfidencePct;
    if (!Number.isFinite(value)) {
      return;
    }
    const nextTrail = [...signalConfidenceTrailRef.current, value].slice(-6);
    signalConfidenceTrailRef.current = nextTrail;
    if (nextTrail.length < 3) {
      setSignalConfidenceDrift("FLAT");
      return;
    }
    const driftRaw = nextTrail[nextTrail.length - 1] - nextTrail[0];
    if (driftRaw >= 2.5) {
      setSignalConfidenceDrift("UP");
    } else if (driftRaw <= -2.5) {
      setSignalConfidenceDrift("DOWN");
    } else {
      setSignalConfidenceDrift("FLAT");
    }
  }, [marketSignalV1.directionalConfidencePct]);
  useEffect(() => {
    if (!selfLearningV4Enabled) {
      return;
    }
    const signature = [
      selectedChartSymbol,
      chartTimeframe,
      selfLearningRegimeV4,
      selfLearningScenarioHint,
      selfLearningProfile.sampleSize,
      selfLearningProfile.winratePct.toFixed(1),
      selfLearningAutoAdaptEnabled ? "adapt" : "manual",
    ].join(":");
    if (!selfLearningModelSignatureRef.current) {
      selfLearningModelSignatureRef.current = signature;
      setSelfLearningModelUpdatedAt(new Date().toISOString());
      return;
    }
    if (selfLearningModelSignatureRef.current !== signature) {
      selfLearningModelSignatureRef.current = signature;
      setSelfLearningModelUpdatedAt(new Date().toISOString());
    }
  }, [
    chartTimeframe,
    selfLearningAutoAdaptEnabled,
    selfLearningProfile.sampleSize,
    selfLearningProfile.winratePct,
    selfLearningRegimeV4,
    selfLearningScenarioHint,
    selfLearningV4Enabled,
    selectedChartSymbol,
  ]);
  useEffect(() => {
    if (!selfLearningV4Enabled || !selfLearningAutoAdaptEnabled || !selfLearningDriftV4.shouldDemote) {
      return;
    }
    const signature = [selectedChartSymbol, chartTimeframe, selfLearningDriftV4.signature].join(":");
    if (selfLearningDriftSignatureRef.current === signature) {
      return;
    }
    selfLearningDriftSignatureRef.current = signature;
    const nowIso = new Date().toISOString();
    setSelfLearningAutoAdaptEnabled(false);
    setSelfLearningDriftAutoDemotedAt(nowIso);
    setSelfLearningModelUpdatedAt(nowIso);
  }, [
    chartTimeframe,
    selfLearningAutoAdaptEnabled,
    selfLearningDriftV4.shouldDemote,
    selfLearningDriftV4.signature,
    selfLearningV4Enabled,
    selectedChartSymbol,
  ]);
  useEffect(() => {
    if (!selfLearningV4Enabled || selfLearningScopedOutcomesV4.length === 0) {
      return;
    }
    const latest = selfLearningScopedOutcomesV4[0];
    const signature = [selectedChartSymbol, chartTimeframe, latest.key, latest.timestampIso].join(":");
    if (selfLearningJournalSignatureRef.current === signature) {
      return;
    }
    selfLearningJournalSignatureRef.current = signature;
    const inferScenario = (item: JsonMap): MarketDecisionScenario => {
      const text = [
        item.scenario,
        item.scenario_type,
        item.setup,
        item.pattern,
        item.tag,
        item.signal,
        item.strategy_name,
        item.strategy_id,
        item.strategy,
      ].map((value) => String(value || "").toLowerCase()).join(" ");
      if (/reversal|mean\s*reversion|fade|trap|sweep|absorption|fake\s*breakout/.test(text)) {
        return "reversal";
      }
      if (/continuation|breakout|momentum|trend|follow\s*through|impulse/.test(text)) {
        return "continuation";
      }
      return "balance";
    };
    const regime: LearningRegimeV4 = latest.regimeRaw.includes("trend")
      ? "trend"
      : latest.regimeRaw.includes("vol")
        ? "volatile"
        : latest.regimeRaw.includes("chop") || latest.regimeRaw.includes("range")
          ? "chop"
          : selfLearningRegimeV4;
    setSelfLearningJournalV4Trail((current) => {
      if (current.some((event) => event.id === latest.key)) {
        return current;
      }
      return [
        {
          id: latest.key,
          timestampIso: latest.timestampIso,
          symbol: selectedChartSymbol,
          timeframe: chartTimeframe,
          regime,
          scenario: inferScenario(latest.raw),
          outcome: (latest.win ? "win" : "loss") as "win" | "loss",
          pnl: latest.pnl,
          mfe: latest.mfe,
          mae: latest.mae,
          weights: {
            dom: selfLearningEffectiveWeights.dom,
            footprint: selfLearningEffectiveWeights.footprint,
            liquidity: selfLearningEffectiveWeights.liquidity,
            "price-action": selfLearningEffectiveWeights["price-action"],
          },
        },
        ...current,
      ].slice(0, 240);
    });
  }, [
    chartTimeframe,
    selfLearningEffectiveWeights,
    selfLearningRegimeV4,
    selfLearningScopedOutcomesV4,
    selfLearningV4Enabled,
    selectedChartSymbol,
  ]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const scope = {
      accountId: accountId || "default",
      symbol: selectedChartSymbol || "BTCUSD",
      timeframe: chartTimeframe || "1m",
    };
    const scopeKey = [scope.accountId, scope.symbol, scope.timeframe].join(":");
    if (!selfLearningBackendReadyRef.current || selfLearningBackendScopeRef.current !== scopeKey) {
      return;
    }
    const timer = window.setTimeout(() => {
      void saveSelfLearningV4State({
        accountId: scope.accountId,
        symbol: scope.symbol,
        timeframe: scope.timeframe,
        enabled: selfLearningV4Enabled,
        autoAdaptEnabled: selfLearningAutoAdaptEnabled,
        modelUpdatedAt: selfLearningModelUpdatedAt,
        driftAutoDemotedAt: selfLearningDriftAutoDemotedAt,
        filters: {
          regime: selfLearningJournalV4RegimeFilter,
          scenario: selfLearningJournalV4ScenarioFilter,
        },
        snapshot: {
          regime: selfLearningRegimeV4,
          scenarioHint: selfLearningScenarioHint,
          active: selfLearningV4Active,
          profile: selfLearningProfile,
          adaptiveWeights: selfLearningAdaptiveWeights,
          effectiveWeights: selfLearningEffectiveWeights,
          drift: {
            status: selfLearningV4DriftLabel,
            shortSamples: selfLearningDriftV4.shortSamples,
            longSamples: selfLearningDriftV4.longSamples,
            shortWinratePct: selfLearningDriftV4.shortWinratePct,
            longWinratePct: selfLearningDriftV4.longWinratePct,
            winrateDropPct: selfLearningDriftV4.winrateDropPct,
            shortBrier: selfLearningDriftV4.shortBrier,
            longBrier: selfLearningDriftV4.longBrier,
            brierRise: selfLearningDriftV4.brierRise,
            shortLossCount: selfLearningDriftV4.shortLossCount,
            enoughSamples: selfLearningDriftV4.enoughSamples,
            shouldDemote: selfLearningDriftV4.shouldDemote,
            signature: selfLearningDriftV4.signature,
          },
        },
        journal: selfLearningJournalV4Trail,
      }).then((result) => {
        setSelfLearningV4PersistenceStatus((current) => ({
          ...current,
          storage: result.storage,
          healthy: true,
          stateSavedAt: result.updatedAt || new Date().toISOString(),
          message: "state-saved",
        }));
      }).catch(() => {
        setSelfLearningV4PersistenceStatus((current) => ({
          ...current,
          healthy: false,
          message: "state-save-failed",
        }));
      });
    }, 650);
    return () => {
      window.clearTimeout(timer);
    };
  }, [accountId, chartTimeframe, selectedChartSymbol, selfLearningAdaptiveWeights, selfLearningAutoAdaptEnabled, selfLearningDriftAutoDemotedAt, selfLearningDriftV4, selfLearningEffectiveWeights, selfLearningJournalV4RegimeFilter, selfLearningJournalV4ScenarioFilter, selfLearningJournalV4Trail, selfLearningModelUpdatedAt, selfLearningProfile, selfLearningRegimeV4, selfLearningScenarioHint, selfLearningV4Active, selfLearningV4DriftLabel, selfLearningV4Enabled]);
  useEffect(() => {
    let cancelled = false;
    if (authSessionRequired) {
      setSelfLearningV4ScopeSummaries([]);
      setSelfLearningV4PersistenceStatus((current) => ({
        ...current,
        healthy: true,
        message: "scopes-unauthorized",
      }));
      return () => {
        cancelled = true;
      };
    }
    const loadScopes = async () => {
      try {
        const result = await fetchSelfLearningV4Scopes({
          accountId: accountId || "default",
          limit: 180,
        });
        if (cancelled) {
          return;
        }
        setSelfLearningV4ScopeSummaries(result.items);
        setSelfLearningV4PersistenceStatus((current) => ({
          ...current,
          storage: result.storage === "unknown" ? current.storage : result.storage,
          healthy: true,
          scopesLoadedAt: new Date().toISOString(),
          scopeCount: result.items.length,
          message: "scopes-loaded",
        }));
      } catch {
        if (cancelled) {
          return;
        }
        setSelfLearningV4PersistenceStatus((current) => ({
          ...current,
          healthy: false,
          message: "scopes-load-failed",
        }));
      }
    };
    void loadScopes();
    const timer = window.setInterval(() => {
      void loadScopes();
    }, 45000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [accountId, authSessionRequired]);
  useEffect(() => {
    if (!marketDecisionV1.criticalConfirmed) {
      return;
    }
    const signature = [selectedChartSymbol, chartTimeframe, marketDecisionV1.scenario, marketSignalV1.criticalSignalIds.join("+"), marketDecisionV1.probableReversalZone?.toFixed(2) || "na"].join(":");
    if (signalAlertSignatureRef.current === signature) {
      return;
    }
    signalAlertSignatureRef.current = signature;
    setSignalAlertBadgeCount((count) => count + 1);
    setSignalActionToast({
      key: signature,
      title: marketDecisionV1.scenario === "reversal" ? "Critical reversal setup" : "Critical market setup",
      detail: `${marketSignalV1.criticalSignalIds.join(" + ")} confirmed on ${selectedChartSymbol} ${chartTimeframe}`,
      direction: marketDecisionV1.biasDirection,
      zoneLabel: marketDecisionV1.probableReversalZoneLabel,
      critical: true,
    });
  }, [chartTimeframe, marketDecisionV1, marketSignalV1.criticalSignalIds, selectedChartSymbol]);
  useEffect(() => {
    if (!signalActionToast) {
      return;
    }
    const timer = window.setTimeout(() => setSignalActionToast(null), 5200);
    return () => window.clearTimeout(timer);
  }, [signalActionToast]);
  useEffect(() => {
    if (replayState.enabled) {
      return;
    }
    const plan = marketDecisionV1.executionPlan;
    const signature = [selectedChartSymbol, chartTimeframe, marketDecisionV1.scenario, plan.snapPriority, plan.preset, plan.guardEnabled ? "guard-on" : "guard-off"].join(":");
    if (executionAdaptationSignatureRef.current === signature) {
      return;
    }
    executionAdaptationSignatureRef.current = signature;
    if (executionAdaptMode === "manual") {
      setPendingExecutionAdaptation(null);
      return;
    }
    if (executionAdaptMode === "confirm") {
      setPendingExecutionAdaptation({ signature, plan });
      return;
    }
    setPendingExecutionAdaptation(null);
    applyExecutionAdaptationPlan(plan);
  }, [chartTimeframe, executionAdaptMode, marketDecisionV1, replayState.enabled, selectedChartSymbol]);
  useEffect(() => {
    if (!autoSymbolLoss.overCap || autoSymbolLoss.localDisabled) {
      return;
    }
    setAutoSymbolAutoDisabled((current) => {
      if (current[autoSymbolLoss.normalizedSymbol]) {
        return current;
      }
      return {
        ...current,
        [autoSymbolLoss.normalizedSymbol]: new Date().toISOString(),
      };
    });
  }, [autoSymbolLoss.localDisabled, autoSymbolLoss.normalizedSymbol, autoSymbolLoss.overCap]);
  useEffect(() => {
    if (autoExecutionMode === "assisted") {
      return;
    }
    const signature = [
      selectedChartSymbol,
      chartTimeframe,
      autoExecutionMode,
      autoExecutionGate.autoState,
      autoExecutionGate.ruleLabel,
      autoMetaFilter.pass ? "m1" : "m0",
      autoRiskEngine.hardPass ? "r1" : "r0",
      autoSessionGuard.pass ? "s1" : "s0",
      autoSymbolLoss.pass ? "l1" : "l0",
      autoExecutionKillSwitch ? "k1" : "k0",
      autoSizingV3.finalNotional.toFixed(0),
    ].join(":");
    if (autoExecutionAuditSignatureRef.current === signature) {
      return;
    }
    autoExecutionAuditSignatureRef.current = signature;
    const reasons: string[] = [];
    if (!autoMetaFilter.pass) reasons.push("meta");
    if (!autoRiskEngine.hardPass) reasons.push("risk");
    if (!autoSessionGuard.pass) reasons.push(`session:${autoSessionGuard.label}`);
    if (!autoSymbolLoss.pass) reasons.push("symbol-loss-cap");
    if (autoRiskEngine.killSwitchActive) reasons.push("kill-switch");
    if (!autoEntryReady) reasons.push("entry-not-ready");
    setAutoExecutionAuditTrail((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestampIso: new Date().toISOString(),
        symbol: selectedChartSymbol,
        timeframe: chartTimeframe,
        mode: autoExecutionMode,
        gateState: autoExecutionGate.autoState as "READY" | "BLOCKED" | "KILLED",
        metaPass: autoMetaFilter.pass,
        riskPass: autoRiskEngine.hardPass,
        sessionPass: autoSessionGuard.pass,
        symbolLossPass: autoSymbolLoss.pass,
        killSwitch: autoRiskEngine.killSwitchActive,
        sizeUsd: autoSizingV3.finalNotional,
        qualityScore: autoMetaFilter.qualityScore,
        reasons,
      },
      ...current,
    ].slice(0, 80));
  }, [
    autoEntryReady,
    autoExecutionGate.autoState,
    autoExecutionGate.ruleLabel,
    autoExecutionKillSwitch,
    autoExecutionMode,
    autoMetaFilter.pass,
    autoMetaFilter.qualityScore,
    autoRiskEngine.hardPass,
    autoRiskEngine.killSwitchActive,
    autoSessionGuard.label,
    autoSessionGuard.pass,
    autoSizingV3.finalNotional,
    autoSymbolLoss.pass,
    chartTimeframe,
    selectedChartSymbol,
  ]);
  useEffect(() => {
    if (replayState.enabled || autoExecutionMode === "assisted" || autoExecutionKillSwitch) {
      return;
    }
    if (!marketDecisionV1.suggestedBracket) {
      return;
    }
    const baseSignature = [
      selectedChartSymbol,
      chartTimeframe,
      marketDecisionV1.scenario,
      marketDecisionV1.suggestedBracket.side,
      marketDecisionV1.suggestedBracket.entry.toFixed(chartPriceDigits),
      marketDecisionV1.suggestedBracket.sl.toFixed(chartPriceDigits),
      marketDecisionV1.suggestedBracket.tp.toFixed(chartPriceDigits),
      autoExecutionGate.autoState,
      autoExecutionGate.ruleLabel,
    ].join(":");

    if (autoExecutionMode === "semi-auto") {
      if (!autoExecutionGate.ready) {
        return;
      }
      if (autoExecutionSignatureRef.current === baseSignature) {
        return;
      }
      autoExecutionSignatureRef.current = baseSignature;
      applySuggestedScenarioBracket(marketDecisionV1.suggestedBracket);
      applyExecutionAdaptationPlan(marketDecisionV1.executionPlan);
      return;
    }

    if (!autoExecutionGate.ready || autoExecutionMode !== "full-auto") {
      return;
    }
    const now = Date.now();
    if (now - autoExecutionLastAtRef.current < 45000) {
      return;
    }
    const stagedSignature = `${baseSignature}:${chartHudConfirmArmed ? "armed" : "cold"}`;
    if (autoExecutionSignatureRef.current === stagedSignature) {
      return;
    }
    autoExecutionSignatureRef.current = stagedSignature;
    void (async () => {
      await approveAllAndSend();
      if (chartHudConfirmArmed || chartEffectiveSendMode !== "confirm-required") {
        autoExecutionLastAtRef.current = Date.now();
      }
    })();
  }, [
    approveAllAndSend,
    autoExecutionGate.autoState,
    autoExecutionGate.ready,
    autoExecutionGate.ruleLabel,
    autoExecutionKillSwitch,
    autoExecutionMode,
    chartEffectiveSendMode,
    chartHudConfirmArmed,
    chartPriceDigits,
    chartTimeframe,
    marketDecisionV1.executionPlan,
    marketDecisionV1.scenario,
    marketDecisionV1.suggestedBracket,
    replayState.enabled,
    selectedChartSymbol,
  ]);
  const strictDepthTimeMatch = replayState.enabled
    ? Boolean(replayFrame && activeTimeKey && replayFrame.timeKey === activeTimeKey)
    : Boolean(activeTimeKey && depthTimeKey && activeTimeKey === depthTimeKey);
  const timeSyncDiagnostics = (() => {
    const issues: string[] = [];
    if (!activeTimeKey) {
      return { mismatchCount: 0, issues };
    }

    if (!replayState.enabled && depthTimeKey && activeTimeKey !== depthTimeKey) {
      issues.push("depth");
    }
    if (replayState.enabled && replayFrame?.timeKey && activeTimeKey !== replayFrame.timeKey) {
      issues.push("replay");
    }

    const hasFootprintSample = activeFootprintRows.length > 0;
    const hasFootprintMatch = activeFootprintRows.some((row) => row.timeKey === activeTimeKey);
    if (hasFootprintSample && !hasFootprintMatch) {
      issues.push("footprint");
    }

    const hasTapeSample = activeTape.length > 0;
    const hasTapeMatch = activeTape.some((print) => print.timeKey === activeTimeKey);
    if (hasTapeSample && !hasTapeMatch) {
      issues.push("tape");
    }

    const hasDomSample = activeDomLevels.length > 0;
    if (hasDomSample && !strictDepthTimeMatch) {
      issues.push("dom/heatmap");
    }

    return {
      mismatchCount: issues.length,
      issues,
    };
  })();
  const timeSyncMismatchLabel = timeSyncDiagnostics.issues.join(", ");
  const replayCurrentIndex = replayState.enabled ? clampIndex(replayState.cursorIndex, replayMaxIndex) : replayMaxIndex;
  const replayCurrentTimeLabel = replayState.enabled
    ? (replayFrame?.timeLabel || formatTimeKeyLabel(activeTimeKey || null))
    : formatTimeKeyLabel(activeTimeKey || null);

  useEffect(() => {
    if (!DEBUG_TIME_SYNC || timeSyncDiagnostics.mismatchCount === 0) {
      return;
    }
    console.warn("[time-sync] mismatch", {
      activeTimeKey,
      replayEnabled: replayState.enabled,
      replayFrameTimeKey: replayFrame?.timeKey || null,
      depthTimeKey,
      mismatchCount: timeSyncDiagnostics.mismatchCount,
      issues: timeSyncDiagnostics.issues,
    });
  }, [
    activeTimeKey,
    depthTimeKey,
    replayFrame?.timeKey,
    replayState.enabled,
    timeSyncDiagnostics.issues,
    timeSyncDiagnostics.mismatchCount,
  ]);

  const enableReplay = () => {
    if (replayFrames.length === 0) {
      return;
    }
    const startIndex = replayMaxIndex;
    setReplayState((current) => ({
      ...current,
      enabled: true,
      playing: false,
      cursorIndex: startIndex,
      timeKey: replayFrames[startIndex]?.timeKey || null,
    }));
  };

  const exitReplayMode = () => {
    setReplayState((current) => ({
      ...current,
      enabled: false,
      playing: false,
      timeKey: null,
      cursorIndex: replayMaxIndex,
    }));
  };

  const stepReplay = (delta: number) => {
    if (replayFrames.length === 0) {
      return;
    }
    setReplayState((current) => {
      const nextIndex = clampIndex(current.cursorIndex + delta, replayMaxIndex);
      return {
        ...current,
        enabled: true,
        playing: false,
        cursorIndex: nextIndex,
        timeKey: replayFrames[nextIndex]?.timeKey || null,
      };
    });
  };

  const jumpToReplayFrame = (frameIndex: number) => {
    if (replayFrames.length === 0) {
      return;
    }
    const nextIndex = clampIndex(frameIndex, replayMaxIndex);
    setReplayState((current) => ({
      ...current,
      enabled: true,
      playing: false,
      cursorIndex: nextIndex,
      timeKey: replayFrames[nextIndex]?.timeKey || null,
    }));
  };

  const setReplaySpeed = (speed: ReplaySpeed) => {
    setReplayState((current) => ({ ...current, speed }));
  };

  const toggleReplayPlayback = () => {
    if (replayFrames.length === 0) {
      return;
    }
    setReplayState((current) => ({
      ...current,
      enabled: true,
      playing: !current.playing,
      timeKey: replayFrames[clampIndex(current.cursorIndex, replayMaxIndex)]?.timeKey || current.timeKey,
    }));
  };
  const avgSlippage = executionTelemetry.length > 0
    ? average(executionTelemetry.map((item) => toNumber(item.realized_slippage_bps, 0)))
    : average(filteredOutcomes.map((item) => toNumber(item.slippage_real_bps, 0)));
  const avgLatency = executionTelemetry.length > 0
    ? average(executionTelemetry.map((item) => toNumber(item.latency_e2e_ms, 0)))
    : average(filteredOutcomes.map((item) => toNumber(item.latency_ms, 0)));
  const routeCandidates = selectedQuoteRows
    .map((quote) => {
      const bid = toNumber(quote.bid, 0);
      const ask = toNumber(quote.ask, 0);
      return {
        venue: String(quote.venue || "unknown"),
        instrument: String(quote.instrument || selectedChartSymbol),
        spread: ask > 0 && bid > 0 ? ask - bid : Number.MAX_SAFE_INTEGER,
        last: toNumber(quote.last, 0),
      };
    })
    .sort((left, right) => left.spread - right.spread);
  const preferredRoute = (routingScore?.best as JsonMap | undefined) || routeCandidates[0] || null;
  const backupRoute = (routingScore?.backup as JsonMap | undefined) || routeCandidates[1] || null;
  const replayItems = executionTelemetry.length > 0 ? executionTelemetry.slice(0, 6) : filteredOutcomes.slice(0, 6);
  const replayOptions = replayItems.reduce((acc, item) => {
    const id = decisionIdFrom(item);
    if (!id || acc.some((entry) => entry.id === id)) {
      return acc;
    }
    return [...acc, { id, item }];
  }, [] as Array<{ id: string; item: JsonMap }>);
  const replayRoute = replayTelemetry ? String(replayTelemetry.route_chosen || "-") : "-";
  const replaySlippage = replayTelemetry ? toNumber(replayTelemetry.realized_slippage_bps, 0) : 0;
  const replayLatency = replayTelemetry ? toNumber(replayTelemetry.latency_e2e_ms, 0) : 0;
  const replayVenueAggregates = [...replayFills.reduce((acc, fill) => {
    const venue = String(fill.venue || "unknown");
    const existing = acc.get(venue) || { venue, fills: 0, notional: 0, slippage: 0 };
    existing.fills += 1;
    existing.notional += toNumber(fill.notional_usd, 0);
    existing.slippage += toNumber(fill.slippage_bps, 0);
    acc.set(venue, existing);
    return acc;
  }, new Map<string, { venue: string; fills: number; notional: number; slippage: number }>()).values()]
    .map((item) => ({ ...item, avgSlippage: item.fills > 0 ? item.slippage / item.fills : 0 }))
    .sort((left, right) => right.notional - left.notional);
  const replayHistogram = [...replayFills.reduce((acc, fill) => {
    const bucket = Math.round(toNumber(fill.slippage_bps, 0));
    acc.set(bucket, (acc.get(bucket) || 0) + 1);
    return acc;
  }, new Map<number, number>()).entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([bucket, count]) => ({ bucket, count }));
  const replayHistogramMax = replayHistogram.reduce((max, item) => Math.max(max, item.count), 1);
  const replayDurationMs = replayTimeline.length > 1
    ? Math.max(1, new Date(replayTimeline[replayTimeline.length - 1].timestamp).getTime() - new Date(replayTimeline[0].timestamp).getTime())
    : 1;
  const activeVenueMetrics = replayVenueAggregates.find((v) => v.venue === replayRoute) || replayVenueAggregates[0] || null;
  const venueQualityScore = (() => {
    if (!activeVenueMetrics) return 0.75;
    const slip = Math.abs(toNumber(activeVenueMetrics.avgSlippage, 0));
    const latency = replayLatency;
    const fills = Math.max(1, toNumber(activeVenueMetrics.fills, 1));
    const slipScore =
      slip <= 1.5 ? 1
      : slip <= 3 ? 0.85
      : slip <= 6 ? 0.65
      : 0.45;
    const latencyScore =
      latency <= 120 ? 1
      : latency <= 220 ? 0.85
      : latency <= 380 ? 0.65
      : 0.4;
    const reliabilityScore = Math.min(1, 0.55 + fills / 20);
    return Math.max(0.35, Math.min(1, slipScore * 0.5 + latencyScore * 0.35 + reliabilityScore * 0.15));
  })();
  const venueQualityMultiplier = Math.max(0.6, Math.min(1, venueQualityScore));
  const venueQualityLabel =
    venueQualityScore >= 0.85 ? "good"
    : venueQualityScore >= 0.65 ? "fair"
    : "poor";
  const preferredSpread = preferredRoute
    ? toNumber((preferredRoute as JsonMap).spread, toNumber((preferredRoute as JsonMap).spread_bps, 0))
    : 0;
  const backupScore = backupRoute ? toNumber((backupRoute as JsonMap).score, 0) : 0;

  // ── OVERLAY COMPUTED VARS ─────────────────────────────────────────────
  const overlayAiDecision = (replayPayload?.ai_decision as JsonMap | undefined) || null;
  const overlayDecisionScore = overlayAiDecision
    ? toNumber(overlayAiDecision.score, 0)
    : toNumber(replayTelemetry?.ai_score, 0);
  const overlayDecisionRegime = (() => {
    const raw = overlayAiDecision?.regime || replayTelemetry?.regime;
    return raw && String(raw) !== "null" ? String(raw) : "–";
  })();
  const overlayDecisionConsensus = overlayAiDecision
    ? toNumber(overlayAiDecision.consensus_pct, 0)
    : toNumber(replayTelemetry?.consensus_pct, 0);
  const overlayDecisionMemorySim = toNumber(
    overlayAiDecision?.memory_similarity ?? replayTelemetry?.memory_similarity,
    0,
  );
  const overlayDecisionMemoryCases = toNumber(
    overlayAiDecision?.memory_cases ?? replayTelemetry?.memory_cases_used,
    0,
  );
  const overlayDecisionRationale = String(
    overlayAiDecision?.rationale || replayTelemetry?.rationale || "",
  );
  const overlayAgentVotes = ((overlayAiDecision?.agent_votes as JsonMap[] | undefined) || []).slice(0, 5);
  const overlayDecisionTs = String(replayTelemetry?.ts_decision || "");
  const overlaySlippageExpected = toNumber(replayTelemetry?.slippage_expected_bps, 0);
  const overlaySlippageDelta = replaySlippage - overlaySlippageExpected;
  const overlayRouteAlt = String(replayTelemetry?.route_alternative || "–");
  const overlayLatDecision = toNumber(replayTelemetry?.latency_decision_ms, 0);
  const overlayLatRouting = toNumber(replayTelemetry?.latency_routing_ms, 0);
  const showDecisionOverlay = replayState.enabled && replayTelemetry !== null;
  const showExecOverlay = replayTelemetry !== null;

  // ── CALIBRATION INTELLIGENCE LAYER ─────────────────────────────────────────
  // Score vs Outcome: find the matching outcome for this decision
  const calibMatchedOutcome = (() => {
    if (!replayDecisionId) return null;
    return filteredOutcomes.find(
      (item) => decisionIdFrom(item) === replayDecisionId,
    ) || filteredOutcomes[0] || null;
  })();
  const calibOutcomePnl = calibMatchedOutcome
    ? toNumber(calibMatchedOutcome.pnl_usd, NaN)
    : NaN;
  const calibOutcomePnlPct = calibMatchedOutcome
    ? toNumber(calibMatchedOutcome.pnl_pct, 0)
    : 0;
  const calibOutcomePositive = Number.isFinite(calibOutcomePnl) && calibOutcomePnl >= 0;
  const calibExpectedPositive = overlayDecisionScore >= 0.5;
  const calibMismatch =
    Number.isFinite(calibOutcomePnl) &&
    overlayDecisionScore > 0 &&
    calibExpectedPositive !== calibOutcomePositive;
  const calibMismatchLabel = calibMismatch
    ? (calibExpectedPositive ? "Expected +, Got −" : "Expected −, Got +")
    : null;

  // Confidence calibration: bucket historical outcomes by score range
  const calibBuckets = (() => {
    const buckets = [
      { label: "0.9+", min: 0.9, wins: 0, total: 0 },
      { label: "0.8", min: 0.8, wins: 0, total: 0 },
      { label: "0.7", min: 0.7, wins: 0, total: 0 },
      { label: "<0.7", min: 0, wins: 0, total: 0 },
    ];
    for (const item of filteredOutcomes) {
      const sc = toNumber(item.ai_score ?? item.score, 0);
      const pnl = toNumber(item.pnl_usd, NaN);
      if (!Number.isFinite(pnl) || sc === 0) continue;
      const bucket = buckets.find((b) => sc >= b.min) || buckets[buckets.length - 1];
      bucket.total++;
      if (pnl >= 0) bucket.wins++;
    }
    return buckets.filter((b) => b.total > 0);
  })();
  const calibBadge = (() => {
    if (!calibBuckets.length || overlayDecisionScore === 0) return null;
    const scoreBucket = calibBuckets.find((b) => {
      const minScore = b.min;
      const nextMin = calibBuckets.find((cb) => cb.min > minScore)?.min ?? 1;
      return overlayDecisionScore >= minScore && overlayDecisionScore < nextMin;
    }) || calibBuckets[calibBuckets.length - 1];
    if (scoreBucket.total < 3) return null;
    const winrate = scoreBucket.wins / scoreBucket.total;
    const scoreIsHigh = overlayDecisionScore >= 0.7;
    if (scoreIsHigh && winrate < 0.45) return "overconfident";
    if (!scoreIsHigh && winrate > 0.65) return "underconfident";
    if (winrate >= 0.45 && winrate <= 0.65) return "well-calibrated";
    return null;
  })();

  // Memory validation: memory-backed winrate and avg pnl
  const calibMemoryWinrate = (() => {
    const withScore = filteredOutcomes.filter(
      (item) => toNumber(item.memory_similarity ?? item.memory_cases, 0) > 0,
    );
    if (withScore.length === 0) return null;
    const wins = withScore.filter((item) => toNumber(item.pnl_usd, NaN) >= 0).length;
    return (wins / withScore.length) * 100;
  })();
  const calibMemoryAvgPnlPct = (() => {
    const withScore = filteredOutcomes.filter(
      (item) => toNumber(item.memory_similarity ?? item.memory_cases, 0) > 0,
    );
    if (withScore.length === 0) return null;
    return average(withScore.map((item) => toNumber(item.pnl_pct, 0)));
  })();
  const calibMemoryPredictWin = overlayDecisionMemorySim >= 0.7 || overlayDecisionMemoryCases >= 3;
  const calibMemoryMismatch = calibMemoryPredictWin && Number.isFinite(calibOutcomePnl) && calibOutcomePnl < 0;

  // Execution vs Decision blame
  const calibBlame = (() => {
    if (!replayTelemetry || !Number.isFinite(calibOutcomePnl)) return null;
    const slipDelta = replaySlippage - overlaySlippageExpected;
    if (overlaySlippageExpected > 0 && slipDelta > overlaySlippageExpected * 0.5) {
      return "bad_execution";
    }
    if (overlayDecisionScore >= 0.7 && calibOutcomePnl < 0) {
      return "bad_decision";
    }
    if (calibOutcomePnl < 0) {
      return "market_noise";
    }
    return null;
  })();

  // Agent accuracy tracking across historical outcomes
  const calibAgentAccuracy = (() => {
    if (!filteredOutcomes.length) return [] as Array<{ name: string; accuracy: number; total: number }>;
    const agentMap = new Map<string, { wins: number; total: number }>();
    for (const item of filteredOutcomes) {
      const votes = (item.agent_votes as JsonMap[] | undefined) || [];
      const pnl = toNumber(item.pnl_usd, NaN);
      if (!Number.isFinite(pnl)) continue;
      for (const vote of votes) {
        const name = String(vote.agent || vote.name || "?").slice(0, 10);
        const direction = String(vote.direction || vote.vote || "").toLowerCase();
        const side = String(item.side || "").toLowerCase();
        const correct =
          (direction.includes("buy") && side.includes("buy") && pnl >= 0) ||
          (direction.includes("sell") && side.includes("sell") && pnl >= 0);
        const entry = agentMap.get(name) || { wins: 0, total: 0 };
        entry.total++;
        if (correct) entry.wins++;
        agentMap.set(name, entry);
      }
    }
    return [...agentMap.entries()]
      .map(([name, { wins, total }]) => ({ name, accuracy: total > 0 ? (wins / total) * 100 : 0, total }))
      .filter((a) => a.total >= 2)
      .sort((a, b) => b.accuracy - a.accuracy)
      .slice(0, 4);
  })();

  // Trade lifecycle (Decision → Fill → Outcome) with timestamps
  const calibLifecycle = (() => {
    const steps: Array<{ label: string; ts: string; kind: string }> = [];
    if (replayTelemetry?.ts_decision) steps.push({ label: "Decision", ts: String(replayTelemetry.ts_decision), kind: "decision" });
    if (replayTelemetry?.ts_intent) steps.push({ label: "Intent", ts: String(replayTelemetry.ts_intent), kind: "intent" });
    if (replayTelemetry?.ts_routing) steps.push({ label: "Route", ts: String(replayTelemetry.ts_routing), kind: "routing" });
    if (replayTelemetry?.ts_broker_accept) steps.push({ label: "Approval", ts: String(replayTelemetry.ts_broker_accept), kind: "approval" });
    if (replayTelemetry?.ts_fill_partial) steps.push({ label: "Fill", ts: String(replayTelemetry.ts_fill_partial), kind: "fill" });
    if (replayTelemetry?.ts_fill_final || replayFills.length > 0) {
      const ts = String(replayTelemetry?.ts_fill_final || replayFills[replayFills.length - 1]?.executed_at || "");
      if (ts) steps.push({ label: "Final", ts, kind: "fill" });
    }
    if (calibMatchedOutcome) {
      const outcomeTs = pickTimestamp(calibMatchedOutcome, ["executed_at", "filled_at", "closed_at", "created_at"]);
      if (outcomeTs) steps.push({ label: Number.isFinite(calibOutcomePnl) ? `${calibOutcomePnl >= 0 ? "+" : ""}${calibOutcomePnl.toFixed(0)}$` : "Outcome", ts: outcomeTs, kind: calibOutcomePositive ? "outcome-win" : "outcome-loss" });
    }
    return steps.sort((a, b) => {
      const ta = new Date(a.ts).getTime();
      const tb = new Date(b.ts).getTime();
      return ta - tb;
    });
  })();
  const calibLifecycleDurationMs = calibLifecycle.length > 1
    ? Math.max(1, new Date(calibLifecycle[calibLifecycle.length - 1].ts).getTime() - new Date(calibLifecycle[0].ts).getTime())
    : 1;

  // ── DYNAMIC SCORE CORRECTION ─────────────────────────────────────────────────
  // Derive calibration factor: empirical bucket winrate / model score (expected win rate)
  const calibCurrentBucket = (() => {
    if (!calibBuckets.length || overlayDecisionScore === 0) return null;
    // Sort buckets high→low min so the first matching bucket wins correctly
    const sorted = [...calibBuckets].sort((a, b) => b.min - a.min);
    return sorted.find((b) => overlayDecisionScore >= b.min) ?? null;
  })();
  const calibCurrentWinrate =
    calibCurrentBucket && calibCurrentBucket.total >= 3
      ? calibCurrentBucket.wins / calibCurrentBucket.total
      : null;
  // factor = empirical_winrate / model_score  (clipped [0.3 … 1.8] to avoid runaway)
  const calibFactor =
    calibCurrentWinrate !== null && overlayDecisionScore > 0
      ? Math.max(0.3, Math.min(1.8, calibCurrentWinrate / overlayDecisionScore))
      : 1;
  const adjustedScore = Math.max(0, Math.min(1, overlayDecisionScore * calibFactor));
  const scoreWasAdjusted = Math.abs(adjustedScore - overlayDecisionScore) > 0.02;

  // ── AGENT WEIGHTED VOTE (REGIME-AWARE) ────────────────────────────────────────
  const agentWeightedVotes = overlayAgentVotes.map((vote) => {
    const name = String(vote.agent || vote.name || "").slice(0, 10);
    // Use regime-aware accuracy if available, fall back to global
    const regimeAccuracies = calibAgentAccuracyByRegime[overlayDecisionRegime] || [];
    const regimeAccuracy = regimeAccuracies.find((a) => a.name === name)?.accuracy;
    const accuracy = regimeAccuracy ?? calibAgentAccuracy.find((a) => a.name === name)?.accuracy ?? 50;
    const weight = accuracy / 100;
    return { vote, weight, accuracyPct: accuracy };
  });
  const totalWeight = agentWeightedVotes.reduce((s, v) => s + v.weight, 0);
  const weightedBuyScore = agentWeightedVotes
    .filter((v) => String(v.vote.direction || v.vote.vote || "").toLowerCase().includes("buy"))
    .reduce((s, v) => s + v.weight, 0);
  const weightedSellScore = agentWeightedVotes
    .filter((v) => String(v.vote.direction || v.vote.vote || "").toLowerCase().includes("sell"))
    .reduce((s, v) => s + v.weight, 0);
  const weightedConsensus =
    totalWeight > 0
      ? (Math.max(weightedBuyScore, weightedSellScore) / totalWeight) * 100
      : null;

  // ── CONFIDENCE DECAY ─────────────────────────────────────────────────────────
  const decayHighLatency = replayLatency > 300;
  const decayHighVolatility = overlayDecisionRegime === "high";
  const confidenceDecay = (decayHighLatency ? 0.08 : 0) + (decayHighVolatility ? 0.06 : 0);
  const effectiveScore = Math.max(0, adjustedScore - confidenceDecay);

  // ── CONSENSUS PENALTY ────────────────────────────────────────────────────────
  const consensusPenaltyActive =
    (overlayDecisionConsensus > 0 && overlayDecisionConsensus < 40) ||
    (weightedConsensus !== null && weightedConsensus < 40);

  // ── HIGH RISK BADGE ───────────────────────────────────────────────────────────
  // High model confidence but very low memory alignment → uncharted territory
  const isHighRisk =
    overlayDecisionScore >= 0.7 &&
    overlayDecisionMemorySim < 0.4 &&
    overlayDecisionMemoryCases < 2;

  // ── STRATEGY SURVIVAL ENGINE W/ HYSTERESIS ────────────────────────────────────
  // Hysteresis/cooldown: demote/reduce status locked for 48h to prevent oscillation
  const HYSTERESIS_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours
  const strategyPerformance = (() => {
    const stratMap = new Map<
      string,
      { wins: number; total: number; pnlSum: number; mismatches: number; regime: string }
    >();
    for (const item of filteredOutcomes) {
      const sid = String(item.strategy_id || "unknown");
      const pnl = toNumber(item.pnl_usd, NaN);
      const sc = toNumber((item.ai_score ?? item.score) as number | undefined, 0);
      const regime = String(item.regime || "unknown");
      if (!Number.isFinite(pnl)) continue;
      const entry = stratMap.get(sid) || { wins: 0, total: 0, pnlSum: 0, mismatches: 0, regime };
      entry.total++;
      if (pnl >= 0) entry.wins++;
      entry.pnlSum += pnl;
      // Mismatch: model expected win (score ≥ 0.5) but got loss
      if (sc >= 0.5 && pnl < 0) entry.mismatches++;
      stratMap.set(sid, entry);
    }
    const now = Date.now();
    return [...stratMap.entries()]
      .map(([id, { wins, total, pnlSum, mismatches, regime }]) => {
        const wr = total > 0 ? wins / total : 0;
        const mismatchRate = total > 0 ? mismatches / total : 0;
        // Calculate live status (what it should be)
        const liveStatus: "demote" | "reduce" | "overconfident" | "ok" = (() => {
          if (wr < 0.35 && total >= 5) return "demote";
          if (wr < 0.45 && total >= 3) return "reduce";
          if (mismatchRate > 0.4 && total >= 4) return "overconfident";
          return "ok";
        })();
        // Apply hysteresis: check if strategy is in cooldown
        const cooldown = strategyCooldowns[id];
        let currentStatus = liveStatus;
        let cooldownRemaining = 0;
        if (liveStatus === "ok" && (cooldown?.demoteTime || cooldown?.reduceTime)) {
          // Strategy wants to exit demote/reduce
          const exitTime = cooldown.demoteTime || cooldown.reduceTime || 0;
          const elapsed = now - exitTime;
          if (elapsed < HYSTERESIS_WINDOW_MS) {
            // Still in cooldown: keep old status
            currentStatus = cooldown.demoteTime ? "demote" : "reduce";
            cooldownRemaining = Math.ceil((HYSTERESIS_WINDOW_MS - elapsed) / (60 * 60 * 1000)); // hours
          }
        }
        // Update cooldown entries when entering demote/reduce
        if (currentStatus === "demote" && !cooldown?.demoteTime) {
          setStrategyCooldowns((prev) => ({
            ...prev,
            [id]: { ...prev[id], demoteTime: now },
          }));
        } else if (currentStatus === "reduce" && !cooldown?.reduceTime && !cooldown?.demoteTime) {
          setStrategyCooldowns((prev) => ({
            ...prev,
            [id]: { ...prev[id], reduceTime: now },
          }));
        }
        return {
          id,
          winrate: wr * 100,
          total,
          avgPnl: total > 0 ? pnlSum / total : 0,
          mismatchRate: mismatchRate * 100,
          status: currentStatus,
          liveStatus,
          cooldownRemaining,
          regime,
        };
      })
      .filter((s) => s.total >= 2)
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  })();
  const strategyDemoteCount = strategyPerformance.filter((s) => s.status === "demote").length;
  const strategyReduceCount = strategyPerformance.filter(
    (s) => s.status === "reduce" || s.status === "overconfident",
  ).length;

  // ── REGIME-AWARE CALIBRATION BUCKETS ─────────────────────────────────────────
  // Segment calibration by regime (low/medium/high/unknown) to catch regime-specific overconfidence
  const calibBucketsByRegime = (() => {
    const regimeIndex = new Map<string, typeof calibBuckets>();
    for (const item of filteredOutcomes) {
      const regime = String(item.regime || "unknown");
      const sc = toNumber(item.ai_score ?? item.score, 0);
      const pnl = toNumber(item.pnl_usd, NaN);
      if (!Number.isFinite(pnl) || sc === 0) continue;
      if (!regimeIndex.has(regime)) {
        regimeIndex.set(regime, [
          { label: "0.9+", min: 0.9, wins: 0, total: 0 },
          { label: "0.8", min: 0.8, wins: 0, total: 0 },
          { label: "0.7", min: 0.7, wins: 0, total: 0 },
          { label: "<0.7", min: 0, wins: 0, total: 0 },
        ]);
      }
      const buckets = regimeIndex.get(regime)!;
      const bucket = buckets.find((b) => sc >= b.min) || buckets[buckets.length - 1];
      bucket.total++;
      if (pnl >= 0) bucket.wins++;
    }
    const result: Record<string, typeof calibBuckets> = {};
    for (const [regime, buckets] of regimeIndex.entries()) {
      result[regime] = buckets.filter((b) => b.total > 0);
    }
    return result;
  })();

  // ── REGIME-AWARE AGENT ACCURACY ───────────────────────────────────────────────
  // Track agent prediction accuracy per regime
  const calibAgentAccuracyByRegime = (() => {
    const regimeIndex = new Map<string, Map<string, { wins: number; total: number }>>();
    for (const item of filteredOutcomes) {
      const regime = String(item.regime || "unknown");
      const votes = (item.agent_votes as JsonMap[] | undefined) || [];
      const pnl = toNumber(item.pnl_usd, NaN);
      if (!Number.isFinite(pnl)) continue;
      if (!regimeIndex.has(regime)) {
        regimeIndex.set(regime, new Map());
      }
      const agentMap = regimeIndex.get(regime)!;
      for (const vote of votes) {
        const name = String(vote.agent || vote.name || "?").slice(0, 10);
        const direction = String(vote.direction || vote.vote || "").toLowerCase();
        const side = String(item.side || "").toLowerCase();
        const correct =
          (direction.includes("buy") && side.includes("buy") && pnl >= 0) ||
          (direction.includes("sell") && side.includes("sell") && pnl >= 0);
        const entry = agentMap.get(name) || { wins: 0, total: 0 };
        entry.total++;
        if (correct) entry.wins++;
        agentMap.set(name, entry);
      }
    }
    const result: Record<string, Array<{ name: string; accuracy: number; total: number }>> = {};
    for (const [regime, agentMap] of regimeIndex.entries()) {
      result[regime] = [...agentMap.entries()]
        .map(([name, { wins, total }]) => ({ name, accuracy: total > 0 ? (wins / total) * 100 : 0, total }))
        .filter((a) => a.total >= 2)
        .sort((a, b) => b.accuracy - a.accuracy)
        .slice(0, 5);
    }
    return result;
  })();

  // ── REGIME-AWARE EMA STRATEGY WIN RATE ────────────────────────────────────────
  // EMA WR per strategy per regime for more granular allocation
  const strategyEmaWRByRegime = (() => {
    const regimeIndex = new Map<string, Map<string, number>>();
    const sorted = [...filteredOutcomes]
      .filter((o) => Number.isFinite(toNumber(o.pnl_usd, NaN)))
      .sort((a, b) => {
        const ta = new Date(String(a.executed_at || a.filled_at || "")).getTime() || 0;
        const tb = new Date(String(b.executed_at || b.filled_at || "")).getTime() || 0;
        return ta - tb;
      });
    const EMA_ALPHA = 0.3;
    for (const item of sorted) {
      const regime = String(item.regime || "unknown");
      const sid = String(item.strategy_id || "unknown");
      const win = toNumber(item.pnl_usd, 0) >= 0 ? 1 : 0;
      if (!regimeIndex.has(regime)) {
        regimeIndex.set(regime, new Map());
      }
      const stratMap = regimeIndex.get(regime)!;
      const prev = stratMap.get(sid) ?? 0.5;
      stratMap.set(sid, prev + EMA_ALPHA * (win - prev));
    }
    const result: Record<string, Map<string, number>> = {};
    for (const [regime, stratMap] of regimeIndex.entries()) {
      result[regime] = stratMap;
    }
    return result;
  })();

  // ── BRIER SCORE & CALIBRATION ERROR TRACKING ──────────────────────────────────
  // Quantify model calibration quality and systematic over/under-confidence
  const brierAnalysis = (() => {
    const calcBrier = (items: JsonMap[]) => {
      if (items.length === 0) return { brierScore: null, overconfidence: 0 };
      let brierSum = 0;
      let overconfidenceSum = 0;
      for (const item of items) {
        const score = toNumber(item.ai_score ?? item.score, 0.5);
        const pnl = toNumber(item.pnl_usd, NaN);
        if (!Number.isFinite(pnl)) continue;
        const outcome = pnl >= 0 ? 1 : 0;
        // Brier = (predicted - actual)²
        brierSum += (score - outcome) ** 2;
        // Overconfidence: how much did we overestimate at this score?
        // Positive = overconfident (predicted > actual), Negative = underconfident
        overconfidenceSum += score - outcome;
      }
      return { brierScore: brierSum / items.length, overconfidence: overconfidenceSum / items.length };
    };
    const overall = calcBrier(filteredOutcomes);
    const byRegime: Record<string, { brierScore: number | null; overconfidence: number }> = {};
    for (const regime of Object.keys(calibBucketsByRegime)) {
      const regimeOutcomes = filteredOutcomes.filter((o) => String(o.regime || "unknown") === regime);
      byRegime[regime] = calcBrier(regimeOutcomes);
    }
    return { overall, byRegime };
  })();

  // ── REGIME AUTO-BLOCKING (BRIER DEGRADATION) ───────────────────────────────
  const regimeRiskMonitor = (() => {
    const byRegime: Record<string, {
      recentBrier: number | null;
      previousBrier: number | null;
      delta: number;
      nRecent: number;
      nPrevious: number;
      blocked: boolean;
      reason: string | null;
    }> = {};
    const regimes = new Set(filteredOutcomes.map((o) => String(o.regime || "unknown")));
    for (const regime of regimes) {
      const samples = [...filteredOutcomes]
        .filter((o) => String(o.regime || "unknown") === regime)
        .filter((o) => Number.isFinite(toNumber(o.pnl_usd, NaN)))
        .sort((a, b) => {
          const ta = new Date(String(a.executed_at || a.filled_at || "")).getTime() || 0;
          const tb = new Date(String(b.executed_at || b.filled_at || "")).getTime() || 0;
          return ta - tb;
        });
      const previous = samples.slice(-20, -10);
      const recent = samples.slice(-10);
      const brierOf = (arr: JsonMap[]) => {
        if (!arr.length) return null;
        const sum = arr.reduce((s, it) => {
          const score = toNumber(it.ai_score ?? it.score, 0.5);
          const pnl = toNumber(it.pnl_usd, NaN);
          const out = Number.isFinite(pnl) && pnl >= 0 ? 1 : 0;
          return s + (score - out) ** 2;
        }, 0);
        return sum / arr.length;
      };
      const prevBrier = brierOf(previous);
      const recBrier = brierOf(recent);
      const delta =
        recBrier !== null && prevBrier !== null
          ? recBrier - prevBrier
          : 0;
      const blocked =
        recent.length >= 6 &&
        previous.length >= 6 &&
        recBrier !== null &&
        recBrier > 0.38 &&
        delta > 0.1;
      byRegime[regime] = {
        recentBrier: recBrier,
        previousBrier: prevBrier,
        delta,
        nRecent: recent.length,
        nPrevious: previous.length,
        blocked,
        reason: blocked
          ? `Brier degrade ${prevBrier?.toFixed(2)}→${recBrier?.toFixed(2)} (Δ${delta.toFixed(2)})`
          : null,
      };
    }
    const blockedRegimes = Object.entries(byRegime)
      .filter(([, v]) => v.blocked)
      .map(([k]) => k);
    return { byRegime, blockedRegimes };
  })();
  const isCurrentRegimeBlocked =
    overlayDecisionRegime !== "–" && regimeRiskMonitor.blockedRegimes.includes(overlayDecisionRegime);

  // ── CALIBRATION ERROR BY CONFIDENCE BUCKET ────────────────────────────────────
  // Identify which confidence ranges are over/under-calibrated
  const calibrationErrorBuckets = (() => {
    const buckets = [
      { rangeLabel: "0.0-0.1", min: 0.0, max: 0.1, wins: 0, total: 0 },
      { rangeLabel: "0.1-0.2", min: 0.1, max: 0.2, wins: 0, total: 0 },
      { rangeLabel: "0.2-0.3", min: 0.2, max: 0.3, wins: 0, total: 0 },
      { rangeLabel: "0.3-0.4", min: 0.3, max: 0.4, wins: 0, total: 0 },
      { rangeLabel: "0.4-0.5", min: 0.4, max: 0.5, wins: 0, total: 0 },
      { rangeLabel: "0.5-0.6", min: 0.5, max: 0.6, wins: 0, total: 0 },
      { rangeLabel: "0.6-0.7", min: 0.6, max: 0.7, wins: 0, total: 0 },
      { rangeLabel: "0.7-0.8", min: 0.7, max: 0.8, wins: 0, total: 0 },
      { rangeLabel: "0.8-0.9", min: 0.8, max: 0.9, wins: 0, total: 0 },
      { rangeLabel: "0.9-1.0", min: 0.9, max: 1.0, wins: 0, total: 0 },
    ];
    for (const item of filteredOutcomes) {
      const score = toNumber(item.ai_score ?? item.score, 0);
      const pnl = toNumber(item.pnl_usd, NaN);
      if (!Number.isFinite(pnl)) continue;
      const bucket = buckets.find((b) => score >= b.min && score <= b.max);
      if (bucket) {
        bucket.total++;
        if (pnl >= 0) bucket.wins++;
      }
    }
    // Calculate calibration error = expected WR - actual WR
    // Positive = overconfident (model expected too high), Negative = underconfident
    return buckets.map((b) => {
      const expectedWR = b.min + (b.max - b.min) / 2; // midpoint of range as expected WR
      const actualWR = b.total > 0 ? b.wins / b.total : 0;
      const calibError = expectedWR - actualWR;
      const isOverconfident = calibError > 0.1; // > 10% off
      const isUnderconfident = calibError < -0.1;
      return {
        ...b,
        expectedWR: Math.round(expectedWR * 100),
        actualWR: Math.round(actualWR * 100),
        calibError: Math.round(calibError * 100),
        isOverconfident,
        isUnderconfident,
      };
    }).filter((b) => b.total > 0);
  })();

  // ── PORTFOLIO CORRELATION LAYER ────────────────────────────────────────────────
  // Strategy correlation matrix with shrinkage to prevent overfitting on small samples
  
  // 1. Strategy Pairwise Correlation Matrix (shrinkage-adjusted)
  const strategyCorrelationMatrix = (() => {
    const matrix: Record<string, Record<string, {corr: number; n: number; flag: string}>> = {};
    const strategies = strategyPerformance.filter(s => s.total >= 5); // Only stable strategies
    
    for (const s1 of strategies) {
      if (!matrix[s1.id]) matrix[s1.id] = {};
      
      for (const s2 of strategies) {
        if (s1.id === s2.id) {
          matrix[s1.id][s2.id] = { corr: 1.0, n: s1.total, flag: 'self' };
          continue;
        }
        if (matrix[s1.id][s2.id]) continue; // Already computed
        
        // Get trades for both strategies
        const s1Trades = filteredOutcomes
          .filter(o => o.strategy_id === s1.id)
          .sort((a, b) => {
            const ta = new Date(String(a.executed_at || a.filled_at || "")).getTime() || 0;
            const tb = new Date(String(b.executed_at || b.filled_at || "")).getTime() || 0;
            return ta - tb;
          })
          .slice(-20); // Last 20 trades
        
        const s2Trades = filteredOutcomes
          .filter(o => o.strategy_id === s2.id)
          .sort((a, b) => {
            const ta = new Date(String(a.executed_at || a.filled_at || "")).getTime() || 0;
            const tb = new Date(String(b.executed_at || b.filled_at || "")).getTime() || 0;
            return ta - tb;
          })
          .slice(-20);
        
        // Guard: must have min samples
        if (s1Trades.length < 5 || s2Trades.length < 5) {
          matrix[s1.id][s2.id] = { corr: NaN, n: Math.min(s1Trades.length, s2Trades.length), flag: 'LOW_SAMPLE' };
          continue;
        }
        
        // Align by time: match trades in overlapping windows
        const s1PnL = s1Trades.map(t => toNumber(t.pnl_usd, 0));
        const s2PnL = s2Trades.map(t => toNumber(t.pnl_usd, 0));
        
        // Pearson correlation
        const rawCorr = pearsonCorrelation(s1PnL, s2PnL);
        
        // Guard: correlation must be valid
        if (!Number.isFinite(rawCorr)) {
          matrix[s1.id][s2.id] = { corr: NaN, n: Math.min(s1Trades.length, s2Trades.length), flag: 'INVALID' };
          continue;
        }
        
        // Apply shrinkage to reduce false positives on small n
        const n = Math.min(s1Trades.length, s2Trades.length);
        const shrunkCorr = shrinkageCorrelation(rawCorr, n, 10); // k=10 shrinkage strength
        
        // Classify correlation level
        const flag = Math.abs(shrunkCorr) > 0.7 ? 'REDUNDANT' : Math.abs(shrunkCorr) > 0.5 ? 'MODERATE' : 'INDEPENDENT';
        
        matrix[s1.id][s2.id] = { corr: shrunkCorr, n, flag };
        matrix[s2.id][s1.id] = { corr: shrunkCorr, n, flag }; // Symmetric
      }
    }
    return matrix;
  })();

  // 2. Cluster Detection: Find groups of highly correlated strategies
  const strategyClusterGroups = (() => {
    const visited = new Set<string>();
    const clusters: string[][] = [];
    const strategies = Object.keys(strategyCorrelationMatrix);
    
    for (const strat of strategies) {
      if (visited.has(strat)) continue;
      
      const cluster = [strat];
      visited.add(strat);
      
      for (const other of strategies) {
        if (visited.has(other) || other === strat) continue;
        
        const corrData = strategyCorrelationMatrix[strat]?.[other];
        if (corrData && Math.abs(corrData.corr) > 0.7) {
          cluster.push(other);
          visited.add(other);
        }
      }
      
      if (cluster.length > 1) {
        clusters.push(cluster);
      }
    }
    return clusters;
  })();

  // 3. Market Exposure Mapping will be calculated after allocSoftmax (deferred)
  // 4. Sample Size Confidence will be calculated after allocActiveStratId (deferred)
  
  // 5. Correlation Penalty will be calculated after allocActiveStratId (deferred)

  // ── BAYESIAN SHRINKAGE ────────────────────────────────────────────────────────
  // Prior β=0.5 (50% WR), k=8 (prior strength = 8 equivalent trades)
  // Prevents overfit on small samples while converging to empirical on large ones
  const SHRINK_K = 8;
  const PRIOR_BETA = 0.5;
  const bayesianWR = calibCurrentBucket
    ? (calibCurrentBucket.wins + SHRINK_K * PRIOR_BETA) /
      (calibCurrentBucket.total + SHRINK_K)
    : null;
  const calibFactorBayes =
    bayesianWR !== null && overlayDecisionScore > 0
      ? Math.max(0.3, Math.min(1.8, bayesianWR / overlayDecisionScore))
      : calibFactor;
  const adjustedScoreBayes = Math.max(0, Math.min(1, overlayDecisionScore * calibFactorBayes));
  // Wilson 90% CI — exposes uncertainty to the operator (WR: 62% ±18%)
  const calibWinrateCI =
    calibCurrentBucket && calibCurrentBucket.total >= 2
      ? (() => {
          const n = calibCurrentBucket.total;
          const p = calibCurrentBucket.wins / n;
          const z = 1.645;
          const margin = z * Math.sqrt((p * (1 - p)) / Math.max(1, n));
          return { low: Math.max(0, p - margin), high: Math.min(1, p + margin) };
        })()
      : null;

  // ── MICROSTRUCTURE DECAY ──────────────────────────────────────────────────────
  // Use spread_bps from microstructure API; fall back to latestQuote price-spread ÷ mid
  const microSpreadBps = (() => {
    const fromMicro = toNumber(marketMicro?.spread_bps, NaN);
    if (Number.isFinite(fromMicro)) return fromMicro;
    const ask = toNumber(latestQuote?.ask, 0);
    const bid = toNumber(latestQuote?.bid, 0);
    const mid = ask > 0 && bid > 0 ? (ask + bid) / 2 : 0;
    return mid > 0 ? ((ask - bid) / mid) * 10_000 : 0;
  })();
  const microImbalance = Math.abs(toNumber(marketMicro?.depth_imbalance, 0));
  const decayWideSpread = microSpreadBps > 8;
  const decayExtremeImbalance = microImbalance > 0.6;
  const microDecay = (decayWideSpread ? 0.04 : 0) + (decayExtremeImbalance ? 0.03 : 0);
  // Full effective score = Bayesian-adjusted minus ALL decay sources
  const effectiveScoreFull = Math.max(0, adjustedScoreBayes - confidenceDecay - microDecay);

  // ── EXECUTION QUALITY SCORE ───────────────────────────────────────────────────
  const execQualityScore = replayTelemetry
    ? (() => {
        const slipRatio =
          overlaySlippageExpected > 0 ? replaySlippage / overlaySlippageExpected : 1;
        const latScore =
          replayLatency < 100 ? 1.0
          : replayLatency < 200 ? 0.85
          : replayLatency < 400 ? 0.6
          : 0.3;
        const slipScore =
          slipRatio <= 1.0 ? 1.0
          : slipRatio <= 1.5 ? 0.75
          : slipRatio <= 2.5 ? 0.5
          : 0.2;
        const spreadScore =
          microSpreadBps < 4 ? 1.0
          : microSpreadBps < 8 ? 0.8
          : microSpreadBps < 15 ? 0.55
          : 0.3;
        return latScore * 0.4 + slipScore * 0.4 + spreadScore * 0.2;
      })()
    : null;
  const execQualityLabel =
    execQualityScore === null ? null
    : execQualityScore >= 0.8 ? "good"
    : execQualityScore >= 0.55 ? "fair"
    : "poor";

  // ── EXTENDED BLAME TAGS ───────────────────────────────────────────────────────
  // regime_mismatch / memory_bias / latency_spike added to existing blame logic
  const extendedBlame: string | null = (() => {
    if (!replayTelemetry || !Number.isFinite(calibOutcomePnl)) return null;
    if (replayLatency > 500) return "latency_spike";
    if (
      calibMatchedOutcome &&
      overlayDecisionRegime !== "–" &&
      String(calibMatchedOutcome.regime || "") !== "" &&
      String(calibMatchedOutcome.regime || "") !== overlayDecisionRegime
    )
      return "regime_mismatch";
    if (calibMemoryMismatch) return "memory_bias";
    return calibBlame;
  })();

  // ── EMA-SMOOTHED STRATEGY WIN RATE ────────────────────────────────────────────
  // Recency-weighted WR (α=0.3) — more stable than raw ratio for allocation weights
  const strategyEmaWR = (() => {
    const EMA_ALPHA = 0.3;
    const emaMap = new Map<string, number>();
    const sorted = [...filteredOutcomes]
      .filter((o) => Number.isFinite(toNumber(o.pnl_usd, NaN)))
      .sort((a, b) => {
        const ta =
          new Date(String(a.executed_at || a.filled_at || "")).getTime() || 0;
        const tb =
          new Date(String(b.executed_at || b.filled_at || "")).getTime() || 0;
        return ta - tb;
      });
    for (const item of sorted) {
      const sid = String(item.strategy_id || "unknown");
      const win = toNumber(item.pnl_usd, 0) >= 0 ? 1 : 0;
      const prev = emaMap.get(sid) ?? 0.5;
      emaMap.set(sid, prev + EMA_ALPHA * (win - prev));
    }
    return emaMap;
  })();

  // ── CONSENSUS GATING ─────────────────────────────────────────────────────────
  const requiresHumanApprovalBase =
    consensusPenaltyActive ||
    isHighRisk ||
    (extendedBlame === "latency_spike" && effectiveScoreFull > 0.6);

  // ── CAPITAL ALLOCATION ENGINE V1 (REGIME-AWARE) ────────────────────────────────
  const ALLOC_GLOBAL_CAP = 0.02;  // 2% max exposure per decision
  const ALLOC_STRAT_CAP  = 0.015; // 1.5% max per strategy
  // Regime fit: how well current regime matches model's training distribution
  const allocRegimeFit =
    overlayDecisionRegime === "low"    ? 1.0
    : overlayDecisionRegime === "medium" ? 0.8
    : overlayDecisionRegime === "high"   ? 0.55
    : 0.7;
  // Regime calibration multiplier: apply Brier-based confidence penalty if regime is poorly calibrated
  const regimeCalibMultiplier = (() => {
    const regimeBrier = brierAnalysis.byRegime[overlayDecisionRegime];
    if (!regimeBrier?.brierScore) return 1.0;
    // Brier score 0.25 = perfect, 0.5 = random, clamp to [0.15, 0.5]
    const brier = Math.max(0.15, Math.min(0.5, regimeBrier.brierScore));
    // Map: 0.15 (perfect) → 1.0x, 0.5 (random) → 0.5x
    return 1.0 - (brier - 0.15) / (0.35);
  })();
  const allocActiveStratId = calibMatchedOutcome
    ? String(calibMatchedOutcome.strategy_id || "")
    : "";
  const allocActiveStrat = strategyPerformance.find((s) => s.id === allocActiveStratId);
  const allocDrawdownPenalty =
    allocActiveStrat?.status === "demote"        ? 0.8
    : allocActiveStrat?.status === "reduce"       ? 0.45
    : allocActiveStrat?.status === "overconfident" ? 0.25
    : 0;
  // Use regime-aware EMA WR if available, fall back to global
  const allocEmaWR = allocActiveStratId
    ? (strategyEmaWRByRegime[overlayDecisionRegime]?.get(allocActiveStratId) ?? strategyEmaWR.get(allocActiveStratId) ?? 0.5)
    : 0.5;
  const allocHealthWeight = Math.max(0.1, allocEmaWR * 1.6 - 0.3);
  const allocHighRiskFactor = isHighRisk ? 0.5 : 1.0;
  // Initial raw signal (before correlation/sample penalties, which are computed later)
  const allocRawSignalBase =
    effectiveScoreFull *
    allocRegimeFit *
    regimeCalibMultiplier *
    (1 - allocDrawdownPenalty) *
    allocHealthWeight *
    allocHighRiskFactor;
  // Softmax distribution across strategies (temperature=3 sharpens winners)
  const allocSoftmax = (() => {
    if (!strategyPerformance.length)
      return [] as Array<{ id: string; pct: number; factors?: Record<string, number> }>;
    const TEMP = 3;
    const entries = strategyPerformance.map((s) => {
      // Use regime-aware EMA WR
      const ew = strategyEmaWRByRegime[overlayDecisionRegime]?.get(s.id) ?? strategyEmaWR.get(s.id) ?? s.winrate / 100;
      const pen =
        s.status === "demote"        ? 0.1
        : s.status === "reduce"       ? 0.5
        : s.status === "overconfident" ? 0.65
        : 1.0;
      return { id: s.id, raw: Math.max(0.001, ew * pen) };
    });
    const expSum = entries.reduce((sum, e) => sum + Math.exp(e.raw * TEMP), 0);
    return entries.map((e) => ({
      id: e.id,
      pct: Math.min(
        ALLOC_STRAT_CAP * 100,
        expSum > 0 ? (Math.exp(e.raw * TEMP) / expSum) * ALLOC_GLOBAL_CAP * 100 * 2 : 0,
      ),
    }));
  })();

  // ── DEFERRED CALCULATIONS (after allocSoftmax and allocActiveStratId) ──────
  
  // 3. Market Exposure Mapping (weighted by allocation)
  const marketExposureByCluster = (() => {
    const markets = ['crypto', 'fx', 'indices', 'cfd', 'futures'];
    const result: Record<string, {
      exposure: number;
      strategyCount: number;
      cap: number;
      flag: boolean;
      flagLabel: string;
    }> = {};
    
    for (const market of markets) {
      const activaStratsInMarket = strategyPerformance.filter(s => {
        const outcomes = filteredOutcomes.filter(o => o.strategy_id === s.id);
        return outcomes.some(o => classifyInstrument(instrumentLabel(o)) === market);
      });
      
      // Calculate exposure: sum of allocations for strategies in this market
      const totalExposure = activaStratsInMarket.reduce((sum, s) => {
        const alloc = allocSoftmax.find(a => a.id === s.id)?.pct || 0;
        return sum + alloc / 100; // Convert pct to decimal
      }, 0);
      
      const cap = 0.04; // 4% max per market
      const flag = totalExposure > cap;
      
      result[market] = {
        exposure: totalExposure,
        strategyCount: activaStratsInMarket.length,
        cap,
        flag,
        flagLabel: flag ? `⚠️ OVER CAP (${(totalExposure * 100).toFixed(1)}% > 4%)` : `✓ ${(totalExposure * 100).toFixed(1)}%`,
      };
    }
    return result;
  })();

  // 4. Sample Size Confidence Intervals (per active strategy)
  const sampleConfidenceInfo = (() => {
    if (!allocActiveStratId) return null;
    
    const outcomes = filteredOutcomes.filter(o => o.strategy_id === allocActiveStratId);
    const n = outcomes.filter(o => Number.isFinite(toNumber(o.pnl_usd, NaN))).length;
    
    if (n === 0) return null;
    
    const wins = outcomes.filter(o => toNumber(o.pnl_usd, 0) >= 0).length;
    const wr = wins / n;
    
    // Determine confidence tier
    let tier: 'LOW' | 'MEDIUM' | 'HIGH' = 'HIGH';
    let allocModifier = 1.0;
    let displayLabel = `✓ (n=${n})`;
    
    if (n < 5) {
      tier = 'LOW';
      allocModifier = 0.5; // Cap at 50%
      displayLabel = `⚠️ LOW SAMPLE (n=${n}, 50% cap)`;
    } else if (n < 15) {
      tier = 'MEDIUM';
      allocModifier = 0.75; // Cap at 75%
      displayLabel = `⚠️ LOW CONF (n=${n}, 75% cap)`;
    }
    
    const ci = confidenceInterval(wr, n, 1.96); // 95% CI
    
    return {
      n,
      wr,
      wrPct: Math.round(wr * 100),
      ciLow: Math.round(ci.low * 100),
      ciHigh: Math.round(ci.high * 100),
      ciWidth: Math.round(ci.width * 100),
      tier,
      allocModifier,
      displayLabel,
    };
  })();

  // 5. Correlation Penalty (sigmoid-like formula - smooth, stable)
  const corrPenalty = (() => {
    // Find all strategies correlated with active strategy
    if (!allocActiveStratId) return 0;
    
    const correlatedStrategies = Object.keys(strategyCorrelationMatrix[allocActiveStratId] || {})
      .filter(otherId => {
        const data = strategyCorrelationMatrix[allocActiveStratId]?.[otherId];
        return data && Math.abs(data.corr) > 0.7; // Only high correlation
      })
      .filter(otherId => {
        // Only penalize if we also have low sample for either
        const data = strategyCorrelationMatrix[allocActiveStratId]?.[otherId];
        return !data?.flag?.includes('LOW_SAMPLE');
      });
    
    if (correlatedStrategies.length === 0) return 0;
    
    // Sum allocations of correlated strategies
    const correlatedAllocSum = correlatedStrategies.reduce((sum, otherId) => {
      const alloc = allocSoftmax.find(a => a.id === otherId)?.pct || 0;
      return sum + alloc / 100;
    }, 0);
    
    // Current strategy allocation
    const currentAlloc = (allocSoftmax.find(a => a.id === allocActiveStratId)?.pct || 0) / 100;
    
    // Total cluster size
    const clusterSize = correlatedAllocSum + currentAlloc;
    
    // Sigmoid-like penalty: 1 - exp(-2 * (clusterSize / 5%))
    // asymptotic to 1.0, smooth, no jumps
    const penalty = sigmoidPenalty(clusterSize / 0.05, 2);
    
    // Cap at 0.4 to avoid extinction
    return Math.min(0.4, penalty);
  })();

  // ── META-RISK OFFICER ───────────────────────────────────────────────────────
  const metaRiskOfficer = (() => {
    let health = 1;
    const issues: string[] = [];
    const runbooks: Array<{ type: string; severity: "low" | "medium" | "high" | "critical"; auto: boolean; recommendedAction: string }> = [];

    const overallBrier = brierAnalysis.overall.brierScore;
    if (overallBrier !== null && overallBrier > 0.35) {
      health -= 0.2;
      issues.push("brier_high");
      runbooks.push({ type: "calibration_drift", severity: "high", auto: false, recommendedAction: "raise confidence threshold + reduce size" });
    }

    const currentRegimeRisk = regimeRiskMonitor.byRegime[overlayDecisionRegime];
    if (currentRegimeRisk?.blocked) {
      health -= 0.22;
      issues.push("regime_blocked");
      runbooks.push({ type: "regime_block", severity: "critical", auto: true, recommendedAction: `block regime ${overlayDecisionRegime}` });
    }

    const maxClusterExposure = Object.values(marketExposureByCluster).reduce((m, e) => Math.max(m, e.exposure), 0);
    if (maxClusterExposure > 0.05) {
      health -= 0.18;
      issues.push("cluster_concentration");
      runbooks.push({ type: "cluster_exposure", severity: "high", auto: false, recommendedAction: "reduce correlated strategies exposure" });
    }

    const cooldownCount = strategyPerformance.filter((s) => s.cooldownRemaining > 0).length;
    if (cooldownCount >= 3) {
      health -= 0.12;
      issues.push("strategy_churn");
      runbooks.push({ type: "strategy_churn", severity: "medium", auto: false, recommendedAction: "freeze new strategy promotions" });
    }

    if (venueQualityScore < 0.55) {
      health -= 0.15;
      issues.push("venue_degradation");
      runbooks.push({ type: "venue_degradation", severity: "high", auto: false, recommendedAction: "switch broker / route backup" });
    }

    if (consensusPenaltyActive) {
      health -= 0.08;
      issues.push("consensus_unstable");
    }

    // Health momentum: EMA(10) - EMA(30) on decision quality proxy
    const healthProxySeries = [...filteredOutcomes]
      .filter((o) => Number.isFinite(toNumber(o.pnl_usd, NaN)))
      .sort((a, b) => {
        const ta = new Date(String(a.executed_at || a.filled_at || "")).getTime() || 0;
        const tb = new Date(String(b.executed_at || b.filled_at || "")).getTime() || 0;
        return ta - tb;
      })
      .slice(-80)
      .map((o) => {
        const score = toNumber(o.ai_score ?? o.score, 0.5);
        const pnl = toNumber(o.pnl_usd, NaN);
        const outcome = Number.isFinite(pnl) && pnl >= 0 ? 1 : 0;
        const brier = (score - outcome) ** 2;
        return Math.max(0, 1 - brier * 1.3);
      });
    const ema10 = emaLast(healthProxySeries, 10);
    const ema30 = emaLast(healthProxySeries, 30);
    const healthMomentum = ema10 - ema30;
    if (healthMomentum < -0.05) {
      health -= 0.1;
      issues.push("health_downtrend");
      runbooks.push({ type: "health_momentum_drop", severity: "medium", auto: false, recommendedAction: "tighten approval and reduce aggressiveness" });
    }

    const bounded = Math.max(0.1, Math.min(1, health));
    const tier =
      bounded < 0.25 ? "kill-switch"
      : bounded < 0.35 ? "force-suggest"
      : bounded < 0.5 ? "critical"
      : bounded < 0.7 ? "high"
      : bounded < 0.85 ? "medium"
      : "normal";
    const globalCapitalMultiplier =
      tier === "kill-switch" ? 0
      : tier === "force-suggest" ? 0.25
      : tier === "critical" ? 0.5
      : tier === "high" ? 0.7
      : tier === "medium" ? 0.85
      : 1;
    const mustHumanApprove = tier !== "normal";
    return {
      healthScore: bounded,
      healthMomentum,
      tier,
      globalCapitalMultiplier,
      mustHumanApprove,
      issues,
      runbooks,
    };
  })();

  useEffect(() => {
    const blockedRegimes = regimeRiskMonitor.blockedRegimes;
    const blockedRegimesKey = blockedRegimes.slice().sort().join("|");
    const venueLabel = activeVenueMetrics?.venue || "n/a";
    const current = {
      tier: metaRiskOfficer.tier,
      capitalMultiplier: metaRiskOfficer.globalCapitalMultiplier,
      blockedRegimesKey,
      venueLabel,
    };

    if (!metaRiskPrevRef.current) {
      metaRiskPrevRef.current = current;
      return;
    }

    const previous = metaRiskPrevRef.current;
    const changed =
      previous.tier !== current.tier ||
      Math.abs(previous.capitalMultiplier - current.capitalMultiplier) > 0.001 ||
      previous.blockedRegimesKey !== current.blockedRegimesKey ||
      previous.venueLabel !== current.venueLabel;

    if (!changed) return;

    const reasons: string[] = [];
    if (previous.tier !== current.tier) reasons.push(`tier ${previous.tier}→${current.tier}`);
    if (Math.abs(previous.capitalMultiplier - current.capitalMultiplier) > 0.001) {
      reasons.push(`capital ${(previous.capitalMultiplier * 100).toFixed(0)}→${(current.capitalMultiplier * 100).toFixed(0)}%`);
    }
    if (previous.blockedRegimesKey !== current.blockedRegimesKey) {
      reasons.push(current.blockedRegimesKey ? `blocked regimes: ${current.blockedRegimesKey}` : "regime blocks cleared");
    }
    if (previous.venueLabel !== current.venueLabel) reasons.push(`venue ${previous.venueLabel}→${current.venueLabel}`);
    if (metaRiskOfficer.issues.length) reasons.push(`issues: ${metaRiskOfficer.issues.join(",")}`);

    const timestampIso = new Date().toISOString();
    const event: MetaRiskAuditEvent = {
      id: `${timestampIso}-${current.tier}-${Math.round(current.capitalMultiplier * 100)}`,
      timestampIso,
      tierFrom: previous.tier,
      tierTo: current.tier,
      capitalFromPct: previous.capitalMultiplier * 100,
      capitalToPct: current.capitalMultiplier * 100,
      reason: reasons.join(" · "),
      healthScore: metaRiskOfficer.healthScore,
      blockedRegimes,
      venue: venueLabel,
    };

    setMetaRiskAuditTrail((prev) => [event, ...prev].slice(0, 40));
    metaRiskPrevRef.current = current;
  }, [
    activeVenueMetrics?.venue,
    metaRiskOfficer.globalCapitalMultiplier,
    metaRiskOfficer.healthScore,
    metaRiskOfficer.issues,
    metaRiskOfficer.tier,
    regimeRiskMonitor.blockedRegimes,
  ]);

  useEffect(() => {
    setMetaRiskHealthHistory((prev) => [...prev, metaRiskOfficer.healthScore].slice(-30));
  }, [metaRiskOfficer.healthScore]);

  // Now apply sample modifier and correlation penalty to final allocation signal
  const allocSampleModifier = sampleConfidenceInfo?.allocModifier ?? 1.0;
  const allocRegimeBlockMultiplier = isCurrentRegimeBlocked ? 0 : 1;
  const allocMetaRiskMultiplier = metaRiskOfficer.globalCapitalMultiplier;
  const allocRawSignal =
    allocRawSignalBase *
    (1 - corrPenalty) *
    allocSampleModifier *
    venueQualityMultiplier *
    allocRegimeBlockMultiplier *
    allocMetaRiskMultiplier;

  const requiresHumanApproval =
    requiresHumanApprovalBase ||
    isCurrentRegimeBlocked ||
    metaRiskOfficer.mustHumanApprove;

  const filteredMetaRiskAuditTrail = metaRiskAuditShowOnlyDrops
    ? metaRiskAuditTrail.filter((evt) => evt.capitalToPct < evt.capitalFromPct)
    : metaRiskAuditTrail;
  const sortedMetaRiskAuditTrail = (() => {
    const rows = [...filteredMetaRiskAuditTrail];
    if (metaRiskAuditDropSort === "largest") {
      rows.sort((a, b) => {
        const dropA = a.capitalFromPct - a.capitalToPct;
        const dropB = b.capitalFromPct - b.capitalToPct;
        if (Math.abs(dropB - dropA) > 0.001) return dropB - dropA;
        return new Date(b.timestampIso).getTime() - new Date(a.timestampIso).getTime();
      });
      return rows;
    }
    rows.sort((a, b) => new Date(b.timestampIso).getTime() - new Date(a.timestampIso).getTime());
    return rows;
  })();

  const portfolioRiskV3 = (() => {
    const pnlPctSeries = filteredOutcomes
      .map((item) => toNumber(item.pnl_pct, NaN))
      .filter((value) => Number.isFinite(value));
    const pnlUsdSeries = filteredOutcomes
      .map((item) => toNumber(item.pnl_usd, NaN))
      .filter((value) => Number.isFinite(value));
    const sortedPct = [...pnlPctSeries].sort((a, b) => a - b);
    const sortedUsd = [...pnlUsdSeries].sort((a, b) => a - b);
    const tailCount = Math.max(1, Math.floor(sortedPct.length * 0.05));
    const var95Pct = sortedPct.length ? quantileSortedAsc(sortedPct, 0.05) : 0;
    const es95Pct = sortedPct.length ? average(sortedPct.slice(0, tailCount)) : 0;
    const var95Usd = sortedUsd.length ? quantileSortedAsc(sortedUsd, 0.05) : 0;
    const es95Usd = sortedUsd.length ? average(sortedUsd.slice(0, Math.max(1, Math.floor(sortedUsd.length * 0.05)))) : 0;

    const byMarket: Record<string, number> = { crypto: 0, fx: 0, indices: 0, cfd: 0, futures: 0, other: 0 };
    let grossExposureUsd = 0;
    let netExposureUsd = 0;
    for (const pos of positions) {
      const notional = toNumber(pos.net_notional_usd, 0);
      const absNotional = Math.abs(notional);
      const market = classifyInstrument(instrumentLabel(pos));
      byMarket[market] = (byMarket[market] || 0) + absNotional;
      grossExposureUsd += absNotional;
      netExposureUsd += notional;
    }

    const marketShareRows = Object.entries(byMarket)
      .filter(([, usd]) => usd > 0)
      .map(([market, usd]) => ({ market, usd, share: grossExposureUsd > 0 ? usd / grossExposureUsd : 0 }))
      .sort((a, b) => b.usd - a.usd);
    const topMarket = marketShareRows[0] || null;

    const riskByMarket = ["crypto", "fx", "indices", "cfd", "futures", "other"]
      .map((market) => {
        const marketOutcomes = filteredOutcomes.filter(
          (item) => classifyInstrument(instrumentLabel(item)) === market,
        );
        const pct = marketOutcomes
          .map((item) => toNumber(item.pnl_pct, NaN))
          .filter((value) => Number.isFinite(value))
          .sort((a, b) => a - b);
        const usd = marketOutcomes
          .map((item) => toNumber(item.pnl_usd, NaN))
          .filter((value) => Number.isFinite(value))
          .sort((a, b) => a - b);
        const tail = Math.max(1, Math.floor(pct.length * 0.05));
        return {
          market,
          sample: pct.length,
          var95Pct: pct.length ? quantileSortedAsc(pct, 0.05) : 0,
          es95Pct: pct.length ? average(pct.slice(0, tail)) : 0,
          var95Usd: usd.length ? quantileSortedAsc(usd, 0.05) : 0,
          es95Usd: usd.length ? average(usd.slice(0, Math.max(1, Math.floor(usd.length * 0.05)))) : 0,
        };
      })
      .filter((row) => row.sample > 0)
      .sort((a, b) => b.sample - a.sample);

    const activeId = allocActiveStratId;
    let dynamicCorrMax = 0;
    let dynamicCorrMean = 0;
    let dynamicCorrPeers = 0;
    if (activeId) {
      const activeSeriesRaw = filteredOutcomes
        .filter((o) => String(o.strategy_id || "") === activeId)
        .map((o) => toNumber(o.pnl_pct, NaN))
        .filter((v) => Number.isFinite(v));
      const activeSeries = activeSeriesRaw.slice(-24);
      const corrAbsValues: number[] = [];

      for (const s of strategyPerformance) {
        if (s.id === activeId) continue;
        const peerSeriesRaw = filteredOutcomes
          .filter((o) => String(o.strategy_id || "") === s.id)
          .map((o) => toNumber(o.pnl_pct, NaN))
          .filter((v) => Number.isFinite(v));
        const peerSeries = peerSeriesRaw.slice(-24);
        const n = Math.min(activeSeries.length, peerSeries.length);
        if (n < 6) continue;
        const corr = pearsonCorrelation(activeSeries.slice(-n), peerSeries.slice(-n));
        if (!Number.isFinite(corr)) continue;
        corrAbsValues.push(Math.abs(corr));
      }

      if (corrAbsValues.length) {
        dynamicCorrPeers = corrAbsValues.length;
        dynamicCorrMax = Math.max(...corrAbsValues);
        dynamicCorrMean = average(corrAbsValues);
      }
    }

    return {
      sampleSize: sortedPct.length,
      var95Pct,
      es95Pct,
      var95Usd,
      es95Usd,
      grossExposureUsd,
      netExposureUsd,
      marketShareRows,
      topMarket,
      riskByMarket,
      dynamicCorrMax,
      dynamicCorrMean,
      dynamicCorrPeers,
    };
  })();

  const learningLoopShadow = (() => {
    const stable = strategyPerformance.filter((s) => s.total >= 8);
    if (!stable.length) return [] as Array<{
      id: string;
      wr: number;
      pnlPerTrade: number;
      confidence: number;
      score: number;
      targetWeightPct: number;
      deltaVsEqualPct: number;
      recommendation: "increase" | "decrease" | "hold";
    }>;

    const scored = stable.map((s) => {
      const wr = Math.max(0, Math.min(1, s.winrate / 100));
      const pnlPerTrade = s.avgPnl;
      const conf = Math.max(0, Math.min(1, s.total / 40));
      const pnlNorm = 1 / (1 + Math.exp(-pnlPerTrade / 120));
      const score = Math.max(0.0001, (wr * 0.65 + pnlNorm * 0.35) * (0.6 + conf * 0.4));
      return { id: s.id, wr, pnlPerTrade, confidence: conf, score };
    });

    const sumScore = scored.reduce((sum, row) => sum + row.score, 0);
    const equalWeightPct = 100 / scored.length;
    return scored
      .map((row) => {
        const targetWeightPct = sumScore > 0 ? (row.score / sumScore) * 100 : equalWeightPct;
        const deltaVsEqualPct = targetWeightPct - equalWeightPct;
        const recommendation =
          deltaVsEqualPct > 2 ? "increase"
          : deltaVsEqualPct < -2 ? "decrease"
          : "hold";
        return {
          ...row,
          targetWeightPct,
          deltaVsEqualPct,
          recommendation,
        };
      })
      .sort((a, b) => b.targetWeightPct - a.targetWeightPct)
      .slice(0, 8);
  })();

  const investorSnapshot = {
    generatedAt: new Date().toISOString(),
    riskEngineV3: portfolioRiskV3,
    metaRiskOfficer: {
      tier: metaRiskOfficer.tier,
      healthScore: metaRiskOfficer.healthScore,
      globalCapitalMultiplier: metaRiskOfficer.globalCapitalMultiplier,
      issues: metaRiskOfficer.issues,
    },
    regimeBlock: {
      blockedRegimes: regimeRiskMonitor.blockedRegimes,
    },
    allocation: {
      rawSignal: allocRawSignal,
      corrPenalty,
      sampleModifier: allocSampleModifier,
      venueQualityMultiplier,
      regimeBlockMultiplier: allocRegimeBlockMultiplier,
      metaRiskMultiplier: allocMetaRiskMultiplier,
    },
  };

  const autoTuningRecommendations = learningLoopShadow.map((row) => ({
    strategyId: row.id,
    targetWeightPct: Number(row.targetWeightPct.toFixed(2)),
    confidence: Number(row.confidence.toFixed(3)),
    recommendation: row.recommendation,
    rationale: `wr=${(row.wr * 100).toFixed(1)}%, pnl/trade=${row.pnlPerTrade.toFixed(1)}`,
  }));

  const effectiveAutoTuningRecommendations = (() => {
    let rows = autoTuningRecommendations
      .filter((row) => (row.confidence ?? 1) >= autoTuningMinConfidence)
      .slice(0, autoTuningMaxRecommendations)
      .map((row) => ({
        ...row,
        targetWeightPct: Math.max(autoTuningWeightFloorPct, Math.min(autoTuningWeightCapPct, row.targetWeightPct)),
      }));

    if (autoTuningRenormalize && rows.length > 0) {
      const total = rows.reduce((sum, row) => sum + row.targetWeightPct, 0);
      if (total > 0) {
        rows = rows.map((row) => ({
          ...row,
          targetWeightPct: Number(((row.targetWeightPct / total) * 100).toFixed(4)),
        }));
      }
    }
    return rows;
  })();

  const autoTuningDiffPreview = effectiveAutoTuningRecommendations
    .map((rec) => {
      const fromPct = allocSoftmax.find((a) => a.id === rec.strategyId)?.pct || 0;
      const toPct = rec.targetWeightPct;
      return {
        strategyId: rec.strategyId,
        fromPct,
        toPct,
        deltaPct: toPct - fromPct,
      };
    })
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
    .slice(0, 10);

  const shadowApplyMetrics = (() => {
    const wrByStrategy = new Map(strategyPerformance.map((s) => [s.id, s.winrate / 100]));
    const pnlByStrategy = new Map(strategyPerformance.map((s) => [s.id, s.avgPnl]));
    const currentRows = allocSoftmax.filter((row) => wrByStrategy.has(row.id));
    const shadowRows = effectiveAutoTuningRecommendations.filter((row) => wrByStrategy.has(row.strategyId));

    const currentWeight = currentRows.reduce((sum, row) => sum + row.pct, 0);
    const shadowWeight = shadowRows.reduce((sum, row) => sum + row.targetWeightPct, 0);

    const currentWr = currentWeight > 0
      ? currentRows.reduce((sum, row) => sum + row.pct * (wrByStrategy.get(row.id) || 0), 0) / currentWeight
      : 0;
    const shadowWr = shadowWeight > 0
      ? shadowRows.reduce((sum, row) => sum + row.targetWeightPct * (wrByStrategy.get(row.strategyId) || 0), 0) / shadowWeight
      : 0;

    const currentPnl = currentWeight > 0
      ? currentRows.reduce((sum, row) => sum + row.pct * (pnlByStrategy.get(row.id) || 0), 0) / currentWeight
      : 0;
    const shadowPnl = shadowWeight > 0
      ? shadowRows.reduce((sum, row) => sum + row.targetWeightPct * (pnlByStrategy.get(row.strategyId) || 0), 0) / shadowWeight
      : 0;

    const currentHhi = currentRows.reduce((sum, row) => sum + Math.pow(row.pct / 100, 2), 0);
    const shadowHhi = shadowRows.reduce((sum, row) => sum + Math.pow(row.targetWeightPct / 100, 2), 0);

    return {
      currentWr,
      shadowWr,
      deltaWr: shadowWr - currentWr,
      currentPnl,
      shadowPnl,
      deltaPnl: shadowPnl - currentPnl,
      currentHhi,
      shadowHhi,
      deltaHhi: shadowHhi - currentHhi,
      sampleStrategies: currentRows.length,
    };
  })();

  const rollbackGuard = (() => {
    if (!rollbackGuardSession) {
      return {
        active: false,
        elapsedMin: 0,
        remainingMin: 0,
        healthDrop: 0,
        brierRise: 0,
        degradeHealth: false,
        degradeBrier: false,
        shouldProposeRollback: false,
      };
    }
    const now = Date.now();
    const startedAt = new Date(rollbackGuardSession.startedAtIso).getTime();
    const elapsedMin = Math.max(0, (now - startedAt) / 60000);
    const remainingMin = Math.max(0, rollbackGuardWindowMin - elapsedMin);
    const baselineHealth = rollbackGuardSession.baselineHealth;
    const baselineBrier = rollbackGuardSession.baselineBrier;
    const currentHealth = metaRiskOfficer.healthScore;
    const currentBrier = brierAnalysis.overall.brierScore;

    const healthDrop = Math.max(0, baselineHealth - currentHealth);
    const brierRise = baselineBrier !== null && currentBrier !== null
      ? Math.max(0, currentBrier - baselineBrier)
      : 0;
    const degradeHealth = healthDrop >= rollbackGuardHealthDrop;
    const degradeBrier = brierRise >= rollbackGuardBrierRise;
    const active = remainingMin > 0;
    const shouldProposeRollback = active && (degradeHealth || degradeBrier);

    return {
      active,
      elapsedMin,
      remainingMin,
      healthDrop,
      brierRise,
      degradeHealth,
      degradeBrier,
      shouldProposeRollback,
    };
  })();

  const rollbackProposalRecommendations = rollbackGuardSession
    ? rollbackGuardSession.baselineWeights.map((row) => ({
      strategyId: row.strategyId,
      targetWeightPct: Number(row.pct.toFixed(2)),
      confidence: 1,
      recommendation: "rollback",
      rationale: "rollback_guard_baseline",
    }))
    : [];

  async function refreshRollbackGuardState(): Promise<void> {
    if (!AUTO_TUNING_WRITEBACK_ENABLED) return;
    try {
      const response = await fetch("/api/strategies/auto-tuning/rollback-guard", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      const active = (payload?.activeSession || null) as RollbackGuardSession | null;
      const history = (Array.isArray(payload?.history) ? payload.history : []) as RollbackGuardSession[];
      setRollbackGuardSession(active);
      setRollbackGuardHistory(history.slice(0, 20));
      if (active) {
        setRollbackGuardWindowMin(Math.max(10, Math.min(480, Math.round(active.windowMin || rollbackGuardWindowMin))));
        setRollbackGuardHealthDrop(Math.max(0.01, Math.min(0.5, active.healthDropThreshold || rollbackGuardHealthDrop)));
        setRollbackGuardBrierRise(Math.max(0.005, Math.min(0.2, active.brierRiseThreshold || rollbackGuardBrierRise)));
      }
    } catch {
      // Optional ops sync; keep UI functional if backend state can't be read.
    }
  }

  async function submitAutoTuningWriteback(
    dryRun: boolean,
    overrideRecommendations?: Array<{
      strategyId: string;
      targetWeightPct: number;
      confidence?: number;
      recommendation?: string;
      rationale?: string;
    }>,
    reasonOverride?: string,
  ): Promise<void> {
    const recommendations = overrideRecommendations && overrideRecommendations.length > 0
      ? overrideRecommendations
      : effectiveAutoTuningRecommendations;

    if (!AUTO_TUNING_WRITEBACK_ENABLED || autoTuningBusy || recommendations.length === 0) {
      return;
    }
    setAutoTuningBusy(true);
    setAutoTuningStatus("");
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (autoTuningIdempotencyKey.trim()) {
        headers["x-idempotency-key"] = autoTuningIdempotencyKey.trim();
      }
      if (autoTuningAdminKey.trim()) {
        headers["x-auto-tuning-admin-key"] = autoTuningAdminKey.trim();
      }
      const requestPayload = {
        dryRun,
        reason: reasonOverride || "mission-control learning loop",
        recommendations,
        minConfidence: autoTuningMinConfidence,
        maxRecommendations: autoTuningMaxRecommendations,
        weightFloorPct: autoTuningWeightFloorPct,
        weightCapPct: autoTuningWeightCapPct,
        renormalizeTo100: autoTuningRenormalize,
      };
      const bodyText = JSON.stringify(requestPayload);
      const response = await fetch("/api/strategies/auto-tuning", {
        method: "POST",
        headers,
        body: bodyText,
      });
      const payload = await response.json();
      if (!response.ok) {
        setAutoTuningStatus(`Write-back refused (${response.status})`);
        return;
      }
      setAutoTuningStatus(String(payload?.message || (dryRun ? "Dry-run accepted" : "Write-back accepted")));
      if (!dryRun) {
        const sessionPayload: RollbackGuardSession = {
          id: `rg-${Date.now()}`,
          startedAtIso: new Date().toISOString(),
          baselineHealth: metaRiskOfficer.healthScore,
          baselineBrier: brierAnalysis.overall.brierScore,
          baselineWeights: allocSoftmax.map((row) => ({ strategyId: row.id, pct: row.pct })),
          windowMin: rollbackGuardWindowMin,
          healthDropThreshold: rollbackGuardHealthDrop,
          brierRiseThreshold: rollbackGuardBrierRise,
          source: "mission-control-ui",
          reason: "writeback-apply",
          status: "active",
          observations: [],
        };
        setRollbackGuardSession(sessionPayload);
        await fetch("/api/strategies/auto-tuning/rollback-guard", {
          method: "POST",
          headers,
          body: JSON.stringify({ action: "start", session: sessionPayload }),
        });
        await refreshRollbackGuardState();
      }
      const refresh = await fetch("/api/strategies/auto-tuning", { cache: "no-store" });
      if (refresh.ok) {
        const next = await refresh.json();
        const rows = Array.isArray(next?.entries) ? next.entries : [];
        setAutoTuningAuditTrail(rows.slice(0, 20));
      }
      setAutoTuningIdempotencyKey(
        typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-idempotency`,
      );
    } catch {
      setAutoTuningStatus("Write-back error");
    } finally {
      setAutoTuningBusy(false);
    }
  }

  useEffect(() => {
    if (!AUTO_TUNING_WRITEBACK_ENABLED) return;
    void refreshRollbackGuardState();
    const timer = window.setInterval(() => {
      void refreshRollbackGuardState();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!AUTO_TUNING_WRITEBACK_ENABLED || !rollbackGuardSession || rollbackGuardSession.status !== "active") return;

    const pushObservation = async () => {
      try {
        await fetch("/api/strategies/auto-tuning/rollback-guard", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(autoTuningAdminKey.trim() ? { "x-auto-tuning-admin-key": autoTuningAdminKey.trim() } : {}),
          },
          body: JSON.stringify({
            action: "observe",
            observation: {
              timestampIso: new Date().toISOString(),
              currentHealth: metaRiskOfficer.healthScore,
              currentBrier: brierAnalysis.overall.brierScore,
              healthDrop: rollbackGuard.healthDrop,
              brierRise: rollbackGuard.brierRise,
              degradeHealth: rollbackGuard.degradeHealth,
              degradeBrier: rollbackGuard.degradeBrier,
              shouldProposeRollback: rollbackGuard.shouldProposeRollback,
            },
          }),
        });
      } catch {
        // best effort ops heartbeat
      }
    };

    void pushObservation();
    const timer = window.setInterval(() => {
      void pushObservation();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [
    autoTuningAdminKey,
    brierAnalysis.overall.brierScore,
    metaRiskOfficer.healthScore,
    rollbackGuard.brierRise,
    rollbackGuard.degradeBrier,
    rollbackGuard.degradeHealth,
    rollbackGuard.healthDrop,
    rollbackGuard.shouldProposeRollback,
    rollbackGuardSession?.id,
    rollbackGuardSession?.status,
  ]);

  useEffect(() => {
    if (!AUTO_TUNING_WRITEBACK_ENABLED || !rollbackGuardSession || rollbackGuardSession.status !== "active") return;
    if (rollbackGuard.active) {
      rollbackGuardClosedRef.current = "";
      return;
    }
    if (rollbackGuardClosedRef.current === rollbackGuardSession.id) return;
    rollbackGuardClosedRef.current = rollbackGuardSession.id;
    void fetch("/api/strategies/auto-tuning/rollback-guard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(autoTuningAdminKey.trim() ? { "x-auto-tuning-admin-key": autoTuningAdminKey.trim() } : {}),
      },
      body: JSON.stringify({ action: "close", reason: "window_elapsed" }),
    }).then(() => {
      void refreshRollbackGuardState();
    });
  }, [AUTO_TUNING_WRITEBACK_ENABLED, autoTuningAdminKey, rollbackGuard.active, rollbackGuardSession?.id, rollbackGuardSession?.status]);

  const dropPressure24h = (() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const drops = metaRiskAuditTrail.filter(
      (e) => e.capitalToPct < e.capitalFromPct && new Date(e.timestampIso).getTime() >= cutoff,
    );
    const total = drops.reduce((sum, e) => sum + (e.capitalFromPct - e.capitalToPct), 0);
    const largest = drops.reduce((m, e) => Math.max(m, e.capitalFromPct - e.capitalToPct), 0);
    return { count: drops.length, totalContraction: total, largestDrop: largest };
  })();

  const recommendedAllocPct = Math.min(
    ALLOC_GLOBAL_CAP * 100,
    Math.max(0, allocRawSignal * ALLOC_GLOBAL_CAP * 100 * 4),
  );
  const allocTier =
    recommendedAllocPct >= 1.5 ? "full"
    : recommendedAllocPct >= 0.7 ? "reduced"
    : "minimal";

  const dominantFootprint = footprintRows[0] || null;
  const uniqueOverlayZones = overlayZones.filter((zone, index, zones) => zones.findIndex((candidate) => (
    candidate.kind === zone.kind
    && candidate.label === zone.label
    && Math.abs(candidate.low - zone.low) < 0.01
    && Math.abs(candidate.high - zone.high) < 0.01
  )) === index);
  const activeOverlayZones = showFvgOb ? uniqueOverlayZones : [];
  const activeLiquidityZones = showLiquidity ? liquidityZones : [];
  const overlaySummary = activeOverlayZones.map((zone) => zone.label).join(" · ");
  const liquiditySummary = activeLiquidityZones.map((zone) => zone.level.toFixed(0)).join(" / ");
  const chartHeaderSpread = latestQuote
    ? Math.max(0, toNumber(latestQuote.ask, 0) - toNumber(latestQuote.bid, 0))
    : 0;
  const marketMatrixRows = filteredQuotes
    .filter((quote, index, rows) => rows.findIndex((candidate) => instrumentLabel(candidate) === instrumentLabel(quote)) === index)
    .slice(0, 7)
    .map((quote) => {
      const symbol = instrumentLabel(quote);
      const metrics = marketMetricsBySymbol[symbol];
      const history = quoteHistory[symbol] || [];
      const first = history[0]?.value ?? toNumber(quote.last, 0);
      const last = history[history.length - 1]?.value ?? toNumber(quote.last, 0);
      const deltaPct = first > 0 ? ((last - first) / first) * 100 : 0;
      const spread = Math.max(0, toNumber(quote.ask, 0) - toNumber(quote.bid, 0));
      const regime = volatilityRegime(history);
      const sentimentScore = (metrics?.depthImbalance ?? 0) + deltaPct / 100;
      return {
        symbol,
        price: toNumber(quote.last, 0),
        deltaPct,
        spread,
        venue: String(quote.venue || "–"),
        funding: metrics ? `${(metrics.fundingRate * 100).toFixed(3)}%` : "–",
        openInterest: metrics && metrics.openInterest > 0 ? metrics.openInterest.toFixed(0) : "–",
        volume: metrics ? metrics.volume : 0,
        volatilityRegime: regime,
        sentiment: sentimentScore >= 0 ? "risk-on" : "risk-off",
      };
    });

  const healthyConnectors = connectors.filter((item) => Boolean(item.healthy)).length;
  const brokersDown = connectors.filter((item) => !Boolean(item.healthy)).length;
  const criticalAlerts = alerts.filter((item) => String(item.level || "") === "critical").length;
  const openIncidents = incidents.filter((item) => String(item.status || "") !== "closed").length;
  const riskGateway = connectors.find((item) => String(item.name || "") === "risk-gateway");
  const agentsHealthy = providerRows.filter((item) => Boolean(item.available)).length;

  const governanceRows = [
    { label: "Kill switch", value: String(overview?.kill_switch_active || "off"), severity: String(overview?.kill_switch_active) === "true" ? 3 : 1 },
    { label: "Agents suspendus", value: String(suspended.length), severity: suspended.length > 0 ? 3 : 1 },
    { label: "Brokers down", value: String(brokersDown), severity: brokersDown > 0 ? 3 : 1 },
    { label: "Approvals", value: String(pendingLive.length), severity: pendingLive.length > 0 ? 2 : 1 },
    { label: "MT5 bridge", value: String(mt5Health?.status || "–"), severity: String(mt5Health?.status || "") === "ok" ? 1 : 2 },
    { label: "Drift", value: String(driftItems.filter((d) => Boolean(d.drift_detected)).length), severity: driftItems.some((d) => Boolean(d.drift_detected)) ? 2 : 1 },
    { label: "Similarity", value: String(memorySummary.avg_final_similarity || "–"), severity: 1 },
    { label: "Memory impact", value: String(memorySummary.avg_memory_impact || "–"), severity: 1 },
    { label: "SLA breach", value: String(incidents.filter((i) => Boolean(i.sla_breached)).length), severity: incidents.some((i) => Boolean(i.sla_breached)) ? 3 : 1 },
  ];
  const governanceQuery = governanceFilterText.trim().toLowerCase();
  const governanceFiltered = governanceRows
    .filter((row) => !governanceOnlyAlerts || row.severity >= 2)
    .filter((row) => !governanceQuery || row.label.toLowerCase().includes(governanceQuery) || row.value.toLowerCase().includes(governanceQuery))
    .sort((left, right) => {
      if (governanceSort === "label") {
        return left.label.localeCompare(right.label);
      }
      if (governanceSort === "value") {
        return right.value.localeCompare(left.value, undefined, { numeric: true });
      }
      return right.severity - left.severity;
    });
  const incidentRows = incidents
    .map((item) => ({
      item,
      status: String(item.status || "open"),
      severityLabel: incidentSeverityLabel(item),
      severityRank: incidentSeverityRank(item),
      slaLabel: incidentSlaLabel(item),
    }))
    .filter((row) => !governanceOnlyAlerts || row.severityRank >= 3 || row.slaLabel === "breach")
    .filter((row) => {
      if (!governanceQuery) {
        return true;
      }

      const ticket = String(row.item.ticket_key || "").toLowerCase();
      const title = String(row.item.title || "").toLowerCase();
      const status = row.status.toLowerCase();
      return ticket.includes(governanceQuery)
        || title.includes(governanceQuery)
        || status.includes(governanceQuery)
        || row.severityLabel.includes(governanceQuery)
        || row.slaLabel.includes(governanceQuery);
    })
    .sort((left, right) => {
      if (incidentSort === "status") {
        return incidentStatusRank(right.item) - incidentStatusRank(left.item);
      }
      if (incidentSort === "sla") {
        return Number(Boolean(right.item.sla_breached)) - Number(Boolean(left.item.sla_breached));
      }
      return right.severityRank - left.severityRank;
    });

  const highlightedFootprintIndex = activeTimeKey
    ? activeFootprintRows.findIndex((row) => row.timeKey === activeTimeKey)
    : -1;
  const highlightedDomIndex = strictDepthTimeMatch && Number.isFinite(activePrice)
    ? activeDomLevels.findIndex((level) => Math.abs(level.price - activePrice) < Math.max(2, activePrice * 0.0005))
    : -1;
  const highlightedHeatmapIndex = strictDepthTimeMatch && Number.isFinite(activePrice)
    ? activeHeatmapLevels.findIndex((level) => Math.abs(level.price - activePrice) < Math.max(2, activePrice * 0.0005))
    : -1;
  const highlightedTapeIndex = activeTimeKey
    ? activeTape.findIndex((print) => print.timeKey === activeTimeKey)
    : -1;

  const renderRiskTimelineBody = (rowLimit: number, keyPrefix: string): ReactNode => {
    const thresholdAtLimit = riskAlertMissThreshold >= riskAlertWindow;
    const pollingStale = riskPollingFailures > 2;
    const hardAlertThreshold = Math.max(20, Math.min(95, riskHardAlertThresholdPct));
    const hardAlertLocal = Boolean(riskHardAlertEnabled) && toNumber(riskSummary?.ratio_miss_window, 0) * 100 >= hardAlertThreshold;
    const presetLabel = layoutPreset === "scalp" ? "Scalp 4/12" : layoutPreset === "monitoring" ? "Monitoring 2/8" : "Swing 3/10";

    return (
      <>
        {hardAlertLocal ? <div className="hard-alert-inline">Hard alert actif dans ce panel</div> : null}
        <div className="risk-timeline-toolbar">
          <button type="button" className={`chart-chip ${riskTimelineFilter === "all" ? "active" : ""}`} onClick={() => setRiskTimelineFilter("all")}>all</button>
          <button type="button" className={`chart-chip ${riskTimelineFilter === "compliant" ? "active" : ""}`} onClick={() => setRiskTimelineFilter("compliant")}>ok</button>
          <button type="button" className={`chart-chip ${riskTimelineFilter === "miss" ? "active" : ""}`} onClick={() => setRiskTimelineFilter("miss")}>miss</button>
        </div>
        <div className="risk-summary-kpis">
          <span className="kpi">ok {riskSummary?.count_ok ?? 0}</span>
          <span className={`kpi ${(riskSummary?.count_miss || 0) > 0 ? "warn" : ""}`}>miss {riskSummary?.count_miss ?? 0}</span>
          <span className="kpi gtix-ellipsis">reason {riskSummary?.last_block_reason || "none"}</span>
          <span className={`kpi ${thresholdAtLimit ? "warn" : ""}`}>ratio {((toNumber(riskSummary?.ratio_miss_window, 0) * 100)).toFixed(0)}%</span>
                  <span className={`kpi gtix-ellipsis ${pollingStale ? "warn" : ""}`}>poll {riskPollingStatus.lastRefreshIso ? `${formatClock(riskPollingStatus.lastRefreshIso)} · ${Math.max(0, Math.round(toNumber(riskPollingStatus.latencyMs, 0)))}ms · ${riskPollingStatus.source || "-"} · ${riskPollAgeSec}s` : "pending"}</span>
        </div>
        <div className="risk-timeline-controls">
          <label className="risk-control-field"><span>From</span><input type="datetime-local" value={riskTimelineFrom} onChange={(event) => setRiskTimelineFrom(event.target.value)} /></label>
          <label className="risk-control-field"><span>To</span><input type="datetime-local" value={riskTimelineTo} onChange={(event) => setRiskTimelineTo(event.target.value)} /></label>
          <label className="risk-control-field"><span>Window</span><input
            type="number"
            min={3}
            max={100}
            value={riskAlertWindow}
            onChange={(event) => {
              const nextWindow = Math.max(3, Math.min(100, Number(event.target.value) || DEFAULT_RISK_ALERT_WINDOW));
              setRiskAlertWindow(nextWindow);
              setRiskAlertMissThreshold((current) => Math.min(nextWindow, Math.max(1, current)));
            }}
          /></label>
          <label className={`risk-control-field ${thresholdAtLimit ? "risk-threshold-guard" : ""}`}><span>Threshold</span><input
            type="number"
            min={1}
            max={riskAlertWindow}
            value={riskAlertMissThreshold}
            onChange={(event) => {
              const nextThreshold = Math.max(1, Math.min(riskAlertWindow, Number(event.target.value) || DEFAULT_RISK_ALERT_MISS_THRESHOLD));
              setRiskAlertMissThreshold(nextThreshold);
            }}
          /></label>
          <label className="risk-control-field"><span>Refresh</span><select value={String(riskTimelineRefreshSec)} onChange={(event) => {
            const nextValue = Number(event.target.value);
            setRiskTimelineRefreshSec(nextValue === 5 || nextValue === 30 ? nextValue : 15);
          }}>
            <option value="5">5s</option>
            <option value="15">15s</option>
            <option value="30">30s</option>
          </select></label>
          <label className="risk-control-field"><span>Hard alert</span><select value={riskHardAlertEnabled ? "on" : "off"} onChange={(event) => {
            setRiskHardAlertEnabled(event.target.value === "on");
          }}>
            <option value="off">off</option>
            <option value="on">on</option>
          </select></label>
          <label className="risk-control-field"><span>Hard %</span><input
            type="number"
            min={20}
            max={95}
            value={Math.round(riskHardAlertThresholdPct)}
            onChange={(event) => {
              const nextHardThreshold = Math.max(20, Math.min(95, Number(event.target.value) || DEFAULT_HARD_ALERT_RATIO_PCT));
              setRiskHardAlertThresholdPct(nextHardThreshold);
            }}
          /></label>
          <button type="button" className="chart-chip" onClick={() => { void exportRiskHistory("json"); }}>export json</button>
          <button type="button" className="chart-chip" onClick={() => { void exportRiskHistory("csv"); }}>export csv</button>
          <button type="button" className="chart-chip" onClick={() => { void exportComplianceZip(); }}>export zip</button>
          <button type="button" className="chart-chip" onClick={resetWorkspaceRiskAlert}>reset</button>
        </div>
        {pollingStale ? <p className="subtle mini warn">Polling stale: plus de 2 cycles sans succes.</p> : null}
        {thresholdAtLimit ? <p className="subtle mini warn">Guardrail: threshold a atteint la fenetre (alerte au moindre miss).</p> : null}
        <p className="subtle mini">preset actif: {presetLabel}</p>
        {riskTimelineRows.length === 0 ? <p className="subtle mini">Aucun event risque.</p> : null}
        {riskTimelineRows.slice(0, rowLimit).map((entry, ri) => (
          <div key={`${keyPrefix}-${ri}-${entry.atIso}`} className="risk-timeline-row">
            <span>{formatClock(entry.atIso)}</span>
            <span className="gtix-ellipsis">{entry.symbol}</span>
            <span>{entry.side.toUpperCase()}</span>
            <span>RR {entry.rr.toFixed(2)}</span>
            <span className={entry.compliant ? "good" : "warn"}>{entry.compliant ? "ok" : "miss"}</span>
            <span className="subtle mini">{entry.source || "local"}</span>
            <span className="subtle mini">{entry.outcome === "confirmation-required" ? "confirm" : entry.outcome}</span>
          </div>
        ))}
      </>
    );
  };

  // ─── Floating panel content renderer ─────────────────────────────────────
  function renderDockPanelContent(id: DockPanelId): ReactNode {
    switch (id) {
      case "dom":
        return (
          <div style={{ height: "100%", overflow: "auto" }}>
          <PanelShell className="panel micro-panel">
            <div className="eyebrow micro-panel-title">DOM <span className={`micro-stream-badge micro-stream-${depthStreamState}`}>{depthStreamState}</span></div>
            <div className="dom-table-compact">
              <div className="dom-header-row"><span>Side</span><span>Prix</span><span>Taille</span><span>Profondeur</span></div>
              {activeDomLevels.map((lvl, di) => (
                <div key={`fdom-${di}`} className={`dom-row-compact ${lvl.side}`}>
                  <span className={`dom-side-label ${lvl.side}`}>{lvl.side === "ask" ? "A" : "B"}</span>
                  <span className="dom-price">{lvl.price.toFixed(1)}</span>
                  <span className="dom-size">{lvl.size}</span>
                  <span className="dom-bar-cell"><span style={{ width: `${Math.min(100, lvl.intensity * 100)}%` }} /></span>
                </div>
              ))}
            </div>
          </PanelShell>
          </div>
        );
      case "footprint":
        return (
          <div style={{ height: "100%", overflow: "auto" }}>
          <PanelShell className="panel micro-panel">
            <div className="eyebrow micro-panel-title">Footprint</div>
            <div className="footprint-compact">
              <div className="fp-header-row"><span>Niveau</span><span className="good">Buy</span><span className="warn">Sell</span><span>Δ</span></div>
              {activeFootprintRows.map((row, fpi) => (
                <div key={`ffp-${fpi}`} className="fp-row-compact">
                  <span className="fp-level">{row.timeLabel ? `${row.timeLabel} · ` : ""}{row.high.toFixed(0)}–{row.low.toFixed(0)}</span>
                  <span className="good fp-num">{row.buyVolume.toFixed(0)}</span>
                  <span className="warn fp-num">{row.sellVolume.toFixed(0)}</span>
                  <span className={`fp-num ${row.delta >= 0 ? "good" : "warn"}`}>{row.delta.toFixed(0)}</span>
                </div>
              ))}
            </div>
          </PanelShell>
          </div>
        );
      case "tape":
        return (
          <div style={{ height: "100%", overflow: "auto" }}>
          <PanelShell className="panel micro-panel">
            <div className="eyebrow micro-panel-title">Tape</div>
            <div className="tape-compact">
              {activeTape.map((print, ti) => (
                <div key={`ftp-${ti}`} className={`tape-row-compact ${print.side}`}>
                  <span className="tape-time">{print.label.slice(-8)}</span>
                  <span className="tape-price">{print.price.toFixed(1)}</span>
                  <span className="tape-vol">{print.volume}</span>
                  <span className={`tape-badge ${print.side}`}>{print.side === "buy" ? "B" : print.side === "sell" ? "S" : "–"}</span>
                </div>
              ))}
            </div>
          </PanelShell>
          </div>
        );
      case "heatmap":
        return (
          <div style={{ height: "100%", overflow: "auto" }}>
          <PanelShell className="panel micro-panel">
            <div className="eyebrow micro-panel-title">Heatmap <span className="subtle mini" style={{ marginLeft: 6 }}>{String(sessionState?.session || "–")}</span></div>
            <div className="heatmap-compact">
              {activeHeatmapLevels.map((lvl, hi) => (
                <div key={`fhm-${hi}`} className={`hm-row ${lvl.side}`} style={{ opacity: Math.max(0.2, lvl.intensity) }}>
                  <span className="hm-price">{lvl.price.toFixed(1)}</span>
                  <div className="hm-bar-wrap"><div className={`hm-bar ${lvl.side}`} style={{ width: `${Math.min(100, lvl.intensity * 100)}%` }} /></div>
                  <span className="hm-size">{lvl.size}</span>
                </div>
              ))}
            </div>
          </PanelShell>
          </div>
        );
      case "blotter":
        return (
          <div style={{ height: "100%", overflow: "auto" }}>
          <PanelShell className="panel term-blotter-panel">
            <div className="eyebrow">Blotter d'exécution</div>
            {filteredOutcomes.length === 0 ? <p className="subtle mini" style={{ marginTop: 8 }}>Aucune exécution.</p> : null}
            {filteredOutcomes.length > 0 ? (
              <div className="blotter-scroll">
                <table className="blotter-table" style={{ marginTop: 8 }}>
                  <thead><tr><th>Time</th><th>Symbol</th><th>PnL</th><th>Slip</th><th>Status</th></tr></thead>
                  <tbody>
                    {filteredOutcomes.slice(0, 8).map((item, bi) => (
                      <tr key={`fbl-${bi}`}>
                        <td>{String(item.created_at || "–").slice(11, 19)}</td>
                        <td>{instrumentLabel(item)}</td>
                        <td className={toNumber(item.net_result_usd, 0) >= 0 ? "good" : "warn"}>{toNumber(item.net_result_usd, 0).toFixed(2)}</td>
                        <td>{toNumber(item.slippage_real_bps, 0).toFixed(1)}bps</td>
                        <td>{String(item.status || "–").slice(0, 8)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </PanelShell>
          </div>
        );
      case "brokers":
        return (
          <div style={{ height: "100%", overflow: "auto" }}>
          <PanelShell className="panel term-brokers-panel">
            <div className="eyebrow">Brokers · Agents · Capital</div>
            <div className="brokers-grid">
              <div className="brokers-section">
                <div className="chart-stat-label" style={{ marginBottom: 6 }}>Agents IA</div>
                {providerRows.slice(0, 5).map((item, agI) => (
                  <div key={`fbr-ag-${agI}`} className="agent-row">
                    <span className="agent-name gtix-ellipsis">{String(item.route || "–").slice(0, 14)}</span>
                    <span className={Boolean(item.available) ? "good mini" : "warn mini"}>{Boolean(item.available) ? "●" : "○"}</span>
                  </div>
                ))}
              </div>
              <div className="brokers-section">
                <div className="chart-stat-label" style={{ marginBottom: 6 }}>Capital</div>
                {balances.slice(0, 5).map((item) => (
                  <div key={String(item.currency || "")} className="balance-row">
                    <span className="balance-ccy">{String(item.currency || "–")}</span>
                    <span className="balance-val gtix-ellipsis">{String(item.free || "–")}</span>
                  </div>
                ))}
              </div>
              <div className="brokers-section">
                <div className="chart-stat-label" style={{ marginBottom: 6 }}>Positions</div>
                {positions.slice(0, 5).map((item) => (
                  <div key={instrumentLabel(item)} className="pos-row">
                    <span className="pos-sym gtix-ellipsis">{instrumentLabel(item).slice(0, 10)}</span>
                    <span className="balance-val">{toNumber(item.net_notional_usd, 0).toFixed(0)}</span>
                  </div>
                ))}
              </div>
            </div>
          </PanelShell>
          </div>
        );
      case "alerts":
        return (
          <div className="monitoring-col" style={{ height: "100%", overflow: "auto" }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Alertes actives</div>
            {filteredAlerts.length === 0 ? <p className="subtle mini">Aucune alerte.</p> : null}
            {filteredAlerts.slice(0, 10).map((item, ali) => (
              <div key={`fal-${ali}`} className="mon-row">
                <span className={String(item.level) === "critical" ? "warn" : ""}>{String(item.type || "–")}</span>
                <span className="subtle mini">{String(item.message || "").slice(0, 48)}</span>
              </div>
            ))}
          </div>
        );
      case "incidents":
        return (
          <div className="monitoring-col" style={{ height: "100%", overflow: "auto" }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Incidents</div>
            {incidents.length === 0 ? <p className="subtle mini">Aucun incident.</p> : null}
            {incidentRows.slice(0, 8).map(({ item, status, severityLabel, slaLabel }) => (
              <div key={String(item.ticket_key || "")} className="mon-row incident-row">
                <span>{String(item.ticket_key || "–")}</span>
                <span className="subtle mini">{String(item.title || "–").slice(0, 28)}</span>
                <span className="incident-meta-strip">
                  <span className={`incident-chip incident-chip-status-${status.toLowerCase()}`}>{status}</span>
                  <span className={`incident-chip incident-chip-severity-${severityLabel}`}>{severityLabel}</span>
                  <span className={`incident-chip ${slaLabel === "breach" ? "incident-chip-sla-breach" : "incident-chip-sla-ok"}`}>sla {slaLabel}</span>
                </span>
              </div>
            ))}
          </div>
        );
      case "governance":
        return (
          <div className="monitoring-col" style={{ height: "100%", overflow: "auto" }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Governance</div>
            {governanceFiltered.slice(0, 12).map((row) => (
              <div key={row.label} className="mon-row">
                <span>{row.label}</span>
                <span className={row.severity >= 3 ? "warn" : row.severity >= 2 ? "subtle" : "good"}>{row.value}</span>
              </div>
            ))}
          </div>
        );
      case "readiness":
        return (
          <div className="monitoring-col" style={{ height: "100%", overflow: "auto" }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Readiness</div>
            <div className="mon-row"><span>Drift détecté</span><span>{driftItems.filter((d) => Boolean(d.drift_detected)).length}</span></div>
            <div className="mon-row"><span>Suspendues</span><span className={suspended.length > 0 ? "warn" : "good"}>{suspended.length}</span></div>
            <div className="mon-row"><span>Similarity</span><span>{String(memorySummary.avg_final_similarity || "–")}</span></div>
            <div className="mon-row"><span>Memory impact</span><span>{String(memorySummary.avg_memory_impact || "–")}</span></div>
            <div className="mon-row"><span>SLA breach</span><span className={incidents.some((i) => Boolean(i.sla_breached)) ? "warn" : "good"}>{incidents.filter((i) => Boolean(i.sla_breached)).length}</span></div>
          </div>
        );
      case "risktimeline":
        return (
          <div className="monitoring-col" style={{ height: "100%", overflow: "auto" }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Risk Compliance Timeline</div>
            {renderRiskTimelineBody(10, "rt")}
          </div>
        );
      default:
        return null;
    }
  }

  const hardAlertThreshold = Math.max(20, Math.min(95, riskHardAlertThresholdPct));
  const hardAlertActive = Boolean(riskHardAlertEnabled) && toNumber(riskSummary?.ratio_miss_window, 0) * 100 >= hardAlertThreshold;

  return (
    <main className={`term-root ui-${uiMode}`}>
      {hardAlertActive ? (
        <div className="hard-alert-banner">
          HARD ALERT: ratio miss {(toNumber(riskSummary?.ratio_miss_window, 0) * 100).toFixed(0)}% ≥ {hardAlertThreshold}%
        </div>
      ) : null}

      {/* ═══════════════ HEADER INSTITUTIONNEL ═══════════════ */}
      <header className="term-topbar gtix-panel-shell">
        <span className="eyebrow term-topbar-brand">TXT Trading Terminal</span>
        <div className="th-kpis">
          <span className={`th-kpi ${healthyConnectors < connectors.length ? "th-warn" : ""}`}>
            <span className={`th-dot ${healthyConnectors < connectors.length ? "th-dot-warn" : ""}`} />
            {healthyConnectors}/{connectors.length} conn.
          </span>
          <span className={`th-kpi ${criticalAlerts > 0 ? "th-warn" : ""}`}>{criticalAlerts} crit.</span>
          <span className={`th-kpi ${openIncidents > 0 ? "th-warn" : ""}`}>{openIncidents} incidents</span>
          {riskSummary ? (
            <span className={`th-kpi ${riskSummary.alert ? "th-warn" : ""}`}>
              miss {riskSummary.miss_in_window}/{riskSummary.window_size} ({(toNumber(riskSummary.ratio_miss_window, 0) * 100).toFixed(0)}%)
            </span>
          ) : null}
          <span className="th-kpi expert-only">{agentsHealthy}/{providerRows.length} agents</span>
          <span className="th-kpi expert-only">±{toNumber(overview?.net_exposure_usd, 0).toFixed(0)} USD expo</span>
          <span className={`th-kpi expert-only ${String(riskGateway?.healthy) === "false" ? "th-warn" : ""}`}>RG {String(riskGateway?.healthy ?? "–")}</span>
          <span className={`th-kpi expert-only ${pendingLive.length > 0 ? "th-warn" : ""}`}>{pendingLive.length} approvals</span>
          <span className={`th-kpi ${String(mt5Health?.status || "") === "ok" ? "" : "th-warn"}`}>MT5 {String(mt5Health?.status || "–")}</span>
        </div>
        <div className="th-nav">
          <Link href="/">Dashboard</Link>
          <Link href="/ai">IA</Link>
          <Link href="/connectors">Connecteurs</Link>
          <Link href="/live-readiness">Readiness</Link>
          <Link href="/incidents">Incidents</Link>
          <div className="th-mode-toggle" role="tablist" aria-label="Display mode">
            <button type="button" className={`th-mode-btn${uiMode === "novice" ? " active" : ""}`} onClick={() => setUiMode("novice")}>
              Novice
            </button>
            <button type="button" className={`th-mode-btn${uiMode === "expert" ? " active" : ""}`} onClick={() => setUiMode("expert")}>
              Expert
            </button>
          </div>
          <div className="th-mode-toggle" role="group" aria-label="Layout controls">
            <button type="button" className={`th-mode-btn${layoutEditMode ? " active" : ""}`} onClick={() => setLayoutEditMode((v) => !v)}>
              Layout Edit <span className="th-hotkey">Alt+E</span>
            </button>
            <button type="button" className={`th-mode-btn${layoutPreset === "scalp" ? " active" : ""}`} onClick={() => applyLayoutPreset("scalp")} title="Alt+1">Scalp <span className="th-hotkey">1</span></button>
            <button type="button" className={`th-mode-btn${layoutPreset === "swing" ? " active" : ""}`} onClick={() => applyLayoutPreset("swing")} title="Alt+2">Swing <span className="th-hotkey">2</span></button>
            <button type="button" className={`th-mode-btn${layoutPreset === "monitoring" ? " active" : ""}`} onClick={() => applyLayoutPreset("monitoring")} title="Alt+3">Monitoring <span className="th-hotkey">3</span></button>
            <button type="button" className="th-mode-btn" onClick={saveCurrentLayout} title="Alt+S">Save <span className="th-hotkey">S</span></button>
            <button type="button" className="th-mode-btn" onClick={restoreSavedLayout} title="Alt+R">Restore <span className="th-hotkey">R</span></button>
            <button type="button" className="th-mode-btn" onClick={resetFloatingPanels} title="Alt+0">Reset Floating <span className="th-hotkey">0</span></button>
          </div>
          <div className="th-mode-toggle" role="group" aria-label="Workspace controls">
            <button type="button" className="th-mode-btn" onClick={() => cycleWorkspace(-1)} title="Alt+Left">◀</button>
            <input
              value={layoutWorkspaceName}
              onChange={(event) => setLayoutWorkspaceName(event.target.value)}
              className="layout-workspace-input"
              placeholder="Workspace"
              aria-label="Workspace name"
            />
            <button type="button" className="th-mode-btn" onClick={saveNamedWorkspace}>Save WS</button>
            <select
              value={layoutWorkspaceOptions.includes(layoutWorkspaceName) ? layoutWorkspaceName : ""}
              className="layout-workspace-select"
              onChange={(event) => {
                const v = event.target.value;
                if (v.startsWith("__team__:")) {
                  const presetName = v.slice("__team__:".length);
                  const preset = TEAM_PRESETS[presetName];
                  if (preset) {
                    const fb = buildLayoutPreset("swing", uiMode === "novice");
                    const n = normalizeDockLayout(preset, fb);
                    setLayoutPreset(n.preset);
                    setLayoutCoreSplit(n.coreSplit);
                    setLayoutMicroOrder(n.microOrder);
                    setLayoutLowerOrder(n.lowerOrder);
                    setLayoutMonitoringOrder(n.monitoringOrder);
                    setFloatingPanels(n.floatingPanels);
                    setChartLinkGroup(n.chartLink.group);
                    setChartLinkSymbolEnabled(n.chartLink.symbol);
                    setChartLinkTimeframeEnabled(n.chartLink.timeframe);
                    setChartSyncPriorityMode(n.chartLink.priority);
                    setChartSyncLeaderGroup(n.chartLink.leader);
                    setChartViewDensity(n.chartLink.density);
                    setChartPropagationByGroup(n.chartLink.propagationByGroup);
                    if (termCoreGroupRef.current) termCoreGroupRef.current.setLayout([n.coreSplit, 100 - n.coreSplit]);
                    const copyName = `Copy of ${presetName.replace("⬡ ", "")}`;
                    setLayoutWorkspaceName(copyName);
                    saveWorkspaceBundle(copyName, n);
                    setLayoutWorkspaceOptions((prev) => prev.includes(copyName) ? prev : [...prev, copyName]);
                  }
                } else {
                  loadNamedWorkspace(v);
                }
              }}
              aria-label="Load workspace"
            >
              <option value="" disabled>Load…</option>
              <optgroup label="My Workspaces">
                {layoutWorkspaceOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </optgroup>
              <optgroup label="── Team Templates ──">
                {TEAM_PRESET_NAMES.map((name) => (
                  <option key={`team-${name}`} value={`__team__:${name}`}>{name}</option>
                ))}
              </optgroup>
            </select>
            <button type="button" className="th-mode-btn" onClick={deleteNamedWorkspace}>Delete</button>
            <button type="button" className="th-mode-btn" onClick={exportLayoutsJson}>Export</button>
            <button type="button" className="th-mode-btn" onClick={() => layoutImportInputRef.current?.click()}>Import</button>
            <button type="button" className="th-mode-btn" onClick={() => cycleWorkspace(1)} title="Alt+Right">▶</button>
            {workspaceHintBadge ? <span className="layout-workspace-hint-badge">{workspaceHintBadge}</span> : null}
            <input
              ref={layoutImportInputRef}
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) {
                  return;
                }
                try {
                  await importLayoutsJson(file);
                } catch {
                  setError("Import layout JSON impossible");
                } finally {
                  event.target.value = "";
                }
              }}
            />
          </div>
          <button type="button" onClick={() => void loadAll()} disabled={busy} className="chart-chip" style={{ fontSize: 11, padding: "4px 10px" }}>↻</button>
        </div>
      </header>

      {error ? <div className="term-error-bar warn">{error}</div> : null}

      {/* ═══════════════ SYNTHÈSE OPÉRATEUR ═══════════════════ */}
      <section className="panel term-synth-bar">
        <div className="synth-items">
          <div className="synth-item"><span className="synth-icon">◎</span><span className="synth-label">Route</span><span className="synth-val">{preferredRoute ? String(preferredRoute.venue || "–") : "–"}</span></div>
          <div className="synth-item"><span className="synth-icon">↔</span><span className="synth-label">Spread</span><span className={`synth-val ${preferredSpread > 2 ? "warn" : "good"}`}>{preferredSpread.toFixed(4)}</span></div>
          <div className="synth-item"><span className="synth-icon">≈</span><span className="synth-label">Slip</span><span className={`synth-val ${avgSlippage > 15 ? "warn" : "good"}`}>{avgSlippage.toFixed(1)} bps</span></div>
          <div className="synth-item"><span className="synth-icon">◔</span><span className="synth-label">Latence</span><span className={`synth-val ${avgLatency > 200 ? "warn" : "good"}`}>{avgLatency.toFixed(0)} ms</span></div>
          <div className="synth-item"><span className="synth-icon">▤</span><span className="synth-label">DOM</span><span className={`synth-val ${depthStreamState === "live" ? "good" : "warn"}`}>{depthStreamState}</span></div>
          <div className="synth-item"><span className="synth-icon">Δ</span><span className="synth-label">Footprint</span><span className={`synth-val ${toNumber(dominantFootprint?.delta, 0) >= 0 ? "good" : "warn"}`}>{toNumber(dominantFootprint?.delta, 0).toFixed(0)}</span></div>
          <div className="synth-item"><span className="synth-icon">!</span><span className="synth-label">Incidents</span><span className={`synth-val ${openIncidents > 0 ? "warn" : "good"}`}>{openIncidents}</span></div>
          <div className="synth-item"><span className="synth-icon">×</span><span className="synth-label">Kill</span><span className={`synth-val ${String(overview?.kill_switch_active) === "true" ? "warn" : "good"}`}>{String(overview?.kill_switch_active || "off")}</span></div>
        </div>
      </section>

      {/* ═══════════════ CORE: CHART + EXECUTION LANE ══════════ */}
      <section className="term-core">
        <PanelGroup
          ref={termCoreGroupRef}
          direction="horizontal"
          autoSaveId={termCoreAutoSaveId}
          className="txt-split-group"
          onLayout={(sizes) => {
            const left = Number(sizes[0] || 0);
            if (Number.isFinite(left) && left > 0) {
              setLayoutCoreSplit(Math.max(52, Math.min(85, left)));
            }
          }}
        >
          <Panel defaultSize={layoutCoreSplit} minSize={52} className="txt-split-panel txt-split-panel-left">

        {/* ── CHART PREMIUM ── */}
        <PanelShell className="panel term-chart-panel chart-container gtix-panel-resizable">
          <div className="chart-top-row">
            <div className="chart-top-left">
              <span className="eyebrow" style={{ marginRight: 8 }}>Chart premium</span>
              <span className="chart-symbol-badge">{selectedChartSymbol}</span>
              <span className="chart-inline-timeframe">{chartTimeframe}</span>
              {signalAlertBadgeCount > 0 ? (
                <button type="button" className={`chart-signal-badge chart-signal-badge-${marketDecisionV1.biasDirection}`} onClick={() => setSignalAlertBadgeCount(0)}>
                  Signal {signalAlertBadgeCount}
                </button>
              ) : null}
              <span className={`chart-change-pill ${chartChange >= 0 ? "bull" : "bear"}`}>{chartChange >= 0 ? "+" : ""}{chartChangePct.toFixed(2)}%</span>
              <span className={`chart-price-live ${chartChange >= 0 ? "bull" : "bear"}`}>{String(latestQuote?.last || "–")}</span>
            </div>
            <div className="chart-toolbar-right">
              <select value={selectedChartSymbol} onChange={(event) => setActiveChartSymbol(event.target.value)} className="chart-symbol-selector" aria-label="Symbol selector">
                {filteredQuotes.slice(0, 18).map((quote) => {
                  const symbolValue = instrumentLabel(quote);
                  return <option key={`sel-${symbolValue}`} value={symbolValue}>{symbolValue}</option>;
                })}
              </select>
              {(["A", "B", "C"] as const).map((group) => (
                <button key={group} type="button" className={`chart-chip ${chartLinkGroup === group ? "active" : ""}`} onClick={() => setChartLinkGroup(group)}>
                  G{group}
                </button>
              ))}
              <button type="button" className={`chart-chip ${chartLinkSymbolEnabled ? "active" : ""}`} onClick={() => setChartLinkSymbolEnabled((v) => !v)}>
                Link Sym
              </button>
              <button type="button" className={`chart-chip ${chartLinkTimeframeEnabled ? "active" : ""}`} onClick={() => setChartLinkTimeframeEnabled((v) => !v)}>
                Link TF
              </button>
              <button type="button" className={`chart-chip ${chartSyncPriorityMode === "last-edited" ? "active" : ""}`} onClick={() => setChartSyncPriorityMode("last-edited")}>
                Last
              </button>
              <button type="button" className={`chart-chip ${chartSyncPriorityMode === "leader" ? "active" : ""}`} onClick={() => setChartSyncPriorityMode("leader")}>
                Leader
              </button>
              {chartSyncPriorityMode === "leader" && CHART_GROUPS.map((group) => (
                <button key={`lead-${group}`} type="button" className={`chart-chip ${chartSyncLeaderGroup === group ? "active" : ""}`} onClick={() => setChartSyncLeaderGroup(group)}>
                  L{group}
                </button>
              ))}
              <button type="button" className={`chart-chip ${chartViewDensity === 2 ? "active" : ""}`} onClick={() => setChartViewDensity(2)}>
                2V
              </button>
              <button type="button" className={`chart-chip ${chartViewDensity === 3 ? "active" : ""}`} onClick={() => setChartViewDensity(3)}>
                3V
              </button>
              {(["auto", "balanced", "ultra"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`chart-chip ${chartPerfMode === mode ? "active" : ""}`}
                  title={mode === "auto" ? "Auto: active=full, others=lite+frozen" : mode === "balanced" ? "Balanced: all charts = full interaction" : "Ultra: force 2-panel + active=full, others=lite+frozen"}
                  onClick={() => {
                    setChartPerfMode(mode);
                    if (mode === "ultra") setChartViewDensity(2);
                  }}
                >
                  {mode === "auto" ? "Perf:A" : mode === "balanced" ? "Perf:B" : "Perf:U"}
                </button>
              ))}
              {(["line", "candles", "footprint"] as const).map((m) => (
                <button key={m} type="button" className={`chart-chip ${chartMode === m ? "active" : ""}`} onClick={() => setChartMode(m)}>
                  {m === "line" ? "L" : m === "candles" ? "C" : "FP"}
                </button>
              ))}
              {(["1m", "5m", "15m"] as const).map((tf) => (
                <button key={tf} type="button" className={`chart-chip ${chartTimeframe === tf ? "active" : ""}`} onClick={() => setActiveChartTimeframe(tf)}>{tf}</button>
              ))}
              <button type="button" className="chart-chip" onClick={() => setChartWindow((v) => Math.max(30, v - 20))}>+</button>
              <button type="button" className="chart-chip" onClick={() => setChartWindow((v) => Math.min(500, v + 20))}>−</button>
              {/* ── Indicator active pills ── */}
              {activeIndicators.map((ind) => (
                <span key={`ind-pill-${ind.id}`} className="chart-chip chart-chip-indicator active">
                  {ind.id}
                  <button
                    type="button"
                    className="chart-chip-remove"
                    aria-label={`Remove ${ind.id}`}
                    onClick={(e) => { e.stopPropagation(); toggleIndicator(ind.id); }}
                  >×</button>
                </span>
              ))}
              {/* ── Indicator picker button ── */}
              <div className="chart-indicator-picker-wrap">
                <button
                  type="button"
                  className={`chart-chip ${showIndicatorPanel ? "active" : ""}`}
                  onClick={() => setShowIndicatorPanel((v) => !v)}
                  aria-expanded={showIndicatorPanel}
                  aria-label="Add indicator"
                >
                  Ind {showIndicatorPanel ? "▲" : "▼"}
                </button>
                {showIndicatorPanel && (
                  <div className="chart-indicator-panel" role="menu">
                    {INDICATOR_CATALOG.map(({ category, ids }) => (
                      <div key={category} className="chart-indicator-group">
                        <span className="chart-indicator-group-label">{category}</span>
                        <div className="chart-indicator-group-chips">
                          {ids.map((id) => {
                            const on = activeIndicators.some((a) => a.id === id);
                            return (
                              <button
                                key={id}
                                type="button"
                                className={`chart-chip ${on ? "active" : ""}`}
                                onClick={() => toggleIndicator(id)}
                                role="menuitemcheckbox"
                                aria-checked={on}
                              >
                                {id}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="chart-chip chart-indicator-panel-close"
                      onClick={() => setShowIndicatorPanel(false)}
                    >
                      close
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={`chart-meta-strip ${marketSignalV1.focusMode ? "signal-focus" : ""}`}>
            <span className="chart-overlay-chip chart-overlay-chip-emphasis">{selectedChartSymbol}</span>
            <span className="chart-overlay-chip">{chartTimeframe}</span>
            <span className={`chart-overlay-chip chart-overlay-chip-signal chart-overlay-chip-signal-${marketSignalV1.dominantDirection}`}>{marketSignalV1.headline}</span>
            <span className="chart-overlay-chip chart-overlay-chip-good">Buy Pressure {marketSignalV1.buyPressurePct.toFixed(0)}%</span>
            <span className={`chart-overlay-chip chart-overlay-chip-signal chart-overlay-chip-signal-${marketDecisionV1.biasDirection}`}>{marketDecisionV1.scenarioLabel} {marketDecisionV1.scenarioProbabilityPct}%</span>
            <span className="chart-overlay-chip">Confidence {marketDecisionV1.globalConfidencePct}%</span>
            <span className="chart-overlay-chip">Calib {marketSignalV1.calibrationLabel}</span>
            {marketDecisionV1.probableReversalZone !== null ? <span className="chart-overlay-chip chart-overlay-chip-warn">{marketDecisionV1.probableReversalZoneLabel}</span> : null}
            {marketSignalV1.signals.slice(0, 2).map((signal) => (
              <span
                key={`signal-chip-${signal.id}-${signal.direction}`}
                className={`chart-overlay-chip ${signal.severity === "critical" ? "chart-overlay-chip-warn" : signal.direction === "buy" ? "chart-overlay-chip-good" : signal.direction === "sell" ? "chart-overlay-chip-warn" : ""}`}
                title={signal.detail}
              >
                {signal.label}
              </span>
            ))}
            <span className="chart-overlay-chip">Group {chartLinkGroup} · {chartLinkSymbolEnabled ? "Sym On" : "Sym Off"} · {chartLinkTimeframeEnabled ? "TF On" : "TF Off"}</span>
            <span className="chart-overlay-chip">Sync {chartSyncModeLabel}</span>
            <span className="chart-overlay-chip">Source {chartSyncSourceLabel(activeChartPanel)}</span>
            <span className="chart-overlay-chip">Density {chartViewDensity} views</span>
            <span className="chart-overlay-chip">Prop {chartPropagationByGroup[chartLinkGroup]}</span>
            <span className={`chart-overlay-chip ${replayState.enabled ? "chart-overlay-chip-warn" : "chart-overlay-chip-good"}`}>{replayState.enabled ? "REPLAY MODE" : "LIVE MODE"}</span>
            <span className="chart-overlay-chip chart-overlay-chip-good">VWAP D/W/M {dayVwap > 0 ? dayVwap.toFixed(2) : "–"} / {weekVwap > 0 ? weekVwap.toFixed(2) : "–"} / {monthVwap > 0 ? monthVwap.toFixed(2) : "–"}</span>
            {uiMode === "expert" ? <span className="chart-overlay-chip">Sessions Asia / London / New York</span> : null}
            <span className="chart-overlay-chip">FVG/OB {overlaySummary || "–"}</span>
            {uiMode === "expert" ? <span className="chart-overlay-chip">Liquidity {liquiditySummary || "–"}</span> : null}
            <span className="chart-overlay-chip">Range {chartMin > 0 ? `${chartMin.toFixed(0)}–${chartMax.toFixed(0)}` : "–"}</span>
            <span className={`chart-overlay-chip ${chartChange >= 0 ? "chart-overlay-chip-good" : "chart-overlay-chip-warn"}`}>Δ {chartChange >= 0 ? "+" : ""}{chartChangePct.toFixed(2)}%</span>
            <span className="chart-overlay-chip">Spread {chartHeaderSpread > 0 ? chartHeaderSpread.toFixed(2) : "–"}</span>
            {uiMode === "expert" ? <span className="chart-overlay-chip">active tKey {activeTimeKey || "–"}</span> : null}
          </div>

          <div className={`chart-link-grid chart-link-grid-${chartViewDensity}`} aria-label="Linked chart views A/B/C">
            {visibleChartGroups.map((group) => {
              const panel = chartPanels[group];
              const panelData = chartPanelData[group];
              const propagationMode = chartPropagationByGroup[group] || "both";
              const panelChange = panelData.points.length > 1
                ? ((panelData.points[panelData.points.length - 1].value - panelData.points[0].value) / Math.max(0.0000001, panelData.points[0].value)) * 100
                : 0;
              return (
                <section key={`link-grid-${group}`} className={`chart-link-card ${chartLinkGroup === group ? "active" : ""}`}>
                  <div className="chart-link-head">
                    <button type="button" className={`chart-chip ${chartLinkGroup === group ? "active" : ""}`} onClick={() => setChartLinkGroup(group)}>G{group}</button>
                    <select
                      value={panel.symbol}
                      onChange={(event) => {
                        setChartLinkGroup(group);
                        applyChartPanelUpdate(group, { symbol: event.target.value }, "manual");
                      }}
                      className="chart-link-select"
                      aria-label={`Group ${group} symbol`}
                    >
                      {filteredQuotes.slice(0, 18).map((quote) => {
                        const symbolValue = instrumentLabel(quote);
                        return <option key={`group-${group}-sym-${symbolValue}`} value={symbolValue}>{symbolValue}</option>;
                      })}
                    </select>
                    <span className={`chart-link-source source-${panel.source}`}>{chartSyncSourceLabel(panel)}</span>
                  </div>
                  <div className="chart-link-propagation-row">
                    <span className="chart-link-propagation-label">prop</span>
                    <button
                      type="button"
                      className={`chart-chip ${propagationMode === "both" ? "active" : ""}`}
                      onClick={() => setChartPropagationByGroup((current) => ({ ...current, [group]: "both" }))}
                    >
                      Both
                    </button>
                    <button
                      type="button"
                      className={`chart-chip ${propagationMode === "symbol-only" ? "active" : ""}`}
                      onClick={() => setChartPropagationByGroup((current) => ({ ...current, [group]: "symbol-only" }))}
                    >
                      Sym
                    </button>
                    <button
                      type="button"
                      className={`chart-chip ${propagationMode === "timeframe-only" ? "active" : ""}`}
                      onClick={() => setChartPropagationByGroup((current) => ({ ...current, [group]: "timeframe-only" }))}
                    >
                      TF
                    </button>
                  </div>
                  <div className="chart-link-timeframe-row">
                    {CHART_TIMEFRAMES.map((tf) => (
                      <button
                        key={`group-${group}-tf-${tf}`}
                        type="button"
                        className={`chart-chip ${panel.timeframe === tf ? "active" : ""}`}
                        onClick={() => {
                          setChartLinkGroup(group);
                          applyChartPanelUpdate(group, { timeframe: tf }, "manual");
                        }}
                      >
                        {tf}
                      </button>
                    ))}
                    <span className={`chart-link-change ${panelChange >= 0 ? "up" : "down"}`}>{panelChange >= 0 ? "+" : ""}{panelChange.toFixed(2)}%</span>
                  </div>
                  <div className="chart-link-stage">
                    {panelData.loading ? <div className="chart-link-loading">loading…</div> : null}
                    <InstitutionalChart
                      symbol={panel.symbol}
                      timeframe={panel.timeframe}
                      mode={chartMode === "footprint" ? "candles" : chartMode}
                      interactionMode={chartPerfMode === "balanced" ? "full" : "lite"}
                      frozen={chartLinkGroup !== group}
                      chartMotionPreset={chartMotionPreset}
                      points={panelData.points}
                      candles={panelData.candles}
                      overlayZones={buildOverlayZones(panelData.points)}
                      liquidityZones={buildLiquidityZones(panelData.points)}
                      dayVwap={showVwap ? weightedVwap(panelData.points.slice(-12)) : 0}
                      weekVwap={showVwap ? weightedVwap(panelData.points.slice(-24)) : 0}
                      monthVwap={showVwap ? weightedVwap(panelData.points) : 0}
                      showSessions={false}
                      indicatorSeries={[]}
                      candleTransform="none"
                    />
                  </div>
                </section>
              );
            })}
          </div>

          <div className={`replay-control-strip ${replayState.enabled ? "active" : ""}`}>
            <span className="replay-badge">{replayState.enabled ? "REPLAY MODE" : "LIVE"}</span>
            <span className="replay-time">{replayCurrentTimeLabel}</span>
            {uiMode === "expert" ? <span className="replay-frame-index">frame {replayCurrentIndex + 1}/{Math.max(1, replayFrames.length)}</span> : null}
            <div className="replay-slider-wrap">
              <input
                type="range"
                min={0}
                max={replayMaxIndex}
                value={replayCurrentIndex}
                disabled={replayFrames.length === 0}
                onChange={(event) => {
                  const nextIndex = clampIndex(Number(event.target.value || 0), replayMaxIndex);
                  setReplayState((current) => ({
                    ...current,
                    enabled: true,
                    playing: false,
                    cursorIndex: nextIndex,
                    timeKey: replayFrames[nextIndex]?.timeKey || null,
                  }));
                }}
                className="replay-slider"
              />
              <div className="replay-tick-layer" aria-hidden="true">
                {visibleReplayMarkers.map((marker) => {
                  const leftPct = replayMaxIndex > 0 ? (marker.frameIndex / replayMaxIndex) * 100 : 0;
                  return (
                    <span
                      key={`tick-${marker.id}`}
                      className={["replay-tick-item", `replay-tick-${marker.kind}`, marker.kind === "outcome" ? (marker.label.startsWith("+") ? "replay-tick-outcome-profit" : "replay-tick-outcome-loss") : "", marker.critical ? "critical" : "", marker.frameIndex === replayCurrentIndex ? "active" : ""].filter(Boolean).join(" ")}
                      style={{ left: `${Math.max(0, Math.min(100, leftPct))}%` }}
                    />
                  );
                })}
              </div>
            </div>
            <button type="button" className="chart-chip" onClick={() => stepReplay(-10)} disabled={replayFrames.length === 0}>-10</button>
            <button type="button" className="chart-chip" onClick={() => stepReplay(-1)} disabled={replayFrames.length === 0}>◀</button>
            <button type="button" className="chart-chip" onClick={() => stepReplay(1)} disabled={replayFrames.length === 0}>▶</button>
            <button type="button" className="chart-chip" onClick={() => stepReplay(10)} disabled={replayFrames.length === 0}>+10</button>
            {[1, 2, 4, 8].map((speed) => (
              <button key={`sp-${speed}`} type="button" className={`chart-chip ${replayState.speed === speed ? "active" : ""}`} onClick={() => setReplaySpeed(speed as ReplaySpeed)} disabled={!replayState.enabled && replayFrames.length === 0}>x{speed}</button>
            ))}
            {!replayState.enabled ? (
              <button type="button" className="chart-chip" onClick={enableReplay} disabled={replayFrames.length === 0}>Enable Replay</button>
            ) : (
              <button type="button" className="chart-chip" onClick={exitReplayMode}>Back Live</button>
            )}
            {uiMode === "expert" ? <span className="replay-critical-note">critical auto-stop {criticalReplayFrameIndexes.length > 0 ? "on" : "none"}</span> : null}
            {timeSyncDiagnostics.mismatchCount > 0 && (
              <span className="replay-time-sync-warning" title={`time sync mismatch: ${timeSyncMismatchLabel}`}>
                sync drift {timeSyncDiagnostics.mismatchCount}
              </span>
            )}
            {uiMode === "expert" ? <div className="replay-marker-filter-row">
              <button type="button" className={`replay-filter-toggle${replayFilterKinds.length === 0 && !replayFilterCritical ? " active" : ""}`} onClick={() => { setReplayFilterKinds([]); setReplayFilterCritical(false); }}>All</button>
              {(["intent", "routing", "approval", "fill", "incident", "outcome"] as const).map((kind) => (
                <button key={kind} type="button" className={`replay-filter-toggle replay-filter-${kind}${replayFilterKinds.includes(kind) ? " active" : ""}`} onClick={() => toggleReplayFilterKind(kind)}>{kind}</button>
              ))}
              <button type="button" className={`replay-filter-toggle replay-filter-critical${replayFilterCritical ? " active" : ""}`} onClick={() => setReplayFilterCritical((v) => !v)}>★ critical</button>
            </div> : null}
            <div className="replay-events-track" role="list" aria-label="Replay events timeline">
              {visibleReplayMarkers.map((marker) => {
                const leftPct = replayMaxIndex > 0 ? (marker.frameIndex / replayMaxIndex) * 100 : 0;
                return (
                  <button
                    key={marker.id}
                    type="button"
                    role="listitem"
                    className={["replay-event-marker", `replay-event-${marker.kind}`, marker.kind === "outcome" ? (marker.label.startsWith("+") ? "profit" : "loss") : "", marker.critical ? "critical" : "", marker.frameIndex === replayCurrentIndex ? "active" : ""].filter(Boolean).join(" ")}
                    style={{ left: `${Math.max(0, Math.min(100, leftPct))}%` }}
                    onClick={() => jumpToReplayFrame(marker.frameIndex)}
                    title={`${marker.label} · ${marker.detail}`}
                  >
                    <span>{marker.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="chart-symbol-chips">
            {filteredQuotes.slice(0, 8).map((quote) => {
              const s = instrumentLabel(quote);
              return (
                <button key={s} type="button" className={`chart-chip ${selectedChartSymbol === s ? "active" : ""}`} onClick={() => setActiveChartSymbol(s)}>{s}</button>
              );
            })}
          </div>

          <ModuleGuide
            mode={uiMode}
            title="Chart guide"
            what="Le chart réunit prix, zones techniques, liquidité et contexte de décision dans la même vue."
            why="Il permet de confirmer rapidement si le signal reste cohérent avec la structure et le flux d'exécution."
            example="Si le prix reprend la VWAP, défend une zone de liquidité et garde un delta positif, le contexte reste plus favorable."
          />
          <div className={`chart-shell chart-shell-premium chart-shell-${chartMotionClass} chart-shell-signal-mode-${signalDisplayMode}`}>
            <aside className="chart-tools-panel" aria-label="Chart tools">
              <button type="button" className={`chart-tool-btn ${showVwap ? "active" : ""}`} onClick={() => setShowVwap((v) => !v)}>VWAP</button>
              <button type="button" className={`chart-tool-btn ${showFvgOb ? "active" : ""}`} onClick={() => setShowFvgOb((v) => !v)}>FVG/OB</button>
              <button type="button" className={`chart-tool-btn ${showLiquidity ? "active" : ""}`} onClick={() => setShowLiquidity((v) => !v)}>LIQ</button>
              <button type="button" className={`chart-tool-btn ${showSessions ? "active" : ""}`} onClick={() => setShowSessions((v) => !v)}>SESS</button>
              <div className="chart-mode-switch" role="group" aria-label="Signal mode">
                <button type="button" className={`chart-tool-btn chart-mode-btn ${signalDisplayMode === "classic" ? "active" : ""}`} onClick={() => setSignalDisplayMode("classic")}>CL</button>
                <button type="button" className={`chart-tool-btn chart-mode-btn ${signalDisplayMode === "augmented" ? "active" : ""}`} onClick={() => setSignalDisplayMode("augmented")}>AUG</button>
                <button type="button" className={`chart-tool-btn chart-mode-btn ${signalDisplayMode === "ai-dominant" ? "active" : ""}`} onClick={() => setSignalDisplayMode("ai-dominant")}>AI</button>
              </div>
              <Link
                href={`/settings?chartPreset=${nextChartMotionPreset(chartMotionPreset)}#chart-motion-preset`}
                className={`chart-preset-reminder chart-preset-reminder-link chart-preset-reminder-${chartMotionClass}`}
                aria-label={`Preset actif: ${chartMotionPreset}. Cliquer pour appliquer ${nextChartMotionPreset(chartMotionPreset)} et ouvrir Settings.`}
                title={`Apply ${nextChartMotionPreset(chartMotionPreset)} and open Settings`}
              >
                <span className="chart-preset-reminder-kicker">Preset</span>
                <span className="chart-preset-reminder-value">{chartMotionPreset}</span>
              </Link>
            </aside>
            <div className={`chart-stage-wrap chart-stage-wrap-premium chart-stage-wrap-${chartMotionClass} ${chartActiveSnapLine ? "is-execution-focus" : ""} ${marketSignalV1.focusMode ? "is-signal-focus" : ""}`} ref={chartStageRef}>
              {chartLoading ? <div className="chart-loader">Switching symbol…</div> : null}
              <InstitutionalChart
                className={`chart-stage-premium ${chartActiveSnapLine ? "execution-focus" : ""} ${marketSignalV1.focusMode ? "signal-focus" : ""}`}
                symbol={selectedChartSymbol}
                timeframe={chartTimeframe}
                mode={chartMode}
                chartMotionPreset={chartMotionPreset}
                points={chartSeries}
                candles={chartCandles}
                overlayZones={activeOverlayZones}
                liquidityZones={activeLiquidityZones}
                domLevels={chartMode === "candles" ? activeDomLevels : undefined}
                heatmapLevels={chartMode === "candles" ? activeHeatmapLevels : undefined}
                dayVwap={showVwap ? dayVwap : 0}
                weekVwap={showVwap ? weekVwap : 0}
                monthVwap={showVwap ? monthVwap : 0}
                showSessions={showSessions}
                indicatorSeries={indicatorSeriesForChart}
                footprintRows={chartMode === "footprint" ? activeFootprintRows : undefined}
                candleTransform="none"
                onCrosshairMove={(payload) => setCrosshair(payload)}
              />
              {suggestedBracketOverlay && !replayState.enabled ? (
                <div className="chart-suggested-bracket-overlay" aria-hidden="true">
                  <div className="chart-suggested-bracket-band reward" style={{ top: suggestedBracketOverlay.rewardTop, height: suggestedBracketOverlay.rewardHeight }} />
                  <div className="chart-suggested-bracket-band risk" style={{ top: suggestedBracketOverlay.riskTop, height: suggestedBracketOverlay.riskHeight }} />
                  <div className="chart-suggested-bracket-line entry" style={{ top: suggestedBracketOverlay.entryY }}><span>Suggested Entry</span></div>
                  <div className="chart-suggested-bracket-line sl" style={{ top: suggestedBracketOverlay.slY }}><span>Suggested SL</span></div>
                  <div className="chart-suggested-bracket-line tp" style={{ top: suggestedBracketOverlay.tpY }}><span>Suggested TP</span></div>
                  {suggestedBracketOverlay.liquidityY !== null && suggestedLiquidityHighlight ? (
                    <div className={`chart-suggested-liquidity-link ${suggestedLiquidityExactTpMatch ? "exact-tp-match" : ""}`} style={{ top: suggestedBracketOverlay.liquidityY }}>
                      <span>{suggestedLiquidityExactTpMatch ? "TP=LIQ" : "LIQ"} {suggestedLiquidityHighlight.level.toFixed(chartPriceDigits)}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {signalActionToast && (signalDisplayMode !== "classic" || signalActionToast.critical) ? (
                <div className={`chart-signal-toast chart-signal-toast-${signalActionToast.direction}`} key={signalActionToast.key}>
                  <div className="chart-signal-toast-head">
                    <strong>{signalActionToast.title}</strong>
                    <button type="button" className="chart-signal-toast-close" onClick={() => setSignalActionToast(null)}>×</button>
                  </div>
                  <div className="chart-signal-toast-detail">{signalActionToast.detail}</div>
                  <div className="chart-signal-toast-zone">{signalActionToast.zoneLabel}</div>
                </div>
              ) : null}
              {!replayState.enabled && chartOrderTicket.active && (
                <>
                  <div className={`chart-order-hud signal-ui-${signalDisplayMode} ${marketSignalV1.focusMode ? "signal-priority" : ""}`}>
                    <div className="chart-order-hud-title">
                      <span className="chart-order-hud-kicker">Execution Desk</span>
                      <strong>Chart Trading</strong>
                      <span className={`chart-order-hud-mode chart-order-hud-mode-${chartMotionClass}`}>{chartMotionPreset}</span>
                    </div>
                    <div className="chart-mode-label">Mode {signalDisplayMode === "classic" ? "Classic" : signalDisplayMode === "augmented" ? "Augmented" : "AI Dominant"}</div>
                    {signalDisplayMode !== "classic" ? (
                    <div className={`chart-signal-card chart-signal-card-${marketSignalV1.dominantDirection}`}>
                      <div className={`chart-perception-layer direction-${marketSignalV1.dominantDirection} motion-${perceptionMotionClass} ${perceptionSetupReady ? "setup-ready" : ""}`}>
                        <div className="chart-perception-line header">
                          <span>LONG {marketSignalV1.directionalLongPct}% / SHORT {marketSignalV1.directionalShortPct}%</span>
                          <span>CONF {marketSignalV1.directionalConfidenceLabel}</span>
                        </div>
                        <div className="chart-perception-line core">{perceptionCoreLabel}</div>
                        {perceptionReasonCode ? (
                          <div className={`chart-perception-reason-wrap ${showReasonLegend ? "is-open" : ""}`}>
                            <div className="chart-perception-line reason">{perceptionReasonCode}</div>
                            <button
                              type="button"
                              className="chart-perception-legend-trigger"
                              aria-label="Reason code legend"
                              aria-expanded={showReasonLegend}
                              onClick={() => setShowReasonLegend((value) => !value)}
                            >
                              ⓘ
                            </button>
                            <div className="chart-perception-legend" role="note">
                              <span className="chart-perception-legend-line">{perceptionReasonLegend?.line1 || "signal context"}</span>
                              {perceptionReasonLegend?.line2 ? <span className="chart-perception-legend-line sub">{perceptionReasonLegend.line2}</span> : null}
                            </div>
                          </div>
                        ) : null}
                        <div className="chart-perception-line target">{perceptionTargetLabel}</div>
                        <div className="chart-perception-line action">{perceptionActionLabel}</div>
                      </div>
                      <div className="chart-signal-card-head">
                        <span className="chart-signal-kicker">Signal Engine V2</span>
                        <strong>{marketSignalV1.headline}</strong>
                        <span className="chart-signal-directional-kpi">
                          LONG {marketSignalV1.directionalLongPct}% / SHORT {marketSignalV1.directionalShortPct}% / CONF {marketSignalV1.directionalConfidenceLabel}
                          <span className={`chart-signal-drift-badge ${signalConfidenceDrift.toLowerCase()}`}>
                            <span className="chart-signal-drift-arrow" aria-hidden="true">{signalConfidenceDrift === "UP" ? "↑" : signalConfidenceDrift === "DOWN" ? "↓" : "→"}</span>
                            <span>{signalConfidenceDrift}</span>
                          </span>
                        </span>
                      </div>
                      <div className="chart-signal-score-row">
                        <span>Buy {marketSignalV1.buyPressurePct.toFixed(0)}%</span>
                        <span>Sell {marketSignalV1.sellPressurePct.toFixed(0)}%</span>
                        <span>{marketSignalV1.convictionLabel}</span>
                      </div>
                      <div className="chart-signal-tags">
                        {marketSignalV1.signals.length === 0 ? (
                          <span className="chart-signal-tag neutral">No dominant flow signal</span>
                        ) : (
                          marketSignalV1.signals.map((signal) => (
                            <span
                              key={`hud-signal-${signal.id}-${signal.direction}`}
                              className={`chart-signal-tag ${signal.direction} ${signal.severity}`}
                              title={signal.detail}
                            >
                              {signal.label}
                            </span>
                          ))
                        )}
                      </div>
                      <div className={`chart-decision-card ${marketDecisionV1.criticalConfirmed ? "mobile-critical-sticky" : ""}`}>
                        <div className="chart-decision-card-head">
                          <span className="chart-signal-kicker">Decision Engine V1</span>
                          <strong>{marketDecisionV1.scenarioLabel}</strong>
                        </div>
                        <div className="chart-signal-score-row">
                          <span>Scenario {marketDecisionV1.scenarioProbabilityPct}%</span>
                          <span>Confidence {marketDecisionV1.globalConfidencePct}%</span>
                          <span>Confluence {marketDecisionV1.confluenceScorePct}%</span>
                          <span>{marketDecisionV1.probableReversalZoneLabel}</span>
                        </div>
                        <div className="chart-learning-strip">
                          <span>Learn {marketDecisionV1.historicalLearning.scopeLabel} · n={marketDecisionV1.historicalLearning.sampleSize} · WR {marketDecisionV1.historicalLearning.winratePct.toFixed(0)}%</span>
                        </div>
                        <div className="chart-decision-tools">
                          <button
                            type="button"
                            className={`chart-chip ${showConfluenceTune ? "active" : ""}`}
                            onClick={() => setShowConfluenceTune((value) => !value)}
                          >
                            {showConfluenceTune ? `Hide Tune ${marketDecisionV1.evidence.length}` : `Tune ${marketDecisionV1.evidence.length}`}
                          </button>
                          <button
                            type="button"
                            className={`chart-chip chart-decision-details-toggle ${showDecisionSecondary ? "active" : ""}`}
                            onClick={() => setShowDecisionSecondary((value) => !value)}
                          >
                            {showDecisionSecondary ? "Hide Details" : "Details"}
                          </button>
                        </div>
                        {showConfluenceTune ? (
                          <div className="chart-confluence-controls">
                            {marketDecisionV1.evidence.map((item) => (
                              <label key={`weight-${item.id}`} className="chart-confluence-control">
                                <span>{item.label} manual x{confluenceWeights[item.id].toFixed(2)} · learned x{marketDecisionV1.historicalLearning.learnedWeights[item.id].toFixed(2)}</span>
                                <input
                                  type="range"
                                  min={0.5}
                                  max={1.8}
                                  step={0.05}
                                  value={confluenceWeights[item.id]}
                                  onChange={(event) => {
                                    const next = Number(event.target.value || confluenceWeights[item.id]);
                                    setConfluenceWeights((current) => ({ ...current, [item.id]: next }));
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                        ) : null}
                        <div ref={decisionSecondaryRef} className={`chart-decision-secondary ${showDecisionSecondary ? "open" : ""}`}>
                          <div className="chart-evidence-grid">
                            {marketDecisionV1.evidence.map((item) => (
                              <div key={`evidence-${item.id}`} className={`chart-evidence-item ${item.direction}`}>
                                <span className="chart-evidence-label">{item.label}</span>
                                <strong>{item.scorePct}%</strong>
                                <em>{item.detail}</em>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className={`chart-action-card chart-action-card-${marketDecisionV1.biasDirection}`}>
                          <div className="chart-action-card-head">
                            <span className="chart-signal-kicker">Action Card</span>
                            <strong>{marketDecisionV1.actionTitle}</strong>
                          </div>
                          <div className="chart-action-card-body">{marketDecisionV1.actionBody}</div>
                          <div className="chart-execution-brain-v3">
                            <div className="chart-signal-kicker">Execution Brain V3</div>
                            <div className="chart-execution-brain-v3-grid">
                              <span className={`chart-action-pill chart-action-pill-status ${entryTimingV3.tone}`}>ENTRY {entryTimingV3.status}<span className={`chart-action-pill-conf ${confidencePillTone(entryTimingV3.confidence)}`}>{entryTimingV3.confidence.toFixed(2)}</span></span>
                              <span className="chart-action-pill">{entryTimingV3.detail}</span>
                              <span className={`chart-action-pill chart-action-pill-status ${tradeManagementV3.tone}`}>{tradeManagementV3.status}<span className={`chart-action-pill-conf ${confidencePillTone(tradeManagementV3.confidence)}`}>{tradeManagementV3.confidence.toFixed(2)}</span></span>
                              <span className="chart-action-pill">{tradeManagementV3.detail}</span>
                              <span className={`chart-action-pill chart-action-pill-status ${intelligentExitV3.tone}`}>{intelligentExitV3.status}<span className={`chart-action-pill-conf ${confidencePillTone(intelligentExitV3.confidence)}`}>{intelligentExitV3.confidence.toFixed(2)}</span></span>
                              <span className="chart-action-pill">{intelligentExitV3.detail}</span>
                              <span className={`chart-action-pill chart-action-pill-status ${trailingV3.tone}`}>TRAILING {trailingV3.status}</span>
                              <span className="chart-action-pill">{trailingV3.detail}</span>
                            </div>
                          </div>
                          <div className="chart-auto-exec-panel">
                            <div className="chart-signal-kicker">Auto-Execution</div>
                            <div className="chart-auto-exec-mode-row">
                              {(["assisted", "semi-auto", "full-auto"] as const).map((mode) => (
                                <button
                                  key={`auto-exec-${mode}`}
                                  type="button"
                                  className={`chart-chip ${autoExecutionMode === mode ? "active" : ""}`}
                                  onClick={() => setAutoExecutionMode(mode)}
                                >
                                  {mode === "assisted" ? "Assisted" : mode === "semi-auto" ? "Semi Auto" : "Full Auto"}
                                </button>
                              ))}
                              <button
                                type="button"
                                className={`chart-chip ${autoExecutionKillSwitch ? "active" : ""}`}
                                onClick={() => setAutoExecutionKillSwitch((value) => !value)}
                              >
                                Kill Switch {autoExecutionKillSwitch ? "ON" : "OFF"}
                              </button>
                              <button
                                type="button"
                                className={`chart-chip ${autoSessionGuardEnabled ? "active" : ""}`}
                                onClick={() => setAutoSessionGuardEnabled((value) => !value)}
                              >
                                Session Guard {autoSessionGuardEnabled ? "ON" : "OFF"}
                              </button>
                            </div>
                            <div className="chart-auto-exec-controls-grid">
                              <label className="chart-confluence-control chart-auto-exec-control-field">
                                <span>Session start (hour)</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={23}
                                  step={1}
                                  value={autoSessionStartHour}
                                  onChange={(event) => setAutoSessionStartHour(Math.max(0, Math.min(23, Number(event.target.value || 0))))}
                                />
                              </label>
                              <label className="chart-confluence-control chart-auto-exec-control-field">
                                <span>Session end (hour)</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={23}
                                  step={1}
                                  value={autoSessionEndHour}
                                  onChange={(event) => setAutoSessionEndHour(Math.max(0, Math.min(23, Number(event.target.value || 0))))}
                                />
                              </label>
                              <label className="chart-confluence-control chart-auto-exec-control-field">
                                <span>Symbol loss cap (USD)</span>
                                <input
                                  type="number"
                                  min={50}
                                  step={25}
                                  value={autoSymbolLossCapUsd}
                                  onChange={(event) => setAutoSymbolLossCapUsd(Math.max(50, Number(event.target.value || 0)))}
                                />
                              </label>
                              <button
                                type="button"
                                className="chart-chip"
                                onClick={() => setAutoSymbolAutoDisabled((current) => {
                                  const next = { ...current };
                                  delete next[autoSymbolLoss.normalizedSymbol];
                                  return next;
                                })}
                              >
                                Reset {autoSymbolLoss.normalizedSymbol}
                              </button>
                            </div>
                            <div className="chart-auto-exec-status-grid">
                              <span className={`chart-action-pill chart-action-pill-status ${autoExecutionGate.autoState === "READY" ? "good" : autoExecutionGate.autoState === "KILLED" ? "bad" : "warn"}`}>AUTO {autoExecutionGate.autoState}</span>
                              <span className="chart-action-pill">META {autoMetaFilter.pass ? "PASS" : "BLOCK"}</span>
                              <span className={`chart-action-pill ${autoRiskEngine.hardPass ? "chart-action-pill-status good" : "chart-action-pill-status bad"}`}>RISK {autoExecutionGate.riskLabel}</span>
                              <span className="chart-action-pill">SIZE {autoExecutionGate.sizeLabel}</span>
                              <span className="chart-action-pill">OPEN {openTradesCount}/{autoRiskEngine.maxOpenTrades}</span>
                              <span className="chart-action-pill">EXPO {(exposureRatio * 100).toFixed(1)}%/{autoRiskEngine.maxExposurePct}%</span>
                              <span className="chart-action-pill">DD {dailyDrawdownPct.toFixed(1)}%/{autoRiskEngine.maxDailyLossPct}%</span>
                              <span className="chart-action-pill">RULE {autoExecutionGate.ruleLabel}</span>
                              <span className={`chart-action-pill ${autoSessionGuard.pass ? "chart-action-pill-status good" : "chart-action-pill-status warn"}`}>SESS {autoSessionGuard.pass ? "ON" : "OFF"} {autoSessionGuard.label}</span>
                              <span className={`chart-action-pill ${autoSymbolLoss.pass ? "chart-action-pill-status good" : "chart-action-pill-status bad"}`}>SYM LOSS {autoSymbolLoss.cumulativeLossUsd.toFixed(0)}/{autoSymbolLossCapUsd.toFixed(0)}</span>
                            </div>
                            <div className="chart-auto-exec-audit-toolbar">
                              <span className="chart-action-pill">Audit {filteredAutoExecutionAuditTrail.length}/{autoExecutionAuditTrail.length}</span>
                              {(["all", "READY", "BLOCKED", "KILLED"] as const).map((stateKey) => (
                                <button
                                  key={`auto-audit-state-${stateKey}`}
                                  type="button"
                                  className={`chart-chip ${autoExecutionAuditStateFilter === stateKey ? "active" : ""}`}
                                  onClick={() => setAutoExecutionAuditStateFilter(stateKey)}
                                >
                                  {stateKey}
                                </button>
                              ))}
                              <input
                                type="text"
                                className="chart-auto-exec-reason-search"
                                placeholder="reason search"
                                value={autoExecutionAuditReasonSearch}
                                onChange={(event) => setAutoExecutionAuditReasonSearch(event.target.value)}
                              />
                              <button type="button" className="chart-chip" onClick={() => exportAutoExecutionAudit("json")}>Export JSON</button>
                              <button type="button" className="chart-chip" onClick={() => exportAutoExecutionAudit("csv")}>Export CSV</button>
                              <button type="button" className="chart-chip" onClick={() => setAutoExecutionAuditTrail([])}>Clear</button>
                            </div>
                            <div className="chart-auto-exec-audit-list">
                              {filteredAutoExecutionAuditTrail.slice(0, 8).map((event) => (
                                <div key={event.id} className="chart-auto-exec-audit-row">
                                  <span>{formatClock(event.timestampIso)}</span>
                                  <span>{event.gateState}</span>
                                  <span>{event.mode}</span>
                                  <span>{event.sizeUsd.toFixed(0)} USD</span>
                                  <span>{event.reasons.length > 0 ? event.reasons.join("+") : "ok"}</span>
                                </div>
                              ))}
                              {filteredAutoExecutionAuditTrail.length === 0 ? <div className="chart-auto-exec-audit-empty">No audit row for current filter.</div> : null}
                            </div>
                          </div>
                          <div className="chart-learning-v4-panel">
                            <div className="chart-signal-kicker">Self Learning V4</div>
                            <div className="chart-learning-v4-controls">
                              <button
                                type="button"
                                className={`chart-chip ${selfLearningV4Enabled ? "active" : ""}`}
                                onClick={() => setSelfLearningV4Enabled((value) => !value)}
                              >
                                Learning {selfLearningV4Enabled ? "ON" : "OFF"}
                              </button>
                              <button
                                type="button"
                                className={`chart-chip ${selfLearningAutoAdaptEnabled ? "active" : ""}`}
                                onClick={() => setSelfLearningAutoAdaptEnabled((value) => {
                                  const next = !value;
                                  if (next) {
                                    selfLearningDriftSignatureRef.current = "";
                                    setSelfLearningDriftAutoDemotedAt(null);
                                  }
                                  return next;
                                })}
                              >
                                Weights {selfLearningAutoAdaptEnabled ? "Auto" : "Manual"}
                              </button>
                            </div>
                            <div className="chart-learning-v4-toolbar">
                              <span className={`chart-action-pill chart-action-pill-status ${selfLearningDriftV4.shouldDemote ? "bad" : selfLearningDriftV4.enoughSamples ? "good" : "warn"}`}>Drift {selfLearningV4DriftLabel}</span>
                              <span className="chart-action-pill">Journal {filteredSelfLearningJournalV4Trail.length}/{selfLearningJournalV4Trail.length}</span>
                              <button type="button" className="chart-chip" onClick={() => exportSelfLearningJournalV4("json")}>Export V4 JSON</button>
                              <button type="button" className="chart-chip" onClick={() => exportSelfLearningJournalV4("csv")}>Export V4 CSV</button>
                              <button type="button" className="chart-chip" onClick={() => setSelfLearningJournalV4Trail([])}>Clear</button>
                            </div>
                            <div className="chart-learning-v4-filters">
                              {(["all", "trend", "chop", "volatile"] as const).map((regime) => (
                                <button
                                  key={`sl-v4-regime-${regime}`}
                                  type="button"
                                  className={`chart-chip ${selfLearningJournalV4RegimeFilter === regime ? "active" : ""}`}
                                  onClick={() => setSelfLearningJournalV4RegimeFilter(regime)}
                                >
                                  R:{regime}
                                </button>
                              ))}
                              {(["all", "reversal", "continuation", "balance"] as const).map((scenario) => (
                                <button
                                  key={`sl-v4-scenario-${scenario}`}
                                  type="button"
                                  className={`chart-chip ${selfLearningJournalV4ScenarioFilter === scenario ? "active" : ""}`}
                                  onClick={() => setSelfLearningJournalV4ScenarioFilter(scenario)}
                                >
                                  S:{scenario}
                                </button>
                              ))}
                            </div>
                            <div className="chart-learning-v4-grid">
                              <span className={`chart-action-pill ${selfLearningV4Active ? "chart-action-pill-status good" : "chart-action-pill-status warn"}`}>Learning {selfLearningV4Active ? "ACTIVE" : "WARMUP"}</span>
                              <span className={`chart-action-pill chart-action-pill-status ${selfLearningStorageTone}`}>Persist {selfLearningStorageLabel}</span>
                              <span className="chart-action-pill">Scopes {selfLearningV4PersistenceStatus.scopeCount} · Active {selfLearningCurrentScopeCount}</span>
                              <span className="chart-action-pill">Load {selfLearningV4PersistenceStatus.stateLoadedAt ? formatClock(selfLearningV4PersistenceStatus.stateLoadedAt) : "--"}</span>
                              <span className="chart-action-pill">Save {selfLearningV4PersistenceStatus.stateSavedAt ? formatClock(selfLearningV4PersistenceStatus.stateSavedAt) : "--"}</span>
                              <span className="chart-action-pill">Scan {selfLearningV4PersistenceStatus.scopesLoadedAt ? formatClock(selfLearningV4PersistenceStatus.scopesLoadedAt) : "--"}</span>
                              <span className="chart-action-pill">Status {selfLearningV4PersistenceStatus.message}</span>
                              <span className="chart-action-pill">Regime {selfLearningRegimeV4.toUpperCase()}</span>
                              <span className="chart-action-pill">Weights {selfLearningV4WeightsLabel}</span>
                              <span className="chart-action-pill">Model {selfLearningV4ModelLabel}</span>
                              <span className="chart-action-pill">n {selfLearningProfile.sampleSize} · WR {selfLearningProfile.winratePct.toFixed(0)}%</span>
                              <span className="chart-action-pill">Upd {selfLearningModelUpdatedAt ? formatClock(selfLearningModelUpdatedAt) : "--"}</span>
                              <span className="chart-action-pill">WR {selfLearningDriftV4.longWinratePct.toFixed(0)}→{selfLearningDriftV4.shortWinratePct.toFixed(0)} (Δ{selfLearningDriftV4.winrateDropPct.toFixed(0)}%)</span>
                              <span className="chart-action-pill">Brier {(selfLearningDriftV4.longBrier ?? 0).toFixed(3)}→{(selfLearningDriftV4.shortBrier ?? 0).toFixed(3)} (Δ{selfLearningDriftV4.brierRise.toFixed(3)})</span>
                              <span className="chart-action-pill">Demoted {selfLearningDriftAutoDemotedAt ? formatClock(selfLearningDriftAutoDemotedAt) : "--"}</span>
                              <span className="chart-action-pill">DOM x{selfLearningAdaptiveWeights.dom.toFixed(2)} · FP x{selfLearningAdaptiveWeights.footprint.toFixed(2)}</span>
                              <span className="chart-action-pill">LIQ x{selfLearningAdaptiveWeights.liquidity.toFixed(2)} · PX x{selfLearningAdaptiveWeights["price-action"].toFixed(2)}</span>
                            </div>
                            <div className="chart-learning-v4-journal-list">
                              {filteredSelfLearningJournalV4Trail.slice(0, 6).map((event) => (
                                <div key={event.id} className="chart-learning-v4-journal-row">
                                  <span>{formatClock(event.timestampIso)}</span>
                                  <span>{event.regime}</span>
                                  <span>{event.scenario}</span>
                                  <span>{event.outcome}</span>
                                  <span>{event.pnl >= 0 ? "+" : ""}{event.pnl.toFixed(0)} USD</span>
                                </div>
                              ))}
                              {filteredSelfLearningJournalV4Trail.length === 0 ? <div className="chart-auto-exec-audit-empty">No V4 journal row for current filter.</div> : null}
                            </div>
                          </div>
                          <div className="chart-action-card-plan">
                            <span>Snap {marketDecisionV1.executionPlan.snapPriority}</span>
                            <span>Preset {marketDecisionV1.executionPlan.preset}</span>
                            <span>Guard {marketDecisionV1.executionPlan.guardEnabled ? "on" : "off"}</span>
                          </div>
                          {marketDecisionV1.suggestedBracket ? (
                            <div className="chart-action-card-bracket">
                              <span className="chart-action-pill">{marketDecisionV1.suggestedBracket.label}</span>
                              <span className="chart-action-pill">{marketDecisionV1.suggestedBracket.side.toUpperCase()} · RR {marketDecisionV1.suggestedBracket.rr.toFixed(2)}</span>
                              <span
                                className="chart-action-pill chart-action-pill-mono"
                                title={`E ${marketDecisionV1.suggestedBracket.entry.toFixed(chartPriceDigits)} / SL ${marketDecisionV1.suggestedBracket.sl.toFixed(chartPriceDigits)} / TP ${marketDecisionV1.suggestedBracket.tp.toFixed(chartPriceDigits)}`}
                              >
                                E {marketDecisionV1.suggestedBracket.entry.toFixed(chartPriceDigits)} · SL {marketDecisionV1.suggestedBracket.sl.toFixed(chartPriceDigits)} · TP {marketDecisionV1.suggestedBracket.tp.toFixed(chartPriceDigits)}
                              </span>
                              <button type="button" className="chart-chip" onClick={() => applySuggestedScenarioBracket(marketDecisionV1.suggestedBracket)}>Apply Bracket</button>
                              {marketDecisionV1.criticalConfirmed ? (
                                <>
                                  <button
                                    type="button"
                                    className="chart-chip active"
                                    onClick={() => {
                                      applySuggestedScenarioBracket(marketDecisionV1.suggestedBracket);
                                      applyExecutionAdaptationPlan(marketDecisionV1.executionPlan);
                                      setPendingExecutionAdaptation(null);
                                    }}
                                  >
                                    Approve All
                                  </button>
                                  <button
                                    type="button"
                                    className="chart-chip chart-buy-btn"
                                    onClick={() => {
                                      void approveAllAndSend();
                                    }}
                                  >
                                    {chartEffectiveSendMode === "confirm-required" && !chartHudConfirmArmed ? "Approve + Arm Send" : "Approve All + Send"}
                                  </button>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="chart-adapt-mode-row">
                            {(["auto", "confirm", "manual"] as const).map((mode) => (
                              <button
                                key={`adapt-${mode}`}
                                type="button"
                                className={`chart-chip ${executionAdaptMode === mode ? "active" : ""}`}
                                onClick={() => setExecutionAdaptMode(mode)}
                              >
                                {mode === "auto" ? "Auto adapt" : mode === "confirm" ? "Confirm adapt" : "Manual adapt"}
                              </button>
                            ))}
                          </div>
                          {pendingExecutionAdaptation ? (
                            <div className="chart-pending-adaptation">
                              <span>Pending adapt: snap {pendingExecutionAdaptation.plan.snapPriority} / preset {pendingExecutionAdaptation.plan.preset} / guard {pendingExecutionAdaptation.plan.guardEnabled ? "on" : "off"}</span>
                              <button
                                type="button"
                                className="chart-chip"
                                onClick={() => {
                                  applyExecutionAdaptationPlan(pendingExecutionAdaptation.plan);
                                  setPendingExecutionAdaptation(null);
                                }}
                              >
                                Apply Adaptation
                              </button>
                            </div>
                          ) : null}
                        </div>
                        {marketDecisionV1.criticalConfirmed ? <div className="chart-decision-confirmed">Critical confirmation: 2 sources aligned</div> : null}
                      </div>
                    </div>
                    ) : null}
                    <div className="chart-order-preset-row">
                      {(["scalp", "swing", "low-risk"] as const).map((presetKey) => (
                        <button
                          key={presetKey}
                          type="button"
                          className={`chart-chip${chartOrderTicket.preset === presetKey ? " active" : ""}`}
                          onClick={() => applyChartOrderPreset(presetKey)}
                        >
                          {presetKey === "low-risk" ? "LowRisk" : presetKey}
                        </button>
                      ))}
                    </div>
                    <div className="chart-order-mini-row">
                      <button type="button" className={`chart-chip ${chartOrderTicket.side === "buy" ? "chart-buy-btn" : ""}`} onClick={() => applyChartOrderPreset(chartOrderTicket.preset, "buy")}>Buy</button>
                      <button type="button" className={`chart-chip ${chartOrderTicket.side === "sell" ? "chart-sell-btn" : ""}`} onClick={() => applyChartOrderPreset(chartOrderTicket.preset, "sell")}>Sell</button>
                      <button type="button" className={`chart-chip ${chartOrderTicket.oco ? "active" : ""}`} onClick={() => setChartOrderTicket((v) => ({ ...v, oco: !v.oco }))}>OCO</button>
                      <button type="button" className={`chart-chip ${chartSnapEnabled ? "active" : ""}`} onClick={() => setChartSnapEnabled(!chartSnapEnabled)}>{chartSnapEnabled ? "Snap On" : "Snap Off"}</button>
                    </div>
                    <div className="chart-order-mini-row">
                      {(["execution", "vwap", "liquidity"] as const).map((priority) => (
                        <button
                          key={priority}
                          type="button"
                          className={`chart-chip ${chartSnapPriority === priority ? "active" : ""}`}
                          onClick={() => setChartSnapPriority(priority)}
                        >
                          {priority === "execution" ? "Exec" : priority === "vwap" ? "VWAP" : "Liquidity"}
                        </button>
                      ))}
                    </div>
                    <div className="chart-order-risk-row">
                      <span>Loss {chartRiskUsd.toFixed(2)}$</span>
                      <span>Gain {chartRewardUsd.toFixed(2)}$</span>
                      <span>RR {chartRiskReward.toFixed(2)}</span>
                    </div>
                    <div className="chart-order-risk-row chart-order-guard-row">
                      <label className="chart-order-guard-field">
                        <span>Perte max</span>
                        <input
                          type="number"
                          min={1}
                          step={10}
                          value={chartMaxLossUsd}
                          onChange={(event) => setChartMaxLossUsd(Math.max(1, Number(event.target.value || 0)))}
                          className="chart-order-risk-input"
                        />
                      </label>
                      <label className="chart-order-guard-field">
                        <span>Gain cible</span>
                        <input
                          type="number"
                          min={1}
                          step={10}
                          value={chartTargetGainUsd}
                          onChange={(event) => setChartTargetGainUsd(Math.max(1, Number(event.target.value || 0)))}
                          className="chart-order-risk-input"
                        />
                      </label>
                    </div>
                    <div className="chart-order-mini-row chart-order-guard-presets">
                      <button type="button" className={`chart-chip ${chartRiskGuardEnabled ? "active" : ""}`} onClick={() => setChartRiskGuardEnabled((v) => !v)}>
                        Guard {chartRiskGuardEnabled ? "On" : "Off"}
                      </button>
                      {uiMode === "novice" ? (
                        <>
                          <button type="button" className="chart-chip" onClick={() => { setChartMaxLossUsd(80); setChartTargetGainUsd(160); }}>Safe</button>
                          <button type="button" className="chart-chip" onClick={() => { setChartMaxLossUsd(120); setChartTargetGainUsd(240); }}>Balanced</button>
                        </>
                      ) : (
                        <button type="button" className="chart-chip" onClick={() => { setChartMaxLossUsd(250); setChartTargetGainUsd(500); }}>Desk</button>
                      )}
                      <span className={`chart-order-guard-status ${chartRiskLossExceeded ? "bad" : chartRiskTargetMiss ? "warn" : "ok"}`}>
                        {chartRiskLossExceeded
                          ? "loss-limit exceeded"
                          : chartRiskTargetMiss
                            ? "target gain below objective"
                            : "risk profile aligned"}
                      </span>
                    </div>
                    <div className="chart-order-risk-row chart-order-guard-kpi-row">
                      <span>RR target {chartRiskTargetRr.toFixed(2)}</span>
                      <span>{chartRiskGuardEnabled ? "guard active" : "guard bypass"}</span>
                    </div>
                    {chartRiskTargetMiss && (
                      <div className="chart-order-auto-confirm-hint">Auto rule: confirm-required active (gain cible non atteint).</div>
                    )}
                    <div className="chart-order-risk-row chart-order-snap-row">
                      <span>Step {chartPriceStep.toFixed(chartPriceDigits)}</span>
                      <span>{chartSnapEnabled ? `${chartSnapPriority.toUpperCase()} · ${chartSnapState?.label || "LIVE/CURSOR/VWAP/ROUND/CANDLE"} · ATRx${(clamp(1.16 - chartAtrLocalPct * 40, 0.52, 1.14)).toFixed(2)}` : "FREE DRAG"}</span>
                      <span>{chartSnapState ? chartSnapState.price.toFixed(chartPriceDigits) : ""}</span>
                    </div>
                    <div className="chart-order-risk-row chart-order-risk-sub">
                      <span>Entry {chartOrderTicket.entry.toFixed(2)}</span>
                      <span>SL {chartOrderTicket.sl.toFixed(2)}</span>
                      <span>TP {chartOrderTicket.tp.toFixed(2)}</span>
                    </div>
                    {uiMode === "novice" && (
                      <div className="chart-order-novice-tip">
                        Stop Loss coupe la position pour limiter la perte. Fixe Perte max et Gain cible pour garder un profil RR clair avant envoi.
                      </div>
                    )}
                    <div className="chart-order-mini-row">
                      <button type="button" className="chart-chip" onClick={() => setChartOrderPreviewOpen((v) => !v)}>{chartOrderPreviewOpen ? "Hide Preview" : "Preview"}</button>
                      {chartEffectiveSendMode === "confirm-required" && (
                        <button type="button" className={`chart-chip ${chartHudConfirmArmed ? "active" : ""}`} onClick={() => setChartHudConfirmArmed((v) => !v)}>
                          {chartHudConfirmArmed ? "Armed" : "Arm Send"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="chart-chip chart-buy-btn"
                        onClick={() => {
                          if (chartEffectiveSendMode === "confirm-required" && !chartHudConfirmArmed) {
                            setError("Confirmation requise: armez d’abord l’envoi.");
                            return;
                          }
                          const ack = chartEffectiveSendMode !== "confirm-required" || chartHudConfirmArmed;
                          setChartHudConfirmArmed(false);
                          void submitChartOrder(ack);
                        }}
                      >
                        {chartEffectiveSendMode === "confirm-required" ? "Confirm Send" : "Send"}
                      </button>
                      <button type="button" className="chart-chip" onClick={() => applyChartOrderPreset("scalp")}>Reset</button>
                    </div>
                    {mergedChartSendHistory.length > 0 && (
                      <div className="chart-order-send-history">
                        <div className="chart-order-send-history-title">Last 5 sends</div>
                        {mergedChartSendHistory.map((entry, index) => (
                          <div key={`send-hist-${index}-${entry.atIso}`} className="chart-order-send-history-row">
                            <span>{formatClock(entry.atIso)}</span>
                            <span>{entry.symbol}</span>
                            <span>{entry.side.toUpperCase()}</span>
                            <span>RR {entry.rr.toFixed(2)}</span>
                            <span className={entry.compliant ? "good" : "warn"}>{entry.compliant ? "limits_ok" : "limits_miss"}</span>
                            <span className="subtle mini">{entry.source || "local"}</span>
                            <span className={entry.outcome === "submitted" ? "good" : "warn"}>{entry.outcome === "confirmation-required" ? "confirm_required" : entry.outcome}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {(["entry", "sl", "tp"] as const).map((lineKey) => {
                    const value = chartOrderTicket[lineKey];
                    const stageHeight = chartStageRef.current?.clientHeight || 500;
                    const y = chartPriceToY(value, stageHeight);
                    const lineLabel = lineKey === "entry" ? "ENTRY" : lineKey === "sl" ? "SL" : "TP";
                    const activeSnapFamily = chartActiveSnapLine === lineKey ? chartSnapState?.family || null : null;
                    const delta = lineKey === "entry"
                      ? value - chartAnchorPrice
                      : value - chartOrderTicket.entry;
                    const pct = (lineKey === "entry" ? chartAnchorPrice : chartOrderTicket.entry) > 0
                      ? (delta / Math.max(0.0000001, lineKey === "entry" ? chartAnchorPrice : chartOrderTicket.entry)) * 100
                      : 0;
                    return (
                      <div
                        key={`chart-line-${lineKey}`}
                        className={[
                          `chart-order-line chart-order-line-${lineKey}`,
                          chartActiveSnapLine === lineKey ? "is-active" : "",
                          chartSnapPulseLine === lineKey ? "is-snap-pulse" : "",
                          activeSnapFamily && activeSnapFamily !== "manual" ? `snap-family-${activeSnapFamily}` : "",
                        ].filter(Boolean).join(" ")}
                        style={{ top: `${y}px` }}
                        onPointerDown={(event) => beginChartOrderDrag(event, lineKey)}
                      >
                        <span className="chart-order-line-label">
                          <strong>{lineLabel} {value.toFixed(2)}</strong>
                          <em>{delta >= 0 ? "+" : ""}{delta.toFixed(2)} · {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%</em>
                          {activeSnapFamily && activeSnapFamily !== "manual" ? <span className={`chart-order-line-snap-badge ${activeSnapFamily}`}>{activeSnapFamily}</span> : null}
                          <button
                            type="button"
                            className="chart-order-line-handle"
                            aria-label={`Fine drag ${lineLabel}`}
                            onPointerDown={(event) => beginChartOrderDrag(event, lineKey, true)}
                          >
                            Fine
                          </button>
                        </span>
                      </div>
                    );
                  })}

                  {chartReleaseTicket && (
                    <div className={`chart-order-release-ticket${chartReleaseTicket.armed ? " is-armed" : ""}${chartReleaseValidationPulse ? " release-validate-pulse" : ""}`} style={{ top: `${chartReleaseTicket.top}px` }}>
                      <div className="chart-order-release-title">{chartReleaseTicket.line.toUpperCase()} adjusted</div>
                      <div className="chart-order-release-meta">
                        <span>{chartReleaseTicket.price.toFixed(chartPriceDigits)}</span>
                        <span>{chartReleaseTicket.snapLabel}</span>
                        <span>{chartReleaseTicket.fineMode ? "Fine" : "Fast"}</span>
                      </div>
                      <div className="chart-order-release-actions chart-order-release-mode-row">
                        <button type="button" className={`chart-chip ${chartReleaseSendMode === "one-click" ? "active" : ""}`} onClick={() => setChartReleaseSendMode("one-click")}>One-click</button>
                        <button type="button" className={`chart-chip ${chartReleaseSendMode === "confirm-required" ? "active" : ""}`} onClick={() => setChartReleaseSendMode("confirm-required")}>Confirm-required</button>
                      </div>
                      <div className="chart-order-release-note">
                        {chartEffectiveSendMode === "one-click"
                          ? "Send lance l’ordre immédiatement depuis ce ticket."
                          : chartReleaseTicket.armed
                            ? "Deuxieme action activee: Send va confirmer l’ordre."
                            : "Armez d’abord l’envoi avant confirmation finale."}
                      </div>
                      {chartRiskTargetMiss && (
                        <div className="chart-order-release-note chart-order-release-note-warn">Auto confirm-required force tant que le gain cible n’est pas atteint.</div>
                      )}
                      <div className="chart-order-release-actions">
                        {chartEffectiveSendMode === "confirm-required" ? (
                          <button
                            type="button"
                            className={`chart-chip ${chartReleaseTicket.armed ? "active" : ""}`}
                            onClick={() => setChartReleaseTicket((current) => current ? { ...current, armed: !current.armed } : current)}
                          >
                            {chartReleaseTicket.armed ? "Armed" : "Arm Send"}
                          </button>
                        ) : (
                          <button type="button" className="chart-chip" onClick={() => setChartReleaseTicket(null)}>Close</button>
                        )}
                        <button type="button" className="chart-chip" onClick={() => { setChartOrderPreviewOpen(true); setChartReleaseTicket(null); }}>Preview</button>
                        <button
                          type="button"
                          className="chart-chip chart-buy-btn"
                          disabled={chartEffectiveSendMode === "confirm-required" && !chartReleaseTicket.armed}
                          onClick={() => {
                            setChartReleaseValidationPulse(true);
                            setChartReleaseTicket(null);
                            setChartHudConfirmArmed(false);
                            const ack = chartEffectiveSendMode !== "confirm-required" || chartReleaseTicket.armed;
                            void submitChartOrder(ack);
                          }}
                        >
                          {chartEffectiveSendMode === "one-click" ? "Send Now" : "Confirm Send"}
                        </button>
                      </div>
                    </div>
                  )}

                  {chartOrderPreviewOpen && (
                    <div className="chart-order-preview-card">
                      <div className="chart-order-preview-title">Bracket Preview</div>
                      <div className="chart-order-preview-grid">
                        <span>Side</span><strong>{chartOrderTicket.side.toUpperCase()}</strong>
                        <span>Symbol</span><strong>{selectedChartSymbol}</strong>
                        <span>Entry</span><strong>{chartOrderTicket.entry.toFixed(4)}</strong>
                        <span>Stop Loss</span><strong>{chartOrderTicket.sl.toFixed(4)}</strong>
                        <span>Take Profit</span><strong>{chartOrderTicket.tp.toFixed(4)}</strong>
                        <span>OCO</span><strong>{chartOrderTicket.oco ? "ON" : "OFF"}</strong>
                        <span>Perte max</span><strong className="warn">{chartRiskUsd.toFixed(2)} USD</strong>
                        <span>Gain cible</span><strong className="good">{chartRewardUsd.toFixed(2)} USD</strong>
                        <span>R/R</span><strong>{chartRiskReward.toFixed(2)}</strong>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            {showDecisionOverlay && (
              <aside className="decision-overlay-panel" role="complementary" aria-label="AI Decision Analysis">
                <div className="dov-header">
                  <span className="dov-title">AI Decision</span>
                  <span className="dov-ts">{overlayDecisionTs ? overlayDecisionTs.replace("T", " ").slice(0, 19).slice(-8) : "–"}</span>
                </div>
                {overlayDecisionRegime !== "–" && (
                  <span className={`dov-regime-badge${overlayDecisionRegime === "high" ? " high" : overlayDecisionRegime === "medium" ? " medium" : " low"}`}>{overlayDecisionRegime}</span>
                )}
                  {overlayDecisionConsensus > 0 && (
                  <div className="dov-row">
                    <span className="dov-label">Consensus</span>
                    <div className="dov-bar-wrap"><div className="dov-bar dov-bar-consensus" style={{ width: `${Math.min(100, overlayDecisionConsensus).toFixed(0)}%` }} /></div>
                    <span className="dov-val">{overlayDecisionConsensus.toFixed(0)}%</span>
                  </div>
                )}
                {(overlayDecisionMemorySim > 0 || overlayDecisionMemoryCases > 0) && (
                  <div className="dov-row">
                    <span className="dov-label">Memory</span>
                    <span className="dov-val">
                      {overlayDecisionMemorySim > 0 ? `sim ${overlayDecisionMemorySim.toFixed(2)}` : ""}
                      {overlayDecisionMemoryCases > 0 ? ` ${overlayDecisionMemoryCases}c` : ""}
                    </span>
                  </div>
                )}
                {agentWeightedVotes.length > 0 && (
                  <>
                    <div className="dov-agents">
                      {agentWeightedVotes.map((wv, i) => {
                        const dir = String(wv.vote.direction || wv.vote.vote || "").toLowerCase();
                        const isSuppressed = wv.accuracyPct < 45;
                        return (
                          <span
                            key={`av-${i}`}
                            className={`dov-agent-vote${dir.includes("buy") ? " buy" : dir.includes("sell") ? " sell" : ""}${isSuppressed ? " suppressed" : ""}`}
                            title={`accuracy ${wv.accuracyPct.toFixed(0)}%`}
                          >
                            {String(wv.vote.agent || wv.vote.name || `A${i + 1}`).slice(0, 5)}{" "}
                            {String(wv.vote.direction || wv.vote.vote || "–").slice(0, 4)}
                            {!isSuppressed && <span className="adv-weight">{(wv.weight * 100).toFixed(0)}</span>}
                            {isSuppressed && <span className="adv-suppressed">↓</span>}
                          </span>
                        );
                      })}
                    </div>
                    {weightedConsensus !== null && (
                      <div className="dov-row">
                        <span className="dov-label">W.Cons</span>
                        <div className="dov-bar-wrap">
                          <div className="dov-bar dov-bar-consensus" style={{ width: `${Math.min(100, weightedConsensus).toFixed(0)}%` }} />
                        </div>
                        <span className={`dov-val${weightedConsensus < 40 ? " warn" : ""}`}>{weightedConsensus.toFixed(0)}%</span>
                      </div>
                    )}
                    {consensusPenaltyActive && (
                      <div className="consensus-penalty-flag">⚠ Low consensus — signal unreliable</div>
                    )}
                  </>
                )}
                {/* ── CALIBRATION LAYER ── */}
                {calibMismatch && calibMismatchLabel && (
                  <div className={`dov-mismatch${calibBlame === "bad_decision" ? " decision" : ""}`}>
                    <span className="dov-mismatch-icon">⚠</span>
                    <span>MISMATCH</span>
                    <span className="dov-mismatch-detail">{calibMismatchLabel}</span>
                  </div>
                )}
                {isHighRisk && (
                  <span className="high-risk-badge">⚠ HIGH RISK</span>
                )}
                {requiresHumanApproval && (
                  <div className="human-approval-gate">
                    🔒 APPROBATION REQUISE
                    <span className="hag-reason">
                      {extendedBlame === "latency_spike"
                        ? "latency spike"
                        : isHighRisk
                        ? "non cartographié"
                        : "consensus faible"}
                    </span>
                  </div>
                )}
                {overlayDecisionScore > 0 && (
                  <>
                    <div className="dov-row">
                      <span className="dov-label">Score</span>
                      <div className="dov-bar-wrap">
                        <div className="dov-bar" style={{ width: `${Math.min(100, effectiveScoreFull * 100).toFixed(0)}%`, background: effectiveScoreFull >= 0.7 ? "#6ee7a7" : effectiveScoreFull >= 0.5 ? "#ffd166" : "#ff7d7d" }} />
                      </div>
                      <span className="dov-val">
                        {effectiveScoreFull.toFixed(2)}
                        {scoreWasAdjusted && <span className="dov-adjust-tag">adj</span>}
                      </span>
                    </div>
                    {calibWinrateCI && calibCurrentBucket && (
                      <div className="calib-ci">
                        WR {((calibCurrentBucket.wins / calibCurrentBucket.total) * 100).toFixed(0)}%
                        {" "}±{((calibWinrateCI.high - calibWinrateCI.low) * 50).toFixed(0)}pts
                        <span className="calib-ci-sub">
                          90% CI ({(calibWinrateCI.low * 100).toFixed(0)}–{(calibWinrateCI.high * 100).toFixed(0)}%)
                        </span>
                      </div>
                    )}
                    {scoreWasAdjusted && (
                      <div className="dov-row">
                        <span className="dov-label">Raw</span>
                        <span className="dov-val">{overlayDecisionScore.toFixed(2)}</span>
                        <span className="dov-val" style={{ color: "rgba(225,233,244,0.35)" }}>×{calibFactorBayes.toFixed(2)} Bayes</span>
                      </div>
                    )}
                    {(confidenceDecay > 0 || microDecay > 0) && (
                      <div className="decay-note">
                        ↓{decayHighLatency ? " lat" : ""}{decayHighVolatility ? " vol" : ""}{decayWideSpread ? " spread" : ""}{decayExtremeImbalance ? " imb" : ""} −{((confidenceDecay + microDecay) * 100).toFixed(0)}pts
                      </div>
                    )}
                  </>
                )}
                {calibAgentAccuracy.length > 0 && (
                  <div style={{ borderTop: "1px solid rgba(120,147,188,0.1)", paddingTop: 5, marginTop: 2 }}>
                    <div className="dov-label" style={{ marginBottom: 3 }}>Agent accuracy</div>
                    {calibAgentAccuracy.map((agent) => (
                      <div key={agent.name} className="dov-row" style={{ gap: 4 }}>
                        <span className="dov-label" style={{ width: 44 }}>{agent.name}</span>
                        <div className="dov-bar-wrap"><div className="dov-bar" style={{ width: `${agent.accuracy.toFixed(0)}%`, background: agent.accuracy >= 60 ? "#6ee7a7" : agent.accuracy >= 45 ? "#ffd166" : "#ff7d7d" }} /></div>
                        <span className="dov-val">{agent.accuracy.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                )}
                {calibBuckets.length > 0 && (
                  <div style={{ borderTop: "1px solid rgba(120,147,188,0.1)", paddingTop: 5, marginTop: 2 }}>
                    <div className="dov-label" style={{ marginBottom: 3 }}>Score calibration</div>
                    {calibBuckets.map((b) => (
                      <div key={b.label} className="dov-row" style={{ gap: 4 }}>
                        <span className="dov-label" style={{ width: 32 }}>{b.label}</span>
                        <div className="dov-bar-wrap"><div className="dov-bar" style={{ width: `${((b.wins / b.total) * 100).toFixed(0)}%`, background: (b.wins / b.total) >= 0.55 ? "#6ee7a7" : "#ffd166" }} /></div>
                        <span className="dov-val">{((b.wins / b.total) * 100).toFixed(0)}%/{b.total}</span>
                      </div>
                    ))}
                  </div>
                )}
                {strategyPerformance.length > 0 && (
                  <div style={{ borderTop: "1px solid rgba(120,147,188,0.1)", paddingTop: 5, marginTop: 2 }}>
                    <div className="dov-label" style={{ marginBottom: 3 }}>Strategy survival</div>
                    <div className="strategy-survival-table">
                      {strategyPerformance.map((s) => (
                        <div key={s.id} className={`ssrow ssrow-${s.status}`}>
                          <span className="ssr-id">{s.id.slice(0, 12)}</span>
                          <span className="ssr-wr">{s.winrate.toFixed(0)}%</span>
                          <span className="ssr-pnl">{s.avgPnl >= 0 ? "+" : ""}{s.avgPnl.toFixed(0)}$</span>
                          <span className="ssr-status">
                            {s.status}
                            {s.cooldownRemaining > 0 && (
                              <span className={`hysteresis-badge${s.status === "reduce" ? " reduced" : ""}`} style={{ marginLeft: 4 }}>
                                🔒 {s.cooldownRemaining}h
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                    {(strategyDemoteCount > 0 || strategyReduceCount > 0) && (
                      <div className="dov-row" style={{ marginTop: 3 }}>
                        {strategyDemoteCount > 0 && <span className="dov-val warn">{strategyDemoteCount} demote</span>}
                        {strategyReduceCount > 0 && <span className="dov-val" style={{ color: "#ffd166" }}>{strategyReduceCount} reduce</span>}
                      </div>
                    )}
                  </div>
                )}
                {overlayDecisionRationale && (
                  <div className="dov-rationale" title={overlayDecisionRationale}>{overlayDecisionRationale.slice(0, 110)}</div>
                )}
              </aside>
            )}
          </div>

          <div className="overlay-legend-compact">
            <span className="olc">Route {preferredRoute ? String(preferredRoute.venue || "–") : "–"}</span>
            <span className="olc">DOM {depthStreamState}</span>
            <span className={`olc ${toNumber(marketMicro?.depth_imbalance, 0) >= 0 ? "olc-green" : "olc-red"}`}>Imb {toNumber(marketMicro?.depth_imbalance, 0).toFixed(3)}</span>
            <span className="olc">Tape {activeTape.length}</span>
            {uiMode === "expert" ? <span className="olc" style={{ marginLeft: "auto" }}>Bid {toNumber(orderbook?.bid, 0).toFixed(2)} / Ask {toNumber(orderbook?.ask, 0).toFixed(2)}</span> : null}
            <button type="button" className="chart-chip chart-buy-btn" onClick={() => applyChartOrderPreset(chartOrderTicket.preset === "custom" ? "scalp" : chartOrderTicket.preset, "buy")} disabled={replayState.enabled}>▲ Buy</button>
            <button type="button" className="chart-chip chart-sell-btn" onClick={() => applyChartOrderPreset(chartOrderTicket.preset === "custom" ? "scalp" : chartOrderTicket.preset, "sell")} disabled={replayState.enabled}>▼ Sell</button>
          </div>
        </PanelShell>
          </Panel>
          <PanelResizeHandle
          className="term-core-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize execution lane"
          title="Drag to resize. Double click to reset."
          onDoubleClick={() => {
            if (termCoreGroupRef.current) {
              const left = uiMode === "novice" ? 72 : 78;
              setLayoutCoreSplit(left);
              termCoreGroupRef.current.setLayout([left, 100 - left]);
            }
          }}
        >
          <span className="term-core-resize-grip" aria-hidden="true" />
          </PanelResizeHandle>
          <Panel defaultSize={Math.max(15, 100 - layoutCoreSplit)} minSize={20} className="txt-split-panel txt-split-panel-right">

        {/* ── EXECUTION LANE ── */}
        <PanelShell className="panel term-exec-panel gtix-panel-resizable-y">
          <div className="exec-lane-header"><span className="eyebrow">Execution Lane</span><span className={`status-chip ${avgLatency > 200 ? "alert-chip" : ""}`}>live {avgLatency.toFixed(0)} ms</span><HelpHint text="Route préférée, surveillance slippage/latence, replay et ticket d'ordre gouverné." examples={["Route préférée = venue avec le plus petit spread.", "Replay = dernier fill series avec timeline et histogramme slippage."]} /></div>
          {showExecOverlay && (
            <div className="exec-overlay-strip">
              <div className="eov-block">
                <span className="eov-label">Route</span>
                <span className="eov-value">{replayRoute}</span>
                {overlayRouteAlt !== "–" && <span className="eov-alt">alt: {overlayRouteAlt}</span>}
              </div>
              <div className="eov-block">
                <span className="eov-label">Slip exp.</span>
                <span className="eov-value">{overlaySlippageExpected > 0 ? `${overlaySlippageExpected.toFixed(1)}bps` : "–"}</span>
              </div>
              <div className="eov-block">
                <span className="eov-label">Slip réel</span>
                <span className={`eov-value ${replaySlippage > 15 ? "warn" : "good"}`}>{replaySlippage.toFixed(1)}bps</span>
              </div>
              <div className="eov-block">
                <span className="eov-label">Δslip</span>
                <span className={`eov-value ${overlaySlippageDelta > 5 ? "warn" : overlaySlippageDelta < 0 ? "good" : ""}`}>{overlaySlippageDelta >= 0 ? "+" : ""}{overlaySlippageDelta.toFixed(1)}bps</span>
              </div>
              {overlayLatDecision > 0 && (
                <div className="eov-block">
                  <span className="eov-label">Lat dec.</span>
                  <span className="eov-value">{overlayLatDecision.toFixed(0)}ms</span>
                </div>
              )}
              {overlayLatRouting > 0 && (
                <div className="eov-block">
                  <span className="eov-label">Lat rout.</span>
                  <span className="eov-value">{overlayLatRouting.toFixed(0)}ms</span>
                </div>
              )}
              <div className="eov-block">
                <span className="eov-label">e2e</span>
                <span className={`eov-value ${replayLatency > 200 ? "warn" : "good"}`}>{replayLatency.toFixed(0)}ms</span>
              </div>
              {execQualityScore !== null && (
                <div className="eov-block">
                  <span className="eov-label">Exec</span>
                  <span className={`eov-value exec-qual-${execQualityLabel}`}>
                    {execQualityLabel} {(execQualityScore * 100).toFixed(0)}%
                  </span>
                </div>
              )}
              <span className="eov-fills">{replayFills.length} fills</span>
            </div>
          )}
          <div className="exec-route-block">
            <div className="exec-route-label">Route préférée</div>
            <div className="exec-route-value">{preferredRoute ? String(preferredRoute.venue || "–") : "–"}</div>
            <div className="subtle mini">spread {preferredSpread.toFixed(4)}</div>
            <div className="subtle mini">Backup: {backupRoute ? `${String(backupRoute.venue || "–")} · score ${backupScore.toFixed(1)}` : "n/a"}</div>
          </div>
          <div className="exec-kpis">
            <span className={`status-chip ${avgSlippage > 15 ? "alert-chip" : ""}`}>slip {avgSlippage.toFixed(1)} bps</span>
            <span className={`status-chip ${avgLatency > 200 ? "alert-chip" : ""}`}>lat {avgLatency.toFixed(0)} ms</span>
          </div>
          <div className="exec-mini-dom">
            {domLevels.slice(0, 6).map((lvl, index) => (
              <div key={`exec-dom-${index}`} className={`exec-mini-dom-row ${lvl.side}`}>
                <span>{lvl.side === "ask" ? "A" : "B"}</span>
                <strong>{lvl.price.toFixed(1)}</strong>
                <span>{lvl.size}</span>
              </div>
            ))}
          </div>
          <div className="exec-replay-block">
            <div className="chart-stat-label" style={{ marginBottom: 6 }}>Replay decision</div>
            <select value={replayDecisionId} onChange={(e) => setReplayDecisionId(e.target.value)} style={{ width: "100%", fontSize: 11, marginBottom: 8 }}>
              {replayOptions.length === 0 ? <option value="">Aucune décision</option> : null}
              {replayOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.id.slice(0, 24)}</option>)}
            </select>
            {replayError ? <div className="warn mini">{replayError}</div> : null}
            {replayLoading ? <div className="subtle mini">Chargement…</div> : null}
{/* ── BLAME TAG ── */}
            {!replayLoading && extendedBlame && (
              <div className={`blame-tag blame-${extendedBlame}`}>
                <span className="blame-icon">
                  {extendedBlame === "bad_execution"  ? "⚙"
                   : extendedBlame === "bad_decision"  ? "🧠"
                   : extendedBlame === "latency_spike" ? "⚡"
                   : extendedBlame === "regime_mismatch" ? "↔"
                   : extendedBlame === "memory_bias"   ? "📚"
                   : "〜"}
                </span>
                <span className="blame-label">LOSS CAUSE</span>
                <span className="blame-value">{extendedBlame.replace(/_/g, " ")}</span>
              </div>
            )}
            {!replayLoading && replayTelemetry ? (
              <div className="replay-mini-grid">
                <div><div className="chart-stat-label">Route</div><div style={{ fontSize: 12 }}>{replayRoute}</div></div>
                <div><div className="chart-stat-label">Slip</div><div style={{ fontSize: 12 }}>{replaySlippage.toFixed(2)} bps</div></div>
                <div><div className="chart-stat-label">Lat</div><div style={{ fontSize: 12 }}>{replayLatency.toFixed(0)} ms</div></div>
                <div><div className="chart-stat-label">Fills</div><div style={{ fontSize: 12 }}>{replayFills.length}</div></div>
              </div>
            ) : null}
            {/* ── TRADE LIFECYCLE ── */}
            {!replayLoading && calibLifecycle.length > 0 ? (
              <div style={{ marginTop: 8 }}>
                <div className="chart-stat-label" style={{ marginBottom: 6 }}>Trade lifecycle</div>
                <div className="lifecycle-strip">
                  {calibLifecycle.map((step, i) => {
                    const offset = calibLifecycle.length > 1
                      ? ((new Date(step.ts).getTime() - new Date(calibLifecycle[0].ts).getTime()) / calibLifecycleDurationMs) * 100
                      : (i / Math.max(1, calibLifecycle.length - 1)) * 100;
                    return (
                      <div key={`lc-${i}`} className={`lifecycle-point lifecycle-${step.kind}`} style={{ left: `${Math.max(0, Math.min(96, offset))}%` }}>
                        <span className="lifecycle-dot" />
                        <div className="lifecycle-label">{step.label}<br /><small>{formatClock(step.ts)}</small></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {!replayLoading && replayHistogram.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <div className="chart-stat-label" style={{ marginBottom: 4 }}>Histogramme slippage</div>
                {replayHistogram.slice(0, 5).map((it) => (
                  <div className="histogram-row" key={`rh-${it.bucket}`}>
                    <span style={{ minWidth: 36, fontSize: 11 }}>{it.bucket}bps</span>
                    <span className="histogram-bar"><span style={{ width: `${(it.count / replayHistogramMax) * 100}%` }} /></span>
                    <strong style={{ fontSize: 11 }}>{it.count}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="exec-recent-block">
            <div className="chart-stat-label" style={{ marginBottom: 4 }}>Récentes</div>
            {replayItems.slice(0, 4).map((item, rri) => (
              <div className="exec-recent-row" key={`er-${rri}`}>
                <span className="exec-recent-sym">{instrumentLabel(item).slice(0, 10)}</span>
                <span className="subtle mini">{String(item.route_chosen || item.strategy_id || "–").slice(0, 12)}</span>
                <span className={`subtle mini ${toNumber(item.realized_slippage_bps || item.slippage_real_bps, 0) > 15 ? "warn" : ""}`}>{toNumber(item.realized_slippage_bps || item.slippage_real_bps, 0).toFixed(1)}bps</span>
              </div>
            ))}
          </div>
          <div className="exec-ticket-block">
            <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>Ticket gouverné</div>
            {replayState.enabled ? <div className="replay-exec-guard">Replay Mode — execution disabled</div> : null}
            <div className="ticket-grid">
              <input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="account_id" disabled={replayState.enabled} />
              <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="symbol" disabled={replayState.enabled} />
              <select value={side} onChange={(e) => setSide(e.target.value)} disabled={replayState.enabled}>
                <option value="buy">buy</option>
                <option value="sell">sell</option>
              </select>
              <input type="number" step="0.01" value={lots} onChange={(e) => setLots(Number(e.target.value || 0))} placeholder="lots" disabled={replayState.enabled} />
              <input type="number" step="1" value={notional} onChange={(e) => setNotional(Number(e.target.value || 0))} placeholder="notional USD" disabled={replayState.enabled} />
              <input type="number" step="1" value={maxSpread} onChange={(e) => setMaxSpread(Number(e.target.value || 0))} placeholder="max spread bps" disabled={replayState.enabled} />
              <input value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="rationale" style={{ gridColumn: "1 / -1" }} disabled={replayState.enabled} />
              <button type="button" onClick={() => void submitTradeTicket()} disabled={busy || replayState.enabled} className="exec-send-order" style={{ gridColumn: "1 / -1" }}>{busy ? "Envoi…" : "Send Order"}</button>
            </div>
            {tradeResult ? (
              <details style={{ marginTop: 8 }}>
                <summary className="subtle mini">Résultat</summary>
                <pre style={{ fontSize: 10, whiteSpace: "pre-wrap", margin: 0, overflow: "hidden" }}>{JSON.stringify(tradeResult, null, 2)}</pre>
              </details>
            ) : null}
          </div>
        </PanelShell>
          </Panel>
        </PanelGroup>
      </section>

      {/* ═══════════════ MICROSTRUCTURE 2×2 ════════════════════ */}
      <section
        className={`term-micro-shell${layoutDropPreview?.zone === "micro" ? " is-drop-zone-active" : ""}`}
        onDragOver={(event) => {
          if (layoutEditMode) {
            event.preventDefault();
            setLayoutDropPreview({ zone: "micro", mode: "zone" });
          }
        }}
        onDragLeave={() => {
          if (layoutDropPreview?.zone === "micro" && layoutDropPreview.mode === "zone") {
            setLayoutDropPreview(null);
          }
        }}
        onDrop={() => handleLayoutDropToZone("micro")}
      >
        <div className="micro-overview-bar">
          <span className="micro-overview-title">Microstructure</span>
          <span className="micro-overview-chip">DOM</span>
          <span className="micro-overview-chip">Footprint</span>
          <span className="micro-overview-chip">Tape</span>
          <span className="micro-overview-chip">Heatmap</span>
        </div>

      <div className="term-micro-grid">

        {/* DOM */}
        <div
          className={`layout-draggable-card${layoutEditMode ? " is-edit" : ""}${layoutDropPreview?.zone === "micro" && layoutDropPreview.targetId === "dom" ? " is-drop-target" : ""}`}
          draggable={layoutEditMode}
          onDragStart={() => { layoutDragRef.current = { zone: "micro", id: "dom" }; setLayoutDropPreview({ zone: "micro", targetId: "dom", mode: "panel" }); }}
          onDragEnd={() => { layoutDragRef.current = null; setLayoutDropPreview(null); }}
          onDragOver={(event) => { if (layoutEditMode) { event.preventDefault(); setLayoutDropPreview({ zone: "micro", targetId: "dom", mode: "panel" }); } }}
          onDrop={() => handleLayoutDrop("micro", "dom")}
          style={{ order: microOrderById.dom ?? 0, display: floatingPanels.some((fp) => fp.id === "dom") ? "none" : undefined }}
        >
        <PanelShell className="panel micro-panel gtix-panel-resizable-y">
          <div className="eyebrow micro-panel-title">
            DOM <span className={`micro-stream-badge micro-stream-${depthStreamState}`}>{depthStreamState}</span>
            <HelpTooltip termKey="dom" mode={uiMode} />
            {layoutEditMode && <button type="button" className="panel-detach-btn" title="Floating" onClick={() => detachPanel("dom", "micro")}>⤡</button>}
          </div>
          <div className="dom-table-compact">
            <div className="dom-header-row"><span>Side</span><span>Prix</span><span>Taille</span><span>Profondeur</span></div>
            {activeDomLevels.map((lvl, di) => (
              <div key={`dom-${di}`} className={`dom-row-compact ${lvl.side} ${di === highlightedDomIndex ? "row-highlight" : ""}`}>
                <span className={`dom-side-label ${lvl.side}`}>{lvl.side === "ask" ? "A" : "B"}</span>
                <span className="dom-price">{lvl.price.toFixed(1)}</span>
                <span className="dom-size">{lvl.size}</span>
                <span className="dom-bar-cell"><span style={{ width: `${Math.min(100, lvl.intensity * 100)}%` }} /></span>
              </div>
            ))}
          </div>
        </PanelShell>
        </div>

        {/* Footprint */}
        <div
          className={`layout-draggable-card${layoutEditMode ? " is-edit" : ""}${layoutDropPreview?.zone === "micro" && layoutDropPreview.targetId === "footprint" ? " is-drop-target" : ""}`}
          draggable={layoutEditMode}
          onDragStart={() => { layoutDragRef.current = { zone: "micro", id: "footprint" }; setLayoutDropPreview({ zone: "micro", targetId: "footprint", mode: "panel" }); }}
          onDragEnd={() => { layoutDragRef.current = null; setLayoutDropPreview(null); }}
          onDragOver={(event) => { if (layoutEditMode) { event.preventDefault(); setLayoutDropPreview({ zone: "micro", targetId: "footprint", mode: "panel" }); } }}
          onDrop={() => handleLayoutDrop("micro", "footprint")}
          style={{ order: microOrderById.footprint ?? 1, display: floatingPanels.some((fp) => fp.id === "footprint") ? "none" : undefined }}
        >
        <PanelShell className="panel micro-panel gtix-panel-resizable-y">
          <div className="eyebrow micro-panel-title">
            Footprint <HelpTooltip termKey="footprint" mode={uiMode} />
            {layoutEditMode && <button type="button" className="panel-detach-btn" title="Floating" onClick={() => detachPanel("footprint", "micro")}>⤡</button>}
          </div>
          <div className="footprint-compact">
            <div className="fp-header-row"><span>Niveau</span><span className="good">Buy</span><span className="warn">Sell</span><span>Δ</span></div>
            {activeFootprintRows.map((row, fpi) => (
              <div key={`fpc-${fpi}`} className={`fp-row-compact ${fpi === highlightedFootprintIndex ? "row-highlight" : ""}`}>
                <span className="fp-level">{row.timeLabel ? `${row.timeLabel} · ` : ""}{row.high.toFixed(0)}–{row.low.toFixed(0)}</span>
                <span className="good fp-num">{row.buyVolume.toFixed(0)}</span>
                <span className="warn fp-num">{row.sellVolume.toFixed(0)}</span>
                <span className={`fp-num ${row.delta >= 0 ? "good" : "warn"}`}>{row.delta.toFixed(0)}</span>
              </div>
            ))}
          </div>
        </PanelShell>
        </div>

        {/* Tape */}
        <div
          className={`layout-draggable-card${layoutEditMode ? " is-edit" : ""}${layoutDropPreview?.zone === "micro" && layoutDropPreview.targetId === "tape" ? " is-drop-target" : ""}`}
          draggable={layoutEditMode}
          onDragStart={() => { layoutDragRef.current = { zone: "micro", id: "tape" }; setLayoutDropPreview({ zone: "micro", targetId: "tape", mode: "panel" }); }}
          onDragEnd={() => { layoutDragRef.current = null; setLayoutDropPreview(null); }}
          onDragOver={(event) => { if (layoutEditMode) { event.preventDefault(); setLayoutDropPreview({ zone: "micro", targetId: "tape", mode: "panel" }); } }}
          onDrop={() => handleLayoutDrop("micro", "tape")}
          style={{ order: microOrderById.tape ?? 2, display: floatingPanels.some((fp) => fp.id === "tape") ? "none" : undefined }}
        >
        <PanelShell className="panel micro-panel gtix-panel-resizable-y">
          <div className="eyebrow micro-panel-title">
            Tape <HelpTooltip termKey="tape" mode={uiMode} />
            {layoutEditMode && <button type="button" className="panel-detach-btn" title="Floating" onClick={() => detachPanel("tape", "micro")}>⤡</button>}
          </div>
          <div className="tape-compact">
            {activeTape.map((print, ti) => (
              <div key={`tp-${ti}`} className={`tape-row-compact ${print.side} ${ti === highlightedTapeIndex ? "row-highlight" : ""}`}>
                <span className="tape-time">{print.label.slice(-8)}</span>
                <span className="tape-price">{print.price.toFixed(1)}</span>
                <span className="tape-vol">{print.volume}</span>
                <span className={`tape-badge ${print.side}`}>{print.side === "buy" ? "B" : print.side === "sell" ? "S" : "–"}</span>
              </div>
            ))}
          </div>
        </PanelShell>
        </div>

        {/* Heatmap */}
        <div
          className={`layout-draggable-card${layoutEditMode ? " is-edit" : ""}${layoutDropPreview?.zone === "micro" && layoutDropPreview.targetId === "heatmap" ? " is-drop-target" : ""}`}
          draggable={layoutEditMode}
          onDragStart={() => { layoutDragRef.current = { zone: "micro", id: "heatmap" }; setLayoutDropPreview({ zone: "micro", targetId: "heatmap", mode: "panel" }); }}
          onDragEnd={() => { layoutDragRef.current = null; setLayoutDropPreview(null); }}
          onDragOver={(event) => { if (layoutEditMode) { event.preventDefault(); setLayoutDropPreview({ zone: "micro", targetId: "heatmap", mode: "panel" }); } }}
          onDrop={() => handleLayoutDrop("micro", "heatmap")}
          style={{ order: microOrderById.heatmap ?? 3, display: floatingPanels.some((fp) => fp.id === "heatmap") ? "none" : undefined }}
        >
        <PanelShell className="panel micro-panel gtix-panel-resizable-y">
          <div className="eyebrow micro-panel-title">
            Heatmap <span className="subtle mini" style={{ marginLeft: 6 }}>{String(sessionState?.session || "–")} · imb {toNumber(marketMicro?.depth_imbalance, 0).toFixed(3)}</span>
            <HelpTooltip termKey="heatmap" mode={uiMode} />
            {layoutEditMode && <button type="button" className="panel-detach-btn" title="Floating" onClick={() => detachPanel("heatmap", "micro")}>⤡</button>}
          </div>
          <div className="heatmap-compact">
            {activeHeatmapLevels.map((lvl, hi) => (
              <div key={`hm-${hi}`} className={`hm-row ${lvl.side} ${hi === highlightedHeatmapIndex ? "row-highlight" : ""}`} style={{ opacity: Math.max(0.2, lvl.intensity) }}>
                <span className="hm-price">{lvl.price.toFixed(1)}</span>
                <div className="hm-bar-wrap"><div className={`hm-bar ${lvl.side}`} style={{ width: `${Math.min(100, lvl.intensity * 100)}%` }} /></div>
                <span className="hm-size">{lvl.size}</span>
              </div>
            ))}
          </div>
        </PanelShell>
        </div>
      </div>
      </section>

      {/* ═══════════════ MATRICE MULTI-MARCHÉS ═════════════════ */}
      <section className="term-markets-strip">
        <div className="panel market-matrix-panel">
          <div className="eyebrow">Market Matrix</div>
          <div className="market-matrix-table">
            <div className="market-matrix-head"><span>Market</span><span>Px</span><span>Δ</span><span>Spread</span><span>Funding</span><span>OI</span><span>Volume</span><span>Regime</span><span>Sent.</span></div>
            {marketMatrixRows.map((row) => (
              <div key={row.symbol} className="market-matrix-row">
                <span className="market-matrix-symbol">{row.symbol}</span>
                <span>{row.price > 0 ? row.price.toFixed(2) : "–"}</span>
                <span className={row.deltaPct >= 0 ? "good" : "warn"}>{row.deltaPct >= 0 ? "+" : ""}{row.deltaPct.toFixed(2)}%</span>
                <span>{row.spread > 0 ? row.spread.toFixed(3) : "–"}</span>
                <span>{row.funding}</span>
                <span>{row.openInterest}</span>
                <span>{row.volume > 0 ? row.volume.toFixed(0) : "–"}</span>
                <span className={row.volatilityRegime === "high" ? "warn" : row.volatilityRegime === "medium" ? "subtle" : "good"}>{row.volatilityRegime}</span>
                <span className={row.sentiment === "risk-on" ? "good" : "warn"}>{row.sentiment}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ LOWER: BLOTTER + BROKERS ══════════════ */}
      <section
        className={`term-lower${layoutDropPreview?.zone === "lower" ? " is-drop-zone-active" : ""}`}
        onDragOver={(event) => {
          if (layoutEditMode) {
            event.preventDefault();
            setLayoutDropPreview({ zone: "lower", mode: "zone" });
          }
        }}
        onDragLeave={() => {
          if (layoutDropPreview?.zone === "lower" && layoutDropPreview.mode === "zone") {
            setLayoutDropPreview(null);
          }
        }}
        onDrop={() => handleLayoutDropToZone("lower")}
      >
        <div
          className={`layout-draggable-card${layoutEditMode ? " is-edit" : ""}${layoutDropPreview?.zone === "lower" && layoutDropPreview.targetId === "blotter" ? " is-drop-target" : ""}`}
          draggable={layoutEditMode}
          onDragStart={() => { layoutDragRef.current = { zone: "lower", id: "blotter" }; setLayoutDropPreview({ zone: "lower", targetId: "blotter", mode: "panel" }); }}
          onDragEnd={() => { layoutDragRef.current = null; setLayoutDropPreview(null); }}
          onDragOver={(event) => { if (layoutEditMode) { event.preventDefault(); setLayoutDropPreview({ zone: "lower", targetId: "blotter", mode: "panel" }); } }}
          onDrop={() => handleLayoutDrop("lower", "blotter")}
          style={{ order: lowerOrderById.blotter ?? 0, display: floatingPanels.some((fp) => fp.id === "blotter") ? "none" : undefined }}
        >
        <PanelShell className="panel term-blotter-panel gtix-panel-resizable-y">
          <div className="eyebrow">Blotter d'exécution <HelpHint text="Journal des exécutions récentes." examples={["Si slippage monte brutalement, suspecte broker ou routeur dégradé."]} />
            {layoutEditMode && <button type="button" className="panel-detach-btn" title="Floating" onClick={() => detachPanel("blotter", "lower")}>⤡</button>}
          </div>
          {filteredOutcomes.length === 0 ? <p className="subtle mini" style={{ marginTop: 8 }}>Aucune exécution.</p> : null}
          {filteredOutcomes.length > 0 ? (
            <div className="blotter-scroll">
              <table className="blotter-table" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>Time</th><th>Symbol</th><th>Strategy</th><th>Regime</th><th>PnL</th><th>Slip</th><th>Lat</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOutcomes.slice(0, 6).map((item, bi) => (
                    <tr key={`bl-${bi}`}>
                      <td>{String(item.created_at || "–").slice(11, 19)}</td>
                      <td>{instrumentLabel(item)}</td>
                      <td style={{ maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(item.strategy_id || "–").slice(0, 10)}</td>
                      <td>{String(item.regime || "–").slice(0, 8)}</td>
                      <td className={toNumber(item.net_result_usd, 0) >= 0 ? "good" : "warn"}>{toNumber(item.net_result_usd, 0).toFixed(2)}</td>
                      <td>{toNumber(item.slippage_real_bps, 0).toFixed(1)}bps</td>
                      <td>{toNumber(item.latency_ms, 0).toFixed(0)}ms</td>
                      <td>{String(item.status || "–").slice(0, 8)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </PanelShell>
        </div>

        <div
          className={`layout-draggable-card${layoutEditMode ? " is-edit" : ""}${layoutDropPreview?.zone === "lower" && layoutDropPreview.targetId === "brokers" ? " is-drop-target" : ""}`}
          draggable={layoutEditMode}
          onDragStart={() => { layoutDragRef.current = { zone: "lower", id: "brokers" }; setLayoutDropPreview({ zone: "lower", targetId: "brokers", mode: "panel" }); }}
          onDragEnd={() => { layoutDragRef.current = null; setLayoutDropPreview(null); }}
          onDragOver={(event) => { if (layoutEditMode) { event.preventDefault(); setLayoutDropPreview({ zone: "lower", targetId: "brokers", mode: "panel" }); } }}
          onDrop={() => handleLayoutDrop("lower", "brokers")}
          style={{ order: lowerOrderById.brokers ?? 1, display: floatingPanels.some((fp) => fp.id === "brokers") ? "none" : undefined }}
        >
        <PanelShell className="panel term-brokers-panel gtix-panel-resizable-y">
          <div className="eyebrow">Brokers · Agents · Capital <HelpTooltip termKey="brokers" mode={uiMode} />
            {layoutEditMode && <button type="button" className="panel-detach-btn" title="Floating" onClick={() => detachPanel("brokers", "lower")}>⤡</button>}
          </div>
          <div className="brokers-grid">
            <div className="brokers-section">
              <div className="chart-stat-label" style={{ marginBottom: 6 }}>Agents IA</div>
              {providerRows.slice(0, 4).map((item, agI) => (
                <div key={`ag-${agI}`} className="agent-row">
                  <span className="agent-name gtix-ellipsis">{String(item.route || "–").slice(0, 14)}</span>
                  <span className={Boolean(item.available) ? "good mini" : "warn mini"}>{Boolean(item.available) ? "●" : "○"}</span>
                </div>
              ))}
            </div>
            <div className="brokers-section">
              <div className="chart-stat-label" style={{ marginBottom: 6 }}>Capital</div>
              {balances.slice(0, 4).map((item) => (
                <div key={String(item.currency || "")} className="balance-row">
                  <span className="balance-ccy">{String(item.currency || "–")}</span>
                  <span className="balance-val gtix-ellipsis">{String(item.free || "–")}</span>
                </div>
              ))}
              {balances.length === 0 ? <span className="subtle mini">–</span> : null}
            </div>
            <div className="brokers-section">
              <div className="chart-stat-label" style={{ marginBottom: 6 }}>Positions</div>
              {positions.slice(0, 4).map((item) => (
                <div key={instrumentLabel(item)} className="pos-row">
                  <span className="pos-sym gtix-ellipsis">{instrumentLabel(item).slice(0, 10)}</span>
                  <span className="balance-val">{toNumber(item.net_notional_usd, 0).toFixed(0)}</span>
                </div>
              ))}
              {positions.length === 0 ? <span className="subtle mini">–</span> : null}
            </div>
          </div>
          <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 8, fontSize: 12 }}>
            <div className="row"><span className="chart-stat-label">Footprint dom.</span><span>{dominantFootprint ? `${dominantFootprint.delta.toFixed(0)}Δ` : "–"}</span></div>
            <div className="row"><span className="chart-stat-label">MT5 Bridge</span><span>{String(mt5Health?.status || "–")}</span></div>
          </div>
        </PanelShell>
        </div>
      </section>

      {/* ═══════════════ MONITORING ════════════════════════════ */}
      <section className="panel term-monitoring">
        <div
          className={`monitoring-cols${layoutDropPreview?.zone === "monitoring" ? " is-drop-zone-active" : ""}`}
          onDragOver={(event) => {
            if (layoutEditMode) {
              event.preventDefault();
              setLayoutDropPreview({ zone: "monitoring", mode: "zone" });
            }
          }}
          onDragLeave={() => {
            if (layoutDropPreview?.zone === "monitoring" && layoutDropPreview.mode === "zone") {
              setLayoutDropPreview(null);
            }
          }}
          onDrop={() => handleLayoutDropToZone("monitoring")}
        >
          <div
            className={`layout-draggable-card${layoutEditMode ? " is-edit" : ""}${layoutDropPreview?.zone === "monitoring" && layoutDropPreview.targetId === "alerts" ? " is-drop-target" : ""}`}
            draggable={layoutEditMode}
            onDragStart={() => { layoutDragRef.current = { zone: "monitoring", id: "alerts" }; setLayoutDropPreview({ zone: "monitoring", targetId: "alerts", mode: "panel" }); }}
            onDragEnd={() => { layoutDragRef.current = null; setLayoutDropPreview(null); }}
            onDragOver={(event) => { if (layoutEditMode) { event.preventDefault(); setLayoutDropPreview({ zone: "monitoring", targetId: "alerts", mode: "panel" }); } }}
            onDrop={() => handleLayoutDrop("monitoring", "alerts")}
            style={{ order: monitoringOrderById.alerts ?? 0, display: floatingPanels.some((fp) => fp.id === "alerts") ? "none" : undefined }}
          >
          <div className="monitoring-col">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Alertes actives
              {layoutEditMode && <button type="button" className="panel-detach-btn" title="Floating" onClick={() => detachPanel("alerts", "monitoring")}>⤡</button>}
            </div>
            {filteredAlerts.length === 0 ? <p className="subtle mini">Aucune alerte.</p> : null}
            {filteredAlerts.slice(0, 5).map((item, ali) => (
              <div key={`al-${ali}`} className="mon-row">
                <span className={String(item.level) === "critical" ? "warn" : ""}>{String(item.type || "–")}</span>
                <span className="subtle mini">{String(item.message || "").slice(0, 38)}</span>
              </div>
            ))}
          </div>
          </div>
          <div
            className={`layout-draggable-card${layoutEditMode ? " is-edit" : ""}${layoutDropPreview?.zone === "monitoring" && layoutDropPreview.targetId === "incidents" ? " is-drop-target" : ""}`}
            draggable={layoutEditMode}
            onDragStart={() => { layoutDragRef.current = { zone: "monitoring", id: "incidents" }; setLayoutDropPreview({ zone: "monitoring", targetId: "incidents", mode: "panel" }); }}
            onDragEnd={() => { layoutDragRef.current = null; setLayoutDropPreview(null); }}
            onDragOver={(event) => { if (layoutEditMode) { event.preventDefault(); setLayoutDropPreview({ zone: "monitoring", targetId: "incidents", mode: "panel" }); } }}
            onDrop={() => handleLayoutDrop("monitoring", "incidents")}
            style={{ order: monitoringOrderById.incidents ?? 1, display: floatingPanels.some((fp) => fp.id === "incidents") ? "none" : undefined }}
          >
          <div className="monitoring-col">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Incidents
              {layoutEditMode && <button type="button" className="panel-detach-btn" title="Floating" onClick={() => detachPanel("incidents", "monitoring")}>⤡</button>}
            </div>
            {incidents.length === 0 ? <p className="subtle mini">Aucun incident.</p> : null}
            {incidentRows.slice(0, 5).map(({ item, status, severityLabel, slaLabel }) => (
              <div key={String(item.ticket_key || "")} className="mon-row incident-row">
                <span>{String(item.ticket_key || "–")}</span>
                <span className="subtle mini">{String(item.title || "–").slice(0, 22)}</span>
                <span className="incident-meta-strip">
                  <span className={`incident-chip incident-chip-status-${status.toLowerCase()}`}>{status}</span>
                  <span className={`incident-chip incident-chip-severity-${severityLabel}`}>{severityLabel}</span>
                  <span className={`incident-chip ${slaLabel === "breach" ? "incident-chip-sla-breach" : "incident-chip-sla-ok"}`}>sla {slaLabel}</span>
                </span>
              </div>
            ))}
          </div>
          </div>
          <div
            className={`layout-draggable-card${layoutEditMode ? " is-edit" : ""}${layoutDropPreview?.zone === "monitoring" && layoutDropPreview.targetId === "governance" ? " is-drop-target" : ""}`}
            draggable={layoutEditMode}
            onDragStart={() => { layoutDragRef.current = { zone: "monitoring", id: "governance" }; setLayoutDropPreview({ zone: "monitoring", targetId: "governance", mode: "panel" }); }}
            onDragEnd={() => { layoutDragRef.current = null; setLayoutDropPreview(null); }}
            onDragOver={(event) => { if (layoutEditMode) { event.preventDefault(); setLayoutDropPreview({ zone: "monitoring", targetId: "governance", mode: "panel" }); } }}
            onDrop={() => handleLayoutDrop("monitoring", "governance")}
            style={{ order: monitoringOrderById.governance ?? 2, display: floatingPanels.some((fp) => fp.id === "governance") ? "none" : undefined }}
          >
          <div className="monitoring-col">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Governance
              {layoutEditMode && <button type="button" className="panel-detach-btn" title="Floating" onClick={() => detachPanel("governance", "monitoring")}>⤡</button>}
            </div>
            <div className="governance-toolbar">
              <select value={governanceSort} onChange={(event) => setGovernanceSort(event.target.value as GovernanceSort)}>
                <option value="severity">tri: severity</option>
                <option value="label">tri: label</option>
                <option value="value">tri: value</option>
              </select>
              <select value={incidentSort} onChange={(event) => setIncidentSort(event.target.value as IncidentSort)}>
                <option value="severity">incidents: severity</option>
                <option value="status">incidents: status</option>
                <option value="sla">incidents: SLA</option>
              </select>
              <label className="governance-check"><input type="checkbox" checked={governanceOnlyAlerts} onChange={(event) => setGovernanceOnlyAlerts(event.target.checked)} /> alerts only</label>
            </div>
            <input value={governanceFilterText} onChange={(event) => setGovernanceFilterText(event.target.value)} className="governance-search" placeholder="filtrer incidents / governance" />
            {governanceFiltered.slice(0, 8).map((row) => (
              <div key={row.label} className="mon-row">
                <span>{row.label}</span>
                <span className={row.severity >= 3 ? "warn" : row.severity >= 2 ? "subtle" : "good"}>{row.value}</span>
              </div>
            ))}
          </div>
          </div>
          <div
            className={`layout-draggable-card${layoutEditMode ? " is-edit" : ""}${layoutDropPreview?.zone === "monitoring" && layoutDropPreview.targetId === "readiness" ? " is-drop-target" : ""}`}
            draggable={layoutEditMode}
            onDragStart={() => { layoutDragRef.current = { zone: "monitoring", id: "readiness" }; setLayoutDropPreview({ zone: "monitoring", targetId: "readiness", mode: "panel" }); }}
            onDragEnd={() => { layoutDragRef.current = null; setLayoutDropPreview(null); }}
            onDragOver={(event) => { if (layoutEditMode) { event.preventDefault(); setLayoutDropPreview({ zone: "monitoring", targetId: "readiness", mode: "panel" }); } }}
            onDrop={() => handleLayoutDrop("monitoring", "readiness")}
            style={{ order: monitoringOrderById.readiness ?? 3, display: floatingPanels.some((fp) => fp.id === "readiness") ? "none" : undefined }}
          >
          <div className="monitoring-col">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Readiness
              {layoutEditMode && <button type="button" className="panel-detach-btn" title="Floating" onClick={() => detachPanel("readiness", "monitoring")}>⤡</button>}
            </div>
            <div className="mon-row"><span>Drift</span><span>{driftItems.filter((d) => Boolean(d.drift_detected)).length}</span></div>
            <div className="mon-row"><span>Suspendues</span><span className={suspended.length > 0 ? "warn" : "good"}>{suspended.length}</span></div>
            <div className="mon-row"><span>Similarity</span><span>{String(memorySummary.avg_final_similarity || "–")}</span></div>
            <div className="mon-row"><span>Memory impact</span><span>{String(memorySummary.avg_memory_impact || "–")}</span></div>
            <div className="mon-row"><span>SLA breach</span><span className={incidents.some((i) => Boolean(i.sla_breached)) ? "warn" : "good"}>{incidents.filter((i) => Boolean(i.sla_breached)).length}</span></div>
          </div>
          </div>
          <div
            className={`layout-draggable-card${layoutEditMode ? " is-edit" : ""}${layoutDropPreview?.zone === "monitoring" && layoutDropPreview.targetId === "risktimeline" ? " is-drop-target" : ""}`}
            draggable={layoutEditMode}
            onDragStart={() => { layoutDragRef.current = { zone: "monitoring", id: "risktimeline" }; setLayoutDropPreview({ zone: "monitoring", targetId: "risktimeline", mode: "panel" }); }}
            onDragEnd={() => { layoutDragRef.current = null; setLayoutDropPreview(null); }}
            onDragOver={(event) => { if (layoutEditMode) { event.preventDefault(); setLayoutDropPreview({ zone: "monitoring", targetId: "risktimeline", mode: "panel" }); } }}
            onDrop={() => handleLayoutDrop("monitoring", "risktimeline")}
            style={{ order: monitoringOrderById.risktimeline ?? 4, display: floatingPanels.some((fp) => fp.id === "risktimeline") ? "none" : undefined }}
          >
          <div className="monitoring-col">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Risk Compliance Timeline
              {layoutEditMode && <button type="button" className="panel-detach-btn" title="Floating" onClick={() => detachPanel("risktimeline", "monitoring")}>⤡</button>}
            </div>
            {renderRiskTimelineBody(6, "rt-mon")}
          </div>
          </div>
        </div>
      </section>

      {/* ═══════════════ CAPITAL ALLOCATION ENGINE ═══════════════════════════ */}
      {(strategyPerformance.length > 0 || showDecisionOverlay) && (
        <section className="panel term-alloc-panel">
          <div className="eyebrow">
            Capital Allocation Engine{" "}
            <HelpHint
              text="Score calibré (Bayes) × régime fit × santé stratégie EMA → allocation recommandée par décision."
              examples={[
                "Full ≥ 1.5% : score fort + régime favorable + stratégie saine.",
                "Minimal < 0.7% : high risk, consensus faible, ou drawdown actif.",
              ]}
            />
          </div>
          <ModuleGuide
            mode={uiMode}
            title="Allocation guide"
            what="Ce moteur convertit la qualité du signal en taille de risque recommandée."
            why="Il empêche de sur-allouer un signal fragile et protège le portefeuille quand le contexte global se dégrade."
            example="Un signal peut rester intéressant mais être forcé en taille minimale si le meta-risk abaisse le capital disponible."
          />
          {showDecisionOverlay && requiresHumanApproval && (
            <div className="human-approval-gate hag-panel">
              🔒 APPROBATION HUMAINE REQUISE
              <span className="hag-reason">
                {isCurrentRegimeBlocked
                  ? `régime ${overlayDecisionRegime} bloqué (degradation Brier)`
                  : metaRiskOfficer.tier === "kill-switch"
                  ? "meta-risk: kill-switch"
                  : metaRiskOfficer.tier === "force-suggest"
                  ? "meta-risk: force suggest"
                  : extendedBlame === "latency_spike"
                  ? "latency spike d\u00e9tect\u00e9"
                  : isHighRisk
                  ? "territoire non cartographi\u00e9"
                  : "consensus faible"}
              </span>
            </div>
          )}
          <div className="alloc-grid">
            {showDecisionOverlay && (
              <>
                <div className="alloc-block">
                  <div className="alloc-label">Allocation recommand\u00e9e</div>
                  <div className="alloc-gauge-wrap">
                    <div
                      className={`alloc-gauge alloc-tier-${allocTier}`}
                      style={{ width: `${Math.min(100, (recommendedAllocPct / 2) * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <div className="alloc-pct-row">
                    <span className={`alloc-pct alloc-tier-${allocTier}`}>
                      {recommendedAllocPct.toFixed(2)}%
                    </span>
                    <span className={`alloc-tier-badge alloc-tier-${allocTier}`}>
                      {allocTier}
                    </span>
                  </div>
                </div>
                <div className="alloc-block">
                  <div className="alloc-label">Facteurs d&apos;ajustement</div>
                  <div className="alloc-factor-row">
                    <span>Score eff.</span>
                    <span>{effectiveScoreFull.toFixed(2)}</span>
                  </div>
                  <div className="alloc-factor-row">
                    <span>Régime fit</span>
                    <span>{(allocRegimeFit * 100).toFixed(0)}%</span>
                  </div>
                  <div className="alloc-factor-row">
                    <span>Régime calib</span>
                    <span className={regimeCalibMultiplier >= 0.9 ? "good" : regimeCalibMultiplier >= 0.7 ? "" : "warn"}>
                      {(regimeCalibMultiplier * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="alloc-factor-row">
                    <span>EMA WR</span>
                    <span className={allocEmaWR >= 0.5 ? "good" : "warn"}>
                      {(allocEmaWR * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="alloc-factor-row">
                    <span>Venue score</span>
                    <span className={venueQualityLabel === "good" ? "good" : venueQualityLabel === "fair" ? "subtle" : "warn"}>
                      {(venueQualityScore * 100).toFixed(0)}% ({activeVenueMetrics?.venue || "n/a"})
                    </span>
                  </div>
                  <div className="alloc-factor-row">
                    <span>Meta capital</span>
                    <span className={allocMetaRiskMultiplier >= 0.85 ? "good" : allocMetaRiskMultiplier >= 0.6 ? "subtle" : "warn"}>
                      {(allocMetaRiskMultiplier * 100).toFixed(0)}% ({metaRiskOfficer.tier})
                    </span>
                  </div>
                  {allocDrawdownPenalty > 0 && (
                    <div className="alloc-factor-row">
                      <span>Drawdown Δ</span>
                      <span className="warn">−{(allocDrawdownPenalty * 100).toFixed(0)}%</span>
                    </div>
                  )}
                  {isHighRisk && (
                    <div className="alloc-factor-row">
                      <span>High Risk</span>
                      <span className="warn">−50%</span>
                    </div>
                  )}
                  {corrPenalty > 0 && (
                    <div className="alloc-factor-row">
                      <span>Corr Penalty</span>
                      <span className="warn">−{(corrPenalty * 100).toFixed(0)}%</span>
                    </div>
                  )}
                  {sampleConfidenceInfo && allocSampleModifier < 1.0 && (
                    <div className="alloc-factor-row">
                      <span>Sample Cap</span>
                      <span className={sampleConfidenceInfo.tier === 'LOW' ? 'warn' : ''}>{(allocSampleModifier * 100).toFixed(0)}%</span>
                    </div>
                  )}
                  {sampleConfidenceInfo && (
                    <div className="alloc-factor-row" style={{ fontSize: '8px', color: 'rgba(255,255,255,0.5)' }}>
                      <span>{sampleConfidenceInfo.displayLabel}</span>
                      <span>{sampleConfidenceInfo.wrPct}% ±{sampleConfidenceInfo.ciWidth}%</span>
                    </div>
                  )}
                  {isCurrentRegimeBlocked && (
                    <div className="alloc-factor-row">
                      <span>Regime block</span>
                      <span className="warn">ACTIVE (alloc=0)</span>
                    </div>
                  )}
                </div>
              </>
            )}
            {allocSoftmax.length > 0 && (
              <div className="alloc-block">
                <div className="alloc-label">Distribution stratégies (softmax)</div>
                {allocSoftmax.map((s) => (
                  <div key={s.id} className="alloc-strat-row">
                    <span className="asr-id">{s.id.slice(0, 12)}</span>
                    <div className="alloc-gauge-wrap">
                      <div
                        className="alloc-gauge alloc-tier-reduced"
                        style={{ width: `${Math.min(100, (s.pct / 1.5) * 100).toFixed(0)}%` }}
                      />
                    </div>
                    <span className="asr-pct">{s.pct.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            )}
            {showDecisionOverlay && execQualityScore !== null && (
              <div className="alloc-block">
                <div className="alloc-label">Qualité exécution</div>
                <div className="alloc-gauge-wrap">
                  <div
                    className={`alloc-gauge exec-qual-${execQualityLabel}`}
                    style={{ width: `${(execQualityScore * 100).toFixed(0)}%` }}
                  />
                </div>
                <span className={`exec-qual-badge exec-qual-${execQualityLabel}`}>
                  {execQualityLabel} · {(execQualityScore * 100).toFixed(0)}%
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── META-RISK OFFICER ────────────────────────────────────────────────── */}
      {(showDecisionOverlay || filteredOutcomes.length > 0) && (
        <section className="kpi-calib-panel">
          <div className="kpi-calib-title">🛡️ Meta-Risk Officer</div>
          <ModuleGuide
            mode={uiMode}
            title="Meta-risk guide"
            what="Le meta-risk mesure la santé globale du moteur et réduit l'exposition quand les signaux se dégradent."
            why="Cette couche protège contre une dérive systémique qui ne serait pas visible en regardant une seule stratégie."
            example="Si plusieurs drops apparaissent, que la santé baisse et que le Brier monte, le capital global peut être contracté ou un régime bloqué."
          />
          <div className="calib-kpi-block">
            <div className="calib-kpi-block-title">System Health</div>
            <div className="brier-score-container">
              <div
                className={`brier-score-display${
                  metaRiskOfficer.healthScore >= 0.85 ? ""
                  : metaRiskOfficer.healthScore >= 0.6 ? " overfit"
                  : " poor"
                }`}
              >
                {(metaRiskOfficer.healthScore * 100).toFixed(0)}
              </div>
              <div className="brier-score-info">
                <div className="brier-score-info-label">Tier: {metaRiskOfficer.tier}</div>
                <div className="brier-score-info-value">
                  Momentum: {metaRiskOfficer.healthMomentum >= 0 ? "+" : ""}{(metaRiskOfficer.healthMomentum * 100).toFixed(1)}
                </div>
                <div className="brier-score-info-value">
                  Capital cap: {(metaRiskOfficer.globalCapitalMultiplier * 100).toFixed(0)}%
                </div>
              </div>
            </div>
            {metaRiskOfficer.issues.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 10, color: "rgba(255,255,255,0.7)" }}>
                Issues: {metaRiskOfficer.issues.join(" · ")}
              </div>
            )}
            {metaRiskHealthHistory.length >= 3 && (() => {
              const W = 80, H = 18;
              const N = metaRiskHealthHistory.length;
              const min = Math.min(...metaRiskHealthHistory);
              const max = Math.max(...metaRiskHealthHistory);
              const range = max - min || 0.01;
              const pts = metaRiskHealthHistory
                .map((v, i) => `${(i / (N - 1)) * W},${H - ((v - min) / range) * H}`)
                .join(" ");
              const trend = metaRiskHealthHistory[N - 1] >= metaRiskHealthHistory[0] ? "#4ade80" : "#f87171";
              return (
                <div className="meta-risk-sparkline-wrap" title={`Health history (${N} pts)`}>
                  <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="meta-risk-sparkline">
                    <polyline points={pts} fill="none" stroke={trend} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              );
            })()}
          </div>

          <div className="calib-kpi-block">
            <div className="calib-kpi-block-title">Runbooks</div>
            {metaRiskOfficer.runbooks.length === 0 ? (
              <div className="subtle mini">Aucun runbook actif.</div>
            ) : (
              metaRiskOfficer.runbooks.map((rb, idx) => (
                <div key={`rb-${idx}`} className="alloc-factor-row" style={{ gridTemplateColumns: "110px 1fr 56px", gap: 8 }}>
                  <span className={rb.severity === "critical" || rb.severity === "high" ? "warn" : rb.severity === "medium" ? "subtle" : "good"}>
                    {rb.severity}
                  </span>
                  <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 10 }}>
                    {rb.type}: {rb.recommendedAction}
                  </span>
                  <span className={rb.auto ? "warn" : "subtle"}>{rb.auto ? "AUTO" : "MANUAL"}</span>
                </div>
              ))
            )}
          </div>

          <div className="calib-kpi-block">
            <div className="calib-kpi-block-title">Regime Auto-Blocking</div>
            <div className="regime-buckets-container">
              {Object.entries(regimeRiskMonitor.byRegime).map(([regime, info]) => (
                <div key={`regime-risk-${regime}`} className="regime-bucket-card">
                  <div className="regime-bucket-label">{regime}</div>
                  <div className="regime-bucket-metric">
                    <span>Brier prev/recent</span>
                    <span className="regime-bucket-metric-value">
                      {info.previousBrier !== null ? info.previousBrier.toFixed(2) : "–"} / {info.recentBrier !== null ? info.recentBrier.toFixed(2) : "–"}
                    </span>
                  </div>
                  <div className="regime-bucket-metric">
                    <span>Delta</span>
                    <span className={info.delta > 0.1 ? "warn" : "good"}>{info.delta >= 0 ? "+" : ""}{info.delta.toFixed(2)}</span>
                  </div>
                  <div className="regime-bucket-metric">
                    <span>Status</span>
                    <span className={info.blocked ? "warn" : "good"}>{info.blocked ? "BLOCKED" : "active"}</span>
                  </div>
                  {info.reason && <div style={{ fontSize: 9, color: "rgba(255,180,180,0.8)" }}>{info.reason}</div>}
                </div>
              ))}
            </div>
          </div>

          <div className="calib-kpi-block">
            <div className="calib-kpi-block-title">Meta-Risk Audit Trail</div>
            {metaRiskAuditTrail.length > 0 && (
              <div className="meta-risk-drop-pressure">
                <span className="meta-risk-drop-pressure-kpi">
                  <span className="meta-risk-drop-pressure-label">Drops (24h)</span>
                  <span className="meta-risk-drop-pressure-value">{dropPressure24h.count}</span>
                </span>
                <span className="meta-risk-drop-pressure-kpi">
                  <span className="meta-risk-drop-pressure-label">Total contraction</span>
                  <span className={`meta-risk-drop-pressure-value${dropPressure24h.totalContraction > 0 ? " warn" : ""}`}>
                    {dropPressure24h.totalContraction > 0 ? `-${dropPressure24h.totalContraction.toFixed(0)}%` : "–"}
                  </span>
                </span>
                <span className="meta-risk-drop-pressure-kpi">
                  <span className="meta-risk-drop-pressure-label">Largest drop</span>
                  <span className={`meta-risk-drop-pressure-value${dropPressure24h.largestDrop > 0 ? " warn" : ""}`}>
                    {dropPressure24h.largestDrop > 0 ? `-${dropPressure24h.largestDrop.toFixed(0)}%` : "–"}
                  </span>
                </span>
              </div>
            )}
            <div className="meta-risk-audit-toolbar">
              <button
                type="button"
                className={`meta-risk-audit-filter-btn${!metaRiskAuditShowOnlyDrops ? " active" : ""}`}
                onClick={() => setMetaRiskAuditShowOnlyDrops(false)}
              >
                All
              </button>
              <button
                type="button"
                className={`meta-risk-audit-filter-btn danger${metaRiskAuditShowOnlyDrops ? " active" : ""}`}
                onClick={() => setMetaRiskAuditShowOnlyDrops(true)}
              >
                show only size drops
              </button>
              <button
                type="button"
                className={`meta-risk-audit-filter-btn${metaRiskAuditDropSort === "recent" ? " active" : ""}`}
                onClick={() => setMetaRiskAuditDropSort("recent")}
              >
                most recent drop first
              </button>
              <button
                type="button"
                className={`meta-risk-audit-filter-btn${metaRiskAuditDropSort === "largest" ? " active" : ""}`}
                onClick={() => setMetaRiskAuditDropSort("largest")}
              >
                largest drop first
              </button>
              <span className="meta-risk-audit-count">
                {sortedMetaRiskAuditTrail.length} event{sortedMetaRiskAuditTrail.length === 1 ? "" : "s"}
              </span>
            </div>
            {sortedMetaRiskAuditTrail.length === 0 ? (
              <div className="subtle mini">Aucune transition enregistrée pour l’instant.</div>
            ) : (
              <div className="meta-risk-audit-table">
                <div className="meta-risk-audit-head">
                  <span>Time</span>
                  <span>Tier</span>
                  <span>Capital</span>
                  <span>Reason</span>
                </div>
                {sortedMetaRiskAuditTrail.slice(0, 12).map((evt) => {
                  const dropPct =
                    evt.capitalFromPct > 0
                      ? Math.max(0, ((evt.capitalFromPct - evt.capitalToPct) / evt.capitalFromPct) * 100)
                      : 0;
                  const dropSeverity =
                    dropPct > 40 ? "critical"
                    : dropPct >= 15 ? "major"
                    : "minor";
                  const capTitle = `from ${(evt.capitalFromPct / 100).toFixed(2)}x to ${(evt.capitalToPct / 100).toFixed(2)}x\nreason: ${evt.reason || "state change"}`;
                  const r = (evt.reason || "").toLowerCase();
                  const dominantCause =
                    r.includes("cluster") ? "CLUSTER"
                    : r.includes("brier") ? "BRIER"
                    : r.includes("regime") ? "REGIME"
                    : r.includes("venue") ? "VENUE"
                    : r.includes("consensus") ? "CONSENSUS"
                    : "OTHER";
                  return (
                    <div key={evt.id} className={`meta-risk-audit-row${evt.capitalToPct < evt.capitalFromPct ? " size-drop" : ""}`}>
                      <span className="meta-risk-audit-time">{formatClock(evt.timestampIso)}</span>
                      <span className="meta-risk-audit-tier">
                        {evt.tierFrom} → {evt.tierTo}
                      </span>
                      <span className="meta-risk-audit-cap" title={capTitle}>
                        <span className="meta-risk-audit-cap-target">{evt.capitalToPct.toFixed(0)}%</span>
                        {dropPct > 0 && (
                          <span className={`meta-risk-drop-badge ${dropSeverity}`}>
                            DROP -{dropPct.toFixed(0)}%
                          </span>
                        )}
                        <span className={`meta-risk-cause-tag cause-${dominantCause.toLowerCase()}`}>{dominantCause}</span>
                      </span>
                      <span className="meta-risk-audit-reason" title={evt.reason}>
                        {evt.reason || "state change"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── PORTFOLIO CORRELATION DASHBOARD ───────────────────────────────────── */}
      {strategyPerformance.length > 1 && (
        <section className="kpi-calib-panel">
          <div className="kpi-calib-title">🔗 Portfolio Correlation & Exposure</div>
          
          {/* Correlation Matrix Heatmap */}
          {Object.keys(strategyCorrelationMatrix).length > 0 && (
            <div className="calib-kpi-block">
              <div className="calib-kpi-block-title">Strategy Correlation Matrix (shrinkage-adjusted)</div>
              <div className="corr-heatmap-container">
                <div className="corr-heatmap-matrix">
                  {/* Header row */}
                  <div className="corr-heatmap-row">
                    <div className="corr-heatmap-label">–</div>
                    {Object.keys(strategyCorrelationMatrix).slice(0, 6).map((stratId) => (
                      <div key={`header-${stratId}`} className="corr-heatmap-label">
                        {stratId.slice(0, 6)}
                      </div>
                    ))}
                  </div>
                  {/* Data rows */}
                  {Object.entries(strategyCorrelationMatrix).slice(0, 6).map(([s1Id, row]) => (
                    <div key={`row-${s1Id}`} className="corr-heatmap-row">
                      <div className="corr-heatmap-label">{s1Id.slice(0, 6)}</div>
                      {Object.entries(row).slice(0, 6).map(([s2Id, data]) => (
                        <div
                          key={`cell-${s1Id}-${s2Id}`}
                          className={`corr-heatmap-cell corr-cell-${
                            data.flag === 'LOW_SAMPLE' ? 'low-sample'
                            : data.flag === 'self' ? 'self'
                            : data.flag === 'REDUNDANT' ? 'redundant'
                            : data.flag === 'MODERATE' ? 'moderate'
                            : 'independent'
                          }`}
                          title={`${s1Id} ↔ ${s2Id}: ${Number.isFinite(data.corr) ? data.corr.toFixed(2) : 'N/A'} (n=${data.n})`}
                        >
                          {Number.isFinite(data.corr) ? data.corr.toFixed(2) : '–'}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                  🟢 Independent (&lt;0.5) | 🟡 Moderate (0.5-0.7) | 🔴 Redundant (&gt;0.7)
                </div>
              </div>
            </div>
          )}

          {/* Cluster Groups */}
          {strategyClusterGroups.length > 0 && (
            <div className="calib-kpi-block">
              <div className="calib-kpi-block-title">Detected Clusters (corr &gt; 0.7)</div>
              <div className="cluster-groups-container">
                {strategyClusterGroups.map((group, idx) => (
                  <div key={`cluster-${idx}`} className="cluster-group">
                    <span className="cluster-group-icon">🔴</span>
                    <span className="cluster-group-members">
                      {group.map(s => s.slice(0, 8)).join(' + ')}
                    </span>
                    <span style={{ marginLeft: 'auto', color: '#ff7d7d' }}>
                      ⚠️ Redundant cluster detected
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Market Exposure by Market Type */}
          {Object.keys(marketExposureByCluster).length > 0 && (
            <div className="calib-kpi-block">
              <div className="calib-kpi-block-title">Market Exposure (per market cluster)</div>
              <div className="market-exposure-container">
                {Object.entries(marketExposureByCluster).map(([market, data]) => (
                  <div key={`market-${market}`} className="market-exposure-card">
                    <div className="market-exposure-name">{market}</div>
                    <div className="market-exposure-bar">
                      <div
                        className={`market-exposure-fill${data.flag ? ' over-cap' : ''}`}
                        style={{ width: `${Math.min(100, (data.exposure / data.cap) * 100)}%` }}
                      />
                    </div>
                    <div className="market-exposure-metric">
                      <span>Exposure:</span>
                      <span className={data.flag ? 'market-exposure-flag' : ''}>
                        {(data.exposure * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="market-exposure-metric">
                      <span>Cap:</span>
                      <span>{(data.cap * 100).toFixed(0)}%</span>
                    </div>
                    <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.4)' }}>
                      {data.strategyCount} strategies
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Portfolio Risk Engine V3 */}
          {(portfolioRiskV3.sampleSize > 0 || portfolioRiskV3.grossExposureUsd > 0) && (
            <div className="calib-kpi-block">
              <div className="calib-kpi-block-title">Portfolio Risk Engine V3</div>
              <div className="portfolio-risk-v3-grid">
                <div className="portfolio-risk-v3-card">
                  <div className="portfolio-risk-v3-label">VaR 95%</div>
                  <div className={`portfolio-risk-v3-value${portfolioRiskV3.var95Pct < 0 ? " risk" : ""}`}>
                    {portfolioRiskV3.var95Pct >= 0 ? "+" : ""}{portfolioRiskV3.var95Pct.toFixed(2)}%
                  </div>
                  <div className="portfolio-risk-v3-sub">
                    {portfolioRiskV3.var95Usd >= 0 ? "+" : ""}${portfolioRiskV3.var95Usd.toFixed(0)}
                  </div>
                </div>
                <div className="portfolio-risk-v3-card">
                  <div className="portfolio-risk-v3-label">Expected Shortfall 95%</div>
                  <div className={`portfolio-risk-v3-value${portfolioRiskV3.es95Pct < 0 ? " risk" : ""}`}>
                    {portfolioRiskV3.es95Pct >= 0 ? "+" : ""}{portfolioRiskV3.es95Pct.toFixed(2)}%
                  </div>
                  <div className="portfolio-risk-v3-sub">
                    {portfolioRiskV3.es95Usd >= 0 ? "+" : ""}${portfolioRiskV3.es95Usd.toFixed(0)}
                  </div>
                </div>
                <div className="portfolio-risk-v3-card">
                  <div className="portfolio-risk-v3-label">Live Gross Exposure</div>
                  <div className="portfolio-risk-v3-value">
                    ${portfolioRiskV3.grossExposureUsd.toFixed(0)}
                  </div>
                  <div className="portfolio-risk-v3-sub">
                    Net {portfolioRiskV3.netExposureUsd >= 0 ? "+" : ""}${portfolioRiskV3.netExposureUsd.toFixed(0)}
                  </div>
                </div>
                <div className="portfolio-risk-v3-card">
                  <div className="portfolio-risk-v3-label">Intra-Trade Dynamic Corr</div>
                  <div className={`portfolio-risk-v3-value${portfolioRiskV3.dynamicCorrMax >= 0.7 ? " risk" : portfolioRiskV3.dynamicCorrMax >= 0.5 ? " warn" : ""}`}>
                    {(portfolioRiskV3.dynamicCorrMax * 100).toFixed(0)}%
                  </div>
                  <div className="portfolio-risk-v3-sub">
                    avg {(portfolioRiskV3.dynamicCorrMean * 100).toFixed(0)}% · peers {portfolioRiskV3.dynamicCorrPeers}
                  </div>
                </div>
              </div>
              <div className="portfolio-risk-v3-strip">
                <span>
                  Top live exposure: {portfolioRiskV3.topMarket ? `${portfolioRiskV3.topMarket.market} ${(portfolioRiskV3.topMarket.share * 100).toFixed(0)}%` : "–"}
                </span>
                <span>
                  Sample: {portfolioRiskV3.sampleSize} outcomes
                </span>
                <div className="portfolio-risk-export-group">
                  <button
                    type="button"
                    className="portfolio-risk-export-btn"
                    onClick={() => {
                      downloadJsonFile(
                        `investor-risk-snapshot-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`,
                        investorSnapshot,
                      );
                    }}
                  >
                    Export JSON
                  </button>
                  <button
                    type="button"
                    className="portfolio-risk-export-btn"
                    onClick={() => {
                      const rows: Array<Array<string | number>> = [
                        ["generated_at", investorSnapshot.generatedAt],
                        ["var95_pct", portfolioRiskV3.var95Pct.toFixed(4)],
                        ["es95_pct", portfolioRiskV3.es95Pct.toFixed(4)],
                        ["var95_usd", portfolioRiskV3.var95Usd.toFixed(2)],
                        ["es95_usd", portfolioRiskV3.es95Usd.toFixed(2)],
                        ["gross_exposure_usd", portfolioRiskV3.grossExposureUsd.toFixed(2)],
                        ["net_exposure_usd", portfolioRiskV3.netExposureUsd.toFixed(2)],
                        ["top_market", portfolioRiskV3.topMarket?.market || "-"],
                      ];
                      for (const row of portfolioRiskV3.riskByMarket) {
                        rows.push([
                          `market_${row.market}`,
                          `sample=${row.sample};var95_pct=${row.var95Pct.toFixed(4)};es95_pct=${row.es95Pct.toFixed(4)};var95_usd=${row.var95Usd.toFixed(2)};es95_usd=${row.es95Usd.toFixed(2)}`,
                        ]);
                      }
                      downloadCsvFile(
                        `investor-risk-snapshot-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`,
                        [["metric", "value"], ...rows],
                      );
                    }}
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className="portfolio-risk-export-btn"
                    onClick={() => {
                      openPrintPdfReport("Investor Risk Snapshot", [
                        `Generated at: ${investorSnapshot.generatedAt}`,
                        `VaR95: ${portfolioRiskV3.var95Pct.toFixed(2)}% (${portfolioRiskV3.var95Usd.toFixed(0)} USD)`,
                        `ES95: ${portfolioRiskV3.es95Pct.toFixed(2)}% (${portfolioRiskV3.es95Usd.toFixed(0)} USD)`,
                        `Gross exposure: ${portfolioRiskV3.grossExposureUsd.toFixed(0)} USD`,
                        `Net exposure: ${portfolioRiskV3.netExposureUsd.toFixed(0)} USD`,
                        `Top market: ${portfolioRiskV3.topMarket ? `${portfolioRiskV3.topMarket.market} ${(portfolioRiskV3.topMarket.share * 100).toFixed(0)}%` : "-"}`,
                        `Dynamic corr max: ${(portfolioRiskV3.dynamicCorrMax * 100).toFixed(0)}%`,
                      ]);
                    }}
                  >
                    Export PDF
                  </button>
                </div>
              </div>
              {portfolioRiskV3.riskByMarket.length > 0 && (
                <div className="portfolio-risk-v3-market">
                  <div className="portfolio-risk-v3-market-title">VaR / ES by market</div>
                  <div className="portfolio-risk-v3-market-head">
                    <span>Market</span>
                    <span>Sample</span>
                    <span>VaR95%</span>
                    <span>ES95%</span>
                    <span>VaR95$</span>
                    <span>ES95$</span>
                  </div>
                  {portfolioRiskV3.riskByMarket.map((row) => (
                    <div key={`risk-market-${row.market}`} className="portfolio-risk-v3-market-row">
                      <span>{row.market}</span>
                      <span>{row.sample}</span>
                      <span className={row.var95Pct < 0 ? "warn" : "good"}>{row.var95Pct.toFixed(2)}%</span>
                      <span className={row.es95Pct < 0 ? "warn" : "good"}>{row.es95Pct.toFixed(2)}%</span>
                      <span>{row.var95Usd.toFixed(0)}</span>
                      <span>{row.es95Usd.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Learning Loop (shadow mode + secure write-back) */}
          {learningLoopShadow.length > 0 && (
            <div className="calib-kpi-block">
              <div className="calib-kpi-block-title">Learning Loop (Shadow Auto-Tuning)</div>
              <div className="learning-loop-shadow-note">
                {AUTO_TUNING_WRITEBACK_ENABLED
                  ? "Secure write-back available (feature-flag gated, backend-audited, server-side signing)."
                  : "Suggestions only. Enable NEXT_PUBLIC_AUTO_TUNING_WRITEBACK=1 to expose write-back controls."}
              </div>
              {AUTO_TUNING_WRITEBACK_ENABLED && (
                <div className="learning-loop-shadow-controls">
                  <input
                    type="password"
                    className="learning-loop-shadow-input"
                    placeholder="admin key (optional)"
                    value={autoTuningAdminKey}
                    onChange={(e) => setAutoTuningAdminKey(e.target.value)}
                  />
                  <label className="learning-loop-shadow-label">
                    min conf
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      max={1}
                      className="learning-loop-shadow-input small"
                      value={autoTuningMinConfidence}
                      onChange={(e) => setAutoTuningMinConfidence(Math.max(0, Math.min(1, Number(e.target.value) || 0)))}
                    />
                  </label>
                  <label className="learning-loop-shadow-label">
                    max recs
                    <input
                      type="number"
                      step={1}
                      min={1}
                      max={32}
                      className="learning-loop-shadow-input small"
                      value={autoTuningMaxRecommendations}
                      onChange={(e) => setAutoTuningMaxRecommendations(Math.max(1, Math.min(32, Math.round(Number(e.target.value) || 1))))}
                    />
                  </label>
                  <label className="learning-loop-shadow-label">
                    floor%
                    <input
                      type="number"
                      step={0.5}
                      min={0}
                      max={100}
                      className="learning-loop-shadow-input small"
                      value={autoTuningWeightFloorPct}
                      onChange={(e) => setAutoTuningWeightFloorPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                    />
                  </label>
                  <label className="learning-loop-shadow-label">
                    cap%
                    <input
                      type="number"
                      step={0.5}
                      min={0}
                      max={100}
                      className="learning-loop-shadow-input small"
                      value={autoTuningWeightCapPct}
                      onChange={(e) => setAutoTuningWeightCapPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                    />
                  </label>
                  <label className="learning-loop-shadow-check">
                    <input
                      type="checkbox"
                      checked={autoTuningRenormalize}
                      onChange={(e) => setAutoTuningRenormalize(e.target.checked)}
                    />
                    renormalize 100%
                  </label>
                  <label className="learning-loop-shadow-label">
                    idem key
                    <input
                      type="text"
                      className="learning-loop-shadow-input"
                      value={autoTuningIdempotencyKey}
                      onChange={(e) => setAutoTuningIdempotencyKey(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="learning-loop-shadow-btn"
                    disabled={autoTuningBusy || autoTuningRecommendations.length === 0}
                    onClick={() => {
                      void submitAutoTuningWriteback(true);
                    }}
                  >
                    {autoTuningBusy ? "running..." : "Dry-run write-back"}
                  </button>
                  <button
                    type="button"
                    className="learning-loop-shadow-btn danger"
                    disabled={autoTuningBusy || autoTuningRecommendations.length === 0}
                    onClick={() => {
                      void submitAutoTuningWriteback(false);
                    }}
                  >
                    {autoTuningBusy ? "applying..." : "Apply write-back"}
                  </button>
                  <span className="learning-loop-shadow-status">{autoTuningStatus || ""}</span>
                </div>
              )}
              <div className="learning-loop-shadow-metrics">
                <div className="learning-loop-shadow-audit-title">Shadow-apply metrics (old/new)</div>
                <div className="learning-loop-shadow-metrics-grid">
                  <div className="learning-loop-shadow-metric-card">
                    <span className="learning-loop-shadow-metric-label">Weighted WR</span>
                    <span className="learning-loop-shadow-metric-values">
                      {(shadowApplyMetrics.currentWr * 100).toFixed(1)}% → {(shadowApplyMetrics.shadowWr * 100).toFixed(1)}%
                    </span>
                    <span className={shadowApplyMetrics.deltaWr >= 0 ? "good" : "warn"}>
                      {shadowApplyMetrics.deltaWr >= 0 ? "+" : ""}{(shadowApplyMetrics.deltaWr * 100).toFixed(2)}%
                    </span>
                  </div>
                  <div className="learning-loop-shadow-metric-card">
                    <span className="learning-loop-shadow-metric-label">Weighted PnL/trade</span>
                    <span className="learning-loop-shadow-metric-values">
                      {shadowApplyMetrics.currentPnl.toFixed(1)} → {shadowApplyMetrics.shadowPnl.toFixed(1)}
                    </span>
                    <span className={shadowApplyMetrics.deltaPnl >= 0 ? "good" : "warn"}>
                      {shadowApplyMetrics.deltaPnl >= 0 ? "+" : ""}{shadowApplyMetrics.deltaPnl.toFixed(2)}
                    </span>
                  </div>
                  <div className="learning-loop-shadow-metric-card">
                    <span className="learning-loop-shadow-metric-label">Concentration (HHI)</span>
                    <span className="learning-loop-shadow-metric-values">
                      {shadowApplyMetrics.currentHhi.toFixed(3)} → {shadowApplyMetrics.shadowHhi.toFixed(3)}
                    </span>
                    <span className={shadowApplyMetrics.deltaHhi <= 0 ? "good" : "warn"}>
                      {shadowApplyMetrics.deltaHhi >= 0 ? "+" : ""}{shadowApplyMetrics.deltaHhi.toFixed(4)}
                    </span>
                  </div>
                </div>
              </div>
              {rollbackGuardSession && (
                <div className="learning-loop-rollback-guard">
                  <div className="learning-loop-shadow-audit-title">Rollback guard automatique</div>
                  <div className="learning-loop-rollback-status">
                    <span>session {rollbackGuardSession.id.slice(0, 12)}</span>
                    <span>persisted backend</span>
                    <span>{rollbackGuardHistory.length} snapshots</span>
                    <span>started {formatClock(rollbackGuardSession.startedAtIso)}</span>
                  </div>
                  <div className="learning-loop-rollback-controls">
                    <label className="learning-loop-shadow-label">
                      window min
                      <input
                        type="number"
                        min={10}
                        max={480}
                        className="learning-loop-shadow-input small"
                        value={rollbackGuardWindowMin}
                        onChange={(e) => setRollbackGuardWindowMin(Math.max(10, Math.min(480, Math.round(Number(e.target.value) || 10))))}
                      />
                    </label>
                    <label className="learning-loop-shadow-label">
                      health drop
                      <input
                        type="number"
                        step={0.01}
                        min={0.01}
                        max={0.5}
                        className="learning-loop-shadow-input small"
                        value={rollbackGuardHealthDrop}
                        onChange={(e) => setRollbackGuardHealthDrop(Math.max(0.01, Math.min(0.5, Number(e.target.value) || 0.01)))}
                      />
                    </label>
                    <label className="learning-loop-shadow-label">
                      brier rise
                      <input
                        type="number"
                        step={0.005}
                        min={0.005}
                        max={0.2}
                        className="learning-loop-shadow-input small"
                        value={rollbackGuardBrierRise}
                        onChange={(e) => setRollbackGuardBrierRise(Math.max(0.005, Math.min(0.2, Number(e.target.value) || 0.005)))}
                      />
                    </label>
                    <span className="learning-loop-shadow-status">
                      {rollbackGuard.active
                        ? `monitoring ${rollbackGuard.remainingMin.toFixed(0)}m left`
                        : `window closed (${rollbackGuard.elapsedMin.toFixed(0)}m elapsed)`}
                    </span>
                    <button
                      type="button"
                      className="learning-loop-shadow-btn"
                      disabled={autoTuningBusy}
                      onClick={() => {
                        void fetch("/api/strategies/auto-tuning/rollback-guard", {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            ...(autoTuningAdminKey.trim() ? { "x-auto-tuning-admin-key": autoTuningAdminKey.trim() } : {}),
                          },
                          body: JSON.stringify({ action: "close", reason: "manual-close-ui" }),
                        }).then(() => {
                          void refreshRollbackGuardState();
                        });
                      }}
                    >
                      Close guard session
                    </button>
                  </div>
                  <div className="learning-loop-rollback-status">
                    <span>Health drop: {rollbackGuard.healthDrop.toFixed(3)}</span>
                    <span>Brier rise: {rollbackGuard.brierRise.toFixed(3)}</span>
                    <span className={rollbackGuard.shouldProposeRollback ? "warn" : "good"}>
                      {rollbackGuard.shouldProposeRollback ? "rollback proposed" : "no rollback trigger"}
                    </span>
                  </div>
                  {rollbackGuard.shouldProposeRollback && (
                    <div className="learning-loop-rollback-actions">
                      <button
                        type="button"
                        className="learning-loop-shadow-btn"
                        disabled={autoTuningBusy || rollbackProposalRecommendations.length === 0}
                        onClick={() => {
                          void submitAutoTuningWriteback(
                            true,
                            rollbackProposalRecommendations,
                            "rollback-guard proposal",
                          );
                        }}
                      >
                        Propose rollback (dry-run)
                      </button>
                      <button
                        type="button"
                        className="learning-loop-shadow-btn danger"
                        disabled={autoTuningBusy || rollbackProposalRecommendations.length === 0}
                        onClick={() => {
                          void submitAutoTuningWriteback(
                            false,
                            rollbackProposalRecommendations,
                            "rollback-guard apply",
                          );
                        }}
                      >
                        Apply rollback
                      </button>
                    </div>
                  )}
                </div>
              )}
              {autoTuningDiffPreview.length > 0 && (
                <div className="learning-loop-shadow-diff">
                  <div className="learning-loop-shadow-audit-title">Write-back diff preview</div>
                  {autoTuningDiffPreview.map((row) => (
                    <div key={`ll-diff-${row.strategyId}`} className="learning-loop-shadow-diff-row">
                      <span className="learning-loop-shadow-strat">{row.strategyId.slice(0, 10)}</span>
                      <span>{row.fromPct.toFixed(1)}%</span>
                      <span>→</span>
                      <span>{row.toPct.toFixed(1)}%</span>
                      <span className={row.deltaPct >= 0 ? "good" : "warn"}>
                        {row.deltaPct >= 0 ? "+" : ""}{row.deltaPct.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {AUTO_TUNING_WRITEBACK_ENABLED && autoTuningAuditTrail.length > 0 && (
                <div className="learning-loop-shadow-audit">
                  <div className="learning-loop-shadow-audit-title">Auto-tuning audit trail</div>
                  {autoTuningAuditTrail.slice(0, 6).map((evt) => (
                    <div key={evt.id} className="learning-loop-shadow-audit-row">
                      <span>{formatClock(evt.timestampIso)}</span>
                      <span>{evt.dryRun ? "DRY" : "APPLY"}</span>
                      <span className={evt.status === "accepted" ? "good" : "warn"}>{evt.status}</span>
                      <span>{evt.recommendationCount} recs</span>
                      <span title={evt.summary}>{evt.summary}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="learning-loop-shadow-table">
                <div className="learning-loop-shadow-head">
                  <span>Strategy</span>
                  <span>WR</span>
                  <span>Target</span>
                  <span>Delta</span>
                  <span>Action</span>
                </div>
                {learningLoopShadow.map((row) => (
                  <div key={`ll-shadow-${row.id}`} className="learning-loop-shadow-row">
                    <span className="learning-loop-shadow-strat">{row.id.slice(0, 10)}</span>
                    <span>{(row.wr * 100).toFixed(0)}%</span>
                    <span>{row.targetWeightPct.toFixed(1)}%</span>
                    <span className={row.deltaVsEqualPct >= 0 ? "good" : "warn"}>
                      {row.deltaVsEqualPct >= 0 ? "+" : ""}{row.deltaVsEqualPct.toFixed(1)}%
                    </span>
                    <span className={
                      row.recommendation === "increase" ? "good"
                      : row.recommendation === "decrease" ? "warn"
                      : "subtle"
                    }>
                      {row.recommendation}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Correlation Panel Allocation Impact */}
          {corrPenalty > 0 && (
            <div className="calib-kpi-block">
              <div className="calib-kpi-block-title">Correlation Impact on Allocation</div>
              <div className="alloc-explain-factors">
                <div className="alloc-explain-factor-row">
                  <span className="alloc-explain-factor-label">Corr Penalty:</span>
                  <span className="alloc-explain-factor-value penalty">
                    <span className="alloc-corr-penalty-display">
                      −{(corrPenalty * 100).toFixed(1)}%
                    </span>
                  </span>
                </div>
                <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.4)', lineHeight: 1.3 }}>
                  Strategy is correlated (&gt;0.7) with {
                    Object.keys(strategyCorrelationMatrix[allocActiveStratId] || {})
                      .filter(otherId => {
                        const data = strategyCorrelationMatrix[allocActiveStratId]?.[otherId];
                        return data && Math.abs(data.corr) > 0.7;
                      }).length
                  } other strategy{Object.keys(strategyCorrelationMatrix[allocActiveStratId] || {}).filter(otherId => {const data = strategyCorrelationMatrix[allocActiveStratId]?.[otherId]; return data && Math.abs(data.corr) > 0.7;}).length !== 1 ? 'ies' : ''}.
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── CALIBRATION KPI PANEL ─────────────────────────────────────────────── */}
      {filteredOutcomes.length > 0 && (
        <section className="kpi-calib-panel">
          <div className="kpi-calib-title">📊 Calibration KPI</div>
          
          {/* ── BRIER SCORE BLOCK ─────────────────────────────────────────────── */}
          {brierAnalysis.overall.brierScore !== null && (
            <div className="calib-kpi-block">
              <div className="calib-kpi-block-title">Brier Score (overall)</div>
              <div className="brier-score-container">
                <div
                  className={`brier-score-display${
                    brierAnalysis.overall.brierScore < 0.2 ? ""
                    : brierAnalysis.overall.brierScore < 0.3 ? " overfit"
                    : " poor"
                  }`}
                >
                  {(brierAnalysis.overall.brierScore * 100).toFixed(1)}
                </div>
                <div className="brier-score-info">
                  <div className="brier-score-info-label">
                    {brierAnalysis.overall.brierScore < 0.2 ? "Excellent"
                    : brierAnalysis.overall.brierScore < 0.3 ? "Good"
                    : brierAnalysis.overall.brierScore < 0.35 ? "Fair"
                    : "Poor"}
                  </div>
                  <div className="brier-score-info-value">
                    Overconfidence: {(brierAnalysis.overall.overconfidence * 100).toFixed(1)}%
                  </div>
                  <div className="brier-score-info-value" style={{ fontSize: "9px" }}>
                    {filteredOutcomes.length} trades analyzed
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── REGIME-SPECIFIC BRIER SCORES ──────────────────────────────────── */}
          {Object.keys(brierAnalysis.byRegime).length > 1 && (
            <div className="calib-kpi-block">
              <div className="calib-kpi-block-title">Brier Score by Regime</div>
              <div className="regime-buckets-container">
                {Object.entries(brierAnalysis.byRegime).map(([regime, data]) => (
                  <div key={regime} className="regime-bucket-card">
                    <div className="regime-bucket-label">{regime}</div>
                    {data.brierScore !== null ? (
                      <>
                        <div className="regime-bucket-metric">
                          <span>Brier:</span>
                          <span className="regime-bucket-metric-value">
                            {(data.brierScore * 100).toFixed(1)}
                          </span>
                        </div>
                        <div className="regime-bucket-metric">
                          <span>Overconf:</span>
                          <span className="regime-bucket-metric-value" style={{ color: data.overconfidence > 0.05 ? "#ffd600" : "#6ee7a7" }}>
                            {(data.overconfidence * 100).toFixed(1)}%
                          </span>
                        </div>
                      </>
                    ) : (
                      <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "9px" }}>–</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── CALIBRATION ERROR BY CONFIDENCE BUCKET ────────────────────────── */}
          {calibrationErrorBuckets.length > 0 && (
            <div className="calib-kpi-block">
              <div className="calib-kpi-block-title">Calibration Error by Confidence Range</div>
              <table className="calib-error-table">
                <thead>
                  <tr>
                    <th style={{ width: "30%" }}>Range</th>
                    <th style={{ width: "20%" }}>Expected</th>
                    <th style={{ width: "20%" }}>Actual</th>
                    <th style={{ width: "30%" }}>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {calibrationErrorBuckets.map((bucket) => (
                    <tr key={bucket.rangeLabel}>
                      <td className="calib-error-bucket-label">{bucket.rangeLabel}</td>
                      <td className="calib-error-expected">{bucket.expectedWR}%</td>
                      <td className="calib-error-actual">{bucket.actualWR}%</td>
                      <td className={`calib-error-delta${bucket.isOverconfident ? " overconfident" : bucket.isUnderconfident ? " underconfident" : ""}`}>
                        {bucket.calibError > 0 ? "+" : ""}{bucket.calibError}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 6, fontSize: "9px", color: "rgba(255,255,255,0.5)" }}>
                📌 Positive = overconfident (predicted too high), Negative = underconfident
              </div>
            </div>
          )}
        </section>
      )}

      {/* ═══════════════ FLOATING PANELS OVERLAY ════════════════════════════ */}
      {floatingPanels.map((fp) => (
        <div
          key={`float-${fp.id}`}
          className="floating-panel-window"
          style={{ left: fp.x, top: fp.y, width: fp.w, height: fp.h }}
        >
          <div
            className="floating-panel-titlebar"
            onMouseDown={(e) => {
              e.preventDefault();
              floatingDragRef.current = { id: fp.id, startX: e.clientX, startY: e.clientY, origX: fp.x, origY: fp.y };
            }}
          >
            <span className="floating-panel-title">{fp.id.toUpperCase()}</span>
            <span className="floating-panel-zone-badge">{fp.fromZone}</span>
            <div className="floating-panel-actions">
              <button
                type="button"
                className="floating-panel-resize-btn"
                title="Agrandir"
                onClick={() =>
                  setFloatingPanels((prev) =>
                    prev.map((f) => f.id === fp.id ? { ...f, w: Math.min(f.w + 80, 900), h: Math.min(f.h + 60, 700) } : f),
                  )
                }
              >□+</button>
              <button
                type="button"
                className="floating-panel-dock-btn"
                title={`Redocker dans ${fp.fromZone}`}
                onClick={() => dockPanel(fp.id)}
              >⤢ Dock</button>
              <button
                type="button"
                className="floating-panel-close-btn"
                title="Fermer la fenêtre et redocker"
                onClick={() => dockPanel(fp.id)}
              >✕</button>
            </div>
          </div>
          <div className="floating-panel-body">
            {renderDockPanelContent(fp.id)}
          </div>
          <div
            className="floating-panel-resize-handle"
            onMouseDown={(e) => {
              e.stopPropagation();
              const startW = fp.w;
              const startH = fp.h;
              const startX = e.clientX;
              const startY = e.clientY;
              const onMove = (ev: MouseEvent) => {
                setFloatingPanels((prev) =>
                  prev.map((f) =>
                    f.id === fp.id
                      ? clampFloatingPanel({ ...f, w: startW + ev.clientX - startX, h: startH + ev.clientY - startY })
                      : f,
                  ),
                );
              };
              const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
          />
        </div>
      ))}
    </main>
  );
}
