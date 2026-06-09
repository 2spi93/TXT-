import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

export type V2RiskJournalEntry = {
  id: string;
  createdAtIso: string;
  symbol: string;
  timeframe: string;
  strategy: string;
  action: string;
  detail: string;
  decisionOutcome?: "correct" | "false_positive" | "unknown";
  meta?: Record<string, unknown>;
};

type V2RiskJournalCache = {
  filePath: string;
  mtimeMs: number;
  size: number;
  rows: V2RiskJournalEntry[];
};

let journalCache: V2RiskJournalCache | null = null;

const OPERATIONAL_REFUSAL_CODES = new Set([
  "engine-v4-off",
  "fallback-mode",
  "routing-blocked",
  "routing-score-zero",
  "runtime-kill-switch-active",
]);

function normalizeDecisionCode(row: V2RiskJournalEntry): string {
  const meta = asRecord(row.meta);
  const decisionAudit = asRecord(meta.decision_audit);
  return String(decisionAudit.code || "").trim().toLowerCase() || "unknown";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isRefusalAction(action: string): boolean {
  return action === "execution-v7-blocked"
    || action === "execution-disabled-policy"
    || action === "execution-disabled-fallback"
    || action === "execution-disabled-routing";
}

export function isOpportunityEligibleRefusalEntry(row: V2RiskJournalEntry): boolean {
  const action = String(row.action || "").trim().toLowerCase();
  if (!isRefusalAction(action)) {
    return false;
  }
  if (action === "execution-v7-blocked") {
    return true;
  }
  const decisionCode = normalizeDecisionCode(row);
  return !OPERATIONAL_REFUSAL_CODES.has(decisionCode);
}

function filePath(): string {
  const journalDir = process.env.V2_RISK_JOURNAL_DIR || "/tmp";
  const journalFile = process.env.V2_RISK_JOURNAL_FILE || "mission-control-v2-risk-journal.jsonl";
  return path.join(journalDir, journalFile);
}

async function loadAllEntries(): Promise<V2RiskJournalEntry[]> {
  const target = filePath();

  try {
    const metadata = await stat(target);
    if (
      journalCache
      && journalCache.filePath === target
      && journalCache.mtimeMs === metadata.mtimeMs
      && journalCache.size === metadata.size
    ) {
      return journalCache.rows;
    }

    const content = await readFile(target, "utf-8");
    const rows = content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as V2RiskJournalEntry;
        } catch {
          return null;
        }
      })
      .filter((row): row is V2RiskJournalEntry => row !== null);

    journalCache = {
      filePath: target,
      mtimeMs: metadata.mtimeMs,
      size: metadata.size,
      rows,
    };
    return rows;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      journalCache = null;
      return [];
    }
    throw error;
  }
}

async function streamTailMatchingEntries(input: {
  symbol: string;
  timeframe: string;
  strategy: string;
  action: string;
  cutoffMs: number;
  limit: number;
}): Promise<V2RiskJournalEntry[]> {
  const target = filePath();
  try {
    const lines = readline.createInterface({
      input: createReadStream(target, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    const queue: V2RiskJournalEntry[] = [];
    for await (const line of lines) {
      if (!line) {
        continue;
      }
      try {
        const row = JSON.parse(line) as V2RiskJournalEntry;
        if (!matchesJournalEntry(row, input)) {
          continue;
        }
        queue.push(row);
        if (queue.length > input.limit) {
          queue.shift();
        }
      } catch {
        continue;
      }
    }
    return queue.reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function scanV2RiskJournalDerivedActionIds(options?: {
  sinceDays?: number;
  postProducerStartIso?: string | null;
}): Promise<{
  executionOutcomeSourceIds: Set<string>;
  refusalSourceIdsRaw: Set<string>;
  refusalSourceIdsEligible: Set<string>;
  refusalSourceIdsRawPostProducer: Set<string>;
  operationalRefusalCountsByCode: Map<string, number>;
  operationalRefusalCountsByCodePostProducer: Map<string, number>;
}> {
  const sinceDays = Math.max(0, Math.min(365, Number(options?.sinceDays || 0)));
  const cutoffMs = sinceDays > 0 ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : 0;
  const postProducerStartMs = Date.parse(String(options?.postProducerStartIso || ""));
  const hasPostProducerStart = Number.isFinite(postProducerStartMs);
  const target = filePath();
  const executionOutcomeSourceIds = new Set<string>();
  const refusalSourceIdsRaw = new Set<string>();
  const refusalSourceIdsEligible = new Set<string>();
  const refusalSourceIdsRawPostProducer = new Set<string>();
  const operationalRefusalCountsByCode = new Map<string, number>();
  const operationalRefusalCountsByCodePostProducer = new Map<string, number>();
  try {
    const lines = readline.createInterface({
      input: createReadStream(target, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line) {
        continue;
      }
      try {
        const row = JSON.parse(line) as V2RiskJournalEntry;
        const createdAtMs = Date.parse(String(row.createdAtIso || ""));
        if (cutoffMs > 0 && Number.isFinite(createdAtMs) && createdAtMs < cutoffMs) {
          continue;
        }
        const action = String(row.action || "").trim().toLowerCase();
        if (action.startsWith("execution-v7-outcome-")) {
          executionOutcomeSourceIds.add(String(row.id || "").trim());
          continue;
        }
        if (isRefusalAction(action)) {
          const sourceId = String(row.id || "").trim();
          if (!sourceId) {
            continue;
          }
          const decisionCode = normalizeDecisionCode(row);
          refusalSourceIdsRaw.add(sourceId);
          if (isOpportunityEligibleRefusalEntry(row)) {
            refusalSourceIdsEligible.add(sourceId);
          } else {
            operationalRefusalCountsByCode.set(decisionCode, (operationalRefusalCountsByCode.get(decisionCode) || 0) + 1);
          }
          if (hasPostProducerStart && createdAtMs >= postProducerStartMs) {
            refusalSourceIdsRawPostProducer.add(sourceId);
            if (!isOpportunityEligibleRefusalEntry(row)) {
              operationalRefusalCountsByCodePostProducer.set(decisionCode, (operationalRefusalCountsByCodePostProducer.get(decisionCode) || 0) + 1);
            }
          }
        }
      } catch {
        continue;
      }
    }
    return {
      executionOutcomeSourceIds,
      refusalSourceIdsRaw,
      refusalSourceIdsEligible,
      refusalSourceIdsRawPostProducer,
      operationalRefusalCountsByCode,
      operationalRefusalCountsByCodePostProducer,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        executionOutcomeSourceIds,
        refusalSourceIdsRaw,
        refusalSourceIdsEligible,
        refusalSourceIdsRawPostProducer,
        operationalRefusalCountsByCode,
        operationalRefusalCountsByCodePostProducer,
      };
    }
    return {
      executionOutcomeSourceIds,
      refusalSourceIdsRaw,
      refusalSourceIdsEligible,
      refusalSourceIdsRawPostProducer,
      operationalRefusalCountsByCode,
      operationalRefusalCountsByCodePostProducer,
    };
  }
}

function matchesJournalEntry(
  row: V2RiskJournalEntry,
  input: {
    symbol: string;
    timeframe: string;
    strategy: string;
    action: string;
    cutoffMs: number;
  },
): boolean {
  if (input.symbol && String(row.symbol || "").toUpperCase() !== input.symbol) return false;
  if (input.timeframe && String(row.timeframe || "") !== input.timeframe) return false;
  if (input.strategy && String(row.strategy || "").toLowerCase() !== input.strategy) return false;
  if (input.action && String(row.action || "").toLowerCase() !== input.action) return false;
  if (input.cutoffMs > 0) {
    const createdAtMs = Date.parse(String(row.createdAtIso || ""));
    if (Number.isFinite(createdAtMs) && createdAtMs < input.cutoffMs) return false;
  }
  return true;
}

export async function appendV2RiskJournalEntry(entry: V2RiskJournalEntry): Promise<void> {
  const target = filePath();
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(entry)}\n`, "utf-8");
  journalCache = null;
}

export async function readV2RiskJournalEntries(options?: {
  symbol?: string;
  timeframe?: string;
  strategy?: string;
  limit?: number;
  sinceDays?: number;
  action?: string;
}): Promise<V2RiskJournalEntry[]> {
  const symbol = String(options?.symbol || "").trim().toUpperCase();
  const timeframe = String(options?.timeframe || "").trim();
  const strategy = String(options?.strategy || "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(2_000, Math.round(Number(options?.limit || 40))));
  const sinceDays = Math.max(0, Math.min(90, Number(options?.sinceDays || 0)));
  const action = String(options?.action || "").trim().toLowerCase();
  const cutoffMs = sinceDays > 0 ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : 0;

  try {
    return await streamTailMatchingEntries({ symbol, timeframe, strategy, action, cutoffMs, limit });
  } catch {
    return [];
  }
}
