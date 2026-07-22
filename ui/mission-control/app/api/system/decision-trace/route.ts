import { NextRequest, NextResponse } from "next/server";

import { readApprovalDecisionJournalEntries, type ApprovalDecisionJournalEntry } from "../../../../lib/approvalDecisionJournal";
import { readAllocationDecisionJournalEntries, type AllocationDecisionJournalEntry } from "../../../../lib/allocationDecisionJournal";
import { getControlPlaneToken, cpFetchJsonSafe } from "../../../../lib/controlPlane";
import { readExecutionFactJournalEntries, type ExecutionFactJournalEntry } from "../../../../lib/executionFactJournal";
import { readOpportunityCostJournalEntries, type OpportunityCostJournalEntry } from "../../../../lib/opportunityCostJournal";

type JsonMap = Record<string, unknown>;
type TraceStageStatus = "blocked" | "completed" | "missing" | "pending";

const DECISION_TRACE_AUDIT_TIMEOUT_MS = 3500;
const DECISION_TRACE_INPUT_TIMEOUT_MS = 3500;
const DECISION_TRACE_BUILD_TIMEOUT_MS = 1200;

type DecisionTraceMode = "full" | "lite";

type DecisionTraceStage = {
  stage_key: string;
  label: string;
  status: TraceStageStatus;
  timestamp: string | null;
  event_category: string | null;
  detail: string;
  actors: string[];
  payload: JsonMap;
};

type ProjectedCausalFact = {
  fact_type: "ApprovalDecisionFact" | "CanonicalJournalFact";
  fact_key: string;
  status: string;
  detail: string;
  payload: JsonMap;
};

type OracleStabilityProjection = {
  reason: string | null;
  status: string | null;
  source: string | null;
  age_ms: number | null;
  confidence: number | null;
  gap: number | null;
  raw: JsonMap;
};

type DecisionTraceResponse = {
  generated_at_iso: string;
  source: "projected_from_control_plane_audit_and_canonical_journals" | "projected_from_canonical_journals";
  mode: DecisionTraceMode;
  approval_id: string;
  summary: {
    status: string;
    blocking_reason: string | null;
    first_approved_by: string | null;
    second_approved_by: string | null;
    symbol: string | null;
    side: string | null;
    account_id: string | null;
    decision_id: string | null;
    trade_lifecycle_id: string | null;
  };
  oracle_stability: OracleStabilityProjection | null;
  causal_steps: DecisionTraceStage[];
  projected_facts: ProjectedCausalFact[];
  canonical_journal: {
    approval_decisions: ApprovalDecisionJournalEntry[];
    allocation_decision: AllocationDecisionJournalEntry | null;
    execution_fact: ExecutionFactJournalEntry | null;
    opportunity_cost: OpportunityCostJournalEntry | null;
  };
  audit_context: {
    pending_second_approval: JsonMap | null;
    rejection_after_second_approval: JsonMap | null;
    executed_double_approved: JsonMap | null;
    direct_go_live_hardening_decision: JsonMap | null;
  };
  diagnostics: {
    total_duration_ms: number;
    partial: boolean;
    resolved_via: string;
    requested_ids: {
      approval_id: string | null;
      decision_id: string | null;
      trade_lifecycle_id: string | null;
      candidate_id: string | null;
    };
    phases: Array<{
      phase_key: string;
      duration_ms: number;
      rows: number;
      timed_out: boolean;
      failed: boolean;
    }>;
  };
};

type TracePhaseResult<T> = {
  value: T;
  durationMs: number;
  rowCount: number;
  timedOut: boolean;
  failed: boolean;
};

function unauthorized(): NextResponse {
  return NextResponse.json({ message: "Authentication required" }, { status: 401 });
}

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonMap
    : {};
}

function asRows(value: unknown): JsonMap[] {
  if (Array.isArray(value)) {
    return value.map((entry) => asRecord(entry));
  }
  const root = asRecord(value);
  const candidates = [root.rows, root.items, root.events, root.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map((entry) => asRecord(entry));
    }
  }
  return [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseTimeMs(value: unknown): number {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickAuditTimestamp(row: JsonMap | null | undefined): string | null {
  const payload = asRecord(row);
  return firstNonEmpty(payload.timestamp, payload.created_at, payload.updated_at, payload.at);
}

function pickApprovalIdFromAuditRow(row: JsonMap | null | undefined): string | null {
  const payload = asRecord(asRecord(row).payload);
  const failure = asRecord(payload.failure);
  const failureDetail = asRecord(failure.detail);
  const result = asRecord(payload.result);
  return firstNonEmpty(
    payload.approval_id,
    failure.approval_id,
    failureDetail.approval_id,
    result.approval_id,
  );
}

function pickDecisionIdFromAuditRow(row: JsonMap | null | undefined): string | null {
  const payload = asRecord(asRecord(row).payload);
  const failure = asRecord(payload.failure);
  const failureDetail = asRecord(failure.detail);
  const result = asRecord(payload.result);
  const hardening = asRecord(failureDetail.hardening);
  return firstNonEmpty(
    payload.decision_id,
    failure.decision_id,
    failureDetail.decision_id,
    result.decision_id,
    hardening.decision_id,
  );
}

function pickTradeLifecycleId(
  approvalDecisions: ApprovalDecisionJournalEntry[],
  allocationDecision: AllocationDecisionJournalEntry | null,
  executionFact: ExecutionFactJournalEntry | null,
  opportunityCost: OpportunityCostJournalEntry | null,
): string | null {
  return firstNonEmpty(
    approvalDecisions[0]?.trade_lifecycle_id,
    allocationDecision?.trade_lifecycle_id,
    executionFact?.trade_lifecycle_id,
    opportunityCost?.trade_lifecycle_id,
  );
}

function pickSymbol(row: JsonMap | null): string | null {
  if (!row) {
    return null;
  }
  const payload = asRecord(row.payload);
  const failure = asRecord(payload.failure);
  const failureDetail = asRecord(failure.detail);
  const hardening = asRecord(failureDetail.hardening);
  return firstNonEmpty(payload.symbol, hardening.symbol);
}

function pickSide(row: JsonMap | null): string | null {
  if (!row) {
    return null;
  }
  const payload = asRecord(row.payload);
  const failure = asRecord(payload.failure);
  const failureDetail = asRecord(failure.detail);
  const hardening = asRecord(failureDetail.hardening);
  return firstNonEmpty(payload.side, hardening.side);
}

function pickAccountId(row: JsonMap | null): string | null {
  if (!row) {
    return null;
  }
  const payload = asRecord(row.payload);
  const failure = asRecord(payload.failure);
  const failureDetail = asRecord(failure.detail);
  const hardening = asRecord(failureDetail.hardening);
  return firstNonEmpty(payload.account_id, hardening.account_id);
}

function formatHardeningDetail(hardening: JsonMap): string {
  const status = firstNonEmpty(hardening.status, hardening.state) || "hardening_unknown";
  const reasons = asStringArray(hardening.reasons);
  if (reasons.length > 0) {
    return `${status}: ${reasons.join(", ")}`;
  }
  return status;
}

function projectOracleStability(hardening: JsonMap | null): OracleStabilityProjection | null {
  if (!hardening) {
    return null;
  }
  const oracle = asRecord(hardening.oracle_stability);
  if (Object.keys(oracle).length === 0) {
    return null;
  }
  const reasons = asStringArray(oracle.reasons);
  return {
    reason: firstNonEmpty(
      oracle.reason,
      oracle.block_reason,
      hardening.oracle_stability_reason,
      reasons[0],
    ),
    status: firstNonEmpty(oracle.status, oracle.state, hardening.oracle_status),
    source: firstNonEmpty(oracle.source, oracle.provider, hardening.oracle_source),
    age_ms: toNumberOrNull(oracle.age_ms ?? hardening.oracle_age_ms),
    confidence: toNumberOrNull(oracle.confidence ?? oracle.score ?? hardening.oracle_confidence),
    gap: toNumberOrNull(oracle.gap ?? oracle.confidence_gap ?? hardening.oracle_gap),
    raw: oracle,
  };
}

function buildStage(
  stageKey: string,
  label: string,
  status: TraceStageStatus,
  row: JsonMap | null,
  detail: string,
  actors: Array<string | null>,
  payloadOverride?: JsonMap | null,
): DecisionTraceStage {
  return {
    stage_key: stageKey,
    label,
    status,
    timestamp: row ? pickAuditTimestamp(row) : null,
    event_category: row ? firstNonEmpty(row.category) : null,
    detail,
    actors: actors.map((entry) => String(entry || "").trim()).filter(Boolean),
    payload: payloadOverride || (row ? asRecord(row.payload) : {}),
  };
}

async function readRelevantAuditRows(limit: number): Promise<JsonMap[]> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const fallback = {
    response: new Response(JSON.stringify({ detail: "decision_trace_audit_timeout" }), { status: 504 }),
    payload: { detail: "decision_trace_audit_timeout" },
  };
  const timeoutPromise = new Promise<typeof fallback>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve(fallback);
    }, DECISION_TRACE_AUDIT_TIMEOUT_MS);
  });
  const fetchPromise = cpFetchJsonSafe(`/v1/audit?limit=${encodeURIComponent(String(limit))}`, { signal: controller.signal })
    .catch(() => ({
      response: new Response(JSON.stringify({ detail: "decision_trace_audit_failed" }), { status: 503 }),
      payload: { detail: "decision_trace_audit_failed" },
      network: {
        network_state: "degraded",
        retry_count: 0,
        degraded_flag: true,
        failure_classification: "network_unknown" as const,
        failure_detail: "decision-trace audit fetch failed",
        attempted_targets: [],
        attempted_base_urls: [],
        upstream_status: 503,
      },
    }))
    .finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });
  const { response, payload } = await Promise.race([fetchPromise, timeoutPromise]);
  if (!response.ok) {
    return [];
  }
  return asRows(payload);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return Promise.race([
    promise.finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }),
    timeoutPromise,
  ]);
}

async function runPhase<T>(operation: () => Promise<T>, fallback: T, getRowCount: (value: T) => number, timeoutMs = DECISION_TRACE_INPUT_TIMEOUT_MS): Promise<TracePhaseResult<T>> {
  const startedAt = Date.now();
  let timedOut = false;
  let failed = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      resolve(fallback);
    }, timeoutMs);
  });
  try {
    const value = await Promise.race([
      operation().catch(() => {
        failed = true;
        return fallback;
      }),
      timeoutPromise,
    ]);
    return {
      value,
      durationMs: Date.now() - startedAt,
      rowCount: getRowCount(value),
      timedOut,
      failed,
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function sortByAuditTimestampDesc(rows: JsonMap[]): JsonMap[] {
  return rows.slice().sort((left, right) => parseTimeMs(pickAuditTimestamp(right)) - parseTimeMs(pickAuditTimestamp(left)));
}

function resolveRequestedMode(request: NextRequest): DecisionTraceMode {
  const rawMode = String(request.nextUrl.searchParams.get("mode") || request.nextUrl.searchParams.get("traceMode") || "").trim().toLowerCase();
  const liteFlag = String(request.nextUrl.searchParams.get("lite") || "").trim().toLowerCase();
  if (rawMode === "lite" || liteFlag === "1" || liteFlag === "true") {
    return "lite";
  }
  return "full";
}

function matchHardeningAuditRow(
  auditRows: JsonMap[],
  symbol: string | null,
  side: string | null,
  accountId: string | null,
  aroundTimestamp: string | null,
): JsonMap | null {
  const aroundMs = parseTimeMs(aroundTimestamp);
  const candidates = auditRows
    .filter((row) => String(row.category || "") === "go_live_hardening_decision")
    .filter((row) => {
      const payload = asRecord(row.payload);
      if (symbol && String(payload.symbol || "").trim().toUpperCase() !== symbol.toUpperCase()) {
        return false;
      }
      if (side && String(payload.side || "").trim().toLowerCase() !== side.toLowerCase()) {
        return false;
      }
      if (accountId && String(payload.account_id || "").trim() !== accountId) {
        return false;
      }
      return true;
    })
    .sort((left, right) => parseTimeMs(pickAuditTimestamp(right)) - parseTimeMs(pickAuditTimestamp(left)));
  if (candidates.length === 0) {
    return null;
  }
  if (aroundMs <= 0) {
    return candidates[0];
  }
  return candidates
    .slice()
    .sort((left, right) => {
      const leftDistance = Math.abs(parseTimeMs(pickAuditTimestamp(left)) - aroundMs);
      const rightDistance = Math.abs(parseTimeMs(pickAuditTimestamp(right)) - aroundMs);
      return leftDistance - rightDistance;
    })[0] || null;
}

function selectLatestRelevantApprovalId(
  auditRows: JsonMap[],
  approvalRows: ApprovalDecisionJournalEntry[],
  allocationRows: AllocationDecisionJournalEntry[],
  executionRows: ExecutionFactJournalEntry[],
  opportunityRows: OpportunityCostJournalEntry[],
): string | null {
  const candidates: Array<{ approvalId: string; timestampMs: number }> = [];
  for (const row of auditRows) {
    const approvalId = pickApprovalIdFromAuditRow(row);
    if (!approvalId) {
      continue;
    }
    candidates.push({ approvalId, timestampMs: parseTimeMs(pickAuditTimestamp(row)) });
  }
  for (const row of approvalRows) {
    candidates.push({ approvalId: row.approval_id, timestampMs: parseTimeMs(row.created_at_iso) });
  }
  for (const row of allocationRows) {
    if (row.approval_id) {
      candidates.push({ approvalId: row.approval_id, timestampMs: parseTimeMs(row.created_at_iso) });
    }
  }
  for (const row of executionRows) {
    if (row.approval_id) {
      candidates.push({ approvalId: row.approval_id, timestampMs: parseTimeMs(row.created_at_iso) });
    }
  }
  for (const row of opportunityRows) {
    if (row.approval_id) {
      candidates.push({ approvalId: row.approval_id, timestampMs: parseTimeMs(row.created_at_iso) });
    }
  }
  candidates.sort((left, right) => right.timestampMs - left.timestampMs);
  return candidates[0]?.approvalId || null;
}

function matchesCanonicalLookup(
  row: {
    approval_id?: string | null;
    decision_id?: string | null;
    trade_lifecycle_id?: string | null;
    candidate_id?: string | null;
    created_at_iso?: string | null;
  },
  lookup: {
    decisionId: string;
    tradeLifecycleId: string;
    candidateId: string;
  },
): boolean {
  return (
    (lookup.decisionId.length > 0 && row.decision_id === lookup.decisionId)
    || (lookup.tradeLifecycleId.length > 0 && row.trade_lifecycle_id === lookup.tradeLifecycleId)
    || (lookup.candidateId.length > 0 && row.candidate_id === lookup.candidateId)
  );
}

function selectApprovalIdFromCanonicalIds(
  approvalRows: ApprovalDecisionJournalEntry[],
  allocationRows: AllocationDecisionJournalEntry[],
  executionRows: ExecutionFactJournalEntry[],
  opportunityRows: OpportunityCostJournalEntry[],
  lookup: {
    decisionId: string;
    tradeLifecycleId: string;
    candidateId: string;
  },
): string | null {
  const candidates: Array<{ approvalId: string; timestampMs: number }> = [];

  for (const row of approvalRows) {
    if (!matchesCanonicalLookup(row, lookup)) {
      continue;
    }
    candidates.push({
      approvalId: row.approval_id,
      timestampMs: parseTimeMs(row.created_at_iso),
    });
  }

  for (const row of allocationRows) {
    if (!row.approval_id || !matchesCanonicalLookup(row, lookup)) {
      continue;
    }
    candidates.push({
      approvalId: row.approval_id,
      timestampMs: parseTimeMs(row.created_at_iso),
    });
  }

  for (const row of executionRows) {
    if (!row.approval_id || !matchesCanonicalLookup(row, lookup)) {
      continue;
    }
    candidates.push({
      approvalId: row.approval_id,
      timestampMs: parseTimeMs(row.created_at_iso),
    });
  }

  for (const row of opportunityRows) {
    if (!row.approval_id || !matchesCanonicalLookup(row, lookup)) {
      continue;
    }
    candidates.push({
      approvalId: row.approval_id,
      timestampMs: parseTimeMs(row.created_at_iso),
    });
  }

  candidates.sort((left, right) => right.timestampMs - left.timestampMs);
  return candidates[0]?.approvalId || null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  const token = await getControlPlaneToken();
  if (!token) {
    return unauthorized();
  }

  const mode = resolveRequestedMode(request);

  const requestedApprovalId = String(
    request.nextUrl.searchParams.get("approvalId") || request.nextUrl.searchParams.get("approval_id") || "",
  ).trim();
  const requestedDecisionId = String(
    request.nextUrl.searchParams.get("decisionId") || request.nextUrl.searchParams.get("decision_id") || "",
  ).trim();
  const requestedTradeLifecycleId = String(
    request.nextUrl.searchParams.get("tradeLifecycleId") || request.nextUrl.searchParams.get("trade_lifecycle_id") || "",
  ).trim();
  const requestedCandidateId = String(
    request.nextUrl.searchParams.get("candidateId") || request.nextUrl.searchParams.get("candidate_id") || "",
  ).trim();
  const auditLimit = Math.max(100, Math.min(1_000, Number(request.nextUrl.searchParams.get("auditLimit") || 400)));
  const sinceDays = Math.max(1, Math.min(90, Number(request.nextUrl.searchParams.get("sinceDays") || 30)));

  const [auditPhase, approvalsPhase, allocationsPhase, executionPhase, opportunityPhase] = await Promise.all([
    mode === "full"
      ? runPhase(() => readRelevantAuditRows(auditLimit), [], (value) => value.length, DECISION_TRACE_AUDIT_TIMEOUT_MS)
      : Promise.resolve({ value: [], durationMs: 0, rowCount: 0, timedOut: false, failed: false }),
    runPhase(() => readApprovalDecisionJournalEntries({ limit: 500, sinceDays }), [], (value) => value.length),
    runPhase(() => readAllocationDecisionJournalEntries({ limit: 500, sinceDays }), [], (value) => value.length),
    runPhase(() => readExecutionFactJournalEntries({ limit: 500, sinceDays }), [], (value) => value.length),
    runPhase(() => readOpportunityCostJournalEntries({ limit: 500, sinceDays }), [], (value) => value.length),
  ]);
  const auditRows = auditPhase.value;
  const approvalRows = approvalsPhase.value;
  const allocationRows = allocationsPhase.value;
  const executionRows = executionPhase.value;
  const opportunityRows = opportunityPhase.value;
  const canonicalLookup = {
    decisionId: requestedDecisionId,
    tradeLifecycleId: requestedTradeLifecycleId,
    candidateId: requestedCandidateId,
  };

  let resolvedVia = requestedApprovalId ? "requested_approval_id" : "canonical_lookup";

  const canonicalApprovalId = selectApprovalIdFromCanonicalIds(
      approvalRows,
      allocationRows,
      executionRows,
      opportunityRows,
      canonicalLookup,
    );
  const syntheticCanonicalTraceKey = mode === "lite"
    ? requestedDecisionId
      ? `canonical-decision:${requestedDecisionId}`
      : requestedTradeLifecycleId
        ? `canonical-trade-lifecycle:${requestedTradeLifecycleId}`
        : requestedCandidateId
          ? `canonical-candidate:${requestedCandidateId}`
          : null
    : null;
  const hasSyntheticCanonicalMatch = Boolean(syntheticCanonicalTraceKey) && (
    approvalRows.some((row) => matchesCanonicalLookup(row, canonicalLookup))
    || allocationRows.some((row) => matchesCanonicalLookup(row, canonicalLookup))
    || executionRows.some((row) => matchesCanonicalLookup(row, canonicalLookup))
    || opportunityRows.some((row) => matchesCanonicalLookup(row, canonicalLookup))
  );
  const fallbackApprovalId = selectLatestRelevantApprovalId(auditRows, approvalRows, allocationRows, executionRows, opportunityRows);
  const approvalId = requestedApprovalId || canonicalApprovalId || (hasSyntheticCanonicalMatch ? syntheticCanonicalTraceKey : null) || fallbackApprovalId;
  if (!requestedApprovalId && canonicalApprovalId) {
    resolvedVia = requestedDecisionId ? "decision_id" : requestedTradeLifecycleId ? "trade_lifecycle_id" : requestedCandidateId ? "candidate_id" : "canonical_lookup";
  } else if (!requestedApprovalId && !canonicalApprovalId && hasSyntheticCanonicalMatch) {
    resolvedVia = requestedDecisionId ? "decision_id_synthetic" : requestedTradeLifecycleId ? "trade_lifecycle_id_synthetic" : "candidate_id_synthetic";
  } else if (!requestedApprovalId && !canonicalApprovalId && fallbackApprovalId) {
    resolvedVia = "latest_relevant";
  }

  const explicitLookupRequested = Boolean(requestedApprovalId || requestedDecisionId || requestedTradeLifecycleId || requestedCandidateId);
  const approvalRequestedButMissing = Boolean(requestedApprovalId) && !approvalRows.some((row) => row.approval_id === requestedApprovalId)
    && !allocationRows.some((row) => row.approval_id === requestedApprovalId)
    && !executionRows.some((row) => row.approval_id === requestedApprovalId)
    && !opportunityRows.some((row) => row.approval_id === requestedApprovalId)
    && !auditRows.some((row) => pickApprovalIdFromAuditRow(row) === requestedApprovalId);
  if (approvalRequestedButMissing || (explicitLookupRequested && !approvalId)) {
    const diagnostics = {
      total_duration_ms: Date.now() - startedAt,
      partial: auditPhase.timedOut || approvalsPhase.timedOut || allocationsPhase.timedOut || executionPhase.timedOut || opportunityPhase.timedOut,
      resolved_via: approvalRequestedButMissing ? "requested_id_missing" : "unresolved",
      requested_ids: {
        approval_id: requestedApprovalId || null,
        decision_id: requestedDecisionId || null,
        trade_lifecycle_id: requestedTradeLifecycleId || null,
        candidate_id: requestedCandidateId || null,
      },
      phases: [
        { phase_key: "audit", duration_ms: auditPhase.durationMs, rows: auditPhase.rowCount, timed_out: auditPhase.timedOut, failed: auditPhase.failed },
        { phase_key: "approvals", duration_ms: approvalsPhase.durationMs, rows: approvalsPhase.rowCount, timed_out: approvalsPhase.timedOut, failed: approvalsPhase.failed },
        { phase_key: "allocation", duration_ms: allocationsPhase.durationMs, rows: allocationsPhase.rowCount, timed_out: allocationsPhase.timedOut, failed: allocationsPhase.failed },
        { phase_key: "execution", duration_ms: executionPhase.durationMs, rows: executionPhase.rowCount, timed_out: executionPhase.timedOut, failed: executionPhase.failed },
        { phase_key: "opportunity", duration_ms: opportunityPhase.durationMs, rows: opportunityPhase.rowCount, timed_out: opportunityPhase.timedOut, failed: opportunityPhase.failed },
      ],
    };
    console.info(`[decision-trace] ${JSON.stringify({ mode, ...diagnostics })}`);
    return NextResponse.json({
      message: "No approval decision trace found",
      generated_at_iso: new Date().toISOString(),
      source: mode === "lite" ? "projected_from_canonical_journals" : "projected_from_control_plane_audit_and_canonical_journals",
      mode,
      diagnostics,
    }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (!approvalId) {
    const diagnostics = {
      total_duration_ms: Date.now() - startedAt,
      partial: auditPhase.timedOut || approvalsPhase.timedOut || allocationsPhase.timedOut || executionPhase.timedOut || opportunityPhase.timedOut,
      resolved_via: "unresolved",
      requested_ids: {
        approval_id: requestedApprovalId || null,
        decision_id: requestedDecisionId || null,
        trade_lifecycle_id: requestedTradeLifecycleId || null,
        candidate_id: requestedCandidateId || null,
      },
      phases: [
        { phase_key: "audit", duration_ms: auditPhase.durationMs, rows: auditPhase.rowCount, timed_out: auditPhase.timedOut, failed: auditPhase.failed },
        { phase_key: "approvals", duration_ms: approvalsPhase.durationMs, rows: approvalsPhase.rowCount, timed_out: approvalsPhase.timedOut, failed: approvalsPhase.failed },
        { phase_key: "allocation", duration_ms: allocationsPhase.durationMs, rows: allocationsPhase.rowCount, timed_out: allocationsPhase.timedOut, failed: allocationsPhase.failed },
        { phase_key: "execution", duration_ms: executionPhase.durationMs, rows: executionPhase.rowCount, timed_out: executionPhase.timedOut, failed: executionPhase.failed },
        { phase_key: "opportunity", duration_ms: opportunityPhase.durationMs, rows: opportunityPhase.rowCount, timed_out: opportunityPhase.timedOut, failed: opportunityPhase.failed },
      ],
    };
    console.info(`[decision-trace] ${JSON.stringify({ mode, ...diagnostics })}`);
    return NextResponse.json({
      message: "No approval decision trace found",
      generated_at_iso: new Date().toISOString(),
      source: mode === "lite" ? "projected_from_canonical_journals" : "projected_from_control_plane_audit_and_canonical_journals",
      mode,
      diagnostics,
    }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const syntheticLookupActive = Boolean(hasSyntheticCanonicalMatch && approvalId && approvalId === syntheticCanonicalTraceKey);
  const matchingAuditRows = syntheticLookupActive ? [] : auditRows.filter((row) => pickApprovalIdFromAuditRow(row) === approvalId);
  const pendingRow = sortByAuditTimestampDesc(
    matchingAuditRows.filter((row) => String(row.category || "") === "mt5_live_order_pending_second_approval"),
  )[0] || null;
  const rejectedRow = sortByAuditTimestampDesc(
    matchingAuditRows.filter((row) => String(row.category || "") === "mt5_live_order_rejected_after_second_approval"),
  )[0] || null;
  const executedRow = sortByAuditTimestampDesc(
    matchingAuditRows.filter((row) => String(row.category || "") === "mt5_live_order_executed_double_approved"),
  )[0] || null;

  const pendingPayload = pendingRow ? asRecord(pendingRow.payload) : {};
  const rejectedPayload = rejectedRow ? asRecord(rejectedRow.payload) : {};
  const executedPayload = executedRow ? asRecord(executedRow.payload) : {};
  const approvalDecisions = approvalRows.filter((row) => row.approval_id === approvalId || (syntheticLookupActive && matchesCanonicalLookup(row, canonicalLookup)));
  const approval1Fact = approvalDecisions.find((row) => row.approval_stage === "approval_1") || null;
  const approval2Fact = approvalDecisions.find((row) => row.approval_stage === "approval_2") || null;
  const failurePayload = asRecord(rejectedPayload.failure);
  const failureDetail = asRecord(failurePayload.detail);
  const failureHardening = asRecord(failureDetail.hardening);
  const pendingHardening = asRecord(pendingPayload.go_live_hardening);
  const directHardeningAuditRow = mode === "full"
    ? matchHardeningAuditRow(
      auditRows,
      pickSymbol(pendingRow || rejectedRow || executedRow),
      pickSide(pendingRow || rejectedRow || executedRow),
      pickAccountId(pendingRow || rejectedRow || executedRow),
      pickAuditTimestamp(rejectedRow || executedRow || pendingRow),
    )
    : null;
  const directHardeningPayload = directHardeningAuditRow ? asRecord(directHardeningAuditRow.payload) : {};
  const approvalHardening = asRecord(approval2Fact?.hardening || approval1Fact?.hardening);
  const hardeningPayload = Object.keys(failureHardening).length > 0
    ? failureHardening
    : Object.keys(directHardeningPayload).length > 0
      ? directHardeningPayload
      : Object.keys(pendingHardening).length > 0
        ? pendingHardening
        : approvalHardening;

  const allocationDecision = allocationRows.find((row) => row.approval_id === approvalId || (syntheticLookupActive && matchesCanonicalLookup(row, canonicalLookup))) || null;
  const executionFact = executionRows.find((row) => row.approval_id === approvalId || (syntheticLookupActive && matchesCanonicalLookup(row, canonicalLookup))) || null;
  const opportunityCost = opportunityRows.find((row) => row.approval_id === approvalId || (syntheticLookupActive && matchesCanonicalLookup(row, canonicalLookup))) || null;
  const oracleStability = projectOracleStability(hardeningPayload);
  const decisionId = firstNonEmpty(
    approval1Fact?.decision_id,
    approval2Fact?.decision_id,
    executionFact?.decision_id,
    allocationDecision?.decision_id,
    opportunityCost?.decision_id,
    pickDecisionIdFromAuditRow(rejectedRow || executedRow || pendingRow || {}),
  );
  const tradeLifecycleId = pickTradeLifecycleId(approvalDecisions, allocationDecision, executionFact, opportunityCost);
  const blockingReason = firstNonEmpty(
    asStringArray(hardeningPayload.reasons)[0],
    failurePayload.status,
    oracleStability?.reason,
  );
  const summaryStatus = firstNonEmpty(
    failurePayload.status,
    executedPayload.status,
    pendingPayload.status,
    approval2Fact?.approval_status,
    executionFact?.decision_outcome,
    executionFact ? "executed_canonically" : null,
    allocationDecision ? "allocated_canonically" : null,
    rejectedRow ? "rejected_after_second_approval" : null,
    executedRow ? "executed" : null,
    pendingRow ? "pending_second_approval" : null,
  ) || "approval_trace_unavailable";

  const buildStartedAt = Date.now();
  const hardeningBlocked = (Boolean(rejectedRow) || Boolean(approval2Fact?.approval_status.includes("reject") || approval2Fact?.approval_status.includes("stale")))
    && Object.keys(hardeningPayload).length > 0;
  const causalSteps: DecisionTraceStage[] = [
    buildStage(
      "approval_1",
      "Approval #1",
      pendingRow ? "completed" : "missing",
      pendingRow,
      approval1Fact
        ? `Approval #1 canonically recorded as ${approval1Fact.approval_status}`
        : pendingRow
          ? `Pending second approval created for ${firstNonEmpty(pendingPayload.symbol, "UNKNOWN")} ${firstNonEmpty(pendingPayload.side, "UNKNOWN")}`
        : "First approval audit not found",
      [firstNonEmpty(approval1Fact?.first_approved_by, pendingPayload.first_approved_by)],
      approval1Fact || pendingPayload,
    ),
    buildStage(
      "approval_2",
      "Approval #2",
      approval2Fact
        ? approval2Fact.approval_status.includes("reject") || approval2Fact.approval_status.includes("stale")
          ? "blocked"
          : "completed"
        : rejectedRow || executedRow ? "completed" : pendingRow ? "pending" : "missing",
      rejectedRow || executedRow,
      approval2Fact
        ? `Approval #2 canonically recorded as ${approval2Fact.approval_status}`
        : rejectedRow || executedRow
          ? `Second approval applied by ${firstNonEmpty(rejectedPayload.second_approved_by, executedPayload.second_approved_by, "unknown_operator")}`
        : pendingRow
          ? "Awaiting second operator approval"
          : "Second approval audit not found",
      [
        firstNonEmpty(approval2Fact?.second_approved_by),
        firstNonEmpty(rejectedPayload.second_approved_by),
        firstNonEmpty(executedPayload.second_approved_by),
      ],
      approval2Fact || (Object.keys(rejectedPayload).length > 0 ? rejectedPayload : executedPayload),
    ),
    buildStage(
      "hardening",
      "Go-Live Hardening",
      hardeningBlocked
        ? "blocked"
        : Object.keys(hardeningPayload).length > 0
          ? "completed"
          : "missing",
      directHardeningAuditRow || rejectedRow,
      Object.keys(hardeningPayload).length > 0 ? formatHardeningDetail(hardeningPayload) : "Hardening snapshot not found",
      [],
      hardeningPayload,
    ),
    buildStage(
      "allocation",
      "Allocation",
      allocationDecision ? "completed" : "missing",
      null,
      allocationDecision
        ? `Canonical allocation decision linked with confidence ${allocationDecision.causality_confidence}`
        : "No canonical allocation decision appended for this approval",
      [],
      allocationDecision,
    ),
    buildStage(
      "execution",
      "Execution",
      executionFact ? "completed" : rejectedRow ? "blocked" : "missing",
      null,
      executionFact
        ? `Execution fact recorded in ${executionFact.execution_mode} mode`
        : rejectedRow
          ? "Execution never started because go-live hardening blocked the request"
          : "No execution fact appended for this approval",
      [],
      executionFact,
    ),
    buildStage(
      "outcome",
      "Outcome",
      executionFact?.decision_outcome || executionFact?.outcome_id ? "completed" : "missing",
      null,
      executionFact?.decision_outcome || executionFact?.outcome_id
        ? `Outcome linked as ${firstNonEmpty(executionFact.decision_outcome, executionFact.outcome_id, "known")}`
        : "No outcome linked for this approval",
      [],
      executionFact,
    ),
    buildStage(
      "attribution",
      "Attribution",
      executionFact?.alpha_attribution?.status === "computed" ? "completed" : "missing",
      null,
      executionFact?.alpha_attribution?.status === "computed"
        ? "Execution attribution computed"
        : "No computed attribution for this approval",
      [],
      executionFact,
    ),
    buildStage(
      "opportunity_cost",
      "Opportunity Cost",
      opportunityCost ? "completed" : "missing",
      null,
      opportunityCost
        ? `Opportunity cost status ${opportunityCost.status}`
        : "No opportunity-cost entry linked for this approval",
      [],
      opportunityCost,
    ),
  ];
  const buildDurationMs = Date.now() - buildStartedAt;

  const projectedFacts: ProjectedCausalFact[] = approvalDecisions.length > 0
    ? approvalDecisions.map((entry) => ({
      fact_type: "ApprovalDecisionFact" as const,
      fact_key: entry.approval_fact_id,
      status: entry.approval_status,
      detail: `${entry.approval_stage} recorded canonically`,
      payload: entry,
    }))
    : [
      {
        fact_type: "ApprovalDecisionFact",
        fact_key: `${approvalId}:approval_1:projected`,
        status: pendingRow ? "completed" : "missing",
        detail: causalSteps[0].detail,
        payload: pendingPayload,
      },
      {
        fact_type: "ApprovalDecisionFact",
        fact_key: `${approvalId}:approval_2:projected`,
        status: rejectedRow || executedRow ? "completed" : pendingRow ? "pending" : "missing",
        detail: causalSteps[1].detail,
        payload: Object.keys(rejectedPayload).length > 0 ? rejectedPayload : executedPayload,
      },
    ];

  for (const [suffix, entry] of [
    ["allocation", allocationDecision],
    ["execution", executionFact],
    ["opportunity_cost", opportunityCost],
  ] as const) {
    if (!entry) {
      continue;
    }
    projectedFacts.push({
      fact_type: "CanonicalJournalFact",
      fact_key: `${approvalId}:${suffix}`,
      status: "completed",
      detail: `${suffix} linked canonically`,
      payload: entry,
    });
  }

  const response: DecisionTraceResponse = {
    generated_at_iso: new Date().toISOString(),
    source: mode === "lite" ? "projected_from_canonical_journals" : "projected_from_control_plane_audit_and_canonical_journals",
    mode,
    approval_id: approvalId,
    summary: {
      status: summaryStatus,
      blocking_reason: blockingReason,
      first_approved_by: firstNonEmpty(approval1Fact?.first_approved_by, pendingPayload.first_approved_by),
      second_approved_by: firstNonEmpty(approval2Fact?.second_approved_by, rejectedPayload.second_approved_by, executedPayload.second_approved_by),
      symbol: firstNonEmpty(
        approval1Fact?.symbol,
        approval2Fact?.symbol,
        pendingPayload.symbol,
        executionFact?.instrument,
        opportunityCost?.instrument,
      ),
      side: firstNonEmpty(
        approval1Fact?.side,
        approval2Fact?.side,
        pendingPayload.side,
        executionFact?.side,
        opportunityCost?.side,
      ),
      account_id: firstNonEmpty(pendingPayload.account_id, pickAccountId(rejectedRow), pickAccountId(executedRow)),
      decision_id: decisionId,
      trade_lifecycle_id: tradeLifecycleId,
    },
    oracle_stability: oracleStability,
    causal_steps: causalSteps,
    projected_facts: projectedFacts,
    canonical_journal: {
      approval_decisions: approvalDecisions,
      allocation_decision: allocationDecision,
      execution_fact: executionFact,
      opportunity_cost: opportunityCost,
    },
    audit_context: {
      pending_second_approval: pendingRow,
      rejection_after_second_approval: rejectedRow,
      executed_double_approved: executedRow,
      direct_go_live_hardening_decision: directHardeningAuditRow,
    },
    diagnostics: {
      total_duration_ms: 0,
      partial: auditPhase.timedOut || approvalsPhase.timedOut || allocationsPhase.timedOut || executionPhase.timedOut || opportunityPhase.timedOut,
      resolved_via: resolvedVia,
      requested_ids: {
        approval_id: requestedApprovalId || null,
        decision_id: requestedDecisionId || null,
        trade_lifecycle_id: requestedTradeLifecycleId || null,
        candidate_id: requestedCandidateId || null,
      },
      phases: [
        { phase_key: "audit", duration_ms: auditPhase.durationMs, rows: auditPhase.rowCount, timed_out: auditPhase.timedOut, failed: auditPhase.failed },
        { phase_key: "approvals", duration_ms: approvalsPhase.durationMs, rows: approvalsPhase.rowCount, timed_out: approvalsPhase.timedOut, failed: approvalsPhase.failed },
        { phase_key: "allocation", duration_ms: allocationsPhase.durationMs, rows: allocationsPhase.rowCount, timed_out: allocationsPhase.timedOut, failed: allocationsPhase.failed },
        { phase_key: "execution", duration_ms: executionPhase.durationMs, rows: executionPhase.rowCount, timed_out: executionPhase.timedOut, failed: executionPhase.failed },
        { phase_key: "opportunity", duration_ms: opportunityPhase.durationMs, rows: opportunityPhase.rowCount, timed_out: opportunityPhase.timedOut, failed: opportunityPhase.failed },
        { phase_key: "build_trace", duration_ms: buildDurationMs, rows: causalSteps.length + projectedFacts.length, timed_out: buildDurationMs > DECISION_TRACE_BUILD_TIMEOUT_MS, failed: false },
      ],
    },
  };
  const serializeStartedAt = Date.now();
  const payloadSizeBytes = new TextEncoder().encode(JSON.stringify(response)).length;
  response.diagnostics.phases.push({
    phase_key: "serialize_payload",
    duration_ms: Date.now() - serializeStartedAt,
    rows: payloadSizeBytes,
    timed_out: false,
    failed: false,
  });
  response.diagnostics.total_duration_ms = Date.now() - startedAt;
  console.info(`[decision-trace] ${JSON.stringify({
    mode,
    approval_id: approvalId,
    total_duration_ms: response.diagnostics.total_duration_ms,
    partial: response.diagnostics.partial,
    resolved_via: response.diagnostics.resolved_via,
    phases: response.diagnostics.phases,
  })}`);

  return NextResponse.json(response, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}