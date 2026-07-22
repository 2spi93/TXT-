import type { CapitalAgingGovernanceSummary } from "./capitalAgingGovernance";
import type { ContagionMemorySummary } from "./contagionMemory";
import type { VenueDecayMemorySummary } from "./venueDecayMemory";

export type GlobalConfidenceDecayState = "STABLE" | "DECAYING" | "DEFENSIVE" | "BLOCKED";
export type GlobalConfidenceDecayAction = "KEEP" | "REDUCE" | "BLOCK";

export type GlobalConfidenceDecaySummary = {
  schema_version: "global-confidence-decay/v1";
  generated_at_iso: string;
  state: GlobalConfidenceDecayState;
  recommended_action: GlobalConfidenceDecayAction;
  pressure_pct: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  trajectory: "IMPROVING" | "STABLE" | "WORSENING";
  recovery_signal_pct: number;
  decay_factor: number;
  base_score: number;
  bayes_score: number;
  effective_score: number;
  effective_score_full: number;
  confidence_decay: number;
  micro_decay: number;
  total_decay: number;
  summary_label: string;
  reasons: string[];
  components: {
    latency_decay: number;
    volatility_decay: number;
    consensus_decay: number;
    venue_decay: number;
    capital_decay: number;
    contagion_decay: number;
    spread_decay: number;
    imbalance_decay: number;
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function stateDecay(state: string, watch: number, elevated: number, blocked: number): number {
  if (state === "LOCKED" || state === "SYSTEMIC") {
    return blocked;
  }
  if (state === "DECAYED" || state === "STALE" || state === "ELEVATED") {
    return elevated;
  }
  if (state === "WATCH" || state === "AGED") {
    return watch;
  }
  return 0;
}

export function buildGlobalConfidenceDecaySummary(input: {
  adjustedScore: number;
  adjustedScoreBayes: number;
  overlayDecisionConsensus: number;
  weightedConsensus: number | null;
  overlayDecisionRegime: string;
  replayLatencyMs: number;
  microSpreadBps: number;
  microImbalance: number;
  venueDecayMemory: VenueDecayMemorySummary;
  capitalAgingGovernance: CapitalAgingGovernanceSummary;
  contagionMemory: ContagionMemorySummary;
  nowMs?: number;
}): GlobalConfidenceDecaySummary {
  const latencyDecay = input.replayLatencyMs > 300 ? 0.08 : input.replayLatencyMs > 200 ? 0.04 : 0;
  const volatilityDecay = /high|extreme|shock/i.test(input.overlayDecisionRegime) ? 0.06 : /elevated|volatile/i.test(input.overlayDecisionRegime) ? 0.03 : 0;
  const weakestConsensus = input.weightedConsensus === null
    ? input.overlayDecisionConsensus
    : Math.min(input.overlayDecisionConsensus, input.weightedConsensus);
  const consensusDecay = weakestConsensus > 0 && weakestConsensus < 40
    ? 0.05
    : weakestConsensus > 0 && weakestConsensus < 55
      ? 0.02
      : 0;
  const venueDecay = stateDecay(input.venueDecayMemory.state, 0.04, 0.08, 0.12);
  const capitalDecay = stateDecay(input.capitalAgingGovernance.state, 0.04, 0.08, 0.12);
  const contagionDecay = stateDecay(input.contagionMemory.state, 0.03, 0.06, 0.1);
  const spreadDecay = input.microSpreadBps > 8 ? 0.04 : 0;
  const imbalanceDecay = input.microImbalance > 0.6 ? 0.03 : 0;
  const confidenceDecay = latencyDecay + volatilityDecay + consensusDecay + venueDecay + capitalDecay + contagionDecay;
  const microDecay = spreadDecay + imbalanceDecay;
  const totalDecay = confidenceDecay + microDecay;
  const effectiveScore = Math.max(0, clamp(input.adjustedScore, 0, 1) - confidenceDecay);
  const effectiveScoreFull = Math.max(0, clamp(input.adjustedScoreBayes, 0, 1) - totalDecay);

  const state: GlobalConfidenceDecayState = input.capitalAgingGovernance.block_new_risk || input.venueDecayMemory.state === "LOCKED" || totalDecay >= 0.34
    ? "BLOCKED"
    : totalDecay >= 0.2
      ? "DEFENSIVE"
      : totalDecay >= 0.1
        ? "DECAYING"
        : "STABLE";
  const recommendedAction: GlobalConfidenceDecayAction = state === "BLOCKED"
    ? "BLOCK"
    : state === "DEFENSIVE" || state === "DECAYING"
      ? "REDUCE"
      : "KEEP";
  const pressurePct = Math.round(clamp(totalDecay * 100, 0, 100));
  const severity = state === "BLOCKED"
    ? "EXTREME"
    : state === "DEFENSIVE"
      ? "HIGH"
      : state === "DECAYING"
        ? "MEDIUM"
        : "LOW";
  const trajectory = state === "STABLE"
    ? "IMPROVING"
    : state === "DECAYING"
      ? "STABLE"
      : "WORSENING";
  const recoverySignalPct = Math.round(clamp((effectiveScoreFull * 0.62 + (1 - totalDecay) * 0.38) * 100, 0, 100));
  const decayFactor = Number(clamp(1 - totalDecay, 0, 1).toFixed(3));

  return {
    schema_version: "global-confidence-decay/v1",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    state,
    recommended_action: recommendedAction,
    pressure_pct: pressurePct,
    severity,
    trajectory,
    recovery_signal_pct: recoverySignalPct,
    decay_factor: decayFactor,
    base_score: Number(clamp(input.adjustedScore, 0, 1).toFixed(4)),
    bayes_score: Number(clamp(input.adjustedScoreBayes, 0, 1).toFixed(4)),
    effective_score: Number(effectiveScore.toFixed(4)),
    effective_score_full: Number(effectiveScoreFull.toFixed(4)),
    confidence_decay: Number(confidenceDecay.toFixed(4)),
    micro_decay: Number(microDecay.toFixed(4)),
    total_decay: Number(totalDecay.toFixed(4)),
    summary_label: `CONF ${state} -${Math.round(totalDecay * 100)}pts`,
    reasons: dedupe([
      latencyDecay > 0 ? `global_confidence_latency:${input.replayLatencyMs}ms` : "",
      volatilityDecay > 0 ? `global_confidence_regime:${input.overlayDecisionRegime}` : "",
      consensusDecay > 0 ? `global_confidence_consensus:${Math.round(weakestConsensus)}pct` : "",
      venueDecay > 0 ? `global_confidence_venue:${input.venueDecayMemory.state.toLowerCase()}` : "",
      capitalDecay > 0 ? `global_confidence_capital:${input.capitalAgingGovernance.state.toLowerCase()}` : "",
      contagionDecay > 0 ? `global_confidence_contagion:${input.contagionMemory.state.toLowerCase()}` : "",
      spreadDecay > 0 ? `global_confidence_spread:${input.microSpreadBps.toFixed(2)}bps` : "",
      imbalanceDecay > 0 ? `global_confidence_imbalance:${input.microImbalance.toFixed(2)}` : "",
    ]),
    components: {
      latency_decay: Number(latencyDecay.toFixed(4)),
      volatility_decay: Number(volatilityDecay.toFixed(4)),
      consensus_decay: Number(consensusDecay.toFixed(4)),
      venue_decay: Number(venueDecay.toFixed(4)),
      capital_decay: Number(capitalDecay.toFixed(4)),
      contagion_decay: Number(contagionDecay.toFixed(4)),
      spread_decay: Number(spreadDecay.toFixed(4)),
      imbalance_decay: Number(imbalanceDecay.toFixed(4)),
    },
  };
}