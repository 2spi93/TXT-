import { NextRequest, NextResponse } from "next/server";

import { appendAllocationWriterStageTransitions } from "../../../../lib/allocationWriterAuditJournal";
import { getControlPlaneToken } from "../../../../lib/controlPlane";
import { scoreExecutionFactAlphaAttributionEntries } from "../../../../lib/executionAlphaAttributionScorer";
import {
  appendExecutionFactJournalEntry,
  readExecutionFactJournalEntries,
  type ExecutionFactAttribution,
  type ExecutionFactJournalEntry,
} from "../../../../lib/executionFactJournal";

function unauthorized(): NextResponse {
  return NextResponse.json({ message: "Authentication required" }, { status: 401 });
}

function buildId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseDecisionOutcome(value: unknown): ExecutionFactJournalEntry["decision_outcome"] {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "correct" || normalized === "false_positive" || normalized === "unknown") {
    return normalized;
  }
  return null;
}

function parseCausalityConfidence(value: unknown): ExecutionFactJournalEntry["causality_confidence"] {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "native" || normalized === "backfilled" || normalized === "inferred") {
    return normalized;
  }
  return null;
}

function normalizeAttribution(payload: unknown): ExecutionFactAttribution {
  const input = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Partial<ExecutionFactAttribution>
    : {};
  const status = String(input.status || "pending").trim().toLowerCase();
  return {
    status: status === "partial" || status === "computed" ? status : "pending",
    pnl_usd: toNumberOrNull(input.pnl_usd),
    regime_contribution_usd: toNumberOrNull(input.regime_contribution_usd),
    allocation_contribution_usd: toNumberOrNull(input.allocation_contribution_usd ?? input.regime_contribution_usd),
    signal_contribution_usd: toNumberOrNull(input.signal_contribution_usd),
    execution_contribution_usd: toNumberOrNull(input.execution_contribution_usd),
    timing_contribution_usd: toNumberOrNull(input.timing_contribution_usd),
    spread_contribution_usd: toNumberOrNull(input.spread_contribution_usd),
    slippage_contribution_usd: toNumberOrNull(input.slippage_contribution_usd),
    allocation_alpha_bps: toNumberOrNull(input.allocation_alpha_bps),
    signal_alpha_bps: toNumberOrNull(input.signal_alpha_bps),
    timing_alpha_bps: toNumberOrNull(input.timing_alpha_bps),
    execution_alpha_bps: toNumberOrNull(input.execution_alpha_bps),
    spread_cost_bps: toNumberOrNull(input.spread_cost_bps),
    slippage_cost_bps: toNumberOrNull(input.slippage_cost_bps),
    alpha_confidence: toNumberOrNull(input.alpha_confidence),
    sample_size: toNumberOrNull(input.sample_size),
    attribution_version: typeof input.attribution_version === "string" && input.attribution_version.trim().length > 0
      ? input.attribution_version.trim()
      : null,
    notes: Array.isArray(input.notes) ? input.notes.map((note) => String(note || "").trim()).filter(Boolean).slice(0, 12) : [],
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = await getControlPlaneToken();
  if (!token) {
    return unauthorized();
  }
  const symbol = request.nextUrl.searchParams.get("symbol") || "";
  const strategyId = request.nextUrl.searchParams.get("strategyId") || "";
  const portfolioId = request.nextUrl.searchParams.get("portfolioId") || "";
  const decisionId = request.nextUrl.searchParams.get("decisionId") || "";
  const outcome = parseDecisionOutcome(request.nextUrl.searchParams.get("outcome") || "");
  const limit = Number(request.nextUrl.searchParams.get("limit") || 100);
  const sinceDays = Number(request.nextUrl.searchParams.get("sinceDays") || 0);
  const entries = await readExecutionFactJournalEntries({ symbol, strategyId, portfolioId, decisionId, outcome, limit, sinceDays });
  return NextResponse.json({ entries });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = await getControlPlaneToken();
  if (!token) {
    return unauthorized();
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(request.nextUrl.searchParams.get("action") || body.action || "").trim().toLowerCase();
  if (action === "score_pending" || action === "score-pending") {
    const result = await scoreExecutionFactAlphaAttributionEntries({
      symbol: String(body.symbol || "").trim().toUpperCase(),
      strategyId: String(body.strategy_id || body.strategyId || "").trim(),
      portfolioId: String(body.portfolio_id || body.portfolioId || "").trim(),
      decisionId: String(body.decision_id || body.decisionId || "").trim(),
      factId: String(body.fact_id || body.factId || "").trim(),
      limit: Number(body.limit || 100),
      sinceDays: Number(body.sinceDays || 14),
    });
    return NextResponse.json({ ok: true, result });
  }
  const decisionId = String(body.decision_id || body.decisionId || "").trim();
  const intentId = String(body.intent_id || body.intentId || "").trim();
  const portfolioId = String(body.portfolio_id || body.portfolioId || "").trim();
  const strategyId = String(body.strategy_id || body.strategyId || "").trim();
  const venue = String(body.venue || "").trim();
  const instrument = String(body.instrument || body.symbol || "").trim().toUpperCase();
  const timeframe = String(body.timeframe || "").trim();
  const side = String(body.side || "").trim();
  if (!decisionId || !intentId || !portfolioId || !strategyId || !venue || !instrument || !timeframe || !side) {
    return NextResponse.json({ message: "decision_id, intent_id, portfolio_id, strategy_id, venue, instrument, timeframe and side are required" }, { status: 400 });
  }
  const factId = String(body.fact_id || body.factId || buildId("exfact")).trim();
  const orderId = typeof body.order_id === "string" && body.order_id.trim().length > 0
    ? body.order_id.trim()
    : typeof body.orderId === "string" && body.orderId.trim().length > 0
      ? body.orderId.trim()
      : null;
  const entry: ExecutionFactJournalEntry = {
    fact_id: factId,
    trade_lifecycle_id: String(body.trade_lifecycle_id || body.tradeLifecycleId || decisionId).trim() || null,
    candidate_id: String(body.candidate_id || body.candidateId || intentId).trim() || null,
    decision_id: decisionId,
    causality_confidence: parseCausalityConfidence(body.causality_confidence || body.causalityConfidence),
    approval_id: String(body.approval_id || body.approvalId || "").trim() || null,
    execution_id: String(body.execution_id || body.executionId || orderId || factId).trim() || null,
    outcome_id: String(body.outcome_id || body.outcomeId || `outcome-${factId}`).trim() || null,
    intent_id: intentId,
    order_id: orderId,
    portfolio_id: portfolioId,
    strategy_id: strategyId,
    venue,
    instrument,
    timeframe,
    side,
    execution_mode: String(body.execution_mode || body.executionMode || "paper").trim() || "paper",
    approval_level: String(body.approval_level || body.approvalLevel || "none").trim() || "none",
    approval_timestamp: typeof body.approval_timestamp === "string" && body.approval_timestamp.trim().length > 0 ? body.approval_timestamp.trim() : null,
    regime_at_decision: String(body.regime_at_decision || body.regimeAtDecision || "UNKNOWN").trim() || "UNKNOWN",
    regime_at_fill: typeof body.regime_at_fill === "string" && body.regime_at_fill.trim().length > 0 ? body.regime_at_fill.trim() : null,
    decision_outcome: parseDecisionOutcome(body.decision_outcome ?? body.decisionOutcome),
    target_notional_usd: toNumberOrNull(body.target_notional_usd ?? body.targetNotionalUsd),
    filled_notional_usd: toNumberOrNull(body.filled_notional_usd ?? body.filledNotionalUsd),
    avg_fill_price: toNumberOrNull(body.avg_fill_price ?? body.avgFillPrice),
    determinism: body.determinism && typeof body.determinism === "object" && !Array.isArray(body.determinism)
      ? body.determinism as Record<string, unknown>
      : {},
    alpha_attribution: normalizeAttribution(body.alpha_attribution ?? body.alphaAttribution),
    market_context: body.market_context && typeof body.market_context === "object" && !Array.isArray(body.market_context)
      ? body.market_context as Record<string, unknown>
      : {},
    approval_context: body.approval_context && typeof body.approval_context === "object" && !Array.isArray(body.approval_context)
      ? body.approval_context as Record<string, unknown>
      : {},
    created_at_iso: String(body.created_at_iso || body.createdAtIso || new Date().toISOString()).trim(),
    filled_at_iso: typeof body.filled_at_iso === "string" && body.filled_at_iso.trim().length > 0 ? body.filled_at_iso.trim() : null,
  };
  await appendExecutionFactJournalEntry(entry);
  await appendAllocationWriterStageTransitions([
    {
      decision_id: entry.decision_id,
      candidate_id: entry.candidate_id,
      trade_lifecycle_id: entry.trade_lifecycle_id,
      portfolio_id: entry.portfolio_id,
      selected_strategy_id: entry.strategy_id,
      writer_version: entry.execution_mode,
      writer_timestamp_iso: entry.created_at_iso,
      previous_stage: entry.approval_id ? "APPROVAL_LINKED" : "PERSISTED",
      next_stage: "EXECUTION_CREATED",
    },
    ...((entry.outcome_id !== null || entry.decision_outcome !== null || entry.avg_fill_price !== null || entry.filled_notional_usd !== null || entry.filled_at_iso !== null) ? [{
      decision_id: entry.decision_id,
      candidate_id: entry.candidate_id,
      trade_lifecycle_id: entry.trade_lifecycle_id,
      portfolio_id: entry.portfolio_id,
      selected_strategy_id: entry.strategy_id,
      writer_version: entry.execution_mode,
      writer_timestamp_iso: entry.filled_at_iso || entry.created_at_iso,
      previous_stage: "EXECUTION_CREATED" as const,
      next_stage: "OUTCOME_CREATED" as const,
    }] : []),
    ...((entry.alpha_attribution.status === "computed"
      && entry.alpha_attribution.regime_contribution_usd !== null
      && entry.alpha_attribution.signal_contribution_usd !== null
      && entry.alpha_attribution.execution_contribution_usd !== null) ? [{
        decision_id: entry.decision_id,
        candidate_id: entry.candidate_id,
        trade_lifecycle_id: entry.trade_lifecycle_id,
        portfolio_id: entry.portfolio_id,
        selected_strategy_id: entry.strategy_id,
        writer_version: entry.execution_mode,
        writer_timestamp_iso: entry.created_at_iso,
        previous_stage: "OUTCOME_CREATED" as const,
        next_stage: "ATTRIBUTION_CREATED" as const,
      }] : []),
  ]);
  return NextResponse.json({ ok: true, entry });
}