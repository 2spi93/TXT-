import type { GovernanceReplayDetailedTimelineStep } from "./governanceReplay";

export type GovernanceInertiaMemoryState = "CALM" | "WATCH" | "FATIGUED" | "LOCKED";

export type GovernanceInertiaMemorySummary = {
  schema_version: "governance-inertia-memory/v1";
  generated_at_iso: string;
  state: GovernanceInertiaMemoryState;
  oscillation_frequency_pct: number;
  recovery_stability_pct: number;
  false_recovery_rate_pct: number;
  governance_fatigue_pct: number;
  inertia_pct: number;
  freeze_drag_pct: number;
  protective_layer_count: number;
  dominant_pressure_source: string;
  summary_label: string;
  reasons: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function classifyTimelineMode(step: GovernanceReplayDetailedTimelineStep): "protective" | "recovery" | "neutral" {
  const action = String(step.action || "").trim().toUpperCase();
  const journalAction = String(step.journal_action || "").trim().toLowerCase();
  const routeMode = String(step.route_mode || "").trim().toLowerCase();
  const detail = String(step.detail || "").trim().toLowerCase();
  if (routeMode.includes("recover") || routeMode.includes("resume") || routeMode.includes("reaccel") || detail.includes("recovery") || detail.includes("resume")) {
    return "recovery";
  }
  if (routeMode.includes("halt") || journalAction.includes("review") || journalAction.includes("block") || detail.includes("block") || detail.includes("halt")) {
    return "protective";
  }
  if (action === "BLOCK" || action === "REDUCE" || action === "DEFENSIVE") {
    return "protective";
  }
  if (action === "EXECUTE" || action === "RESUME" || journalAction.includes("recovery") || step.tone === "good") {
    return "recovery";
  }
  return "neutral";
}

export function buildGovernanceInertiaMemorySummary(input: {
  temporalPressure: number;
  tcaPressure: number;
  venuePressure: number;
  agingPressure: number;
  contagionPressure: number;
  confidenceDecayPressure: number;
  memoryPressure: number;
  scarPressure: number;
  timeline?: GovernanceReplayDetailedTimelineStep[] | null;
  falseRecoveryRiskPct?: number;
  nowMs?: number;
}): GovernanceInertiaMemorySummary {
  const pressurePairs: Array<[string, number]> = [
    ["temporal", input.temporalPressure],
    ["tca", input.tcaPressure],
    ["venue", input.venuePressure],
    ["aging", input.agingPressure],
    ["contagion", input.contagionPressure],
    ["confidence", input.confidenceDecayPressure],
    ["memory", input.memoryPressure],
    ["scar", input.scarPressure],
  ];
  const dominantPressureSource = pressurePairs
    .slice()
    .sort((left, right) => right[1] - left[1])[0]?.[0] || "temporal";
  const protectiveLayerCount = pressurePairs.filter(([, pressure]) => pressure >= 42).length;
  const timeline = (input.timeline || []).slice(0, 12);
  const classifiedModes = timeline
    .map(classifyTimelineMode)
    .filter((mode): mode is "protective" | "recovery" => mode !== "neutral");
  let oscillationCount = 0;
  for (let index = 1; index < classifiedModes.length; index += 1) {
    if (classifiedModes[index] !== classifiedModes[index - 1]) {
      oscillationCount += 1;
    }
  }
  const recoveryCount = classifiedModes.filter((mode) => mode === "recovery").length;
  let falseRecoveryCount = 0;
  for (let index = 0; index < classifiedModes.length - 1; index += 1) {
    if (classifiedModes[index] === "recovery" && classifiedModes[index + 1] === "protective") {
      falseRecoveryCount += 1;
    }
  }

  const oscillationFrequencyPct = Math.round(clamp(
    classifiedModes.length > 1 ? (oscillationCount / (classifiedModes.length - 1)) * 100 : 0,
    0,
    100,
  ));
  const falseRecoveryRatePct = Math.round(clamp(
    recoveryCount > 0 ? (falseRecoveryCount / recoveryCount) * 100 : (input.falseRecoveryRiskPct ?? 0),
    0,
    100,
  ));
  const recoveryStabilityPct = Math.round(clamp(
    100 - falseRecoveryRatePct * 0.62 - oscillationFrequencyPct * 0.24,
    0,
    100,
  ));
  const governanceFatiguePct = Math.round(clamp(
    protectiveLayerCount * 8
      + oscillationFrequencyPct * 0.42
      + falseRecoveryRatePct * 0.3,
    0,
    100,
  ));
  const inertiaPct = Math.round(clamp(
    protectiveLayerCount * 11
      + oscillationFrequencyPct * 0.34
      + falseRecoveryRatePct * 0.24
      + governanceFatiguePct * 0.12,
    0,
    100,
  ));
  const freezeDragPct = Math.round(clamp(
    (input.temporalPressure >= 76 ? 24 : input.temporalPressure >= 42 ? 12 : 0)
      + (input.tcaPressure >= 74 ? 22 : input.tcaPressure >= 42 ? 10 : 0)
      + (input.venuePressure >= 72 ? 16 : input.venuePressure >= 48 ? 8 : 0)
      + (input.agingPressure >= 55 ? 14 : input.agingPressure >= 28 ? 6 : 0)
      + (input.contagionPressure >= 72 ? 14 : input.contagionPressure >= 48 ? 6 : 0)
      + (input.scarPressure >= 18 ? 8 : 0)
      + oscillationFrequencyPct * 0.08,
    0,
    100,
  ));
  const state: GovernanceInertiaMemoryState = inertiaPct >= 82 || falseRecoveryRatePct >= 68
    ? "LOCKED"
    : inertiaPct >= 58 || governanceFatiguePct >= 54
      ? "FATIGUED"
      : inertiaPct >= 32 || oscillationFrequencyPct >= 24
        ? "WATCH"
        : "CALM";

  return {
    schema_version: "governance-inertia-memory/v1",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    state,
    oscillation_frequency_pct: oscillationFrequencyPct,
    recovery_stability_pct: recoveryStabilityPct,
    false_recovery_rate_pct: falseRecoveryRatePct,
    governance_fatigue_pct: governanceFatiguePct,
    inertia_pct: inertiaPct,
    freeze_drag_pct: freezeDragPct,
    protective_layer_count: protectiveLayerCount,
    dominant_pressure_source: dominantPressureSource,
    summary_label: `INERTIA ${state} ${inertiaPct}%`,
    reasons: dedupe([
      oscillationFrequencyPct >= 24 ? `governance_inertia_oscillation:${oscillationFrequencyPct}pct` : "",
      falseRecoveryRatePct >= 24 ? `governance_inertia_false_recovery:${falseRecoveryRatePct}pct` : "",
      governanceFatiguePct >= 30 ? `governance_inertia_fatigue:${governanceFatiguePct}pct` : "",
      inertiaPct >= 40 ? `governance_inertia_memory:${inertiaPct}pct` : "",
      `governance_inertia_dominant:${dominantPressureSource}`,
    ]),
  };
}