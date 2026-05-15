import type { CrossMarketTruthSummary } from "./crossMarketTruth";
import type { ExecutionRealityMemorySnapshot } from "./executionRealityMemory";
import type { ExecutionRealityTemporalSizingSummary } from "./executionRealityTemporalSizing";
import type { ExecutionTcaFoundationSummary } from "./executionTcaFoundation";
import type { GlobalConfidenceDecaySummary } from "./globalConfidenceDecay";
import type { SelfHealingRecoverySnapshot } from "./selfHealingRecoveryMemory";
import type { ContagionMemorySummary } from "./contagionMemory";
import type { VenueDecayMemorySummary } from "./venueDecayMemory";

export type RecoveryMomentumState = "DORMANT" | "FORMING" | "VALIDATING" | "READY" | "REACCELERATING";

export type RecoveryMomentumSummary = {
  schema_version: "recovery-momentum/v1";
  generated_at_iso: string;
  state: RecoveryMomentumState;
  recovery_momentum_pct: number;
  confidence_recovery_pct: number;
  risk_reacceleration_pct: number;
  false_recovery_risk_pct: number;
  recovery_window_open: boolean;
  summary_label: string;
  reasons: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildRecoveryMomentumSummary(input: {
  selfHealingRecovery?: SelfHealingRecoverySnapshot | null;
  executionRealityMemory?: ExecutionRealityMemorySnapshot | null;
  executionRealityTemporalSizing?: ExecutionRealityTemporalSizingSummary | null;
  executionTca?: ExecutionTcaFoundationSummary | null;
  venueDecayMemory?: VenueDecayMemorySummary | null;
  contagionMemory?: ContagionMemorySummary | null;
  globalConfidenceDecay?: GlobalConfidenceDecaySummary | null;
  crossMarket?: CrossMarketTruthSummary | null;
  nowMs?: number;
}): RecoveryMomentumSummary {
  const selfHealingConfidence = input.selfHealingRecovery
    ? clamp(input.selfHealingRecovery.recovery_confidence_pct / 100, 0, 1)
    : 0.42;
  const selfHealingFragility = input.selfHealingRecovery
    ? clamp(input.selfHealingRecovery.recovery_fragility_pct / 100, 0, 1)
    : 0.4;
  const memoryRecovery = input.executionRealityMemory?.memory_state === "RECOVERING"
    ? 0.88
    : input.executionRealityMemory?.memory_state === "CLEAR"
      ? 0.72
      : input.executionRealityMemory?.memory_state === "EPISODIC"
        ? 0.42
        : 0.18;
  const temporalRecovery = input.executionRealityTemporalSizing?.state === "OPEN"
    ? 0.84
    : input.executionRealityTemporalSizing?.state === "CAUTION"
      ? 0.58
      : input.executionRealityTemporalSizing?.state === "TIGHT"
        ? 0.28
        : 0.06;
  const tcaRecovery = input.executionTca?.recommended_action === "KEEP"
    ? 0.82
    : input.executionTca?.recommended_action === "REDUCE"
      ? 0.42
      : 0.08;
  const venueRecovery = input.venueDecayMemory
    ? clamp(input.venueDecayMemory.recovery_signal_pct / 100, 0, 1)
    : 0.55;
  const contagionRecovery = input.contagionMemory
    ? clamp(input.contagionMemory.recovery_signal_pct / 100, 0, 1)
    : 0.52;
  const confidenceRecovery = input.globalConfidenceDecay
    ? clamp(input.globalConfidenceDecay.recovery_signal_pct / 100, 0, 1)
    : 0.56;
  const opportunitySupport = input.crossMarket?.state === "CONFIRMED"
    ? 0.78
    : input.crossMarket?.state === "WATCH"
      ? 0.52
      : 0.24;

  const confidenceRecoveryPct = Math.round(clamp(
    (selfHealingConfidence * 0.34
      + memoryRecovery * 0.16
      + temporalRecovery * 0.12
      + tcaRecovery * 0.1
      + venueRecovery * 0.1
      + contagionRecovery * 0.08
      + confidenceRecovery * 0.1) * 100,
    0,
    100,
  ));
  const falseRecoveryRiskPct = Math.round(clamp(
    ((1 - venueRecovery) * 0.22
      + (1 - contagionRecovery) * 0.2
      + (1 - confidenceRecovery) * 0.18
      + selfHealingFragility * 0.26
      + (input.executionTca?.recommended_action === "BLOCK" ? 0.14 : input.executionTca?.recommended_action === "REDUCE" ? 0.06 : 0)
      + (input.crossMarket?.state === "INCOHERENT" ? 0.12 : 0)) * 100,
    0,
    100,
  ));
  const riskReaccelerationPct = Math.round(clamp(
    confidenceRecoveryPct * 0.42
      + opportunitySupport * 32
      - falseRecoveryRiskPct * 0.36,
    0,
    100,
  ));
  const recoveryMomentumPct = Math.round(clamp(
    confidenceRecoveryPct * 0.46
      + riskReaccelerationPct * 0.34
      + opportunitySupport * 20
      - falseRecoveryRiskPct * 0.3,
    0,
    100,
  ));

  const state: RecoveryMomentumState = recoveryMomentumPct >= 78 && falseRecoveryRiskPct <= 28
    ? "REACCELERATING"
    : recoveryMomentumPct >= 62 && falseRecoveryRiskPct <= 38
      ? "READY"
      : recoveryMomentumPct >= 42
        ? "VALIDATING"
        : recoveryMomentumPct >= 22
          ? "FORMING"
          : "DORMANT";

  return {
    schema_version: "recovery-momentum/v1",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    state,
    recovery_momentum_pct: recoveryMomentumPct,
    confidence_recovery_pct: confidenceRecoveryPct,
    risk_reacceleration_pct: riskReaccelerationPct,
    false_recovery_risk_pct: falseRecoveryRiskPct,
    recovery_window_open: (state === "READY" || state === "REACCELERATING") && falseRecoveryRiskPct < 40,
    summary_label: `RECOVERY ${state} ${recoveryMomentumPct}%`,
    reasons: dedupe([
      confidenceRecoveryPct >= 50 ? `recovery_confidence:${confidenceRecoveryPct}pct` : "",
      riskReaccelerationPct >= 45 ? `recovery_reacceleration:${riskReaccelerationPct}pct` : "",
      falseRecoveryRiskPct >= 35 ? `recovery_false_risk:${falseRecoveryRiskPct}pct` : "",
      input.executionRealityMemory?.memory_state === "RECOVERING" ? "recovery_execution_memory:recovering" : "",
      input.executionRealityTemporalSizing?.state === "OPEN" ? "recovery_temporal:open" : "",
      input.executionTca?.recommended_action === "KEEP" ? "recovery_tca:keep" : "",
      input.crossMarket?.state === "CONFIRMED" ? "recovery_cross_market:confirmed" : "",
    ]),
  };
}