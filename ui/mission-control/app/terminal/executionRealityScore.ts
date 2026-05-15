import type { PnlAnalyticsSnapshot } from "../../lib/pnlEngine";
import type { StabilitySnapshot } from "./stabilityEngine";

export type ExecutionRealityState = "ALIGNED" | "CAUTION" | "DEGRADED" | "HALT";
export type ExecutionRealityDrag = "NONE" | "SLIPPAGE" | "FILL" | "LATENCY" | "LIQUIDITY" | "STABILITY";

export type ExecutionRealitySummary = {
  schema_version?: "execution-reality/v1";
  state: ExecutionRealityState;
  score_pct: number;
  allow_new_risk: boolean;
  blocks_execution: boolean;
  size_cap_pct: number;
  summary_label: string;
  reasons: string[];
  dominant_drag: ExecutionRealityDrag;
  metrics: {
    execution_samples: number;
    liquidity_samples: number;
    slippage_bps: number;
    latency_ms: number;
    fill_rate_pct: number;
    liquidity_accuracy_pct: number;
    stability_mode: StabilitySnapshot["mode"];
    stability_monitor_pct: number;
    drift_watchdog: StabilitySnapshot["driftWatchdog"];
    optimization_action: PnlAnalyticsSnapshot["autoOptimization"]["action"];
  };
};

type BuildExecutionRealitySummaryInput = {
  pnlAnalyticsSnapshot: PnlAnalyticsSnapshot;
  stabilitySnapshot: StabilitySnapshot;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function inferDominantDrag(input: {
  slippagePenalty: number;
  fillPenalty: number;
  latencyPenalty: number;
  liquidityPenalty: number;
  stabilityPenalty: number;
}): ExecutionRealityDrag {
  const entries: Array<[ExecutionRealityDrag, number]> = [
    ["SLIPPAGE", input.slippagePenalty * 0.24],
    ["FILL", input.fillPenalty * 0.24],
    ["LATENCY", input.latencyPenalty * 0.14],
    ["LIQUIDITY", input.liquidityPenalty * 0.14],
    ["STABILITY", input.stabilityPenalty * 0.24],
  ];
  const [drag, penalty] = entries.reduce((best, current) => current[1] > best[1] ? current : best, ["NONE", 0] as [ExecutionRealityDrag, number]);
  return penalty >= 0.14 ? drag : "NONE";
}

export function buildExecutionRealitySummary(input: BuildExecutionRealitySummaryInput): ExecutionRealitySummary {
  const execution = input.pnlAnalyticsSnapshot.execution;
  const liquidity = input.pnlAnalyticsSnapshot.liquidity;
  const stability = input.stabilitySnapshot;
  const reasons: string[] = [];

  const slippagePenalty = execution.samples >= 4
    ? clamp(execution.avgSlippageBps / 12, 0, 1)
    : 0;
  const fillPenalty = execution.samples >= 4
    ? clamp((0.88 - execution.avgFillRate) / 0.88, 0, 1)
    : 0;
  const latencyPenalty = execution.samples >= 4
    ? clamp(execution.avgLatencyMs / 850, 0, 1)
    : 0;
  const liquidityPenalty = liquidity.samples >= 4
    ? clamp((0.72 - liquidity.accuracy) / 0.72, 0, 1)
    : 0;
  const stabilityPenalty = clamp(
    (1 - stability.monitorScore) * 0.7
      + (stability.mode === "halted" ? 0.45 : stability.mode === "shadow" ? 0.22 : stability.mode === "guarded" ? 0.12 : 0)
      + (stability.driftWatchdog === "CRITICAL" ? 0.36 : stability.driftWatchdog === "DRIFT" ? 0.2 : stability.driftWatchdog === "WATCH" ? 0.08 : 0),
    0,
    1,
  );
  const dragScore = clamp(
    slippagePenalty * 0.24
      + fillPenalty * 0.24
      + latencyPenalty * 0.14
      + liquidityPenalty * 0.14
      + stabilityPenalty * 0.24,
    0,
    1,
  );
  const scorePct = Math.round((1 - dragScore) * 100);

  if (execution.samples >= 4 && execution.avgSlippageBps > 4) {
    reasons.push(`execution_reality_slippage:${execution.avgSlippageBps.toFixed(2)}bps`);
  }
  if (execution.samples >= 4 && execution.avgFillRate < 0.72) {
    reasons.push(`execution_reality_fill:${Math.round(execution.avgFillRate * 100)}pct`);
  }
  if (execution.samples >= 4 && execution.avgLatencyMs > 450) {
    reasons.push(`execution_reality_latency:${Math.round(execution.avgLatencyMs)}ms`);
  }
  if (liquidity.samples >= 4 && liquidity.accuracy < 0.58) {
    reasons.push(`execution_reality_liquidity:${Math.round(liquidity.accuracy * 100)}pct`);
  }
  if (stability.mode !== "live") {
    reasons.push(`execution_reality_stability_mode:${stability.mode}`);
  }
  if (stability.driftWatchdog !== "CALM") {
    reasons.push(`execution_reality_watchdog:${stability.driftWatchdog.toLowerCase()}`);
  }
  if (input.pnlAnalyticsSnapshot.autoOptimization.action !== "hold") {
    reasons.push(`execution_reality_optimizer:${input.pnlAnalyticsSnapshot.autoOptimization.action}`);
    input.pnlAnalyticsSnapshot.autoOptimization.reasons.forEach((reason) => reasons.push(`execution_reality_${reason}`));
  }

  const severeExecution = execution.samples >= 5
    && (execution.avgFillRate < 0.58 || execution.avgSlippageBps > 10);
  const severeLiquidity = liquidity.samples >= 6 && liquidity.accuracy < 0.45;
  const halted = stability.shouldBlockExecution
    || (input.pnlAnalyticsSnapshot.autoOptimization.action === "disable" && (severeExecution || severeLiquidity || stability.driftWatchdog === "CRITICAL"));
  const degraded = halted
    || input.pnlAnalyticsSnapshot.autoOptimization.action === "disable"
    || scorePct < 42
    || (execution.samples >= 4 && execution.avgFillRate < 0.68)
    || (execution.samples >= 4 && execution.avgSlippageBps > 7)
    || (stability.mode === "shadow" && stability.driftWatchdog !== "CALM");
  const caution = degraded
    || input.pnlAnalyticsSnapshot.autoOptimization.action === "reduce"
    || scorePct < 68
    || (execution.samples >= 4 && execution.avgSlippageBps > 3.5)
    || stability.mode === "guarded"
    || stability.driftWatchdog === "WATCH";

  const state: ExecutionRealityState = halted
    ? "HALT"
    : degraded
      ? "DEGRADED"
      : caution
        ? "CAUTION"
        : "ALIGNED";
  const sizeCapPct = state === "HALT"
    ? 0
    : state === "DEGRADED"
      ? 25
      : state === "CAUTION"
        ? 60
        : 100;

  return {
    schema_version: "execution-reality/v1",
    state,
    score_pct: scorePct,
    allow_new_risk: state === "ALIGNED" || state === "CAUTION",
    blocks_execution: state === "HALT",
    size_cap_pct: sizeCapPct,
    summary_label: `EXEC REAL ${state} ${scorePct}%`,
    reasons: dedupe(reasons),
    dominant_drag: inferDominantDrag({
      slippagePenalty,
      fillPenalty,
      latencyPenalty,
      liquidityPenalty,
      stabilityPenalty,
    }),
    metrics: {
      execution_samples: execution.samples,
      liquidity_samples: liquidity.samples,
      slippage_bps: Number(execution.avgSlippageBps.toFixed(2)),
      latency_ms: Math.round(execution.avgLatencyMs),
      fill_rate_pct: Math.round(execution.avgFillRate * 100),
      liquidity_accuracy_pct: Math.round(liquidity.accuracy * 100),
      stability_mode: stability.mode,
      stability_monitor_pct: Math.round(stability.monitorScore * 100),
      drift_watchdog: stability.driftWatchdog,
      optimization_action: input.pnlAnalyticsSnapshot.autoOptimization.action,
    },
  };
}