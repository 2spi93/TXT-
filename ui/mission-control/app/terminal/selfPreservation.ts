import type { StabilitySnapshot } from "./stabilityEngine";

export type SelfPreservationState = "OPEN" | "GUARDED" | "DEFENSIVE" | "PROTECT" | "LOCKDOWN";
export type SelfPreservationTrigger = "NONE" | "RUNTIME" | "WATCHDOG" | "GOVERNANCE" | "STABILITY" | "MT5_REVIEW" | "META_AGENT" | "LEARNING" | "PERSISTENCE";

export type SelfPreservationSummary = {
  schema_version?: "self-preservation/v1";
  state: SelfPreservationState;
  score_pct: number;
  allow_new_risk: boolean;
  blocks_execution: boolean;
  summary_label: string;
  reasons: string[];
  dominant_trigger: SelfPreservationTrigger;
  metrics: {
    stability_mode: StabilitySnapshot["mode"];
    stability_monitor_pct: number;
    drift_watchdog: StabilitySnapshot["driftWatchdog"];
    runtime_guard_active: boolean;
    runtime_guard_code: string;
    watchdog_status: string;
    governance_mode: string;
    opportunity_gate_count: number;
    mt5_review_required: boolean;
    mt5_review_acknowledged: boolean;
    halt_new_exposure: boolean;
    close_only: boolean;
    learning_frozen: boolean;
    persistence_available: boolean;
  };
};

type BuildSelfPreservationSummaryInput = {
  stabilitySnapshot: StabilitySnapshot;
  systemRuntimeGuard: {
    active: boolean;
    code: string;
    summaryLabel: string;
    detailLabel: string;
  } | null;
  watchdogStatus: string;
  governanceMode: string;
  opportunityGateReasons: string[];
  mt5ReviewRequired: boolean;
  mt5ReviewAcknowledged: boolean;
  backendHaltNewExposure: boolean;
  backendCloseOnly: boolean;
  backendReasons: string[];
  learningFrozen: boolean;
  persistenceAvailable: boolean;
  freezeReasons: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function inferDominantTrigger(input: BuildSelfPreservationSummaryInput): SelfPreservationTrigger {
  const runtimeCode = String(input.systemRuntimeGuard?.code || "").trim().toLowerCase();
  if (runtimeCode.includes("watchdog") || input.watchdogStatus === "HALT") {
    return "WATCHDOG";
  }
  if (input.governanceMode === "LOCKED") {
    return "GOVERNANCE";
  }
  if (input.systemRuntimeGuard?.active) {
    return "RUNTIME";
  }
  if (input.mt5ReviewRequired && !input.mt5ReviewAcknowledged) {
    return "MT5_REVIEW";
  }
  if (input.backendHaltNewExposure || input.backendCloseOnly) {
    return "META_AGENT";
  }
  if (!input.persistenceAvailable) {
    return "PERSISTENCE";
  }
  if (input.learningFrozen) {
    return "LEARNING";
  }
  if (input.stabilitySnapshot.mode !== "live" || input.stabilitySnapshot.driftWatchdog !== "CALM") {
    return "STABILITY";
  }
  return "NONE";
}

export function buildSelfPreservationSummary(input: BuildSelfPreservationSummaryInput): SelfPreservationSummary {
  const reasons = [...input.stabilitySnapshot.reasons];
  const runtimeGuardActive = Boolean(input.systemRuntimeGuard?.active);
  const mt5ReviewRequired = input.mt5ReviewRequired && !input.mt5ReviewAcknowledged;

  if (runtimeGuardActive) {
    reasons.push(`runtime_guard:${String(input.systemRuntimeGuard?.code || "active").trim().toLowerCase() || "active"}`);
  }
  if (input.watchdogStatus !== "OK") {
    reasons.push(`watchdog:${input.watchdogStatus.toLowerCase()}`);
  }
  if (input.governanceMode !== "ADAPTIVE") {
    reasons.push(`governance_mode:${input.governanceMode.toLowerCase()}`);
  }
  if (input.opportunityGateReasons.length > 0) {
    input.opportunityGateReasons.slice(0, 3).forEach((reason) => reasons.push(`opportunity_gate:${reason}`));
  }
  if (mt5ReviewRequired) {
    reasons.push("mt5_review_required");
  }
  if (input.backendHaltNewExposure) {
    reasons.push("meta_agent_halt_new_exposure");
  }
  if (input.backendCloseOnly) {
    reasons.push("meta_agent_close_only");
  }
  input.backendReasons.slice(0, 3).forEach((reason) => reasons.push(reason));
  if (input.learningFrozen) {
    reasons.push("learning_frozen");
  }
  input.freezeReasons.slice(0, 3).forEach((reason) => reasons.push(reason));
  if (!input.persistenceAvailable) {
    reasons.push("learning_persistence_degraded");
  }

  const modeScore = input.stabilitySnapshot.mode === "halted"
    ? 0.42
    : input.stabilitySnapshot.mode === "guarded"
      ? 0.18
      : input.stabilitySnapshot.mode === "shadow"
        ? 0.12
        : 0;
  const driftScore = input.stabilitySnapshot.driftWatchdog === "CRITICAL"
    ? 0.28
    : input.stabilitySnapshot.driftWatchdog === "DRIFT"
      ? 0.18
      : input.stabilitySnapshot.driftWatchdog === "WATCH"
        ? 0.1
        : 0;
  const score = clamp(
    clamp(1 - input.stabilitySnapshot.monitorScore, 0, 1) * 0.34
      + modeScore
      + driftScore
      + (runtimeGuardActive ? 0.3 : 0)
      + (input.governanceMode === "LOCKED" ? 0.24 : 0)
      + (mt5ReviewRequired ? 0.22 : 0)
      + (input.backendHaltNewExposure ? 0.2 : 0)
      + (input.backendCloseOnly ? 0.14 : 0)
      + (input.learningFrozen ? 0.12 : 0)
      + (!input.persistenceAvailable ? 0.18 : 0),
    0,
    1,
  );

  const hardBlock = runtimeGuardActive
    || input.stabilitySnapshot.shouldBlockExecution
    || input.governanceMode === "LOCKED"
    || input.watchdogStatus === "HALT";
  const protectNewRisk = mt5ReviewRequired
    || input.backendHaltNewExposure
    || input.backendCloseOnly
    || !input.persistenceAvailable
    || (input.learningFrozen && input.stabilitySnapshot.mode !== "live");
  const state: SelfPreservationState = hardBlock
    ? "LOCKDOWN"
    : protectNewRisk || score >= 0.52
      ? "PROTECT"
      : input.stabilitySnapshot.mode === "guarded" || input.stabilitySnapshot.mode === "shadow" || input.stabilitySnapshot.driftWatchdog === "WATCH" || input.stabilitySnapshot.driftWatchdog === "DRIFT" || score >= 0.34
        ? "DEFENSIVE"
        : reasons.length > 0 || score >= 0.18
          ? "GUARDED"
          : "OPEN";

  return {
    schema_version: "self-preservation/v1",
    state,
    score_pct: Math.round(score * 100),
    allow_new_risk: state === "OPEN" || state === "GUARDED",
    blocks_execution: state === "LOCKDOWN",
    summary_label: `SELF PRES ${state} ${Math.round(score * 100)}% · ${input.stabilitySnapshot.mode.toUpperCase()}`,
    reasons: dedupe(reasons),
    dominant_trigger: inferDominantTrigger(input),
    metrics: {
      stability_mode: input.stabilitySnapshot.mode,
      stability_monitor_pct: Math.round(input.stabilitySnapshot.monitorScore * 100),
      drift_watchdog: input.stabilitySnapshot.driftWatchdog,
      runtime_guard_active: runtimeGuardActive,
      runtime_guard_code: String(input.systemRuntimeGuard?.code || "none").trim().toLowerCase() || "none",
      watchdog_status: input.watchdogStatus,
      governance_mode: input.governanceMode,
      opportunity_gate_count: input.opportunityGateReasons.length,
      mt5_review_required: mt5ReviewRequired,
      mt5_review_acknowledged: input.mt5ReviewAcknowledged,
      halt_new_exposure: input.backendHaltNewExposure,
      close_only: input.backendCloseOnly,
      learning_frozen: input.learningFrozen,
      persistence_available: input.persistenceAvailable,
    },
  };
}