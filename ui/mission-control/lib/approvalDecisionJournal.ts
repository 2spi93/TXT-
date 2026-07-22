import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type ApprovalDecisionCausalityConfidence = "native" | "backfilled" | "inferred";
export type ApprovalDecisionJournalSchemaVersion = "approval-decision/v1";

export const APPROVAL_DECISION_JOURNAL_SCHEMA_VERSION: ApprovalDecisionJournalSchemaVersion = "approval-decision/v1";

export type ApprovalDecisionJournalEntry = {
  schema_version: ApprovalDecisionJournalSchemaVersion;
  approval_fact_id: string;
  approval_id: string;
  approval_stage: "approval_1" | "approval_2";
  approval_status: string;
  trade_lifecycle_id: string | null;
  candidate_id: string | null;
  decision_id: string | null;
  causality_confidence?: ApprovalDecisionCausalityConfidence | null;
  allocation_id: string | null;
  execution_id: string | null;
  outcome_id: string | null;
  account_id: string | null;
  portfolio_id: string | null;
  strategy_id: string | null;
  symbol: string;
  side: string;
  lots: number | null;
  estimated_notional_usd: number | null;
  approval_mode: string;
  first_approved_by: string | null;
  second_approved_by: string | null;
  rejection_code: string | null;
  rejection_reason: string | null;
  predictor_summary: string | null;
  hardening: Record<string, unknown>;
  risk_context: Record<string, unknown>;
  order_payload: Record<string, unknown>;
  source_event_category: string;
  created_at_iso: string;
};

type ApprovalDecisionJournalCache = {
  filePath: string;
  mtimeMs: number;
  size: number;
  rows: ApprovalDecisionJournalEntry[];
};

let journalCache: ApprovalDecisionJournalCache | null = null;

function filePath(): string {
  const journalDir = process.env.APPROVAL_DECISION_JOURNAL_DIR || "/tmp";
  const journalFile = process.env.APPROVAL_DECISION_JOURNAL_FILE || "mission-control-approval-decisions.jsonl";
  return path.join(journalDir, journalFile);
}

function normalizeOptionalId(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeSchemaVersion(value: unknown): ApprovalDecisionJournalSchemaVersion | null {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === APPROVAL_DECISION_JOURNAL_SCHEMA_VERSION) {
    return APPROVAL_DECISION_JOURNAL_SCHEMA_VERSION;
  }
  return null;
}

function normalizeEntry(raw: unknown): ApprovalDecisionJournalEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const payload = raw as Partial<ApprovalDecisionJournalEntry>;
  const schemaVersion = normalizeSchemaVersion(payload.schema_version);
  const approvalFactId = String(payload.approval_fact_id || "").trim();
  const approvalId = String(payload.approval_id || "").trim();
  const approvalStage = String(payload.approval_stage || "").trim();
  const symbol = String(payload.symbol || "").trim().toUpperCase();
  const side = String(payload.side || "").trim().toLowerCase();
  const createdAtIso = String(payload.created_at_iso || "").trim();
  if (!schemaVersion || !approvalFactId || !approvalId || !symbol || !side || !createdAtIso || !Number.isFinite(Date.parse(createdAtIso))) {
    return null;
  }
  if (approvalStage !== "approval_1" && approvalStage !== "approval_2") {
    return null;
  }
  return {
    schema_version: schemaVersion,
    approval_fact_id: approvalFactId,
    approval_id: approvalId,
    approval_stage: approvalStage,
    approval_status: String(payload.approval_status || "unknown").trim() || "unknown",
    trade_lifecycle_id: normalizeOptionalId(payload.trade_lifecycle_id),
    candidate_id: normalizeOptionalId(payload.candidate_id),
    decision_id: normalizeOptionalId(payload.decision_id),
    causality_confidence: normalizeOptionalId(payload.causality_confidence) as ApprovalDecisionCausalityConfidence | null,
    allocation_id: normalizeOptionalId(payload.allocation_id),
    execution_id: normalizeOptionalId(payload.execution_id),
    outcome_id: normalizeOptionalId(payload.outcome_id),
    account_id: normalizeOptionalId(payload.account_id),
    portfolio_id: normalizeOptionalId(payload.portfolio_id),
    strategy_id: normalizeOptionalId(payload.strategy_id),
    symbol,
    side,
    lots: toNumberOrNull(payload.lots),
    estimated_notional_usd: toNumberOrNull(payload.estimated_notional_usd),
    approval_mode: String(payload.approval_mode || "mt5_double_approval").trim() || "mt5_double_approval",
    first_approved_by: normalizeOptionalId(payload.first_approved_by),
    second_approved_by: normalizeOptionalId(payload.second_approved_by),
    rejection_code: normalizeOptionalId(payload.rejection_code),
    rejection_reason: normalizeOptionalId(payload.rejection_reason),
    predictor_summary: normalizeOptionalId(payload.predictor_summary),
    hardening: normalizeRecord(payload.hardening),
    risk_context: normalizeRecord(payload.risk_context),
    order_payload: normalizeRecord(payload.order_payload),
    source_event_category: String(payload.source_event_category || "approval_decision_event").trim() || "approval_decision_event",
    created_at_iso: createdAtIso,
  };
}

export function assertApprovalDecisionJournalEntry(entry: ApprovalDecisionJournalEntry): ApprovalDecisionJournalEntry {
  const normalized = normalizeEntry(entry);
  if (!normalized) {
    throw new Error("ApprovalDecisionJournal contract violation");
  }
  return normalized;
}

async function loadAllEntries(): Promise<ApprovalDecisionJournalEntry[]> {
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
      .filter((row): row is ApprovalDecisionJournalEntry => row !== null);
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

export async function appendApprovalDecisionJournalEntry(entry: ApprovalDecisionJournalEntry): Promise<void> {
  const normalizedEntry = assertApprovalDecisionJournalEntry(entry);
  const target = filePath();
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(normalizedEntry)}\n`, "utf-8");
  journalCache = null;
}

export async function readApprovalDecisionJournalEntries(options?: {
  approvalId?: string;
  decisionId?: string;
  symbol?: string;
  stage?: "approval_1" | "approval_2";
  limit?: number;
  sinceDays?: number;
}): Promise<ApprovalDecisionJournalEntry[]> {
  const approvalId = String(options?.approvalId || "").trim();
  const decisionId = String(options?.decisionId || "").trim();
  const symbol = String(options?.symbol || "").trim().toUpperCase();
  const stage = options?.stage;
  const limit = Math.max(1, Math.min(2_000, Math.round(Number(options?.limit || 100))));
  const sinceDays = Math.max(0, Math.min(365, Number(options?.sinceDays || 0)));
  const cutoffMs = sinceDays > 0 ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : 0;

  try {
    const rows = await loadAllEntries();
    const results: ApprovalDecisionJournalEntry[] = [];
    for (let index = rows.length - 1; index >= 0 && results.length < limit; index -= 1) {
      const row = rows[index];
      if (cutoffMs > 0) {
        const createdAtMs = Date.parse(String(row.created_at_iso || ""));
        if (Number.isFinite(createdAtMs) && createdAtMs < cutoffMs) {
          break;
        }
      }
      if (approvalId && row.approval_id !== approvalId) continue;
      if (decisionId && row.decision_id !== decisionId) continue;
      if (symbol && row.symbol !== symbol) continue;
      if (stage && row.approval_stage !== stage) continue;
      results.push(row);
    }
    return results;
  } catch {
    return [];
  }
}