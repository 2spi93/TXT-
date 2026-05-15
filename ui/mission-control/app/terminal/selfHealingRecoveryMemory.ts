import type { SelfHealingSnapshot } from "./institutionalEngine";
import type { FinalDecisionTruth } from "./finalDecisionTruth";
import type { SelfPreservationSummary } from "./selfPreservation";
import type { StabilitySnapshot } from "./stabilityEngine";

export type SelfHealingRecoveryTier = "STABLE" | "FRAGILE" | "REVALIDATING" | "DEGRADED" | "PROTECT" | "LOCKDOWN" | "RECOVERING";

export type SelfHealingRecoverySnapshot = {
  recovery_tier: SelfHealingRecoveryTier;
  regime: string;
  blocking_layer: string;
  dominant_reason: string;
  self_healing_action: string;
  self_healing_drift: string;
  self_preservation_state: string;
  stability_mode: string;
  recovery_confidence_pct: number;
  recovery_fragility_pct: number;
  relapse_probability_pct: number;
  recovery_quality_pct: number;
  adaptive_cooldown_ms: number;
  should_trade: boolean;
  execution_allowed: boolean;
};

export type AdaptiveRecoveryCooldownInput = {
  fragilityScore: number;
  relapseProbabilityScore: number;
  selfHealingAction: SelfHealingSnapshot["action"];
  selfPreservationState: SelfPreservationSummary["state"] | "OPEN";
};

export type SelfHealingRecoveryMemoryEvent = {
  journal_action: "self-healing-recovery-episode" | "self-healing-recovery-revalidation" | "self-healing-recovery-stabilized";
  detail_label: string;
  payload: {
    self_healing_recovery_memory: {
      episode_type: "RECOVERY_TRIGGERED" | "REVALIDATION" | "STABILIZED";
      oracle_fingerprint: string;
      venue: string;
      route_mode: string;
      regime: string;
      recovery_tier: SelfHealingRecoveryTier;
      previous_recovery_tier: SelfHealingRecoveryTier | null;
      blocking_layer: string;
      previous_blocking_layer: string | null;
      self_healing_action: string;
      self_healing_drift: string;
      self_preservation_state: string;
      dominant_reason: string;
      recovery_confidence_pct: number;
      recovery_fragility_pct: number;
      relapse_probability_pct: number;
      recovery_quality_pct: number;
      adaptive_cooldown_ms: number;
      should_trade: boolean;
      execution_allowed: boolean;
      precursor_context: {
        recovery_tier: SelfHealingRecoveryTier;
        blocking_layer: string;
        recovery_confidence_pct: number;
        relapse_probability_pct: number;
      } | null;
      recovery_outcome: {
        tier: SelfHealingRecoveryTier;
        admissibility: "ADMISSIBLE" | "WATCH" | "BLOCKED";
      } | null;
      evidence: {
        final_reasons: string[];
        self_healing_reasons: string[];
        self_preservation_reasons: string[];
        stability_reasons: string[];
      };
    };
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeVolatilityRegime(value: string): string {
  return String(value || "unknown").trim().toUpperCase() || "UNKNOWN";
}

function toAdmissibility(snapshot: SelfHealingRecoverySnapshot): "ADMISSIBLE" | "WATCH" | "BLOCKED" {
  if (!snapshot.execution_allowed) {
    return "BLOCKED";
  }
  return snapshot.should_trade ? "ADMISSIBLE" : "WATCH";
}

export function buildAdaptiveRecoveryCooldown(input: AdaptiveRecoveryCooldownInput): number {
  const fragilityScore = clamp(input.fragilityScore, 0, 1);
  const relapseProbabilityScore = clamp(input.relapseProbabilityScore, 0, 1);
  const cooldownMs = 30_000
    + fragilityScore * 150_000
    + relapseProbabilityScore * 210_000
    + (input.selfHealingAction === "RECOVERY" ? 90_000 : 0)
    + (input.selfPreservationState === "PROTECT" ? 45_000 : input.selfPreservationState === "LOCKDOWN" ? 90_000 : 0);
  return Math.round(cooldownMs / 5_000) * 5_000;
}

export function buildSelfHealingRecoverySnapshot(input: {
  finalDecisionTruth: FinalDecisionTruth;
  selfHealingSnapshot: SelfHealingSnapshot;
  selfPreservation: SelfPreservationSummary | null;
  stabilitySnapshot: StabilitySnapshot;
  volatilityRegime: string;
}): SelfHealingRecoverySnapshot {
  const { finalDecisionTruth, selfHealingSnapshot, selfPreservation, stabilitySnapshot } = input;
  const regime = normalizeVolatilityRegime(input.volatilityRegime);
  const blockingLayer = finalDecisionTruth.blocking_layer || "none";
  const selfPreservationState = selfPreservation?.state || "OPEN";
  const dominantReason = selfPreservation?.reasons[0]
    || selfHealingSnapshot.reasons[0]
    || stabilitySnapshot.reasons[0]
    || finalDecisionTruth.reasons[0]
    || "none";
  const executionQualityScore = clamp(finalDecisionTruth.market_truth.metrics.execution_quality_pct / 100, 0, 1);
  const marketTruthScore = clamp(finalDecisionTruth.market_truth.score_pct / 100, 0, 1);
  const qualityScore = clamp(
    stabilitySnapshot.monitorScore * 0.34
      + clamp(selfHealingSnapshot.adaptSpeed, 0, 1) * 0.22
      + executionQualityScore * 0.18
      + marketTruthScore * 0.14
      + (selfHealingSnapshot.executionEnabled ? 0.12 : 0.02),
    0,
    1,
  );
  const fragilityScore = clamp(
    clamp(1 - qualityScore, 0, 1) * 0.38
      + (selfHealingSnapshot.drift === "LOSS_SPIRAL" ? 0.3 : selfHealingSnapshot.drift === "EXECUTION_DRIFT" ? 0.18 : 0.04)
      + (selfPreservationState === "LOCKDOWN" ? 0.32 : selfPreservationState === "PROTECT" ? 0.2 : selfPreservationState === "DEFENSIVE" ? 0.12 : selfPreservationState === "GUARDED" ? 0.06 : 0)
      + (!finalDecisionTruth.execution_allowed ? 0.14 : !finalDecisionTruth.should_trade ? 0.07 : 0)
      + (stabilitySnapshot.driftWatchdog === "CRITICAL" ? 0.2 : stabilitySnapshot.driftWatchdog === "DRIFT" ? 0.12 : stabilitySnapshot.driftWatchdog === "WATCH" ? 0.06 : 0),
    0,
    1,
  );
  const recoveryConfidenceScore = clamp(
    qualityScore * 0.68
      + (selfHealingSnapshot.action === "SAFE" ? 0.16 : selfHealingSnapshot.action === "LIMIT_TRADING" ? 0.08 : 0.02)
      + (selfPreservationState === "OPEN" ? 0.08 : selfPreservationState === "GUARDED" ? 0.04 : 0)
      - fragilityScore * 0.18,
    0,
    1,
  );
  const regimeStress = regime === "CHAOS" || regime === "PANIC"
    ? 0.18
    : regime === "BREAKOUT" || regime === "VOLATILE"
      ? 0.1
      : regime === "TREND"
        ? 0.04
        : 0.06;
  const relapseProbabilityScore = clamp(
    fragilityScore * 0.62
      + (selfHealingSnapshot.drift === "LOSS_SPIRAL" ? 0.22 : selfHealingSnapshot.drift === "EXECUTION_DRIFT" ? 0.12 : 0.02)
      + (!finalDecisionTruth.execution_allowed ? 0.14 : !finalDecisionTruth.should_trade ? 0.07 : 0)
      + regimeStress,
    0,
    1,
  );
  const adaptiveCooldownMs = buildAdaptiveRecoveryCooldown({
    fragilityScore,
    relapseProbabilityScore,
    selfHealingAction: selfHealingSnapshot.action,
    selfPreservationState,
  });

  const recoveryTier: SelfHealingRecoveryTier = selfHealingSnapshot.action === "RECOVERY" || !selfHealingSnapshot.executionEnabled
    ? "RECOVERING"
    : selfPreservation?.blocks_execution || stabilitySnapshot.shouldBlockExecution || blockingLayer === "self_preservation"
      ? "LOCKDOWN"
      : selfPreservationState === "PROTECT"
        ? "PROTECT"
        : stabilitySnapshot.mode === "halted" || selfHealingSnapshot.drift === "LOSS_SPIRAL" || fragilityScore >= 0.72
          ? "DEGRADED"
          : !finalDecisionTruth.should_trade || selfPreservationState === "DEFENSIVE" || selfHealingSnapshot.action === "LIMIT_TRADING"
            ? "REVALIDATING"
            : fragilityScore >= 0.46 || stabilitySnapshot.mode === "guarded" || stabilitySnapshot.mode === "shadow" || stabilitySnapshot.driftWatchdog !== "CALM"
              ? "FRAGILE"
              : "STABLE";

  return {
    recovery_tier: recoveryTier,
    regime,
    blocking_layer: blockingLayer,
    dominant_reason: dominantReason,
    self_healing_action: selfHealingSnapshot.action,
    self_healing_drift: selfHealingSnapshot.drift,
    self_preservation_state: selfPreservationState,
    stability_mode: stabilitySnapshot.mode,
    recovery_confidence_pct: Math.round(recoveryConfidenceScore * 100),
    recovery_fragility_pct: Math.round(fragilityScore * 100),
    relapse_probability_pct: Math.round(relapseProbabilityScore * 100),
    recovery_quality_pct: Math.round(qualityScore * 100),
    adaptive_cooldown_ms: adaptiveCooldownMs,
    should_trade: finalDecisionTruth.should_trade,
    execution_allowed: finalDecisionTruth.execution_allowed,
  };
}

export function buildSelfHealingRecoveryMemoryEvent(input: {
  previous: SelfHealingRecoverySnapshot | null;
  current: SelfHealingRecoverySnapshot;
  finalDecisionTruth: FinalDecisionTruth;
  selfHealingSnapshot: SelfHealingSnapshot;
  selfPreservation: SelfPreservationSummary | null;
  stabilitySnapshot: StabilitySnapshot;
}): SelfHealingRecoveryMemoryEvent | null {
  const { previous, current, finalDecisionTruth, selfHealingSnapshot, selfPreservation, stabilitySnapshot } = input;
  if (!previous && current.recovery_tier === "STABLE") {
    return null;
  }
  if (previous) {
    const changed = previous.recovery_tier !== current.recovery_tier
      || previous.blocking_layer !== current.blocking_layer
      || Math.abs(previous.recovery_confidence_pct - current.recovery_confidence_pct) >= 8
      || Math.abs(previous.relapse_probability_pct - current.relapse_probability_pct) >= 8
      || Math.abs(previous.adaptive_cooldown_ms - current.adaptive_cooldown_ms) >= 30_000;
    if (!changed) {
      return null;
    }
  }

  const stabilized = previous !== null
    && previous.recovery_tier !== "STABLE"
    && current.recovery_tier === "STABLE";
  const revalidating = current.recovery_tier === "REVALIDATING" || current.recovery_tier === "FRAGILE";
  const journalAction: SelfHealingRecoveryMemoryEvent["journal_action"] = stabilized
    ? "self-healing-recovery-stabilized"
    : revalidating
      ? "self-healing-recovery-revalidation"
      : "self-healing-recovery-episode";
  const episodeType: SelfHealingRecoveryMemoryEvent["payload"]["self_healing_recovery_memory"]["episode_type"] = stabilized
    ? "STABILIZED"
    : revalidating
      ? "REVALIDATION"
      : "RECOVERY_TRIGGERED";
  const detailLabel = stabilized
    ? `Recovery stable ${current.regime} · confidence ${current.recovery_confidence_pct}% · relapse ${current.relapse_probability_pct}%`
    : `Recovery ${current.recovery_tier} ${current.regime} · ${current.blocking_layer} · ${current.dominant_reason}`;

  return {
    journal_action: journalAction,
    detail_label: detailLabel,
    payload: {
      self_healing_recovery_memory: {
        episode_type: episodeType,
        oracle_fingerprint: finalDecisionTruth.oracle_fingerprint,
        venue: finalDecisionTruth.preferred_venue || "MULTI",
        route_mode: finalDecisionTruth.route_mode,
        regime: current.regime,
        recovery_tier: current.recovery_tier,
        previous_recovery_tier: previous?.recovery_tier || null,
        blocking_layer: current.blocking_layer,
        previous_blocking_layer: previous?.blocking_layer || null,
        self_healing_action: current.self_healing_action,
        self_healing_drift: current.self_healing_drift,
        self_preservation_state: current.self_preservation_state,
        dominant_reason: current.dominant_reason,
        recovery_confidence_pct: current.recovery_confidence_pct,
        recovery_fragility_pct: current.recovery_fragility_pct,
        relapse_probability_pct: current.relapse_probability_pct,
        recovery_quality_pct: current.recovery_quality_pct,
        adaptive_cooldown_ms: current.adaptive_cooldown_ms,
        should_trade: current.should_trade,
        execution_allowed: current.execution_allowed,
        precursor_context: previous
          ? {
              recovery_tier: previous.recovery_tier,
              blocking_layer: previous.blocking_layer,
              recovery_confidence_pct: previous.recovery_confidence_pct,
              relapse_probability_pct: previous.relapse_probability_pct,
            }
          : null,
        recovery_outcome: stabilized
          ? {
              tier: current.recovery_tier,
              admissibility: toAdmissibility(current),
            }
          : null,
        evidence: {
          final_reasons: finalDecisionTruth.reasons,
          self_healing_reasons: selfHealingSnapshot.reasons,
          self_preservation_reasons: selfPreservation?.reasons || [],
          stability_reasons: stabilitySnapshot.reasons,
        },
      },
    },
  };
}