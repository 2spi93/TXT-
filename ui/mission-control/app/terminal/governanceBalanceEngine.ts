import type { CapitalScarMemorySummary } from "./capitalScarMemory";
import type { CapitalAgingGovernanceSummary } from "./capitalAgingGovernance";
import type { ContagionMemorySummary } from "./contagionMemory";
import type { CrossMarketTruthSummary } from "./crossMarketTruth";
import type { ExecutionRealityMemorySnapshot } from "./executionRealityMemory";
import type { ExecutionRealityTemporalSizingSummary } from "./executionRealityTemporalSizing";
import type { ExecutionTcaFoundationSummary } from "./executionTcaFoundation";
import type { GlobalConfidenceDecaySummary } from "./globalConfidenceDecay";
import { buildAggressionBudgetEngineSummary, type AggressionBudgetEngineSummary } from "./aggressionBudgetEngine";
import { buildGovernanceInertiaMemorySummary, type GovernanceInertiaMemorySummary } from "./governanceInertiaMemory";
import type { GovernanceReplayDetailedTimelineStep } from "./governanceReplay";
import { buildPressurePersistenceMemorySummary } from "./pressurePersistenceMemory";
import { buildPressureNormalizationSummary, type PressureNormalizationSummary } from "./pressureNormalization";
import type { RecoveryMomentumSummary } from "./recoveryMomentumEngine";
import { buildReaccelerationGovernanceSummary, type ReaccelerationGovernanceSummary } from "./reaccelerationGovernance";
import type { VenueDecayMemorySummary } from "./venueDecayMemory";

export type GovernanceBalanceAction = "PROTECT" | "OBSERVE" | "REDUCE" | "STABILIZE" | "REACCELERATE" | "RESUME";
export type GovernanceBalanceCadence = "HALT" | "REVIEW" | "SLOW" | "NORMAL" | "FAST";
export type GovernanceBalanceState = "LOCKED" | "PRESSURED" | "BALANCED" | "RECOVERING" | "OPPORTUNISTIC";

export type GovernanceBalanceSummary = {
  schema_version: "governance-balance/v3";
  generated_at_iso: string;
  state: GovernanceBalanceState;
  action: GovernanceBalanceAction;
  cadence: GovernanceBalanceCadence;
  risk_state: GovernanceBalanceState;
  execution_state: "HALTED" | "DEFENSIVE" | "CONTROLLED" | "ACCELERATING";
  cadence_state: GovernanceBalanceCadence;
  recovery_state: RecoveryMomentumSummary["state"];
  reacceleration_state: ReaccelerationGovernanceSummary["state"];
  protection_pressure_pct: number;
  opportunity_pressure_pct: number;
  confidence_recovery_pct: number;
  risk_reacceleration_pct: number;
  governance_inertia_pct: number;
  freeze_drag_pct: number;
  recovery_momentum_pct: number;
  aggression_budget_pct: number;
  cadence_budget_pct: number;
  exposure_budget_pct: number;
  routing_aggressiveness_pct: number;
  venue_diversification_pct: number;
  retry_budget_pct: number;
  exploration_budget_pct: number;
  recovery_velocity_pct: number;
  reacceleration_velocity_pct: number;
  reacceleration_readiness_pct: number;
  multiplier: number;
  allowed_exposure_pct: number;
  allow_new_risk: boolean;
  review_required: boolean;
  no_trade: boolean;
  reaccelerate: boolean;
  pressure_normalization: PressureNormalizationSummary;
  aggression_budget: AggressionBudgetEngineSummary;
  governance_inertia_memory: GovernanceInertiaMemorySummary;
  reacceleration_governance: ReaccelerationGovernanceSummary;
  summary_label: string;
  reasons: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function asPct(value: number): number {
  return Math.round(clamp(value, 0, 1) * 100);
}

export function buildGovernanceBalanceSummary(input: {
  intentScore: number;
  executionQuality: number;
  attentionScore: number;
  temporalSizing?: ExecutionRealityTemporalSizingSummary | null;
  executionTca?: ExecutionTcaFoundationSummary | null;
  executionRealityMemory?: ExecutionRealityMemorySnapshot | null;
  capitalScar?: CapitalScarMemorySummary | null;
  venueDecayMemory?: VenueDecayMemorySummary | null;
  capitalAgingGovernance?: CapitalAgingGovernanceSummary | null;
  contagionMemory?: ContagionMemorySummary | null;
  globalConfidenceDecay?: GlobalConfidenceDecaySummary | null;
  recoveryMomentum?: RecoveryMomentumSummary | null;
  crossMarket?: CrossMarketTruthSummary | null;
  governanceReplayTimeline?: GovernanceReplayDetailedTimelineStep[] | null;
  hardBlock?: boolean;
  nowMs?: number;
}): GovernanceBalanceSummary {
  const temporalPressure = input.temporalSizing?.state === "LOCKED"
    ? 100
    : input.temporalSizing?.state === "TIGHT"
      ? 76
      : input.temporalSizing?.state === "CAUTION"
        ? 42
        : 12;
  const tcaPressure = input.executionTca?.state === "BLOCKED"
    ? 100
    : input.executionTca?.state === "FRICTION"
      ? 74
      : input.executionTca?.state === "WATCH"
        ? 42
        : 10;
  const venuePressure = input.venueDecayMemory?.pressure_pct ?? 0;
  const agingPressure = input.capitalAgingGovernance?.pressure_pct ?? 0;
  const contagionPressure = input.contagionMemory?.pressure_pct ?? 0;
  const confidenceDecayPressure = input.globalConfidenceDecay?.pressure_pct ?? 0;
  const memoryPressure = input.executionRealityMemory
    ? input.executionRealityMemory.memory_state === "LOCKDOWN"
      ? 100
      : input.executionRealityMemory.memory_state === "PERSISTENT"
        ? 68
        : input.executionRealityMemory.memory_state === "RECOVERING"
          ? 34
          : input.executionRealityMemory.memory_state === "EPISODIC"
            ? 28
            : 10
    : 18;
  const scarPressure = input.capitalScar?.pressure_bias_pct ?? 0;

  const protectionAnchorPct = Math.round(clamp(
    temporalPressure * 0.22
      + tcaPressure * 0.2
      + venuePressure * 0.16
      + agingPressure * 0.14
      + contagionPressure * 0.12
      + confidenceDecayPressure * 0.1
      + memoryPressure * 0.06,
    0,
    100,
  ));
  const opportunityAnchorPct = Math.round(clamp(
    asPct(input.intentScore) * 0.36
      + asPct(input.executionQuality) * 0.28
      + asPct(input.attentionScore) * 0.16
      + (input.crossMarket?.state === "CONFIRMED" ? 16 : input.crossMarket?.state === "WATCH" ? 8 : 2)
      + (input.executionTca?.recommended_action === "KEEP" ? 10 : input.executionTca?.recommended_action === "REDUCE" ? 4 : 0),
    0,
    100,
  ));
  const severeProtectiveLayerCount = [
    temporalPressure >= 76,
    tcaPressure >= 74,
    venuePressure >= 72,
    agingPressure >= 55,
    contagionPressure >= 72,
    confidenceDecayPressure >= 66,
    memoryPressure >= 68,
  ].filter(Boolean).length;
  const structuralProtectionBias = severeProtectiveLayerCount >= 3 || input.globalConfidenceDecay?.state === "BLOCKED";
  const pressureNowMs = input.nowMs || Date.now();
  const preliminaryRecoveryPct = Math.round(clamp(
    Math.max(0, opportunityAnchorPct - protectionAnchorPct * 0.18 + asPct(input.attentionScore) * 0.18),
    0,
    100,
  ));
  const selfPreservationPct = input.hardBlock
    ? 100
    : structuralProtectionBias
      ? Math.min(100, protectionAnchorPct + 18)
      : 0;
  const pressureSignals = [
    { key: "hard_block", direction: "PROTECTION" as const, tier: "T0" as const, source_type: "hard_block" as const, raw_pct: input.hardBlock ? 100 : 0, confidence_pct: 100, recency_pct: 100, prior_pct: input.hardBlock ? 100 : 0, persistence_profile: "EXISTENTIAL" as const, first_seen_ms: pressureNowMs - 12 * 60 * 60 * 1000, last_seen_ms: pressureNowMs, observation_count: input.hardBlock ? 6 : 1 },
    { key: "self_preservation", direction: "PROTECTION" as const, tier: "T1" as const, source_type: "self_preservation" as const, raw_pct: selfPreservationPct, confidence_pct: selfPreservationPct > 0 ? 92 : 0, recency_pct: 96, prior_pct: Math.max(selfPreservationPct * 0.82, protectionAnchorPct), persistence_profile: "EXISTENTIAL" as const, first_seen_ms: pressureNowMs - 8 * 60 * 60 * 1000, last_seen_ms: pressureNowMs, observation_count: selfPreservationPct > 0 ? 5 : 1 },
    { key: "structural_guard", direction: "PROTECTION" as const, tier: "T2" as const, source_type: "structural_guard" as const, raw_pct: structuralProtectionBias ? Math.min(100, protectionAnchorPct + 14) : 0, confidence_pct: structuralProtectionBias ? (input.globalConfidenceDecay?.state === "BLOCKED" ? 94 : 86) : 0, recency_pct: 90, prior_pct: protectionAnchorPct, persistence_profile: "STRUCTURAL" as const, first_seen_ms: pressureNowMs - 6 * 60 * 60 * 1000, last_seen_ms: pressureNowMs, observation_count: structuralProtectionBias ? 4 : 1 },
    { key: "temporal", direction: "PROTECTION" as const, tier: "T2" as const, source_type: "temporal" as const, raw_pct: temporalPressure, confidence_pct: 96, recency_pct: 96, prior_pct: Math.max(temporalPressure * 0.82, protectionAnchorPct), persistence_profile: "STRUCTURAL" as const, first_seen_ms: pressureNowMs - 4 * 60 * 60 * 1000, last_seen_ms: pressureNowMs, observation_count: temporalPressure >= 42 ? 4 : 2 },
    { key: "tca", direction: "PROTECTION" as const, tier: "T3" as const, source_type: "execution_tca" as const, raw_pct: tcaPressure, confidence_pct: 94, recency_pct: 94, prior_pct: Math.max(tcaPressure * 0.8, protectionAnchorPct), persistence_profile: "RECENT" as const, first_seen_ms: pressureNowMs - 90 * 60 * 1000, last_seen_ms: pressureNowMs, observation_count: tcaPressure >= 42 ? 3 : 1 },
    { key: "venue", direction: "PROTECTION" as const, tier: "T3" as const, source_type: "venue_decay" as const, raw_pct: venuePressure, confidence_pct: input.venueDecayMemory ? 84 : 56, recency_pct: 76, prior_pct: protectionAnchorPct, persistence_profile: "RECENT" as const, first_seen_ms: pressureNowMs - 2 * 60 * 60 * 1000, last_seen_ms: pressureNowMs, observation_count: input.venueDecayMemory ? 3 : 1 },
    { key: "aging", direction: "PROTECTION" as const, tier: "T3" as const, source_type: "capital_aging" as const, raw_pct: agingPressure, confidence_pct: input.capitalAgingGovernance ? 82 : 52, recency_pct: 72, prior_pct: protectionAnchorPct, persistence_profile: "STRUCTURAL" as const, first_seen_ms: pressureNowMs - 12 * 60 * 60 * 1000, last_seen_ms: pressureNowMs, observation_count: input.capitalAgingGovernance ? 4 : 1 },
    { key: "contagion", direction: "PROTECTION" as const, tier: "T3" as const, source_type: "contagion" as const, raw_pct: contagionPressure, confidence_pct: input.contagionMemory ? 80 : 50, recency_pct: 74, prior_pct: protectionAnchorPct, persistence_profile: "STRUCTURAL" as const, first_seen_ms: pressureNowMs - 6 * 60 * 60 * 1000, last_seen_ms: pressureNowMs, observation_count: input.contagionMemory ? 4 : 1 },
    { key: "confidence", direction: "PROTECTION" as const, tier: "T3" as const, source_type: "confidence_decay" as const, raw_pct: confidenceDecayPressure, confidence_pct: input.globalConfidenceDecay ? 88 : 58, recency_pct: 86, prior_pct: protectionAnchorPct, persistence_profile: "RECENT" as const, first_seen_ms: pressureNowMs - 2 * 60 * 60 * 1000, last_seen_ms: pressureNowMs, observation_count: input.globalConfidenceDecay ? 3 : 1 },
    { key: "memory", direction: "PROTECTION" as const, tier: "T3" as const, source_type: "execution_memory" as const, raw_pct: memoryPressure, confidence_pct: input.executionRealityMemory ? 82 : 58, recency_pct: 78, prior_pct: protectionAnchorPct, persistence_profile: "STRUCTURAL" as const, first_seen_ms: pressureNowMs - 18 * 60 * 60 * 1000, last_seen_ms: pressureNowMs, observation_count: input.executionRealityMemory ? 4 : 1 },
    { key: "scar", direction: "PROTECTION" as const, tier: "T4" as const, source_type: "capital_scar" as const, raw_pct: scarPressure, confidence_pct: input.capitalScar ? 74 : 48, recency_pct: 68, prior_pct: protectionAnchorPct, persistence_profile: "STRUCTURAL" as const, first_seen_ms: pressureNowMs - 24 * 60 * 60 * 1000, last_seen_ms: pressureNowMs, observation_count: input.capitalScar ? 4 : 1 },
    { key: "recovery", direction: "OPPORTUNITY" as const, tier: "T4" as const, source_type: "recovery" as const, raw_pct: preliminaryRecoveryPct, confidence_pct: input.recoveryMomentum ? 84 : 62, recency_pct: 74, prior_pct: opportunityAnchorPct, persistence_profile: input.recoveryMomentum ? "RECENT" as const : "EPISODIC" as const, first_seen_ms: pressureNowMs - (input.recoveryMomentum ? 2 * 60 * 60 * 1000 : 30 * 60 * 1000), last_seen_ms: pressureNowMs, observation_count: input.recoveryMomentum ? 3 : 1 },
    { key: "execution_quality", direction: "OPPORTUNITY" as const, tier: "T4" as const, source_type: "execution_quality" as const, raw_pct: asPct(input.executionQuality), confidence_pct: input.executionTca?.state === "BLOCKED" ? 28 : input.executionTca?.state === "FRICTION" ? 52 : 84, recency_pct: 82, prior_pct: opportunityAnchorPct, persistence_profile: "RECENT" as const, first_seen_ms: pressureNowMs - 90 * 60 * 1000, last_seen_ms: pressureNowMs, observation_count: 2 },
    { key: "intent", direction: "OPPORTUNITY" as const, tier: "T5" as const, source_type: "intent" as const, raw_pct: asPct(input.intentScore), confidence_pct: 78, recency_pct: 84, prior_pct: opportunityAnchorPct, persistence_profile: "EPISODIC" as const, first_seen_ms: pressureNowMs - 15 * 60 * 1000, last_seen_ms: pressureNowMs, observation_count: 1 },
    { key: "attention", direction: "OPPORTUNITY" as const, tier: "T5" as const, source_type: "attention" as const, raw_pct: asPct(input.attentionScore), confidence_pct: 76, recency_pct: 82, prior_pct: opportunityAnchorPct, persistence_profile: "EPISODIC" as const, first_seen_ms: pressureNowMs - 15 * 60 * 1000, last_seen_ms: pressureNowMs, observation_count: 1 },
    { key: "cross_market", direction: "OPPORTUNITY" as const, tier: "T5" as const, source_type: "cross_market" as const, raw_pct: input.crossMarket?.state === "CONFIRMED" ? 78 : input.crossMarket?.state === "WATCH" ? 56 : 20, confidence_pct: input.crossMarket?.state === "CONFIRMED" ? 80 : input.crossMarket?.state === "WATCH" ? 66 : 40, recency_pct: 72, prior_pct: opportunityAnchorPct, persistence_profile: "RECENT" as const, first_seen_ms: pressureNowMs - 60 * 60 * 1000, last_seen_ms: pressureNowMs, observation_count: input.crossMarket?.state === "CONFIRMED" ? 3 : 1 },
    { key: "tca_path", direction: "OPPORTUNITY" as const, tier: "T5" as const, source_type: "tca_path" as const, raw_pct: input.executionTca?.recommended_action === "KEEP" ? 72 : input.executionTca?.recommended_action === "REDUCE" ? 34 : 8, confidence_pct: input.executionTca?.recommended_action === "KEEP" ? 76 : 62, recency_pct: 74, prior_pct: opportunityAnchorPct, persistence_profile: "RECENT" as const, first_seen_ms: pressureNowMs - 45 * 60 * 1000, last_seen_ms: pressureNowMs, observation_count: input.executionTca?.recommended_action === "KEEP" ? 2 : 1 },
  ];
  const pressurePersistenceMemory = buildPressurePersistenceMemorySummary({
    signals: pressureSignals.map((signal) => ({
      key: signal.key,
      direction: signal.direction,
      tier: signal.tier,
      source_type: signal.source_type,
      raw_pct: signal.raw_pct,
      profile: signal.persistence_profile,
      first_seen_ms: signal.first_seen_ms,
      last_seen_ms: signal.last_seen_ms,
      observation_count: signal.observation_count,
    })),
    nowMs: pressureNowMs,
  });
  const pressureNormalization = buildPressureNormalizationSummary({
    nowMs: pressureNowMs,
    signals: pressureSignals,
    persistenceMemory: pressurePersistenceMemory,
  });
  const protectionPressurePct = structuralProtectionBias
    ? Math.max(pressureNormalization.normalized_protection_pct, Math.max(0, protectionAnchorPct - 6))
    : pressureNormalization.normalized_protection_pct;
  const opportunityPressurePct = structuralProtectionBias
    ? Math.min(
      pressureNormalization.normalized_opportunity_pct,
      Math.max(0, opportunityAnchorPct - severeProtectiveLayerCount * 4 - (input.globalConfidenceDecay?.state === "BLOCKED" ? 8 : 0)),
    )
    : pressureNormalization.normalized_opportunity_pct;

  const confidenceRecoveryPct = input.recoveryMomentum?.confidence_recovery_pct
    ?? Math.round(clamp(((100 - protectionPressurePct) * 0.42 + opportunityPressurePct * 0.26), 0, 100));
  const riskReaccelerationPct = input.recoveryMomentum?.risk_reacceleration_pct
    ?? Math.round(clamp(opportunityPressurePct * 0.54 - protectionPressurePct * 0.22 + confidenceRecoveryPct * 0.18, 0, 100));
  const recoveryMomentumPct = input.recoveryMomentum?.recovery_momentum_pct
    ?? Math.round(clamp(confidenceRecoveryPct * 0.6 + riskReaccelerationPct * 0.4, 0, 100));
  const governanceInertiaMemory = buildGovernanceInertiaMemorySummary({
    temporalPressure,
    tcaPressure,
    venuePressure,
    agingPressure,
    contagionPressure,
    confidenceDecayPressure,
    memoryPressure,
    scarPressure,
    timeline: input.governanceReplayTimeline,
    falseRecoveryRiskPct: input.recoveryMomentum?.false_recovery_risk_pct,
    nowMs: input.nowMs,
  });
  const governanceInertiaPct = governanceInertiaMemory.inertia_pct;
  const freezeDragPct = governanceInertiaMemory.freeze_drag_pct;
  const reaccelerationGovernance = buildReaccelerationGovernanceSummary({
    protectionPressurePct,
    opportunityPressurePct,
    confidenceRecoveryPct,
    recoveryMomentumPct,
    riskReaccelerationPct,
    falseRecoveryRiskPct: input.recoveryMomentum?.false_recovery_risk_pct ?? 0,
    governanceInertiaMemory,
    hardBlock: input.hardBlock,
    nowMs: input.nowMs,
  });

  const locked = input.hardBlock
    || temporalPressure >= 100
    || tcaPressure >= 100
    || (input.globalConfidenceDecay?.state === "BLOCKED" && (venuePressure >= 72 || contagionPressure >= 72 || agingPressure >= 55))
    || (protectionPressurePct >= 86 && recoveryMomentumPct < 55)
    || governanceInertiaMemory.state === "LOCKED";
  const pressured = !locked && (
    protectionPressurePct >= 60
    || freezeDragPct >= 46
    || input.globalConfidenceDecay?.state === "DEFENSIVE"
    || input.executionTca?.state === "FRICTION"
    || input.temporalSizing?.state === "TIGHT"
    || input.capitalAgingGovernance?.state === "STALE"
  );
  const recovering = !locked && !pressured && recoveryMomentumPct >= 52 && confidenceRecoveryPct >= 54;
  const opportunistic = !locked
    && !pressured
    && reaccelerationGovernance.reacceleration_eligible
    && reaccelerationGovernance.aggression_budget_pct >= 64
    && reaccelerationGovernance.state !== "OVEREXTENDED";

  const state: GovernanceBalanceState = locked
    ? "LOCKED"
    : pressured
      ? "PRESSURED"
      : opportunistic
        ? "OPPORTUNISTIC"
        : recovering
          ? "RECOVERING"
          : "BALANCED";
  const action: GovernanceBalanceAction = state === "LOCKED"
    ? "PROTECT"
    : state === "PRESSURED"
      ? (confidenceRecoveryPct >= 42 || reaccelerationGovernance.readiness_pct >= 38 || opportunityPressurePct >= protectionPressurePct - 6 ? "STABILIZE" : "REDUCE")
      : state === "RECOVERING"
        ? "STABILIZE"
        : state === "OPPORTUNISTIC"
          ? "REACCELERATE"
          : recoveryMomentumPct >= 40
            ? "RESUME"
            : "OBSERVE";
  const cadence: GovernanceBalanceCadence = state === "LOCKED"
    ? "HALT"
    : action === "REDUCE"
      ? "REVIEW"
      : action === "STABILIZE"
        ? "SLOW"
        : action === "REACCELERATE"
          ? "FAST"
          : reaccelerationGovernance.cadence_budget_pct >= 52
            ? "NORMAL"
            : "REVIEW";
  const aggressionBudget = buildAggressionBudgetEngineSummary({
    state,
    action,
    cadence,
    pressure: pressureNormalization,
    confidenceRecoveryPct,
    recoveryMomentumPct,
    riskReaccelerationPct,
    governanceInertiaPct,
    freezeDragPct,
    reaccelerationReadinessPct: reaccelerationGovernance.readiness_pct,
    falseRecoveryRiskPct: input.recoveryMomentum?.false_recovery_risk_pct ?? 0,
    baseAggressionBudgetPct: reaccelerationGovernance.aggression_budget_pct,
    baseCadenceBudgetPct: reaccelerationGovernance.cadence_budget_pct,
    baseExposureBudgetPct: reaccelerationGovernance.exposure_budget_pct,
    reaccelerationEligible: reaccelerationGovernance.reacceleration_eligible,
    nowMs: input.nowMs,
  });
  const multiplier = aggressionBudget.multiplier;
  const allowedExposurePct = aggressionBudget.allowed_exposure_pct;
  const reviewRequired = state === "LOCKED"
    || action === "REDUCE"
    || governanceInertiaPct >= 58
    || pressureNormalization.arbitration_state === "CONFLICTED"
    || pressureNormalization.unresolved_conflicts.length > 0;
  const noTrade = state === "LOCKED" || aggressionBudget.allowed_exposure_pct === 0;
  const reaccelerate = action === "REACCELERATE"
    && reaccelerationGovernance.reacceleration_eligible
    && aggressionBudget.recovery_velocity_pct >= 48;
  const executionState: GovernanceBalanceSummary["execution_state"] = state === "LOCKED"
    ? "HALTED"
    : action === "REDUCE" || action === "OBSERVE"
      ? "DEFENSIVE"
      : action === "REACCELERATE"
        ? "ACCELERATING"
        : "CONTROLLED";

  return {
    schema_version: "governance-balance/v3",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    state,
    action,
    cadence,
    risk_state: state,
    execution_state: executionState,
    cadence_state: cadence,
    recovery_state: input.recoveryMomentum?.state || (recovering ? "VALIDATING" : "FORMING"),
    reacceleration_state: reaccelerationGovernance.state,
    protection_pressure_pct: protectionPressurePct,
    opportunity_pressure_pct: opportunityPressurePct,
    confidence_recovery_pct: confidenceRecoveryPct,
    risk_reacceleration_pct: riskReaccelerationPct,
    governance_inertia_pct: governanceInertiaPct,
    freeze_drag_pct: freezeDragPct,
    recovery_momentum_pct: recoveryMomentumPct,
    aggression_budget_pct: aggressionBudget.aggression_budget_pct,
    cadence_budget_pct: aggressionBudget.cadence_budget_pct,
    exposure_budget_pct: aggressionBudget.exposure_budget_pct,
    routing_aggressiveness_pct: aggressionBudget.routing_aggressiveness_pct,
    venue_diversification_pct: aggressionBudget.venue_diversification_pct,
    retry_budget_pct: aggressionBudget.retry_budget_pct,
    exploration_budget_pct: aggressionBudget.exploration_budget_pct,
    recovery_velocity_pct: aggressionBudget.recovery_velocity_pct,
    reacceleration_velocity_pct: aggressionBudget.reacceleration_velocity_pct,
    reacceleration_readiness_pct: reaccelerationGovernance.readiness_pct,
    multiplier: Number(multiplier.toFixed(3)),
    allowed_exposure_pct: allowedExposurePct,
    allow_new_risk: !noTrade && action !== "REDUCE" && aggressionBudget.exposure_budget_pct >= 36 && aggressionBudget.exploration_budget_pct >= 12,
    review_required: reviewRequired,
    no_trade: noTrade,
    reaccelerate,
    pressure_normalization: pressureNormalization,
    aggression_budget: aggressionBudget,
    governance_inertia_memory: governanceInertiaMemory,
    reacceleration_governance: reaccelerationGovernance,
    summary_label: `GOV ${state} ${action} ${pressureNormalization.winning_tier} x${multiplier.toFixed(2)} · aggr ${aggressionBudget.aggression_budget_pct}%`,
    reasons: dedupe([
      `governance_balance_state:${state.toLowerCase()}`,
      `governance_balance_action:${action.toLowerCase()}`,
      protectionPressurePct >= 56 ? `governance_balance_protection:${protectionPressurePct}pct` : "",
      opportunityPressurePct >= 56 ? `governance_balance_opportunity:${opportunityPressurePct}pct` : "",
      confidenceRecoveryPct >= 50 ? `governance_balance_confidence_recovery:${confidenceRecoveryPct}pct` : "",
      riskReaccelerationPct >= 50 ? `governance_balance_reacceleration:${riskReaccelerationPct}pct` : "",
      governanceInertiaPct >= 40 ? `governance_balance_inertia:${governanceInertiaPct}pct` : "",
      freezeDragPct >= 36 ? `governance_balance_freeze_drag:${freezeDragPct}pct` : "",
      reaccelerationGovernance.readiness_pct >= 45 ? `governance_balance_reacceleration_readiness:${reaccelerationGovernance.readiness_pct}pct` : "",
      aggressionBudget.retry_budget_pct >= 30 ? `governance_balance_retry_budget:${aggressionBudget.retry_budget_pct}pct` : "",
      aggressionBudget.exploration_budget_pct >= 24 ? `governance_balance_exploration_budget:${aggressionBudget.exploration_budget_pct}pct` : "",
      aggressionBudget.aggression_budget_pct >= 45 ? `governance_balance_aggression_budget:${aggressionBudget.aggression_budget_pct}pct` : "",
      reaccelerate ? "governance_balance_reaccelerate_open" : "",
      noTrade ? "governance_balance_no_trade" : "",
      ...pressureNormalization.reasons,
      ...aggressionBudget.reasons,
      ...governanceInertiaMemory.reasons,
      ...reaccelerationGovernance.reasons,
    ]),
  };
}