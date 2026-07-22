import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type ExecutionFactDecisionOutcome = "correct" | "false_positive" | "unknown" | null;
export type ExecutionFactAttributionStatus = "pending" | "partial" | "computed";
export type ExecutionFactCausalityConfidence = "native" | "backfilled" | "inferred";

export type ExecutionFactAttribution = {
  status: ExecutionFactAttributionStatus;
  pnl_usd: number | null;
  regime_contribution_usd: number | null;
  allocation_contribution_usd: number | null;
  signal_contribution_usd: number | null;
  execution_contribution_usd: number | null;
  timing_contribution_usd: number | null;
  spread_contribution_usd: number | null;
  slippage_contribution_usd: number | null;
  allocation_alpha_bps: number | null;
  signal_alpha_bps: number | null;
  timing_alpha_bps: number | null;
  execution_alpha_bps: number | null;
  spread_cost_bps: number | null;
  slippage_cost_bps: number | null;
  alpha_confidence: number | null;
  sample_size: number | null;
  attribution_version: string | null;
  notes: string[];
};

export type ExecutionFactJournalEntry = {
  fact_id: string;
  trade_lifecycle_id: string | null;
  candidate_id: string | null;
  decision_id: string;
  causality_confidence?: ExecutionFactCausalityConfidence | null;
  approval_id: string | null;
  execution_id: string | null;
  outcome_id: string | null;
  intent_id: string;
  order_id: string | null;
  portfolio_id: string;
  strategy_id: string;
  venue: string;
  instrument: string;
  timeframe: string;
  side: string;
  execution_mode: string;
  approval_level: string;
  approval_timestamp: string | null;
  regime_at_decision: string;
  regime_at_fill: string | null;
  decision_outcome: ExecutionFactDecisionOutcome;
  target_notional_usd: number | null;
  filled_notional_usd: number | null;
  avg_fill_price: number | null;
  determinism: Record<string, unknown>;
  alpha_attribution: ExecutionFactAttribution;
  market_context: Record<string, unknown>;
  approval_context: Record<string, unknown>;
  created_at_iso: string;
  filled_at_iso: string | null;
};

type ExecutionFactJournalCache = {
  filePath: string;
  mtimeMs: number;
  size: number;
  rows: ExecutionFactJournalEntry[];
};

let journalCache: ExecutionFactJournalCache | null = null;

function filePath(): string {
  const journalDir = process.env.EXECUTION_FACT_JOURNAL_DIR || "/tmp";
  const journalFile = process.env.EXECUTION_FACT_JOURNAL_FILE || "mission-control-execution-facts.jsonl";
  return path.join(journalDir, journalFile);
}

function normalizeDecisionOutcome(value: unknown): ExecutionFactDecisionOutcome {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "correct" || normalized === "false_positive" || normalized === "unknown") {
    return normalized;
  }
  return null;
}

function normalizeAttributionStatus(value: unknown): ExecutionFactAttributionStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "partial" || normalized === "computed") {
    return normalized;
  }
  return "pending";
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeOptionalId(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeEntry(raw: unknown): ExecutionFactJournalEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const payload = raw as Partial<ExecutionFactJournalEntry>;
  const factId = String(payload.fact_id || "").trim();
  const decisionId = String(payload.decision_id || "").trim();
  const intentId = String(payload.intent_id || "").trim();
  const portfolioId = String(payload.portfolio_id || "").trim();
  const strategyId = String(payload.strategy_id || "").trim();
  const venue = String(payload.venue || "").trim();
  const instrument = String(payload.instrument || "").trim().toUpperCase();
  const timeframe = String(payload.timeframe || "").trim();
  const side = String(payload.side || "").trim();
  const createdAtIso = String(payload.created_at_iso || "").trim();
  if (!factId || !decisionId || !intentId || !portfolioId || !strategyId || !venue || !instrument || !timeframe || !side || !createdAtIso) {
    return null;
  }
  const attributionRaw = payload.alpha_attribution && typeof payload.alpha_attribution === "object"
    ? payload.alpha_attribution as Partial<ExecutionFactAttribution>
    : {};
  return {
    fact_id: factId,
    trade_lifecycle_id: normalizeOptionalId(payload.trade_lifecycle_id),
    candidate_id: normalizeOptionalId(payload.candidate_id),
    decision_id: decisionId,
    causality_confidence: normalizeOptionalId(payload.causality_confidence) as ExecutionFactCausalityConfidence | null,
    approval_id: normalizeOptionalId(payload.approval_id),
    execution_id: normalizeOptionalId(payload.execution_id) ?? (typeof payload.order_id === "string" && payload.order_id.trim().length > 0 ? payload.order_id.trim() : null),
    outcome_id: normalizeOptionalId(payload.outcome_id),
    intent_id: intentId,
    order_id: typeof payload.order_id === "string" && payload.order_id.trim().length > 0 ? payload.order_id.trim() : null,
    portfolio_id: portfolioId,
    strategy_id: strategyId,
    venue,
    instrument,
    timeframe,
    side,
    execution_mode: String(payload.execution_mode || "paper").trim() || "paper",
    approval_level: String(payload.approval_level || "none").trim() || "none",
    approval_timestamp: typeof payload.approval_timestamp === "string" && payload.approval_timestamp.trim().length > 0 ? payload.approval_timestamp.trim() : null,
    regime_at_decision: String(payload.regime_at_decision || "UNKNOWN").trim() || "UNKNOWN",
    regime_at_fill: typeof payload.regime_at_fill === "string" && payload.regime_at_fill.trim().length > 0 ? payload.regime_at_fill.trim() : null,
    decision_outcome: normalizeDecisionOutcome(payload.decision_outcome),
    target_notional_usd: toNumberOrNull(payload.target_notional_usd),
    filled_notional_usd: toNumberOrNull(payload.filled_notional_usd),
    avg_fill_price: toNumberOrNull(payload.avg_fill_price),
    determinism: payload.determinism && typeof payload.determinism === "object" && !Array.isArray(payload.determinism)
      ? payload.determinism as Record<string, unknown>
      : {},
    alpha_attribution: {
      status: normalizeAttributionStatus(attributionRaw.status),
      pnl_usd: toNumberOrNull(attributionRaw.pnl_usd),
      regime_contribution_usd: toNumberOrNull(attributionRaw.regime_contribution_usd),
      allocation_contribution_usd: toNumberOrNull(attributionRaw.allocation_contribution_usd) ?? toNumberOrNull(attributionRaw.regime_contribution_usd),
      signal_contribution_usd: toNumberOrNull(attributionRaw.signal_contribution_usd),
      execution_contribution_usd: toNumberOrNull(attributionRaw.execution_contribution_usd),
      timing_contribution_usd: toNumberOrNull(attributionRaw.timing_contribution_usd),
      spread_contribution_usd: toNumberOrNull(attributionRaw.spread_contribution_usd),
      slippage_contribution_usd: toNumberOrNull(attributionRaw.slippage_contribution_usd),
      allocation_alpha_bps: toNumberOrNull(attributionRaw.allocation_alpha_bps),
      signal_alpha_bps: toNumberOrNull(attributionRaw.signal_alpha_bps),
      timing_alpha_bps: toNumberOrNull(attributionRaw.timing_alpha_bps),
      execution_alpha_bps: toNumberOrNull(attributionRaw.execution_alpha_bps),
      spread_cost_bps: toNumberOrNull(attributionRaw.spread_cost_bps),
      slippage_cost_bps: toNumberOrNull(attributionRaw.slippage_cost_bps),
      alpha_confidence: toNumberOrNull(attributionRaw.alpha_confidence),
      sample_size: toNumberOrNull(attributionRaw.sample_size),
      attribution_version: typeof attributionRaw.attribution_version === "string" && attributionRaw.attribution_version.trim().length > 0
        ? attributionRaw.attribution_version.trim()
        : null,
      notes: Array.isArray(attributionRaw.notes) ? attributionRaw.notes.map((note) => String(note || "").trim()).filter(Boolean).slice(0, 12) : [],
    },
    market_context: payload.market_context && typeof payload.market_context === "object" && !Array.isArray(payload.market_context)
      ? payload.market_context as Record<string, unknown>
      : {},
    approval_context: payload.approval_context && typeof payload.approval_context === "object" && !Array.isArray(payload.approval_context)
      ? payload.approval_context as Record<string, unknown>
      : {},
    created_at_iso: createdAtIso,
    filled_at_iso: typeof payload.filled_at_iso === "string" && payload.filled_at_iso.trim().length > 0 ? payload.filled_at_iso.trim() : null,
  };
}

async function loadAllEntries(): Promise<ExecutionFactJournalEntry[]> {
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
      .filter((row): row is ExecutionFactJournalEntry => row !== null);
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

export async function appendExecutionFactJournalEntry(entry: ExecutionFactJournalEntry): Promise<void> {
  const target = filePath();
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(entry)}\n`, "utf-8");
  journalCache = null;
}

export async function readExecutionFactJournalEntries(options?: {
  symbol?: string;
  strategyId?: string;
  portfolioId?: string;
  decisionId?: string;
  outcome?: ExecutionFactDecisionOutcome;
  limit?: number;
  sinceDays?: number;
}): Promise<ExecutionFactJournalEntry[]> {
  const symbol = String(options?.symbol || "").trim().toUpperCase();
  const strategyId = String(options?.strategyId || "").trim();
  const portfolioId = String(options?.portfolioId || "").trim();
  const decisionId = String(options?.decisionId || "").trim();
  const outcome = normalizeDecisionOutcome(options?.outcome);
  const limit = Math.max(1, Math.min(2_000, Math.round(Number(options?.limit || 100))));
  const sinceDays = Math.max(0, Math.min(365, Number(options?.sinceDays || 0)));
  const cutoffMs = sinceDays > 0 ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : 0;

  try {
    const rows = await loadAllEntries();
    const results: ExecutionFactJournalEntry[] = [];
    const seenFactIds = new Set<string>();
    for (let index = rows.length - 1; index >= 0 && results.length < limit; index -= 1) {
      const row = rows[index];
      if (seenFactIds.has(row.fact_id)) {
        continue;
      }
      seenFactIds.add(row.fact_id);
      if (cutoffMs > 0) {
        const createdAtMs = Date.parse(String(row.created_at_iso || ""));
        if (Number.isFinite(createdAtMs) && createdAtMs < cutoffMs) {
          continue;
        }
      }
      if (symbol && row.instrument !== symbol) continue;
      if (strategyId && row.strategy_id !== strategyId) continue;
      if (portfolioId && row.portfolio_id !== portfolioId) continue;
      if (decisionId && row.decision_id !== decisionId) continue;
      if (outcome && row.decision_outcome !== outcome) continue;
      results.push(row);
    }
    return results;
  } catch {
    return [];
  }
}