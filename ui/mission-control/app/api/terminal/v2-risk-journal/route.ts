import { NextRequest, NextResponse } from "next/server";

import { getControlPlaneToken } from "../../../../lib/controlPlane";
import { scoreExecutionFactAlphaAttributionEntries } from "../../../../lib/executionAlphaAttributionScorer";
import { appendExecutionFactJournalEntry } from "../../../../lib/executionFactJournal";
import { scorePendingOpportunityCostEntries } from "../../../../lib/opportunityCostScorer";
import { appendOpportunityCostJournalEntry } from "../../../../lib/opportunityCostJournal";
import { appendV2RiskJournalEntry, readV2RiskJournalEntries } from "../../../../lib/v2RiskJournal";

function parseDecisionOutcome(value: unknown): "correct" | "false_positive" | "unknown" | undefined {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "correct" || normalized === "false_positive" || normalized === "unknown") {
    return normalized;
  }
  return undefined;
}

function unauthorized(): NextResponse {
  return NextResponse.json({ message: "Authentication required" }, { status: 401 });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown, fallback = ""): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildDecisionId(entry: { id: string }, meta: Record<string, unknown>): string {
  const tradeResult = asRecord(meta.trade_result);
  const decisionAudit = asRecord(meta.decision_audit);
  const determinism = asRecord(decisionAudit.determinism);
  return asString(
    tradeResult.decision_id
      || meta.decision_id
      || determinism.decision_hash
      || decisionAudit.oracleFingerprint
      || `${entry.id}-decision`,
  );
}

function buildIntentId(entry: { id: string }, meta: Record<string, unknown>, decisionId: string): string {
  const tradeResult = asRecord(meta.trade_result);
  return asString(tradeResult.intent_id || meta.intent_id || `${decisionId || entry.id}-intent`);
}

function buildTradeLifecycleId(entry: { id: string }, meta: Record<string, unknown>, decisionId: string): string {
  const tradeResult = asRecord(meta.trade_result);
  return asString(tradeResult.trade_lifecycle_id || meta.trade_lifecycle_id || decisionId || `${entry.id}-lifecycle`);
}

function buildCandidateId(meta: Record<string, unknown>, intentId: string): string {
  const decisionAudit = asRecord(meta.decision_audit);
  const determinism = asRecord(decisionAudit.determinism);
  return asString(meta.candidate_id || decisionAudit.oracleFingerprint || determinism.decision_hash || intentId);
}

function buildApprovalId(meta: Record<string, unknown>): string | null {
  const tradeResult = asRecord(meta.trade_result);
  return asString(tradeResult.approval_id || meta.approval_id || "") || null;
}

function buildExecutionId(entry: { id: string }, meta: Record<string, unknown>): string | null {
  const tradeResult = asRecord(meta.trade_result);
  return asString(tradeResult.execution_id || tradeResult.order_id || tradeResult.id || meta.execution_id || `exec-${entry.id}`) || null;
}

function buildOutcomeId(entry: { id: string }, meta: Record<string, unknown>, fallback: string): string | null {
  const tradeResult = asRecord(meta.trade_result);
  return asString(tradeResult.outcome_id || meta.outcome_id || fallback) || null;
}

function buildVenue(meta: Record<string, unknown>): string {
  const tradeResult = asRecord(meta.trade_result);
  const truth = asRecord(meta.final_decision_truth);
  return asString(tradeResult.venue || meta.venue || truth.preferred_venue || "unknown");
}

function buildPortfolioId(meta: Record<string, unknown>): string {
  const tradeResult = asRecord(meta.trade_result);
  const orderIntent = asRecord(meta.order_intent);
  const intentTarget = asRecord(meta.intent_target);
  return asString(tradeResult.portfolio_id || orderIntent.portfolio_id || intentTarget.portfolio_id || meta.portfolio_id || "unknown");
}

function buildFinalDecisionContext(meta: Record<string, unknown>): Record<string, unknown> {
  const truth = asRecord(meta.final_decision_truth);
  const marketTruth = asRecord(truth.market_truth);
  const informationDensity = asRecord(truth.information_density);
  const executionRealityMemory = asRecord(truth.execution_reality_memory);
  return {
    final_decision_action: asString(truth.action || "UNKNOWN"),
    final_decision_state: asString(truth.state || "UNKNOWN"),
    blocking_layer: asString(truth.blocking_layer || "none"),
    market_truth_state: asString(marketTruth.state || "UNKNOWN"),
    information_density_state: asString(informationDensity.state || "UNKNOWN"),
    execution_reality_regime: asString(executionRealityMemory.regime || "UNKNOWN"),
    reasons: Array.isArray(truth.reasons) ? truth.reasons.map((reason) => String(reason || "").trim()).filter(Boolean).slice(0, 8) : [],
    summary_label: asString(truth.summary_label || ""),
    detail_label: asString(truth.detail_label || ""),
  };
}

function buildRegime(meta: Record<string, unknown>): string {
  const truth = asRecord(meta.final_decision_truth);
  const executionRealityMemory = asRecord(truth.execution_reality_memory);
  return asString(executionRealityMemory.regime || asRecord(truth.market_truth).state || "UNKNOWN", "UNKNOWN");
}

function buildDeterminism(meta: Record<string, unknown>): Record<string, unknown> {
  const decisionAudit = asRecord(meta.decision_audit);
  const determinism = asRecord(decisionAudit.determinism);
  const oracleFingerprint = asString(decisionAudit.oracleFingerprint || "");
  return {
    ...determinism,
    oracle_fingerprint: oracleFingerprint || undefined,
  };
}

function buildCorrelationContext(entry: {
  id: string;
  symbol: string;
  timeframe: string;
  strategy: string;
  action: string;
}, meta: Record<string, unknown>, decisionId: string, intentId: string, portfolioId: string, venue: string, side: string, ids: {
  tradeLifecycleId: string;
  candidateId: string;
  approvalId: string | null;
  executionId: string | null;
  outcomeId: string | null;
}): Record<string, unknown> {
  const decisionAudit = asRecord(meta.decision_audit);
  const determinism = asRecord(decisionAudit.determinism);
  return {
    correlation_key: [decisionId, intentId, portfolioId, entry.symbol, entry.timeframe, entry.strategy].filter(Boolean).join("|"),
    trade_lifecycle_id: ids.tradeLifecycleId,
    candidate_id: ids.candidateId,
    decision_id: decisionId,
    approval_id: ids.approvalId,
    execution_id: ids.executionId,
    outcome_id: ids.outcomeId,
    intent_id: intentId,
    portfolio_id: portfolioId,
    strategy_id: entry.strategy,
    instrument: entry.symbol,
    timeframe: entry.timeframe,
    venue,
    side,
    side_known: side.length > 0 && side !== "unknown",
    decision_hash: asString(determinism.decision_hash || ""),
    oracle_fingerprint: asString(decisionAudit.oracleFingerprint || ""),
    followup_expected: entry.action === "execution-v7-blocked",
  };
}

function isExecutionOutcomeAction(action: string): boolean {
  return action.startsWith("execution-v7-outcome-");
}

function isOpportunityRefusalAction(action: string): boolean {
  return action === "execution-v7-blocked"
    || action === "execution-disabled-policy"
    || action === "execution-disabled-fallback"
    || action === "execution-disabled-routing";
}

async function appendDerivedArtifacts(entry: {
  id: string;
  createdAtIso: string;
  symbol: string;
  timeframe: string;
  strategy: string;
  action: string;
  detail: string;
  decisionOutcome?: "correct" | "false_positive" | "unknown";
  meta?: Record<string, unknown>;
}): Promise<void> {
  const meta = entry.meta || {};
  const tradeResult = asRecord(meta.trade_result);
  const decisionId = buildDecisionId(entry, meta);
  const intentId = buildIntentId(entry, meta, decisionId);
  const tradeLifecycleId = buildTradeLifecycleId(entry, meta, decisionId);
  const candidateId = buildCandidateId(meta, intentId);
  const approvalId = buildApprovalId(meta);
  const executionId = buildExecutionId(entry, meta);
  const outcomeId = buildOutcomeId(entry, meta, `outcome-${entry.id}`);
  const venue = buildVenue(meta);
  const portfolioId = buildPortfolioId(meta);
  const regime = buildRegime(meta);
  const decisionAudit = asRecord(meta.decision_audit);
  const side = asString(tradeResult.side || meta.side || "unknown");
  const correlationContext = buildCorrelationContext(entry, meta, decisionId, intentId, portfolioId, venue, side, {
    tradeLifecycleId,
    candidateId,
    approvalId,
    executionId,
    outcomeId,
  });
  const marketContext = {
    ...buildFinalDecisionContext(meta),
    journal_action: entry.action,
    journal_detail: entry.detail,
    correlation: correlationContext,
  };

  if (isExecutionOutcomeAction(entry.action)) {
    const factId = `exfact-${entry.id}`;
    await appendExecutionFactJournalEntry({
      fact_id: factId,
      trade_lifecycle_id: tradeLifecycleId,
      candidate_id: candidateId,
      decision_id: decisionId,
      approval_id: approvalId,
      execution_id: executionId,
      outcome_id: buildOutcomeId(entry, meta, `outcome-${factId}`),
      intent_id: intentId,
      order_id: asString(tradeResult.order_id || tradeResult.id || "") || null,
      portfolio_id: portfolioId,
      strategy_id: entry.strategy,
      venue,
      instrument: entry.symbol,
      timeframe: entry.timeframe,
      side,
      execution_mode: asString(tradeResult.execution_mode || tradeResult.mode || "paper"),
      approval_level: asString(meta.approval_mode || tradeResult.approval_mode || "runtime"),
      approval_timestamp: asString(tradeResult.approved_at || meta.approval_timestamp || "") || null,
      regime_at_decision: regime,
      regime_at_fill: regime,
      decision_outcome: entry.decisionOutcome || null,
      target_notional_usd: asNumberOrNull(tradeResult.requested_notional_usd || tradeResult.target_notional_usd || meta.target_notional_usd),
      filled_notional_usd: asNumberOrNull(tradeResult.filled_notional_usd || tradeResult.executed_notional_usd),
      avg_fill_price: asNumberOrNull(tradeResult.avg_fill_price || tradeResult.fill_price || tradeResult.price),
      determinism: buildDeterminism(meta),
      alpha_attribution: {
        status: "pending",
        pnl_usd: asNumberOrNull(tradeResult.pnl_usd || tradeResult.realized_pnl_usd || tradeResult.net_pnl_usd),
        regime_contribution_usd: null,
        allocation_contribution_usd: null,
        signal_contribution_usd: null,
        execution_contribution_usd: null,
        timing_contribution_usd: null,
        spread_contribution_usd: null,
        slippage_contribution_usd: null,
        allocation_alpha_bps: null,
        signal_alpha_bps: null,
        timing_alpha_bps: null,
        execution_alpha_bps: null,
        spread_cost_bps: null,
        slippage_cost_bps: null,
        alpha_confidence: null,
        sample_size: null,
        attribution_version: null,
        notes: [
          asString(decisionAudit.code || "attribution_pending"),
          "derived_from_v2_risk_journal",
        ].filter(Boolean),
      },
      market_context: {
        ...marketContext,
        trade_result_status: asString(tradeResult.status || tradeResult.execution_status || "unknown"),
      },
      approval_context: {
        decision_audit: decisionAudit,
        correlation: correlationContext,
      },
      created_at_iso: entry.createdAtIso,
      filled_at_iso: asString(tradeResult.timestamp || tradeResult.filled_at || "") || null,
    });
    await scoreExecutionFactAlphaAttributionEntries({
      decisionId,
      portfolioId: portfolioId === "unknown" ? "" : portfolioId,
      symbol: entry.symbol,
      strategyId: entry.strategy,
      limit: 24,
      sinceDays: 14,
    });
  }

  if (isOpportunityRefusalAction(entry.action)) {
    await appendOpportunityCostJournalEntry({
      entry_id: `opp-${entry.id}`,
      trade_lifecycle_id: tradeLifecycleId,
      candidate_id: candidateId,
      decision_id: decisionId,
      approval_id: approvalId,
      execution_id: null,
      outcome_id: null,
      intent_id: intentId,
      portfolio_id: portfolioId,
      strategy_id: entry.strategy,
      venue,
      instrument: entry.symbol,
      timeframe: entry.timeframe,
      side,
      regime,
      decision_type: "refused",
      refusal_reason: asString(entry.detail || decisionAudit.summary || "blocked"),
      gate_name: asString(decisionAudit.code || (marketContext as Record<string, unknown>).blocking_layer || entry.action),
      predicted_alpha_bps: asNumberOrNull(asRecord(meta.final_decision_truth).risk_multiplier),
      ex_post_market_move_bps: null,
      ex_post_opportunity_cost_bps: null,
      captured_price: asNumberOrNull(tradeResult.price || tradeResult.avg_fill_price || meta.price),
      horizon_minutes: 0,
      opportunity_attribution: {
        status: "pending",
        gate_reason: asString(decisionAudit.code || (marketContext as Record<string, unknown>).blocking_layer || entry.action),
        expected_alpha_bps: asNumberOrNull(asRecord(meta.final_decision_truth).risk_multiplier),
        realized_move_bps: null,
        missed_alpha_bps: null,
        saved_loss_bps: null,
        counterfactual_confidence: null,
        matching_quality: null,
        followup_delay_minutes: null,
        notes: ["derived_from_v2_risk_journal"],
      },
      market_context: marketContext,
      approval_context: {
        decision_audit: decisionAudit,
        correlation: correlationContext,
      },
      status: "pending",
      created_at_iso: entry.createdAtIso,
      scored_at_iso: null,
    });
  }

  if (isExecutionOutcomeAction(entry.action) || isOpportunityRefusalAction(entry.action)) {
    await scorePendingOpportunityCostEntries({
      symbol: entry.symbol,
      strategyId: entry.strategy,
      portfolioId: portfolioId === "unknown" ? "" : portfolioId,
      limit: 24,
      sinceDays: 14,
      defaultHorizonMinutes: 90,
    });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = await getControlPlaneToken();
  if (!token) {
    return unauthorized();
  }

  const symbol = request.nextUrl.searchParams.get("symbol") || "";
  const timeframe = request.nextUrl.searchParams.get("timeframe") || "";
  const strategy = request.nextUrl.searchParams.get("strategy") || "";
  const action = request.nextUrl.searchParams.get("action") || "";
  const limit = Number(request.nextUrl.searchParams.get("limit") || 40);
  const sinceDays = Number(request.nextUrl.searchParams.get("sinceDays") || 0);

  const entries = await readV2RiskJournalEntries({ symbol, timeframe, strategy, action, limit, sinceDays });
  return NextResponse.json({ entries });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = await getControlPlaneToken();
  if (!token) {
    return unauthorized();
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const symbol = String(body.symbol || "").trim().toUpperCase();
  const timeframe = String(body.timeframe || "").trim();
  const strategy = String(body.strategy || "").trim();
  const action = String(body.action || "").trim();
  const detail = String(body.detail || "").trim();
  const decisionOutcome = parseDecisionOutcome(body.decisionOutcome);
  const meta = (body.meta && typeof body.meta === "object") ? (body.meta as Record<string, unknown>) : undefined;

  if (!symbol || !timeframe || !strategy || !action || !detail) {
    return NextResponse.json({ message: "symbol, timeframe, strategy, action and detail are required" }, { status: 400 });
  }

  const entry = {
    id: `v2risk-${Date.now()}-${Math.floor(Math.random() * 100_000)}`,
    createdAtIso: new Date().toISOString(),
    symbol,
    timeframe,
    strategy,
    action,
    detail,
    decisionOutcome,
    meta,
  };

  await appendV2RiskJournalEntry(entry);
  await appendDerivedArtifacts(entry);
  return NextResponse.json({ ok: true, entry });
}
