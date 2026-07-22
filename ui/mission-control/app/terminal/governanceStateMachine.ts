import type { DynamicCapitalPressureSummary } from "./dynamicCapitalPressure";
import type { FinalDecisionTruth } from "./finalDecisionTruth";
import type { FreezeV1ContractsSummary } from "./freezeV1Contracts";
import type { GovernanceBalanceSummary } from "./governanceBalanceEngine";
import type { GovernanceReplaySummary } from "./governanceReplay";
import type { RecoveryMomentumSummary } from "./recoveryMomentumEngine";
import type { SelfHealingRecoverySnapshot } from "./selfHealingRecoveryMemory";
import type { SelfPreservationSummary } from "./selfPreservation";

export type GovernanceSystemState =
  | "NORMAL"
  | "REDUCE"
  | "CAUTION"
  | "OBSERVE_ONLY"
  | "LOCKDOWN"
  | "TRAUMA"
  | "RECOVERING"
  | "REACCELERATION"
  | "CAPITAL_PRESERVATION"
  | "STRUCTURAL_FAILURE";

export type GovernanceStateInvariant =
  | "single_final_decision_owner"
  | "allocation_only_sizing"
  | "memory_cannot_mutate_execution"
  | "panels_readonly"
  | "react_cannot_arbitrate"
  | "suppression_trace_required"
  | "self_preservation_cannot_be_bypassed";

export type GovernanceStateMachineSummary = {
  schema_version: "governance-state-machine/v1";
  generated_at_iso: string;
  state: GovernanceSystemState;
  allowed_transitions: GovernanceSystemState[];
  blocking_invariants: GovernanceStateInvariant[];
  transition_trace: string[];
  summary_label: string;
  reasons: string[];
  source_states: {
    self_preservation: SelfPreservationSummary["state"] | null;
    capital_pressure: DynamicCapitalPressureSummary["state"] | null;
    capital_scar: FinalDecisionTruth["capital_scar"]["state"] | null;
    governance_balance: GovernanceBalanceSummary["state"] | null;
    governance_replay: GovernanceReplaySummary["state"] | null;
    recovery_momentum: RecoveryMomentumSummary["state"] | null;
    self_healing: SelfHealingRecoverySnapshot["recovery_tier"] | null;
    freeze: FreezeV1ContractsSummary["freeze_state"] | null;
  };
};

export const GOVERNANCE_ALLOWED_TRANSITIONS: Record<GovernanceSystemState, GovernanceSystemState[]> = {
  NORMAL: ["CAUTION", "REDUCE", "OBSERVE_ONLY", "CAPITAL_PRESERVATION"],
  REDUCE: ["CAUTION", "OBSERVE_ONLY", "LOCKDOWN", "CAPITAL_PRESERVATION", "RECOVERING"],
  CAUTION: ["NORMAL", "REDUCE", "OBSERVE_ONLY", "CAPITAL_PRESERVATION", "RECOVERING"],
  OBSERVE_ONLY: ["REDUCE", "LOCKDOWN", "CAPITAL_PRESERVATION", "RECOVERING"],
  LOCKDOWN: ["TRAUMA", "RECOVERING", "STRUCTURAL_FAILURE"],
  TRAUMA: ["LOCKDOWN", "CAPITAL_PRESERVATION", "RECOVERING", "STRUCTURAL_FAILURE"],
  RECOVERING: ["CAUTION", "REACCELERATION", "LOCKDOWN", "CAPITAL_PRESERVATION", "TRAUMA"],
  REACCELERATION: ["NORMAL", "CAUTION", "REDUCE", "LOCKDOWN"],
  CAPITAL_PRESERVATION: ["REDUCE", "OBSERVE_ONLY", "TRAUMA", "RECOVERING", "LOCKDOWN"],
  STRUCTURAL_FAILURE: ["LOCKDOWN", "RECOVERING"],
};

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function isGovernanceTransitionAllowed(from: GovernanceSystemState, to: GovernanceSystemState): boolean {
  return GOVERNANCE_ALLOWED_TRANSITIONS[from].includes(to);
}

function summarizeTraceLabel(state: GovernanceSystemState, trace: string[]): string {
  const dominantTrace = trace[0] || "steady_state";
  return `GOV ${state} · ${dominantTrace.replace(/_/g, " ")}`;
}

function buildSourceStates(input: {
  finalDecisionTruth?: FinalDecisionTruth | null;
  selfHealingRecovery?: SelfHealingRecoverySnapshot | null;
  governanceBalance?: GovernanceBalanceSummary | null;
  recoveryMomentum?: RecoveryMomentumSummary | null;
  governanceReplay?: GovernanceReplaySummary | null;
  freezeContracts?: FreezeV1ContractsSummary | null;
}): GovernanceStateMachineSummary["source_states"] {
  return {
    self_preservation: input.finalDecisionTruth?.self_preservation?.state || null,
    capital_pressure: input.finalDecisionTruth?.capital_pressure?.state || null,
    capital_scar: input.finalDecisionTruth?.capital_scar?.state || null,
    governance_balance: input.governanceBalance?.state || null,
    governance_replay: input.governanceReplay?.state || null,
    recovery_momentum: input.recoveryMomentum?.state || null,
    self_healing: input.selfHealingRecovery?.recovery_tier || null,
    freeze: input.freezeContracts?.freeze_state || null,
  };
}

export function buildGovernanceStateMachineSummary(input: {
  finalDecisionTruth?: FinalDecisionTruth | null;
  selfHealingRecovery?: SelfHealingRecoverySnapshot | null;
  governanceBalance?: GovernanceBalanceSummary | null;
  recoveryMomentum?: RecoveryMomentumSummary | null;
  governanceReplay?: GovernanceReplaySummary | null;
  freezeContracts?: FreezeV1ContractsSummary | null;
  nowMs?: number;
}): GovernanceStateMachineSummary {
  const selfPreservation = input.finalDecisionTruth?.self_preservation || null;
  const capitalPressure = input.finalDecisionTruth?.capital_pressure || null;
  const capitalScar = input.finalDecisionTruth?.capital_scar || null;
  const blockingInvariants: GovernanceStateInvariant[] = [];
  const trace: string[] = [];
  const reasons: string[] = [];

  if (input.freezeContracts?.freeze_state === "DRIFT") {
    trace.push("freeze_contract_drift");
    reasons.push(...input.freezeContracts.reasons.slice(0, 3));
  }
  if (selfPreservation?.state === "LOCKDOWN" && input.finalDecisionTruth?.execution_allowed) {
    blockingInvariants.push("self_preservation_cannot_be_bypassed");
    trace.push("self_preservation_bypass_detected");
    reasons.push("execution_allowed_while_self_preservation_lockdown");
  }
  if (input.governanceBalance?.pressure_normalization.suppressed_sources.length && !input.governanceBalance.pressure_normalization.arbitration_trace.length) {
    blockingInvariants.push("suppression_trace_required");
    trace.push("suppression_trace_missing");
    reasons.push("suppressed_sources_without_arbitration_trace");
  }

  let state: GovernanceSystemState;

  if (blockingInvariants.length > 0 || input.freezeContracts?.freeze_state === "DRIFT") {
    state = "STRUCTURAL_FAILURE";
    if (!trace.length) {
      trace.push("structural_invariant_violation");
    }
  } else if (capitalScar?.state === "TRAUMA") {
    state = "TRAUMA";
    trace.push("capital_scar_trauma");
    reasons.push(...capitalScar.reasons.slice(0, 3));
  } else if (selfPreservation?.state === "LOCKDOWN" || input.governanceBalance?.state === "LOCKED") {
    state = "LOCKDOWN";
    trace.push(selfPreservation?.state === "LOCKDOWN" ? "self_preservation_lockdown" : "governance_locked");
    reasons.push(...(selfPreservation?.reasons.slice(0, 3) || input.governanceBalance?.reasons.slice(0, 3) || []));
  } else if (capitalPressure?.state === "LOCKDOWN" || capitalPressure?.state === "CONSTRAINED" || capitalScar?.state === "SCARRED") {
    state = "CAPITAL_PRESERVATION";
    trace.push(capitalPressure?.state === "LOCKDOWN" ? "capital_pressure_lockdown" : capitalPressure?.state === "CONSTRAINED" ? "capital_pressure_constrained" : "capital_scarred_bias");
    reasons.push(...(capitalPressure?.reasons.slice(0, 3) || capitalScar?.reasons.slice(0, 3) || []));
  } else if (
    input.recoveryMomentum?.state === "REACCELERATING"
    || input.governanceBalance?.reacceleration_state === "REACCELERATING"
    || (input.governanceBalance?.reacceleration_state === "REACCELERATION_READY" && input.governanceBalance?.action === "REACCELERATE")
  ) {
    state = "REACCELERATION";
    trace.push("reacceleration_gate_open");
    reasons.push(...(input.recoveryMomentum?.reasons.slice(0, 3) || input.governanceBalance?.reasons.slice(0, 3) || []));
  } else if (
    input.selfHealingRecovery?.recovery_tier === "RECOVERING"
    || input.selfHealingRecovery?.recovery_tier === "REVALIDATING"
    || input.governanceBalance?.state === "RECOVERING"
    || input.recoveryMomentum?.state === "READY"
    || input.recoveryMomentum?.state === "VALIDATING"
  ) {
    state = "RECOVERING";
    trace.push(input.selfHealingRecovery?.recovery_tier === "RECOVERING" ? "self_healing_recovering" : "recovery_window_forming");
    reasons.push(...(
      input.selfHealingRecovery
        ? [input.selfHealingRecovery.dominant_reason, input.selfHealingRecovery.blocking_layer, input.selfHealingRecovery.self_healing_action].filter(Boolean).slice(0, 3)
        : input.recoveryMomentum?.reasons.slice(0, 3) || []
    ));
  } else if (
    input.governanceReplay?.state === "BLOCKED"
    || input.governanceBalance?.action === "OBSERVE"
    || (input.finalDecisionTruth?.should_trade === false && input.finalDecisionTruth?.execution_allowed === false)
  ) {
    state = "OBSERVE_ONLY";
    trace.push(input.governanceReplay?.state === "BLOCKED" ? "governance_replay_blocked" : "observe_only_gate");
    reasons.push(...(input.governanceReplay?.reasons.slice(0, 3) || input.governanceBalance?.reasons.slice(0, 3) || input.finalDecisionTruth?.reasons.slice(0, 3) || []));
  } else if (input.governanceBalance?.action === "REDUCE" || input.governanceBalance?.state === "PRESSURED") {
    state = "REDUCE";
    trace.push("governance_reduce_pressure");
    reasons.push(...(input.governanceBalance?.reasons.slice(0, 3) || []));
  } else if (
    selfPreservation?.state === "PROTECT"
    || selfPreservation?.state === "DEFENSIVE"
    || input.governanceReplay?.state === "DEFENSIVE"
    || input.governanceBalance?.action === "PROTECT"
    || input.governanceBalance?.action === "STABILIZE"
  ) {
    state = "CAUTION";
    trace.push(selfPreservation?.state === "PROTECT" ? "self_preservation_protect" : "defensive_governance_bias");
    reasons.push(...(selfPreservation?.reasons.slice(0, 3) || input.governanceReplay?.reasons.slice(0, 3) || input.governanceBalance?.reasons.slice(0, 3) || []));
  } else {
    state = "NORMAL";
    trace.push("deterministic_nominal_state");
    reasons.push("governance_layers_nominal");
  }

  return {
    schema_version: "governance-state-machine/v1",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    state,
    allowed_transitions: GOVERNANCE_ALLOWED_TRANSITIONS[state],
    blocking_invariants: blockingInvariants,
    transition_trace: dedupe(trace),
    summary_label: summarizeTraceLabel(state, trace),
    reasons: dedupe(reasons),
    source_states: buildSourceStates(input),
  };
}