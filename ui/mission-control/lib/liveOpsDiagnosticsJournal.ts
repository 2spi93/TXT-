import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { SourceTreeProvenanceStatus } from "./sourceTreeProvenanceView";

type LiveOpsProjectionKey = "runtime_truth" | "canonical_spine" | "trade_lifecycle_health" | "hardening_analytics_30d";

export type LiveOpsProjectionSourceAudit = {
  rows_scanned: number;
  rows_returned: number;
  cache_hit: number;
  cache_miss: number;
  cache_age_ms: number | null;
};

export type LiveOpsDiagnosticsDecisionGapStageSample = {
  stage_key: string;
  label: string;
  gap_label: string;
  blocked_decision_total: number;
  share_pct: number;
  exemplar_decision_ids: string[];
};

export type LiveOpsDiagnosticsDecisionGapStageWindowSummary = {
  stage_key: string;
  label: string;
  gap_label: string;
  blocked_decision_total: LiveOpsDiagnosticsMetricSummary;
  share_pct: LiveOpsDiagnosticsMetricSummary;
  earliest_blocked_decision_total: number;
  latest_blocked_decision_total: number;
  blocked_decision_growth: number;
  dominance_count: number;
  exemplar_decisions: Array<{
    decision_id: string;
    occurrence_count: number;
  }>;
};

export type LiveOpsDiagnosticsDecisionGapReductionSample = {
  incomplete_decision_total: number;
  by_stage: LiveOpsDiagnosticsDecisionGapStageSample[];
};

export type LiveOpsDiagnosticsDecisionGapReductionWindowSummary = {
  incomplete_decision_total: LiveOpsDiagnosticsMetricSummary;
  dominant_stage_key_latest: string | null;
  dominant_gap_label_latest: string | null;
  dominant_stage_key_earliest: string | null;
  dominant_gap_label_earliest: string | null;
  by_stage: LiveOpsDiagnosticsDecisionGapStageWindowSummary[];
};

export type LiveOpsDiagnosticsDecisionGapBacklogBucketSample = {
  bucket_key: string;
  label: string;
  open_gap_total: number;
  share_pct: number;
};

export type LiveOpsDiagnosticsDecisionGapBacklogBucketWindowSummary = {
  bucket_key: string;
  label: string;
  open_gap_total: LiveOpsDiagnosticsMetricSummary;
  share_pct: LiveOpsDiagnosticsMetricSummary;
  earliest_open_gap_total: number;
  latest_open_gap_total: number;
  open_gap_growth: number;
};

export type LiveOpsDiagnosticsDecisionGapOldestOpenSample = {
  decision_id: string | null;
  gap_label: string | null;
  open_age_hours: number;
  root_cause_code: string | null;
};

export type LiveOpsDiagnosticsDecisionGapOldestOpenWindowSummary = {
  open_age_hours: LiveOpsDiagnosticsMetricSummary;
  latest_decision_id: string | null;
  latest_gap_label: string | null;
  latest_root_cause_code: string | null;
  latest_open_age_hours: number;
  earliest_decision_id: string | null;
  earliest_gap_label: string | null;
  earliest_root_cause_code: string | null;
  earliest_open_age_hours: number;
};

export type LiveOpsDiagnosticsDecisionGapRootCauseSample = {
  root_cause_code: string;
  label: string;
  open_gap_total: number;
  share_pct: number;
};

export type LiveOpsDiagnosticsDecisionGapRootCauseWindowSummary = {
  root_cause_code: string;
  label: string;
  open_gap_total: LiveOpsDiagnosticsMetricSummary;
  share_pct: LiveOpsDiagnosticsMetricSummary;
  earliest_open_gap_total: number;
  latest_open_gap_total: number;
  open_gap_growth: number;
  dominance_count: number;
};

export type LiveOpsDiagnosticsDecisionGapCardinalitySample = {
  gap_occurrence_total: number;
  unique_decision_total: number;
  unique_trade_lifecycle_total: number;
  unique_root_cause_total: number;
  by_root_cause: LiveOpsDiagnosticsDecisionGapRootCauseSample[];
};

export type LiveOpsDiagnosticsDecisionGapCardinalityWindowSummary = {
  gap_occurrence_total: LiveOpsDiagnosticsMetricSummary;
  unique_decision_total: LiveOpsDiagnosticsMetricSummary;
  unique_trade_lifecycle_total: LiveOpsDiagnosticsMetricSummary;
  unique_root_cause_total: LiveOpsDiagnosticsMetricSummary;
  dominant_root_cause_code_latest: string | null;
  dominant_root_cause_label_latest: string | null;
  dominant_root_cause_code_earliest: string | null;
  dominant_root_cause_label_earliest: string | null;
  by_root_cause: LiveOpsDiagnosticsDecisionGapRootCauseWindowSummary[];
};

export type LiveOpsDiagnosticsDecisionGapResolutionSample = {
  open_gap_total: number;
  resolved_gap_total: number;
  gap_resolution_rate_pct: number;
  mean_time_to_continuity_hours: number | null;
  dominant_open_gap_stage_key: string | null;
  dominant_open_gap_label: string | null;
  dominant_open_gap_total: number;
  dominant_open_gap_share_pct: number;
  backlog_age_buckets: LiveOpsDiagnosticsDecisionGapBacklogBucketSample[];
  oldest_open_gap: LiveOpsDiagnosticsDecisionGapOldestOpenSample | null;
  dominant_gap_cardinality: LiveOpsDiagnosticsDecisionGapCardinalitySample | null;
};

export type LiveOpsDiagnosticsDecisionGapResolutionWindowSummary = {
  open_gap_total: LiveOpsDiagnosticsMetricSummary;
  resolved_gap_total: LiveOpsDiagnosticsMetricSummary;
  gap_resolution_rate_pct: LiveOpsDiagnosticsMetricSummary;
  mean_time_to_continuity_hours: LiveOpsDiagnosticsMetricSummary;
  dominant_open_gap_stage_key_latest: string | null;
  dominant_open_gap_label_latest: string | null;
  dominant_open_gap_stage_key_earliest: string | null;
  dominant_open_gap_label_earliest: string | null;
  dominant_open_gap_total_latest: number;
  dominant_open_gap_total_earliest: number;
  dominant_open_gap_total_growth: number;
  dominant_open_gap_share_pct_latest: number;
  dominant_open_gap_share_pct_earliest: number;
  oldest_open_gap: LiveOpsDiagnosticsDecisionGapOldestOpenWindowSummary;
  backlog_age_buckets: LiveOpsDiagnosticsDecisionGapBacklogBucketWindowSummary[];
  dominant_gap_cardinality: LiveOpsDiagnosticsDecisionGapCardinalityWindowSummary;
};

export type LiveOpsDiagnosticsSourceTreeProvenanceSample = {
  status: SourceTreeProvenanceStatus;
  commit_alignment_rate: number;
  observable_commit_count: number;
  aligned_commit_count: number;
  publish_blocked: boolean;
};

export type LiveOpsDiagnosticsSourceTreeProvenanceWindowSummary = {
  commit_alignment_rate: LiveOpsDiagnosticsMetricSummary;
  healthy_alignment_hours: number;
  governance_breach_count: number;
  longest_divergence_period_hours: number;
  aligned_sample_count: number;
  blocked_sample_count: number;
  latest_status: SourceTreeProvenanceStatus;
  earliest_status: SourceTreeProvenanceStatus;
  latest_publish_blocked: boolean;
  latest_observable_commit_count: number;
  status_counts: Record<SourceTreeProvenanceStatus, number>;
};

export type LiveOpsDiagnosticsSample = {
  timestamp_iso: string;
  aggregate_window_days: number;
  runtime_truth_ms: number;
  canonical_spine_ms: number;
  trade_lifecycle_ms: number;
  hardening_analytics_ms: number;
  payload_size_bytes: number;
  tri_score: number;
  tri_status: string;
  tri_cap: number | null;
  tri_continuity: number;
  tri_evidence: number;
  tri_spine_match: number;
  tri_freshness: number;
  source_tree_provenance: LiveOpsDiagnosticsSourceTreeProvenanceSample;
  decision_gap_reduction: LiveOpsDiagnosticsDecisionGapReductionSample;
  decision_gap_resolution: LiveOpsDiagnosticsDecisionGapResolutionSample;
  control_plane_timeout_paths: string[];
  local_projection_timeout_paths: string[];
  local_projection_failed_paths: string[];
  timeout_projections: string[];
  degraded_projections: string[];
  projection_durations_ms: Record<LiveOpsProjectionKey, number>;
  projection_source_audits: Record<LiveOpsProjectionKey, LiveOpsProjectionSourceAudit>;
};

export type LiveOpsDiagnosticsMetricSummary = {
  avg: number;
  p95: number;
  max: number;
};

export type LiveOpsDiagnosticsSourceAuditSummary = {
  rows_scanned_avg: number;
  rows_scanned_max: number;
  rows_returned_avg: number;
  rows_returned_max: number;
  cache_hit_total: number;
  cache_miss_total: number;
  cache_hit_rate_pct: number;
  rebuild_count: number;
  cache_age_ms_avg: number;
  cache_age_ms_max: number;
};

export type LiveOpsDiagnosticsWindowSummary = {
  window_days: number;
  sample_count: number;
  first_sample_at_iso: string | null;
  last_sample_at_iso: string | null;
  payload_size_bytes: LiveOpsDiagnosticsMetricSummary;
  projection_durations_ms: Record<LiveOpsProjectionKey, LiveOpsDiagnosticsMetricSummary>;
  projection_source_audits: Record<LiveOpsProjectionKey, LiveOpsDiagnosticsSourceAuditSummary>;
  timeout_projections: Record<LiveOpsProjectionKey, number>;
  degraded_projections: Record<LiveOpsProjectionKey, number>;
  control_plane_timeout_counts: Record<string, number>;
  source_tree_provenance: LiveOpsDiagnosticsSourceTreeProvenanceWindowSummary;
  decision_gap_reduction: LiveOpsDiagnosticsDecisionGapReductionWindowSummary;
  decision_gap_resolution: LiveOpsDiagnosticsDecisionGapResolutionWindowSummary;
  truth_reliability: {
    score_pct: LiveOpsDiagnosticsMetricSummary;
    cap_pct: LiveOpsDiagnosticsMetricSummary;
    continuity_pct: LiveOpsDiagnosticsMetricSummary;
    evidence_pct: LiveOpsDiagnosticsMetricSummary;
    spine_match_pct: LiveOpsDiagnosticsMetricSummary;
    freshness_pct: LiveOpsDiagnosticsMetricSummary;
    latest_score_pct: number;
    earliest_score_pct: number;
    reliability_growth_pct: number;
    status_counts: Record<string, number>;
  };
};

type LiveOpsDiagnosticsCache = {
  filePath: string;
  mtimeMs: number;
  size: number;
  rows: LiveOpsDiagnosticsSample[];
};

const LIVE_OPS_PROJECTION_KEYS: LiveOpsProjectionKey[] = [
  "runtime_truth",
  "canonical_spine",
  "trade_lifecycle_health",
  "hardening_analytics_30d",
];

const DECISION_GAP_STAGE_ORDER = [
  { stage_key: "allocation", label: "Allocation", gap_label: "Creation -> Allocation" },
  { stage_key: "approval", label: "Approval", gap_label: "Allocation -> Approval" },
  { stage_key: "hardening", label: "Hardening", gap_label: "Approval -> Hardening" },
  { stage_key: "execution", label: "Execution", gap_label: "Hardening -> Execution" },
  { stage_key: "outcome", label: "Outcome", gap_label: "Execution -> Outcome" },
  { stage_key: "attribution", label: "Attribution", gap_label: "Outcome -> Attribution" },
  { stage_key: "opportunity", label: "Opportunity", gap_label: "Attribution -> Opportunity" },
] as const;

const DECISION_GAP_BACKLOG_BUCKET_ORDER = [
  { bucket_key: "0_7d", label: "0-7 jours" },
  { bucket_key: "8_30d", label: "8-30 jours" },
  { bucket_key: "31_90d", label: "31-90 jours" },
  { bucket_key: "90d_plus", label: "90+ jours" },
] as const;

let diagnosticsCache: LiveOpsDiagnosticsCache | null = null;

function filePath(): string {
  const journalDir = process.env.LIVE_OPS_DIAGNOSTICS_JOURNAL_DIR || path.resolve(process.cwd(), "../../logs");
  const journalFile = process.env.LIVE_OPS_DIAGNOSTICS_JOURNAL_FILE || "mission-control-live-ops-diagnostics.jsonl";
  return path.join(journalDir, journalFile);
}

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 64)
    : [];
}

function createProjectionRecord<T>(factory: () => T): Record<LiveOpsProjectionKey, T> {
  return Object.fromEntries(LIVE_OPS_PROJECTION_KEYS.map((key) => [key, factory()])) as Record<LiveOpsProjectionKey, T>;
}

function emptyMetricSummary(): LiveOpsDiagnosticsMetricSummary {
  return { avg: 0, p95: 0, max: 0 };
}

function emptySourceAuditSummary(): LiveOpsDiagnosticsSourceAuditSummary {
  return {
    rows_scanned_avg: 0,
    rows_scanned_max: 0,
    rows_returned_avg: 0,
    rows_returned_max: 0,
    cache_hit_total: 0,
    cache_miss_total: 0,
    cache_hit_rate_pct: 0,
    rebuild_count: 0,
    cache_age_ms_avg: 0,
    cache_age_ms_max: 0,
  };
}

function normalizeSourceTreeProvenanceStatus(value: unknown): SourceTreeProvenanceStatus {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "ALIGNED" || normalized === "PARTIALLY_ALIGNED" || normalized === "DIVERGENT" || normalized === "UNKNOWN") {
    return normalized;
  }
  return "UNKNOWN";
}

function normalizeSourceTreeProvenanceSample(raw: unknown): LiveOpsDiagnosticsSourceTreeProvenanceSample {
  const payload = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Partial<LiveOpsDiagnosticsSourceTreeProvenanceSample>
    : {};
  return {
    status: normalizeSourceTreeProvenanceStatus(payload.status),
    commit_alignment_rate: Math.max(0, Math.min(100, toNumber(payload.commit_alignment_rate, 0))),
    observable_commit_count: Math.max(0, Math.round(toNumber(payload.observable_commit_count, 0))),
    aligned_commit_count: Math.max(0, Math.round(toNumber(payload.aligned_commit_count, 0))),
    publish_blocked: Boolean(payload.publish_blocked),
  };
}

function emptySourceTreeProvenanceWindowSummary(): LiveOpsDiagnosticsSourceTreeProvenanceWindowSummary {
  return {
    commit_alignment_rate: emptyMetricSummary(),
    healthy_alignment_hours: 0,
    governance_breach_count: 0,
    longest_divergence_period_hours: 0,
    aligned_sample_count: 0,
    blocked_sample_count: 0,
    latest_status: "UNKNOWN",
    earliest_status: "UNKNOWN",
    latest_publish_blocked: true,
    latest_observable_commit_count: 0,
    status_counts: {
      ALIGNED: 0,
      PARTIALLY_ALIGNED: 0,
      DIVERGENT: 0,
      UNKNOWN: 0,
    },
  };
}

function isSourceTreeGovernanceBreached(sample: LiveOpsDiagnosticsSourceTreeProvenanceSample): boolean {
  return sample.publish_blocked || sample.observable_commit_count < 4 || sample.commit_alignment_rate < 100 || sample.status !== "ALIGNED";
}

function summarizeSourceTreeProvenanceWindow(rows: LiveOpsDiagnosticsSample[]): LiveOpsDiagnosticsSourceTreeProvenanceWindowSummary {
  if (rows.length === 0) {
    return emptySourceTreeProvenanceWindowSummary();
  }

  const statusCounts: Record<SourceTreeProvenanceStatus, number> = {
    ALIGNED: 0,
    PARTIALLY_ALIGNED: 0,
    DIVERGENT: 0,
    UNKNOWN: 0,
  };
  let healthyAlignmentMs = 0;
  let governanceBreachCount = 0;
  let longestDivergenceMs = 0;
  let currentDivergenceMs = 0;
  const windowEndMs = Date.now();

  for (let index = 0; index < rows.length; index += 1) {
    const sample = rows[index].source_tree_provenance;
    statusCounts[sample.status] += 1;
    const currentAtMs = Date.parse(rows[index].timestamp_iso);
    const nextAtMs = index < rows.length - 1 ? Date.parse(rows[index + 1].timestamp_iso) : windowEndMs;
    const intervalMs = Number.isFinite(currentAtMs) && Number.isFinite(nextAtMs) && nextAtMs > currentAtMs
      ? nextAtMs - currentAtMs
      : 0;
    const breached = isSourceTreeGovernanceBreached(sample);
    const previousBreached = index > 0 ? isSourceTreeGovernanceBreached(rows[index - 1].source_tree_provenance) : false;
    if (breached) {
      if (!previousBreached) {
        governanceBreachCount += 1;
      }
      currentDivergenceMs += intervalMs;
    } else {
      healthyAlignmentMs += intervalMs;
      longestDivergenceMs = Math.max(longestDivergenceMs, currentDivergenceMs);
      currentDivergenceMs = 0;
    }
  }
  longestDivergenceMs = Math.max(longestDivergenceMs, currentDivergenceMs);

  const latest = rows[rows.length - 1].source_tree_provenance;
  const earliest = rows[0].source_tree_provenance;
  return {
    commit_alignment_rate: summarizeMetric(rows.map((row) => row.source_tree_provenance.commit_alignment_rate)),
    healthy_alignment_hours: Number((healthyAlignmentMs / (60 * 60 * 1000)).toFixed(1)),
    governance_breach_count: governanceBreachCount,
    longest_divergence_period_hours: Number((longestDivergenceMs / (60 * 60 * 1000)).toFixed(1)),
    aligned_sample_count: rows.filter((row) => !isSourceTreeGovernanceBreached(row.source_tree_provenance)).length,
    blocked_sample_count: rows.filter((row) => row.source_tree_provenance.publish_blocked).length,
    latest_status: latest.status,
    earliest_status: earliest.status,
    latest_publish_blocked: latest.publish_blocked,
    latest_observable_commit_count: latest.observable_commit_count,
    status_counts: statusCounts,
  };
}

function normalizeDecisionGapReductionSample(raw: unknown): LiveOpsDiagnosticsDecisionGapReductionSample {
  const payload = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Partial<LiveOpsDiagnosticsDecisionGapReductionSample>
    : {};
  const byStagePayload = Array.isArray(payload.by_stage) ? payload.by_stage : [];

  return {
    incomplete_decision_total: Math.max(0, Math.round(toNumber(payload.incomplete_decision_total, 0))),
    by_stage: DECISION_GAP_STAGE_ORDER.map((stage) => {
      const rawStage = byStagePayload.find((entry) => String((entry as Record<string, unknown>)?.stage_key || "").trim() === stage.stage_key);
      const stagePayload = rawStage && typeof rawStage === "object" && !Array.isArray(rawStage)
        ? rawStage as Partial<LiveOpsDiagnosticsDecisionGapStageSample>
        : {};
      return {
        stage_key: stage.stage_key,
        label: String(stagePayload.label || stage.label),
        gap_label: String(stagePayload.gap_label || stage.gap_label),
        blocked_decision_total: Math.max(0, Math.round(toNumber(stagePayload.blocked_decision_total, 0))),
        share_pct: Math.max(0, toNumber(stagePayload.share_pct, 0)),
        exemplar_decision_ids: toStringArray(stagePayload.exemplar_decision_ids).slice(0, 12),
      };
    }),
  };
}

function emptyDecisionGapReductionWindowSummary(): LiveOpsDiagnosticsDecisionGapReductionWindowSummary {
  return {
    incomplete_decision_total: emptyMetricSummary(),
    dominant_stage_key_latest: null,
    dominant_gap_label_latest: null,
    dominant_stage_key_earliest: null,
    dominant_gap_label_earliest: null,
    by_stage: DECISION_GAP_STAGE_ORDER.map((stage) => ({
      stage_key: stage.stage_key,
      label: stage.label,
      gap_label: stage.gap_label,
      blocked_decision_total: emptyMetricSummary(),
      share_pct: emptyMetricSummary(),
      earliest_blocked_decision_total: 0,
      latest_blocked_decision_total: 0,
      blocked_decision_growth: 0,
      dominance_count: 0,
      exemplar_decisions: [],
    })),
  };
}

function normalizeDecisionGapResolutionSample(raw: unknown): LiveOpsDiagnosticsDecisionGapResolutionSample {
  const payload = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Partial<LiveOpsDiagnosticsDecisionGapResolutionSample>
    : {};
  const backlogPayload = Array.isArray(payload.backlog_age_buckets) ? payload.backlog_age_buckets : [];
  const oldestPayload = payload.oldest_open_gap && typeof payload.oldest_open_gap === "object" && !Array.isArray(payload.oldest_open_gap)
    ? payload.oldest_open_gap as Partial<LiveOpsDiagnosticsDecisionGapOldestOpenSample>
    : null;
  const cardinalityPayload = payload.dominant_gap_cardinality && typeof payload.dominant_gap_cardinality === "object" && !Array.isArray(payload.dominant_gap_cardinality)
    ? payload.dominant_gap_cardinality as Partial<LiveOpsDiagnosticsDecisionGapCardinalitySample>
    : {};
  const rootCausePayload = Array.isArray(cardinalityPayload.by_root_cause) ? cardinalityPayload.by_root_cause : [];

  return {
    open_gap_total: Math.max(0, Math.round(toNumber(payload.open_gap_total, 0))),
    resolved_gap_total: Math.max(0, Math.round(toNumber(payload.resolved_gap_total, 0))),
    gap_resolution_rate_pct: Math.max(0, toNumber(payload.gap_resolution_rate_pct, 0)),
    mean_time_to_continuity_hours: Number.isFinite(Number(payload.mean_time_to_continuity_hours))
      ? Math.max(0, toNumber(payload.mean_time_to_continuity_hours, 0))
      : null,
    dominant_open_gap_stage_key: String(payload.dominant_open_gap_stage_key || "").trim() || null,
    dominant_open_gap_label: String(payload.dominant_open_gap_label || "").trim() || null,
    dominant_open_gap_total: Math.max(0, Math.round(toNumber(payload.dominant_open_gap_total, 0))),
    dominant_open_gap_share_pct: Math.max(0, toNumber(payload.dominant_open_gap_share_pct, 0)),
    backlog_age_buckets: DECISION_GAP_BACKLOG_BUCKET_ORDER.map((bucket) => {
      const rawBucket = backlogPayload.find((entry) => String((entry as Record<string, unknown>)?.bucket_key || "").trim() === bucket.bucket_key);
      const bucketPayload = rawBucket && typeof rawBucket === "object" && !Array.isArray(rawBucket)
        ? rawBucket as Partial<LiveOpsDiagnosticsDecisionGapBacklogBucketSample>
        : {};
      return {
        bucket_key: bucket.bucket_key,
        label: String(bucketPayload.label || bucket.label),
        open_gap_total: Math.max(0, Math.round(toNumber(bucketPayload.open_gap_total, 0))),
        share_pct: Math.max(0, toNumber(bucketPayload.share_pct, 0)),
      };
    }),
    oldest_open_gap: oldestPayload && (String(oldestPayload.decision_id || "").trim() || Number.isFinite(Number(oldestPayload.open_age_hours)))
      ? {
          decision_id: String(oldestPayload.decision_id || "").trim() || null,
          gap_label: String(oldestPayload.gap_label || "").trim() || null,
          open_age_hours: Math.max(0, toNumber(oldestPayload.open_age_hours, 0)),
          root_cause_code: String(oldestPayload.root_cause_code || "").trim() || null,
        }
      : null,
    dominant_gap_cardinality: {
      gap_occurrence_total: Math.max(0, Math.round(toNumber(cardinalityPayload.gap_occurrence_total, 0))),
      unique_decision_total: Math.max(0, Math.round(toNumber(cardinalityPayload.unique_decision_total, 0))),
      unique_trade_lifecycle_total: Math.max(0, Math.round(toNumber(cardinalityPayload.unique_trade_lifecycle_total, 0))),
      unique_root_cause_total: Math.max(0, Math.round(toNumber(cardinalityPayload.unique_root_cause_total, 0))),
      by_root_cause: rootCausePayload
        .map((entry) => {
          const row = entry && typeof entry === "object" && !Array.isArray(entry)
            ? entry as Partial<LiveOpsDiagnosticsDecisionGapRootCauseSample>
            : {};
          const rootCauseCode = String(row.root_cause_code || "").trim();
          if (!rootCauseCode) {
            return null;
          }
          return {
            root_cause_code: rootCauseCode,
            label: String(row.label || rootCauseCode).trim() || rootCauseCode,
            open_gap_total: Math.max(0, Math.round(toNumber(row.open_gap_total, 0))),
            share_pct: Math.max(0, toNumber(row.share_pct, 0)),
          };
        })
        .filter((entry): entry is LiveOpsDiagnosticsDecisionGapRootCauseSample => entry !== null)
        .slice(0, 16),
    },
  };
}

function emptyDecisionGapResolutionWindowSummary(): LiveOpsDiagnosticsDecisionGapResolutionWindowSummary {
  return {
    open_gap_total: emptyMetricSummary(),
    resolved_gap_total: emptyMetricSummary(),
    gap_resolution_rate_pct: emptyMetricSummary(),
    mean_time_to_continuity_hours: emptyMetricSummary(),
    dominant_open_gap_stage_key_latest: null,
    dominant_open_gap_label_latest: null,
    dominant_open_gap_stage_key_earliest: null,
    dominant_open_gap_label_earliest: null,
    dominant_open_gap_total_latest: 0,
    dominant_open_gap_total_earliest: 0,
    dominant_open_gap_total_growth: 0,
    dominant_open_gap_share_pct_latest: 0,
    dominant_open_gap_share_pct_earliest: 0,
    oldest_open_gap: {
      open_age_hours: emptyMetricSummary(),
      latest_decision_id: null,
      latest_gap_label: null,
      latest_root_cause_code: null,
      latest_open_age_hours: 0,
      earliest_decision_id: null,
      earliest_gap_label: null,
      earliest_root_cause_code: null,
      earliest_open_age_hours: 0,
    },
    backlog_age_buckets: DECISION_GAP_BACKLOG_BUCKET_ORDER.map((bucket) => ({
      bucket_key: bucket.bucket_key,
      label: bucket.label,
      open_gap_total: emptyMetricSummary(),
      share_pct: emptyMetricSummary(),
      earliest_open_gap_total: 0,
      latest_open_gap_total: 0,
      open_gap_growth: 0,
    })),
    dominant_gap_cardinality: {
      gap_occurrence_total: emptyMetricSummary(),
      unique_decision_total: emptyMetricSummary(),
      unique_trade_lifecycle_total: emptyMetricSummary(),
      unique_root_cause_total: emptyMetricSummary(),
      dominant_root_cause_code_latest: null,
      dominant_root_cause_label_latest: null,
      dominant_root_cause_code_earliest: null,
      dominant_root_cause_label_earliest: null,
      by_root_cause: [],
    },
  };
}

function resolveDominantDecisionGapStage(stages: LiveOpsDiagnosticsDecisionGapStageSample[]): LiveOpsDiagnosticsDecisionGapStageSample | null {
  let best: LiveOpsDiagnosticsDecisionGapStageSample | null = null;
  for (const stage of stages) {
    if (!best || stage.blocked_decision_total > best.blocked_decision_total) {
      best = stage;
    }
  }
  return best && best.blocked_decision_total > 0 ? best : null;
}

function resolveDominantDecisionGapRootCause(stages: LiveOpsDiagnosticsDecisionGapRootCauseSample[]): LiveOpsDiagnosticsDecisionGapRootCauseSample | null {
  let best: LiveOpsDiagnosticsDecisionGapRootCauseSample | null = null;
  for (const stage of stages) {
    if (!best || stage.open_gap_total > best.open_gap_total) {
      best = stage;
    }
  }
  return best && best.open_gap_total > 0 ? best : null;
}

function normalizeProjectionSourceAudit(raw: unknown): LiveOpsProjectionSourceAudit {
  const payload = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Partial<LiveOpsProjectionSourceAudit>
    : {};
  return {
    rows_scanned: Math.max(0, Math.round(toNumber(payload.rows_scanned, 0))),
    rows_returned: Math.max(0, Math.round(toNumber(payload.rows_returned, 0))),
    cache_hit: Math.max(0, Math.round(toNumber(payload.cache_hit, 0))),
    cache_miss: Math.max(0, Math.round(toNumber(payload.cache_miss, 0))),
    cache_age_ms: Number.isFinite(Number(payload.cache_age_ms)) ? Math.max(0, Math.round(toNumber(payload.cache_age_ms, 0))) : null,
  };
}

function normalizeSample(raw: unknown): LiveOpsDiagnosticsSample | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const payload = raw as Partial<LiveOpsDiagnosticsSample> & {
    projection_durations_ms?: Partial<Record<LiveOpsProjectionKey, unknown>>;
    projection_source_audits?: Partial<Record<LiveOpsProjectionKey, unknown>>;
    payload_bytes?: unknown;
  };
  const timestampIso = String(payload.timestamp_iso || "").trim();
  if (!timestampIso) {
    return null;
  }
  const projectionDurations: Partial<Record<LiveOpsProjectionKey, unknown>> = payload.projection_durations_ms || {};
  const projectionSourceAudits: Partial<Record<LiveOpsProjectionKey, unknown>> = payload.projection_source_audits || {};
  const runtimeTruthMs = toNumber(payload.runtime_truth_ms, toNumber(projectionDurations.runtime_truth, 0));
  const canonicalSpineMs = toNumber(payload.canonical_spine_ms, toNumber(projectionDurations.canonical_spine, 0));
  const tradeLifecycleMs = toNumber(payload.trade_lifecycle_ms, toNumber(projectionDurations.trade_lifecycle_health, 0));
  const hardeningAnalyticsMs = toNumber(payload.hardening_analytics_ms, toNumber(projectionDurations.hardening_analytics_30d, 0));
  const payloadSizeBytes = Math.max(0, Math.round(toNumber(payload.payload_size_bytes, toNumber(payload.payload_bytes, 0))));

  return {
    timestamp_iso: timestampIso,
    aggregate_window_days: Math.max(1, Math.round(toNumber(payload.aggregate_window_days, 30))),
    runtime_truth_ms: runtimeTruthMs,
    canonical_spine_ms: canonicalSpineMs,
    trade_lifecycle_ms: tradeLifecycleMs,
    hardening_analytics_ms: hardeningAnalyticsMs,
    payload_size_bytes: payloadSizeBytes,
    tri_score: toNumber(payload.tri_score, 0),
    tri_status: String(payload.tri_status || "unusable").trim() || "unusable",
    tri_cap: Number.isFinite(Number(payload.tri_cap)) ? toNumber(payload.tri_cap, 0) : null,
    tri_continuity: toNumber(payload.tri_continuity, 0),
    tri_evidence: toNumber(payload.tri_evidence, 0),
    tri_spine_match: toNumber(payload.tri_spine_match, 0),
    tri_freshness: toNumber(payload.tri_freshness, 0),
    source_tree_provenance: normalizeSourceTreeProvenanceSample(payload.source_tree_provenance),
    decision_gap_reduction: normalizeDecisionGapReductionSample(payload.decision_gap_reduction),
    decision_gap_resolution: normalizeDecisionGapResolutionSample(payload.decision_gap_resolution),
    control_plane_timeout_paths: toStringArray(payload.control_plane_timeout_paths),
    local_projection_timeout_paths: toStringArray(payload.local_projection_timeout_paths),
    local_projection_failed_paths: toStringArray(payload.local_projection_failed_paths),
    timeout_projections: toStringArray(payload.timeout_projections),
    degraded_projections: toStringArray(payload.degraded_projections),
    projection_durations_ms: {
      runtime_truth: runtimeTruthMs,
      canonical_spine: canonicalSpineMs,
      trade_lifecycle_health: tradeLifecycleMs,
      hardening_analytics_30d: hardeningAnalyticsMs,
    },
    projection_source_audits: {
      runtime_truth: normalizeProjectionSourceAudit(projectionSourceAudits.runtime_truth),
      canonical_spine: normalizeProjectionSourceAudit(projectionSourceAudits.canonical_spine),
      trade_lifecycle_health: normalizeProjectionSourceAudit(projectionSourceAudits.trade_lifecycle_health),
      hardening_analytics_30d: normalizeProjectionSourceAudit(projectionSourceAudits.hardening_analytics_30d),
    },
  };
}

async function loadAllSamples(): Promise<LiveOpsDiagnosticsSample[]> {
  const target = filePath();
  try {
    const metadata = await stat(target);
    if (
      diagnosticsCache
      && diagnosticsCache.filePath === target
      && diagnosticsCache.mtimeMs === metadata.mtimeMs
      && diagnosticsCache.size === metadata.size
    ) {
      return diagnosticsCache.rows;
    }
    const content = await readFile(target, "utf-8");
    const rows = content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return normalizeSample(JSON.parse(line) as unknown);
        } catch {
          return null;
        }
      })
      .filter((row): row is LiveOpsDiagnosticsSample => row !== null);
    diagnosticsCache = {
      filePath: target,
      mtimeMs: metadata.mtimeMs,
      size: metadata.size,
      rows,
    };
    return rows;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      diagnosticsCache = null;
      return [];
    }
    throw error;
  }
}

function summarizeMetric(values: number[]): LiveOpsDiagnosticsMetricSummary {
  const filtered = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (filtered.length === 0) {
    return emptyMetricSummary();
  }
  const average = filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
  const percentileIndex = Math.min(filtered.length - 1, Math.max(0, Math.ceil(filtered.length * 0.95) - 1));
  return {
    avg: Number(average.toFixed(1)),
    p95: Number(filtered[percentileIndex].toFixed(1)),
    max: Number(filtered[filtered.length - 1].toFixed(1)),
  };
}

export async function appendLiveOpsDiagnosticsSample(sample: LiveOpsDiagnosticsSample): Promise<void> {
  const normalized = normalizeSample(sample);
  if (!normalized) {
    return;
  }
  const target = filePath();
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(normalized)}\n`, "utf-8");
  diagnosticsCache = null;
}

export async function readLiveOpsDiagnosticsWindowSummary(options?: {
  sinceDays?: number;
  limit?: number;
}): Promise<LiveOpsDiagnosticsWindowSummary> {
  const sinceDays = Math.max(1, Math.min(30, Math.round(toNumber(options?.sinceDays, 7))));
  const limit = Math.max(1, Math.min(10_000, Math.round(toNumber(options?.limit, 5_000))));
  const cutoffMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const rows = await loadAllSamples();
  const filtered: LiveOpsDiagnosticsSample[] = [];
  for (let index = rows.length - 1; index >= 0 && filtered.length < limit; index -= 1) {
    const row = rows[index];
    const createdAtMs = Date.parse(row.timestamp_iso);
    if (Number.isFinite(createdAtMs) && createdAtMs < cutoffMs) {
      break;
    }
    filtered.push(row);
  }
  filtered.reverse();

  const projectionDurationSummary = createProjectionRecord<LiveOpsDiagnosticsMetricSummary>(() => emptyMetricSummary());
  const projectionSourceAuditSummary = createProjectionRecord<LiveOpsDiagnosticsSourceAuditSummary>(() => emptySourceAuditSummary());
  const timeoutProjections = createProjectionRecord<number>(() => 0);
  const degradedProjections = createProjectionRecord<number>(() => 0);
  const controlPlaneTimeoutCounts: Record<string, number> = {};

  if (filtered.length === 0) {
    return {
      window_days: sinceDays,
      sample_count: 0,
      first_sample_at_iso: null,
      last_sample_at_iso: null,
      payload_size_bytes: emptyMetricSummary(),
      projection_durations_ms: projectionDurationSummary,
      projection_source_audits: projectionSourceAuditSummary,
      timeout_projections: timeoutProjections,
      degraded_projections: degradedProjections,
      control_plane_timeout_counts: controlPlaneTimeoutCounts,
      source_tree_provenance: emptySourceTreeProvenanceWindowSummary(),
      decision_gap_reduction: emptyDecisionGapReductionWindowSummary(),
      decision_gap_resolution: emptyDecisionGapResolutionWindowSummary(),
      truth_reliability: {
        score_pct: emptyMetricSummary(),
        cap_pct: emptyMetricSummary(),
        continuity_pct: emptyMetricSummary(),
        evidence_pct: emptyMetricSummary(),
        spine_match_pct: emptyMetricSummary(),
        freshness_pct: emptyMetricSummary(),
        latest_score_pct: 0,
        earliest_score_pct: 0,
        reliability_growth_pct: 0,
        status_counts: {},
      },
    };
  }

  for (const projectionKey of LIVE_OPS_PROJECTION_KEYS) {
    projectionDurationSummary[projectionKey] = summarizeMetric(filtered.map((row) => row.projection_durations_ms[projectionKey] || 0));
    const sourceAudits = filtered.map((row) => row.projection_source_audits[projectionKey]);
    const cacheAgeSamples = sourceAudits
      .map((audit) => audit.cache_age_ms)
      .filter((value): value is number => Number.isFinite(value));
    const cacheHitTotal = sourceAudits.reduce((sum, audit) => sum + audit.cache_hit, 0);
    const cacheMissTotal = sourceAudits.reduce((sum, audit) => sum + audit.cache_miss, 0);
    const cacheEvents = cacheHitTotal + cacheMissTotal;
    projectionSourceAuditSummary[projectionKey] = {
      rows_scanned_avg: Number((sourceAudits.reduce((sum, audit) => sum + audit.rows_scanned, 0) / sourceAudits.length).toFixed(1)),
      rows_scanned_max: Math.max(...sourceAudits.map((audit) => audit.rows_scanned), 0),
      rows_returned_avg: Number((sourceAudits.reduce((sum, audit) => sum + audit.rows_returned, 0) / sourceAudits.length).toFixed(1)),
      rows_returned_max: Math.max(...sourceAudits.map((audit) => audit.rows_returned), 0),
      cache_hit_total: cacheHitTotal,
      cache_miss_total: cacheMissTotal,
      cache_hit_rate_pct: cacheEvents > 0 ? Number(((cacheHitTotal / cacheEvents) * 100).toFixed(1)) : 0,
      rebuild_count: cacheMissTotal,
      cache_age_ms_avg: cacheAgeSamples.length > 0 ? Number((cacheAgeSamples.reduce((sum, value) => sum + value, 0) / cacheAgeSamples.length).toFixed(1)) : 0,
      cache_age_ms_max: cacheAgeSamples.length > 0 ? Math.max(...cacheAgeSamples) : 0,
    };
    timeoutProjections[projectionKey] = filtered.filter((row) => row.timeout_projections.includes(projectionKey)).length;
    degradedProjections[projectionKey] = filtered.filter((row) => row.degraded_projections.includes(projectionKey)).length;
  }

  for (const row of filtered) {
    for (const timeoutPath of row.control_plane_timeout_paths) {
      controlPlaneTimeoutCounts[timeoutPath] = (controlPlaneTimeoutCounts[timeoutPath] || 0) + 1;
    }
  }

  const truthReliabilityStatusCounts: Record<string, number> = {};
  for (const row of filtered) {
    truthReliabilityStatusCounts[row.tri_status] = (truthReliabilityStatusCounts[row.tri_status] || 0) + 1;
  }
  const earliestTriScore = filtered[0]?.tri_score || 0;
  const latestTriScore = filtered[filtered.length - 1]?.tri_score || 0;
  const earliestGapDominant = resolveDominantDecisionGapStage(filtered[0]?.decision_gap_reduction.by_stage || []);
  const latestGapDominant = resolveDominantDecisionGapStage(filtered[filtered.length - 1]?.decision_gap_reduction.by_stage || []);
  const earliestGapResolution = filtered[0]?.decision_gap_resolution || normalizeDecisionGapResolutionSample(null);
  const latestGapResolution = filtered[filtered.length - 1]?.decision_gap_resolution || normalizeDecisionGapResolutionSample(null);
  const earliestDominantRootCause = resolveDominantDecisionGapRootCause(earliestGapResolution.dominant_gap_cardinality?.by_root_cause || []);
  const latestDominantRootCause = resolveDominantDecisionGapRootCause(latestGapResolution.dominant_gap_cardinality?.by_root_cause || []);

  const decisionGapReductionSummary: LiveOpsDiagnosticsDecisionGapReductionWindowSummary = {
    incomplete_decision_total: summarizeMetric(filtered.map((row) => row.decision_gap_reduction.incomplete_decision_total)),
    dominant_stage_key_latest: latestGapDominant?.stage_key || null,
    dominant_gap_label_latest: latestGapDominant?.gap_label || null,
    dominant_stage_key_earliest: earliestGapDominant?.stage_key || null,
    dominant_gap_label_earliest: earliestGapDominant?.gap_label || null,
    by_stage: DECISION_GAP_STAGE_ORDER.map((stage) => {
      const stageRows = filtered.map((row) => row.decision_gap_reduction.by_stage.find((entry) => entry.stage_key === stage.stage_key) || {
        stage_key: stage.stage_key,
        label: stage.label,
        gap_label: stage.gap_label,
        blocked_decision_total: 0,
        share_pct: 0,
        exemplar_decision_ids: [],
      });
      const exemplarCounts = new Map<string, number>();
      for (const row of stageRows) {
        for (const decisionId of row.exemplar_decision_ids) {
          exemplarCounts.set(decisionId, (exemplarCounts.get(decisionId) || 0) + 1);
        }
      }
      return {
        stage_key: stage.stage_key,
        label: stage.label,
        gap_label: stage.gap_label,
        blocked_decision_total: summarizeMetric(stageRows.map((row) => row.blocked_decision_total)),
        share_pct: summarizeMetric(stageRows.map((row) => row.share_pct)),
        earliest_blocked_decision_total: toNumber(stageRows[0]?.blocked_decision_total, 0),
        latest_blocked_decision_total: toNumber(stageRows[stageRows.length - 1]?.blocked_decision_total, 0),
        blocked_decision_growth: Number((toNumber(stageRows[stageRows.length - 1]?.blocked_decision_total, 0) - toNumber(stageRows[0]?.blocked_decision_total, 0)).toFixed(1)),
        dominance_count: filtered.filter((row) => resolveDominantDecisionGapStage(row.decision_gap_reduction.by_stage || [])?.stage_key === stage.stage_key).length,
        exemplar_decisions: [...exemplarCounts.entries()]
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .slice(0, 5)
          .map(([decision_id, occurrence_count]) => ({ decision_id, occurrence_count })),
      };
    }),
  };

  const decisionGapResolutionSummary: LiveOpsDiagnosticsDecisionGapResolutionWindowSummary = {
    open_gap_total: summarizeMetric(filtered.map((row) => row.decision_gap_resolution.open_gap_total)),
    resolved_gap_total: summarizeMetric(filtered.map((row) => row.decision_gap_resolution.resolved_gap_total)),
    gap_resolution_rate_pct: summarizeMetric(filtered.map((row) => row.decision_gap_resolution.gap_resolution_rate_pct)),
    mean_time_to_continuity_hours: summarizeMetric(filtered.map((row) => row.decision_gap_resolution.mean_time_to_continuity_hours ?? Number.NaN)),
    dominant_open_gap_stage_key_latest: latestGapResolution.dominant_open_gap_stage_key,
    dominant_open_gap_label_latest: latestGapResolution.dominant_open_gap_label,
    dominant_open_gap_stage_key_earliest: earliestGapResolution.dominant_open_gap_stage_key,
    dominant_open_gap_label_earliest: earliestGapResolution.dominant_open_gap_label,
    dominant_open_gap_total_latest: latestGapResolution.dominant_open_gap_total,
    dominant_open_gap_total_earliest: earliestGapResolution.dominant_open_gap_total,
    dominant_open_gap_total_growth: Number((latestGapResolution.dominant_open_gap_total - earliestGapResolution.dominant_open_gap_total).toFixed(1)),
    dominant_open_gap_share_pct_latest: latestGapResolution.dominant_open_gap_share_pct,
    dominant_open_gap_share_pct_earliest: earliestGapResolution.dominant_open_gap_share_pct,
    oldest_open_gap: {
      open_age_hours: summarizeMetric(filtered.map((row) => row.decision_gap_resolution.oldest_open_gap?.open_age_hours ?? Number.NaN)),
      latest_decision_id: latestGapResolution.oldest_open_gap?.decision_id || null,
      latest_gap_label: latestGapResolution.oldest_open_gap?.gap_label || null,
      latest_root_cause_code: latestGapResolution.oldest_open_gap?.root_cause_code || null,
      latest_open_age_hours: latestGapResolution.oldest_open_gap?.open_age_hours || 0,
      earliest_decision_id: earliestGapResolution.oldest_open_gap?.decision_id || null,
      earliest_gap_label: earliestGapResolution.oldest_open_gap?.gap_label || null,
      earliest_root_cause_code: earliestGapResolution.oldest_open_gap?.root_cause_code || null,
      earliest_open_age_hours: earliestGapResolution.oldest_open_gap?.open_age_hours || 0,
    },
    backlog_age_buckets: DECISION_GAP_BACKLOG_BUCKET_ORDER.map((bucket) => {
      const bucketRows = filtered.map((row) => row.decision_gap_resolution.backlog_age_buckets.find((entry) => entry.bucket_key === bucket.bucket_key) || {
        bucket_key: bucket.bucket_key,
        label: bucket.label,
        open_gap_total: 0,
        share_pct: 0,
      });
      return {
        bucket_key: bucket.bucket_key,
        label: bucket.label,
        open_gap_total: summarizeMetric(bucketRows.map((row) => row.open_gap_total)),
        share_pct: summarizeMetric(bucketRows.map((row) => row.share_pct)),
        earliest_open_gap_total: toNumber(bucketRows[0]?.open_gap_total, 0),
        latest_open_gap_total: toNumber(bucketRows[bucketRows.length - 1]?.open_gap_total, 0),
        open_gap_growth: Number((toNumber(bucketRows[bucketRows.length - 1]?.open_gap_total, 0) - toNumber(bucketRows[0]?.open_gap_total, 0)).toFixed(1)),
      };
    }),
    dominant_gap_cardinality: {
      gap_occurrence_total: summarizeMetric(filtered.map((row) => row.decision_gap_resolution.dominant_gap_cardinality?.gap_occurrence_total ?? 0)),
      unique_decision_total: summarizeMetric(filtered.map((row) => row.decision_gap_resolution.dominant_gap_cardinality?.unique_decision_total ?? 0)),
      unique_trade_lifecycle_total: summarizeMetric(filtered.map((row) => row.decision_gap_resolution.dominant_gap_cardinality?.unique_trade_lifecycle_total ?? 0)),
      unique_root_cause_total: summarizeMetric(filtered.map((row) => row.decision_gap_resolution.dominant_gap_cardinality?.unique_root_cause_total ?? 0)),
      dominant_root_cause_code_latest: latestDominantRootCause?.root_cause_code || null,
      dominant_root_cause_label_latest: latestDominantRootCause?.label || null,
      dominant_root_cause_code_earliest: earliestDominantRootCause?.root_cause_code || null,
      dominant_root_cause_label_earliest: earliestDominantRootCause?.label || null,
      by_root_cause: (() => {
        const rootCauseCodes = new Map<string, string>();
        for (const row of filtered) {
          for (const rootCause of row.decision_gap_resolution.dominant_gap_cardinality?.by_root_cause || []) {
            rootCauseCodes.set(rootCause.root_cause_code, rootCause.label);
          }
        }
        return [...rootCauseCodes.entries()].map(([rootCauseCode, label]) => {
          const rootCauseRows = filtered.map((row) => row.decision_gap_resolution.dominant_gap_cardinality?.by_root_cause.find((entry) => entry.root_cause_code === rootCauseCode) || {
            root_cause_code: rootCauseCode,
            label,
            open_gap_total: 0,
            share_pct: 0,
          });
          return {
            root_cause_code: rootCauseCode,
            label,
            open_gap_total: summarizeMetric(rootCauseRows.map((row) => row.open_gap_total)),
            share_pct: summarizeMetric(rootCauseRows.map((row) => row.share_pct)),
            earliest_open_gap_total: toNumber(rootCauseRows[0]?.open_gap_total, 0),
            latest_open_gap_total: toNumber(rootCauseRows[rootCauseRows.length - 1]?.open_gap_total, 0),
            open_gap_growth: Number((toNumber(rootCauseRows[rootCauseRows.length - 1]?.open_gap_total, 0) - toNumber(rootCauseRows[0]?.open_gap_total, 0)).toFixed(1)),
            dominance_count: filtered.filter((row) => resolveDominantDecisionGapRootCause(row.decision_gap_resolution.dominant_gap_cardinality?.by_root_cause || [])?.root_cause_code === rootCauseCode).length,
          };
        })
          .sort((left, right) => right.latest_open_gap_total - left.latest_open_gap_total || left.root_cause_code.localeCompare(right.root_cause_code))
          .slice(0, 8);
      })(),
    },
  };

  return {
    window_days: sinceDays,
    sample_count: filtered.length,
    first_sample_at_iso: filtered[0]?.timestamp_iso || null,
    last_sample_at_iso: filtered[filtered.length - 1]?.timestamp_iso || null,
    payload_size_bytes: summarizeMetric(filtered.map((row) => row.payload_size_bytes)),
    projection_durations_ms: projectionDurationSummary,
    projection_source_audits: projectionSourceAuditSummary,
    timeout_projections: timeoutProjections,
    degraded_projections: degradedProjections,
    control_plane_timeout_counts: controlPlaneTimeoutCounts,
    source_tree_provenance: summarizeSourceTreeProvenanceWindow(filtered),
    decision_gap_reduction: decisionGapReductionSummary,
    decision_gap_resolution: decisionGapResolutionSummary,
    truth_reliability: {
      score_pct: summarizeMetric(filtered.map((row) => row.tri_score)),
      cap_pct: summarizeMetric(filtered.map((row) => row.tri_cap ?? 0)),
      continuity_pct: summarizeMetric(filtered.map((row) => row.tri_continuity)),
      evidence_pct: summarizeMetric(filtered.map((row) => row.tri_evidence)),
      spine_match_pct: summarizeMetric(filtered.map((row) => row.tri_spine_match)),
      freshness_pct: summarizeMetric(filtered.map((row) => row.tri_freshness)),
      latest_score_pct: Number(latestTriScore.toFixed(1)),
      earliest_score_pct: Number(earliestTriScore.toFixed(1)),
      reliability_growth_pct: Number((latestTriScore - earliestTriScore).toFixed(1)),
      status_counts: truthReliabilityStatusCounts,
    },
  };
}