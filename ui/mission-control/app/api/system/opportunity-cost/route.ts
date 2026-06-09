import { NextRequest, NextResponse } from "next/server";

import { appendAllocationWriterStageTransition } from "../../../../lib/allocationWriterAuditJournal";
import { getControlPlaneToken } from "../../../../lib/controlPlane";
import { scorePendingOpportunityCostEntries } from "../../../../lib/opportunityCostScorer";
import {
  appendOpportunityCostJournalEntry,
  readOpportunityCostJournalEntries,
  type OpportunityCostAttribution,
  type OpportunityCostJournalEntry,
} from "../../../../lib/opportunityCostJournal";

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

function parseDecisionType(value: unknown): OpportunityCostJournalEntry["decision_type"] {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "executed" || normalized === "ignored" || normalized === "missed") {
    return normalized;
  }
  return "refused";
}

function parseStatus(value: unknown): OpportunityCostJournalEntry["status"] {
  return String(value || "").trim().toLowerCase() === "scored" ? "scored" : "pending";
}

function parseOptionalDecisionType(value: string | null): OpportunityCostJournalEntry["decision_type"] | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }
  return parseDecisionType(value);
}

function parseOptionalStatus(value: string | null): OpportunityCostJournalEntry["status"] | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }
  return parseStatus(value);
}

function normalizeOpportunityAttribution(payload: unknown, fallback: {
  gateReason: string | null;
  expectedAlphaBps: number | null;
  realizedMoveBps: number | null;
  opportunityCostBps: number | null;
  status: OpportunityCostJournalEntry["status"];
}): OpportunityCostAttribution {
  const input = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Partial<OpportunityCostAttribution>
    : {};
  const expectedAlphaBps = toNumberOrNull(input.expected_alpha_bps) ?? fallback.expectedAlphaBps;
  const realizedMoveBps = toNumberOrNull(input.realized_move_bps) ?? fallback.realizedMoveBps;
  const opportunityCostBps = fallback.opportunityCostBps;
  return {
    status: (() => {
      const normalized = String(input.status || fallback.status).trim().toLowerCase();
      return normalized === "computed" || normalized === "scored" ? "computed" : "pending";
    })(),
    gate_reason: typeof input.gate_reason === "string" && input.gate_reason.trim().length > 0 ? input.gate_reason.trim() : fallback.gateReason,
    expected_alpha_bps: expectedAlphaBps,
    realized_move_bps: realizedMoveBps,
    missed_alpha_bps: toNumberOrNull(input.missed_alpha_bps) ?? (opportunityCostBps !== null && opportunityCostBps > 0 ? opportunityCostBps : 0),
    saved_loss_bps: toNumberOrNull(input.saved_loss_bps) ?? (opportunityCostBps !== null && opportunityCostBps < 0 ? Math.abs(opportunityCostBps) : 0),
    counterfactual_confidence: toNumberOrNull(input.counterfactual_confidence),
    matching_quality: toNumberOrNull(input.matching_quality),
    followup_delay_minutes: toNumberOrNull(input.followup_delay_minutes),
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
  const decisionType = parseOptionalDecisionType(request.nextUrl.searchParams.get("decisionType"));
  const status = parseOptionalStatus(request.nextUrl.searchParams.get("status"));
  const limit = Number(request.nextUrl.searchParams.get("limit") || 100);
  const sinceDays = Number(request.nextUrl.searchParams.get("sinceDays") || 0);
  const entries = await readOpportunityCostJournalEntries({ symbol, strategyId, portfolioId, decisionId, decisionType, status, limit, sinceDays });
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
    const result = await scorePendingOpportunityCostEntries({
      symbol: String(body.symbol || "").trim().toUpperCase(),
      strategyId: String(body.strategy_id || body.strategyId || "").trim(),
      portfolioId: String(body.portfolio_id || body.portfolioId || "").trim(),
      limit: Number(body.limit || 100),
      sinceDays: Number(body.sinceDays || 14),
      defaultHorizonMinutes: Number(body.defaultHorizonMinutes || body.horizonMinutes || 90),
    });
    return NextResponse.json({ ok: true, result });
  }
  const venue = String(body.venue || "").trim();
  const instrument = String(body.instrument || body.symbol || "").trim().toUpperCase();
  const timeframe = String(body.timeframe || "").trim();
  const side = String(body.side || "").trim();
  if (!venue || !instrument || !timeframe || !side) {
    return NextResponse.json({ message: "venue, instrument, timeframe and side are required" }, { status: 400 });
  }
  const entryId = String(body.entry_id || body.entryId || buildId("oppcost")).trim();
  const decisionId = typeof body.decision_id === "string" && body.decision_id.trim().length > 0 ? body.decision_id.trim() : null;
  const intentId = typeof body.intent_id === "string" && body.intent_id.trim().length > 0 ? body.intent_id.trim() : null;
  const entry: OpportunityCostJournalEntry = {
    entry_id: entryId,
    trade_lifecycle_id: String(body.trade_lifecycle_id || body.tradeLifecycleId || decisionId || "").trim() || null,
    candidate_id: String(body.candidate_id || body.candidateId || intentId || "").trim() || null,
    decision_id: decisionId,
    approval_id: String(body.approval_id || body.approvalId || "").trim() || null,
    execution_id: String(body.execution_id || body.executionId || "").trim() || null,
    outcome_id: String(body.outcome_id || body.outcomeId || "").trim() || null,
    intent_id: intentId,
    portfolio_id: typeof body.portfolio_id === "string" && body.portfolio_id.trim().length > 0 ? body.portfolio_id.trim() : null,
    strategy_id: typeof body.strategy_id === "string" && body.strategy_id.trim().length > 0 ? body.strategy_id.trim() : null,
    venue,
    instrument,
    timeframe,
    side,
    regime: String(body.regime || "UNKNOWN").trim() || "UNKNOWN",
    decision_type: parseDecisionType(body.decision_type ?? body.decisionType),
    refusal_reason: typeof body.refusal_reason === "string" && body.refusal_reason.trim().length > 0 ? body.refusal_reason.trim() : null,
    gate_name: typeof body.gate_name === "string" && body.gate_name.trim().length > 0 ? body.gate_name.trim() : null,
    predicted_alpha_bps: toNumberOrNull(body.predicted_alpha_bps ?? body.predictedAlphaBps),
    ex_post_market_move_bps: toNumberOrNull(body.ex_post_market_move_bps ?? body.exPostMarketMoveBps),
    ex_post_opportunity_cost_bps: toNumberOrNull(body.ex_post_opportunity_cost_bps ?? body.exPostOpportunityCostBps),
    captured_price: toNumberOrNull(body.captured_price ?? body.capturedPrice),
    horizon_minutes: Math.max(0, Math.round(Number(body.horizon_minutes || body.horizonMinutes || 0))),
    opportunity_attribution: normalizeOpportunityAttribution(body.opportunity_attribution ?? body.opportunityAttribution, {
      gateReason: typeof body.gate_name === "string" && body.gate_name.trim().length > 0
        ? body.gate_name.trim()
        : typeof body.refusal_reason === "string" && body.refusal_reason.trim().length > 0
          ? body.refusal_reason.trim()
          : null,
      expectedAlphaBps: toNumberOrNull(body.predicted_alpha_bps ?? body.predictedAlphaBps),
      realizedMoveBps: toNumberOrNull(body.ex_post_market_move_bps ?? body.exPostMarketMoveBps),
      opportunityCostBps: toNumberOrNull(body.ex_post_opportunity_cost_bps ?? body.exPostOpportunityCostBps),
      status: parseStatus(body.status),
    }),
    market_context: body.market_context && typeof body.market_context === "object" && !Array.isArray(body.market_context)
      ? body.market_context as Record<string, unknown>
      : {},
    approval_context: body.approval_context && typeof body.approval_context === "object" && !Array.isArray(body.approval_context)
      ? body.approval_context as Record<string, unknown>
      : {},
    status: parseStatus(body.status),
    created_at_iso: String(body.created_at_iso || body.createdAtIso || new Date().toISOString()).trim(),
    scored_at_iso: typeof body.scored_at_iso === "string" && body.scored_at_iso.trim().length > 0 ? body.scored_at_iso.trim() : null,
  };
  await appendOpportunityCostJournalEntry(entry);
  await appendAllocationWriterStageTransition({
    decision_id: entry.decision_id,
    candidate_id: entry.candidate_id,
    trade_lifecycle_id: entry.trade_lifecycle_id,
    portfolio_id: entry.portfolio_id,
    selected_strategy_id: entry.strategy_id,
    writer_version: entry.status,
    writer_timestamp_iso: entry.created_at_iso,
    previous_stage: entry.outcome_id ? "OUTCOME_CREATED" : entry.execution_id ? "EXECUTION_CREATED" : "PERSISTED",
    next_stage: "OPPORTUNITY_CREATED",
  });
  return NextResponse.json({ ok: true, entry });
}