import { type ApprovalDecisionJournalEntry } from "./approvalDecisionJournal";
import {
  assertPredictorRejectionAnalyticsSnapshot,
  type PredictorRejectionAnalyticsSnapshot,
} from "./predictorRejectionAnalytics";
import { assertPositionTruthSnapshot, projectPositionTruthSnapshot } from "./positionTruthContract";
import { EXECUTION_REALITY_SCHEMA_VERSION, type ExecutionRealitySummary } from "../app/terminal/executionRealityScore";

type JsonMap = Record<string, unknown>;

export type TruthRouteLabel =
  | "Execution Truth"
  | "Position Truth"
  | "Exposure Truth"
  | "Settlement Truth"
  | "Replay Truth";

export type TruthRouteInput = {
  canonicalPayload: unknown;
  projectedPayload: unknown;
  apiPayload: unknown;
  uiPayload: unknown;
  canonicalSource?: string;
  projectedSource?: string;
  apiSource?: string;
  uiSource?: string;
};

export type CertifiedOutcomeRoute = {
  outcome_id: string;
  replay_certified: boolean;
  position_aligned: boolean;
  execution_aligned: boolean;
  settlement_aligned: boolean;
};

export type CriticalRouteScannerFinding = {
  route: string;
  severity: "warn" | "critical";
  code: string;
  detail: string;
};

export type TruthRouteMatrixStage = {
  source: string;
  alignment_pct: number;
  divergence_pct: number;
  comparable_fields: number;
  available: boolean;
};

export type TruthRouteMatrixRow = {
  truth: TruthRouteLabel;
  route: string;
  canonical_source: string;
  projected_jsonl: TruthRouteMatrixStage;
  api_payload: TruthRouteMatrixStage;
  ui_payload: TruthRouteMatrixStage;
  divergence_pct: number;
  aligned: boolean;
};

export type CriticalRouteCoverage = {
  required_routes_total: number;
  covered_routes_total: number;
  uncovered_routes: TruthRouteLabel[];
};

export type ConstitutionalIncidentCandidate = {
  route: string;
  truth: TruthRouteLabel;
  severity: "warn" | "critical";
  code: string;
  detail: string;
  divergence_pct: number;
};

export type CertifiedOutcomeGateReport = {
  required_total: number;
  certified_total: number;
  remaining_total: number;
  ready: boolean;
  checkpoints: {
    replay_certified_total: number;
    position_aligned_total: number;
    execution_aligned_total: number;
    settlement_aligned_total: number;
  };
};

export type CriticalRouteScannerReport = {
  schema_version: "constitutional-critical-scanner/v2";
  generated_at_iso: string;
  trust_score: number;
  regression_score: number;
  impact_radius: number;
  coverage: CriticalRouteCoverage;
  route_matrix: TruthRouteMatrixRow[];
  incidents: ConstitutionalIncidentCandidate[];
  certified_outcomes: CertifiedOutcomeGateReport;
  findings: CriticalRouteScannerFinding[];
};

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonMap
    : {};
}

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toOptionalNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["1", "true", "yes", "y", "ready", "certified", "aligned", "ok"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "blocked", "uncertified", "misaligned"].includes(normalized)) {
    return false;
  }
  return null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function stringifyComparable(value: unknown): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(round1(value)) : "NaN";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function asStage(stage: Partial<TruthRouteMatrixStage> & Pick<TruthRouteMatrixStage, "source">): TruthRouteMatrixStage {
  return {
    source: stage.source,
    alignment_pct: stage.alignment_pct ?? 0,
    divergence_pct: stage.divergence_pct ?? 0,
    comparable_fields: stage.comparable_fields ?? 0,
    available: stage.available ?? false,
  };
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function compareComparableMaps(canonical: JsonMap, other: JsonMap | null): TruthRouteMatrixStage {
  if (!other) {
    return asStage({
      source: "missing",
      available: false,
      alignment_pct: 0,
      divergence_pct: 100,
      comparable_fields: Object.keys(canonical).length,
    });
  }
  const keys = Array.from(new Set([...Object.keys(canonical), ...Object.keys(other)]));
  let comparableFields = 0;
  let mismatches = 0;
  for (const key of keys) {
    const canonicalValue = canonical[key];
    const otherValue = other[key];
    if (canonicalValue === undefined && otherValue === undefined) {
      continue;
    }
    comparableFields += 1;
    if (stringifyComparable(canonicalValue) !== stringifyComparable(otherValue)) {
      mismatches += 1;
    }
  }
  const divergencePct = comparableFields > 0 ? round1((mismatches / comparableFields) * 100) : 0;
  return asStage({
    source: "available",
    available: true,
    alignment_pct: round1(100 - divergencePct),
    divergence_pct: divergencePct,
    comparable_fields: comparableFields,
  });
}

function projectExecutionTruthComparable(raw: unknown): JsonMap {
  const payload = asRecord(raw);
  const metrics = asRecord(payload.metrics);
  const status = String(payload.verdict || payload.state || payload.status || "unknown").trim().toUpperCase() || "UNKNOWN";
  return {
    schema_version: String(payload.schema_version || EXECUTION_REALITY_SCHEMA_VERSION),
    status,
    score_pct: toNumber(payload.score_pct, 0),
    allow_new_risk: toBoolean(payload.allow_new_risk),
    blocks_execution: toBoolean(payload.blocks_execution ?? payload.block_execution),
    size_cap_pct: toNumber(payload.size_cap_pct, 0),
    execution_samples: toNumber(metrics.execution_samples, 0),
    fill_rate_pct: toNumber(metrics.fill_rate_pct, 0),
    slippage_bps: toNumber(metrics.slippage_bps, 0),
    latency_ms: toNumber(metrics.latency_ms, 0),
  };
}

function projectExposureTruthComparable(raw: unknown): JsonMap {
  const payload = asRecord(raw);
  const summary = asRecord(payload.summary);
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  const positions = Array.isArray(payload.positions) ? payload.positions : [];
  return {
    gross_exposure_usd: toNumber(payload.gross_exposure_usd, toNumber(summary.gross_exposure_usd, 0)),
    net_exposure_usd: toNumber(payload.net_exposure_usd, toNumber(summary.net_exposure_usd, 0)),
    open_positions: toNumber(payload.open_positions, positions.length),
    account_count: toNumber(payload.account_count, accounts.length),
    status: String(payload.status || summary.status || "unknown").trim().toLowerCase() || "unknown",
  };
}

function projectSettlementTruthComparable(raw: unknown): JsonMap {
  const payload = asRecord(raw);
  const summary = asRecord(payload.summary);
  const capitalLedger = asRecord(payload.capital_ledger);
  const rows = Array.isArray(payload.rows)
    ? payload.rows
    : Array.isArray(capitalLedger.rows)
      ? capitalLedger.rows
      : [];
  return {
    settlement_policy: String(payload.settlement_policy || payload.policy || summary.settlement_policy || "unknown").trim().toLowerCase() || "unknown",
    reconciliation_usd: toNumber(payload.reconciliation_usd, toNumber(summary.reconciliation_usd, toNumber(capitalLedger.reconciliation_usd, 0))),
    ledger_event_count: toNumber(payload.ledger_event_count, rows.length),
    status: String(payload.status || summary.status || capitalLedger.status || "unknown").trim().toLowerCase() || "unknown",
  };
}

function projectReplayTruthComparable(raw: unknown): JsonMap {
  const payload = asRecord(raw);
  const telemetry = asRecord(payload.telemetry);
  const kairosHarness = asRecord(payload.kairos_harness);
  const certification = asRecord(payload.certification);
  const fills = Array.isArray(payload.fills) ? payload.fills : [];
  const certified = toBoolean(payload.certified ?? certification.certified ?? certification.status ?? payload.status);
  return {
    decision_id: String(payload.decision_id || payload.id || "").trim(),
    certified,
    fill_count: toNumber(payload.fill_count, fills.length),
    route_chosen: String(payload.route_chosen || telemetry.route_chosen || "").trim(),
    validation_source: String(payload.validation_source || kairosHarness.validation_source || "").trim(),
    artifact: payload.rust_reality_gap ? "native" : String(payload.artifact || "replay-only").trim().toLowerCase() || "replay-only",
  };
}

function projectComparableTruth(label: TruthRouteLabel, raw: unknown): JsonMap {
  switch (label) {
    case "Execution Truth":
      return projectExecutionTruthComparable(raw);
    case "Position Truth": {
      const snapshot = assertPositionTruthSnapshot(projectPositionTruthSnapshot(raw));
      return {
        schema_version: snapshot.schema_version,
        status: snapshot.status,
        as_of: snapshot.as_of,
        account_id: String(asRecord(snapshot.account).account_id || "").trim(),
        balance_count: snapshot.balances.length,
        position_count: snapshot.positions.length,
        open_order_count: snapshot.open_orders.length,
        pocket_view_count: snapshot.pocket_views.length,
        capital_ledger_count: snapshot.capital_ledger.length,
      };
    }
    case "Exposure Truth":
      return projectExposureTruthComparable(raw);
    case "Settlement Truth":
      return projectSettlementTruthComparable(raw);
    case "Replay Truth":
      return projectReplayTruthComparable(raw);
  }
}

function buildTruthRouteMatrixRow(params: {
  truth: TruthRouteLabel;
  route: string;
  input: TruthRouteInput;
}): TruthRouteMatrixRow {
  const canonicalComparable = projectComparableTruth(params.truth, params.input.canonicalPayload);
  const projectedComparable = projectComparableTruth(params.truth, params.input.projectedPayload);
  const apiComparable = projectComparableTruth(params.truth, params.input.apiPayload);
  const uiComparable = projectComparableTruth(params.truth, params.input.uiPayload);

  const projectedStage = compareComparableMaps(canonicalComparable, projectedComparable);
  projectedStage.source = params.input.projectedSource || "JSONL";
  const apiStage = compareComparableMaps(canonicalComparable, apiComparable);
  apiStage.source = params.input.apiSource || "API";
  const uiStage = compareComparableMaps(canonicalComparable, uiComparable);
  uiStage.source = params.input.uiSource || "UI";
  const divergencePct = Math.max(projectedStage.divergence_pct, apiStage.divergence_pct, uiStage.divergence_pct);

  return {
    truth: params.truth,
    route: params.route,
    canonical_source: params.input.canonicalSource || "canonical",
    projected_jsonl: projectedStage,
    api_payload: apiStage,
    ui_payload: uiStage,
    divergence_pct: divergencePct,
    aligned: divergencePct === 0,
  };
}

function buildCertifiedOutcomeGateReport(input?: {
  requiredTotal?: number;
  outcomes: CertifiedOutcomeRoute[];
}): CertifiedOutcomeGateReport {
  const requiredTotal = Math.max(1, Math.round(Number(input?.requiredTotal || 100)));
  const outcomes = input?.outcomes || [];
  const replayCertifiedTotal = outcomes.filter((item) => item.replay_certified).length;
  const positionAlignedTotal = outcomes.filter((item) => item.position_aligned).length;
  const executionAlignedTotal = outcomes.filter((item) => item.execution_aligned).length;
  const settlementAlignedTotal = outcomes.filter((item) => item.settlement_aligned).length;
  const certifiedTotal = outcomes.filter((item) => item.replay_certified && item.position_aligned && item.execution_aligned && item.settlement_aligned).length;
  return {
    required_total: requiredTotal,
    certified_total: certifiedTotal,
    remaining_total: Math.max(requiredTotal - certifiedTotal, 0),
    ready: certifiedTotal >= requiredTotal,
    checkpoints: {
      replay_certified_total: replayCertifiedTotal,
      position_aligned_total: positionAlignedTotal,
      execution_aligned_total: executionAlignedTotal,
      settlement_aligned_total: settlementAlignedTotal,
    },
  };
}

function routeCode(label: TruthRouteLabel): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function approvalKey(entry: ApprovalDecisionJournalEntry): string {
  return `${entry.approval_id}:${entry.approval_stage}`;
}

export function scanCriticalRouteDivergence(input: {
  predictor?: {
    canonicalRows: ApprovalDecisionJournalEntry[];
    journalRows: ApprovalDecisionJournalEntry[];
    analyticsSnapshot: PredictorRejectionAnalyticsSnapshot;
  };
  executionTruth: TruthRouteInput;
  positionTruth: TruthRouteInput;
  exposureTruth: TruthRouteInput;
  settlementTruth: TruthRouteInput;
  replayTruth: TruthRouteInput;
  certifiedOutcomes?: {
    requiredTotal?: number;
    outcomes: CertifiedOutcomeRoute[];
  };
}): CriticalRouteScannerReport {
  const findings: CriticalRouteScannerFinding[] = [];

  if (input.predictor) {
    const predictorSnapshot = assertPredictorRejectionAnalyticsSnapshot(input.predictor.analyticsSnapshot);
    const canonicalKeys = new Set(input.predictor.canonicalRows.filter((row) => row.approval_stage === "approval_2").map(approvalKey));
    const journalKeys = new Set(input.predictor.journalRows.filter((row) => row.approval_stage === "approval_2").map(approvalKey));
    const mergedKeys = new Set([...canonicalKeys, ...journalKeys]);
    const predictorDiagnostics = asRecord(predictorSnapshot.source_diagnostics);
    if (canonicalKeys.size > 0 && toNumber(predictorDiagnostics.rows_scanned, 0) === 0) {
      findings.push({
        route: "/api/system/predictor-rejection-analytics",
        severity: "critical",
        code: "predictor_rows_scanned_zero",
        detail: "Canonical approvals exist but predictor analytics scanned zero rows.",
      });
    }
    if (toNumber(predictorDiagnostics.rows_scanned, 0) > mergedKeys.size) {
      findings.push({
        route: "/api/system/predictor-rejection-analytics",
        severity: "warn",
        code: "predictor_rows_scanned_exceeds_sources",
        detail: `Predictor analytics scanned ${toNumber(predictorDiagnostics.rows_scanned, 0)} rows for only ${mergedKeys.size} merged source keys.`,
      });
    }
    if (canonicalKeys.size > journalKeys.size && toNumber(predictorDiagnostics.backfilled_rows, 0) === 0) {
      findings.push({
        route: "/api/system/predictor-rejection-analytics",
        severity: "warn",
        code: "predictor_backfill_missing",
        detail: "Canonical approvals exceed JSONL projection but no backfilled rows were reported.",
      });
    }
  }

  const routeMatrix: TruthRouteMatrixRow[] = [
    buildTruthRouteMatrixRow({
      truth: "Execution Truth",
      route: "/api/runtime/truth",
      input: input.executionTruth,
    }),
    buildTruthRouteMatrixRow({
      truth: "Position Truth",
      route: "/api/internal/accounts/[accountId]/verification",
      input: input.positionTruth,
    }),
    buildTruthRouteMatrixRow({
      truth: "Exposure Truth",
      route: "/live-capital",
      input: input.exposureTruth,
    }),
    buildTruthRouteMatrixRow({
      truth: "Settlement Truth",
      route: "/live-capital",
      input: input.settlementTruth,
    }),
    buildTruthRouteMatrixRow({
      truth: "Replay Truth",
      route: "/api/execution/replay/[decisionId]",
      input: input.replayTruth,
    }),
  ];

  const incidents: ConstitutionalIncidentCandidate[] = [];
  const uncoveredRoutes: TruthRouteLabel[] = [];
  for (const row of routeMatrix) {
    const missingStage = !row.projected_jsonl.available || !row.api_payload.available || !row.ui_payload.available;
    if (missingStage) {
      uncoveredRoutes.push(row.truth);
      findings.push({
        route: row.route,
        severity: "critical",
        code: `${routeCode(row.truth)}_coverage_missing`,
        detail: `${row.truth} is missing at least one required surface (canonical, JSONL, API, or UI).`,
      });
    }
    if (row.divergence_pct > 0) {
      const severity: ConstitutionalIncidentCandidate["severity"] = row.divergence_pct >= 2 || missingStage ? "critical" : "warn";
      const incident = {
        route: row.route,
        truth: row.truth,
        severity,
        code: `${routeCode(row.truth)}_divergence_detected`,
        detail: `${row.truth} diverged by ${row.divergence_pct.toFixed(1)}% across canonical, JSONL, API, and UI surfaces.`,
        divergence_pct: row.divergence_pct,
      } satisfies ConstitutionalIncidentCandidate;
      incidents.push(incident);
      findings.push({
        route: row.route,
        severity,
        code: incident.code,
        detail: incident.detail,
      });
    }
  }

  const certifiedOutcomes = buildCertifiedOutcomeGateReport(input.certifiedOutcomes);
  if (!certifiedOutcomes.ready) {
    findings.push({
      route: "/constitutional/certified-outcomes",
      severity: "critical",
      code: "certified_outcomes_below_gate",
      detail: `Certified outcomes gate is ${certifiedOutcomes.certified_total}/${certifiedOutcomes.required_total}; live promotion remains blocked.`,
    });
  }

  const criticalCount = findings.filter((item) => item.severity === "critical").length;
  const warnCount = findings.filter((item) => item.severity === "warn").length;
  return {
    schema_version: "constitutional-critical-scanner/v2",
    generated_at_iso: new Date().toISOString(),
    trust_score: Math.max(0, 100 - criticalCount * 25 - warnCount * 10),
    regression_score: Math.min(100, criticalCount * 40 + warnCount * 15),
    impact_radius: new Set(findings.map((item) => item.route)).size,
    coverage: {
      required_routes_total: routeMatrix.length,
      covered_routes_total: routeMatrix.length - uncoveredRoutes.length,
      uncovered_routes: uncoveredRoutes,
    },
    route_matrix: routeMatrix,
    incidents,
    certified_outcomes: certifiedOutcomes,
    findings,
  };
}