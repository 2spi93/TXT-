import assert from "node:assert/strict";

import {
  APPROVAL_DECISION_JOURNAL_SCHEMA_VERSION,
  assertApprovalDecisionJournalEntry,
  type ApprovalDecisionJournalEntry,
} from "../../lib/approvalDecisionJournal";
import {
  assertPredictorRejectionAnalyticsSnapshot,
  PREDICTOR_REJECTION_ANALYTICS_SCHEMA_VERSION,
  type PredictorRejectionAnalyticsSnapshot,
} from "../../lib/predictorRejectionAnalytics";

const validEntry: ApprovalDecisionJournalEntry = {
  schema_version: APPROVAL_DECISION_JOURNAL_SCHEMA_VERSION,
  approval_fact_id: "approval-123:approval_2:1",
  approval_id: "approval-123",
  approval_stage: "approval_2",
  approval_status: "executed",
  trade_lifecycle_id: "trade-123",
  candidate_id: "candidate-123",
  decision_id: "decision-123",
  causality_confidence: "native",
  allocation_id: null,
  execution_id: "execution-123",
  outcome_id: "outcome-123",
  account_id: "mt5-live-1",
  portfolio_id: null,
  strategy_id: null,
  symbol: "BTCUSD",
  side: "buy",
  lots: 0.01,
  estimated_notional_usd: 5,
  approval_mode: "mt5_double_approval",
  first_approved_by: "operator",
  second_approved_by: "admin",
  rejection_code: null,
  rejection_reason: null,
  predictor_summary: null,
  hardening: {},
  risk_context: {},
  order_payload: {},
  source_event_category: "mt5_live_order_executed_double_approved",
  created_at_iso: "2026-06-09T19:40:00.000Z",
};

const normalizedEntry = assertApprovalDecisionJournalEntry(validEntry);
assert.equal(normalizedEntry.schema_version, APPROVAL_DECISION_JOURNAL_SCHEMA_VERSION, "journal entries must preserve the versioned contract");
assert.equal(normalizedEntry.approval_stage, "approval_2", "journal entries must keep the approval stage");

assert.throws(
  () => assertApprovalDecisionJournalEntry({
    ...validEntry,
    created_at_iso: "invalid-date",
  } as ApprovalDecisionJournalEntry),
  /ApprovalDecisionJournal contract violation/,
  "invalid approval journal rows must fail fast instead of silently degrading analytics",
);

const validSnapshot: PredictorRejectionAnalyticsSnapshot = {
  schema_version: PREDICTOR_REJECTION_ANALYTICS_SCHEMA_VERSION,
  generated_at_iso: "2026-06-09T19:40:00.000Z",
  window_days: 30,
  predictor_evaluated_total: 5,
  predictor_accepted_total: 3,
  predictor_rejected_total: 2,
  predictor_acceptance_rate_pct: 60,
  source_diagnostics: {
    rows_scanned: 21,
    rows_returned: 5,
    journal_rows: 21,
    canonical_rows: 5,
    backfilled_rows: 5,
  },
  rejections_by_cause: [],
  top_rejection_causes: [],
  symbol_rows: [],
  session_rows: [],
  regime_rows: [],
  hour_rows: [],
};

const normalizedSnapshot = assertPredictorRejectionAnalyticsSnapshot(validSnapshot);
assert.equal(normalizedSnapshot.schema_version, PREDICTOR_REJECTION_ANALYTICS_SCHEMA_VERSION, "predictor analytics snapshots must expose a versioned contract");
assert.equal(normalizedSnapshot.predictor_acceptance_rate_pct, 60, "predictor analytics snapshots must preserve KPI values");

assert.throws(
  () => assertPredictorRejectionAnalyticsSnapshot({
    ...validSnapshot,
    schema_version: "predictor-rejection-analytics/v9" as typeof PREDICTOR_REJECTION_ANALYTICS_SCHEMA_VERSION,
  }),
  /Predictor analytics schema mismatch/,
  "schema drift must fail fast instead of returning a misleading empty predictor panel",
);

console.log("PASS predictor contract regression: approval journal and predictor analytics fail fast on schema drift");