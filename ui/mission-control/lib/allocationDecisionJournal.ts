import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type AllocationDecisionStrategyEntry = {
  strategy_id: string;
  regime: string;
  allocated_pct: number;
  allocated_capital_usd: number;
  score: number;
  status: string;
  expected_edge_usd: number;
  expected_sharpe: number;
  expected_drawdown_pct: number;
  expected_win_rate_pct: number;
  sample_size: number;
  blocked: boolean;
  reasons: string[];
};

export type AllocationDecisionCausalityConfidence = "native" | "backfilled" | "inferred";

export type AllocationDecisionJournalEntry = {
  allocation_id: string;
  trade_lifecycle_id: string | null;
  candidate_id: string | null;
  decision_id: string | null;
  causality_confidence?: AllocationDecisionCausalityConfidence | null;
  approval_id: string | null;
  execution_id: string | null;
  outcome_id: string | null;
  portfolio_id: string;
  selected_strategy_id: string;
  allocator_version: string;
  capital_mode: string;
  evolution_mode: string;
  market_state: string;
  market_regime: string;
  market_temperature: string;
  available_capital_usd: number;
  selected_strategy_size_multiplier: number;
  truth_quality_pct: number;
  memory_cues: string[];
  strategies: AllocationDecisionStrategyEntry[];
  created_at_iso: string;
};

type AllocationDecisionJournalCache = {
  filePath: string;
  mtimeMs: number;
  size: number;
  rows: AllocationDecisionJournalEntry[];
};

let journalCache: AllocationDecisionJournalCache | null = null;

function filePath(): string {
  const journalDir = process.env.ALLOCATION_DECISION_JOURNAL_DIR || "/tmp";
  const journalFile = process.env.ALLOCATION_DECISION_JOURNAL_FILE || "mission-control-allocation-decisions.jsonl";
  return path.join(journalDir, journalFile);
}

function normalizeOptionalId(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStrategyEntry(raw: unknown): AllocationDecisionStrategyEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const payload = raw as Partial<AllocationDecisionStrategyEntry>;
  const strategyId = String(payload.strategy_id || "").trim();
  if (!strategyId) {
    return null;
  }
  return {
    strategy_id: strategyId,
    regime: String(payload.regime || "UNKNOWN").trim() || "UNKNOWN",
    allocated_pct: Number(payload.allocated_pct || 0),
    allocated_capital_usd: Number(payload.allocated_capital_usd || 0),
    score: Number(payload.score || 0),
    status: String(payload.status || "unknown").trim() || "unknown",
    expected_edge_usd: Number(payload.expected_edge_usd || 0),
    expected_sharpe: Number(payload.expected_sharpe || 0),
    expected_drawdown_pct: Number(payload.expected_drawdown_pct || 0),
    expected_win_rate_pct: Number(payload.expected_win_rate_pct || 0),
    sample_size: Number(payload.sample_size || 0),
    blocked: Boolean(payload.blocked),
    reasons: Array.isArray(payload.reasons) ? payload.reasons.map((reason) => String(reason || "").trim()).filter(Boolean).slice(0, 8) : [],
  };
}

function normalizeEntry(raw: unknown): AllocationDecisionJournalEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const payload = raw as Partial<AllocationDecisionJournalEntry>;
  const allocationId = String(payload.allocation_id || "").trim();
  const portfolioId = String(payload.portfolio_id || "").trim();
  const createdAtIso = String(payload.created_at_iso || "").trim();
  if (!allocationId || !portfolioId || !createdAtIso) {
    return null;
  }
  return {
    allocation_id: allocationId,
    trade_lifecycle_id: normalizeOptionalId(payload.trade_lifecycle_id),
    candidate_id: normalizeOptionalId(payload.candidate_id),
    decision_id: normalizeOptionalId(payload.decision_id),
    causality_confidence: normalizeOptionalId(payload.causality_confidence) as AllocationDecisionCausalityConfidence | null,
    approval_id: normalizeOptionalId(payload.approval_id),
    execution_id: normalizeOptionalId(payload.execution_id),
    outcome_id: normalizeOptionalId(payload.outcome_id),
    portfolio_id: portfolioId,
    selected_strategy_id: String(payload.selected_strategy_id || "").trim(),
    allocator_version: String(payload.allocator_version || "portfolio-allocator-v1").trim() || "portfolio-allocator-v1",
    capital_mode: String(payload.capital_mode || "unknown").trim() || "unknown",
    evolution_mode: String(payload.evolution_mode || "unknown").trim() || "unknown",
    market_state: String(payload.market_state || "UNKNOWN").trim() || "UNKNOWN",
    market_regime: String(payload.market_regime || "UNKNOWN").trim() || "UNKNOWN",
    market_temperature: String(payload.market_temperature || "UNKNOWN").trim() || "UNKNOWN",
    available_capital_usd: Number(payload.available_capital_usd || 0),
    selected_strategy_size_multiplier: Number(payload.selected_strategy_size_multiplier || 1),
    truth_quality_pct: Number(payload.truth_quality_pct || 0),
    memory_cues: Array.isArray(payload.memory_cues) ? payload.memory_cues.map((cue) => String(cue || "").trim()).filter(Boolean).slice(0, 16) : [],
    strategies: Array.isArray(payload.strategies)
      ? payload.strategies.map((entry) => normalizeStrategyEntry(entry)).filter((entry): entry is AllocationDecisionStrategyEntry => entry !== null)
      : [],
    created_at_iso: createdAtIso,
  };
}

async function loadAllEntries(): Promise<AllocationDecisionJournalEntry[]> {
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
          return normalizeEntry(JSON.parse(line) as unknown);
        } catch {
          return null;
        }
      })
      .filter((row): row is AllocationDecisionJournalEntry => row !== null);
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

export async function appendAllocationDecisionJournalEntry(entry: AllocationDecisionJournalEntry): Promise<void> {
  const target = filePath();
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(entry)}\n`, "utf-8");
  journalCache = null;
}

export async function readAllocationDecisionJournalEntries(options?: {
  portfolioId?: string;
  decisionId?: string;
  limit?: number;
  sinceDays?: number;
}): Promise<AllocationDecisionJournalEntry[]> {
  const portfolioId = String(options?.portfolioId || "").trim();
  const decisionId = String(options?.decisionId || "").trim();
  const limit = Math.max(1, Math.min(2_000, Math.round(Number(options?.limit || 100))));
  const sinceDays = Math.max(0, Math.min(365, Number(options?.sinceDays || 0)));
  const cutoffMs = sinceDays > 0 ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : 0;

  try {
    const rows = await loadAllEntries();
    const results: AllocationDecisionJournalEntry[] = [];
    for (let index = rows.length - 1; index >= 0 && results.length < limit; index -= 1) {
      const row = rows[index];
      if (cutoffMs > 0) {
        const createdAtMs = Date.parse(String(row.created_at_iso || ""));
        if (Number.isFinite(createdAtMs) && createdAtMs < cutoffMs) {
          break;
        }
      }
      if (portfolioId && row.portfolio_id !== portfolioId) continue;
      if (decisionId && row.decision_id !== decisionId) continue;
      results.push(row);
    }
    return results;
  } catch {
    return [];
  }
}