import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SourceTreeProvenanceStatus = "ALIGNED" | "PARTIALLY_ALIGNED" | "DIVERGENT" | "UNKNOWN";

export type SourceTreeProvenanceAudit = {
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

const DEFAULT_WORKSPACE_SOURCE_ROOT = "/opt/txt/ui/mission-control";
const DEFAULT_RUNTIME_SOURCE_ROOT = "/workspace/ui/mission-control";
const DEFAULT_SLOT_FILE_PATH = "/workspace/data/mission-control/ui-active-slot.conf";

function normalizeCommit(value: unknown): string | null {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{7,64}$/.test(normalized) ? normalized : null;
}

function asPercent(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return (value / total) * 100;
}

function resolveSourceTreeProvenanceStatus(alignmentRate: number, observableCommitCount: number): SourceTreeProvenanceStatus {
  if (observableCommitCount <= 0) {
    return "UNKNOWN";
  }
  if (alignmentRate >= 100) {
    return "ALIGNED";
  }
  if (alignmentRate >= 75) {
    return "PARTIALLY_ALIGNED";
  }
  return "DIVERGENT";
}

export function isSourceTreePromotionBlocked(audit: Pick<SourceTreeProvenanceAudit, "commit_alignment_rate" | "observable_commit_count">): boolean {
  return audit.observable_commit_count < 4 || audit.commit_alignment_rate < 100;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readGitCommit(rootPath: string | null): Promise<string | null> {
  if (!rootPath || !(await pathExists(rootPath))) {
    return null;
  }
  try {
    const result = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: rootPath });
    return normalizeCommit(result.stdout);
  } catch {
    return null;
  }
}

async function resolveWorkspaceRoot(): Promise<string | null> {
  const configuredRoot = String(process.env.MISSION_CONTROL_WORKSPACE_ROOT || "").trim();
  if (configuredRoot) {
    return (await pathExists(configuredRoot)) ? configuredRoot : null;
  }
  return (await pathExists(DEFAULT_WORKSPACE_SOURCE_ROOT)) ? DEFAULT_WORKSPACE_SOURCE_ROOT : null;
}

async function resolveRuntimeRoot(): Promise<string | null> {
  const configuredRoot = String(process.env.MISSION_CONTROL_RUNTIME_ROOT || "").trim();
  if (configuredRoot) {
    return (await pathExists(configuredRoot)) ? configuredRoot : null;
  }
  return (await pathExists(DEFAULT_RUNTIME_SOURCE_ROOT)) ? DEFAULT_RUNTIME_SOURCE_ROOT : null;
}

function currentDistDir(): string {
  const raw = String(process.env.NEXT_DIST_DIR || ".next").trim();
  return raw || ".next";
}

function activeSlotDistDir(slot: "blue" | "green"): string {
  return slot === "blue" ? ".next-runtime-blue" : ".next-runtime-green";
}

async function readBuildCommitFile(rootPath: string | null, distDir: string | null): Promise<string | null> {
  if (!rootPath || !distDir) {
    return null;
  }
  const raw = await readTextFile(path.join(rootPath, distDir, "BUILD_COMMIT"));
  return normalizeCommit(raw);
}

async function readActiveSlot(): Promise<"blue" | "green" | null> {
  const configuredSlotFile = String(process.env.MISSION_CONTROL_ACTIVE_SLOT_FILE || DEFAULT_SLOT_FILE_PATH).trim() || DEFAULT_SLOT_FILE_PATH;
  const raw = await readTextFile(configuredSlotFile);
  if (!raw) {
    return null;
  }
  if (raw.includes("mission-control-ui-green:3002")) {
    return "green";
  }
  if (raw.includes("mission-control-ui-blue:3001")) {
    return "blue";
  }
  return null;
}

export async function readSourceTreeProvenanceAudit(): Promise<SourceTreeProvenanceAudit> {
  const [workspaceRoot, runtimeRoot, activeSlot] = await Promise.all([
    resolveWorkspaceRoot(),
    resolveRuntimeRoot(),
    readActiveSlot(),
  ]);
  const [workspaceCommit, runtimeCommit, buildCommit, activeSlotCommit] = await Promise.all([
    readGitCommit(workspaceRoot),
    readGitCommit(runtimeRoot),
    readBuildCommitFile(runtimeRoot, currentDistDir()),
    readBuildCommitFile(runtimeRoot, activeSlot ? activeSlotDistDir(activeSlot) : null),
  ]);
  const commits = [workspaceCommit, runtimeCommit, buildCommit, activeSlotCommit].map(normalizeCommit);
  const counts = commits.reduce((acc, commit) => {
    if (!commit) {
      return acc;
    }
    acc.set(commit, (acc.get(commit) || 0) + 1);
    return acc;
  }, new Map<string, number>());
  const observableCommitCount = commits.filter(Boolean).length;
  const alignedCommitCount = counts.size > 0 ? Math.max(...counts.values()) : 0;
  const commitAlignmentRate = asPercent(alignedCommitCount, 4);
  const status = resolveSourceTreeProvenanceStatus(commitAlignmentRate, observableCommitCount);

  return {
    workspace_commit: workspaceCommit,
    runtime_commit: runtimeCommit,
    build_commit: buildCommit,
    active_slot_commit: activeSlotCommit,
    commit_alignment_rate: commitAlignmentRate,
    status,
    observable_commit_count: observableCommitCount,
    aligned_commit_count: alignedCommitCount,
    publish_blocked: isSourceTreePromotionBlocked({
      commit_alignment_rate: commitAlignmentRate,
      observable_commit_count: observableCommitCount,
    }),
  };
}