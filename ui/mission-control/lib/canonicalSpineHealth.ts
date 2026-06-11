import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { readApprovalDecisionJournalEntries, type ApprovalDecisionJournalEntry } from "./approvalDecisionJournal";
import { readAllocationDecisionJournalEntries } from "./allocationDecisionJournal";
import { readExecutionFactJournalEntries, type ExecutionFactJournalEntry } from "./executionFactJournal";
import { readOpportunityCostJournalEntries, type OpportunityCostJournalEntry } from "./opportunityCostJournal";
import { scanV2RiskJournalDerivedActionIds } from "./v2RiskJournal";

type ProjectionSourceDiagnostics = {
  rows_scanned: number;
  rows_returned: number;
};

export type CanonicalSpineHealthSchemaVersion = "canonical-spine-health/v1";

export const CANONICAL_SPINE_HEALTH_SCHEMA_VERSION: CanonicalSpineHealthSchemaVersion = "canonical-spine-health/v1";

export type CanonicalSpineCacheAudit = {
  cache_hit: number;
  cache_miss: number;
  age_ms: number | null;
  stale: boolean;
  last_generated_at_iso: string | null;
};

type CanonicalSpineCacheEntry = {
  createdAtMs: number;
  snapshot: CanonicalSpineHealthSnapshot;
};

type CanonicalSpineNormalizedOptions = {
  sinceDays: number;
  bypassCache: boolean;
  allowStaleOnMiss: boolean;
};

type CanonicalSpineGlobal = typeof globalThis & {
  __canonicalSpineSnapshotCache__?: Map<string, CanonicalSpineCacheEntry>;
  __canonicalSpineSnapshotInflight__?: Map<string, Promise<CanonicalSpineHealthSnapshot>>;
};

const canonicalSpineGlobal = globalThis as CanonicalSpineGlobal;
const canonicalSpineSnapshotCache = canonicalSpineGlobal.__canonicalSpineSnapshotCache__ || new Map<string, CanonicalSpineCacheEntry>();
const canonicalSpineSnapshotInflight = canonicalSpineGlobal.__canonicalSpineSnapshotInflight__ || new Map<string, Promise<CanonicalSpineHealthSnapshot>>();

canonicalSpineGlobal.__canonicalSpineSnapshotCache__ = canonicalSpineSnapshotCache;
canonicalSpineGlobal.__canonicalSpineSnapshotInflight__ = canonicalSpineSnapshotInflight;

const CANONICAL_SPINE_SNAPSHOT_TTL_MS = Math.max(5_000, Math.round(Number(process.env.CANONICAL_SPINE_SNAPSHOT_TTL_MS || 60_000)));

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asPercent(numerator: number, denominator: number): number {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
}

function average(values: number[]): number {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length === 0) {
    return 0;
  }
  return Number((filtered.reduce((sum, value) => sum + value, 0) / filtered.length).toFixed(1));
}

function buildDerivedExecutionFactId(sourceId: string): string {
  return `exfact-${sourceId}`;
}

function buildDerivedOpportunityEntryId(sourceId: string): string {
  return `opp-${sourceId}`;
}

function inferFollowupExpected(entry: OpportunityCostJournalEntry): boolean {
  const marketContext = asRecord(entry.market_context);
  const correlation = asRecord(marketContext.correlation);
  if (typeof correlation.followup_expected === "boolean") {
    return correlation.followup_expected;
  }
  return String(marketContext.journal_action || "") === "execution-v7-blocked";
}

function hasExecutionOutcomePayload(entry: ExecutionFactJournalEntry): boolean {
  return entry.decision_outcome !== null
    && (
      toNumberOrNull(entry.alpha_attribution.pnl_usd) !== null
      || toNumberOrNull(entry.avg_fill_price) !== null
      || toNumberOrNull(entry.filled_notional_usd) !== null
      || entry.filled_at_iso !== null
    );
}

function hasAllocationContext(fact: ExecutionFactJournalEntry, allocations: Awaited<ReturnType<typeof readAllocationDecisionJournalEntries>>): boolean {
  const factCreatedAtMs = parseIsoMs(fact.filled_at_iso) ?? parseIsoMs(fact.created_at_iso);
  for (const allocation of allocations) {
    if (allocation.portfolio_id !== fact.portfolio_id) {
      continue;
    }
    const allocationCreatedAtMs = parseIsoMs(allocation.created_at_iso);
    if (factCreatedAtMs !== null && allocationCreatedAtMs !== null && allocationCreatedAtMs > factCreatedAtMs) {
      continue;
    }
    const strategyLinked = allocation.strategies.some((strategy) => strategy.strategy_id === fact.strategy_id)
      || allocation.selected_strategy_id === fact.strategy_id;
    if (strategyLinked) {
      return true;
    }
  }
  return false;
}

function isAttributionComputed(entry: ExecutionFactJournalEntry): boolean {
  return entry.alpha_attribution.status === "computed"
    && toNumberOrNull(entry.alpha_attribution.regime_contribution_usd) !== null
    && toNumberOrNull(entry.alpha_attribution.signal_contribution_usd) !== null
    && toNumberOrNull(entry.alpha_attribution.execution_contribution_usd) !== null;
}

export type CanonicalSpineHealthSnapshot = {
  schema_version: CanonicalSpineHealthSchemaVersion;
  generated_at_iso: string;
  window_days: number;
  source_diagnostics: ProjectionSourceDiagnostics;
  spine_match_rate_pct: number;
  allocation_link_rate_pct: number;
  approval_link_rate_pct: number;
  approval_execution_link_rate_pct: number;
  hardening_link_rate_pct: number;
  execution_link_rate_pct: number;
  outcome_link_rate_pct: number;
  opportunity_link_rate_pct: number;
  opportunity_link_rate_raw_pct: number;
  opportunity_link_rate_post_producer_pct: number;
  execution_derivation_rate_pct: number;
  allocation_decisions_24h: number;
  approval_decisions_24h: number;
  execution_facts_24h: number;
  opportunity_entries_24h: number;
  unique_strategies_24h: number;
  allocation_linked_total: number;
  approval_linked_total: number;
  approval_execution_linked_total: number;
  hardening_linked_total: number;
  execution_linked_total: number;
  execution_source_total: number;
  execution_outcome_complete_total: number;
  refusal_linked_total: number;
  refusal_source_total: number;
  refusal_linked_total_raw: number;
  refusal_source_total_raw: number;
  refusal_linked_total_post_producer: number;
  refusal_source_total_post_producer: number;
  opportunity_scored_total: number;
  opportunity_pending_total: number;
  opportunity_matching_rate_pct: number;
  followup_expected_total: number;
  followup_expected_scored: number;
  followup_expected_pending: number;
  followup_expected_matching_rate_pct: number;
  alpha_attribution_computed_total: number;
  alpha_attribution_pending_total: number;
  alpha_attribution_coverage_pct: number;
  operational_refusal_total: number;
  operational_refusal_total_post_producer: number;
  operational_refusal_by_code: Array<{ code: string; count: number }>;
  operational_refusal_by_code_post_producer: Array<{ code: string; count: number }>;
  pending_by_gate: Array<{ gate: string; count: number }>;
};

function hasHardeningContext(approval: ApprovalDecisionJournalEntry): boolean {
  return Object.keys(asRecord(approval.hardening)).length > 0;
}

function hasAllocationApprovalContext(
  approval: ApprovalDecisionJournalEntry,
  allocations: Awaited<ReturnType<typeof readAllocationDecisionJournalEntries>>,
): boolean {
  for (const allocation of allocations) {
    if (approval.allocation_id && approval.allocation_id === allocation.allocation_id) {
      return true;
    }
    if (approval.approval_id && approval.approval_id === allocation.approval_id) {
      return true;
    }
    if (approval.trade_lifecycle_id && approval.trade_lifecycle_id === allocation.trade_lifecycle_id) {
      return true;
    }
    if (approval.decision_id && approval.decision_id === allocation.decision_id) {
      return true;
    }
    if (approval.candidate_id && approval.candidate_id === allocation.candidate_id) {
      return true;
    }
  }
  return false;
}

function hasExecutionApprovalContext(
  approval: ApprovalDecisionJournalEntry,
  executionFacts: Awaited<ReturnType<typeof readExecutionFactJournalEntries>>,
): boolean {
  for (const fact of executionFacts) {
    if (approval.execution_id && approval.execution_id === fact.execution_id) {
      return true;
    }
    if (approval.approval_id && approval.approval_id === fact.approval_id) {
      return true;
    }
    if (approval.trade_lifecycle_id && approval.trade_lifecycle_id === fact.trade_lifecycle_id) {
      return true;
    }
    if (approval.decision_id && approval.decision_id === fact.decision_id) {
      return true;
    }
  }
  return false;
}

function normalizeOptions(options?: {
  sinceDays?: number;
  bypassCache?: boolean;
  allowStaleOnMiss?: boolean;
}): CanonicalSpineNormalizedOptions {
  return {
    sinceDays: Math.max(1, Math.min(365, Math.round(Number(options?.sinceDays || 30)))),
    bypassCache: Boolean(options?.bypassCache),
    allowStaleOnMiss: Boolean(options?.allowStaleOnMiss),
  };
}

function buildUnavailableSnapshot(sinceDays: number): CanonicalSpineHealthSnapshot {
  return {
    schema_version: CANONICAL_SPINE_HEALTH_SCHEMA_VERSION,
    generated_at_iso: new Date().toISOString(),
    window_days: sinceDays,
    source_diagnostics: {
      rows_scanned: 0,
      rows_returned: 0,
    },
    spine_match_rate_pct: 0,
    allocation_link_rate_pct: 0,
    approval_link_rate_pct: 0,
    approval_execution_link_rate_pct: 0,
    hardening_link_rate_pct: 0,
    execution_link_rate_pct: 0,
    outcome_link_rate_pct: 0,
    opportunity_link_rate_pct: 0,
    opportunity_link_rate_raw_pct: 0,
    opportunity_link_rate_post_producer_pct: 0,
    execution_derivation_rate_pct: 0,
    allocation_decisions_24h: 0,
    approval_decisions_24h: 0,
    execution_facts_24h: 0,
    opportunity_entries_24h: 0,
    unique_strategies_24h: 0,
    allocation_linked_total: 0,
    approval_linked_total: 0,
    approval_execution_linked_total: 0,
    hardening_linked_total: 0,
    execution_linked_total: 0,
    execution_source_total: 0,
    execution_outcome_complete_total: 0,
    refusal_linked_total: 0,
    refusal_source_total: 0,
    refusal_linked_total_raw: 0,
    refusal_source_total_raw: 0,
    refusal_linked_total_post_producer: 0,
    refusal_source_total_post_producer: 0,
    opportunity_scored_total: 0,
    opportunity_pending_total: 0,
    opportunity_matching_rate_pct: 0,
    followup_expected_total: 0,
    followup_expected_scored: 0,
    followup_expected_pending: 0,
    followup_expected_matching_rate_pct: 0,
    alpha_attribution_computed_total: 0,
    alpha_attribution_pending_total: 0,
    alpha_attribution_coverage_pct: 0,
    operational_refusal_total: 0,
    operational_refusal_total_post_producer: 0,
    operational_refusal_by_code: [],
    operational_refusal_by_code_post_producer: [],
    pending_by_gate: [],
  };
}

export function assertCanonicalSpineHealthSnapshot(snapshot: CanonicalSpineHealthSnapshot): CanonicalSpineHealthSnapshot {
  const diagnostics = asRecord(snapshot.source_diagnostics);
  const numericFields = [
    snapshot.window_days,
    snapshot.spine_match_rate_pct,
    snapshot.allocation_link_rate_pct,
    snapshot.approval_link_rate_pct,
    snapshot.execution_link_rate_pct,
    snapshot.outcome_link_rate_pct,
    snapshot.alpha_attribution_coverage_pct,
    diagnostics.rows_scanned,
    diagnostics.rows_returned,
  ];
  if (snapshot.schema_version !== CANONICAL_SPINE_HEALTH_SCHEMA_VERSION) {
    throw new Error(`CanonicalSpine schema mismatch: ${String(snapshot.schema_version || "missing")}`);
  }
  if (!Number.isFinite(Date.parse(String(snapshot.generated_at_iso || "")))) {
    throw new Error("CanonicalSpine generated_at_iso invalid");
  }
  if (numericFields.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)) {
    throw new Error("CanonicalSpine numeric metrics invalid");
  }
  if (!Array.isArray(snapshot.operational_refusal_by_code) || !Array.isArray(snapshot.pending_by_gate)) {
    throw new Error("CanonicalSpine arrays invalid");
  }
  return snapshot;
}

function cacheKey(options: CanonicalSpineNormalizedOptions): string {
  return `sinceDays:${options.sinceDays}`;
}

function snapshotFilePath(options: CanonicalSpineNormalizedOptions): string {
  const snapshotDir = process.env.CANONICAL_SPINE_SNAPSHOT_DIR || path.resolve(process.cwd(), "../../logs");
  return path.join(snapshotDir, `mission-control-canonical-spine-${options.sinceDays}d-snapshot.json`);
}

function snapshotAgeMs(snapshot: CanonicalSpineHealthSnapshot): number | null {
  const generatedAtMs = parseIsoMs(snapshot.generated_at_iso);
  if (generatedAtMs === null) {
    return null;
  }
  return Math.max(0, Date.now() - generatedAtMs);
}

function isFreshEntry(entry: CanonicalSpineCacheEntry): boolean {
  const ageMs = snapshotAgeMs(entry.snapshot);
  if (ageMs === null) {
    return Date.now() - entry.createdAtMs <= CANONICAL_SPINE_SNAPSHOT_TTL_MS;
  }
  return ageMs <= CANONICAL_SPINE_SNAPSHOT_TTL_MS;
}

function normalizeCachedSnapshot(raw: unknown): CanonicalSpineHealthSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const payload = raw as Partial<CanonicalSpineHealthSnapshot>;
  if (typeof payload.generated_at_iso !== "string" || !payload.generated_at_iso.trim()) {
    return null;
  }
  if (!Number.isFinite(Number(payload.window_days || Number.NaN))) {
    return null;
  }
  try {
    return assertCanonicalSpineHealthSnapshot(payload as CanonicalSpineHealthSnapshot);
  } catch {
    return null;
  }
}

async function readSnapshotFromDisk(options: CanonicalSpineNormalizedOptions): Promise<CanonicalSpineCacheEntry | null> {
  const filePath = snapshotFilePath(options);
  try {
    const metadata = await stat(filePath);
    const content = await readFile(filePath, "utf-8");
    const snapshot = normalizeCachedSnapshot(JSON.parse(content) as unknown);
    if (!snapshot) {
      return null;
    }
    const entry = {
      createdAtMs: metadata.mtimeMs,
      snapshot,
    };
    canonicalSpineSnapshotCache.set(cacheKey(options), entry);
    return entry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    return null;
  }
}

async function readCachedSnapshotEntry(options: CanonicalSpineNormalizedOptions): Promise<CanonicalSpineCacheEntry | null> {
  const key = cacheKey(options);
  const cached = canonicalSpineSnapshotCache.get(key);
  if (cached) {
    return cached;
  }
  return readSnapshotFromDisk(options);
}

async function persistSnapshot(options: CanonicalSpineNormalizedOptions, snapshot: CanonicalSpineHealthSnapshot): Promise<void> {
  const filePath = snapshotFilePath(options);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempFilePath = `${filePath}.tmp`;
  await writeFile(tempFilePath, JSON.stringify(snapshot), "utf-8");
  await rename(tempFilePath, filePath);
}

async function refreshSnapshot(options: CanonicalSpineNormalizedOptions): Promise<CanonicalSpineHealthSnapshot> {
  const key = cacheKey(options);
  let inflight = canonicalSpineSnapshotInflight.get(key);
  if (!inflight) {
    inflight = buildCanonicalSpineHealthSnapshotUncached({ sinceDays: options.sinceDays })
      .then(async (snapshot) => {
        const entry = {
          createdAtMs: Date.now(),
          snapshot,
        };
        canonicalSpineSnapshotCache.set(key, entry);
        await persistSnapshot(options, snapshot);
        return snapshot;
      })
      .finally(() => {
        canonicalSpineSnapshotInflight.delete(key);
      });
    canonicalSpineSnapshotInflight.set(key, inflight);
  }
  return inflight;
}

export async function inspectCanonicalSpineSnapshotCache(options?: {
  sinceDays?: number;
}): Promise<CanonicalSpineCacheAudit> {
  const input = normalizeOptions(options);
  const cached = await readCachedSnapshotEntry(input);
  const ageMs = cached ? snapshotAgeMs(cached.snapshot) : null;
  const cacheHit = Boolean(cached && isFreshEntry(cached));
  return {
    cache_hit: cacheHit ? 1 : 0,
    cache_miss: cacheHit ? 0 : 1,
    age_ms: ageMs,
    stale: Boolean(cached && !cacheHit),
    last_generated_at_iso: cached?.snapshot.generated_at_iso || null,
  };
}

async function buildCanonicalSpineHealthSnapshotUncached(options?: {
  sinceDays?: number;
}): Promise<CanonicalSpineHealthSnapshot> {
  const sinceDays = Math.max(1, Math.min(365, Math.round(Number(options?.sinceDays || 30))));
  const dayWindow = 1;
  const [approvals, approvals24h, allocations, allocations24h, executionFacts, executionFacts24h, opportunities, opportunities24h] = await Promise.all([
    readApprovalDecisionJournalEntries({ limit: 2000, sinceDays }),
    readApprovalDecisionJournalEntries({ limit: 2000, sinceDays: dayWindow }),
    readAllocationDecisionJournalEntries({ limit: 2000, sinceDays }),
    readAllocationDecisionJournalEntries({ limit: 2000, sinceDays: dayWindow }),
    readExecutionFactJournalEntries({ limit: 2000, sinceDays }),
    readExecutionFactJournalEntries({ limit: 2000, sinceDays: dayWindow }),
    readOpportunityCostJournalEntries({ limit: 2000, sinceDays }),
    readOpportunityCostJournalEntries({ limit: 2000, sinceDays: dayWindow }),
  ]);
  const postProducerStartIso = opportunities
    .map((entry) => parseIsoMs(entry.created_at_iso))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)[0];
  const v2RiskDerivedIds = await scanV2RiskJournalDerivedActionIds({
    sinceDays,
    postProducerStartIso: Number.isFinite(postProducerStartIso) ? new Date(postProducerStartIso).toISOString() : null,
  });

  const executionFactsById = new Set(executionFacts.map((entry) => entry.fact_id));
  const opportunitiesById = new Set(opportunities.map((entry) => entry.entry_id));
  const executionSourceIds = [...v2RiskDerivedIds.executionOutcomeSourceIds].filter(Boolean);
  const refusalSourceIds = [...v2RiskDerivedIds.refusalSourceIdsEligible].filter(Boolean);
  const refusalSourceIdsRaw = [...v2RiskDerivedIds.refusalSourceIdsRaw].filter(Boolean);
  const refusalSourceIdsRawPostProducer = [...v2RiskDerivedIds.refusalSourceIdsRawPostProducer].filter(Boolean);
  const executionLinkedTotal = executionSourceIds.filter((sourceId) => executionFactsById.has(buildDerivedExecutionFactId(sourceId))).length;
  const refusalLinkedTotal = refusalSourceIds.filter((sourceId) => opportunitiesById.has(buildDerivedOpportunityEntryId(sourceId))).length;
  const refusalLinkedTotalRaw = refusalSourceIdsRaw.filter((sourceId) => opportunitiesById.has(buildDerivedOpportunityEntryId(sourceId))).length;
  const refusalLinkedTotalPostProducer = refusalSourceIdsRawPostProducer.filter((sourceId) => opportunitiesById.has(buildDerivedOpportunityEntryId(sourceId))).length;
  const allocationLinkedTotal = executionFacts.filter((entry) => hasAllocationContext(entry, allocations)).length;
  const approvalLinkedTotal = approvals.filter((entry) => hasAllocationApprovalContext(entry, allocations)).length;
  const approvalStage2Facts = approvals.filter((entry) => entry.approval_stage === "approval_2");
  const approvalExecutionLinkedTotal = approvalStage2Facts.filter((entry) => hasExecutionApprovalContext(entry, executionFacts)).length;
  const hardeningLinkedTotal = approvalStage2Facts.filter((entry) => hasHardeningContext(entry)).length;
  const executionOutcomeCompleteTotal = executionFacts.filter((entry) => hasExecutionOutcomePayload(entry)).length;

  const opportunityScoredTotal = opportunities.filter((entry) => entry.status === "scored").length;
  const opportunityPendingTotal = opportunities.filter((entry) => entry.status !== "scored").length;
  const followupExpectedEntries = opportunities.filter((entry) => inferFollowupExpected(entry));
  const followupExpectedScored = followupExpectedEntries.filter((entry) => entry.status === "scored").length;
  const followupExpectedPending = followupExpectedEntries.filter((entry) => entry.status !== "scored").length;
  const alphaAttributionComputedTotal = executionFacts.filter((entry) => isAttributionComputed(entry)).length;
  const alphaAttributionPendingTotal = Math.max(0, executionFacts.length - alphaAttributionComputedTotal);
  const allocationLinkRatePct = asPercent(allocationLinkedTotal, executionFacts.length);
  const approvalLinkRatePct = asPercent(approvalLinkedTotal, approvals.length);
  const approvalExecutionLinkRatePct = asPercent(approvalExecutionLinkedTotal, approvalStage2Facts.length);
  const hardeningLinkRatePct = asPercent(hardeningLinkedTotal, approvalStage2Facts.length);
  const executionLinkRatePct = asPercent(executionOutcomeCompleteTotal, executionFacts.length);
  const outcomeLinkRatePct = asPercent(alphaAttributionComputedTotal, executionFacts.length);
  const opportunityLinkRatePct = asPercent(refusalLinkedTotal, refusalSourceIds.length);
  const opportunityLinkRateRawPct = asPercent(refusalLinkedTotalRaw, refusalSourceIdsRaw.length);
  const opportunityLinkRatePostProducerPct = asPercent(refusalLinkedTotalPostProducer, refusalSourceIdsRawPostProducer.length);
  const executionDerivationRatePct = asPercent(executionLinkedTotal, executionSourceIds.length);
  const spineMatchRatePct = average([
    allocationLinkRatePct,
    approvalLinkRatePct,
    approvalExecutionLinkRatePct,
    executionLinkRatePct,
    outcomeLinkRatePct,
    opportunityLinkRatePct,
  ]);
  const uniqueStrategies = new Set<string>();
  for (const allocation of allocations24h) {
    for (const strategy of allocation.strategies) {
      if (strategy.strategy_id) {
        uniqueStrategies.add(strategy.strategy_id);
      }
    }
  }
  for (const fact of executionFacts24h) {
    if (fact.strategy_id) {
      uniqueStrategies.add(fact.strategy_id);
    }
  }
  for (const opportunity of opportunities24h) {
    if (opportunity.strategy_id) {
      uniqueStrategies.add(opportunity.strategy_id);
    }
  }
  const pendingByGate = [...opportunities
    .filter((entry) => entry.status !== "scored")
    .reduce((acc, entry) => {
      const gate = String(entry.gate_name || "unknown").trim() || "unknown";
      acc.set(gate, (acc.get(gate) || 0) + 1);
      return acc;
    }, new Map<string, number>())
    .entries()]
    .map(([gate, count]) => ({ gate, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);
  const operationalRefusalByCode = [...v2RiskDerivedIds.operationalRefusalCountsByCode.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);
  const operationalRefusalByCodePostProducer = [...v2RiskDerivedIds.operationalRefusalCountsByCodePostProducer.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);
  const operationalRefusalTotal = operationalRefusalByCode.reduce((sum, item) => sum + item.count, 0)
    + [...v2RiskDerivedIds.operationalRefusalCountsByCode.entries()].slice(5).reduce((sum, [, count]) => sum + count, 0);
  const operationalRefusalTotalPostProducer = operationalRefusalByCodePostProducer.reduce((sum, item) => sum + item.count, 0)
    + [...v2RiskDerivedIds.operationalRefusalCountsByCodePostProducer.entries()].slice(5).reduce((sum, [, count]) => sum + count, 0);

  return assertCanonicalSpineHealthSnapshot({
    schema_version: CANONICAL_SPINE_HEALTH_SCHEMA_VERSION,
    generated_at_iso: new Date().toISOString(),
    window_days: sinceDays,
    source_diagnostics: {
      rows_scanned: approvals.length + approvals24h.length + allocations.length + allocations24h.length + executionFacts.length + executionFacts24h.length + opportunities.length + opportunities24h.length,
      rows_returned: 1,
    },
    spine_match_rate_pct: spineMatchRatePct,
    allocation_link_rate_pct: allocationLinkRatePct,
    approval_link_rate_pct: approvalLinkRatePct,
    approval_execution_link_rate_pct: approvalExecutionLinkRatePct,
    hardening_link_rate_pct: hardeningLinkRatePct,
    execution_link_rate_pct: executionLinkRatePct,
    outcome_link_rate_pct: outcomeLinkRatePct,
    opportunity_link_rate_pct: opportunityLinkRatePct,
    opportunity_link_rate_raw_pct: opportunityLinkRateRawPct,
    opportunity_link_rate_post_producer_pct: opportunityLinkRatePostProducerPct,
    execution_derivation_rate_pct: executionDerivationRatePct,
    allocation_decisions_24h: allocations24h.length,
    approval_decisions_24h: approvals24h.length,
    execution_facts_24h: executionFacts24h.length,
    opportunity_entries_24h: opportunities24h.length,
    unique_strategies_24h: uniqueStrategies.size,
    allocation_linked_total: allocationLinkedTotal,
    approval_linked_total: approvalLinkedTotal,
    approval_execution_linked_total: approvalExecutionLinkedTotal,
    hardening_linked_total: hardeningLinkedTotal,
    execution_linked_total: executionLinkedTotal,
    execution_source_total: executionSourceIds.length,
    execution_outcome_complete_total: executionOutcomeCompleteTotal,
    refusal_linked_total: refusalLinkedTotal,
    refusal_source_total: refusalSourceIds.length,
    refusal_linked_total_raw: refusalLinkedTotalRaw,
    refusal_source_total_raw: refusalSourceIdsRaw.length,
    refusal_linked_total_post_producer: refusalLinkedTotalPostProducer,
    refusal_source_total_post_producer: refusalSourceIdsRawPostProducer.length,
    opportunity_scored_total: opportunityScoredTotal,
    opportunity_pending_total: opportunityPendingTotal,
    opportunity_matching_rate_pct: opportunities.length > 0 ? Number(((opportunityScoredTotal / opportunities.length) * 100).toFixed(1)) : 0,
    followup_expected_total: followupExpectedEntries.length,
    followup_expected_scored: followupExpectedScored,
    followup_expected_pending: followupExpectedPending,
    followup_expected_matching_rate_pct: followupExpectedEntries.length > 0 ? Number(((followupExpectedScored / followupExpectedEntries.length) * 100).toFixed(1)) : 0,
    alpha_attribution_computed_total: alphaAttributionComputedTotal,
    alpha_attribution_pending_total: alphaAttributionPendingTotal,
    alpha_attribution_coverage_pct: executionFacts.length > 0 ? Number(((alphaAttributionComputedTotal / executionFacts.length) * 100).toFixed(1)) : 0,
    operational_refusal_total: operationalRefusalTotal,
    operational_refusal_total_post_producer: operationalRefusalTotalPostProducer,
    operational_refusal_by_code: operationalRefusalByCode,
    operational_refusal_by_code_post_producer: operationalRefusalByCodePostProducer,
    pending_by_gate: pendingByGate,
  });
}

export async function buildCanonicalSpineHealthSnapshot(options?: {
  sinceDays?: number;
  bypassCache?: boolean;
  allowStaleOnMiss?: boolean;
}): Promise<CanonicalSpineHealthSnapshot> {
  const input = normalizeOptions(options);
  if (!input.bypassCache) {
    const cached = await readCachedSnapshotEntry(input);
    if (cached) {
      if (isFreshEntry(cached)) {
        return cached.snapshot;
      }
      void refreshSnapshot(input).catch(() => null);
      return cached.snapshot;
    }
    if (input.allowStaleOnMiss) {
      void refreshSnapshot(input).catch(() => null);
      return buildUnavailableSnapshot(input.sinceDays);
    }
  }
  return refreshSnapshot(input);
}