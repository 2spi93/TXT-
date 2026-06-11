import { Pool } from "pg";

import {
  APPROVAL_DECISION_JOURNAL_SCHEMA_VERSION,
  appendApprovalDecisionJournalEntry,
  readApprovalDecisionJournalEntries,
  type ApprovalDecisionJournalEntry,
} from "./approvalDecisionJournal";
import {
  appendExecutionFactJournalEntry,
  readExecutionFactJournalEntries,
  type ExecutionFactJournalEntry,
} from "./executionFactJournal";

type JsonMap = Record<string, unknown>;

type CanonicalMt5LiveApprovalRow = {
  approval_id: string;
  account_id: string | null;
  order_payload: JsonMap;
  first_approved_by: string | null;
  second_approved_by: string | null;
  status: string;
  execution_result: JsonMap;
  created_at_iso: string;
  executed_at_iso: string | null;
};

type CanonicalBackfillSummary = {
  canonical_rows: number;
  journal_rows: number;
  appended_rows: number;
};

let pool: Pool | null = null;

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonMap
    : {};
}

function asString(value: unknown, fallback = ""): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeOptionalId(value: unknown): string | null {
  const normalized = asString(value);
  return normalized ? normalized : null;
}

function normalizeNumberOrNull(value: unknown): number | null {
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

function approvalJournalKey(entry: ApprovalDecisionJournalEntry): string {
  return `${entry.approval_id}:${entry.approval_stage}`;
}

function executionFactJournalKey(entry: ExecutionFactJournalEntry): string {
  return entry.fact_id;
}

function getPool(): Pool | null {
  const connectionString = asString(process.env.DATABASE_URL);
  if (!connectionString) {
    return null;
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 4,
      idleTimeoutMillis: 15_000,
      connectionTimeoutMillis: 4_000,
    });
  }
  return pool;
}

function normalizeCanonicalRow(raw: unknown): CanonicalMt5LiveApprovalRow | null {
  const row = asRecord(raw);
  const approvalId = asString(row.approval_id);
  const status = asString(row.status);
  const createdAtIso = asString(row.created_at_iso || row.created_at);
  if (!approvalId || !status || !createdAtIso) {
    return null;
  }
  return {
    approval_id: approvalId,
    account_id: normalizeOptionalId(row.account_id),
    order_payload: asRecord(row.order_payload),
    first_approved_by: normalizeOptionalId(row.first_approved_by),
    second_approved_by: normalizeOptionalId(row.second_approved_by),
    status,
    execution_result: asRecord(row.execution_result),
    created_at_iso: createdAtIso,
    executed_at_iso: normalizeOptionalId(row.executed_at_iso || row.executed_at),
  };
}

function projectCanonicalApprovalDecisionEntry(row: CanonicalMt5LiveApprovalRow): ApprovalDecisionJournalEntry {
  const orderPayload = asRecord(row.order_payload);
  const metadata = asRecord(orderPayload.metadata);
  const orderIntent = asRecord(orderPayload.order_intent);
  const finalDecisionTruth = pickFirstRecord(metadata.final_decision_truth, orderIntent.final_decision_truth);
  const result = row.status === "executed" ? asRecord(row.execution_result) : {};
  const failure = row.status === "executed" ? {} : asRecord(row.execution_result);
  const failureDetail = asRecord(failure.detail);
  const predictor = pickFirstRecord(failureDetail.predictor, result.predictor);
  const hardeningBase = pickFirstRecord(
    failureDetail.hardening,
    result.go_live_hardening,
    orderPayload.go_live_hardening,
    metadata.go_live_hardening,
  );
  const hardening = row.status === "cancelled"
    ? {}
    : Object.keys(predictor).length > 0
    ? { ...hardeningBase, predictor }
    : hardeningBase;
  const routedExecution = asRecord(result.routed_execution);
  const decisionId = firstNonEmpty(
    routedExecution.decision_id,
    result.decision_id,
    failureDetail.decision_id,
    orderPayload.decision_id,
    metadata.decision_id,
    orderIntent.decision_id,
    row.approval_id,
  );
  const tradeLifecycleId = firstNonEmpty(
    result.trade_lifecycle_id,
    failureDetail.trade_lifecycle_id,
    orderPayload.trade_lifecycle_id,
    metadata.trade_lifecycle_id,
    orderIntent.trade_lifecycle_id,
    decisionId,
  );
  const candidateId = firstNonEmpty(
    result.candidate_id,
    failureDetail.candidate_id,
    orderPayload.candidate_id,
    metadata.candidate_id,
    orderIntent.candidate_id,
    decisionId,
  );
  const executionId = firstNonEmpty(
    result.execution_id,
    result.order_id,
    result.ticket,
    result.position_id,
    routedExecution.decision_id,
  );
  const outcomeId = firstNonEmpty(
    result.outcome_id,
    executionId ? `outcome-${executionId}` : "",
  );
  const failureDetailMessage = typeof failureDetail.detail === "string" ? failureDetail.detail : "";
  const rejectionCode = firstNonEmpty(
    failureDetail.code,
    failureDetail.reason,
    failureDetail.status,
    failure.status,
    row.status === "cancelled" ? "cancelled" : "",
  );
  const rejectionReason = firstNonEmpty(
    failureDetailMessage,
    failureDetail.message,
    failureDetail.reason,
    failureDetail.status,
    failure.status,
  );
  const approvalTimestamp = firstNonEmpty(
    result.approved_at,
    result.executed_at,
    row.executed_at_iso,
    row.created_at_iso,
    new Date().toISOString(),
  );

  return {
    schema_version: APPROVAL_DECISION_JOURNAL_SCHEMA_VERSION,
    approval_fact_id: `${row.approval_id}:approval_2:canonical:${Date.parse(approvalTimestamp) || Date.now()}`,
    approval_id: row.approval_id,
    approval_stage: "approval_2",
    approval_status: row.status,
    trade_lifecycle_id: tradeLifecycleId || null,
    candidate_id: candidateId || null,
    decision_id: decisionId || null,
    causality_confidence: "native",
    allocation_id: normalizeOptionalId(orderPayload.allocation_id),
    execution_id: executionId || null,
    outcome_id: outcomeId || null,
    account_id: row.account_id,
    portfolio_id: normalizeOptionalId(firstNonEmpty(result.portfolio_id, orderPayload.portfolio_id, orderIntent.portfolio_id)),
    strategy_id: normalizeOptionalId(firstNonEmpty(result.strategy_id, metadata.selected_strategy_id, metadata.strategy_id, orderPayload.strategy_id, orderIntent.strategy_id)),
    symbol: firstNonEmpty(result.symbol, orderPayload.symbol).toUpperCase(),
    side: firstNonEmpty(result.side, orderPayload.side, "buy").toLowerCase(),
    lots: normalizeNumberOrNull(result.lots ?? orderPayload.lots),
    estimated_notional_usd: normalizeNumberOrNull(result.estimated_notional_usd ?? orderPayload.estimated_notional_usd),
    approval_mode: firstNonEmpty(orderPayload.approval_mode, "mt5_double_approval"),
    first_approved_by: row.first_approved_by,
    second_approved_by: row.second_approved_by,
    rejection_code: rejectionCode || null,
    rejection_reason: rejectionReason || null,
    predictor_summary: normalizeOptionalId(firstNonEmpty(finalDecisionTruth.state, result.regime_at_fill)),
    hardening,
    risk_context: pickFirstRecord(result.risk_context, orderPayload.risk_context),
    order_payload: orderPayload,
    source_event_category: row.status === "executed"
      ? "mt5_live_order_executed_double_approved"
      : row.status === "cancelled"
        ? "mt5_live_order_stale_approval_cancelled"
        : "mt5_live_order_rejected_after_second_approval",
    created_at_iso: approvalTimestamp,
  };
}

function projectCanonicalExecutionFactEntry(row: CanonicalMt5LiveApprovalRow): ExecutionFactJournalEntry | null {
  if (row.status !== "executed") {
    return null;
  }
  const orderPayload = asRecord(row.order_payload);
  const metadata = asRecord(orderPayload.metadata);
  const orderIntent = asRecord(orderPayload.order_intent);
  const intentTarget = asRecord(orderIntent.intent_target);
  const finalDecisionTruth = pickFirstRecord(metadata.final_decision_truth, orderIntent.final_decision_truth);
  const marketTruth = asRecord(finalDecisionTruth.market_truth);
  const result = asRecord(row.execution_result);
  const routedExecution = asRecord(result.routed_execution);
  const oracleFingerprint = firstNonEmpty(
    finalDecisionTruth.oracle_fingerprint,
    metadata.oracle_fingerprint,
    orderIntent.oracle_fingerprint,
    result.oracle_fingerprint,
  );
  const decisionId = firstNonEmpty(
    routedExecution.decision_id,
    result.decision_id,
    orderPayload.decision_id,
    metadata.decision_id,
    orderIntent.decision_id,
    oracleFingerprint,
    row.approval_id,
  );
  const tradeLifecycleId = firstNonEmpty(
    result.trade_lifecycle_id,
    orderPayload.trade_lifecycle_id,
    metadata.trade_lifecycle_id,
    orderIntent.trade_lifecycle_id,
    oracleFingerprint,
    decisionId,
  );
  const candidateId = firstNonEmpty(
    result.candidate_id,
    orderPayload.candidate_id,
    metadata.candidate_id,
    orderIntent.candidate_id,
    oracleFingerprint,
    decisionId,
  );
  const intentId = firstNonEmpty(
    result.intent_id,
    orderPayload.intent_id,
    orderIntent.intent_id,
    `${decisionId}-intent`,
  );
  const portfolioId = firstNonEmpty(
    result.portfolio_id,
    orderPayload.portfolio_id,
    orderIntent.portfolio_id,
    intentTarget.portfolio_id,
    "unknown",
  );
  const strategyId = firstNonEmpty(
    result.strategy_id,
    metadata.selected_strategy_id,
    metadata.strategy_id,
    orderPayload.strategy_id,
    orderIntent.strategy_id,
    "unknown",
  );
  const executionId = firstNonEmpty(
    result.execution_id,
    result.order_id,
    result.ticket,
    result.position_id,
    row.approval_id,
  );
  const outcomeId = firstNonEmpty(
    result.outcome_id,
    executionId ? `outcome-${executionId}` : "",
    `outcome-approval-${row.approval_id}`,
  );
  const instrument = firstNonEmpty(result.symbol, orderPayload.symbol, orderPayload.instrument).toUpperCase();
  if (!decisionId || !instrument) {
    return null;
  }
  const side = firstNonEmpty(result.side, orderPayload.side, "unknown").toUpperCase();
  const timeframe = firstNonEmpty(result.timeframe, orderPayload.timeframe, orderIntent.timeframe, "1m");
  const venue = firstNonEmpty(result.venue, result.broker, orderPayload.preferred_venue, finalDecisionTruth.preferred_venue, "mt5");
  const approvalTimestamp = firstNonEmpty(
    result.approved_at,
    result.executed_at,
    row.executed_at_iso,
    row.created_at_iso,
    new Date().toISOString(),
  );
  const filledAtIso = firstNonEmpty(result.executed_at, result.filled_at, result.timestamp, row.executed_at_iso, "");

  return {
    fact_id: `exfact-approval-${row.approval_id}`,
    trade_lifecycle_id: tradeLifecycleId || decisionId,
    candidate_id: candidateId || decisionId,
    decision_id: decisionId,
    causality_confidence: "backfilled",
    approval_id: row.approval_id,
    execution_id: executionId || null,
    outcome_id: outcomeId || null,
    intent_id: intentId,
    order_id: firstNonEmpty(result.order_id, result.ticket, executionId) || null,
    portfolio_id: portfolioId,
    strategy_id: strategyId,
    venue,
    instrument,
    timeframe,
    side,
    execution_mode: firstNonEmpty(orderPayload.execution_mode, result.execution_mode, "live"),
    approval_level: firstNonEmpty(orderPayload.approval_mode, "mt5_double_approval"),
    approval_timestamp: approvalTimestamp || null,
    regime_at_decision: firstNonEmpty(marketTruth.state, finalDecisionTruth.state, "UNKNOWN"),
    regime_at_fill: firstNonEmpty(result.regime_at_fill, marketTruth.state, finalDecisionTruth.state, "UNKNOWN"),
    decision_outcome: null,
    target_notional_usd: normalizeNumberOrNull(result.estimated_notional_usd ?? orderPayload.estimated_notional_usd),
    filled_notional_usd: normalizeNumberOrNull(result.executed_notional_usd ?? result.filled_notional_usd ?? orderPayload.estimated_notional_usd),
    avg_fill_price: normalizeNumberOrNull(result.avg_fill_price ?? result.fill_price ?? result.price),
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
      notes: ["approval_canonical_backfill"],
    },
    market_context: {
      source: "mt5_live_approval_canonical_source",
      approval_status: row.status,
      result_status: asString(result.status || row.status),
      market_truth_state: firstNonEmpty(marketTruth.state, finalDecisionTruth.state, "UNKNOWN"),
      preferred_venue: firstNonEmpty(finalDecisionTruth.preferred_venue, venue),
    },
    approval_context: {
      causality_confidence: "backfilled",
      source: "mt5_live_approval_canonical_source",
      approval_id: row.approval_id,
      order_payload: orderPayload,
    },
    created_at_iso: approvalTimestamp,
    filled_at_iso: filledAtIso || null,
  };
}

async function readCanonicalMt5LiveApprovalRows(options?: {
  sinceDays?: number;
  limit?: number;
}): Promise<CanonicalMt5LiveApprovalRow[]> {
  const connectionPool = getPool();
  if (!connectionPool) {
    return [];
  }
  const sinceDays = Math.max(1, Math.min(365, Math.round(Number(options?.sinceDays || 30))));
  const limit = Math.max(1, Math.min(5_000, Math.round(Number(options?.limit || 2_000))));
  const client = await connectionPool.connect();
  try {
    const response = await client.query(
      `
        SELECT approval_id,
               account_id,
               order_payload,
               first_approved_by,
               second_approved_by,
               status,
               execution_result,
               created_at AS created_at_iso,
               executed_at AS executed_at_iso
        FROM mt5_live_approvals
        WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
          AND status IN ('executed', 'rejected', 'cancelled')
        ORDER BY COALESCE(executed_at, created_at) DESC
        LIMIT $2
      `,
      [sinceDays, limit],
    );
    return response.rows
      .map((row) => normalizeCanonicalRow(row))
      .filter((row): row is CanonicalMt5LiveApprovalRow => row !== null);
  } catch {
    return [];
  } finally {
    client.release();
  }
}

export async function readCanonicalMt5ApprovalDecisionEntries(options?: {
  sinceDays?: number;
  limit?: number;
}): Promise<ApprovalDecisionJournalEntry[]> {
  const rows = await readCanonicalMt5LiveApprovalRows(options);
  return rows.map((row) => projectCanonicalApprovalDecisionEntry(row));
}

export async function readCanonicalMt5ExecutionFactEntries(options?: {
  sinceDays?: number;
  limit?: number;
}): Promise<ExecutionFactJournalEntry[]> {
  const rows = await readCanonicalMt5LiveApprovalRows(options);
  return rows
    .map((row) => projectCanonicalExecutionFactEntry(row))
    .filter((row): row is ExecutionFactJournalEntry => row !== null);
}

export async function backfillApprovalDecisionJournalFromCanonicalSource(options?: {
  sinceDays?: number;
  limit?: number;
}): Promise<CanonicalBackfillSummary> {
  const sinceDays = Math.max(1, Math.min(365, Math.round(Number(options?.sinceDays || 30))));
  const limit = Math.max(1, Math.min(5_000, Math.round(Number(options?.limit || 2_000))));
  const [canonicalRows, journalRows] = await Promise.all([
    readCanonicalMt5ApprovalDecisionEntries({ sinceDays, limit }),
    readApprovalDecisionJournalEntries({ sinceDays, limit, stage: "approval_2" }),
  ]);
  const existingKeys = new Set(journalRows.map((entry) => approvalJournalKey(entry)));
  let appendedRows = 0;
  for (const entry of canonicalRows) {
    const key = approvalJournalKey(entry);
    if (existingKeys.has(key)) {
      continue;
    }
    await appendApprovalDecisionJournalEntry(entry);
    existingKeys.add(key);
    appendedRows += 1;
  }
  return {
    canonical_rows: canonicalRows.length,
    journal_rows: journalRows.length,
    appended_rows: appendedRows,
  };
}

export async function backfillExecutionFactJournalFromCanonicalSource(options?: {
  sinceDays?: number;
  limit?: number;
}): Promise<CanonicalBackfillSummary> {
  const sinceDays = Math.max(1, Math.min(365, Math.round(Number(options?.sinceDays || 30))));
  const limit = Math.max(1, Math.min(5_000, Math.round(Number(options?.limit || 2_000))));
  const [canonicalRows, journalRows] = await Promise.all([
    readCanonicalMt5ExecutionFactEntries({ sinceDays, limit }),
    readExecutionFactJournalEntries({ sinceDays, limit }),
  ]);
  const existingKeys = new Set(journalRows.map((entry) => executionFactJournalKey(entry)));
  let appendedRows = 0;
  for (const entry of canonicalRows) {
    const key = executionFactJournalKey(entry);
    if (existingKeys.has(key)) {
      continue;
    }
    await appendExecutionFactJournalEntry(entry);
    existingKeys.add(key);
    appendedRows += 1;
  }
  return {
    canonical_rows: canonicalRows.length,
    journal_rows: journalRows.length,
    appended_rows: appendedRows,
  };
}