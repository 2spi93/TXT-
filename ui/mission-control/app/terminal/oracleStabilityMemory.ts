import type { FinalDecisionTruth } from "./finalDecisionTruth";

export type OracleStabilityState = "STABLE" | "WATCH" | "BLOCKED";
export type OracleStabilityDivergenceFamily = "NONE" | "TRUTH_SYNC" | "CROSS_MARKET" | "EXECUTION_LOCK";

export type OracleStabilitySnapshot = {
  oracle_state: OracleStabilityState;
  regime: string;
  blocking_layer: string;
  false_context_family: string;
  dominant_reason: string;
  cross_market_state: string;
  market_truth_state: string;
  information_density_state: string;
  divergence_family: OracleStabilityDivergenceFamily;
  instability_score_pct: number;
  should_trade: boolean;
  execution_allowed: boolean;
};

export type OracleStabilityMemoryEvent = {
  journal_action: "oracle-stability-episode" | "oracle-stability-recovery";
  detail_label: string;
  payload: {
    oracle_stability_memory: {
      episode_type: "INSTABILITY" | "RECOVERY";
      oracle_fingerprint: string;
      venue: string;
      route_mode: string;
      regime: string;
      oracle_state: OracleStabilityState;
      previous_oracle_state: OracleStabilityState | null;
      market_truth_state: string;
      information_density_state: string;
      cross_market_state: string;
      blocking_layer: string;
      previous_blocking_layer: string | null;
      false_context_family: string;
      dominant_reason: string;
      divergence_family: OracleStabilityDivergenceFamily;
      instability_score_pct: number;
      should_trade: boolean;
      execution_allowed: boolean;
      precursor_context: {
        regime: string;
        oracle_state: OracleStabilityState;
        blocking_layer: string;
        divergence_family: OracleStabilityDivergenceFamily;
        instability_score_pct: number;
      } | null;
      recovery_outcome: {
        state: OracleStabilityState;
        admissibility: "ADMISSIBLE" | "WATCH" | "BLOCKED";
      } | null;
      evidence: {
        truth_reasons: string[];
        cross_market_reasons: string[];
        false_context_reasons: string[];
        execution_lock_active: boolean;
      };
    };
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toAdmissibility(snapshot: OracleStabilitySnapshot): "ADMISSIBLE" | "WATCH" | "BLOCKED" {
  if (!snapshot.execution_allowed) {
    return "BLOCKED";
  }
  return snapshot.should_trade ? "ADMISSIBLE" : "WATCH";
}

export function buildOracleStabilitySnapshot(input: {
  finalDecisionTruth: FinalDecisionTruth;
  volatilityRegime: string;
  executionLockActive: boolean;
}): OracleStabilitySnapshot {
  const { finalDecisionTruth, volatilityRegime, executionLockActive } = input;
  const crossMarketState = finalDecisionTruth.cross_market?.state || "UNAVAILABLE";
  const marketTruthState = finalDecisionTruth.market_truth.state;
  const informationDensityState = finalDecisionTruth.information_density.state;
  const falseContextFamily = finalDecisionTruth.false_context.family || "NONE";
  const blockingLayer = finalDecisionTruth.blocking_layer || "none";
  const dominantReason = finalDecisionTruth.false_context.reasons[0]
    || finalDecisionTruth.market_truth.reasons[0]
    || finalDecisionTruth.cross_market?.reasons[0]
    || finalDecisionTruth.reasons[0]
    || "none";
  const oracleState: OracleStabilityState = !finalDecisionTruth.execution_allowed
    ? "BLOCKED"
    : !finalDecisionTruth.should_trade
      ? "WATCH"
      : "STABLE";
  const divergenceFamily: OracleStabilityDivergenceFamily = falseContextFamily === "FALSE_SYNC"
    ? "TRUTH_SYNC"
    : crossMarketState === "INCOHERENT"
      ? "CROSS_MARKET"
      : executionLockActive
        ? "EXECUTION_LOCK"
        : "NONE";
  const instabilityScorePct = Math.max(
    clamp(100 - finalDecisionTruth.market_truth.score_pct, 0, 100),
    informationDensityState === "DEGRADED" ? 78 : informationDensityState === "THIN" ? 48 : 0,
    crossMarketState === "INCOHERENT" ? 74 : crossMarketState === "WATCH" ? 46 : 0,
    finalDecisionTruth.false_context.no_trade ? 86 : falseContextFamily !== "NONE" ? 58 : 0,
    executionLockActive ? 82 : 0,
  );

  return {
    oracle_state: oracleState,
    regime: String(volatilityRegime || "unknown").trim().toUpperCase() || "UNKNOWN",
    blocking_layer: blockingLayer,
    false_context_family: falseContextFamily,
    dominant_reason: dominantReason,
    cross_market_state: crossMarketState,
    market_truth_state: marketTruthState,
    information_density_state: informationDensityState,
    divergence_family: divergenceFamily,
    instability_score_pct: instabilityScorePct,
    should_trade: finalDecisionTruth.should_trade,
    execution_allowed: finalDecisionTruth.execution_allowed,
  };
}

export function buildOracleStabilityMemoryEvent(input: {
  previous: OracleStabilitySnapshot | null;
  current: OracleStabilitySnapshot;
  finalDecisionTruth: FinalDecisionTruth;
  executionLockActive: boolean;
}): OracleStabilityMemoryEvent | null {
  const { previous, current, finalDecisionTruth, executionLockActive } = input;
  if (!previous && current.oracle_state === "STABLE") {
    return null;
  }
  if (previous) {
    const changed = previous.oracle_state !== current.oracle_state
      || previous.blocking_layer !== current.blocking_layer
      || previous.false_context_family !== current.false_context_family
      || previous.cross_market_state !== current.cross_market_state
      || previous.market_truth_state !== current.market_truth_state
      || previous.information_density_state !== current.information_density_state
      || previous.divergence_family !== current.divergence_family
      || Math.abs(previous.instability_score_pct - current.instability_score_pct) >= 10;
    if (!changed) {
      return null;
    }
  }

  const recovery = previous !== null
    && previous.oracle_state !== "STABLE"
    && current.oracle_state === "STABLE";
  const detailLabel = recovery
    ? `Oracle recovery ${current.regime} · ${current.market_truth_state} · trade ${current.should_trade ? "enabled" : "watch"}`
    : `Oracle ${current.oracle_state} ${current.regime} · ${current.blocking_layer} · ${current.dominant_reason}`;

  return {
    journal_action: recovery ? "oracle-stability-recovery" : "oracle-stability-episode",
    detail_label: detailLabel,
    payload: {
      oracle_stability_memory: {
        episode_type: recovery ? "RECOVERY" : "INSTABILITY",
        oracle_fingerprint: finalDecisionTruth.oracle_fingerprint,
        venue: finalDecisionTruth.preferred_venue || "MULTI",
        route_mode: finalDecisionTruth.route_mode,
        regime: current.regime,
        oracle_state: current.oracle_state,
        previous_oracle_state: previous?.oracle_state || null,
        market_truth_state: current.market_truth_state,
        information_density_state: current.information_density_state,
        cross_market_state: current.cross_market_state,
        blocking_layer: current.blocking_layer,
        previous_blocking_layer: previous?.blocking_layer || null,
        false_context_family: current.false_context_family,
        dominant_reason: current.dominant_reason,
        divergence_family: current.divergence_family,
        instability_score_pct: current.instability_score_pct,
        should_trade: current.should_trade,
        execution_allowed: current.execution_allowed,
        precursor_context: previous
          ? {
              regime: previous.regime,
              oracle_state: previous.oracle_state,
              blocking_layer: previous.blocking_layer,
              divergence_family: previous.divergence_family,
              instability_score_pct: previous.instability_score_pct,
            }
          : null,
        recovery_outcome: recovery
          ? {
              state: current.oracle_state,
              admissibility: toAdmissibility(current),
            }
          : null,
        evidence: {
          truth_reasons: finalDecisionTruth.market_truth.reasons,
          cross_market_reasons: finalDecisionTruth.cross_market?.reasons || [],
          false_context_reasons: finalDecisionTruth.false_context.reasons,
          execution_lock_active: executionLockActive,
        },
      },
    },
  };
}