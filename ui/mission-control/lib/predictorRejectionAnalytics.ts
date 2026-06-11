import { readApprovalDecisionJournalEntries, type ApprovalDecisionJournalEntry } from "./approvalDecisionJournal";
import {
  backfillApprovalDecisionJournalFromCanonicalSource,
  readCanonicalMt5ApprovalDecisionEntries,
} from "./mt5LiveApprovalCanonicalSource";

type JsonMap = Record<string, unknown>;

export type PredictorRejectionAnalyticsSchemaVersion = "predictor-rejection-analytics/v1";

export const PREDICTOR_REJECTION_ANALYTICS_SCHEMA_VERSION: PredictorRejectionAnalyticsSchemaVersion = "predictor-rejection-analytics/v1";

type ProjectionSourceDiagnostics = {
  rows_scanned: number;
  rows_returned: number;
  journal_rows?: number;
  canonical_rows?: number;
  backfilled_rows?: number;
};

export type PredictorRejectionCauseRow = {
  reason_key: string;
  label: string;
  count: number;
  share_pct: number;
  unique_symbols: string[];
  sessions: string[];
  regimes: string[];
};

export type PredictorBreakdownRow = {
  key: string;
  label: string;
  evaluated_total: number;
  accepted_total: number;
  rejected_total: number;
  acceptance_rate_pct: number;
  rejection_rate_pct: number;
};

export type PredictorRejectionAnalyticsSnapshot = {
  schema_version: PredictorRejectionAnalyticsSchemaVersion;
  generated_at_iso: string;
  window_days: number;
  predictor_evaluated_total: number;
  predictor_accepted_total: number;
  predictor_rejected_total: number;
  predictor_acceptance_rate_pct: number;
  source_diagnostics: ProjectionSourceDiagnostics;
  rejections_by_cause: PredictorRejectionCauseRow[];
  top_rejection_causes: PredictorRejectionCauseRow[];
  symbol_rows: PredictorBreakdownRow[];
  session_rows: PredictorBreakdownRow[];
  regime_rows: PredictorBreakdownRow[];
  hour_rows: PredictorBreakdownRow[];
};

type BreakdownAccumulator = {
  key: string;
  label: string;
  evaluated_total: number;
  accepted_total: number;
  rejected_total: number;
};

const PREDICTOR_REASON_HINTS = [
  "predictor",
  "brain_action_mismatch",
  "insufficient_renderable_bars",
  "no_renderable_rows",
  "missing_volume",
  "missing_volume_30s",
  "missing_depth_imbalance",
  "depth_imbalance",
  "latency_guard",
  "p50_below_threshold",
  "p20_below_threshold",
  "world_slippage_above_threshold",
  "fill_probability",
  "slippage",
  "latency",
  "hold",
] as const;

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonMap
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asPercent(numerator: number, denominator: number): number {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
}

function normalizeText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function humanizeLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Unknown";
  }
  const [base, qualifier] = trimmed.split(":", 2);
  const baseLabel = base
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
  if (!qualifier) {
    return baseLabel;
  }
  const suffix = qualifier.trim();
  return suffix ? `${baseLabel}: ${suffix.toUpperCase()}` : baseLabel;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    rows.push(normalized);
  }
  return rows;
}

function looksLikePredictorReason(value: unknown): boolean {
  const normalized = normalizeText(value);
  return normalized.length > 0 && PREDICTOR_REASON_HINTS.some((token) => normalized.includes(token));
}

function normalizeReasonKey(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const [base, qualifier] = raw.split(":", 2);
  const normalizedBase = base.trim().toLowerCase().replace(/\s+/g, "_");
  if (!qualifier) {
    return normalizedBase;
  }
  const normalizedQualifier = qualifier.trim().toUpperCase();
  return normalizedQualifier ? `${normalizedBase}:${normalizedQualifier}` : normalizedBase;
}

function extractPredictorReasonKeys(entry: ApprovalDecisionJournalEntry): string[] {
  const hardening = asRecord(entry.hardening);
  const predictor = asRecord(hardening.predictor);
  const worldModel = asRecord(predictor.world_model);
  const worldSummary = asRecord(worldModel.summary);
  const riskContext = asRecord(entry.risk_context);
  const reasonKeys: string[] = [];
  const rejectionCodeKey = normalizeReasonKey(entry.rejection_code);
  const rejectionReasonKey = normalizeReasonKey(entry.rejection_reason);

  const pushReason = (value: unknown): void => {
    if (!looksLikePredictorReason(value)) {
      return;
    }
    const key = normalizeReasonKey(value);
    if (key) {
      reasonKeys.push(key);
    }
  };

  for (const value of asArray(hardening.reasons)) {
    pushReason(value);
  }
  for (const value of asArray(hardening.codes)) {
    pushReason(value);
  }
  for (const value of asArray(hardening.blockers)) {
    pushReason(value);
  }
  for (const value of asArray(predictor.reasons)) {
    pushReason(value);
  }
  for (const value of asArray(predictor.failure_reasons)) {
    pushReason(value);
  }
  for (const value of asArray(worldSummary.reasons)) {
    pushReason(value);
  }

  const renderableRows = toNumberOrNull(hardening.renderable_rows);
  const volume30s = toNumberOrNull(hardening.volume_30s ?? riskContext.volume_30s);
  const depthImbalance = hardening.depth_imbalance ?? riskContext.depth_imbalance;

  if (renderableRows !== null && renderableRows < 48) {
    reasonKeys.push("insufficient_renderable_bars");
  }
  if (volume30s !== null && volume30s <= 0) {
    reasonKeys.push("missing_volume");
  }
  if (depthImbalance === null && reasonKeys.some((reason) => reason.includes("depth_imbalance"))) {
    reasonKeys.push("missing_depth_imbalance");
  }

  const normalizedReasons = dedupeStrings(reasonKeys);
  if (normalizedReasons.length > 0) {
    return normalizedReasons;
  }
  if (rejectionReasonKey && rejectionReasonKey !== "blocked_by_predictor" && looksLikePredictorReason(entry.rejection_reason)) {
    return [rejectionReasonKey];
  }
  if (rejectionCodeKey && rejectionCodeKey !== "blocked_by_predictor" && looksLikePredictorReason(entry.rejection_code)) {
    return [rejectionCodeKey];
  }
  if (normalizeText(entry.rejection_code).includes("predictor") || normalizeText(entry.rejection_reason).includes("predictor")) {
    return ["blocked_by_predictor"];
  }
  return [];
}

function resolveRegimeKey(entry: ApprovalDecisionJournalEntry): string {
  const orderPayload = asRecord(entry.order_payload);
  const metadata = asRecord(orderPayload.metadata);
  const orderIntent = asRecord(orderPayload.order_intent);
  const hardening = asRecord(entry.hardening);
  const predictor = asRecord(hardening.predictor);
  const worldModel = asRecord(predictor.world_model);
  const worldSummary = asRecord(worldModel.summary);
  const candidates = [
    entry.predictor_summary,
    asRecord(metadata.final_decision_truth).state,
    asRecord(orderIntent.final_decision_truth).state,
    orderPayload.regime_at_fill,
    worldSummary.future_regime,
    worldSummary.regime,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeText(candidate);
    if (!normalized) {
      continue;
    }
    if (normalized.includes("high") && normalized.includes("vol")) {
      return "high_vol";
    }
    if (normalized.includes("low") && normalized.includes("vol")) {
      return "low_vol";
    }
    if (normalized.includes("trend")) {
      return "trend";
    }
    if (normalized.includes("range")) {
      return "range";
    }
  }

  return "unknown";
}

function regimeLabel(key: string): string {
  if (key === "high_vol") return "High Vol";
  if (key === "low_vol") return "Low Vol";
  if (key === "trend") return "Trend";
  if (key === "range") return "Range";
  return "Unknown";
}

function resolveSessionKey(hourUtc: number): string {
  if (hourUtc >= 0 && hourUtc < 8) return "asia";
  if (hourUtc >= 8 && hourUtc < 13) return "europe";
  if (hourUtc >= 13 && hourUtc < 17) return "us_open";
  return "us_pm";
}

function sessionLabel(key: string): string {
  if (key === "asia") return "Asia";
  if (key === "europe") return "Europe";
  if (key === "us_open") return "US Open";
  return "US PM";
}

function resolveHourUtc(isoTimestamp: string): number | null {
  const parsed = Date.parse(String(isoTimestamp || ""));
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).getUTCHours();
}

function createAccumulator(key: string, label: string): BreakdownAccumulator {
  return {
    key,
    label,
    evaluated_total: 0,
    accepted_total: 0,
    rejected_total: 0,
  };
}

function updateAccumulator(
  map: Map<string, BreakdownAccumulator>,
  key: string,
  label: string,
  accepted: boolean,
): void {
  const current = map.get(key) || createAccumulator(key, label);
  current.evaluated_total += 1;
  if (accepted) {
    current.accepted_total += 1;
  } else {
    current.rejected_total += 1;
  }
  map.set(key, current);
}

function finalizeBreakdownRows(rows: Iterable<BreakdownAccumulator>): PredictorBreakdownRow[] {
  return [...rows]
    .map((row) => ({
      ...row,
      acceptance_rate_pct: asPercent(row.accepted_total, row.evaluated_total),
      rejection_rate_pct: asPercent(row.rejected_total, row.evaluated_total),
    }))
    .sort((left, right) => {
      if (right.rejected_total !== left.rejected_total) {
        return right.rejected_total - left.rejected_total;
      }
      if (right.evaluated_total !== left.evaluated_total) {
        return right.evaluated_total - left.evaluated_total;
      }
      return left.label.localeCompare(right.label);
    });
}

function approvalJournalKey(entry: ApprovalDecisionJournalEntry): string {
  return `${entry.approval_id}:${entry.approval_stage}`;
}

function mergeApprovalDecisionEntries(
  journalRows: ApprovalDecisionJournalEntry[],
  canonicalRows: ApprovalDecisionJournalEntry[],
): ApprovalDecisionJournalEntry[] {
  const merged = new Map<string, ApprovalDecisionJournalEntry>();
  for (const row of canonicalRows) {
    merged.set(approvalJournalKey(row), row);
  }
  for (const row of journalRows) {
    merged.set(approvalJournalKey(row), row);
  }
  return [...merged.values()]
    .sort((left, right) => Date.parse(String(right.created_at_iso || "")) - Date.parse(String(left.created_at_iso || "")));
}

function isAcceptedApproval(entry: ApprovalDecisionJournalEntry): boolean {
  if (entry.approval_stage !== "approval_2") {
    return false;
  }
  const status = normalizeText(entry.approval_status);
  const category = normalizeText(entry.source_event_category);
  if (status.includes("reject") || status.includes("cancel") || status.includes("stale")) {
    return false;
  }
  return status.includes("approved")
    || status.includes("executed")
    || status.includes("filled")
    || category.includes("executed_double_approved");
}

function isPredictorRejectedApproval(entry: ApprovalDecisionJournalEntry, reasonKeys: string[]): boolean {
  if (entry.approval_stage !== "approval_2") {
    return false;
  }
  if (reasonKeys.length > 0) {
    return true;
  }
  return normalizeText(entry.rejection_code).includes("predictor");
}

export function assertPredictorRejectionAnalyticsSnapshot(
  snapshot: PredictorRejectionAnalyticsSnapshot,
): PredictorRejectionAnalyticsSnapshot {
  const diagnostics = asRecord(snapshot.source_diagnostics);
  const numericFields = [
    snapshot.window_days,
    snapshot.predictor_evaluated_total,
    snapshot.predictor_accepted_total,
    snapshot.predictor_rejected_total,
    snapshot.predictor_acceptance_rate_pct,
    diagnostics.rows_scanned,
    diagnostics.rows_returned,
  ];
  if (snapshot.schema_version !== PREDICTOR_REJECTION_ANALYTICS_SCHEMA_VERSION) {
    throw new Error(`Predictor analytics schema mismatch: ${String(snapshot.schema_version || "missing")}`);
  }
  if (!Number.isFinite(Date.parse(String(snapshot.generated_at_iso || "")))) {
    throw new Error("Predictor analytics generated_at_iso invalid");
  }
  if (numericFields.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)) {
    throw new Error("Predictor analytics numeric counters invalid");
  }
  if (!Array.isArray(snapshot.top_rejection_causes) || !Array.isArray(snapshot.rejections_by_cause)) {
    throw new Error("Predictor analytics cause arrays invalid");
  }
  return snapshot;
}

export async function buildPredictorRejectionAnalyticsSnapshot(options?: {
  sinceDays?: number;
}): Promise<PredictorRejectionAnalyticsSnapshot> {
  const sinceDays = Math.max(1, Math.min(365, Math.round(Number(options?.sinceDays || 30))));
  const backfillSummary = await backfillApprovalDecisionJournalFromCanonicalSource({ sinceDays, limit: 2000 }).catch(() => ({
    canonical_rows: 0,
    journal_rows: 0,
    appended_rows: 0,
  }));
  const [journalApprovals, canonicalApprovals] = await Promise.all([
    readApprovalDecisionJournalEntries({ limit: 2000, sinceDays, stage: "approval_2" }),
    readCanonicalMt5ApprovalDecisionEntries({ limit: 2000, sinceDays }).catch(() => []),
  ]);
  const approvals = mergeApprovalDecisionEntries(journalApprovals, canonicalApprovals);

  const causeRows = new Map<string, {
    reason_key: string;
    label: string;
    count: number;
    symbols: Set<string>;
    sessions: Set<string>;
    regimes: Set<string>;
  }>();
  const symbolRows = new Map<string, BreakdownAccumulator>();
  const sessionRows = new Map<string, BreakdownAccumulator>();
  const regimeRows = new Map<string, BreakdownAccumulator>();
  const hourRows = new Map<string, BreakdownAccumulator>();

  let predictorAcceptedTotal = 0;
  let predictorRejectedTotal = 0;

  for (const entry of approvals) {
    const accepted = isAcceptedApproval(entry);
    const reasonKeys = extractPredictorReasonKeys(entry);
    const rejected = isPredictorRejectedApproval(entry, reasonKeys);
    if (!accepted && !rejected) {
      continue;
    }

    const symbolKey = String(entry.symbol || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    const hourUtc = resolveHourUtc(entry.created_at_iso);
    const sessionKey = resolveSessionKey(hourUtc ?? 0);
    const regimeKey = resolveRegimeKey(entry);
    const hourKey = hourUtc === null ? "unknown" : `${hourUtc}`.padStart(2, "0");

    updateAccumulator(symbolRows, symbolKey, symbolKey, accepted);
    updateAccumulator(sessionRows, sessionKey, sessionLabel(sessionKey), accepted);
    updateAccumulator(regimeRows, regimeKey, regimeLabel(regimeKey), accepted);
    updateAccumulator(hourRows, hourKey, hourUtc === null ? "Unknown" : `${hourKey}:00 UTC`, accepted);

    if (accepted) {
      predictorAcceptedTotal += 1;
      continue;
    }

    predictorRejectedTotal += 1;
    for (const reasonKey of reasonKeys.length > 0 ? reasonKeys : ["blocked_by_predictor"]) {
      const current = causeRows.get(reasonKey) || {
        reason_key: reasonKey,
        label: humanizeLabel(reasonKey),
        count: 0,
        symbols: new Set<string>(),
        sessions: new Set<string>(),
        regimes: new Set<string>(),
      };
      current.count += 1;
      current.symbols.add(symbolKey);
      current.sessions.add(sessionLabel(sessionKey));
      current.regimes.add(regimeLabel(regimeKey));
      causeRows.set(reasonKey, current);
    }
  }

  const predictorEvaluatedTotal = predictorAcceptedTotal + predictorRejectedTotal;
  const rejectionsByCause = [...causeRows.values()]
    .map((row) => ({
      reason_key: row.reason_key,
      label: row.label,
      count: row.count,
      share_pct: asPercent(row.count, predictorRejectedTotal),
      unique_symbols: [...row.symbols].sort(),
      sessions: [...row.sessions].sort(),
      regimes: [...row.regimes].sort((left, right) => (left === "Unknown" ? 1 : right === "Unknown" ? -1 : left.localeCompare(right))),
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.label.localeCompare(right.label);
    });

  return {
    schema_version: PREDICTOR_REJECTION_ANALYTICS_SCHEMA_VERSION,
    generated_at_iso: new Date().toISOString(),
    window_days: sinceDays,
    predictor_evaluated_total: predictorEvaluatedTotal,
    predictor_accepted_total: predictorAcceptedTotal,
    predictor_rejected_total: predictorRejectedTotal,
    predictor_acceptance_rate_pct: asPercent(predictorAcceptedTotal, predictorEvaluatedTotal),
    source_diagnostics: {
      rows_scanned: approvals.length,
      rows_returned: predictorEvaluatedTotal,
      journal_rows: journalApprovals.length,
      canonical_rows: canonicalApprovals.length,
      backfilled_rows: backfillSummary.appended_rows,
    },
    rejections_by_cause: rejectionsByCause,
    top_rejection_causes: rejectionsByCause.slice(0, 10),
    symbol_rows: finalizeBreakdownRows(symbolRows.values()),
    session_rows: finalizeBreakdownRows(sessionRows.values()),
    regime_rows: finalizeBreakdownRows(regimeRows.values()),
    hour_rows: finalizeBreakdownRows(hourRows.values()).sort((left, right) => left.key.localeCompare(right.key)),
  };
}