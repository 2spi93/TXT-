import {
  EXECUTION_DECISION_POLICY_VERSION,
  resolveExecutionDecisionCodeFromJournalAction,
  validateExecutionDecisionAudit,
  type ExecutionDecisionCode,
} from "./executionDecisionSchema";
import { readV2RiskJournalEntries, type V2RiskJournalEntry } from "./v2RiskJournal";

export type RuntimeDecisionBucket = "market" | "runtime" | "policy" | "broker" | "confidence" | "external-governance" | "post-trade" | "legacy" | "unknown";
export type RuntimeDecisionFamily = "routing" | "runtime" | "policy" | "broker" | "confidence" | "external-governance" | "post-trade" | "legacy" | "unknown";
export type RuntimeDecisionTone = "good" | "subtle" | "warn";
export type RuntimeDecisionDriftMetricKey = "routingZeroRate" | "fallbackRate" | "runtimeBlockRate" | "policyBlockRate" | "falsePositiveRate";
export type RuntimeDecisionDriftWindowKey = "1h" | "6h" | "24h";

export type RuntimeDecisionAnalyticsSample = {
  createdAtIso: string;
  action: string;
  code: string;
  family: RuntimeDecisionFamily;
  bucket: RuntimeDecisionBucket;
  attentionState: string;
  volatilityRegime: string;
  busSeq: number;
  depthAgeMs: number | null;
  detail: string;
};

export type RuntimeDecisionDriftWindowMetrics = {
  label: RuntimeDecisionDriftWindowKey;
  hours: number;
  executionRows: number;
  noTradeRows: number;
  routingZeroRate: number;
  fallbackRate: number;
  runtimeBlockRate: number;
  policyBlockRate: number;
  falsePositiveRate: number;
};

export type RuntimeDecisionDriftAlert = {
  metric: RuntimeDecisionDriftMetricKey;
  currentWindow: Exclude<RuntimeDecisionDriftWindowKey, "24h">;
  baselineWindow: "24h";
  currentRate: number;
  baselineRate: number;
  drift: number;
  severity: "warning" | "critical";
};

export type RuntimeDecisionSeriesPoint = {
  t: number;
  iso: string;
  executionRows: number;
  noTradeRate: number;
  routingZeroRate: number;
  fallbackRate: number;
  runtimeBlockRate: number;
  policyBlockRate: number;
  falsePositiveRate: number;
  opportunityRate: number;
  missedOpportunityRate: number;
  executionEfficiency: number;
};

export type RuntimeDecisionAnalyticsSummary = {
  scope: {
    symbol: string;
    timeframe: string;
    strategy: string;
    limit: number;
    sinceDays: number;
  };
  policyVersion: string;
  totals: {
    totalRows: number;
    executionRows: number;
    noTradeRows: number;
    noTradePctWithinExecution: number;
    canonicalRows: number;
    normalizedLegacyRows: number;
    unclassifiedLegacyRows: number;
    canonicalCoveragePct: number;
    effectiveCanonicalCoveragePct: number;
  };
  topCodes: Array<{ code: string; family: RuntimeDecisionFamily; bucket: RuntimeDecisionBucket; count: number; sharePct: number }>;
  byBucket: Array<{ bucket: RuntimeDecisionBucket; count: number; sharePct: number }>;
  byFamily: Array<{ family: RuntimeDecisionFamily; count: number; sharePct: number }>;
  marketContext: {
    volatilityRegime: Array<{ label: string; count: number; sharePct: number }>;
    attentionState: Array<{ label: string; count: number; sharePct: number }>;
    tripleValidationState: Array<{ label: string; count: number; sharePct: number }>;
  };
  semanticMismatchCandidates: {
    count: number;
    sharePct: number;
    samples: RuntimeDecisionAnalyticsSample[];
  };
  falsePositiveCandidates: {
    count: number;
    sharePct: number;
    samples: RuntimeDecisionAnalyticsSample[];
  };
  opportunity: {
    candidateCount: number;
    blockedCount: number;
    executedCount: number;
    opportunityRate: number;
    missedOpportunityRate: number;
    executionEfficiency: number;
    blockedByBucket: Array<{ bucket: RuntimeDecisionBucket; count: number; sharePct: number }>;
    topBlockedBucket: { label: RuntimeDecisionBucket; count: number; sharePct: number };
    summary: string;
  };
  drift: {
    detected: boolean;
    tone: RuntimeDecisionTone;
    windows: Record<RuntimeDecisionDriftWindowKey, RuntimeDecisionDriftWindowMetrics>;
    alerts: RuntimeDecisionDriftAlert[];
    headline: string;
    summary: string;
  };
  series: {
    bucketHours: number;
    windowHours: number;
    points: RuntimeDecisionSeriesPoint[];
  };
  dominant: {
    bucket: { label: RuntimeDecisionBucket; count: number; sharePct: number };
    code: { label: string; count: number; sharePct: number };
    attentionState: { label: string; count: number; sharePct: number };
    volatilityRegime: { label: string; count: number; sharePct: number };
  };
  deskRead: {
    tone: RuntimeDecisionTone;
    headline: string;
    summary: string;
    nextAction: string;
  };
};

type DerivedExecutionRow = {
  entry: V2RiskJournalEntry;
  timestampMs: number;
  code: string;
  family: RuntimeDecisionFamily;
  bucket: RuntimeDecisionBucket;
  context: ReturnType<typeof extractContext>;
  hasCanonicalAudit: boolean;
  isNoTrade: boolean;
  semanticMismatch: boolean;
  falsePositiveCandidate: boolean;
  opportunityCandidate: boolean;
};

const DRIFT_WINDOWS: Array<{ label: RuntimeDecisionDriftWindowKey; hours: number }> = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
];
const DRIFT_CURRENT_WINDOWS: Array<Exclude<RuntimeDecisionDriftWindowKey, "24h">> = ["1h", "6h"];
const DRIFT_WARNING_THRESHOLD = 0.3;
const DRIFT_CRITICAL_THRESHOLD = 0.6;
const MIN_CURRENT_NO_TRADE_ROWS = 3;
const MIN_BASELINE_NO_TRADE_ROWS = 10;
const SERIES_BUCKET_HOURS = 1;
const SERIES_WINDOW_HOURS = 24;

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function percent(part: number, total: number): number {
  return total > 0 ? Number(((part / total) * 100).toFixed(2)) : 0;
}

function sortedEntries(map: Map<string, number>): Array<[string, number]> {
  return Array.from(map.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function parseTimestamp(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeExecutionOutcomeCode(value: string): ExecutionDecisionCode {
  const normalized = value.trim().toLowerCase();
  if (/(good|positive|profit|win|clean|ok|success)/.test(normalized)) {
    return "execution-v7-outcome-positive";
  }
  if (/(bad|negative|loss|fail|blocked|reject|degraded|warn)/.test(normalized)) {
    return "execution-v7-outcome-negative";
  }
  return "execution-v7-outcome-neutral";
}

function deriveCanonicalCode(entry: V2RiskJournalEntry): string {
  const meta = safeRecord(entry.meta);
  const audit = validateExecutionDecisionAudit(meta.decision_audit);
  if (audit) {
    return audit.code;
  }

  const action = String(entry.action || "").trim().toLowerCase();
  const detail = String(entry.detail || "").trim().toLowerCase();
  const executionLock = safeRecord(meta.execution_lock);
  const resolved = resolveExecutionDecisionCodeFromJournalAction(action, { executionLockCode: executionLock.code });
  if (resolved) {
    return resolved;
  }
  if (action.startsWith("execution-v7-outcome-")) {
    return normalizeExecutionOutcomeCode(action.slice("execution-v7-outcome-".length));
  }
  if (action === "execution-disabled-routing") {
    if (detail.includes("routing score 0")) return "routing-score-zero";
    if (detail.includes("routing remains blocked")) return "routing-blocked";
    if (detail.includes("recovery") && detail.includes("actif")) return "runtime-recovery-lockdown";
    if (detail.includes("watchdog halt")) return "runtime-watchdog-halt";
    if (detail.includes("readiness degraded") || detail.includes("live readiness")) return "runtime-live-readiness-degraded";
    if (detail.includes("mt5 bridge")) return "runtime-mt5-bridge-degraded";
  }
  return "legacy-unclassified";
}

function classifyCode(code: string): { family: RuntimeDecisionFamily; bucket: RuntimeDecisionBucket } {
  switch (code) {
    case "runtime-kill-switch-active":
    case "runtime-watchdog-halt":
    case "runtime-recovery-lockdown":
    case "runtime-live-readiness-degraded":
      return { family: "runtime", bucket: "runtime" };
    case "runtime-external-kill-switch-active":
      return { family: "external-governance", bucket: "external-governance" };
    case "runtime-mt5-bridge-degraded":
      return { family: "broker", bucket: "broker" };
    case "engine-v4-off":
    case "execution-v7-blocked":
      return { family: "policy", bucket: "policy" };
    case "routing-score-zero":
    case "routing-blocked":
      return { family: "routing", bucket: "market" };
    case "fallback-mode":
      return { family: "routing", bucket: "runtime" };
    case "execution-v7-outcome-positive":
    case "execution-v7-outcome-neutral":
    case "execution-v7-outcome-negative":
      return { family: "post-trade", bucket: "post-trade" };
    case "legacy-unclassified":
      return { family: "legacy", bucket: "legacy" };
    default:
      if (code.includes("confidence")) {
        return { family: "confidence", bucket: "confidence" };
      }
      if (/(broker|mt5|bridge)/i.test(code)) {
        return { family: "broker", bucket: "broker" };
      }
      return { family: "unknown", bucket: "unknown" };
  }
}

function extractContext(entry: V2RiskJournalEntry) {
  const meta = safeRecord(entry.meta);
  const attention = safeRecord(meta.attention_context);
  const context = safeRecord(attention.context);
  const sync = safeRecord(meta.sync_diagnostics);
  const depthAgeRaw = sync.depth_age_ms;
  const temporalDriftRaw = context.temporalDriftMs ?? context.temporal_drift_ms;
  return {
    attentionState: String(attention.state || "unknown"),
    volatilityRegime: String(context.volatilityRegime || "unknown"),
    tripleValidationState: String(context.triple_validation_state || safeRecord(meta.triple_validation).state || "unknown"),
    shouldBlockTrading: Boolean(attention.shouldBlockTrading || attention.should_block_trading),
    executionQualityScore: toNumber(context.executionQualityScore ?? context.execution_quality_score, 0),
    temporalDriftMs: typeof temporalDriftRaw === "number" && Number.isFinite(temporalDriftRaw) ? temporalDriftRaw : null,
    manipulationRisk: toNumber(context.manipulationRisk ?? context.manipulation_risk, 0),
    busSeq: Math.max(0, Math.round(toNumber(sync.bus_seq, 0))),
    depthAgeMs: typeof depthAgeRaw === "number" && Number.isFinite(depthAgeRaw) ? Math.max(0, Math.round(depthAgeRaw)) : null,
  };
}

function isExecutionRow(entry: V2RiskJournalEntry): boolean {
  return String(entry.action || "").trim().toLowerCase().startsWith("execution-");
}

function isNoTradeAction(entry: V2RiskJournalEntry): boolean {
  const action = String(entry.action || "").trim().toLowerCase();
  return action.includes("disabled") || action.includes("blocked");
}

function detectSemanticMismatch(code: string, detail: string): boolean {
  const normalizedDetail = detail.trim().toLowerCase();
  if (!normalizedDetail) {
    return false;
  }
  if (code === "runtime-live-readiness-degraded" && (normalizedDetail.includes("healthy") || normalizedDetail.includes("failure none"))) {
    return true;
  }
  if (code === "runtime-mt5-bridge-degraded" && normalizedDetail.includes("ok")) {
    return true;
  }
  if (code === "fallback-mode" && !normalizedDetail.includes("fallback")) {
    return true;
  }
  return false;
}

function isOpportunityCandidate(context: ReturnType<typeof extractContext>): boolean {
  const depthHealthy = context.depthAgeMs == null || context.depthAgeMs <= 2_000;
  const temporalHealthy = context.temporalDriftMs == null || context.temporalDriftMs <= 2_500;
  return context.attentionState === "stable"
    && !context.shouldBlockTrading
    && context.busSeq > 0
    && depthHealthy
    && temporalHealthy
    && context.executionQualityScore >= 0.65
    && context.manipulationRisk < 0.35;
}

function buildSample(row: DerivedExecutionRow): RuntimeDecisionAnalyticsSample {
  return {
    createdAtIso: row.entry.createdAtIso,
    action: row.entry.action,
    code: row.code,
    family: row.family,
    bucket: row.bucket,
    attentionState: row.context.attentionState,
    volatilityRegime: row.context.volatilityRegime,
    busSeq: row.context.busSeq,
    depthAgeMs: row.context.depthAgeMs,
    detail: row.entry.detail,
  };
}

function toLabelRows(entries: Array<[string, number]>, total: number): Array<{ label: string; count: number; sharePct: number }> {
  return entries.map(([label, count]) => ({ label, count, sharePct: percent(count, total) }));
}

function topRow<T extends string>(rows: Array<{ label: T; count: number; sharePct: number }>, fallback: T) {
  return rows[0] || { label: fallback, count: 0, sharePct: 0 };
}

function toDriftRate(count: number, noTradeRows: number): number {
  return percent(count, noTradeRows);
}

function computeDrift(currentRate: number, baselineRate: number): number {
  if (baselineRate <= 0) {
    return currentRate > 0 ? 1 : 0;
  }
  return Number(((currentRate - baselineRate) / baselineRate).toFixed(4));
}

function deriveRows(entries: V2RiskJournalEntry[]): DerivedExecutionRow[] {
  return entries
    .filter(isExecutionRow)
    .map((entry) => {
      const timestampMs = parseTimestamp(entry.createdAtIso);
      const meta = safeRecord(entry.meta);
      const audit = validateExecutionDecisionAudit(meta.decision_audit);
      const code = deriveCanonicalCode(entry);
      const classification = classifyCode(code);
      const context = extractContext(entry);
      const isNoTrade = isNoTradeAction(entry);
      const semanticMismatch = isNoTrade && detectSemanticMismatch(code, String(entry.detail || ""));
      const falsePositiveCandidate = isNoTrade
        && context.attentionState === "stable"
        && context.busSeq > 0
        && (context.depthAgeMs == null || context.depthAgeMs <= 2_000)
        && (classification.bucket === "policy" || classification.bucket === "runtime");
      return {
        entry,
        timestampMs,
        code,
        family: classification.family,
        bucket: classification.bucket,
        context,
        hasCanonicalAudit: Boolean(audit),
        isNoTrade,
        semanticMismatch,
        falsePositiveCandidate,
        opportunityCandidate: isOpportunityCandidate(context),
      };
    })
    .filter((row) => row.timestampMs > 0)
    .sort((left, right) => left.timestampMs - right.timestampMs);
}

function summarizeRows(rows: DerivedExecutionRow[], sampleLimit: number) {
  const byCode = new Map<string, number>();
  const byFamily = new Map<string, number>();
  const byBucket = new Map<string, number>();
  const byAttentionState = new Map<string, number>();
  const byVolatilityRegime = new Map<string, number>();
  const byTripleValidationState = new Map<string, number>();
  const blockedOpportunityByBucket = new Map<string, number>();

  let noTradeRows = 0;
  let canonicalRows = 0;
  let normalizedLegacyRows = 0;
  let unclassifiedLegacyRows = 0;
  let candidateCount = 0;
  let blockedCount = 0;
  let executedCount = 0;

  const semanticMismatchCandidates: RuntimeDecisionAnalyticsSample[] = [];
  const falsePositiveCandidates: RuntimeDecisionAnalyticsSample[] = [];

  for (const row of rows) {
    if (row.opportunityCandidate) {
      candidateCount += 1;
      if (row.isNoTrade) {
        blockedCount += 1;
        blockedOpportunityByBucket.set(row.bucket, (blockedOpportunityByBucket.get(row.bucket) || 0) + 1);
      } else {
        executedCount += 1;
      }
    }

    if (!row.isNoTrade) {
      continue;
    }

    noTradeRows += 1;
    if (row.hasCanonicalAudit) {
      canonicalRows += 1;
    } else if (row.code === "legacy-unclassified") {
      unclassifiedLegacyRows += 1;
    } else {
      normalizedLegacyRows += 1;
    }

    byCode.set(row.code, (byCode.get(row.code) || 0) + 1);
    byFamily.set(row.family, (byFamily.get(row.family) || 0) + 1);
    byBucket.set(row.bucket, (byBucket.get(row.bucket) || 0) + 1);
    byAttentionState.set(row.context.attentionState, (byAttentionState.get(row.context.attentionState) || 0) + 1);
    byVolatilityRegime.set(row.context.volatilityRegime, (byVolatilityRegime.get(row.context.volatilityRegime) || 0) + 1);
    byTripleValidationState.set(row.context.tripleValidationState, (byTripleValidationState.get(row.context.tripleValidationState) || 0) + 1);

    if (row.semanticMismatch) {
      semanticMismatchCandidates.push(buildSample(row));
    }
    if (row.falsePositiveCandidate) {
      falsePositiveCandidates.push(buildSample(row));
    }
  }

  const topCodes = sortedEntries(byCode).map(([code, count]) => {
    const classification = classifyCode(code);
    return {
      code,
      family: classification.family,
      bucket: classification.bucket,
      count,
      sharePct: percent(count, noTradeRows),
    };
  });
  const byBucketRows = sortedEntries(byBucket).map(([bucket, count]) => ({ bucket: bucket as RuntimeDecisionBucket, count, sharePct: percent(count, noTradeRows) }));
  const byFamilyRows = sortedEntries(byFamily).map(([family, count]) => ({ family: family as RuntimeDecisionFamily, count, sharePct: percent(count, noTradeRows) }));
  const attentionRows = toLabelRows(sortedEntries(byAttentionState), noTradeRows);
  const volatilityRows = toLabelRows(sortedEntries(byVolatilityRegime), noTradeRows);
  const tripleValidationRows = toLabelRows(sortedEntries(byTripleValidationState), noTradeRows);
  const blockedByBucketRows = sortedEntries(blockedOpportunityByBucket).map(([bucket, count]) => ({ bucket: bucket as RuntimeDecisionBucket, count, sharePct: percent(count, blockedCount) }));

  return {
    executionRows: rows.length,
    noTradeRows,
    canonicalRows,
    normalizedLegacyRows,
    unclassifiedLegacyRows,
    topCodes,
    byBucketRows,
    byFamilyRows,
    attentionRows,
    volatilityRows,
    tripleValidationRows,
    semanticMismatchCandidates: semanticMismatchCandidates.slice(0, sampleLimit),
    semanticMismatchCount: semanticMismatchCandidates.length,
    falsePositiveCandidates: falsePositiveCandidates.slice(0, sampleLimit),
    falsePositiveCount: falsePositiveCandidates.length,
    candidateCount,
    blockedCount,
    executedCount,
    blockedByBucketRows,
  };
}

function buildDriftWindowMetrics(label: RuntimeDecisionDriftWindowKey, hours: number, rows: DerivedExecutionRow[]): RuntimeDecisionDriftWindowMetrics {
  const noTradeRows = rows.filter((row) => row.isNoTrade).length;
  const routingZeroCount = rows.filter((row) => row.isNoTrade && row.code === "routing-score-zero").length;
  const fallbackCount = rows.filter((row) => row.isNoTrade && row.code === "fallback-mode").length;
  const runtimeCount = rows.filter((row) => row.isNoTrade && row.bucket === "runtime").length;
  const policyCount = rows.filter((row) => row.isNoTrade && row.bucket === "policy").length;
  const falsePositiveCount = rows.filter((row) => row.falsePositiveCandidate).length;
  return {
    label,
    hours,
    executionRows: rows.length,
    noTradeRows,
    routingZeroRate: toDriftRate(routingZeroCount, noTradeRows),
    fallbackRate: toDriftRate(fallbackCount, noTradeRows),
    runtimeBlockRate: toDriftRate(runtimeCount, noTradeRows),
    policyBlockRate: toDriftRate(policyCount, noTradeRows),
    falsePositiveRate: toDriftRate(falsePositiveCount, noTradeRows),
  };
}

function buildDrift(rows: DerivedExecutionRow[], nowMs: number) {
  const windows = Object.fromEntries(DRIFT_WINDOWS.map((windowConfig) => {
    const threshold = nowMs - windowConfig.hours * 60 * 60 * 1000;
    const windowRows = rows.filter((row) => row.timestampMs >= threshold);
    return [windowConfig.label, buildDriftWindowMetrics(windowConfig.label, windowConfig.hours, windowRows)];
  })) as Record<RuntimeDecisionDriftWindowKey, RuntimeDecisionDriftWindowMetrics>;

  const alerts: RuntimeDecisionDriftAlert[] = [];
  const baseline = windows["24h"];
  const metricKeys: RuntimeDecisionDriftMetricKey[] = ["routingZeroRate", "fallbackRate", "runtimeBlockRate", "policyBlockRate", "falsePositiveRate"];

  for (const currentWindow of DRIFT_CURRENT_WINDOWS) {
    const current = windows[currentWindow];
    if (current.noTradeRows < MIN_CURRENT_NO_TRADE_ROWS || baseline.noTradeRows < MIN_BASELINE_NO_TRADE_ROWS) {
      continue;
    }
    for (const metric of metricKeys) {
      const drift = computeDrift(current[metric], baseline[metric]);
      if (drift <= DRIFT_WARNING_THRESHOLD) {
        continue;
      }
      alerts.push({
        metric,
        currentWindow,
        baselineWindow: "24h",
        currentRate: current[metric],
        baselineRate: baseline[metric],
        drift,
        severity: drift > DRIFT_CRITICAL_THRESHOLD ? "critical" : "warning",
      });
    }
  }

  alerts.sort((left, right) => right.drift - left.drift);
  const criticalCount = alerts.filter((item) => item.severity === "critical").length;
  const tone: RuntimeDecisionTone = criticalCount > 0 ? "warn" : alerts.length > 0 ? "subtle" : "good";
  const headline = alerts.length === 0
    ? "No material drift vs 24h baseline"
    : criticalCount > 0
      ? "Critical drift detected"
      : "Behavior drift detected";
  const summary = alerts.length === 0
    ? "Les fenetres 1h et 6h restent proches de la baseline 24h sur les metriques de refus systeme."
    : alerts.slice(0, 3).map((alert) => `${alert.currentWindow} ${alert.metric} ${alert.drift > 0 ? "+" : ""}${(alert.drift * 100).toFixed(0)}% vs 24h`).join(" · ");

  return {
    detected: alerts.length > 0,
    tone,
    windows,
    alerts,
    headline,
    summary,
  };
}

function buildSeries(rows: DerivedExecutionRow[], nowMs: number) {
  const bucketMs = SERIES_BUCKET_HOURS * 60 * 60 * 1000;
  const alignedNow = Math.ceil(nowMs / bucketMs) * bucketMs;
  const pointCount = Math.max(1, Math.round(SERIES_WINDOW_HOURS / SERIES_BUCKET_HOURS));
  const points: RuntimeDecisionSeriesPoint[] = [];

  for (let index = pointCount - 1; index >= 0; index -= 1) {
    const bucketEnd = alignedNow - index * bucketMs;
    const bucketStart = bucketEnd - bucketMs;
    const bucketRows = rows.filter((row) => row.timestampMs >= bucketStart && row.timestampMs < bucketEnd);
    const executionRows = bucketRows.length;
    const noTradeRows = bucketRows.filter((row) => row.isNoTrade).length;
    const candidateRows = bucketRows.filter((row) => row.opportunityCandidate);
    const blockedCandidates = candidateRows.filter((row) => row.isNoTrade).length;
    const executedCandidates = candidateRows.filter((row) => !row.isNoTrade).length;
    points.push({
      t: Math.floor(bucketEnd / 1000),
      iso: new Date(bucketEnd).toISOString(),
      executionRows,
      noTradeRate: percent(noTradeRows, executionRows),
      routingZeroRate: percent(bucketRows.filter((row) => row.isNoTrade && row.code === "routing-score-zero").length, noTradeRows),
      fallbackRate: percent(bucketRows.filter((row) => row.isNoTrade && row.code === "fallback-mode").length, noTradeRows),
      runtimeBlockRate: percent(bucketRows.filter((row) => row.isNoTrade && row.bucket === "runtime").length, noTradeRows),
      policyBlockRate: percent(bucketRows.filter((row) => row.isNoTrade && row.bucket === "policy").length, noTradeRows),
      falsePositiveRate: percent(bucketRows.filter((row) => row.falsePositiveCandidate).length, noTradeRows),
      opportunityRate: percent(candidateRows.length, executionRows),
      missedOpportunityRate: percent(blockedCandidates, candidateRows.length),
      executionEfficiency: percent(executedCandidates, candidateRows.length),
    });
  }

  return {
    bucketHours: SERIES_BUCKET_HOURS,
    windowHours: SERIES_WINDOW_HOURS,
    points,
  };
}

function buildDeskRead(summary: RuntimeDecisionAnalyticsSummary): RuntimeDecisionAnalyticsSummary["deskRead"] {
  if (summary.semanticMismatchCandidates.count > 0) {
    return {
      tone: "warn",
      headline: "Journal truth needs cleanup",
      summary: `${summary.semanticMismatchCandidates.sharePct}% des NO_TRADE montrent une incoherence semantique.`,
      nextAction: "Stabiliser la narration runtime avant toute adaptation automatique ou auto-calibration.",
    };
  }
  if (summary.drift.detected) {
    return {
      tone: summary.drift.tone,
      headline: summary.drift.headline,
      summary: summary.drift.summary,
      nextAction: "Traiter d'abord la derive comportementale avant de conclure a un probleme de policy ou de marche.",
    };
  }
  if (summary.opportunity.candidateCount === 0) {
    return {
      tone: "subtle",
      headline: "Opportunity density is low",
      summary: "Le systeme ne voit presque aucun contexte tradable stable sur la fenetre chargee.",
      nextAction: "Ne touche pas a la policy: confirme d'abord si le marche est reellement pauvre en edge.",
    };
  }
  if (summary.opportunity.missedOpportunityRate >= 50 && (summary.dominant.bucket.label === "runtime" || summary.dominant.bucket.label === "policy")) {
    return {
      tone: "warn",
      headline: "Tradable contexts are still being blocked",
      summary: `${summary.opportunity.missedOpportunityRate}% des contextes tradables sont bloques, surtout cote ${summary.dominant.bucket.label}.`,
      nextAction: "Observer plusieurs jours, faire baisser mismatch et faux positifs, puis seulement discuter calibration.",
    };
  }
  return {
    tone: summary.falsePositiveCandidates.count > 0 ? "subtle" : "good",
    headline: "Opportunity scarcity dominates",
    summary: `Les refus viennent d'abord du marche/routing: ${summary.dominant.bucket.sharePct}% sur la fenetre chargee.`,
    nextAction: summary.falsePositiveCandidates.count > 0
      ? "Rejouer les refus en contexte stable avant toute calibration automatique."
      : "Le systeme est lisible: tu peux brancher le drift engine et l'opportunity density sans toucher a la policy.",
  };
}

export async function getRuntimeDecisionAnalytics(options?: {
  symbol?: string;
  timeframe?: string;
  strategy?: string;
  limit?: number;
  sinceDays?: number;
  samples?: number;
}): Promise<RuntimeDecisionAnalyticsSummary> {
  const symbol = String(options?.symbol || "").trim().toUpperCase();
  const timeframe = String(options?.timeframe || "").trim();
  const strategy = String(options?.strategy || "").trim();
  const limit = Math.max(1, Math.min(2_000, Math.round(Number(options?.limit || 1_200))));
  const sinceDays = Math.max(1, Math.min(90, Math.round(Number(options?.sinceDays || 7))));
  const samples = Math.max(1, Math.min(10, Math.round(Number(options?.samples || 3))));

  const entries = await readV2RiskJournalEntries({ symbol, timeframe, strategy, limit, sinceDays });
  const rows = deriveRows(entries);
  const nowMs = rows.length > 0 ? rows[rows.length - 1].timestampMs : Date.now();
  const core = summarizeRows(rows, samples);
  const drift = buildDrift(rows, nowMs);
  const series = buildSeries(rows, nowMs);
  const dominantBucket = topRow(core.byBucketRows.map((row) => ({ label: row.bucket, count: row.count, sharePct: row.sharePct })), "unknown");
  const dominantCode = topRow(core.topCodes.map((row) => ({ label: row.code, count: row.count, sharePct: row.sharePct })), "unknown");
  const dominantAttention = topRow(core.attentionRows, "unknown");
  const dominantVolatility = topRow(core.volatilityRows, "unknown");
  const topBlockedBucket = topRow(core.blockedByBucketRows.map((row) => ({ label: row.bucket, count: row.count, sharePct: row.sharePct })), "unknown");

  const opportunity = {
    candidateCount: core.candidateCount,
    blockedCount: core.blockedCount,
    executedCount: core.executedCount,
    opportunityRate: percent(core.candidateCount, core.executionRows),
    missedOpportunityRate: percent(core.blockedCount, core.candidateCount),
    executionEfficiency: percent(core.executedCount, core.candidateCount),
    blockedByBucket: core.blockedByBucketRows,
    topBlockedBucket,
    summary: core.candidateCount === 0
      ? "Aucun contexte suffisamment tradable sur la fenetre chargee: ne pas conclure trop vite a une policy trop dure."
      : core.blockedCount === 0
        ? "Les contextes tradables detectes ne sont pas bloques sur cette fenetre."
        : `${percent(core.blockedCount, core.candidateCount)}% des contextes tradables detectes restent bloques, principalement cote ${topBlockedBucket.label}.`,
  };

  const summary: RuntimeDecisionAnalyticsSummary = {
    scope: { symbol, timeframe, strategy, limit, sinceDays },
    policyVersion: EXECUTION_DECISION_POLICY_VERSION,
    totals: {
      totalRows: entries.length,
      executionRows: core.executionRows,
      noTradeRows: core.noTradeRows,
      noTradePctWithinExecution: percent(core.noTradeRows, core.executionRows),
      canonicalRows: core.canonicalRows,
      normalizedLegacyRows: core.normalizedLegacyRows,
      unclassifiedLegacyRows: core.unclassifiedLegacyRows,
      canonicalCoveragePct: percent(core.canonicalRows, core.noTradeRows),
      effectiveCanonicalCoveragePct: percent(core.canonicalRows + core.normalizedLegacyRows, core.noTradeRows),
    },
    topCodes: core.topCodes,
    byBucket: core.byBucketRows,
    byFamily: core.byFamilyRows,
    marketContext: {
      volatilityRegime: core.volatilityRows,
      attentionState: core.attentionRows,
      tripleValidationState: core.tripleValidationRows,
    },
    semanticMismatchCandidates: {
      count: core.semanticMismatchCount,
      sharePct: percent(core.semanticMismatchCount, core.noTradeRows),
      samples: core.semanticMismatchCandidates,
    },
    falsePositiveCandidates: {
      count: core.falsePositiveCount,
      sharePct: percent(core.falsePositiveCount, core.noTradeRows),
      samples: core.falsePositiveCandidates,
    },
    opportunity,
    drift,
    series,
    dominant: {
      bucket: dominantBucket,
      code: dominantCode,
      attentionState: dominantAttention,
      volatilityRegime: dominantVolatility,
    },
    deskRead: {
      tone: "good",
      headline: "Decision reading is stable",
      summary: "",
      nextAction: "",
    },
  };

  summary.deskRead = buildDeskRead(summary);
  return summary;
}