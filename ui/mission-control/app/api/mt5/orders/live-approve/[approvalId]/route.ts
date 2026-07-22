import { NextResponse } from "next/server";

import { appendAllocationWriterStageTransitions } from "../../../../../../lib/allocationWriterAuditJournal";
import {
  APPROVAL_DECISION_JOURNAL_SCHEMA_VERSION,
  appendApprovalDecisionJournalEntry,
} from "../../../../../../lib/approvalDecisionJournal";
import {
  appendAllocationDecisionJournalEntry,
  readAllocationDecisionJournalEntries,
  type AllocationDecisionJournalEntry,
} from "../../../../../../lib/allocationDecisionJournal";
import { cpFetchMt5Live } from "../../../../../../lib/controlPlaneMt5Live";
import { appendExecutionFactJournalEntry } from "../../../../../../lib/executionFactJournal";

type JsonMap = Record<string, unknown>;

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonMap
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

function pickFirstRecord(...values: unknown[]): JsonMap {
  for (const value of values) {
    const record = asRecord(value);
    if (Object.keys(record).length > 0) {
      return record;
    }
  }
  return {};
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function resolvePendingRow(rawPayload: unknown, approvalId: string): JsonMap {
  if (Array.isArray(rawPayload)) {
    return rawPayload.find((row) => asString(asRecord(row).approval_id) === approvalId) as JsonMap || {};
  }
  const root = asRecord(rawPayload);
  const rows = Array.isArray(root.rows) ? root.rows : [];
  return rows.find((row) => asString(asRecord(row).approval_id) === approvalId) as JsonMap || {};
}

function normalizeNumberOrNull(value: unknown): number | null {
  const numeric = asNumberOrNull(value);
  return numeric === null || Number.isNaN(numeric) ? null : numeric;
}

function buildAllocationFallback(params: {
  approvalId: string;
  decisionId: string;
  tradeLifecycleId: string;
  candidateId: string;
  portfolioId: string;
  strategyId: string;
  finalDecisionTruth: JsonMap;
  orderPayload: JsonMap;
}): AllocationDecisionJournalEntry | null {
  if (!params.portfolioId) {
    return null;
  }
  const marketTruth = asRecord(params.finalDecisionTruth.market_truth);
  return {
    allocation_id: `alloc-${params.decisionId || params.approvalId}`,
    trade_lifecycle_id: params.tradeLifecycleId || params.decisionId || params.approvalId,
    candidate_id: params.candidateId || params.decisionId || params.approvalId,
    decision_id: params.decisionId || params.approvalId,
    causality_confidence: "backfilled",
    approval_id: params.approvalId,
    execution_id: null,
    outcome_id: null,
    portfolio_id: params.portfolioId,
    selected_strategy_id: params.strategyId,
    allocator_version: "portfolio-allocator-v1",
    capital_mode: asString(params.orderPayload.capital_mode || "unknown", "unknown"),
    evolution_mode: asString(params.orderPayload.evolution_mode || "unknown", "unknown"),
    market_state: asString(marketTruth.state || params.finalDecisionTruth.state || "UNKNOWN", "UNKNOWN"),
    market_regime: asString(params.orderPayload.market_regime || marketTruth.state || "UNKNOWN", "UNKNOWN"),
    market_temperature: asString(params.orderPayload.market_temperature || "UNKNOWN", "UNKNOWN"),
    available_capital_usd: Number(params.orderPayload.available_capital_usd || 0),
    selected_strategy_size_multiplier: Number(params.orderPayload.selected_strategy_size_multiplier || 1),
    truth_quality_pct: Number(params.finalDecisionTruth.score_pct || marketTruth.score_pct || 0),
    memory_cues: [],
    strategies: [],
    created_at_iso: new Date().toISOString(),
  };
}

async function appendCanonicalApprovalArtifacts(approvalId: string, approvalPayloadRaw: unknown, pendingRowRaw: unknown): Promise<void> {
  const approvalPayload = asRecord(approvalPayloadRaw);
  const pendingRow = asRecord(pendingRowRaw);
  const orderPayload = pickFirstRecord(approvalPayload.order_payload, pendingRow.order_payload);
  const result = asRecord(approvalPayload.result);
  if (Object.keys(orderPayload).length === 0) {
    return;
  }

  const metadata = asRecord(orderPayload.metadata);
  const orderIntent = asRecord(orderPayload.order_intent);
  const intentTarget = asRecord(orderIntent.intent_target);
  const finalDecisionTruth = pickFirstRecord(metadata.final_decision_truth, orderIntent.final_decision_truth);
  const marketTruth = asRecord(finalDecisionTruth.market_truth);
  const oracleFingerprint = firstNonEmpty(
    finalDecisionTruth.oracle_fingerprint,
    metadata.oracle_fingerprint,
    orderIntent.oracle_fingerprint,
    result.oracle_fingerprint,
  );
  const decisionId = firstNonEmpty(
    approvalPayload.decision_id,
    result.decision_id,
    orderPayload.decision_id,
    metadata.decision_id,
    orderIntent.decision_id,
    oracleFingerprint,
    approvalId,
  );
  const tradeLifecycleId = firstNonEmpty(
    approvalPayload.trade_lifecycle_id,
    result.trade_lifecycle_id,
    orderPayload.trade_lifecycle_id,
    metadata.trade_lifecycle_id,
    orderIntent.trade_lifecycle_id,
    oracleFingerprint,
    decisionId,
  );
  const candidateId = firstNonEmpty(
    approvalPayload.candidate_id,
    result.candidate_id,
    orderPayload.candidate_id,
    metadata.candidate_id,
    orderIntent.candidate_id,
    oracleFingerprint,
    decisionId,
  );
  const intentId = firstNonEmpty(
    approvalPayload.intent_id,
    result.intent_id,
    orderPayload.intent_id,
    orderIntent.intent_id,
    `${decisionId}-intent`,
  );
  const portfolioId = firstNonEmpty(
    approvalPayload.portfolio_id,
    result.portfolio_id,
    orderPayload.portfolio_id,
    orderIntent.portfolio_id,
    intentTarget.portfolio_id,
    "unknown",
  );
  const strategyId = firstNonEmpty(
    approvalPayload.strategy_id,
    result.strategy_id,
    orderPayload.strategy_id,
    orderIntent.strategy_id,
    metadata.selected_strategy_id,
    metadata.strategy_id,
    "unknown",
  );
  const executionId = firstNonEmpty(
    approvalPayload.execution_id,
    result.execution_id,
    result.order_id,
    result.ticket,
    result.position_id,
    approvalId,
  );
  const outcomeId = firstNonEmpty(
    approvalPayload.outcome_id,
    result.outcome_id,
    executionId ? `outcome-${executionId}` : "",
    `outcome-approval-${approvalId}`,
  );
  const allocations = decisionId
    ? await readAllocationDecisionJournalEntries({ decisionId, limit: 8, sinceDays: 30 })
    : [];
  const baseAllocation = allocations.find((entry) => (
    entry.trade_lifecycle_id === tradeLifecycleId
    || entry.candidate_id === candidateId
    || entry.decision_id === decisionId
  )) || allocations[0] || buildAllocationFallback({
    approvalId,
    decisionId,
    tradeLifecycleId,
    candidateId,
    portfolioId,
    strategyId,
    finalDecisionTruth,
    orderPayload,
  });

  if (baseAllocation) {
    await appendAllocationDecisionJournalEntry({
      ...baseAllocation,
      trade_lifecycle_id: baseAllocation.trade_lifecycle_id || tradeLifecycleId,
      candidate_id: baseAllocation.candidate_id || candidateId,
      decision_id: baseAllocation.decision_id || decisionId,
      causality_confidence: "backfilled",
      approval_id: approvalId,
      execution_id: baseAllocation.execution_id || executionId || null,
      outcome_id: baseAllocation.outcome_id || outcomeId || null,
      created_at_iso: new Date().toISOString(),
    });
  }

  const instrument = firstNonEmpty(result.symbol, orderPayload.symbol, orderPayload.instrument).toUpperCase();
  if (!decisionId || !instrument) {
    return;
  }
  const side = firstNonEmpty(result.side, orderPayload.side, "unknown").toUpperCase();
  const timeframe = firstNonEmpty(result.timeframe, orderPayload.timeframe, orderIntent.timeframe, "1m");
  const venue = firstNonEmpty(result.venue, result.broker, orderPayload.preferred_venue, finalDecisionTruth.preferred_venue, "mt5");
  const approvalTimestamp = firstNonEmpty(result.approved_at, approvalPayload.approved_at, new Date().toISOString());
  const filledAtIso = firstNonEmpty(result.executed_at, result.filled_at, result.timestamp, "");

  await appendExecutionFactJournalEntry({
    fact_id: `exfact-approval-${approvalId}`,
    trade_lifecycle_id: tradeLifecycleId || decisionId,
    candidate_id: candidateId || decisionId,
    decision_id: decisionId,
    causality_confidence: "backfilled",
    approval_id: approvalId,
    execution_id: executionId || null,
    outcome_id: outcomeId || null,
    intent_id: intentId,
    order_id: firstNonEmpty(result.order_id, result.ticket, executionId) || null,
    portfolio_id: portfolioId || "unknown",
    strategy_id: strategyId || "unknown",
    venue,
    instrument,
    timeframe,
    side,
    execution_mode: firstNonEmpty(orderPayload.execution_mode, result.execution_mode, "live"),
    approval_level: "mt5_double_approval",
    approval_timestamp: approvalTimestamp || null,
    regime_at_decision: firstNonEmpty(marketTruth.state, finalDecisionTruth.state, "UNKNOWN"),
    regime_at_fill: firstNonEmpty(result.regime_at_fill, marketTruth.state, finalDecisionTruth.state, "UNKNOWN"),
    decision_outcome: null,
    target_notional_usd: asNumberOrNull(orderPayload.estimated_notional_usd),
    filled_notional_usd: asNumberOrNull(result.executed_notional_usd ?? result.filled_notional_usd ?? orderPayload.estimated_notional_usd),
    avg_fill_price: asNumberOrNull(result.avg_fill_price ?? result.fill_price ?? result.price),
    determinism: {
      ...(oracleFingerprint ? { oracle_fingerprint: oracleFingerprint } : {}),
    },
    alpha_attribution: {
      status: "pending",
      pnl_usd: null,
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
      notes: ["approval_route_backfill"],
    },
    market_context: {
      source: "mt5_live_approve_route",
      approval_status: asString(approvalPayload.status || "executed"),
      result_status: asString(result.status || "executed"),
      market_truth_state: firstNonEmpty(marketTruth.state, finalDecisionTruth.state, "UNKNOWN"),
      preferred_venue: firstNonEmpty(finalDecisionTruth.preferred_venue, venue),
    },
    approval_context: {
      causality_confidence: "backfilled",
      source: "mt5_live_approve_route",
      approval_id: approvalId,
      order_payload: orderPayload,
    },
    created_at_iso: new Date().toISOString(),
    filled_at_iso: filledAtIso || null,
  });
  await appendAllocationWriterStageTransitions([
    {
      decision_id: decisionId,
      candidate_id: candidateId || decisionId,
      trade_lifecycle_id: tradeLifecycleId || decisionId,
      portfolio_id: portfolioId || "unknown",
      selected_strategy_id: strategyId || "unknown",
      writer_version: firstNonEmpty(orderPayload.execution_mode, result.execution_mode, "live"),
      writer_timestamp_iso: approvalTimestamp || new Date().toISOString(),
      previous_stage: "HARDENING_REACHED",
      next_stage: "EXECUTION_CREATED",
    },
    {
      decision_id: decisionId,
      candidate_id: candidateId || decisionId,
      trade_lifecycle_id: tradeLifecycleId || decisionId,
      portfolio_id: portfolioId || "unknown",
      selected_strategy_id: strategyId || "unknown",
      writer_version: firstNonEmpty(orderPayload.execution_mode, result.execution_mode, "live"),
      writer_timestamp_iso: filledAtIso || approvalTimestamp || new Date().toISOString(),
      previous_stage: "EXECUTION_CREATED",
      next_stage: "OUTCOME_CREATED",
    },
  ]);
}

async function appendApprovalDecisionArtifacts(approvalId: string, approvalPayloadRaw: unknown, pendingRowRaw: unknown): Promise<void> {
  const approvalPayload = asRecord(approvalPayloadRaw);
  const pendingRow = asRecord(pendingRowRaw);
  const orderPayload = pickFirstRecord(approvalPayload.order_payload, pendingRow.order_payload);
  const result = asRecord(approvalPayload.result);
  const failure = asRecord(approvalPayload.failure);
  const failureDetail = asRecord(failure.detail);
  const eventCategory = responseEventCategoryFromPayload(approvalPayload);
  const rawHardening = pickFirstRecord(failureDetail.hardening, approvalPayload.hardening, approvalPayload.go_live_hardening, pendingRow.go_live_hardening);
  const hardening = eventCategory === "mt5_live_order_stale_approval_cancelled" ? {} : rawHardening;
  const metadata = asRecord(orderPayload.metadata);
  const orderIntent = asRecord(orderPayload.order_intent);
  const finalDecisionTruth = pickFirstRecord(metadata.final_decision_truth, orderIntent.final_decision_truth);
  const decisionId = firstNonEmpty(
    approvalPayload.decision_id,
    result.decision_id,
    failureDetail.decision_id,
    orderPayload.decision_id,
    metadata.decision_id,
    orderIntent.decision_id,
    approvalId,
  );
  const tradeLifecycleId = firstNonEmpty(
    approvalPayload.trade_lifecycle_id,
    result.trade_lifecycle_id,
    failureDetail.trade_lifecycle_id,
    orderPayload.trade_lifecycle_id,
    metadata.trade_lifecycle_id,
    orderIntent.trade_lifecycle_id,
    decisionId,
  );
  const candidateId = firstNonEmpty(
    approvalPayload.candidate_id,
    result.candidate_id,
    failureDetail.candidate_id,
    orderPayload.candidate_id,
    metadata.candidate_id,
    orderIntent.candidate_id,
    decisionId,
  );
  const executionId = firstNonEmpty(
    approvalPayload.execution_id,
    result.execution_id,
    result.order_id,
    result.ticket,
    result.position_id,
  );
  const outcomeId = firstNonEmpty(
    approvalPayload.outcome_id,
    result.outcome_id,
    executionId ? `outcome-${executionId}` : "",
  );
  const rejectionCode = firstNonEmpty(
    failureDetail.code,
    failureDetail.reason,
    failure.status,
    approvalPayload.status,
  );
  await appendApprovalDecisionJournalEntry({
    schema_version: APPROVAL_DECISION_JOURNAL_SCHEMA_VERSION,
    approval_fact_id: `${approvalId}:approval_2:${Date.now()}`,
    approval_id: approvalId,
    approval_stage: "approval_2",
    approval_status: firstNonEmpty(approvalPayload.status, responseStatusFromPayload(approvalPayload), "approved"),
    trade_lifecycle_id: tradeLifecycleId || null,
    candidate_id: candidateId || null,
    decision_id: decisionId || null,
    causality_confidence: "native",
    allocation_id: firstNonEmpty(approvalPayload.allocation_id) || null,
    execution_id: executionId || null,
    outcome_id: outcomeId || null,
    account_id: firstNonEmpty(approvalPayload.account_id, orderPayload.account_id, pendingRow.account_id) || null,
    portfolio_id: firstNonEmpty(approvalPayload.portfolio_id, result.portfolio_id, orderPayload.portfolio_id, orderIntent.portfolio_id) || null,
    strategy_id: firstNonEmpty(approvalPayload.strategy_id, result.strategy_id, metadata.selected_strategy_id, metadata.strategy_id, orderIntent.strategy_id) || null,
    symbol: firstNonEmpty(result.symbol, approvalPayload.symbol, orderPayload.symbol, pendingRow.symbol).toUpperCase(),
    side: firstNonEmpty(result.side, approvalPayload.side, orderPayload.side, pendingRow.side, "buy").toLowerCase(),
    lots: normalizeNumberOrNull(result.lots ?? approvalPayload.lots ?? orderPayload.lots),
    estimated_notional_usd: normalizeNumberOrNull(result.estimated_notional_usd ?? orderPayload.estimated_notional_usd),
    approval_mode: firstNonEmpty(approvalPayload.approval_mode, "mt5_double_approval"),
    first_approved_by: firstNonEmpty(approvalPayload.first_approved_by, pendingRow.first_approved_by) || null,
    second_approved_by: firstNonEmpty(approvalPayload.second_approved_by, result.second_approved_by) || null,
    rejection_code: rejectionCode || null,
    rejection_reason: firstNonEmpty(failureDetail.detail, failureDetail.message, failureDetail.reason, failure.status) || null,
    predictor_summary: firstNonEmpty(finalDecisionTruth.state, result.regime_at_fill) || null,
    hardening,
    risk_context: pickFirstRecord(approvalPayload.risk_context, pendingRow.risk_context),
    order_payload: orderPayload,
    source_event_category: eventCategory,
    created_at_iso: firstNonEmpty(result.approved_at, approvalPayload.approved_at, approvalPayload.created_at, new Date().toISOString()),
  });
  const approvalCreatedAtIso = firstNonEmpty(result.approved_at, approvalPayload.approved_at, approvalPayload.created_at, new Date().toISOString());
  await appendAllocationWriterStageTransitions([
    {
      decision_id: decisionId || null,
      candidate_id: candidateId || null,
      trade_lifecycle_id: tradeLifecycleId || null,
      portfolio_id: firstNonEmpty(approvalPayload.portfolio_id, result.portfolio_id, orderPayload.portfolio_id, orderIntent.portfolio_id) || null,
      selected_strategy_id: firstNonEmpty(approvalPayload.strategy_id, result.strategy_id, metadata.selected_strategy_id, metadata.strategy_id, orderIntent.strategy_id) || null,
      writer_version: firstNonEmpty(approvalPayload.approval_mode, "mt5_double_approval"),
      writer_timestamp_iso: approvalCreatedAtIso,
      previous_stage: "APPROVAL_CREATED",
      next_stage: "APPROVAL_LINKED",
    },
    ...(Object.keys(hardening).length > 0 ? [{
      decision_id: decisionId || null,
      candidate_id: candidateId || null,
      trade_lifecycle_id: tradeLifecycleId || null,
      portfolio_id: firstNonEmpty(approvalPayload.portfolio_id, result.portfolio_id, orderPayload.portfolio_id, orderIntent.portfolio_id) || null,
      selected_strategy_id: firstNonEmpty(approvalPayload.strategy_id, result.strategy_id, metadata.selected_strategy_id, metadata.strategy_id, orderIntent.strategy_id) || null,
      writer_version: firstNonEmpty(approvalPayload.approval_mode, "mt5_double_approval"),
      writer_timestamp_iso: approvalCreatedAtIso,
      previous_stage: "APPROVAL_LINKED" as const,
      next_stage: "HARDENING_REACHED" as const,
    }] : []),
  ]);
}

function responseStatusFromPayload(approvalPayload: JsonMap): string {
  const status = asString(approvalPayload.status).trim();
  if (status) {
    return status;
  }
  const failure = asRecord(approvalPayload.failure);
  if (Object.keys(failure).length > 0) {
    return "rejected";
  }
  return "approved";
}

function responseEventCategoryFromPayload(approvalPayload: JsonMap): string {
  const status = responseStatusFromPayload(approvalPayload);
  if (status.includes("stale")) {
    return "mt5_live_order_stale_approval_cancelled";
  }
  if (status.includes("reject")) {
    return "mt5_live_order_rejected_after_second_approval";
  }
  return "mt5_live_order_executed_double_approved";
}

export async function POST(
  _: Request,
  { params }: { params: Promise<{ approvalId: string }> },
): Promise<NextResponse> {
  const resolved = await params;
  const pendingSnapshot = await cpFetchMt5Live("/v1/mt5/orders/live-pending", {
    method: "GET",
  }).catch(() => null);
  const pendingRow = resolvePendingRow(pendingSnapshot?.payload, resolved.approvalId);
  const result = await cpFetchMt5Live(`/v1/mt5/orders/live-approve/${resolved.approvalId}`, {
    method: "POST",
  });
  const payload = result.payload;
  await appendApprovalDecisionArtifacts(resolved.approvalId, payload, pendingRow).catch(() => null);
  if (result.status >= 200 && result.status < 300) {
    await appendCanonicalApprovalArtifacts(resolved.approvalId, payload, pendingRow).catch(() => null);
  }
  return NextResponse.json(payload, { status: result.status });
}
