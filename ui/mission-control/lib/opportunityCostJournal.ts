import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type OpportunityDecisionType = "executed" | "refused" | "ignored" | "missed";
export type OpportunityCostStatus = "pending" | "scored";

export type OpportunityCostAttribution = {
  status: "pending" | "computed";
  gate_reason: string | null;
  expected_alpha_bps: number | null;
  realized_move_bps: number | null;
  missed_alpha_bps: number | null;
  saved_loss_bps: number | null;
  counterfactual_confidence: number | null;
  matching_quality: number | null;
  followup_delay_minutes: number | null;
  notes: string[];
};

export type OpportunityCostJournalEntry = {
  entry_id: string;
  trade_lifecycle_id: string | null;
  candidate_id: string | null;
  decision_id: string | null;
  approval_id: string | null;
  execution_id: string | null;
  outcome_id: string | null;
  intent_id: string | null;
  portfolio_id: string | null;
  strategy_id: string | null;
  venue: string;
  instrument: string;
  timeframe: string;
  side: string;
  regime: string;
  decision_type: OpportunityDecisionType;
  refusal_reason: string | null;
  gate_name: string | null;
  predicted_alpha_bps: number | null;
  ex_post_market_move_bps: number | null;
  ex_post_opportunity_cost_bps: number | null;
  captured_price: number | null;
  horizon_minutes: number;
  opportunity_attribution: OpportunityCostAttribution;
  market_context: Record<string, unknown>;
  approval_context: Record<string, unknown>;
  status: OpportunityCostStatus;
  created_at_iso: string;
  scored_at_iso: string | null;
};

type OpportunityCostJournalCache = {
  filePath: string;
  mtimeMs: number;
  size: number;
  rows: OpportunityCostJournalEntry[];
};

let journalCache: OpportunityCostJournalCache | null = null;

function filePath(): string {
  const journalDir = process.env.OPPORTUNITY_COST_JOURNAL_DIR || "/tmp";
  const journalFile = process.env.OPPORTUNITY_COST_JOURNAL_FILE || "mission-control-opportunity-costs.jsonl";
  return path.join(journalDir, journalFile);
}

function normalizeDecisionType(value: unknown): OpportunityDecisionType {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "executed" || normalized === "ignored" || normalized === "missed") {
    return normalized;
  }
  return "refused";
}

function normalizeStatus(value: unknown): OpportunityCostStatus {
  return String(value || "").trim().toLowerCase() === "scored" ? "scored" : "pending";
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeOpportunityAttributionStatus(value: unknown): OpportunityCostAttribution["status"] {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "computed" || normalized === "scored" ? "computed" : "pending";
}

function normalizeOptionalId(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeEntry(raw: unknown): OpportunityCostJournalEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const payload = raw as Partial<OpportunityCostJournalEntry>;
  const entryId = String(payload.entry_id || "").trim();
  const venue = String(payload.venue || "").trim();
  const instrument = String(payload.instrument || "").trim().toUpperCase();
  const timeframe = String(payload.timeframe || "").trim();
  const side = String(payload.side || "").trim();
  const createdAtIso = String(payload.created_at_iso || "").trim();
  if (!entryId || !venue || !instrument || !timeframe || !side || !createdAtIso) {
    return null;
  }
  const attributionRaw = payload.opportunity_attribution && typeof payload.opportunity_attribution === "object" && !Array.isArray(payload.opportunity_attribution)
    ? payload.opportunity_attribution as Partial<OpportunityCostAttribution>
    : {};
  const gateReason = typeof attributionRaw.gate_reason === "string" && attributionRaw.gate_reason.trim().length > 0
    ? attributionRaw.gate_reason.trim()
    : typeof payload.gate_name === "string" && payload.gate_name.trim().length > 0
      ? payload.gate_name.trim()
      : typeof payload.refusal_reason === "string" && payload.refusal_reason.trim().length > 0
        ? payload.refusal_reason.trim()
        : null;
  const expectedAlphaBps = toNumberOrNull(attributionRaw.expected_alpha_bps) ?? toNumberOrNull(payload.predicted_alpha_bps);
  const realizedMoveBps = toNumberOrNull(attributionRaw.realized_move_bps) ?? toNumberOrNull(payload.ex_post_market_move_bps);
  const missedAlphaBps = toNumberOrNull(attributionRaw.missed_alpha_bps)
    ?? (() => {
      const opportunityCostBps = toNumberOrNull(payload.ex_post_opportunity_cost_bps);
      return opportunityCostBps !== null && opportunityCostBps > 0 ? opportunityCostBps : 0;
    })();
  const savedLossBps = toNumberOrNull(attributionRaw.saved_loss_bps)
    ?? (() => {
      const opportunityCostBps = toNumberOrNull(payload.ex_post_opportunity_cost_bps);
      return opportunityCostBps !== null && opportunityCostBps < 0 ? Math.abs(opportunityCostBps) : 0;
    })();
  return {
    entry_id: entryId,
    trade_lifecycle_id: normalizeOptionalId(payload.trade_lifecycle_id),
    candidate_id: normalizeOptionalId(payload.candidate_id),
    decision_id: typeof payload.decision_id === "string" && payload.decision_id.trim().length > 0 ? payload.decision_id.trim() : null,
    approval_id: normalizeOptionalId(payload.approval_id),
    execution_id: normalizeOptionalId(payload.execution_id),
    outcome_id: normalizeOptionalId(payload.outcome_id),
    intent_id: typeof payload.intent_id === "string" && payload.intent_id.trim().length > 0 ? payload.intent_id.trim() : null,
    portfolio_id: typeof payload.portfolio_id === "string" && payload.portfolio_id.trim().length > 0 ? payload.portfolio_id.trim() : null,
    strategy_id: typeof payload.strategy_id === "string" && payload.strategy_id.trim().length > 0 ? payload.strategy_id.trim() : null,
    venue,
    instrument,
    timeframe,
    side,
    regime: String(payload.regime || "UNKNOWN").trim() || "UNKNOWN",
    decision_type: normalizeDecisionType(payload.decision_type),
    refusal_reason: typeof payload.refusal_reason === "string" && payload.refusal_reason.trim().length > 0 ? payload.refusal_reason.trim() : null,
    gate_name: typeof payload.gate_name === "string" && payload.gate_name.trim().length > 0 ? payload.gate_name.trim() : null,
    predicted_alpha_bps: toNumberOrNull(payload.predicted_alpha_bps),
    ex_post_market_move_bps: toNumberOrNull(payload.ex_post_market_move_bps),
    ex_post_opportunity_cost_bps: toNumberOrNull(payload.ex_post_opportunity_cost_bps),
    captured_price: toNumberOrNull(payload.captured_price),
    horizon_minutes: Math.max(0, Math.round(Number(payload.horizon_minutes || 0))),
    opportunity_attribution: {
      status: normalizeOpportunityAttributionStatus(attributionRaw.status ?? payload.status),
      gate_reason: gateReason,
      expected_alpha_bps: expectedAlphaBps,
      realized_move_bps: realizedMoveBps,
      missed_alpha_bps: missedAlphaBps,
      saved_loss_bps: savedLossBps,
      counterfactual_confidence: toNumberOrNull(attributionRaw.counterfactual_confidence),
      matching_quality: toNumberOrNull(attributionRaw.matching_quality),
      followup_delay_minutes: toNumberOrNull(attributionRaw.followup_delay_minutes),
      notes: Array.isArray(attributionRaw.notes) ? attributionRaw.notes.map((note) => String(note || "").trim()).filter(Boolean).slice(0, 12) : [],
    },
    market_context: payload.market_context && typeof payload.market_context === "object" && !Array.isArray(payload.market_context)
      ? payload.market_context as Record<string, unknown>
      : {},
    approval_context: payload.approval_context && typeof payload.approval_context === "object" && !Array.isArray(payload.approval_context)
      ? payload.approval_context as Record<string, unknown>
      : {},
    status: normalizeStatus(payload.status),
    created_at_iso: createdAtIso,
    scored_at_iso: typeof payload.scored_at_iso === "string" && payload.scored_at_iso.trim().length > 0 ? payload.scored_at_iso.trim() : null,
  };
}

async function loadAllEntries(): Promise<OpportunityCostJournalEntry[]> {
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
      .filter((row): row is OpportunityCostJournalEntry => row !== null);
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

export async function appendOpportunityCostJournalEntry(entry: OpportunityCostJournalEntry): Promise<void> {
  const target = filePath();
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(entry)}\n`, "utf-8");
  journalCache = null;
}

export async function readOpportunityCostJournalEntries(options?: {
  symbol?: string;
  strategyId?: string;
  portfolioId?: string;
  decisionId?: string;
  decisionType?: OpportunityDecisionType;
  status?: OpportunityCostStatus;
  limit?: number;
  sinceDays?: number;
}): Promise<OpportunityCostJournalEntry[]> {
  const symbol = String(options?.symbol || "").trim().toUpperCase();
  const strategyId = String(options?.strategyId || "").trim();
  const portfolioId = String(options?.portfolioId || "").trim();
  const decisionId = String(options?.decisionId || "").trim();
  const decisionType = options?.decisionType ? normalizeDecisionType(options.decisionType) : null;
  const status = options?.status ? normalizeStatus(options.status) : null;
  const limit = Math.max(1, Math.min(2_000, Math.round(Number(options?.limit || 100))));
  const sinceDays = Math.max(0, Math.min(365, Number(options?.sinceDays || 0)));
  const cutoffMs = sinceDays > 0 ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : 0;

  try {
    const rows = await loadAllEntries();
    const results: OpportunityCostJournalEntry[] = [];
    const seenEntryIds = new Set<string>();
    for (let index = rows.length - 1; index >= 0 && results.length < limit; index -= 1) {
      const row = rows[index];
      if (seenEntryIds.has(row.entry_id)) {
        continue;
      }
      seenEntryIds.add(row.entry_id);
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
      if (decisionType && row.decision_type !== decisionType) continue;
      if (status && row.status !== status) continue;
      results.push(row);
    }
    return results;
  } catch {
    return [];
  }
}