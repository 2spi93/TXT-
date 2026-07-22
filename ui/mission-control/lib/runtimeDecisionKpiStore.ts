import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { RuntimeDecisionAnalyticsSummary } from "./runtimeDecisionAnalytics";

export type RuntimeDecisionKpiSnapshot = {
  timestamp: string;
  bucketStartIso: string;
  scope: {
    symbol: string;
    timeframe: string;
    strategy: string;
    sinceDays: number;
    limit: number;
  };
  driftProbability: number;
  reliability: number;
  opportunityScore: number;
  decisionOutcome: "correct" | "false_positive" | "unknown" | null;
  driftFalsePositiveRate: number;
  driftDetectionRate: number;
  opportunityHitRate: number;
  decisionConsistency: number;
  driftReliabilityMean: number;
  driftStability: number;
  reliabilityState: RuntimeDecisionAnalyticsSummary["reliability"]["state"] | "UNKNOWN";
  observationStatus: RuntimeDecisionAnalyticsSummary["observation"]["status"];
  observationIntegrityStatus: RuntimeDecisionAnalyticsSummary["observation"]["integrity"]["status"] | "UNKNOWN";
  observationGapDensityPct: number;
  observationMissingHours: number;
  observationExpectedHours: number;
  integrityState: RuntimeDecisionAnalyticsSummary["integrity"]["state"] | "UNKNOWN";
  integrityScorePct: number;
  integrityReasons: string[];
  noTradeConcentrationPct: number;
  noTradeConcentrationLabel: string | null;
  manualCalibrationEligible: boolean;
};

type RuntimeDecisionKpiCache = {
  filePath: string;
  mtimeMs: number;
  size: number;
  rows: RuntimeDecisionKpiSnapshot[];
};

let kpiCache: RuntimeDecisionKpiCache | null = null;

function filePath(): string {
  const kpiDir = process.env.RUNTIME_DECISION_KPI_DIR || "/tmp";
  const kpiFile = process.env.RUNTIME_DECISION_KPI_FILE || "mission-control-runtime-decision-kpi.jsonl";
  return path.join(kpiDir, kpiFile);
}

async function loadAllSnapshots(): Promise<RuntimeDecisionKpiSnapshot[]> {
  const target = filePath();

  try {
    const metadata = await stat(target);
    if (
      kpiCache
      && kpiCache.filePath === target
      && kpiCache.mtimeMs === metadata.mtimeMs
      && kpiCache.size === metadata.size
    ) {
      return kpiCache.rows;
    }

    const content = await readFile(target, "utf-8");
    const rows = content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return normalizeSnapshot(JSON.parse(line) as unknown);
        } catch {
          return null;
        }
      })
      .filter((row): row is RuntimeDecisionKpiSnapshot => row !== null);

    kpiCache = {
      filePath: target,
      mtimeMs: metadata.mtimeMs,
      size: metadata.size,
      rows,
    };
    return rows;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      kpiCache = null;
      return [];
    }
    throw error;
  }
}

function matchesSnapshot(
  row: RuntimeDecisionKpiSnapshot,
  input: {
    symbol: string;
    timeframe: string;
    strategy: string;
    cutoffMs: number;
  },
): boolean {
  if (input.symbol && row.scope.symbol !== input.symbol) return false;
  if (input.timeframe && row.scope.timeframe !== input.timeframe) return false;
  if (input.strategy && row.scope.strategy !== input.strategy) return false;
  if (input.cutoffMs > 0) {
    const createdAtMs = Date.parse(row.timestamp);
    if (Number.isFinite(createdAtMs) && createdAtMs < input.cutoffMs) return false;
  }
  return true;
}

function isDuplicateSnapshot(candidate: RuntimeDecisionKpiSnapshot, rows: RuntimeDecisionKpiSnapshot[]): boolean {
  const cutoffMs = Date.parse(candidate.timestamp) - 3 * 24 * 60 * 60 * 1000;

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const createdAtMs = Date.parse(row.timestamp);
    if (Number.isFinite(createdAtMs) && createdAtMs < cutoffMs) {
      break;
    }
    if (
      row.bucketStartIso === candidate.bucketStartIso
      && row.scope.symbol === candidate.scope.symbol
      && row.scope.timeframe === candidate.scope.timeframe
      && row.scope.strategy === candidate.scope.strategy
    ) {
      return true;
    }
  }

  return false;
}

function clampInt(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function toHourBucketIso(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  const bucketMs = Number.isFinite(parsed)
    ? Math.floor(parsed / (60 * 60 * 1000)) * 60 * 60 * 1000
    : Date.now();
  return new Date(bucketMs).toISOString();
}

function normalizeDecisionOutcome(value: unknown): RuntimeDecisionKpiSnapshot["decisionOutcome"] {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "correct" || normalized === "false_positive" || normalized === "unknown") {
    return normalized;
  }
  return null;
}

function normalizeSnapshot(raw: unknown): RuntimeDecisionKpiSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const payload = raw as Partial<RuntimeDecisionKpiSnapshot> & {
    scope?: Partial<RuntimeDecisionKpiSnapshot["scope"]>;
  };
  const timestamp = String(payload.timestamp || "").trim();
  const bucketStartIso = String(payload.bucketStartIso || "").trim() || toHourBucketIso(timestamp || new Date().toISOString());
  if (!timestamp) {
    return null;
  }
  return {
    timestamp,
    bucketStartIso,
    scope: {
      symbol: String(payload.scope?.symbol || "").trim().toUpperCase(),
      timeframe: String(payload.scope?.timeframe || "").trim(),
      strategy: String(payload.scope?.strategy || "").trim(),
      sinceDays: clampInt(Number(payload.scope?.sinceDays || 7), 1, 90),
      limit: clampInt(Number(payload.scope?.limit || 1200), 1, 5_000),
    },
    driftProbability: Number(payload.driftProbability || 0),
    reliability: Number(payload.reliability || 0),
    opportunityScore: Number(payload.opportunityScore || 0),
    decisionOutcome: normalizeDecisionOutcome(payload.decisionOutcome),
    driftFalsePositiveRate: Number(payload.driftFalsePositiveRate || 0),
    driftDetectionRate: Number(payload.driftDetectionRate || 0),
    opportunityHitRate: Number(payload.opportunityHitRate || 0),
    decisionConsistency: Number(payload.decisionConsistency || 0),
    driftReliabilityMean: Number(payload.driftReliabilityMean || 0),
    driftStability: Number(payload.driftStability || 0),
    reliabilityState: payload.reliabilityState === "RELIABLE" || payload.reliabilityState === "DEGRADED" || payload.reliabilityState === "BLOCKED_BY_DATA"
      ? payload.reliabilityState
      : "UNKNOWN",
    observationStatus: payload.observationStatus === "READY_FOR_REVIEW" || payload.observationStatus === "OBSERVE"
      ? payload.observationStatus
      : "INSUFFICIENT",
    observationIntegrityStatus: payload.observationIntegrityStatus === "OK" || payload.observationIntegrityStatus === "DEGRADED" || payload.observationIntegrityStatus === "CRITICAL"
      ? payload.observationIntegrityStatus
      : "UNKNOWN",
    observationGapDensityPct: Number(payload.observationGapDensityPct || 0),
    observationMissingHours: Math.max(0, Math.round(Number(payload.observationMissingHours || 0))),
    observationExpectedHours: Math.max(0, Math.round(Number(payload.observationExpectedHours || 0))),
    integrityState: payload.integrityState === "HIGH" || payload.integrityState === "DEGRADED" || payload.integrityState === "BROKEN"
      ? payload.integrityState
      : "UNKNOWN",
    integrityScorePct: Number(payload.integrityScorePct || 0),
    integrityReasons: Array.isArray(payload.integrityReasons)
      ? payload.integrityReasons.map((reason) => String(reason || "").trim()).filter(Boolean).slice(0, 8)
      : [],
    noTradeConcentrationPct: Number(payload.noTradeConcentrationPct || 0),
    noTradeConcentrationLabel: typeof payload.noTradeConcentrationLabel === "string" && payload.noTradeConcentrationLabel.trim().length > 0
      ? payload.noTradeConcentrationLabel.trim()
      : null,
    manualCalibrationEligible: Boolean(payload.manualCalibrationEligible),
  };
}

export function createRuntimeDecisionKpiSnapshot(
  summary: RuntimeDecisionAnalyticsSummary,
  decisionOutcome: RuntimeDecisionKpiSnapshot["decisionOutcome"],
): RuntimeDecisionKpiSnapshot {
  const timestamp = new Date().toISOString();
  const topNoTradeCluster = summary.monitoring.noTradeHeatmap.rows
    .flatMap((row) => row.cells.map((cell) => ({
      sharePct: cell.sharePct,
      label: `${row.regime} · ${cell.timeframe} · ${cell.topCode || "quiet"}`,
    })))
    .sort((left, right) => right.sharePct - left.sharePct || left.label.localeCompare(right.label))[0] || null;

  return {
    timestamp,
    bucketStartIso: toHourBucketIso(timestamp),
    scope: {
      symbol: summary.scope.symbol,
      timeframe: summary.scope.timeframe,
      strategy: summary.scope.strategy,
      sinceDays: summary.scope.sinceDays,
      limit: summary.scope.limit,
    },
    driftProbability: summary.drift.stats.probabilityPct,
    reliability: summary.drift.stats.reliabilityPct,
    opportunityScore: summary.opportunity.avgScore,
    decisionOutcome,
    driftFalsePositiveRate: summary.observation.driftFalsePositiveRate,
    driftDetectionRate: summary.observation.driftDetectionRate,
    opportunityHitRate: summary.observation.opportunityHitRate,
    decisionConsistency: summary.observation.decisionConsistency,
    driftReliabilityMean: summary.observation.driftReliabilityMean,
    driftStability: summary.observation.driftStability,
    reliabilityState: summary.reliability.state,
    observationStatus: summary.observation.status,
    observationIntegrityStatus: summary.observation.integrity.status,
    observationGapDensityPct: summary.observation.integrity.expectedHours > 0
      ? Number(((summary.observation.integrity.missingHours / summary.observation.integrity.expectedHours) * 100).toFixed(1))
      : 0,
    observationMissingHours: summary.observation.integrity.missingHours,
    observationExpectedHours: summary.observation.integrity.expectedHours,
    integrityState: summary.integrity.state,
    integrityScorePct: summary.integrity.scorePct,
    integrityReasons: summary.integrity.reasons.slice(0, 8),
    noTradeConcentrationPct: Number((topNoTradeCluster?.sharePct || 0).toFixed(1)),
    noTradeConcentrationLabel: topNoTradeCluster?.label || null,
    manualCalibrationEligible: summary.observation.manualCalibrationEligible,
  };
}

export async function readRuntimeDecisionKpiSnapshots(options?: {
  symbol?: string;
  timeframe?: string;
  strategy?: string;
  limit?: number;
  sinceDays?: number;
}): Promise<RuntimeDecisionKpiSnapshot[]> {
  const symbol = String(options?.symbol || "").trim().toUpperCase();
  const timeframe = String(options?.timeframe || "").trim();
  const strategy = String(options?.strategy || "").trim();
  const limit = clampInt(Number(options?.limit || 40), 1, 2_000);
  const sinceDays = clampInt(Number(options?.sinceDays || 0), 0, 365);
  const cutoffMs = sinceDays > 0 ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : 0;

  try {
    const rows = await loadAllSnapshots();
    const results: RuntimeDecisionKpiSnapshot[] = [];

    for (let index = rows.length - 1; index >= 0 && results.length < limit; index -= 1) {
      const row = rows[index];
      if (cutoffMs > 0) {
        const createdAtMs = Date.parse(row.timestamp);
        if (Number.isFinite(createdAtMs) && createdAtMs < cutoffMs) {
          break;
        }
      }
      if (!matchesSnapshot(row, { symbol, timeframe, strategy, cutoffMs })) {
        continue;
      }
      results.push(row);
    }

    return results;
  } catch {
    return [];
  }
}

export async function appendRuntimeDecisionKpiSnapshot(snapshot: RuntimeDecisionKpiSnapshot): Promise<boolean> {
  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) {
    return false;
  }

  const existing = await loadAllSnapshots();
  if (isDuplicateSnapshot(normalized, existing)) {
    return false;
  }

  const target = filePath();
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(normalized)}\n`, "utf-8");
  kpiCache = null;
  return true;
}