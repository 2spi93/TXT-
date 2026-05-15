import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

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
    const rows = await loadAllEntries();
    const results: V2RiskJournalEntry[] = [];

    for (let index = rows.length - 1; index >= 0 && results.length < limit; index -= 1) {
      const row = rows[index];
      if (cutoffMs > 0) {
        const createdAtMs = Date.parse(String(row.createdAtIso || ""));
        if (Number.isFinite(createdAtMs) && createdAtMs < cutoffMs) {
          break;
        }
      }
      if (!matchesJournalEntry(row, { symbol, timeframe, strategy, action, cutoffMs })) {
        continue;
      }
      results.push(row);
    }

    return results;
  } catch {
    return [];
  }
}
