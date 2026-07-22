import type { PressureNormalizationSummary } from "./pressureNormalization";

export type AggressionBudgetEngineSummary = {
  schema_version: "aggression-budget/v2";
  generated_at_iso: string;
  aggression_budget_pct: number;
  cadence_budget_pct: number;
  exposure_budget_pct: number;
  routing_aggressiveness_pct: number;
  venue_diversification_pct: number;
  retry_budget_pct: number;
  exploration_budget_pct: number;
  recovery_velocity_pct: number;
  reacceleration_velocity_pct: number;
  allowed_exposure_pct: number;
  compatibility_multiplier: number;
  multiplier: number;
  summary_label: string;
  reasons: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildAggressionBudgetEngineSummary(input: {
  state: "LOCKED" | "PRESSURED" | "BALANCED" | "RECOVERING" | "OPPORTUNISTIC";
  action: "PROTECT" | "OBSERVE" | "REDUCE" | "STABILIZE" | "REACCELERATE" | "RESUME";
  cadence: "HALT" | "REVIEW" | "SLOW" | "NORMAL" | "FAST";
  pressure: Pick<PressureNormalizationSummary,
    | "normalized_protection_pct"
    | "normalized_opportunity_pct"
    | "conflict_pct"
    | "winning_tier"
    | "suppressed_sources"
    | "unresolved_conflicts"
    | "arbitration_state"
  >;
  confidenceRecoveryPct: number;
  recoveryMomentumPct: number;
  riskReaccelerationPct: number;
  governanceInertiaPct: number;
  freezeDragPct: number;
  reaccelerationReadinessPct: number;
  falseRecoveryRiskPct: number;
  baseAggressionBudgetPct: number;
  baseCadenceBudgetPct: number;
  baseExposureBudgetPct: number;
  reaccelerationEligible: boolean;
  nowMs?: number;
}): AggressionBudgetEngineSummary {
  const protectionPressurePct = input.pressure.normalized_protection_pct;
  const opportunityPressurePct = input.pressure.normalized_opportunity_pct;
  const winningTierPenalty = input.pressure.winning_tier === "T0"
    ? 20
    : input.pressure.winning_tier === "T1"
      ? 14
      : input.pressure.winning_tier === "T2"
        ? 8
        : 0;
  const conflictPenalty = input.pressure.conflict_pct + input.pressure.unresolved_conflicts.length * 6;
  const suppressionPenalty = input.pressure.suppressed_sources.length * 4;
  const protectiveDrag = protectionPressurePct * 0.24
    + input.governanceInertiaPct * 0.2
    + input.freezeDragPct * 0.16
    + input.falseRecoveryRiskPct * 0.12
    + conflictPenalty * 0.1
    + winningTierPenalty
    + suppressionPenalty * 0.35;
  const recoveryLift = opportunityPressurePct * 0.18
    + input.confidenceRecoveryPct * 0.18
    + input.recoveryMomentumPct * 0.16
    + input.riskReaccelerationPct * 0.12
    + input.reaccelerationReadinessPct * 0.2
    - conflictPenalty * 0.08;

  let aggressionBudgetPct = Math.round(clamp(input.baseAggressionBudgetPct + recoveryLift - protectiveDrag, 0, 100));
  let cadenceBudgetPct = Math.round(clamp(
    input.baseCadenceBudgetPct
      + input.reaccelerationReadinessPct * 0.18
      + input.recoveryMomentumPct * 0.12
      - input.freezeDragPct * 0.18
      - input.falseRecoveryRiskPct * 0.16
      - conflictPenalty * 0.12,
    0,
    100,
  ));
  let exposureBudgetPct = Math.round(clamp(
    input.baseExposureBudgetPct
      + aggressionBudgetPct * 0.12
      - protectionPressurePct * 0.16
      - input.governanceInertiaPct * 0.12,
    0,
    100,
  ));
  let retryBudgetPct = Math.round(clamp(
    cadenceBudgetPct * 0.48
      + input.recoveryMomentumPct * 0.12
      - protectionPressurePct * 0.18
      - conflictPenalty * 0.16
      - input.falseRecoveryRiskPct * 0.14,
    0,
    100,
  ));
  let explorationBudgetPct = Math.round(clamp(
    opportunityPressurePct * 0.42
      + input.confidenceRecoveryPct * 0.18
      + input.reaccelerationReadinessPct * 0.14
      - protectionPressurePct * 0.24
      - conflictPenalty * 0.18
      - winningTierPenalty,
    0,
    100,
  ));

  if (input.state === "LOCKED") {
    aggressionBudgetPct = 0;
    cadenceBudgetPct = 0;
    exposureBudgetPct = 0;
    retryBudgetPct = 0;
    explorationBudgetPct = 0;
  } else if (input.state === "PRESSURED") {
    aggressionBudgetPct = Math.min(44, aggressionBudgetPct);
    cadenceBudgetPct = Math.min(42, cadenceBudgetPct);
    exposureBudgetPct = Math.min(34, exposureBudgetPct);
    retryBudgetPct = Math.min(38, retryBudgetPct);
    explorationBudgetPct = Math.min(18, explorationBudgetPct);
  } else if (input.state === "RECOVERING") {
    aggressionBudgetPct = clamp(aggressionBudgetPct, 24, 62);
    cadenceBudgetPct = clamp(cadenceBudgetPct, 22, 56);
    exposureBudgetPct = clamp(exposureBudgetPct, 26, 54);
    retryBudgetPct = clamp(retryBudgetPct, 16, 46);
    explorationBudgetPct = clamp(explorationBudgetPct, 8, 36);
  } else if (input.state === "BALANCED") {
    aggressionBudgetPct = clamp(aggressionBudgetPct, 36, 72);
    cadenceBudgetPct = clamp(cadenceBudgetPct, 34, 68);
    exposureBudgetPct = clamp(exposureBudgetPct, 38, 70);
    retryBudgetPct = clamp(retryBudgetPct, 20, 58);
    explorationBudgetPct = clamp(explorationBudgetPct, 12, 52);
  } else if (input.state === "OPPORTUNISTIC") {
    aggressionBudgetPct = Math.max(64, aggressionBudgetPct);
    cadenceBudgetPct = Math.max(58, cadenceBudgetPct);
    exposureBudgetPct = Math.max(62, exposureBudgetPct);
    retryBudgetPct = Math.max(32, retryBudgetPct);
    explorationBudgetPct = Math.max(24, explorationBudgetPct);
  }

  const routingAggressivenessPct = input.state === "LOCKED"
    ? 0
    : Math.round(clamp(
      aggressionBudgetPct * 0.72
        + opportunityPressurePct * 0.14
        - protectionPressurePct * 0.16
        - input.freezeDragPct * 0.08,
      0,
      input.state === "PRESSURED" ? 38 : 100,
    ));
  const venueDiversificationPct = input.state === "LOCKED"
    ? 0
    : Math.round(clamp(
      18
        + conflictPenalty * 0.42
        + Math.max(0, protectionPressurePct - opportunityPressurePct) * 0.12
        + (input.state === "PRESSURED" ? 8 : 0)
        - input.freezeDragPct * 0.08,
      0,
      100,
    ));
  const recoveryVelocityPct = input.state === "LOCKED"
    ? 0
    : Math.round(clamp(
      input.reaccelerationReadinessPct * 0.46
        + input.recoveryMomentumPct * 0.2
        + input.riskReaccelerationPct * 0.12
        - input.governanceInertiaPct * 0.22
        - input.falseRecoveryRiskPct * 0.18
      - conflictPenalty * 0.14,
      0,
      input.reaccelerationEligible ? 100 : 58,
    ));
  const allowedExposurePct = input.state === "LOCKED"
    ? 0
    : input.action === "REDUCE"
      ? Math.min(32, exposureBudgetPct)
      : input.action === "STABILIZE"
        ? Math.min(54, Math.max(36, exposureBudgetPct))
        : input.action === "REACCELERATE"
          ? Math.max(68, exposureBudgetPct)
          : Math.max(42, exposureBudgetPct);
  const compatibilityMultiplier = input.state === "LOCKED"
    ? 0
    : input.action === "REDUCE"
      ? 0.58
      : input.action === "STABILIZE"
        ? Math.min(0.84, Math.max(0.68, aggressionBudgetPct / 100))
        : input.action === "REACCELERATE"
          ? Math.min(1.14, Math.max(1.01, (aggressionBudgetPct * 0.45 + exposureBudgetPct * 0.35 + recoveryVelocityPct * 0.2) / 100 + 0.18))
          : input.action === "OBSERVE"
            ? 0.68
            : Math.min(1.01, Math.max(0.74, (aggressionBudgetPct * 0.42 + cadenceBudgetPct * 0.28 + allowedExposurePct * 0.3) / 100));

  return {
    schema_version: "aggression-budget/v2",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    aggression_budget_pct: aggressionBudgetPct,
    cadence_budget_pct: cadenceBudgetPct,
    exposure_budget_pct: exposureBudgetPct,
    routing_aggressiveness_pct: routingAggressivenessPct,
    venue_diversification_pct: venueDiversificationPct,
    retry_budget_pct: retryBudgetPct,
    exploration_budget_pct: explorationBudgetPct,
    recovery_velocity_pct: recoveryVelocityPct,
    reacceleration_velocity_pct: recoveryVelocityPct,
    allowed_exposure_pct: allowedExposurePct,
    compatibility_multiplier: Number(compatibilityMultiplier.toFixed(3)),
    multiplier: Number(compatibilityMultiplier.toFixed(3)),
    summary_label: `ALLOC ${input.state} ${input.action} · aggr ${aggressionBudgetPct}% exp ${allowedExposurePct}%`,
    reasons: dedupe([
      aggressionBudgetPct >= 45 ? `aggression_budget:${aggressionBudgetPct}pct` : "",
      cadenceBudgetPct >= 45 ? `aggression_cadence_budget:${cadenceBudgetPct}pct` : "",
      exposureBudgetPct >= 45 ? `aggression_exposure_budget:${exposureBudgetPct}pct` : "",
      routingAggressivenessPct >= 40 ? `aggression_routing:${routingAggressivenessPct}pct` : "",
      venueDiversificationPct >= 35 ? `aggression_diversification:${venueDiversificationPct}pct` : "",
      retryBudgetPct >= 30 ? `aggression_retry_budget:${retryBudgetPct}pct` : "",
      explorationBudgetPct >= 24 ? `aggression_exploration_budget:${explorationBudgetPct}pct` : "",
      recoveryVelocityPct >= 35 ? `aggression_recovery_velocity:${recoveryVelocityPct}pct` : "",
      input.pressure.winning_tier !== "none" ? `aggression_winning_tier:${input.pressure.winning_tier.toLowerCase()}` : "",
    ]),
  };
}