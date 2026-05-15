import { SelfLearningSchedulerController, type ShadowSchedulerSnapshot } from "./selfLearningScheduler";
import type { RuntimeDecisionObservationStatus } from "./runtimeDecisionAnalytics";
import { getRuntimeDecisionAnalytics } from "./runtimeDecisionAnalytics";
import { appendRuntimeDecisionKpiSnapshot, createRuntimeDecisionKpiSnapshot } from "./runtimeDecisionKpiStore";
import { readV2RiskJournalEntries } from "./v2RiskJournal";

if (typeof window !== "undefined") {
  throw new Error("runtimeDecisionWriter is server-only");
}

export type RuntimeDecisionWriterScope = {
  symbol?: string;
  timeframe?: string;
  strategy?: string;
  limit?: number;
  sinceDays?: number;
  samples?: number;
};

export type RuntimeDecisionWriterScopeResult = {
  scope: {
    symbol: string;
    timeframe: string;
    strategy: string;
    limit: number;
    sinceDays: number;
    samples: number;
  };
  persisted: boolean;
  skipped: boolean;
  error: string | null;
  totalRows: number;
  noTradeRows: number;
  observationStatus: RuntimeDecisionObservationStatus;
};

export type RuntimeDecisionWriterCycleResult = {
  startedAtIso: string;
  finishedAtIso: string;
  persistedCount: number;
  skippedCount: number;
  errorCount: number;
  scopeResults: RuntimeDecisionWriterScopeResult[];
};

type RuntimeDecisionWriterGlobal = typeof globalThis & {
  __runtimeDecisionWriterController__?: SelfLearningSchedulerController;
  __runtimeDecisionWriterStarted__?: boolean;
};

const runtimeDecisionWriterGlobal = globalThis as RuntimeDecisionWriterGlobal;
const runtimeDecisionWriterController = runtimeDecisionWriterGlobal.__runtimeDecisionWriterController__
  || new SelfLearningSchedulerController();

runtimeDecisionWriterGlobal.__runtimeDecisionWriterController__ = runtimeDecisionWriterController;

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "off" && normalized !== "no";
}

function clampInt(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function runtimeDecisionWriterEnabled(): boolean {
  return parseBooleanEnv(process.env.RUNTIME_DECISION_WRITER_ENABLED, process.env.NODE_ENV === "production");
}

function runtimeDecisionWriterIntervalMs(): number {
  return clampInt(Number(process.env.RUNTIME_DECISION_WRITER_INTERVAL_MS || 60_000), 60_000, 60 * 60 * 1000);
}

function runtimeDecisionWriterMaxScopes(): number {
  return clampInt(Number(process.env.RUNTIME_DECISION_WRITER_MAX_SCOPES || 4), 1, 12);
}

function normalizeRuntimeDecisionWriterScope(scope?: RuntimeDecisionWriterScope): RuntimeDecisionWriterScopeResult["scope"] {
  return {
    symbol: String(scope?.symbol || "").trim().toUpperCase(),
    timeframe: String(scope?.timeframe || "").trim(),
    strategy: String(scope?.strategy || "").trim(),
    limit: clampInt(Number(scope?.limit || 1_200), 1, 2_000),
    sinceDays: clampInt(Number(scope?.sinceDays || 7), 1, 90),
    samples: clampInt(Number(scope?.samples || 3), 1, 10),
  };
}

function buildRuntimeDecisionScopeKey(scope: RuntimeDecisionWriterScopeResult["scope"]): string {
  return [scope.symbol || "ALL", scope.timeframe || "ALL", scope.strategy || "ALL"].join("|");
}

function uniqueRuntimeDecisionScopes(scopes: RuntimeDecisionWriterScope[]): RuntimeDecisionWriterScopeResult["scope"][] {
  const seen = new Set<string>();
  const results: RuntimeDecisionWriterScopeResult["scope"][] = [];

  for (const scope of scopes) {
    const normalized = normalizeRuntimeDecisionWriterScope(scope);
    const key = buildRuntimeDecisionScopeKey(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(normalized);
  }

  return results;
}

async function discoverRuntimeDecisionWriterScopes(): Promise<RuntimeDecisionWriterScopeResult["scope"][]> {
  const scopes: RuntimeDecisionWriterScope[] = [{}];
  const recentEntries = await readV2RiskJournalEntries({
    sinceDays: 7,
    limit: Math.max(120, runtimeDecisionWriterMaxScopes() * 40),
  });

  for (const entry of recentEntries) {
    scopes.push({
      symbol: entry.symbol,
      timeframe: entry.timeframe,
      strategy: entry.strategy,
    });
    if (scopes.length > runtimeDecisionWriterMaxScopes()) {
      break;
    }
  }

  return uniqueRuntimeDecisionScopes(scopes);
}

export async function persistRuntimeDecisionWriterScope(scope?: RuntimeDecisionWriterScope): Promise<RuntimeDecisionWriterScopeResult> {
  const normalized = normalizeRuntimeDecisionWriterScope(scope);

  try {
    const summary = await getRuntimeDecisionAnalytics(normalized);
    const journalEntries = await readV2RiskJournalEntries({
      symbol: normalized.symbol,
      timeframe: normalized.timeframe,
      strategy: normalized.strategy,
      limit: normalized.limit,
      sinceDays: normalized.sinceDays,
    });
    const latestDecisionOutcome = journalEntries.find((entry) => entry.decisionOutcome)?.decisionOutcome || null;
    const snapshot = createRuntimeDecisionKpiSnapshot(summary, latestDecisionOutcome);
    const persisted = await appendRuntimeDecisionKpiSnapshot(snapshot);

    return {
      scope: normalized,
      persisted,
      skipped: !persisted,
      error: null,
      totalRows: summary.totals.totalRows,
      noTradeRows: summary.totals.noTradeRows,
      observationStatus: summary.observation.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "runtime_decision_writer_failed";
    console.error(`[runtime-decision:writer_scope_failed] ${JSON.stringify({ ...normalized, error: message })}`);
    return {
      scope: normalized,
      persisted: false,
      skipped: false,
      error: message,
      totalRows: 0,
      noTradeRows: 0,
      observationStatus: "INSUFFICIENT",
    };
  }
}

export async function runRuntimeDecisionWriterCycle(scopes?: RuntimeDecisionWriterScope[]): Promise<RuntimeDecisionWriterCycleResult> {
  const startedAtIso = new Date().toISOString();
  const targetScopes = scopes && scopes.length > 0
    ? uniqueRuntimeDecisionScopes(scopes)
    : await discoverRuntimeDecisionWriterScopes();
  const scopeResults: RuntimeDecisionWriterScopeResult[] = [];

  for (const scope of targetScopes) {
    scopeResults.push(await persistRuntimeDecisionWriterScope(scope));
  }

  return {
    startedAtIso,
    finishedAtIso: new Date().toISOString(),
    persistedCount: scopeResults.filter((result) => result.persisted).length,
    skippedCount: scopeResults.filter((result) => result.skipped).length,
    errorCount: scopeResults.filter((result) => Boolean(result.error)).length,
    scopeResults,
  };
}

export function getRuntimeDecisionWriterSnapshot(): ShadowSchedulerSnapshot {
  return runtimeDecisionWriterController.getSnapshot();
}

export function ensureRuntimeDecisionWriterStarted(): ShadowSchedulerSnapshot {
  if (!runtimeDecisionWriterEnabled()) {
    return runtimeDecisionWriterController.getSnapshot();
  }

  if (runtimeDecisionWriterGlobal.__runtimeDecisionWriterStarted__) {
    return runtimeDecisionWriterController.getSnapshot();
  }

  runtimeDecisionWriterGlobal.__runtimeDecisionWriterStarted__ = true;
  runtimeDecisionWriterController.start(runtimeDecisionWriterIntervalMs(), async () => {
    const result = await runRuntimeDecisionWriterCycle();
    if (result.errorCount > 0) {
      console.error(`[runtime-decision:writer_cycle_errors] ${JSON.stringify({ errorCount: result.errorCount })}`);
    }
  });
  void runtimeDecisionWriterController.triggerNow(async () => {
    const result = await runRuntimeDecisionWriterCycle();
    if (result.errorCount > 0) {
      console.error(`[runtime-decision:writer_bootstrap_errors] ${JSON.stringify({ errorCount: result.errorCount })}`);
    }
  }).catch((error) => {
    const message = error instanceof Error ? error.message : "runtime_decision_writer_bootstrap_failed";
    console.error(`[runtime-decision:writer_bootstrap_failed] ${message}`);
  });

  return runtimeDecisionWriterController.getSnapshot();
}