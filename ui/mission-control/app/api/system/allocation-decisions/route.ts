import { NextRequest, NextResponse } from "next/server";

import { getControlPlaneToken } from "../../../../lib/controlPlane";
import {
  appendAllocationDecisionJournalEntry,
  readAllocationDecisionJournalEntries,
  type AllocationDecisionJournalEntry,
  type AllocationDecisionStrategyEntry,
} from "../../../../lib/allocationDecisionJournal";
import {
  appendAllocationWriterAuditEntry,
  type AllocationWriterAuditEntry,
  type AllocationWriterAuditErrorCode,
  type AllocationWriterStage,
} from "../../../../lib/allocationWriterAuditJournal";

function unauthorized(): NextResponse {
  return NextResponse.json({ message: "Authentication required" }, { status: 401 });
}

function buildId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function buildAuditEventId(prefix: string, allocationId: string | null): string {
  return `${prefix}-${allocationId || "unknown"}-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function parseCausalityConfidence(value: unknown): AllocationDecisionJournalEntry["causality_confidence"] {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "native" || normalized === "backfilled" || normalized === "inferred") {
    return normalized;
  }
  return null;
}

function normalizeStrategyEntry(raw: unknown): AllocationDecisionStrategyEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const payload = raw as Partial<AllocationDecisionStrategyEntry>;
  const strategyId = String(payload.strategy_id || "").trim();
  if (!strategyId) {
    return null;
  }
  return {
    strategy_id: strategyId,
    regime: String(payload.regime || "UNKNOWN").trim() || "UNKNOWN",
    allocated_pct: Number(payload.allocated_pct || 0),
    allocated_capital_usd: Number(payload.allocated_capital_usd || 0),
    score: Number(payload.score || 0),
    status: String(payload.status || "unknown").trim() || "unknown",
    expected_edge_usd: Number(payload.expected_edge_usd || 0),
    expected_sharpe: Number(payload.expected_sharpe || 0),
    expected_drawdown_pct: Number(payload.expected_drawdown_pct || 0),
    expected_win_rate_pct: Number(payload.expected_win_rate_pct || 0),
    sample_size: Number(payload.sample_size || 0),
    blocked: Boolean(payload.blocked),
    reasons: Array.isArray(payload.reasons) ? payload.reasons.map((reason) => String(reason || "").trim()).filter(Boolean).slice(0, 8) : [],
  };
}

function toOptionalString(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

function buildAuditBase(body: Record<string, unknown>, allocationId: string | null): Omit<AllocationWriterAuditEntry, "event_id" | "writer_result" | "writer_error_code" | "writer_error_detail" | "validation_errors" | "created_at_iso"> {
  return {
    allocation_id: allocationId,
    decision_id: toOptionalString(body.decision_id || body.decisionId),
    candidate_id: toOptionalString(body.candidate_id || body.candidateId || body.oracle_fingerprint || body.oracleFingerprint),
    trade_lifecycle_id: toOptionalString(body.trade_lifecycle_id || body.tradeLifecycleId),
    portfolio_id: toOptionalString(body.portfolio_id || body.portfolioId),
    selected_strategy_id: toOptionalString(body.selected_strategy_id || body.selectedStrategyId),
    writer_version: String(body.allocator_version || body.allocatorVersion || "portfolio-allocator-v1").trim() || "portfolio-allocator-v1",
    writer_timestamp_iso: String(body.writer_timestamp_iso || body.writerTimestampIso || body.created_at_iso || body.createdAtIso || new Date().toISOString()).trim(),
  };
}

async function appendAudit(
  base: Omit<AllocationWriterAuditEntry, "event_id" | "writer_result" | "writer_error_code" | "writer_error_detail" | "validation_errors" | "created_at_iso">,
  result: AllocationWriterAuditEntry["writer_result"],
  errorCode: AllocationWriterAuditErrorCode,
  options?: {
    errorDetail?: string | null;
    validationErrors?: string[];
    previousStage?: AllocationWriterStage | null;
    nextStage?: AllocationWriterStage | null;
  },
): Promise<void> {
  await appendAllocationWriterAuditEntry({
    ...base,
    event_id: buildAuditEventId(result, base.allocation_id),
    transition_id: buildAuditEventId("transition", base.allocation_id),
    writer_result: result,
    writer_error_code: errorCode,
    writer_error_detail: options?.errorDetail || null,
    previous_stage: options?.previousStage ?? (result === "persisted" ? "CREATED" : null),
    next_stage: options?.nextStage ?? (result === "persisted" ? "PERSISTED" : "CREATED"),
    transition_success: result !== "failed",
    failure_reason: result === "failed" ? errorCode : null,
    validation_errors: options?.validationErrors || [],
    created_at_iso: new Date().toISOString(),
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = await getControlPlaneToken();
  if (!token) {
    return unauthorized();
  }
  const portfolioId = request.nextUrl.searchParams.get("portfolioId") || "";
  const decisionId = request.nextUrl.searchParams.get("decisionId") || "";
  const limit = Number(request.nextUrl.searchParams.get("limit") || 100);
  const sinceDays = Number(request.nextUrl.searchParams.get("sinceDays") || 0);
  const entries = await readAllocationDecisionJournalEntries({ portfolioId, decisionId, limit, sinceDays });
  return NextResponse.json({ entries });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = await getControlPlaneToken();
  if (!token) {
    return unauthorized();
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const requestedAllocationId = toOptionalString(body.allocation_id || body.allocationId);
  const allocationId = requestedAllocationId || buildId("alloc");
  const auditBase = buildAuditBase(body, allocationId);
  const auditOnly = Boolean(body.audit_only || body.auditOnly);

  if (auditOnly) {
    await appendAudit(
      auditBase,
      String(body.writer_result || body.writerResult || "failed").trim().toLowerCase() === "persisted" ? "persisted" : String(body.writer_result || body.writerResult || "failed").trim().toLowerCase() === "created" ? "created" : "failed",
      String(body.writer_error_code || body.writerErrorCode || "none").trim().toLowerCase() === "writer_timeout"
        ? "writer_timeout"
        : String(body.writer_error_code || body.writerErrorCode || "none").trim().toLowerCase() === "writer_append_failure"
          ? "writer_append_failure"
          : String(body.writer_error_code || body.writerErrorCode || "none").trim().toLowerCase() === "writer_journal_error"
            ? "writer_journal_error"
            : String(body.writer_error_code || body.writerErrorCode || "none").trim().toLowerCase() === "writer_identity_error"
              ? "writer_identity_error"
              : String(body.writer_error_code || body.writerErrorCode || "none").trim().toLowerCase() === "writer_validation_error"
                ? "writer_validation_error"
                : "none",
      {
        errorDetail: toOptionalString(body.writer_error_detail || body.writerErrorDetail),
        validationErrors: Array.isArray(body.validation_errors) ? body.validation_errors.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 8) : [],
        previousStage: toOptionalString(body.previous_stage || body.previousStage) as AllocationWriterStage | null,
        nextStage: toOptionalString(body.next_stage || body.nextStage) as AllocationWriterStage | null,
      },
    );
    return NextResponse.json({ ok: true, audit_logged: true });
  }

  const portfolioId = String(body.portfolio_id || body.portfolioId || "").trim();
  const validationErrors: string[] = [];
  if (!portfolioId) {
    validationErrors.push("portfolio_id is required");
  }
  if (validationErrors.length > 0) {
    await appendAudit(auditBase, "failed", "writer_validation_error", {
      errorDetail: validationErrors.join(" | "),
      validationErrors,
      previousStage: null,
      nextStage: "CREATED",
    });
    return NextResponse.json({ message: validationErrors[0] }, { status: 400 });
  }
  const strategies = Array.isArray(body.strategies)
    ? body.strategies.map((entry) => normalizeStrategyEntry(entry)).filter((entry): entry is AllocationDecisionStrategyEntry => entry !== null)
    : [];
  const decisionId = String(body.decision_id || body.decisionId || `allocdec-${allocationId}`).trim();
  const candidateId = String(body.candidate_id || body.candidateId || body.oracle_fingerprint || body.oracleFingerprint || "").trim();
  const identityIssues = [
    String(body.decision_id || body.decisionId || "").trim().length === 0 ? "missing_decision_id" : null,
    candidateId.length === 0 ? "missing_candidate_id" : null,
  ].filter((value): value is string => value !== null);

  await appendAudit(auditBase, "created", identityIssues.length > 0 ? "writer_identity_error" : "none", {
    errorDetail: identityIssues.join(" | ") || null,
    previousStage: null,
    nextStage: "CREATED",
  });

  const entry: AllocationDecisionJournalEntry = {
    allocation_id: allocationId,
    trade_lifecycle_id: String(body.trade_lifecycle_id || body.tradeLifecycleId || decisionId).trim() || null,
    candidate_id: candidateId || null,
    decision_id: decisionId || null,
    causality_confidence: parseCausalityConfidence(body.causality_confidence || body.causalityConfidence),
    approval_id: String(body.approval_id || body.approvalId || "").trim() || null,
    execution_id: String(body.execution_id || body.executionId || "").trim() || null,
    outcome_id: String(body.outcome_id || body.outcomeId || "").trim() || null,
    portfolio_id: portfolioId,
    selected_strategy_id: String(body.selected_strategy_id || body.selectedStrategyId || "").trim(),
    allocator_version: String(body.allocator_version || body.allocatorVersion || "portfolio-allocator-v1").trim() || "portfolio-allocator-v1",
    capital_mode: String(body.capital_mode || body.capitalMode || "unknown").trim() || "unknown",
    evolution_mode: String(body.evolution_mode || body.evolutionMode || "unknown").trim() || "unknown",
    market_state: String(body.market_state || body.marketState || "UNKNOWN").trim() || "UNKNOWN",
    market_regime: String(body.market_regime || body.marketRegime || "UNKNOWN").trim() || "UNKNOWN",
    market_temperature: String(body.market_temperature || body.marketTemperature || "UNKNOWN").trim() || "UNKNOWN",
    available_capital_usd: Number(body.available_capital_usd || body.availableCapitalUsd || 0),
    selected_strategy_size_multiplier: Number(body.selected_strategy_size_multiplier || body.selectedStrategySizeMultiplier || 1),
    truth_quality_pct: Number(body.truth_quality_pct || body.truthQualityPct || 0),
    memory_cues: Array.isArray(body.memory_cues) ? body.memory_cues.map((cue) => String(cue || "").trim()).filter(Boolean).slice(0, 16) : [],
    strategies,
    created_at_iso: String(body.created_at_iso || body.createdAtIso || new Date().toISOString()).trim(),
  };
  try {
    await appendAllocationDecisionJournalEntry(entry);
    await appendAudit(auditBase, "persisted", identityIssues.length > 0 ? "writer_identity_error" : "none", {
      errorDetail: identityIssues.join(" | ") || null,
      previousStage: "CREATED",
      nextStage: "PERSISTED",
    });
    return NextResponse.json({ ok: true, entry, audit_logged: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "allocation_writer_append_failure";
    await appendAudit(auditBase, "failed", "writer_append_failure", {
      errorDetail: detail,
      previousStage: "CREATED",
      nextStage: "PERSISTED",
    });
    return NextResponse.json({ message: "allocation writer append failed", detail }, { status: 500 });
  }
}