import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  APPROVAL_DECISION_JOURNAL_SCHEMA_VERSION,
  type ApprovalDecisionJournalEntry,
} from "../../lib/approvalDecisionJournal";
import {
  CANONICAL_SPINE_HEALTH_SCHEMA_VERSION,
  type CanonicalSpineHealthSnapshot,
} from "../../lib/canonicalSpineHealth";
import { scanCriticalRouteDivergence } from "../../lib/criticalRouteDivergenceScanner";
import {
  EXECUTION_REALITY_SCHEMA_VERSION,
  type ExecutionRealitySummary,
} from "../../app/terminal/executionRealityScore";
import {
  HARDENING_ANALYTICS_SCHEMA_VERSION,
  type HardeningAnalyticsSnapshot,
} from "../../lib/hardeningAnalytics";
import {
  POSITION_TRUTH_SCHEMA_VERSION,
  type PositionTruthSnapshot,
} from "../../lib/positionTruthContract";
import {
  PREDICTOR_REJECTION_ANALYTICS_SCHEMA_VERSION,
  type PredictorRejectionAnalyticsSnapshot,
} from "../../lib/predictorRejectionAnalytics";
import {
  TRADE_LIFECYCLE_HEALTH_SCHEMA_VERSION,
  type TradeLifecycleHealthSnapshot,
} from "../../lib/tradeLifecycleHealth";
import type { TruthReliabilitySnapshot } from "../../lib/truthReliabilityIndex";

const approvalRow: ApprovalDecisionJournalEntry = {
  schema_version: APPROVAL_DECISION_JOURNAL_SCHEMA_VERSION,
  approval_fact_id: "approval-1:approval_2:1",
  approval_id: "approval-1",
  approval_stage: "approval_2",
  approval_status: "executed",
  trade_lifecycle_id: "tl-1",
  candidate_id: "candidate-1",
  decision_id: "decision-1",
  causality_confidence: "native",
  allocation_id: null,
  execution_id: "execution-1",
  outcome_id: "outcome-1",
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
  created_at_iso: "2026-06-09T20:00:00.000Z",
};

const predictorSnapshot: PredictorRejectionAnalyticsSnapshot = {
  schema_version: PREDICTOR_REJECTION_ANALYTICS_SCHEMA_VERSION,
  generated_at_iso: "2026-06-09T20:00:00.000Z",
  window_days: 30,
  predictor_evaluated_total: 1,
  predictor_accepted_total: 1,
  predictor_rejected_total: 0,
  predictor_acceptance_rate_pct: 100,
  source_diagnostics: {
    rows_scanned: 1,
    rows_returned: 1,
    journal_rows: 1,
    canonical_rows: 1,
    backfilled_rows: 0,
  },
  rejections_by_cause: [],
  top_rejection_causes: [],
  symbol_rows: [],
  session_rows: [],
  regime_rows: [],
  hour_rows: [],
};

const positionTruth: PositionTruthSnapshot = {
  schema_version: POSITION_TRUTH_SCHEMA_VERSION,
  status: "ok",
  as_of: "2026-06-09T20:00:00.000Z",
  account: { account_id: "mt5-live-1" },
  mt5_account: {},
  connector_account: {},
  balances: [{ asset_symbol: "USD", amount: 1000 }],
  positions: [{ symbol: "BTCUSD", qty: 0.01 }],
  open_orders: [],
  portfolio_links: [],
  latest_portfolio_snapshots: [],
  normalized_state: { status: "ok", as_of: "2026-06-09T20:00:00.000Z" },
  cash_vs_equivalent: {},
  capital_truth: null,
  broker_state_snapshot: {},
  pocket_views: [],
  capital_ledger: [],
};

const executionTruth: ExecutionRealitySummary = {
  schema_version: EXECUTION_REALITY_SCHEMA_VERSION,
  state: "ALIGNED",
  score_pct: 96,
  allow_new_risk: true,
  blocks_execution: false,
  size_cap_pct: 100,
  summary_label: "EXEC REAL ALIGNED 96%",
  reasons: [],
  dominant_drag: "NONE",
  metrics: {
    execution_samples: 12,
    liquidity_samples: 10,
    slippage_bps: 0.8,
    latency_ms: 42,
    fill_rate_pct: 96,
    liquidity_accuracy_pct: 94,
    stability_mode: "live",
    stability_monitor_pct: 97,
    drift_watchdog: "CALM",
    optimization_action: "hold",
  },
};

const exposureTruth = {
  status: "ok",
  gross_exposure_usd: 125000,
  net_exposure_usd: 84500,
  open_positions: 3,
  account_count: 2,
};

const settlementTruth = {
  status: "ok",
  settlement_policy: "hybrid",
  reconciliation_usd: 0,
  ledger_event_count: 4,
};

const replayTruth = {
  decision_id: "decision-1",
  certified: true,
  route_chosen: "mt5",
  fill_count: 1,
  validation_source: "golden-replay",
  artifact: "native",
};

const truthReliabilityIndex: TruthReliabilitySnapshot = {
  score_pct: 88,
  raw_score_pct: 88,
  status: "certified",
  cap_pct: 88,
  cap_reasons: [],
  components: {
    decision_continuity_pct: 88,
    evidence_quality_pct: 90,
    spine_match_rate_pct: 92,
    snapshot_freshness_pct: 84,
    runtime_truth_snapshot_age_ms: 1000,
    canonical_spine_snapshot_age_ms: 1000,
  },
};

const canonicalSpine: CanonicalSpineHealthSnapshot = {
  schema_version: CANONICAL_SPINE_HEALTH_SCHEMA_VERSION,
  generated_at_iso: "2026-06-09T20:00:00.000Z",
  window_days: 30,
  source_diagnostics: { rows_scanned: 4, rows_returned: 1 },
  spine_match_rate_pct: 92,
  allocation_link_rate_pct: 100,
  approval_link_rate_pct: 100,
  approval_execution_link_rate_pct: 100,
  hardening_link_rate_pct: 100,
  execution_link_rate_pct: 100,
  outcome_link_rate_pct: 100,
  opportunity_link_rate_pct: 100,
  opportunity_link_rate_raw_pct: 100,
  opportunity_link_rate_post_producer_pct: 100,
  execution_derivation_rate_pct: 100,
  allocation_decisions_24h: 1,
  approval_decisions_24h: 1,
  execution_facts_24h: 1,
  opportunity_entries_24h: 1,
  unique_strategies_24h: 1,
  allocation_linked_total: 1,
  approval_linked_total: 1,
  approval_execution_linked_total: 1,
  hardening_linked_total: 1,
  execution_linked_total: 1,
  execution_source_total: 1,
  execution_outcome_complete_total: 1,
  refusal_linked_total: 0,
  refusal_source_total: 0,
  refusal_linked_total_raw: 0,
  refusal_source_total_raw: 0,
  refusal_linked_total_post_producer: 0,
  refusal_source_total_post_producer: 0,
  opportunity_scored_total: 1,
  opportunity_pending_total: 0,
  opportunity_matching_rate_pct: 100,
  followup_expected_total: 1,
  followup_expected_scored: 1,
  followup_expected_pending: 0,
  followup_expected_matching_rate_pct: 100,
  alpha_attribution_computed_total: 1,
  alpha_attribution_pending_total: 0,
  alpha_attribution_coverage_pct: 100,
  operational_refusal_total: 0,
  operational_refusal_total_post_producer: 0,
  operational_refusal_by_code: [],
  operational_refusal_by_code_post_producer: [],
  pending_by_gate: [],
};

const hardeningAnalytics: HardeningAnalyticsSnapshot = {
  schema_version: HARDENING_ANALYTICS_SCHEMA_VERSION,
  generated_at_iso: "2026-06-09T20:00:00.000Z",
  window_days: 30,
  approval_stage_2_total: 1,
  hardening_refused_total: 0,
  unique_decision_total: 1,
  source_diagnostics: { rows_scanned: 1, rows_returned: 0 },
  rows: [],
  top_refusal_causes: [],
  top_cost_causes: [],
  top_missed_alpha_causes: [],
};

const tradeLifecycleHealth: TradeLifecycleHealthSnapshot = {
  schema_version: TRADE_LIFECYCLE_HEALTH_SCHEMA_VERSION,
  generated_at_iso: "2026-06-09T20:00:00.000Z",
  window_days: 30,
  source_diagnostics: { rows_scanned: 4, rows_returned: 1 },
  lifecycle_total: 1,
  decision_journey_completion: { created_decision_total: 1, complete_decision_total: 1, incomplete_decision_total: 0, completion_rate_pct: 100 },
  decision_gap_reduction: { incomplete_decision_total: 0, by_stage: [] },
  decision_gap_resolution: {
    created_decision_total: 1,
    open_gap_total: 0,
    resolved_gap_total: 1,
    gap_resolution_rate_pct: 100,
    mean_time_to_continuity_hours: 1,
    dominant_open_gap_stage_key: null,
    dominant_open_gap_label: null,
    dominant_open_gap_total: 0,
    dominant_open_gap_share_pct: 0,
    backlog_age_buckets: [],
    oldest_open_gap: null,
    dominant_gap_cardinality: null,
    dominant_gap_top_decisions: [],
    recently_resolved_gaps: [],
    gap_ledger: [],
  },
  allocation_writer_closure: {
    dominant_root_cause_code: null,
    dominant_root_cause_label: null,
    state_machine: { allocation_created_total: 1, allocation_closed_total: 1, allocation_open_total: 0 },
    writer_coverage: { closure_rate_pct: 100, root_cause_closure_rate_pct: 100, root_cause_concentration_pct: 0, dominant_root_cause_label: "none" },
    identity_propagation: { propagation_rate_pct: 100 },
    writer_propagation: { propagation_rate_pct: 100 },
    writer_latency: { p50_ms: 10, p95_ms: 20 },
    writer_failure_taxonomy: { by_category: [] },
    closure_evidence: { native_evidence_pct: 100 },
    writer_native_errors: [],
    writer_provenance: [],
  } as unknown as TradeLifecycleHealthSnapshot["allocation_writer_closure"],
  decision_governance: { freeze_controls: [] } as TradeLifecycleHealthSnapshot["decision_governance"],
  link_coverage_score_pct: 100,
  decision_continuity_score_pct: 100,
  decision_evidence_quality: { score_pct: 100, native: 1, backfilled: 0, inferred: 0, missing: 0, by_stage: [] },
  cross_object_lifecycle_total: 1,
  allocation_link_rate_pct: 100,
  approval_link_rate_pct: 100,
  hardening_link_rate_pct: 100,
  execution_link_rate_pct: 100,
  outcome_link_rate_pct: 100,
  attribution_link_rate_pct: 100,
  opportunity_link_rate_pct: 100,
  allocation_linked_total: 1,
  approval_linked_total: 1,
  hardening_linked_total: 1,
  execution_linked_total: 1,
  outcome_linked_total: 1,
  attribution_linked_total: 1,
  opportunity_linked_total: 1,
  causality_confidence: { native: 1, backfilled: 0, inferred: 0 },
  link_confidence: {
    allocation: { native: 1, backfilled: 0, inferred: 0 },
    approval: { native: 1, backfilled: 0, inferred: 0 },
    hardening: { native: 1, backfilled: 0, inferred: 0 },
    execution: { native: 1, backfilled: 0, inferred: 0 },
    outcome: { native: 1, backfilled: 0, inferred: 0 },
    attribution: { native: 1, backfilled: 0, inferred: 0 },
    opportunity: { native: 1, backfilled: 0, inferred: 0 },
  },
  decision_continuity_links: [],
  top_decision_friction: [],
  top_friction_by_gate: [],
  decision_friction: {
    generated_at_iso: "2026-06-09T20:00:00.000Z",
    window_days: 30,
    blocked_total: 0,
    unique_decision_total: 1,
    repeated_decision_total: 0,
    repeated_blocked_total: 0,
    repeated_blocked_share_pct: 0,
    opportunity_cost_bps_total: 0,
    missed_alpha_bps_total: 0,
    capital_impact_usd_total: 0,
    capital_impact_per_decision: 0,
    capital_impact_coverage_pct: 100,
    capital_basis_available_rows: 1,
    capital_basis_missing_rows: 0,
    dominant_gate_name: null,
    dominant_gate_blocked_total: 0,
    dominant_gate_share_pct: 0,
    dominant_cost_gate_name: null,
    dominant_cost_gate_capital_impact_usd: 0,
    dominant_decision_id: null,
    dominant_decision_gate_name: null,
    dominant_decision_blocked_total: 0,
    dominant_decision_share_pct: 0,
    dominant_cost_decision_id: null,
    dominant_cost_decision_gate_name: null,
    dominant_cost_decision_opportunity_cost_bps: 0,
    dominant_cost_decision_missed_alpha_bps: 0,
    dominant_cost_decision_capital_impact_usd: 0,
    watchlist_gates: [],
    top_decisions: [],
    top_gates: [],
    top_cost_decisions: [],
    top_cost_gates: [],
  },
  tri_score: 88,
  tri_status: truthReliabilityIndex.status,
  tri_cap: 88,
  tri_continuity: 88,
  tri_evidence: 90,
  tri_spine_match: 92,
  tri_freshness: 84,
  truth_reliability_index: truthReliabilityIndex,
};

const alignedCertifiedOutcomes = Array.from({ length: 100 }, (_, index) => ({
  outcome_id: `outcome-${index + 1}`,
  replay_certified: true,
  position_aligned: true,
  execution_aligned: true,
  settlement_aligned: true,
}));

const alignedReport = scanCriticalRouteDivergence({
  predictor: {
    canonicalRows: [approvalRow],
    journalRows: [approvalRow],
    analyticsSnapshot: predictorSnapshot,
  },
  executionTruth: {
    canonicalPayload: executionTruth,
    projectedPayload: executionTruth,
    apiPayload: executionTruth,
    uiPayload: executionTruth,
    canonicalSource: "runtime builder",
    projectedSource: "runtime-truth.jsonl",
    apiSource: "/api/runtime/truth",
    uiSource: "terminal execution truth",
  },
  positionTruth: {
    canonicalPayload: positionTruth,
    projectedPayload: positionTruth,
    apiPayload: positionTruth,
    uiPayload: positionTruth,
    canonicalSource: "positions db",
    projectedSource: "positions.jsonl",
    apiSource: "/api/internal/accounts/[accountId]/verification",
    uiSource: "live-capital verification",
  },
  exposureTruth: {
    canonicalPayload: exposureTruth,
    projectedPayload: exposureTruth,
    apiPayload: exposureTruth,
    uiPayload: exposureTruth,
    canonicalSource: "capital db",
    projectedSource: "exposure.jsonl",
    apiSource: "/live-capital api",
    uiSource: "live-capital page",
  },
  settlementTruth: {
    canonicalPayload: settlementTruth,
    projectedPayload: settlementTruth,
    apiPayload: settlementTruth,
    uiPayload: settlementTruth,
    canonicalSource: "capital ledger",
    projectedSource: "settlement.jsonl",
    apiSource: "/live-capital api",
    uiSource: "live-capital page",
  },
  replayTruth: {
    canonicalPayload: replayTruth,
    projectedPayload: replayTruth,
    apiPayload: replayTruth,
    uiPayload: replayTruth,
    canonicalSource: "replay ledger",
    projectedSource: "replay.jsonl",
    apiSource: "/api/execution/replay/[decisionId]",
    uiSource: "reality-gap page",
  },
  certifiedOutcomes: {
    requiredTotal: 100,
    outcomes: alignedCertifiedOutcomes,
  },
});

assert.equal(alignedReport.findings.length, 0, "aligned critical routes should produce no divergence findings");
assert.equal(alignedReport.trust_score, 100, "aligned critical routes should retain full trust score");
assert.equal(alignedReport.coverage.covered_routes_total, 5, "all five critical truths must be covered");
assert.equal(alignedReport.route_matrix.length, 5, "the divergence matrix must include five critical truth routes");
assert.equal(alignedReport.certified_outcomes.ready, true, "100 certified outcomes should unlock the final gate");

const divergedReport = scanCriticalRouteDivergence({
  predictor: {
    canonicalRows: [approvalRow],
    journalRows: [],
    analyticsSnapshot: {
      ...predictorSnapshot,
      source_diagnostics: {
        ...predictorSnapshot.source_diagnostics,
        rows_scanned: 0,
      },
    },
  },
  executionTruth: {
    canonicalPayload: executionTruth,
    projectedPayload: executionTruth,
    apiPayload: {
      ...executionTruth,
      state: "DEGRADED",
      blocks_execution: true,
      score_pct: 52,
    },
    uiPayload: executionTruth,
    canonicalSource: "runtime builder",
    projectedSource: "runtime-truth.jsonl",
    apiSource: "/api/runtime/truth",
    uiSource: "terminal execution truth",
  },
  positionTruth: {
    canonicalPayload: positionTruth,
    projectedPayload: positionTruth,
    apiPayload: positionTruth,
    uiPayload: {
      ...positionTruth,
      positions: [],
    },
    canonicalSource: "positions db",
    projectedSource: "positions.jsonl",
    apiSource: "/api/internal/accounts/[accountId]/verification",
    uiSource: "live-capital verification",
  },
  exposureTruth: {
    canonicalPayload: exposureTruth,
    projectedPayload: {
      ...exposureTruth,
      net_exposure_usd: 80000,
    },
    apiPayload: exposureTruth,
    uiPayload: exposureTruth,
    canonicalSource: "capital db",
    projectedSource: "exposure.jsonl",
    apiSource: "/live-capital api",
    uiSource: "live-capital page",
  },
  settlementTruth: {
    canonicalPayload: settlementTruth,
    projectedPayload: settlementTruth,
    apiPayload: {
      ...settlementTruth,
      reconciliation_usd: 250,
    },
    uiPayload: settlementTruth,
    canonicalSource: "capital ledger",
    projectedSource: "settlement.jsonl",
    apiSource: "/live-capital api",
    uiSource: "live-capital page",
  },
  replayTruth: {
    canonicalPayload: replayTruth,
    projectedPayload: replayTruth,
    apiPayload: {
      ...replayTruth,
      certified: false,
    },
    uiPayload: replayTruth,
    canonicalSource: "replay ledger",
    projectedSource: "replay.jsonl",
    apiSource: "/api/execution/replay/[decisionId]",
    uiSource: "reality-gap page",
  },
  certifiedOutcomes: {
    requiredTotal: 100,
    outcomes: alignedCertifiedOutcomes.slice(0, 99),
  },
});

assert.equal(divergedReport.findings.some((item) => item.route === "/api/system/predictor-rejection-analytics"), true, "predictor route divergence must be detected");
assert.equal(divergedReport.findings.some((item) => item.route === "/api/internal/accounts/[accountId]/verification"), true, "position truth divergence must be detected");
assert.equal(divergedReport.findings.some((item) => item.route === "/api/runtime/truth"), true, "execution truth divergence must be detected");
assert.equal(divergedReport.findings.some((item) => item.route === "/live-capital"), true, "exposure or settlement truth divergence must be detected");
assert.equal(divergedReport.findings.some((item) => item.route === "/api/execution/replay/[decisionId]"), true, "replay truth divergence must be detected");
assert.equal(divergedReport.certified_outcomes.ready, false, "the certified outcomes gate must stay closed below 100 aligned outcomes");
assert.equal(divergedReport.incidents.length >= 5, true, "each truth divergence should emit an auto-incident candidate");
assert.equal(divergedReport.regression_score > 0, true, "diverged routes must raise regression score");

const reportPath = String(process.env.CONSTITUTIONAL_REPORT_PATH || "").trim();
if (reportPath) {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ aligned: alignedReport, diverged: divergedReport }, null, 2));
}

console.log("PASS constitutional critical regression v2: five truth routes, divergence matrix, and 100 certified outcomes gate are enforced before publish");