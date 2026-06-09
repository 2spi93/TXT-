export type SourceTreeProvenanceStatus = "ALIGNED" | "PARTIALLY_ALIGNED" | "DIVERGENT" | "UNKNOWN";

export type SourceTreeProvenanceSnapshot = {
  workspace_commit: string | null;
  runtime_commit: string | null;
  build_commit: string | null;
  active_slot_commit: string | null;
  commit_alignment_rate: number;
  status: SourceTreeProvenanceStatus;
  observable_commit_count: number;
  aligned_commit_count: number;
  publish_blocked: boolean;
};

export type SourceTreePromotionBlockSummary = {
  blocked: boolean;
  reason: string;
  details: string[];
};

export const EMPTY_SOURCE_TREE_PROVENANCE: SourceTreeProvenanceSnapshot = {
  workspace_commit: null,
  runtime_commit: null,
  build_commit: null,
  active_slot_commit: null,
  commit_alignment_rate: 0,
  status: "UNKNOWN",
  observable_commit_count: 0,
  aligned_commit_count: 0,
  publish_blocked: true,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeCommit(value: unknown): string | null {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{7,64}$/.test(normalized) ? normalized : null;
}

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeStatus(value: unknown): SourceTreeProvenanceStatus {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "ALIGNED" || normalized === "PARTIALLY_ALIGNED" || normalized === "DIVERGENT" || normalized === "UNKNOWN") {
    return normalized;
  }
  return "UNKNOWN";
}

export function normalizeSourceTreeProvenance(value: unknown): SourceTreeProvenanceSnapshot {
  const payload = asRecord(value);
  return {
    workspace_commit: normalizeCommit(payload.workspace_commit),
    runtime_commit: normalizeCommit(payload.runtime_commit),
    build_commit: normalizeCommit(payload.build_commit),
    active_slot_commit: normalizeCommit(payload.active_slot_commit),
    commit_alignment_rate: Math.max(0, Math.min(100, toNumber(payload.commit_alignment_rate, 0))),
    status: normalizeStatus(payload.status),
    observable_commit_count: Math.max(0, Math.round(toNumber(payload.observable_commit_count, 0))),
    aligned_commit_count: Math.max(0, Math.round(toNumber(payload.aligned_commit_count, 0))),
    publish_blocked: Boolean(payload.publish_blocked),
  };
}

export function formatSourceTreeProvenanceStatus(status: SourceTreeProvenanceStatus): string {
  switch (status) {
    case "ALIGNED":
      return "ALIGNE";
    case "PARTIALLY_ALIGNED":
      return "PARTIELLEMENT ALIGNE";
    case "DIVERGENT":
      return "DIVERGENT";
    default:
      return "UNKNOWN";
  }
}

export function formatSourceTreeCommitHash(commit: string | null): string {
  return commit ? commit.slice(0, 12) : "absent";
}

export function getSourceTreeCommitDeltaLines(audit: SourceTreeProvenanceSnapshot): string[] {
  const entries = [
    { label: "workspace", commit: audit.workspace_commit },
    { label: "build", commit: audit.build_commit },
    { label: "runtime", commit: audit.runtime_commit },
    { label: "slot_actif", commit: audit.active_slot_commit },
  ];
  const observable = entries.filter((entry) => Boolean(entry.commit));
  const uniqueCommitCount = new Set(observable.map((entry) => entry.commit)).size;
  const hasMissingCommit = observable.length < entries.length;
  if (!hasMissingCommit && uniqueCommitCount <= 1) {
    return [];
  }
  return entries.map((entry) => `${entry.label}: ${formatSourceTreeCommitHash(entry.commit)}`);
}

export function describeSourceTreePromotionBlock(audit: SourceTreeProvenanceSnapshot): SourceTreePromotionBlockSummary {
  if (audit.observable_commit_count < 4) {
    return {
      blocked: true,
      reason: "Publication bloquee: chaine provenance incomplete entre workspace, build, runtime et slot actif.",
      details: getSourceTreeCommitDeltaLines(audit),
    };
  }
  if (audit.commit_alignment_rate < 100) {
    return {
      blocked: true,
      reason: "Publication bloquee: delta de commit detecte entre workspace, build, runtime et slot actif.",
      details: getSourceTreeCommitDeltaLines(audit),
    };
  }
  return {
    blocked: false,
    reason: "Chaine provenance alignee.",
    details: [],
  };
}