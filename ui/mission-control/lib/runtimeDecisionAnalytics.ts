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
  return {
    attentionState: String(attention.state || "unknown"),
    volatilityRegime: String(context.volatilityRegime || "unknown"),
    tripleValidationState: String(context.triple_validation_state || safeRecord(meta.triple_validation).state || "unknown"),
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

function detectSemanticMismatch(code: string, detail: string): string {
  const normalizedDetail = detail.trim().toLowerCase();
  if (!normalizedDetail) {
    return "";
  }
  if (code === "runtime-live-readiness-degraded" && (normalizedDetail.includes("healthy") || normalizedDetail.includes("failure none"))) {
    return "readiness-code-vs-detail-mismatch";
  }
  if (code === "runtime-mt5-bridge-degraded" && normalizedDetail.includes("ok")) {
    return "mt5-code-vs-detail-mismatch";
  }
  if (code === "fallback-mode" && !normalizedDetail.includes("fallback")) {
    return "fallback-code-vs-detail-mismatch";
  }
  return "";
}

function buildSample(entry: V2RiskJournalEntry, code: string, family: RuntimeDecisionFamily, bucket: RuntimeDecisionBucket): RuntimeDecisionAnalyticsSample {
  const context = extractContext(entry);
  return {
    createdAtIso: entry.createdAtIso,
    action: entry.action,
    code,
    family,
    bucket,
    attentionState: context.attentionState,
    volatilityRegime: context.volatilityRegime,
    busSeq: context.busSeq,
    depthAgeMs: context.depthAgeMs,
    detail: entry.detail,
  };
}

function toLabelRows(entries: Array<[string, number]>, total: number): Array<{ label: string; count: number; sharePct: number }> {
  return entries.map(([label, count]) => ({ label, count, sharePct: percent(count, total) }));
}

function topRow(rows: Array<{ label: string; count: number; sharePct: number }>, fallback = "unknown") {
  return rows[0] || { label: fallback, count: 0, sharePct: 0 };
}

function buildDeskRead(summary: RuntimeDecisionAnalyticsSummary): RuntimeDecisionAnalyticsSummary["deskRead"] {
  if (summary.semanticMismatchCandidates.count > 0) {
    return {
      tone: "warn",
      headline: "Journal truth needs cleanup",
      summary: `${summary.semanticMismatchCandidates.sharePct}% des NO_TRADE montrent une incoherence semantique.`,
      nextAction: "Corriger la narration runtime avant d'automatiser les ajustements.",
    };
  }
  if (summary.dominant.bucket.label === "runtime") {
    return {
      tone: "warn",
      headline: "Runtime friction dominates",
      summary: `Le runtime bloque ${summary.dominant.bucket.sharePct}% des refus sur cette fenetre.`,
      nextAction: "Inspecter readiness, recovery, fallback et bridge avant de desserrer la policy.",
    };
  }
  if (summary.dominant.bucket.label === "policy") {
    return {
      tone: "subtle",
      headline: "Policy governance dominates",
      summary: `La policy est la premiere source de NO_TRADE a ${summary.dominant.bucket.sharePct}%.`,
      nextAction: "Verifier les garde-fous explicites avant tout chantier engine ou calibration.",
    };
  }
  return {
    tone: summary.falsePositiveCandidates.count > 0 ? "subtle" : "good",
    headline: "Opportunity scarcity dominates",
    summary: `Les refus viennent d'abord du marche/routing: ${summary.dominant.bucket.sharePct}% sur la fenetre chargee.`,
    nextAction: summary.falsePositiveCandidates.count > 0
      ? "Rejouer les refus en contexte stable avant toute calibration automatique."
      : "Le systeme est lisible: tu peux brancher le drift engine sur cette base sans dette critique immediate.",
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
  const limit = Math.max(1, Math.min(500, Math.round(Number(options?.limit || 200))));
  const sinceDays = Math.max(0, Math.min(90, Math.round(Number(options?.sinceDays || 7))));
  const samples = Math.max(1, Math.min(10, Math.round(Number(options?.samples || 3))));
  const entries = await readV2RiskJournalEntries({ symbol, timeframe, strategy, limit, sinceDays });

  const byCode = new Map<string, number>();
  const byFamily = new Map<string, number>();
  const byBucket = new Map<string, number>();
  const byAttentionState = new Map<string, number>();
  const byVolatilityRegime = new Map<string, number>();
  const byTripleValidationState = new Map<string, number>();
  const semanticMismatchCandidates: RuntimeDecisionAnalyticsSample[] = [];
  const falsePositiveCandidates: RuntimeDecisionAnalyticsSample[] = [];

  let executionRows = 0;
  let noTradeRows = 0;
  let canonicalRows = 0;
  let normalizedLegacyRows = 0;
  let unclassifiedLegacyRows = 0;

  for (const entry of entries) {
    if (!isExecutionRow(entry)) {
      continue;
    }
    executionRows += 1;
    if (!isNoTradeAction(entry)) {
      continue;
    }

    noTradeRows += 1;
    const meta = safeRecord(entry.meta);
    const audit = validateExecutionDecisionAudit(meta.decision_audit);
    const code = deriveCanonicalCode(entry);
    const classification = classifyCode(code);
    const context = extractContext(entry);

    if (audit) {
      canonicalRows += 1;
    } else if (code === "legacy-unclassified") {
      unclassifiedLegacyRows += 1;
    } else {
      normalizedLegacyRows += 1;
    }

    byCode.set(code, (byCode.get(code) || 0) + 1);
    byFamily.set(classification.family, (byFamily.get(classification.family) || 0) + 1);
    byBucket.set(classification.bucket, (byBucket.get(classification.bucket) || 0) + 1);
    byAttentionState.set(context.attentionState, (byAttentionState.get(context.attentionState) || 0) + 1);
    byVolatilityRegime.set(context.volatilityRegime, (byVolatilityRegime.get(context.volatilityRegime) || 0) + 1);
    byTripleValidationState.set(context.tripleValidationState, (byTripleValidationState.get(context.tripleValidationState) || 0) + 1);

    if (detectSemanticMismatch(code, String(entry.detail || ""))) {
      semanticMismatchCandidates.push(buildSample(entry, code, classification.family, classification.bucket));
    }
    const stableEnough = context.attentionState === "stable"
      && context.busSeq > 0
      && (context.depthAgeMs == null || context.depthAgeMs <= 2_000)
      && (classification.bucket === "policy" || classification.bucket === "runtime");
    if (stableEnough) {
      falsePositiveCandidates.push(buildSample(entry, code, classification.family, classification.bucket));
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

  const summary: RuntimeDecisionAnalyticsSummary = {
    scope: { symbol, timeframe, strategy, limit, sinceDays },
    policyVersion: EXECUTION_DECISION_POLICY_VERSION,
    totals: {
      totalRows: entries.length,
      executionRows,
      noTradeRows,
      noTradePctWithinExecution: percent(noTradeRows, executionRows),
      canonicalRows,
      normalizedLegacyRows,
      unclassifiedLegacyRows,
      canonicalCoveragePct: percent(canonicalRows, noTradeRows),
      effectiveCanonicalCoveragePct: percent(canonicalRows + normalizedLegacyRows, noTradeRows),
    },
    topCodes,
    byBucket: byBucketRows,
    byFamily: byFamilyRows,
    marketContext: {
      volatilityRegime: volatilityRows,
      attentionState: attentionRows,
      tripleValidationState: tripleValidationRows,
    },
    semanticMismatchCandidates: {
      count: semanticMismatchCandidates.length,
      sharePct: percent(semanticMismatchCandidates.length, noTradeRows),
      samples: semanticMismatchCandidates.slice(0, samples),
    },
    falsePositiveCandidates: {
      count: falsePositiveCandidates.length,
      sharePct: percent(falsePositiveCandidates.length, noTradeRows),
      samples: falsePositiveCandidates.slice(0, samples),
    },
    dominant: {
      bucket: topRow(byBucketRows.map((row) => ({ label: row.bucket, count: row.count, sharePct: row.sharePct })), "unknown") as RuntimeDecisionAnalyticsSummary["dominant"]["bucket"],
      code: topRow(topCodes.map((row) => ({ label: row.code, count: row.count, sharePct: row.sharePct })), "unknown"),
      attentionState: topRow(attentionRows, "unknown"),
      volatilityRegime: topRow(volatilityRows, "unknown"),
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