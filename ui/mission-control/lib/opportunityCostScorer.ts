import { readAllocationDecisionJournalEntries, type AllocationDecisionJournalEntry, type AllocationDecisionStrategyEntry } from "./allocationDecisionJournal";
import { readExecutionFactJournalEntries, type ExecutionFactJournalEntry } from "./executionFactJournal";
import { appendOpportunityCostJournalEntry, readOpportunityCostJournalEntries, type OpportunityCostJournalEntry } from "./opportunityCostJournal";

const DEFAULT_HORIZON_MINUTES = 90;

export type OpportunityCostScoreSummary = {
  scanned: number;
  scored: number;
  pending: number;
  scoredEntries: OpportunityCostJournalEntry[];
};

type OpportunityCostMatch = {
  fact: ExecutionFactJournalEntry;
  matchingQuality: number;
  matchingLabel: string;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundMetric(value: number): number {
  return Number(value.toFixed(3));
}

function roundRatio(value: number): number {
  return Number(value.toFixed(4));
}

function normalizeInstrumentAlias(instrument: string, venue: string): string {
  const normalizedInstrument = String(instrument || "").trim().toUpperCase();
  const normalizedVenue = String(venue || "").trim().toLowerCase();
  if (!normalizedInstrument) {
    return "";
  }
  if (
    normalizedInstrument.endsWith("USD")
    && !normalizedInstrument.endsWith("USDT")
    && (normalizedVenue === "binance-public" || normalizedVenue === "coinbase-public" || normalizedVenue === "okx-public")
  ) {
    return `${normalizedInstrument}T`;
  }
  return normalizedInstrument;
}

function instrumentsMatch(entry: OpportunityCostJournalEntry, fact: ExecutionFactJournalEntry): boolean {
  const entryInstrument = normalizeInstrumentAlias(entry.instrument, entry.venue);
  const factInstrument = normalizeInstrumentAlias(fact.instrument, fact.venue);
  if (!entryInstrument || !factInstrument) {
    return false;
  }
  return entryInstrument === factInstrument;
}

function extractCorrelationKeys(entry: OpportunityCostJournalEntry): {
  decisionId: string;
  intentId: string;
  decisionHash: string;
  oracleFingerprint: string;
  followupExpected: boolean;
  sideKnown: boolean;
} {
  const marketContext = asRecord(entry.market_context);
  const correlation = asRecord(marketContext.correlation);
  const approvalContext = asRecord(entry.approval_context);
  const decisionAudit = asRecord(approvalContext.decision_audit);
  const determinism = asRecord(decisionAudit.determinism);
  const normalizedSide = normalizeSide(entry.side);
  return {
    decisionId: String(entry.decision_id || correlation.decision_id || "").trim(),
    intentId: String(entry.intent_id || correlation.intent_id || "").trim(),
    decisionHash: String(correlation.decision_hash || determinism.decision_hash || "").trim(),
    oracleFingerprint: String(correlation.oracle_fingerprint || decisionAudit.oracleFingerprint || "").trim(),
    followupExpected: Boolean(correlation.followup_expected) || String(marketContext.journal_action || "") === "execution-v7-blocked",
    sideKnown: normalizedSide.length > 0 && normalizedSide !== "unknown",
  };
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSide(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function resolveHorizonMinutes(entry: OpportunityCostJournalEntry, fallbackMinutes: number): number {
  return Math.max(1, Math.round(entry.horizon_minutes || fallbackMinutes || DEFAULT_HORIZON_MINUTES));
}

function selectNotionalUsd(fact: ExecutionFactJournalEntry): number | null {
  return toNumberOrNull(fact.filled_notional_usd) ?? toNumberOrNull(fact.target_notional_usd);
}

function computePnlMoveBps(fact: ExecutionFactJournalEntry): number | null {
  const pnlUsd = toNumberOrNull(fact.alpha_attribution.pnl_usd);
  const notionalUsd = selectNotionalUsd(fact);
  if (pnlUsd === null || notionalUsd === null || Math.abs(notionalUsd) < 1e-9) {
    return null;
  }
  return (pnlUsd / notionalUsd) * 10_000;
}

function computePriceMoveBps(entry: OpportunityCostJournalEntry, fact: ExecutionFactJournalEntry): number | null {
  const capturedPrice = toNumberOrNull(entry.captured_price);
  const fillPrice = toNumberOrNull(fact.avg_fill_price);
  if (capturedPrice === null || fillPrice === null || capturedPrice <= 0) {
    return null;
  }
  const rawMoveBps = ((fillPrice - capturedPrice) / capturedPrice) * 10_000;
  return normalizeSide(entry.side).includes("sell") ? -rawMoveBps : rawMoveBps;
}

function computeExPostMoveBps(entry: OpportunityCostJournalEntry, fact: ExecutionFactJournalEntry): number | null {
  return computePnlMoveBps(fact) ?? computePriceMoveBps(entry, fact);
}

function computeOpportunityCostBps(entry: OpportunityCostJournalEntry, moveBps: number | null): number | null {
  if (moveBps === null) {
    return null;
  }
  if (entry.decision_type === "executed") {
    return 0;
  }
  return moveBps;
}

function computeMissedAlphaBps(decisionType: OpportunityCostJournalEntry["decision_type"], opportunityCostBps: number): number {
  if (decisionType === "executed") {
    return 0;
  }
  return opportunityCostBps > 0 ? Number(opportunityCostBps.toFixed(3)) : 0;
}

function computeSavedLossBps(decisionType: OpportunityCostJournalEntry["decision_type"], opportunityCostBps: number): number {
  if (decisionType === "executed") {
    return 0;
  }
  return opportunityCostBps < 0 ? Number(Math.abs(opportunityCostBps).toFixed(3)) : 0;
}

function computeFollowupDelayMinutes(entry: OpportunityCostJournalEntry, fact: ExecutionFactJournalEntry): number | null {
  const entryCreatedAtMs = parseIsoMs(entry.created_at_iso);
  const factEventMs = parseIsoMs(fact.filled_at_iso) ?? parseIsoMs(fact.created_at_iso);
  if (entryCreatedAtMs === null || factEventMs === null || factEventMs < entryCreatedAtMs) {
    return null;
  }
  return roundMetric((factEventMs - entryCreatedAtMs) / 60_000);
}

function computeCounterfactualConfidence(matchingQuality: number, followupDelayMinutes: number | null, horizonMinutes: number): number {
  const safeHorizonMinutes = Math.max(1, horizonMinutes);
  const delayRatio = followupDelayMinutes === null ? 1 : clamp(followupDelayMinutes / safeHorizonMinutes, 0, 1);
  return roundRatio(clamp((matchingQuality * 0.7) + ((1 - delayRatio) * 0.3), 0.05, 0.99));
}

function hasComputedOpportunityAttribution(entry: OpportunityCostJournalEntry): boolean {
  return entry.status === "scored"
    && entry.opportunity_attribution.status === "computed"
    && toNumberOrNull(entry.opportunity_attribution.realized_move_bps) !== null
    && toNumberOrNull(entry.opportunity_attribution.missed_alpha_bps) !== null
    && toNumberOrNull(entry.opportunity_attribution.saved_loss_bps) !== null
    && toNumberOrNull(entry.opportunity_attribution.counterfactual_confidence) !== null
    && toNumberOrNull(entry.opportunity_attribution.matching_quality) !== null
    && toNumberOrNull(entry.opportunity_attribution.followup_delay_minutes) !== null;
}

function deriveAllocationPredictedAlphaBps(strategyEntry: AllocationDecisionStrategyEntry | null): number | null {
  if (!strategyEntry || Math.abs(strategyEntry.allocated_capital_usd) < 1e-9) {
    return null;
  }
  return (strategyEntry.expected_edge_usd / strategyEntry.allocated_capital_usd) * 10_000;
}

function findAllocationContext(
  entry: OpportunityCostJournalEntry,
  allocations: AllocationDecisionJournalEntry[],
): {
  allocation: AllocationDecisionJournalEntry | null;
  strategy: AllocationDecisionStrategyEntry | null;
} {
  const createdAtMs = parseIsoMs(entry.created_at_iso);
  for (const allocation of allocations) {
    const allocationCreatedAtMs = parseIsoMs(allocation.created_at_iso);
    if (createdAtMs !== null && allocationCreatedAtMs !== null && allocationCreatedAtMs > createdAtMs) {
      continue;
    }
    const strategy = allocation.strategies.find((candidate) => candidate.strategy_id === entry.strategy_id)
      || allocation.strategies.find((candidate) => candidate.strategy_id === allocation.selected_strategy_id)
      || null;
    return { allocation, strategy };
  }
  return { allocation: null, strategy: null };
}

function findMatchingExecutionFact(
  entry: OpportunityCostJournalEntry,
  facts: ExecutionFactJournalEntry[],
  defaultHorizonMinutes: number,
): OpportunityCostMatch | null {
  const entryCreatedAtMs = parseIsoMs(entry.created_at_iso);
  if (entryCreatedAtMs === null) {
    return null;
  }
  const horizonMs = resolveHorizonMinutes(entry, defaultHorizonMinutes) * 60 * 1000;
  const side = normalizeSide(entry.side);
  const correlation = extractCorrelationKeys(entry);
  const directCorrelationMatches: ExecutionFactJournalEntry[] = [];
  const hintedMatches: ExecutionFactJournalEntry[] = [];
  const exactMatches: ExecutionFactJournalEntry[] = [];
  const fallbackMatches: ExecutionFactJournalEntry[] = [];

  for (const fact of facts) {
    const decisionIdMatch = correlation.decisionId.length > 0 && fact.decision_id === correlation.decisionId;
    const intentIdMatch = correlation.intentId.length > 0 && fact.intent_id === correlation.intentId;
    const factDeterminism = asRecord(fact.determinism);
    const decisionHashMatch = correlation.decisionHash.length > 0 && String(factDeterminism.decision_hash || "").trim() === correlation.decisionHash;
    const oracleFingerprintMatch = correlation.oracleFingerprint.length > 0 && String(factDeterminism.oracle_fingerprint || factDeterminism.oracleFingerprint || "").trim() === correlation.oracleFingerprint;
    const correlatedMatch = decisionIdMatch || intentIdMatch || decisionHashMatch || oracleFingerprintMatch;
    if (!instrumentsMatch(entry, fact) && !correlatedMatch) {
      continue;
    }
    if (correlation.sideKnown && normalizeSide(fact.side) !== side && !correlatedMatch) {
      continue;
    }
    if (entry.portfolio_id && fact.portfolio_id !== entry.portfolio_id && !correlatedMatch) {
      continue;
    }
    const factEventMs = parseIsoMs(fact.filled_at_iso) ?? parseIsoMs(fact.created_at_iso);
    if (factEventMs === null || factEventMs < entryCreatedAtMs || factEventMs - entryCreatedAtMs > horizonMs) {
      continue;
    }
    if (entry.venue && entry.venue !== "unknown" && fact.venue !== entry.venue && !correlatedMatch) {
      continue;
    }
    if (correlatedMatch) {
      directCorrelationMatches.push(fact);
      continue;
    }
    if (!correlation.sideKnown && correlation.followupExpected && entry.strategy_id && fact.strategy_id === entry.strategy_id) {
      hintedMatches.push(fact);
      continue;
    }
    if (entry.strategy_id && fact.strategy_id === entry.strategy_id) {
      exactMatches.push(fact);
      continue;
    }
    fallbackMatches.push(fact);
  }

  const sortByEarliest = (left: ExecutionFactJournalEntry, right: ExecutionFactJournalEntry): number => {
    const leftMs = parseIsoMs(left.filled_at_iso) ?? parseIsoMs(left.created_at_iso) ?? Number.MAX_SAFE_INTEGER;
    const rightMs = parseIsoMs(right.filled_at_iso) ?? parseIsoMs(right.created_at_iso) ?? Number.MAX_SAFE_INTEGER;
    return leftMs - rightMs;
  };

  const pickMatch = (matches: ExecutionFactJournalEntry[], matchingQuality: number, matchingLabel: string): OpportunityCostMatch | null => {
    const fact = matches.sort(sortByEarliest)[0] || null;
    return fact ? { fact, matchingQuality, matchingLabel } : null;
  };

  return pickMatch(directCorrelationMatches, 1, "correlated")
    || pickMatch(hintedMatches, 0.85, "hinted")
    || pickMatch(exactMatches, 0.7, "strategy_exact")
    || pickMatch(fallbackMatches, 0.55, "fallback")
    || null;
}

function buildScoredEntry(
  entry: OpportunityCostJournalEntry,
  match: OpportunityCostMatch,
  allocationContext: { allocation: AllocationDecisionJournalEntry | null; strategy: AllocationDecisionStrategyEntry | null },
  scoredAtIso: string,
  defaultHorizonMinutes: number,
): OpportunityCostJournalEntry | null {
  const { fact, matchingQuality, matchingLabel } = match;
  const exPostMoveBps = computeExPostMoveBps(entry, fact);
  const exPostOpportunityCostBps = computeOpportunityCostBps(entry, exPostMoveBps);
  if (exPostMoveBps === null || exPostOpportunityCostBps === null) {
    return null;
  }
  const allocation = allocationContext.allocation;
  const strategy = allocationContext.strategy;
  const predictedAlphaBps = entry.predicted_alpha_bps ?? deriveAllocationPredictedAlphaBps(strategy);
  const scoringContext = {
    scorer_version: "opportunity-cost-v1",
    matched_fact_id: fact.fact_id,
    matched_fact_decision_id: fact.decision_id,
    matched_fact_strategy_id: fact.strategy_id,
    matched_fact_outcome: fact.decision_outcome,
    matched_fact_created_at_iso: fact.created_at_iso,
    matched_fact_filled_at_iso: fact.filled_at_iso,
    matched_fact_pnl_usd: fact.alpha_attribution.pnl_usd,
    matched_fact_notional_usd: selectNotionalUsd(fact),
    matched_allocation_id: allocation?.allocation_id || null,
    matched_allocation_selected_strategy_id: allocation?.selected_strategy_id || null,
    matched_allocation_pct: strategy?.allocated_pct ?? null,
    matched_allocation_size_multiplier: allocation?.selected_strategy_size_multiplier ?? null,
    matched_allocation_capital_mode: allocation?.capital_mode || null,
    matched_allocation_evolution_mode: allocation?.evolution_mode || null,
    matching_quality: matchingQuality,
    matching_label: matchingLabel,
  };
  const roundedMoveBps = roundMetric(exPostMoveBps);
  const roundedOpportunityCostBps = roundMetric(exPostOpportunityCostBps);
  const gateReason = entry.gate_name || entry.refusal_reason;
  const resolvedHorizonMinutes = resolveHorizonMinutes(entry, defaultHorizonMinutes);
  const followupDelayMinutes = computeFollowupDelayMinutes(entry, fact);
  const counterfactualConfidence = computeCounterfactualConfidence(matchingQuality, followupDelayMinutes, resolvedHorizonMinutes);

  return {
    ...entry,
    trade_lifecycle_id: entry.trade_lifecycle_id || fact.trade_lifecycle_id || fact.decision_id,
    candidate_id: entry.candidate_id || fact.candidate_id || fact.intent_id,
    approval_id: entry.approval_id || fact.approval_id,
    execution_id: entry.execution_id || fact.execution_id || fact.order_id || fact.fact_id,
    outcome_id: entry.outcome_id || fact.outcome_id || `outcome-${fact.fact_id}`,
    predicted_alpha_bps: predictedAlphaBps,
    ex_post_market_move_bps: roundedMoveBps,
    ex_post_opportunity_cost_bps: roundedOpportunityCostBps,
    horizon_minutes: resolvedHorizonMinutes,
    opportunity_attribution: {
      status: "computed",
      gate_reason: gateReason,
      expected_alpha_bps: predictedAlphaBps,
      realized_move_bps: roundedMoveBps,
      missed_alpha_bps: computeMissedAlphaBps(entry.decision_type, roundedOpportunityCostBps),
      saved_loss_bps: computeSavedLossBps(entry.decision_type, roundedOpportunityCostBps),
      counterfactual_confidence: counterfactualConfidence,
      matching_quality: matchingQuality,
      followup_delay_minutes: followupDelayMinutes,
      notes: [
        "opportunity_cost_v1",
        gateReason || "gate_reason_unknown",
        `match_quality:${matchingLabel}`,
        `matched_fact:${fact.fact_id}`,
      ],
    },
    market_context: {
      ...asRecord(entry.market_context),
      ...scoringContext,
    },
    approval_context: {
      ...asRecord(entry.approval_context),
      opportunity_cost_scorer: scoringContext,
    },
    status: "scored",
    scored_at_iso: scoredAtIso,
  };
}

export async function scorePendingOpportunityCostEntries(options?: {
  symbol?: string;
  strategyId?: string;
  portfolioId?: string;
  limit?: number;
  sinceDays?: number;
  defaultHorizonMinutes?: number;
}): Promise<OpportunityCostScoreSummary> {
  const symbol = String(options?.symbol || "").trim().toUpperCase();
  const strategyId = String(options?.strategyId || "").trim();
  const portfolioId = String(options?.portfolioId || "").trim();
  const limit = Math.max(1, Math.min(500, Math.round(Number(options?.limit || 100))));
  const sinceDays = Math.max(0, Math.min(365, Math.round(Number(options?.sinceDays || 14))));
  const defaultHorizonMinutes = Math.max(1, Math.min(24 * 60, Math.round(Number(options?.defaultHorizonMinutes || DEFAULT_HORIZON_MINUTES))));
  const [opportunityEntries, facts, allocations] = await Promise.all([
    readOpportunityCostJournalEntries({ symbol, strategyId, portfolioId, limit, sinceDays }),
    readExecutionFactJournalEntries({ symbol, portfolioId, limit: Math.max(limit * 12, 200), sinceDays: Math.max(sinceDays, 14) }),
    portfolioId ? readAllocationDecisionJournalEntries({ portfolioId, limit: 96, sinceDays: Math.max(sinceDays, 14) }) : Promise.resolve([]),
  ]);
  const candidates = opportunityEntries.filter((entry) => entry.status === "pending" || !hasComputedOpportunityAttribution(entry));

  const scoredEntries: OpportunityCostJournalEntry[] = [];

  for (const entry of candidates) {
    const match = findMatchingExecutionFact(entry, facts, defaultHorizonMinutes);
    if (!match) {
      continue;
    }
    const allocationContext = findAllocationContext(entry, allocations);
    const scoredEntry = buildScoredEntry(entry, match, allocationContext, new Date().toISOString(), defaultHorizonMinutes);
    if (!scoredEntry) {
      continue;
    }
    await appendOpportunityCostJournalEntry(scoredEntry);
    scoredEntries.push(scoredEntry);
  }

  return {
    scanned: candidates.length,
    scored: scoredEntries.length,
    pending: Math.max(0, candidates.length - scoredEntries.length),
    scoredEntries,
  };
}