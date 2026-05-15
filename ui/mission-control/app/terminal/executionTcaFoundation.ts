import type { GovernanceReplayDetailedTimelineStep } from "./governanceReplay";
import type { ExecutionRealitySummary } from "./executionRealityScore";

export type ExecutionTcaFoundationState = "ALIGNED" | "WATCH" | "FRICTION" | "BLOCKED";
export type ExecutionTcaFoundationDriver = "NONE" | "LATENCY" | "SLIPPAGE" | "FILL" | "GOVERNANCE" | "MIXED";
export type ExecutionTcaReplayAlignment = "CONFIRMED" | "PARTIAL" | "ABSENT";
export type ExecutionTcaRecommendedAction = "KEEP" | "REDUCE" | "BLOCK";

export type ExecutionTcaFoundationSummary = {
  schema_version: "execution-tca-foundation/v1";
  generated_at_iso: string;
  state: ExecutionTcaFoundationState;
  dominant_driver: ExecutionTcaFoundationDriver;
  replay_alignment: ExecutionTcaReplayAlignment;
  recommended_action: ExecutionTcaRecommendedAction;
  summary_label: string;
  reasons: string[];
  metrics: {
    execution_score_pct: number;
    latency_ms: number;
    slippage_bps: number;
    fill_rate_pct: number;
    replay_step_count: number;
    blocked_step_count: number;
    blocked_step_share_pct: number;
    governance_step_count: number;
    capital_step_count: number;
    route_mode_switch_count: number;
  };
};

export type ExecutionTcaSizingImpact = {
  block: boolean;
  multiplier: number;
  reasons: string[];
  summary_label: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function countRouteModeSwitches(timeline: GovernanceReplayDetailedTimelineStep[]): number {
  const routeModes = timeline
    .map((step) => String(step.route_mode || "").trim())
    .filter(Boolean);
  let switches = 0;
  for (let index = 1; index < routeModes.length; index += 1) {
    if (routeModes[index] !== routeModes[index - 1]) {
      switches += 1;
    }
  }
  return switches;
}

function dominantDriver(input: {
  executionReality: ExecutionRealitySummary | null;
  governanceStepCount: number;
  blockedStepSharePct: number;
}): ExecutionTcaFoundationDriver {
  const drag = input.executionReality?.dominant_drag || "NONE";
  if (drag === "LATENCY") {
    return input.governanceStepCount >= 2 && input.blockedStepSharePct >= 50 ? "MIXED" : "LATENCY";
  }
  if (drag === "SLIPPAGE") {
    return input.governanceStepCount >= 2 && input.blockedStepSharePct >= 50 ? "MIXED" : "SLIPPAGE";
  }
  if (drag === "FILL") {
    return input.governanceStepCount >= 2 && input.blockedStepSharePct >= 50 ? "MIXED" : "FILL";
  }
  if (input.governanceStepCount > 0 || input.blockedStepSharePct >= 50) {
    return "GOVERNANCE";
  }
  return "NONE";
}

export function buildExecutionTcaFoundationSummary(input: {
  executionReality?: ExecutionRealitySummary | null;
  governanceReplayTimeline?: GovernanceReplayDetailedTimelineStep[];
  nowMs?: number;
}): ExecutionTcaFoundationSummary {
  const executionReality = input.executionReality || null;
  const timeline = input.governanceReplayTimeline || [];
  const replayStepCount = timeline.length;
  const blockedStepCount = timeline.filter((step) => step.tone === "warn" || step.action === "BLOCK").length;
  const blockedStepSharePct = replayStepCount > 0 ? Math.round((blockedStepCount / replayStepCount) * 100) : 0;
  const governanceStepCount = timeline.filter((step) => step.phase === "governance").length;
  const capitalStepCount = timeline.filter((step) => step.phase === "capital").length;
  const routeModeSwitchCount = countRouteModeSwitches(timeline);

  let state: ExecutionTcaFoundationState = "ALIGNED";
  if (executionReality?.blocks_execution || blockedStepSharePct >= 75) {
    state = "BLOCKED";
  } else if (executionReality?.state === "DEGRADED" || blockedStepSharePct >= 50 || governanceStepCount >= 2) {
    state = "FRICTION";
  } else if (executionReality?.state === "CAUTION" || blockedStepSharePct >= 25 || capitalStepCount >= 1) {
    state = "WATCH";
  }

  const replayAlignment: ExecutionTcaReplayAlignment = replayStepCount === 0
    ? "ABSENT"
    : executionReality && (state === "FRICTION" || state === "BLOCKED") && (blockedStepCount > 0 || governanceStepCount > 0)
      ? "CONFIRMED"
      : executionReality && state === "ALIGNED" && blockedStepSharePct <= 25
        ? "CONFIRMED"
        : "PARTIAL";
  const dominant = dominantDriver({
    executionReality,
    governanceStepCount,
    blockedStepSharePct,
  });
  const recommendedAction: ExecutionTcaRecommendedAction = state === "BLOCKED"
    ? "BLOCK"
    : state === "FRICTION" || state === "WATCH"
      ? "REDUCE"
      : "KEEP";

  const reasons = dedupe([
    dominant !== "NONE" ? `tca_driver:${dominant.toLowerCase()}` : "",
    executionReality && executionReality.metrics.latency_ms >= 180 ? `tca_latency:${executionReality.metrics.latency_ms}ms` : "",
    executionReality && executionReality.metrics.slippage_bps >= 3.5 ? `tca_slippage:${executionReality.metrics.slippage_bps.toFixed(2)}bps` : "",
    executionReality && executionReality.metrics.fill_rate_pct <= 75 ? `tca_fill:${executionReality.metrics.fill_rate_pct}pct` : "",
    blockedStepCount > 0 ? `tca_replay_block_share:${blockedStepSharePct}pct` : "",
    governanceStepCount > 0 ? `tca_governance_steps:${governanceStepCount}` : "",
    capitalStepCount > 0 ? `tca_capital_steps:${capitalStepCount}` : "",
    routeModeSwitchCount > 0 ? `tca_route_mode_switches:${routeModeSwitchCount}` : "",
  ]);

  return {
    schema_version: "execution-tca-foundation/v1",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    state,
    dominant_driver: dominant,
    replay_alignment: replayAlignment,
    recommended_action: recommendedAction,
    summary_label: `TCA ${state} ${executionReality?.score_pct ?? 0}%`,
    reasons,
    metrics: {
      execution_score_pct: executionReality?.score_pct ?? 0,
      latency_ms: executionReality?.metrics.latency_ms ?? 0,
      slippage_bps: clamp(executionReality?.metrics.slippage_bps ?? 0, 0, 999),
      fill_rate_pct: clamp(executionReality?.metrics.fill_rate_pct ?? 0, 0, 100),
      replay_step_count: replayStepCount,
      blocked_step_count: blockedStepCount,
      blocked_step_share_pct: blockedStepSharePct,
      governance_step_count: governanceStepCount,
      capital_step_count: capitalStepCount,
      route_mode_switch_count: routeModeSwitchCount,
    },
  };
}

export function resolveExecutionTcaSizingImpact(summary: ExecutionTcaFoundationSummary | null | undefined): ExecutionTcaSizingImpact {
  if (!summary) {
    return {
      block: false,
      multiplier: 1,
      reasons: [],
      summary_label: "TCA neutral",
    };
  }

  if (summary.state === "BLOCKED" || summary.recommended_action === "BLOCK") {
    return {
      block: true,
      multiplier: 0,
      reasons: dedupe([
        `execution_tca_block:${summary.dominant_driver.toLowerCase()}`,
        ...summary.reasons.slice(0, 4),
      ]),
      summary_label: `TCA block ${summary.dominant_driver.toLowerCase()}`,
    };
  }

  if (summary.state === "FRICTION") {
    const multiplier = summary.dominant_driver === "LATENCY" || summary.dominant_driver === "SLIPPAGE"
      ? 0.55
      : 0.62;
    return {
      block: false,
      multiplier,
      reasons: dedupe([
        `execution_tca_factor:${multiplier.toFixed(2)}`,
        `execution_tca_state:${summary.state.toLowerCase()}`,
        `execution_tca_driver:${summary.dominant_driver.toLowerCase()}`,
        ...summary.reasons.slice(0, 3),
      ]),
      summary_label: `TCA reduce x${multiplier.toFixed(2)}`,
    };
  }

  if (summary.state === "WATCH") {
    const multiplier = summary.metrics.route_mode_switch_count > 0 ? 0.72 : 0.82;
    return {
      block: false,
      multiplier,
      reasons: dedupe([
        `execution_tca_factor:${multiplier.toFixed(2)}`,
        `execution_tca_state:${summary.state.toLowerCase()}`,
        `execution_tca_driver:${summary.dominant_driver.toLowerCase()}`,
        ...summary.reasons.slice(0, 2),
      ]),
      summary_label: `TCA watch x${multiplier.toFixed(2)}`,
    };
  }

  return {
    block: false,
    multiplier: 1,
    reasons: [],
    summary_label: "TCA aligned",
  };
}