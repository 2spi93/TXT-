export type AggressionBudgetEngineSummary = {
  schema_version: "aggression-budget/v1";
  generated_at_iso: string;
  aggression_budget_pct: number;
  cadence_budget_pct: number;
  exposure_budget_pct: number;
  routing_aggressiveness_pct: number;
  venue_diversification_pct: number;
  reacceleration_velocity_pct: number;
  allowed_exposure_pct: number;
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
  protectionPressurePct: number;
  opportunityPressurePct: number;
  confidenceRecoveryPct: number;
  recoveryMomentumPct: number;
  riskReaccelerationPct: number;
  governanceInertiaPct: number;
  freezeDragPct: number;
  reaccelerationReadinessPct: number;
  falseRecoveryRiskPct: number;
  conflictPct: number;
  baseAggressionBudgetPct: number;
  baseCadenceBudgetPct: number;
  baseExposureBudgetPct: number;
  reaccelerationEligible: boolean;
  nowMs?: number;
}): AggressionBudgetEngineSummary {
  const protectiveDrag = input.protectionPressurePct * 0.24
    + input.governanceInertiaPct * 0.2
    + input.freezeDragPct * 0.16
    + input.falseRecoveryRiskPct * 0.12
    + input.conflictPct * 0.1;
  const recoveryLift = input.opportunityPressurePct * 0.18
    + input.confidenceRecoveryPct * 0.18
    + input.recoveryMomentumPct * 0.16
    + input.riskReaccelerationPct * 0.12
    + input.reaccelerationReadinessPct * 0.2;

  let aggressionBudgetPct = Math.round(clamp(input.baseAggressionBudgetPct + recoveryLift - protectiveDrag, 0, 100));
  let cadenceBudgetPct = Math.round(clamp(
    input.baseCadenceBudgetPct
      + input.reaccelerationReadinessPct * 0.18
      + input.recoveryMomentumPct * 0.12
      - input.freezeDragPct * 0.18
      - input.falseRecoveryRiskPct * 0.16
      - input.conflictPct * 0.12,
    0,
    100,
  ));
  let exposureBudgetPct = Math.round(clamp(
    input.baseExposureBudgetPct
      + aggressionBudgetPct * 0.12
      - input.protectionPressurePct * 0.16
      - input.governanceInertiaPct * 0.12,
    0,
    100,
  ));

  if (input.state === "LOCKED") {
    aggressionBudgetPct = 0;
    cadenceBudgetPct = 0;
    exposureBudgetPct = 0;
  } else if (input.state === "PRESSURED") {
    aggressionBudgetPct = Math.min(44, aggressionBudgetPct);
    cadenceBudgetPct = Math.min(42, cadenceBudgetPct);
    exposureBudgetPct = Math.min(34, exposureBudgetPct);
  } else if (input.state === "RECOVERING") {
    aggressionBudgetPct = clamp(aggressionBudgetPct, 24, 62);
    cadenceBudgetPct = clamp(cadenceBudgetPct, 22, 56);
    exposureBudgetPct = clamp(exposureBudgetPct, 26, 54);
  } else if (input.state === "BALANCED") {
    aggressionBudgetPct = clamp(aggressionBudgetPct, 36, 72);
    cadenceBudgetPct = clamp(cadenceBudgetPct, 34, 68);
    exposureBudgetPct = clamp(exposureBudgetPct, 38, 70);
  } else if (input.state === "OPPORTUNISTIC") {
    aggressionBudgetPct = Math.max(64, aggressionBudgetPct);
    cadenceBudgetPct = Math.max(58, cadenceBudgetPct);
    exposureBudgetPct = Math.max(62, exposureBudgetPct);
  }

  const routingAggressivenessPct = input.state === "LOCKED"
    ? 0
    : Math.round(clamp(
      aggressionBudgetPct * 0.72
        + input.opportunityPressurePct * 0.14
        - input.protectionPressurePct * 0.16
        - input.freezeDragPct * 0.08,
      0,
      input.state === "PRESSURED" ? 38 : 100,
    ));
  const venueDiversificationPct = input.state === "LOCKED"
    ? 0
    : Math.round(clamp(
      18
        + input.conflictPct * 0.42
        + Math.max(0, input.protectionPressurePct - input.opportunityPressurePct) * 0.12
        + (input.state === "PRESSURED" ? 8 : 0)
        - input.freezeDragPct * 0.08,
      0,
      100,
    ));
  const reaccelerationVelocityPct = input.state === "LOCKED"
    ? 0
    : Math.round(clamp(
      input.reaccelerationReadinessPct * 0.46
        + input.recoveryMomentumPct * 0.2
        + input.riskReaccelerationPct * 0.12
        - input.governanceInertiaPct * 0.22
        - input.falseRecoveryRiskPct * 0.18
        - input.conflictPct * 0.14,
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
  const multiplier = input.state === "LOCKED"
    ? 0
    : input.action === "REDUCE"
      ? 0.58
      : input.action === "STABILIZE"
        ? Math.min(0.84, Math.max(0.68, aggressionBudgetPct / 100))
        : input.action === "REACCELERATE"
          ? Math.min(1.16, Math.max(1.02, aggressionBudgetPct / 100 + 0.24))
          : input.action === "OBSERVE"
            ? 0.68
            : Math.min(1.02, Math.max(0.74, aggressionBudgetPct / 100 + 0.18));

  return {
    schema_version: "aggression-budget/v1",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    aggression_budget_pct: aggressionBudgetPct,
    cadence_budget_pct: cadenceBudgetPct,
    exposure_budget_pct: exposureBudgetPct,
    routing_aggressiveness_pct: routingAggressivenessPct,
    venue_diversification_pct: venueDiversificationPct,
    reacceleration_velocity_pct: reaccelerationVelocityPct,
    allowed_exposure_pct: allowedExposurePct,
    multiplier: Number(multiplier.toFixed(3)),
    summary_label: `ALLOC ${input.state} ${input.action} · aggr ${aggressionBudgetPct}%`,
    reasons: dedupe([
      aggressionBudgetPct >= 45 ? `aggression_budget:${aggressionBudgetPct}pct` : "",
      cadenceBudgetPct >= 45 ? `aggression_cadence_budget:${cadenceBudgetPct}pct` : "",
      exposureBudgetPct >= 45 ? `aggression_exposure_budget:${exposureBudgetPct}pct` : "",
      routingAggressivenessPct >= 40 ? `aggression_routing:${routingAggressivenessPct}pct` : "",
      venueDiversificationPct >= 35 ? `aggression_diversification:${venueDiversificationPct}pct` : "",
      reaccelerationVelocityPct >= 35 ? `aggression_reacceleration_velocity:${reaccelerationVelocityPct}pct` : "",
    ]),
  };
}