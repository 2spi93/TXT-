import type { GovernanceReplayDetailedTimelineStep } from "./governanceReplay";

export type CapitalAgingGovernanceState = "FRESH" | "AGED" | "STALE" | "LOCKED";
export type CapitalAgingGovernanceDriver = "NONE" | "DRAWDOWN" | "EXPOSURE" | "HOLDING_LOAD" | "CAPITAL_REPLAY";

export type CapitalAgingGovernanceSummary = {
  schema_version: "capital-aging-governance/v1";
  generated_at_iso: string;
  state: CapitalAgingGovernanceState;
  dominant_driver: CapitalAgingGovernanceDriver;
  aging_score_pct: number;
  multiplier: number;
  block_new_risk: boolean;
  pressure_pct: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  trajectory: "IMPROVING" | "STABLE" | "WORSENING";
  recovery_signal_pct: number;
  decay_factor: number;
  summary_label: string;
  reasons: string[];
  metrics: {
    drawdown_pct: number;
    exposure_pct: number;
    open_trade_count: number;
    capital_step_count: number;
    unrealized_pnl_pct: number;
    account_free_usd: number;
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildCapitalAgingGovernanceSummary(input: {
  drawdownPct: number;
  exposureRatio: number;
  openTradeCount: number;
  unrealizedPnlPct?: number;
  accountFreeUsd: number;
  governanceReplayTimeline?: GovernanceReplayDetailedTimelineStep[];
  nowMs?: number;
}): CapitalAgingGovernanceSummary {
  const timeline = input.governanceReplayTimeline || [];
  const capitalStepCount = timeline.filter((step) => step.phase === "capital").length;
  const drawdownPct = Math.max(0, input.drawdownPct);
  const exposurePct = clamp(input.exposureRatio * 100, 0, 200);
  const openTradeCount = Math.max(0, Math.round(input.openTradeCount));
  const unrealizedPnlPct = input.unrealizedPnlPct ?? 0;
  const drawdownPenalty = clamp(drawdownPct / 10, 0, 1) * 0.38;
  const exposurePenalty = clamp(exposurePct / 100, 0, 1) * 0.26;
  const holdingPenalty = clamp(openTradeCount / 6, 0, 1) * 0.16;
  const capitalReplayPenalty = clamp(capitalStepCount / 4, 0, 1) * 0.2;
  const unrealizedPenalty = unrealizedPnlPct <= -3 ? clamp(Math.abs(unrealizedPnlPct) / 10, 0, 1) * 0.12 : 0;
  const agingScorePct = Math.round(clamp((drawdownPenalty + exposurePenalty + holdingPenalty + capitalReplayPenalty + unrealizedPenalty) * 100, 0, 100));

  const driverScores: Array<[CapitalAgingGovernanceDriver, number]> = [
    ["DRAWDOWN", drawdownPenalty],
    ["EXPOSURE", exposurePenalty],
    ["HOLDING_LOAD", holdingPenalty + unrealizedPenalty],
    ["CAPITAL_REPLAY", capitalReplayPenalty],
  ];
  const strongest = driverScores.reduce((best, current) => current[1] > best[1] ? current : best, ["NONE", 0] as [CapitalAgingGovernanceDriver, number]);
  const dominantDriver = strongest[1] > 0 ? strongest[0] : "NONE";

  const state: CapitalAgingGovernanceState = drawdownPct >= 8 || exposurePct >= 95 || agingScorePct >= 78
    ? "LOCKED"
    : agingScorePct >= 55
      ? "STALE"
      : agingScorePct >= 28
        ? "AGED"
        : "FRESH";
  const multiplier = state === "LOCKED"
    ? 0
    : state === "STALE"
      ? 0.45
      : state === "AGED"
        ? 0.72
        : 1;
  const severity = state === "LOCKED"
    ? "EXTREME"
    : state === "STALE"
      ? "HIGH"
      : state === "AGED"
        ? "MEDIUM"
        : "LOW";
  const trajectory = state === "FRESH"
    ? "IMPROVING"
    : state === "AGED"
      ? "STABLE"
      : "WORSENING";
  const recoverySignalPct = state === "FRESH"
    ? Math.round(clamp((1 - agingScorePct / 100) * 100, 0, 100))
    : state === "AGED"
      ? Math.round(clamp(68 - agingScorePct * 0.2, 0, 100))
      : Math.round(clamp(42 - agingScorePct * 0.18, 0, 100));
  const decayFactor = Number(clamp(multiplier, 0, 1).toFixed(3));

  return {
    schema_version: "capital-aging-governance/v1",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    state,
    dominant_driver: dominantDriver,
    aging_score_pct: agingScorePct,
    multiplier,
    block_new_risk: state === "LOCKED",
    pressure_pct: agingScorePct,
    severity,
    trajectory,
    recovery_signal_pct: recoverySignalPct,
    decay_factor: decayFactor,
    summary_label: `CAP AGE ${state} ${agingScorePct}%`,
    reasons: dedupe([
      drawdownPct >= 2 ? `capital_aging_drawdown:${drawdownPct.toFixed(2)}pct` : "",
      exposurePct >= 35 ? `capital_aging_exposure:${Math.round(exposurePct)}pct` : "",
      openTradeCount >= 2 ? `capital_aging_open_trades:${openTradeCount}` : "",
      capitalStepCount > 0 ? `capital_aging_replay_steps:${capitalStepCount}` : "",
      unrealizedPnlPct <= -3 ? `capital_aging_unrealized:${unrealizedPnlPct.toFixed(2)}pct` : "",
    ]),
    metrics: {
      drawdown_pct: Number(drawdownPct.toFixed(2)),
      exposure_pct: Number(exposurePct.toFixed(2)),
      open_trade_count: openTradeCount,
      capital_step_count: capitalStepCount,
      unrealized_pnl_pct: Number(unrealizedPnlPct.toFixed(2)),
      account_free_usd: Number(input.accountFreeUsd.toFixed(2)),
    },
  };
}