import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type AllocationWriterAuditResult = "created" | "persisted" | "failed";
export type AllocationWriterEntryKind = "writer_audit" | "stage_transition";

export type AllocationWriterStage =
  | "CREATED"
  | "PERSISTED"
  | "APPROVAL_CREATED"
  | "APPROVAL_LINKED"
  | "HARDENING_REACHED"
  | "EXECUTION_CREATED"
  | "OUTCOME_CREATED"
  | "ATTRIBUTION_CREATED"
  | "OPPORTUNITY_CREATED";

export const ALLOCATION_WRITER_STAGE_ORDER: AllocationWriterStage[] = [
  "CREATED",
  "PERSISTED",
  "APPROVAL_CREATED",
  "APPROVAL_LINKED",
  "HARDENING_REACHED",
  "EXECUTION_CREATED",
  "OUTCOME_CREATED",
  "ATTRIBUTION_CREATED",
  "OPPORTUNITY_CREATED",
];

export type AllocationWriterAuditErrorCode =
  | "none"
  | "writer_timeout"
  | "writer_append_failure"
  | "writer_journal_error"
  | "writer_identity_error"
  | "writer_validation_error";

export type AllocationWriterAuditEntry = {
  event_id: string;
  entry_kind?: AllocationWriterEntryKind;
  transition_id?: string;
  allocation_id: string | null;
  decision_id: string | null;
  candidate_id: string | null;
  trade_lifecycle_id: string | null;
  portfolio_id: string | null;
  selected_strategy_id: string | null;
  writer_version: string;
  writer_timestamp_iso: string;
  writer_result: AllocationWriterAuditResult;
  writer_error_code: AllocationWriterAuditErrorCode;
  writer_error_detail: string | null;
  previous_stage?: AllocationWriterStage | null;
  next_stage?: AllocationWriterStage | null;
  transition_success?: boolean;
  failure_reason?: string | null;
  validation_errors: string[];
  created_at_iso: string;
};

export type AllocationWriterStageTransitionInput = {
  allocation_id?: string | null;
  decision_id?: string | null;
  candidate_id?: string | null;
  trade_lifecycle_id?: string | null;
  portfolio_id?: string | null;
  selected_strategy_id?: string | null;
  writer_version?: string | null;
  writer_timestamp_iso?: string | null;
  previous_stage: AllocationWriterStage | null;
  next_stage: AllocationWriterStage;
  success?: boolean;
  failure_reason?: string | null;
  writer_error_code?: AllocationWriterAuditErrorCode;
  writer_error_detail?: string | null;
  validation_errors?: string[];
};

type AllocationWriterAuditJournalCache = {
  filePath: string;
  mtimeMs: number;
  size: number;
  rows: AllocationWriterAuditEntry[];
};

let journalCache: AllocationWriterAuditJournalCache | null = null;

function filePath(): string {
  const journalDir = process.env.ALLOCATION_WRITER_AUDIT_JOURNAL_DIR || process.env.ALLOCATION_DECISION_JOURNAL_DIR || "/tmp";
  const journalFile = process.env.ALLOCATION_WRITER_AUDIT_JOURNAL_FILE || "mission-control-allocation-writer-audit.jsonl";
  return path.join(journalDir, journalFile);
}

function normalizeOptionalId(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeAuditResult(value: unknown): AllocationWriterAuditResult {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "persisted" || normalized === "failed") {
    return normalized;
  }
  return "created";
}

function normalizeAuditErrorCode(value: unknown): AllocationWriterAuditErrorCode {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "writer_timeout"
    || normalized === "writer_append_failure"
    || normalized === "writer_journal_error"
    || normalized === "writer_identity_error"
    || normalized === "writer_validation_error"
  ) {
    return normalized;
  }
  return "none";
}

function normalizeEntryKind(value: unknown): AllocationWriterEntryKind {
  return String(value || "").trim().toLowerCase() === "stage_transition"
    ? "stage_transition"
    : "writer_audit";
}

function normalizeStage(value: unknown): AllocationWriterStage | null {
  const normalized = String(value || "").trim().toUpperCase();
  return ALLOCATION_WRITER_STAGE_ORDER.includes(normalized as AllocationWriterStage)
    ? normalized as AllocationWriterStage
    : null;
}

function normalizeEntry(raw: unknown): AllocationWriterAuditEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const payload = raw as Partial<AllocationWriterAuditEntry>;
  const eventId = String(payload.event_id || "").trim();
  const writerVersion = String(payload.writer_version || "allocation-writer-v1").trim() || "allocation-writer-v1";
  const writerTimestampIso = String(payload.writer_timestamp_iso || "").trim();
  const createdAtIso = String(payload.created_at_iso || "").trim();
  if (!eventId || !writerTimestampIso || !createdAtIso) {
    return null;
  }
  return {
    event_id: eventId,
    entry_kind: normalizeEntryKind(payload.entry_kind),
    transition_id: normalizeOptionalId(payload.transition_id) || eventId,
    allocation_id: normalizeOptionalId(payload.allocation_id),
    decision_id: normalizeOptionalId(payload.decision_id),
    candidate_id: normalizeOptionalId(payload.candidate_id),
    trade_lifecycle_id: normalizeOptionalId(payload.trade_lifecycle_id),
    portfolio_id: normalizeOptionalId(payload.portfolio_id),
    selected_strategy_id: normalizeOptionalId(payload.selected_strategy_id),
    writer_version: writerVersion,
    writer_timestamp_iso: writerTimestampIso,
    writer_result: normalizeAuditResult(payload.writer_result),
    writer_error_code: normalizeAuditErrorCode(payload.writer_error_code),
    writer_error_detail: normalizeOptionalId(payload.writer_error_detail),
    previous_stage: normalizeStage(payload.previous_stage),
    next_stage: normalizeStage(payload.next_stage),
    transition_success: typeof payload.transition_success === "boolean"
      ? payload.transition_success
      : normalizeAuditResult(payload.writer_result) !== "failed",
    failure_reason: normalizeOptionalId(payload.failure_reason),
    validation_errors: Array.isArray(payload.validation_errors)
      ? payload.validation_errors.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 8)
      : [],
    created_at_iso: createdAtIso,
  };
}

async function loadAllEntries(): Promise<AllocationWriterAuditEntry[]> {
  const target = filePath();
  try {
    const metadata = await stat(target);
    if (
      journalCache
      && journalCache.filePath === target
      && journalCache.mtimeMs === metadata.mtimeMs
      && journalCache.size === metadata.size
    ) {
      return journalCache.rows;
    }
    const content = await readFile(target, "utf-8");
    const rows = content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return normalizeEntry(JSON.parse(line) as unknown);
        } catch {
          return null;
        }
      })
      .filter((row): row is AllocationWriterAuditEntry => row !== null);
    journalCache = {
      filePath: target,
      mtimeMs: metadata.mtimeMs,
      size: metadata.size,
      rows,
    };
    return rows;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      journalCache = null;
      return [];
    }
    throw error;
  }
}

export async function appendAllocationWriterAuditEntry(entry: AllocationWriterAuditEntry): Promise<void> {
  const normalized = normalizeEntry(entry);
  if (!normalized) {
    return;
  }
  const target = filePath();
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(normalized)}\n`, "utf-8");
  journalCache = null;
}

export async function appendAllocationWriterStageTransition(input: AllocationWriterStageTransitionInput): Promise<void> {
  const writerTimestampIso = String(input.writer_timestamp_iso || new Date().toISOString()).trim() || new Date().toISOString();
  const transitionId = `transition-${String(input.allocation_id || input.decision_id || input.trade_lifecycle_id || "unknown")}-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
  await appendAllocationWriterAuditEntry({
    event_id: transitionId,
    entry_kind: "stage_transition",
    transition_id: transitionId,
    allocation_id: normalizeOptionalId(input.allocation_id),
    decision_id: normalizeOptionalId(input.decision_id),
    candidate_id: normalizeOptionalId(input.candidate_id),
    trade_lifecycle_id: normalizeOptionalId(input.trade_lifecycle_id),
    portfolio_id: normalizeOptionalId(input.portfolio_id),
    selected_strategy_id: normalizeOptionalId(input.selected_strategy_id),
    writer_version: String(input.writer_version || "allocation-writer-v1").trim() || "allocation-writer-v1",
    writer_timestamp_iso: writerTimestampIso,
    writer_result: input.success === false ? "failed" : "persisted",
    writer_error_code: input.success === false ? normalizeAuditErrorCode(input.writer_error_code) : "none",
    writer_error_detail: normalizeOptionalId(input.writer_error_detail),
    previous_stage: input.previous_stage,
    next_stage: input.next_stage,
    transition_success: input.success !== false,
    failure_reason: normalizeOptionalId(input.failure_reason),
    validation_errors: Array.isArray(input.validation_errors)
      ? input.validation_errors.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 8)
      : [],
    created_at_iso: writerTimestampIso,
  });
}

export async function appendAllocationWriterStageTransitions(inputs: AllocationWriterStageTransitionInput[]): Promise<void> {
  for (const input of inputs) {
    await appendAllocationWriterStageTransition(input);
  }
}

export async function readAllocationWriterAuditEntries(options?: {
  allocationId?: string;
  decisionId?: string;
  limit?: number;
  sinceDays?: number;
}): Promise<AllocationWriterAuditEntry[]> {
  const allocationId = String(options?.allocationId || "").trim();
  const decisionId = String(options?.decisionId || "").trim();
  const limit = Math.max(1, Math.min(5000, Math.round(Number(options?.limit || 100))));
  const sinceDays = Math.max(0, Math.min(365, Number(options?.sinceDays || 0)));
  const cutoffMs = sinceDays > 0 ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : 0;

  try {
    const rows = await loadAllEntries();
    const results: AllocationWriterAuditEntry[] = [];
    for (let index = rows.length - 1; index >= 0 && results.length < limit; index -= 1) {
      const row = rows[index];
      if (cutoffMs > 0) {
        const createdAtMs = Date.parse(String(row.created_at_iso || ""));
        if (Number.isFinite(createdAtMs) && createdAtMs < cutoffMs) {
          break;
        }
      }
      if (allocationId && row.allocation_id !== allocationId) continue;
      if (decisionId && row.decision_id !== decisionId) continue;
      results.push(row);
    }
    return results;
  } catch {
    return [];
  }
}