import {
  appendExecutionFactJournalEntry,
  readExecutionFactJournalEntries,
  type ExecutionFactJournalEntry,
} from "./executionFactJournal";
import { deriveExecutionAlphaAttributionV1 } from "./performanceAttributionV1";

export type ExecutionAlphaAttributionScoreSummary = {
  scanned: number;
  scored: number;
  pending: number;
  scoredEntries: ExecutionFactJournalEntry[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function hasComputedCoreAttribution(entry: ExecutionFactJournalEntry): boolean {
  return entry.alpha_attribution.status === "computed"
    && toNumberOrNull(entry.alpha_attribution.regime_contribution_usd) !== null
    && toNumberOrNull(entry.alpha_attribution.signal_contribution_usd) !== null
    && toNumberOrNull(entry.alpha_attribution.execution_contribution_usd) !== null;
}

function hasExecutionAlphaBreakdownV1(entry: ExecutionFactJournalEntry): boolean {
  return toNumberOrNull(entry.alpha_attribution.allocation_alpha_bps) !== null
    && toNumberOrNull(entry.alpha_attribution.signal_alpha_bps) !== null
    && toNumberOrNull(entry.alpha_attribution.timing_alpha_bps) !== null
    && toNumberOrNull(entry.alpha_attribution.execution_alpha_bps) !== null
    && toNumberOrNull(entry.alpha_attribution.spread_cost_bps) !== null
    && toNumberOrNull(entry.alpha_attribution.slippage_cost_bps) !== null
    && toNumberOrNull(entry.alpha_attribution.alpha_confidence) !== null
    && toNumberOrNull(entry.alpha_attribution.sample_size) !== null
    && typeof entry.alpha_attribution.attribution_version === "string"
    && entry.alpha_attribution.attribution_version.trim().length > 0;
}

function buildScoredEntry(entry: ExecutionFactJournalEntry, scoredAtIso: string): ExecutionFactJournalEntry | null {
  const derived = deriveExecutionAlphaAttributionV1(entry);
  if (derived.attribution_status !== "computed") {
    return null;
  }
  return {
    ...entry,
    alpha_attribution: {
      status: derived.status,
      pnl_usd: derived.pnl_usd,
      regime_contribution_usd: derived.regime_contribution_usd,
      allocation_contribution_usd: derived.allocation_contribution_usd,
      signal_contribution_usd: derived.signal_contribution_usd,
      execution_contribution_usd: derived.execution_contribution_usd,
      timing_contribution_usd: derived.timing_contribution_usd,
      spread_contribution_usd: derived.spread_contribution_usd,
      slippage_contribution_usd: derived.slippage_contribution_usd,
      allocation_alpha_bps: derived.allocation_alpha_bps,
      signal_alpha_bps: derived.signal_alpha_bps,
      timing_alpha_bps: derived.timing_alpha_bps,
      execution_alpha_bps: derived.execution_alpha_bps,
      spread_cost_bps: derived.spread_cost_bps,
      slippage_cost_bps: derived.slippage_cost_bps,
      alpha_confidence: derived.alpha_confidence,
      sample_size: derived.sample_size,
      attribution_version: derived.attribution_version,
      notes: [...new Set([...(entry.alpha_attribution.notes || []), ...(derived.notes || []), `scored_at:${scoredAtIso}`])].slice(0, 12),
    },
    market_context: {
      ...asRecord(entry.market_context),
      alpha_attribution_scorer: {
        scorer_version: "alpha-attribution-v1",
        scored_at_iso: scoredAtIso,
      },
    },
    approval_context: {
      ...asRecord(entry.approval_context),
      alpha_attribution_scorer: {
        scorer_version: "alpha-attribution-v1",
        scored_at_iso: scoredAtIso,
      },
    },
  };
}

export async function scoreExecutionFactAlphaAttributionEntries(options?: {
  symbol?: string;
  strategyId?: string;
  portfolioId?: string;
  decisionId?: string;
  factId?: string;
  limit?: number;
  sinceDays?: number;
}): Promise<ExecutionAlphaAttributionScoreSummary> {
  const symbol = String(options?.symbol || "").trim().toUpperCase();
  const strategyId = String(options?.strategyId || "").trim();
  const portfolioId = String(options?.portfolioId || "").trim();
  const decisionId = String(options?.decisionId || "").trim();
  const factId = String(options?.factId || "").trim();
  const limit = Math.max(1, Math.min(500, Math.round(Number(options?.limit || 100))));
  const sinceDays = Math.max(0, Math.min(365, Math.round(Number(options?.sinceDays || 14))));
  const entries = await readExecutionFactJournalEntries({
    symbol,
    strategyId,
    portfolioId,
    decisionId,
    limit,
    sinceDays,
  });

  const candidates = factId
    ? entries.filter((entry) => entry.fact_id === factId)
    : entries.filter((entry) => !hasComputedCoreAttribution(entry) || !hasExecutionAlphaBreakdownV1(entry));

  const scoredEntries: ExecutionFactJournalEntry[] = [];
  for (const entry of candidates) {
    const scoredEntry = buildScoredEntry(entry, new Date().toISOString());
    if (!scoredEntry) {
      continue;
    }
    await appendExecutionFactJournalEntry(scoredEntry);
    scoredEntries.push(scoredEntry);
  }

  return {
    scanned: candidates.length,
    scored: scoredEntries.length,
    pending: Math.max(0, candidates.length - scoredEntries.length),
    scoredEntries,
  };
}