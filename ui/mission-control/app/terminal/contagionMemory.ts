import type { CrossMarketTruthSummary } from "./crossMarketTruth";

export type ContagionMemoryState = "CLEAR" | "WATCH" | "ELEVATED" | "SYSTEMIC" | "UNAVAILABLE";
export type ContagionMemoryDriver = "NONE" | "COHERENCE" | "HEDGE_PRESSURE" | "NEGATIVE_BREADTH" | "FRESHNESS";

export type ContagionMemorySummary = {
  schema_version: "contagion-memory/v1";
  generated_at_iso: string;
  state: ContagionMemoryState;
  dominant_driver: ContagionMemoryDriver;
  contagion_score_pct: number;
  pressure_pct: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  trajectory: "IMPROVING" | "STABLE" | "WORSENING";
  recovery_signal_pct: number;
  decay_factor: number;
  summary_label: string;
  reasons: string[];
  metrics: {
    coherence_pct: number;
    freshness_pct: number;
    coverage_pct: number;
    negative_risk_count: number;
    hedge_stress_count: number;
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildContagionMemorySummary(input: {
  crossMarket: CrossMarketTruthSummary | null | undefined;
  nowMs?: number;
}): ContagionMemorySummary {
  const crossMarket = input.crossMarket || null;
  if (!crossMarket) {
    return {
      schema_version: "contagion-memory/v1",
      generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
      state: "UNAVAILABLE",
      dominant_driver: "NONE",
      contagion_score_pct: 0,
      pressure_pct: 0,
      severity: "LOW",
      trajectory: "STABLE",
      recovery_signal_pct: 0,
      decay_factor: 1,
      summary_label: "CONTAGION UNAVAILABLE 0%",
      reasons: ["contagion_cross_market_unavailable"],
      metrics: {
        coherence_pct: 0,
        freshness_pct: 0,
        coverage_pct: 0,
        negative_risk_count: 0,
        hedge_stress_count: 0,
      },
    };
  }

  const negativeRiskCount = crossMarket.basket.filter((member) => member.available && member.role !== "hedge" && member.direction === "DOWN").length;
  const hedgeStressCount = crossMarket.basket.filter((member) => member.available && member.role === "hedge" && member.direction === "UP").length;
  const coherencePenalty = clamp((100 - crossMarket.metrics.coherence_pct) / 100, 0, 1) * 0.42;
  const freshnessPenalty = clamp((100 - crossMarket.metrics.freshness_pct) / 100, 0, 1) * 0.12;
  const breadthPenalty = clamp(negativeRiskCount / 4, 0, 1) * 0.28;
  const hedgePenalty = clamp(hedgeStressCount / 3, 0, 1) * 0.18;
  const contagionScorePct = Math.round(clamp((coherencePenalty + freshnessPenalty + breadthPenalty + hedgePenalty) * 100, 0, 100));

  const strongest = ([
    ["COHERENCE", coherencePenalty],
    ["NEGATIVE_BREADTH", breadthPenalty],
    ["HEDGE_PRESSURE", hedgePenalty],
    ["FRESHNESS", freshnessPenalty],
  ] as Array<[ContagionMemoryDriver, number]>).reduce((best, current) => current[1] > best[1] ? current : best, ["NONE", 0] as [ContagionMemoryDriver, number]);
  const dominantDriver = strongest[1] > 0 ? strongest[0] : "NONE";

  const state: ContagionMemoryState = (crossMarket.state === "INCOHERENT" && crossMarket.metrics.coherence_pct <= 35) || contagionScorePct >= 72
    ? "SYSTEMIC"
    : contagionScorePct >= 48 || negativeRiskCount >= 3 || hedgeStressCount >= 2
      ? "ELEVATED"
      : contagionScorePct >= 24 || crossMarket.state === "WATCH"
        ? "WATCH"
        : "CLEAR";
  const severity = state === "SYSTEMIC"
    ? "EXTREME"
    : state === "ELEVATED"
      ? "HIGH"
      : state === "WATCH"
        ? "MEDIUM"
        : "LOW";
  const trajectory = state === "CLEAR"
    ? "IMPROVING"
    : state === "WATCH"
      ? "STABLE"
      : "WORSENING";
  const recoverySignalPct = state === "CLEAR"
    ? Math.round(clamp(crossMarket.metrics.coherence_pct * 0.72 + crossMarket.metrics.freshness_pct * 0.28, 0, 100))
    : state === "WATCH"
      ? Math.round(clamp(crossMarket.metrics.coherence_pct * 0.54 + crossMarket.metrics.freshness_pct * 0.18, 0, 100))
      : Math.round(clamp(crossMarket.metrics.coherence_pct * 0.38 + crossMarket.metrics.freshness_pct * 0.12, 0, 100));
  const decayFactor = Number(clamp(1 - contagionScorePct / 100, 0, 1).toFixed(3));

  return {
    schema_version: "contagion-memory/v1",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    state,
    dominant_driver: dominantDriver,
    contagion_score_pct: contagionScorePct,
    pressure_pct: contagionScorePct,
    severity,
    trajectory,
    recovery_signal_pct: recoverySignalPct,
    decay_factor: decayFactor,
    summary_label: `CONTAGION ${state} ${contagionScorePct}%`,
    reasons: dedupe([
      crossMarket.metrics.coherence_pct < 70 ? `contagion_coherence:${crossMarket.metrics.coherence_pct}pct` : "",
      crossMarket.metrics.freshness_pct < 75 ? `contagion_freshness:${crossMarket.metrics.freshness_pct}pct` : "",
      negativeRiskCount > 0 ? `contagion_negative_breadth:${negativeRiskCount}` : "",
      hedgeStressCount > 0 ? `contagion_hedge_stress:${hedgeStressCount}` : "",
    ]),
    metrics: {
      coherence_pct: crossMarket.metrics.coherence_pct,
      freshness_pct: crossMarket.metrics.freshness_pct,
      coverage_pct: crossMarket.metrics.coverage_pct,
      negative_risk_count: negativeRiskCount,
      hedge_stress_count: hedgeStressCount,
    },
  };
}