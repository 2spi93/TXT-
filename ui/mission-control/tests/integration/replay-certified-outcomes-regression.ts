import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  EXECUTION_REALITY_SCHEMA_VERSION,
  type ExecutionRealitySummary,
} from "../../app/terminal/executionRealityScore";
import { scanCriticalRouteDivergence } from "../../lib/criticalRouteDivergenceScanner";
import {
  POSITION_TRUTH_SCHEMA_VERSION,
  type PositionTruthSnapshot,
} from "../../lib/positionTruthContract";

const executionTruth: ExecutionRealitySummary = {
  schema_version: EXECUTION_REALITY_SCHEMA_VERSION,
  state: "ALIGNED",
  score_pct: 95,
  allow_new_risk: true,
  blocks_execution: false,
  size_cap_pct: 100,
  summary_label: "EXEC REAL ALIGNED 95%",
  reasons: [],
  dominant_drag: "NONE",
  metrics: {
    execution_samples: 10,
    liquidity_samples: 10,
    slippage_bps: 1.1,
    latency_ms: 38,
    fill_rate_pct: 95,
    liquidity_accuracy_pct: 93,
    stability_mode: "live",
    stability_monitor_pct: 96,
    drift_watchdog: "CALM",
    optimization_action: "hold",
  },
};

const positionTruth: PositionTruthSnapshot = {
  schema_version: POSITION_TRUTH_SCHEMA_VERSION,
  status: "ok",
  as_of: "2026-06-09T20:00:00.000Z",
  account: { account_id: "acct-1" },
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

const sharedExposure = {
  status: "ok",
  gross_exposure_usd: 90000,
  net_exposure_usd: 45000,
  open_positions: 1,
  account_count: 1,
};

const sharedSettlement = {
  status: "ok",
  settlement_policy: "hybrid",
  reconciliation_usd: 0,
  ledger_event_count: 2,
};

const alignedReplayTruth = {
  decision_id: "decision-1",
  certified: true,
  route_chosen: "bingx",
  fill_count: 1,
  validation_source: "golden-replay",
  artifact: "native",
};

const alignedOutcomes = Array.from({ length: 100 }, (_, index) => ({
  outcome_id: `aligned-${index + 1}`,
  replay_certified: true,
  position_aligned: true,
  execution_aligned: true,
  settlement_aligned: true,
}));

const alignedReport = scanCriticalRouteDivergence({
  executionTruth: {
    canonicalPayload: executionTruth,
    projectedPayload: executionTruth,
    apiPayload: executionTruth,
    uiPayload: executionTruth,
  },
  positionTruth: {
    canonicalPayload: positionTruth,
    projectedPayload: positionTruth,
    apiPayload: positionTruth,
    uiPayload: positionTruth,
  },
  exposureTruth: {
    canonicalPayload: sharedExposure,
    projectedPayload: sharedExposure,
    apiPayload: sharedExposure,
    uiPayload: sharedExposure,
  },
  settlementTruth: {
    canonicalPayload: sharedSettlement,
    projectedPayload: sharedSettlement,
    apiPayload: sharedSettlement,
    uiPayload: sharedSettlement,
  },
  replayTruth: {
    canonicalPayload: alignedReplayTruth,
    projectedPayload: alignedReplayTruth,
    apiPayload: alignedReplayTruth,
    uiPayload: alignedReplayTruth,
  },
  certifiedOutcomes: {
    requiredTotal: 100,
    outcomes: alignedOutcomes,
  },
});

assert.equal(alignedReport.certified_outcomes.ready, true, "aligned replay evidence should satisfy the 100 outcomes gate");
assert.equal(alignedReport.route_matrix.find((row) => row.truth === "Replay Truth")?.divergence_pct, 0, "aligned replay truth should have zero divergence");

const divergedReport = scanCriticalRouteDivergence({
  executionTruth: {
    canonicalPayload: executionTruth,
    projectedPayload: executionTruth,
    apiPayload: executionTruth,
    uiPayload: executionTruth,
  },
  positionTruth: {
    canonicalPayload: positionTruth,
    projectedPayload: positionTruth,
    apiPayload: positionTruth,
    uiPayload: positionTruth,
  },
  exposureTruth: {
    canonicalPayload: sharedExposure,
    projectedPayload: sharedExposure,
    apiPayload: sharedExposure,
    uiPayload: sharedExposure,
  },
  settlementTruth: {
    canonicalPayload: sharedSettlement,
    projectedPayload: sharedSettlement,
    apiPayload: sharedSettlement,
    uiPayload: sharedSettlement,
  },
  replayTruth: {
    canonicalPayload: alignedReplayTruth,
    projectedPayload: alignedReplayTruth,
    apiPayload: {
      ...alignedReplayTruth,
      certified: false,
      artifact: "replay-only",
    },
    uiPayload: alignedReplayTruth,
  },
  certifiedOutcomes: {
    requiredTotal: 100,
    outcomes: alignedOutcomes.slice(0, 99),
  },
});

assert.equal(divergedReport.findings.some((item) => item.route === "/api/execution/replay/[decisionId]"), true, "replay divergence must be reported");
assert.equal(divergedReport.findings.some((item) => item.code === "certified_outcomes_below_gate"), true, "the certified outcomes gate must fail below 100 outcomes");
assert.equal(divergedReport.certified_outcomes.ready, false, "replay gate must remain closed when evidence is incomplete");

const reportPath = String(process.env.CONSTITUTIONAL_REPORT_PATH || "").trim();
if (reportPath) {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ aligned: alignedReport, diverged: divergedReport }, null, 2));
}

console.log("PASS replay certification gate: replay truth divergence and 100 certified outcomes threshold are enforced before merge");