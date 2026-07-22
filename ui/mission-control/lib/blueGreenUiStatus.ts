import { readFile } from "node:fs/promises";

export type MissionControlUiSlot = "blue" | "green";

export type MissionControlUiSlotStatus = {
  slot: MissionControlUiSlot;
  service: string;
  url: string;
  port: number;
  distDir: string;
  active: boolean;
  reachable: boolean;
  httpStatus: number | null;
  statusLabel: "LIVE" | "STANDBY" | "DOWN";
  buildId: string | null;
  summary: string;
};

export type MissionControlBlueGreenStatus = {
  activeSlot: MissionControlUiSlot;
  inactiveSlot: MissionControlUiSlot;
  slotFilePath: string;
  slotFileSummary: string;
  slots: MissionControlUiSlotStatus[];
};

const SLOT_FILE_PATH = "/workspace/data/mission-control/ui-active-slot.conf";
const BUILD_ID_ROOT = "/workspace/ui/mission-control";

function slotPort(slot: MissionControlUiSlot): number {
  return slot === "blue" ? 3001 : 3002;
}

function slotDistDir(slot: MissionControlUiSlot): string {
  return `.next-runtime-${slot}`;
}

function slotService(slot: MissionControlUiSlot): string {
  return `mission-control-ui-${slot}`;
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readBuildId(slot: MissionControlUiSlot): Promise<string | null> {
  const buildIdPath = `${BUILD_ID_ROOT}/${slotDistDir(slot)}/BUILD_ID`;
  const raw = await readTextFile(buildIdPath);
  const buildId = String(raw || "").trim();
  return buildId || null;
}

async function probeSlot(slot: MissionControlUiSlot, activeSlot: MissionControlUiSlot): Promise<MissionControlUiSlotStatus> {
  const port = slotPort(slot);
  const service = slotService(slot);
  const url = `http://${service}:${port}/`;
  const buildId = await readBuildId(slot);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
      redirect: "manual",
    });
    const httpStatus = response.status;
    const reachable = response.ok || (httpStatus >= 300 && httpStatus < 400);
    const active = slot === activeSlot;
    return {
      slot,
      service,
      url,
      port,
      distDir: slotDistDir(slot),
      active,
      reachable,
      httpStatus,
      statusLabel: reachable ? (active ? "LIVE" : "STANDBY") : "DOWN",
      buildId,
      summary: reachable
        ? `${service} repond ${httpStatus}${buildId ? ` · build ${buildId}` : ""}`
        : `${service} ne repond pas${buildId ? ` · build ${buildId}` : ""}`,
    };
  } catch {
    const active = slot === activeSlot;
    return {
      slot,
      service,
      url,
      port,
      distDir: slotDistDir(slot),
      active,
      reachable: false,
      httpStatus: null,
      statusLabel: "DOWN",
      buildId,
      summary: `${service} ne repond pas${buildId ? ` · build ${buildId}` : ""}`,
    };
  }
}

export async function readMissionControlBlueGreenStatus(): Promise<MissionControlBlueGreenStatus> {
  const slotFileRaw = await readTextFile(SLOT_FILE_PATH);
  const activeSlot: MissionControlUiSlot = String(slotFileRaw || "").includes("mission-control-ui-green:3002") ? "green" : "blue";
  const inactiveSlot: MissionControlUiSlot = activeSlot === "blue" ? "green" : "blue";
  const slots = await Promise.all([
    probeSlot("blue", activeSlot),
    probeSlot("green", activeSlot),
  ]);

  return {
    activeSlot,
    inactiveSlot,
    slotFilePath: SLOT_FILE_PATH,
    slotFileSummary: slotFileRaw ? slotFileRaw.trim() : "slot file absent, fallback blue",
    slots,
  };
}