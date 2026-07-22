import type { ConfidenceEngineV2Snapshot } from "./confidenceEngineV2";
import type { ConfidenceModeProfile } from "./opportunisticMode";

export type ConfidencePolicyInput = {
  engine: ConfidenceEngineV2Snapshot;
  profile: ConfidenceModeProfile;
  divergenceSignal: "normal" | "arb-watch" | "inefficiency";
  divergenceScorePct: number;
  divergenceDepthReady: boolean;
  truthLockConsistent: boolean;
  criticalLatencyBreach: boolean;
  executableSpreadDegraded: boolean;
  externalVetoReasons?: string[];
};

export type ConfidencePolicySnapshot = {
  finalScorePct: number;
  opportunityBoostPct: number;
  divergenceAdjustmentPct: number;
  executionPenaltyPct: number;
  hardVeto: boolean;
  hardVetoReasons: string[];
  actionState: "blocked" | "watch" | "caution" | "go";
  modeLabel: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function applyConfidencePolicy(input: ConfidencePolicyInput): ConfidencePolicySnapshot {
  const hardVetoReasons = [...(input.externalVetoReasons || [])];
  if (!input.truthLockConsistent) {
    hardVetoReasons.push("truth_lock_inconsistent");
  }
  if (input.criticalLatencyBreach) {
    hardVetoReasons.push("latency_critical");
  }
  if (input.executableSpreadDegraded) {
    hardVetoReasons.push("spread_degraded");
  }
  if (input.divergenceSignal === "inefficiency" && !input.divergenceDepthReady) {
    hardVetoReasons.push("inefficiency_without_depth");
  }

  const hardVeto = hardVetoReasons.length > 0;
  const divergenceStrength = clamp(input.divergenceScorePct / 100, 0, 1);
  let opportunityBoostPct = 0;
  if (input.divergenceSignal === "inefficiency" && input.divergenceDepthReady) {
    opportunityBoostPct = input.profile.inefficiencyBoostPct * divergenceStrength;
  } else if (input.divergenceSignal === "arb-watch") {
    opportunityBoostPct = input.profile.arbWatchBoostPct * divergenceStrength;
  }

  let executionPenaltyPct = 0;
  if (input.engine.executionFitScorePct < input.profile.minimumExecutionFitPct) {
    executionPenaltyPct += (input.profile.minimumExecutionFitPct - input.engine.executionFitScorePct) * 0.45;
  }
  if (input.divergenceSignal === "inefficiency" && !input.divergenceDepthReady) {
    executionPenaltyPct += input.profile.invalidDivergencePenaltyPct;
  }
  const divergenceAdjustmentPct = Number((opportunityBoostPct - executionPenaltyPct).toFixed(1));
  const finalScorePct = hardVeto
    ? Math.min(input.engine.adjustedScorePct, 34)
    : Math.round(clamp(input.engine.adjustedScorePct + divergenceAdjustmentPct, 0, 99));

  const actionState: ConfidencePolicySnapshot["actionState"] = hardVeto
    ? "blocked"
    : finalScorePct >= input.profile.goThresholdPct
      ? "go"
      : finalScorePct >= input.profile.cautionThresholdPct
        ? "caution"
        : finalScorePct >= input.profile.minimumActionThresholdPct
          ? "watch"
          : "blocked";

  return {
    finalScorePct,
    opportunityBoostPct: Number(opportunityBoostPct.toFixed(1)),
    divergenceAdjustmentPct,
    executionPenaltyPct: Number(executionPenaltyPct.toFixed(1)),
    hardVeto,
    hardVetoReasons,
    actionState,
    modeLabel: input.profile.label,
  };
}