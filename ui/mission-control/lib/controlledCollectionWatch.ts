import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { cpFetchJsonSafe } from "./controlPlane";

export type ControlledCollectionSessionSummary = {
  available: boolean;
  active: boolean;
  baselineSince: string | null;
  openedAt: string | null;
  lastSnapshotAt: string | null;
  durationMinutes: number;
  cycles: number;
  phase: string;
  fillsSeen: number;
  labelsSeen: number;
  killSwitchRearmed: boolean;
  killSwitchActive: boolean;
  killSwitchReason: string | null;
  killSwitchSource: "watch" | "control-plane" | "unavailable";
  watchStale: boolean;
  watchAgeMinutes: number | null;
  gateStatus: string | null;
  gateHealthScore: number | null;
  latestFillAt: string | null;
  latestLabeledAt: string | null;
  archivePath: string;
  statePath: string;
};

type WatchRow = {
  baseline_since?: string;
  ts?: string;
  phase?: string;
  fills?: { filled_decisions_since?: number; latest_fill_at?: string | null };
  labels?: { labels_since?: number; latest_labeled_at?: string | null };
  kill_switch?: { active?: boolean; reason?: string | null };
  opportunity_gate?: { status?: string | null; health_score?: number | null };
};

type WatchCache = {
  archivePath: string;
  mtimeMs: number;
  size: number;
  rows: WatchRow[];
};

let watchCache: WatchCache | null = null;

const CONTROLLED_COLLECTION_WATCH_STALE_MS = 30 * 60 * 1000;
const CONTROLLED_COLLECTION_KILL_SWITCH_TIMEOUT_MS = 1_200;

function archivePath(): string {
  return process.env.MC_CONTROLLED_COLLECTION_WATCH_FILE || path.resolve(process.cwd(), "../../logs/controlled_collection_watch.jsonl");
}

function statePath(): string {
  return process.env.MC_CONTROLLED_COLLECTION_STATE_FILE || path.resolve(process.cwd(), "../../logs/controlled_collection_session_state.json");
}

async function loadRows(): Promise<WatchRow[]> {
  const target = archivePath();
  try {
    const metadata = await stat(target);
    if (watchCache && watchCache.archivePath === target && watchCache.mtimeMs === metadata.mtimeMs && watchCache.size === metadata.size) {
      return watchCache.rows;
    }
    const content = await readFile(target, "utf8");
    const rows = content.split("\n").filter(Boolean).map((line) => {
      try {
        return JSON.parse(line) as WatchRow;
      } catch {
        return null;
      }
    }).filter((row): row is WatchRow => row !== null);
    watchCache = { archivePath: target, mtimeMs: metadata.mtimeMs, size: metadata.size, rows };
    return rows;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      watchCache = null;
      return [];
    }
    throw error;
  }
}

async function loadState(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(statePath(), "utf8");
    const payload = JSON.parse(raw) as Record<string, unknown>;
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  } catch {
    return {};
  }
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

async function loadCurrentKillSwitchState(): Promise<{ active: boolean; reason: string | null } | null> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const fallback = null;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve(fallback);
    }, CONTROLLED_COLLECTION_KILL_SWITCH_TIMEOUT_MS);
  });
  const fetchPromise = cpFetchJsonSafe("/v1/system/kill-switch", { signal: controller.signal })
    .then((result) => {
      if (!result.response.ok) {
        return null;
      }
      const root = result.payload && typeof result.payload === "object" && !Array.isArray(result.payload)
        ? result.payload as Record<string, unknown>
        : {};
      const state = root.state && typeof root.state === "object" && !Array.isArray(root.state)
        ? root.state as Record<string, unknown>
        : root;
      return {
        active: Boolean(state.active),
        reason: String(state.reason || "").trim() || null,
      };
    })
    .catch(() => fallback)
    .finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });
  return Promise.race([fetchPromise, timeoutPromise]);
}

export async function getControlledCollectionSessionSummary(): Promise<ControlledCollectionSessionSummary> {
  const rows = await loadRows();
  const state = await loadState();
  const stateBaseline = String(state.baseline_since || "").trim();
  const baseline = stateBaseline || String(rows[rows.length - 1]?.baseline_since || "").trim();
  if (!baseline) {
    return {
      available: false,
      active: false,
      baselineSince: null,
      openedAt: null,
      lastSnapshotAt: null,
      durationMinutes: 0,
      cycles: 0,
      phase: "NO_SESSION",
      fillsSeen: 0,
      labelsSeen: 0,
      killSwitchRearmed: false,
      killSwitchActive: false,
      killSwitchReason: null,
      killSwitchSource: "watch",
      watchStale: false,
      watchAgeMinutes: null,
      gateStatus: null,
      gateHealthScore: null,
      latestFillAt: null,
      latestLabeledAt: null,
      archivePath: archivePath(),
      statePath: statePath(),
    };
  }

  const sessionRows = rows.filter((row) => String(row.baseline_since || "").trim() === baseline);
  const latest = sessionRows[sessionRows.length - 1] || {};
  const baselineMs = Date.parse(baseline);
  const lastSnapshotAt = String(latest.ts || "").trim() || null;
  const lastSnapshotMs = lastSnapshotAt ? Date.parse(lastSnapshotAt) : NaN;
  const nowMs = Date.now();
  const watchAgeMinutes = Number.isFinite(lastSnapshotMs) ? Math.max(0, (nowMs - lastSnapshotMs) / 60_000) : null;
  const watchStale = watchAgeMinutes == null || watchAgeMinutes * 60_000 > CONTROLLED_COLLECTION_WATCH_STALE_MS;
  const currentKillSwitch = await withTimeout(
    loadCurrentKillSwitchState(),
    CONTROLLED_COLLECTION_KILL_SWITCH_TIMEOUT_MS + 100,
    null,
  );
  const watchKillSwitchActive = Boolean((latest.kill_switch || {}).active);
  const watchKillSwitchReason = String((latest.kill_switch || {}).reason || "").trim() || null;
  const killSwitchSource = currentKillSwitch ? "control-plane" : watchStale ? "unavailable" : "watch";
  const killSwitchActive = currentKillSwitch ? currentKillSwitch.active : watchKillSwitchActive;
  const killSwitchReason = currentKillSwitch ? currentKillSwitch.reason : watchKillSwitchReason;
  const phase = currentKillSwitch && watchKillSwitchActive && !currentKillSwitch.active
    ? "manual_reset_reconciled"
    : watchStale
      ? "STALE_SESSION"
      : String(latest.phase || "UNKNOWN");
  const durationMinutes = Number.isFinite(baselineMs) && Number.isFinite(lastSnapshotMs)
    ? Math.max(0, (lastSnapshotMs - baselineMs) / 60_000)
    : 0;
  return {
    available: sessionRows.length > 0,
    active: String(state.status || "") === "open" && stateBaseline === baseline && !watchStale && !killSwitchActive,
    baselineSince: baseline,
    openedAt: String(state.opened_at || baseline || "").trim() || null,
    lastSnapshotAt,
    durationMinutes: Math.round(durationMinutes * 100) / 100,
    cycles: sessionRows.length,
    phase,
    fillsSeen: Math.max(0, ...sessionRows.map((row) => Number((row.fills || {}).filled_decisions_since || 0))),
    labelsSeen: Math.max(0, ...sessionRows.map((row) => Number((row.labels || {}).labels_since || 0))),
    killSwitchRearmed: sessionRows.some((row) => String(row.phase || "") === "kill_switch_rearmed_stop"),
    killSwitchActive,
    killSwitchReason,
    killSwitchSource,
    watchStale,
    watchAgeMinutes: watchAgeMinutes == null ? null : Math.round(watchAgeMinutes * 100) / 100,
    gateStatus: String((latest.opportunity_gate || {}).status || "").trim() || null,
    gateHealthScore: Number.isFinite(Number((latest.opportunity_gate || {}).health_score)) ? Number((latest.opportunity_gate || {}).health_score) : null,
    latestFillAt: String((latest.fills || {}).latest_fill_at || "").trim() || null,
    latestLabeledAt: String((latest.labels || {}).latest_labeled_at || "").trim() || null,
    archivePath: archivePath(),
    statePath: statePath(),
  };
}