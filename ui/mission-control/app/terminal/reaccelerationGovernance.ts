import type { GovernanceInertiaMemorySummary } from "./governanceInertiaMemory";
import type { RecoveryMomentumSummary } from "./recoveryMomentumEngine";

export type ReaccelerationGovernanceState = "RECOVERING" | "STABLE" | "REACCELERATION_READY" | "REACCELERATING" | "OVEREXTENDED";

export type ReaccelerationGovernanceSummary = {
  schema_version: "reacceleration-governance/v1";
  generated_at_iso: string;
  state: ReaccelerationGovernanceState;
  readiness_pct: number;
  aggression_budget_pct: number;
  cadence_budget_pct: number;
  exposure_budget_pct: number;
  trade_permission: boolean;
  reacceleration_eligible: boolean;
  summary_label: string;
  reasons: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildReaccelerationGovernanceSummary(input: {
  protectionPressurePct: number;
  opportunityPressurePct: number;
  confidenceRecoveryPct: number;
  recoveryMomentumPct: number;
  riskReaccelerationPct: number;
  falseRecoveryRiskPct: number;
  governanceInertiaMemory: GovernanceInertiaMemorySummary;
  hardBlock?: boolean;
  nowMs?: number;
}): ReaccelerationGovernanceSummary {
  const readinessPct = Math.round(clamp(
    input.recoveryMomentumPct * 0.28
      + input.confidenceRecoveryPct * 0.26
      + input.riskReaccelerationPct * 0.22
      + input.opportunityPressurePct * 0.16
      - input.protectionPressurePct * 0.18
      - input.governanceInertiaMemory.inertia_pct * 0.22
      - input.governanceInertiaMemory.freeze_drag_pct * 0.12
      - input.falseRecoveryRiskPct * 0.24,
    0,
    100,
  ));
  const aggressionBudgetPct = Math.round(clamp(
    input.opportunityPressurePct * 0.44
      + readinessPct * 0.38
      + (input.governanceInertiaMemory.state === "CALM" ? 6 : input.governanceInertiaMemory.state === "WATCH" ? 2 : 0)
      - input.protectionPressurePct * 0.3
      - input.governanceInertiaMemory.freeze_drag_pct * 0.22
      - input.governanceInertiaMemory.inertia_pct * 0.18,
    0,
    100,
  ));
  const cadenceBudgetPct = Math.round(clamp(
    readinessPct * 0.42
      + input.confidenceRecoveryPct * 0.16
      - input.governanceInertiaMemory.governance_fatigue_pct * 0.28
      - input.falseRecoveryRiskPct * 0.18,
    0,
    100,
  ));
  const exposureBudgetPct = Math.round(clamp(
    aggressionBudgetPct * 0.74
      + readinessPct * 0.18
      - input.protectionPressurePct * 0.14,
    0,
    100,
  ));
  const reaccelerationEligible = !input.hardBlock
    && readinessPct >= 58
    && aggressionBudgetPct >= 48
    && input.falseRecoveryRiskPct <= 38
    && input.governanceInertiaMemory.inertia_pct <= 48;
  const tradePermission = !input.hardBlock && aggressionBudgetPct > 0 && input.protectionPressurePct < 92;
  const state: ReaccelerationGovernanceState = input.hardBlock || input.protectionPressurePct >= 86 || input.governanceInertiaMemory.state === "LOCKED"
    ? "RECOVERING"
    : aggressionBudgetPct >= 78 && input.falseRecoveryRiskPct <= 24 && input.governanceInertiaMemory.inertia_pct <= 28
      ? "REACCELERATING"
      : reaccelerationEligible
        ? "REACCELERATION_READY"
        : readinessPct >= 42 && input.governanceInertiaMemory.governance_fatigue_pct <= 52
          ? "STABLE"
          : aggressionBudgetPct >= 72 && (input.falseRecoveryRiskPct >= 40 || input.governanceInertiaMemory.inertia_pct >= 52)
            ? "OVEREXTENDED"
            : "RECOVERING";

  return {
    schema_version: "reacceleration-governance/v1",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    state,
    readiness_pct: readinessPct,
    aggression_budget_pct: aggressionBudgetPct,
    cadence_budget_pct: cadenceBudgetPct,
    exposure_budget_pct: exposureBudgetPct,
    trade_permission: tradePermission,
    reacceleration_eligible: reaccelerationEligible,
    summary_label: `REACC ${state} ${readinessPct}%`,
    reasons: dedupe([
      readinessPct >= 45 ? `reacceleration_readiness:${readinessPct}pct` : "",
      aggressionBudgetPct >= 45 ? `reacceleration_aggression_budget:${aggressionBudgetPct}pct` : "",
      cadenceBudgetPct >= 45 ? `reacceleration_cadence_budget:${cadenceBudgetPct}pct` : "",
      exposureBudgetPct >= 45 ? `reacceleration_exposure_budget:${exposureBudgetPct}pct` : "",
      input.falseRecoveryRiskPct >= 35 ? `reacceleration_false_recovery:${input.falseRecoveryRiskPct}pct` : "",
      input.governanceInertiaMemory.inertia_pct >= 40 ? `reacceleration_inertia:${input.governanceInertiaMemory.inertia_pct}pct` : "",
      reaccelerationEligible ? "reacceleration_gate_open" : "",
    ]),
  };
}