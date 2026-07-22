const fs = require("fs");
const readline = require("readline");

const DEFAULT_FILE = "/tmp/mission-control-v2-risk-journal.jsonl";
const POLICY_VERSION = "2026-04-phase-1.5";

const DECISION_DEFINITIONS = {
  "runtime-kill-switch-active": { severity: "critical", source: "system-runtime-guard", priority: 100 },
  "runtime-external-kill-switch-active": { severity: "critical", source: "system-runtime-guard", priority: 95 },
  "runtime-watchdog-halt": { severity: "critical", source: "system-runtime-guard", priority: 92 },
  "runtime-recovery-lockdown": { severity: "critical", source: "system-runtime-guard", priority: 90 },
  "runtime-live-readiness-degraded": { severity: "critical", source: "system-runtime-guard", priority: 88 },
  "runtime-mt5-bridge-degraded": { severity: "critical", source: "system-runtime-guard", priority: 86 },
  "engine-v4-off": { severity: "critical", source: "execution-policy-engine", priority: 84 },
  "fallback-mode": { severity: "critical", source: "routing-guard", priority: 80 },
  "routing-score-zero": { severity: "warn", source: "routing-guard", priority: 74 },
  "routing-blocked": { severity: "warn", source: "routing-guard", priority: 70 },
  "execution-v7-blocked": { severity: "warn", source: "execution-policy-engine", priority: 64 },
  "execution-v7-outcome-positive": { severity: "info", source: "execution-feedback", priority: 30 },
  "execution-v7-outcome-neutral": { severity: "info", source: "execution-feedback", priority: 26 },
  "execution-v7-outcome-negative": { severity: "warn", source: "execution-feedback", priority: 34 },
};

function safeRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function percent(part, total) {
  return total > 0 ? Number(((part / total) * 100).toFixed(2)) : 0;
}

function bump(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function sortedEntries(map) {
  return Object.entries(map).sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])));
}

function normalizeExecutionOutcomeCode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (/(good|positive|profit|win|clean|ok|success)/.test(normalized)) {
    return "execution-v7-outcome-positive";
  }
  if (/(bad|negative|loss|fail|blocked|reject|degraded|warn)/.test(normalized)) {
    return "execution-v7-outcome-negative";
  }
  return "execution-v7-outcome-neutral";
}

function normalizeLockCode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  switch (normalized) {
    case "kill-switch-active":
      return "runtime-kill-switch-active";
    case "external-kill-switch-active":
      return "runtime-external-kill-switch-active";
    case "watchdog-halt":
      return "runtime-watchdog-halt";
    case "recovery-lockdown":
      return "runtime-recovery-lockdown";
    case "live-readiness-degraded":
      return "runtime-live-readiness-degraded";
    case "mt5-bridge-degraded":
      return "runtime-mt5-bridge-degraded";
    case "engine-v4-off":
      return "engine-v4-off";
    case "fallback-mode":
      return "fallback-mode";
    case "routing-score-zero":
      return "routing-score-zero";
    case "routing-blocked":
      return "routing-blocked";
    default:
      return "";
  }
}

function deriveCanonicalCode(entry) {
  const meta = safeRecord(entry.meta);
  const audit = safeRecord(meta.decision_audit);
  if (String(audit.code || "").trim()) {
    return String(audit.code).trim();
  }

  const action = String(entry.action || "").trim().toLowerCase();
  const detail = String(entry.detail || "").trim().toLowerCase();
  const lockCode = normalizeLockCode(safeRecord(meta.execution_lock).code);

  if (action === "execution-v7-blocked") {
    return "execution-v7-blocked";
  }
  if (action.startsWith("execution-v7-outcome-")) {
    return normalizeExecutionOutcomeCode(action.slice("execution-v7-outcome-".length));
  }
  if (action === "execution-disabled-policy") {
    return "engine-v4-off";
  }
  if (action === "execution-disabled-fallback") {
    return "fallback-mode";
  }
  if (action === "execution-disabled-routing") {
    if (lockCode) {
      return lockCode;
    }
    if (detail.includes("routing score 0")) {
      return "routing-score-zero";
    }
    if (detail.includes("routing remains blocked")) {
      return "routing-blocked";
    }
    if (detail.includes("recovery") && detail.includes("actif")) {
      return "runtime-recovery-lockdown";
    }
    if (detail.includes("watchdog halt")) {
      return "runtime-watchdog-halt";
    }
    if (detail.includes("readiness degraded") || detail.includes("live readiness")) {
      return "runtime-live-readiness-degraded";
    }
    if (detail.includes("mt5 bridge")) {
      return "runtime-mt5-bridge-degraded";
    }
  }
  return "legacy-unclassified";
}

function classifyCode(code) {
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
      if (String(code).includes("confidence")) {
        return { family: "confidence", bucket: "confidence" };
      }
      if (/(broker|mt5|bridge)/i.test(String(code))) {
        return { family: "broker", bucket: "broker" };
      }
      return { family: "unknown", bucket: "unknown" };
  }
}

function extractMarketContext(entry) {
  const meta = safeRecord(entry.meta);
  const attention = safeRecord(meta.attention_context);
  const context = safeRecord(attention.context);
  const sync = safeRecord(meta.sync_diagnostics);
  return {
    attentionState: String(attention.state || "unknown"),
    volatilityRegime: String(context.volatilityRegime || "unknown"),
    tripleValidationState: String(context.triple_validation_state || safeRecord(meta.triple_validation).state || "unknown"),
    busSeq: Math.max(0, Math.round(toNumber(sync.bus_seq, 0))),
    depthAgeMs: sync.depth_age_ms == null ? null : Math.max(0, Math.round(toNumber(sync.depth_age_ms, 0))),
    shouldBlockTrading: Boolean(attention.shouldBlockTrading || attention.should_block_trading),
  };
}

function isExecutionRow(entry) {
  return /^execution-/.test(String(entry.action || "").trim().toLowerCase());
}

function isNoTradeAction(entry) {
  const action = String(entry.action || "").trim().toLowerCase();
  return action.includes("disabled") || action.includes("blocked");
}

function buildSample(entry, derivedCode, classification, marketContext) {
  return {
    createdAtIso: entry.createdAtIso,
    action: entry.action,
    code: derivedCode,
    family: classification.family,
    bucket: classification.bucket,
    attentionState: marketContext.attentionState,
    volatilityRegime: marketContext.volatilityRegime,
    busSeq: marketContext.busSeq,
    depthAgeMs: marketContext.depthAgeMs,
    detail: entry.detail,
  };
}

function detectSemanticMismatch(code, detail) {
  const normalizedDetail = String(detail || "").trim().toLowerCase();
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

function buildDecisionSummary(entry, code) {
  const meta = safeRecord(entry.meta);
  const executionLock = safeRecord(meta.execution_lock);
  if (String(executionLock.summaryLabel || "").trim()) {
    return String(executionLock.summaryLabel).trim();
  }
  if (code === "execution-v7-blocked") {
    return String(entry.detail || "Execution V7 blocked").trim();
  }
  return String(entry.detail || code).trim();
}

function buildDecisionAudit(code, summary) {
  const definition = DECISION_DEFINITIONS[code];
  if (!definition) {
    return null;
  }
  return {
    code,
    severity: definition.severity,
    source: definition.source,
    priority: definition.priority,
    policyVersion: POLICY_VERSION,
    summary: String(summary || "").trim(),
  };
}

async function analyzeRuntimeLog(options = {}) {
  const file = options.file || DEFAULT_FILE;
  const samples = Number.isFinite(Number(options.samples)) && Number(options.samples) > 0 ? Math.round(Number(options.samples)) : 5;

  if (!fs.existsSync(file)) {
    const error = new Error(`Runtime journal not found: ${file}`);
    error.code = "ENOENT";
    throw error;
  }

  const summary = {
    totalRows: 0,
    executionRows: 0,
    noTradeRows: 0,
    canonicalRows: 0,
    normalizedLegacyRows: 0,
    unclassifiedLegacyRows: 0,
    byAction: {},
    byCode: {},
    byFamily: {},
    byBucket: {},
    byVolatilityRegime: {},
    byAttentionState: {},
    byTripleValidationState: {},
    falsePositiveCandidates: [],
    semanticMismatchCandidates: [],
  };

  const reader = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    if (!line.trim()) {
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    summary.totalRows += 1;
    if (!isExecutionRow(entry)) {
      continue;
    }
    summary.executionRows += 1;
    bump(summary.byAction, String(entry.action || "unknown"));

    if (!isNoTradeAction(entry)) {
      continue;
    }
    summary.noTradeRows += 1;

    const meta = safeRecord(entry.meta);
    const hasCanonicalAudit = Boolean(String(safeRecord(meta.decision_audit).code || "").trim());
    if (hasCanonicalAudit) {
      summary.canonicalRows += 1;
    }

    const code = deriveCanonicalCode(entry);
    if (!hasCanonicalAudit) {
      if (code === "legacy-unclassified") {
        summary.unclassifiedLegacyRows += 1;
      } else {
        summary.normalizedLegacyRows += 1;
      }
    }

    const classification = classifyCode(code);
    const marketContext = extractMarketContext(entry);

    bump(summary.byCode, code);
    bump(summary.byFamily, classification.family);
    bump(summary.byBucket, classification.bucket);
    bump(summary.byVolatilityRegime, marketContext.volatilityRegime);
    bump(summary.byAttentionState, marketContext.attentionState);
    bump(summary.byTripleValidationState, marketContext.tripleValidationState);

    const semanticMismatch = detectSemanticMismatch(code, entry.detail);
    if (semanticMismatch) {
      summary.semanticMismatchCandidates.push({
        mismatch: semanticMismatch,
        ...buildSample(entry, code, classification, marketContext),
      });
    }

    const potentialFalsePositive = marketContext.attentionState === "stable"
      && marketContext.busSeq > 0
      && (marketContext.depthAgeMs == null || marketContext.depthAgeMs <= 2_000)
      && (classification.bucket === "policy" || classification.bucket === "runtime");
    if (potentialFalsePositive) {
      summary.falsePositiveCandidates.push(buildSample(entry, code, classification, marketContext));
    }
  }

  const topCodes = sortedEntries(summary.byCode).map(([code, count]) => {
    const classification = classifyCode(code);
    return {
      code,
      family: classification.family,
      bucket: classification.bucket,
      count,
      sharePct: percent(count, summary.noTradeRows),
    };
  });

  return {
    file,
    totals: {
      totalRows: summary.totalRows,
      executionRows: summary.executionRows,
      noTradeRows: summary.noTradeRows,
      noTradePctWithinExecution: percent(summary.noTradeRows, summary.executionRows),
      canonicalRows: summary.canonicalRows,
      normalizedLegacyRows: summary.normalizedLegacyRows,
      unclassifiedLegacyRows: summary.unclassifiedLegacyRows,
      canonicalCoveragePct: percent(summary.canonicalRows, summary.noTradeRows),
      effectiveCanonicalCoveragePct: percent(summary.canonicalRows + summary.normalizedLegacyRows, summary.noTradeRows),
    },
    topActions: sortedEntries(summary.byAction),
    topCodes,
    byFamily: sortedEntries(summary.byFamily),
    byBucket: sortedEntries(summary.byBucket),
    marketContext: {
      volatilityRegime: sortedEntries(summary.byVolatilityRegime),
      attentionState: sortedEntries(summary.byAttentionState),
      tripleValidationState: sortedEntries(summary.byTripleValidationState),
    },
    semanticMismatchCandidates: {
      count: summary.semanticMismatchCandidates.length,
      sharePct: percent(summary.semanticMismatchCandidates.length, summary.noTradeRows),
      samples: summary.semanticMismatchCandidates.slice(0, samples),
    },
    falsePositiveCandidates: {
      count: summary.falsePositiveCandidates.length,
      sharePct: percent(summary.falsePositiveCandidates.length, summary.noTradeRows),
      samples: summary.falsePositiveCandidates.slice(0, samples),
    },
  };
}

module.exports = {
  DECISION_DEFINITIONS,
  DEFAULT_FILE,
  POLICY_VERSION,
  analyzeRuntimeLog,
  buildDecisionAudit,
  buildDecisionSummary,
  classifyCode,
  deriveCanonicalCode,
  isExecutionRow,
  percent,
  safeRecord,
  sortedEntries,
};