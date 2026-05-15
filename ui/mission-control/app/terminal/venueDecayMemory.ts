import type { GovernanceReplayDetailedTimelineStep } from "./governanceReplay";

export type VenueDecayMemoryState = "CLEAR" | "WATCH" | "DECAYED" | "LOCKED";
export type VenueDecayMemoryDriver = "NONE" | "LATENCY" | "SLIPPAGE" | "INFRA" | "ROUTE_CHURN";

export type VenueDecayMemorySummary = {
  schema_version: "venue-decay-memory/v1";
  generated_at_iso: string;
  state: VenueDecayMemoryState;
  dominant_driver: VenueDecayMemoryDriver;
  decay_score_pct: number;
  pressure_pct: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  trajectory: "IMPROVING" | "STABLE" | "WORSENING";
  recovery_signal_pct: number;
  decay_factor: number;
  size_cap_pct: number;
  summary_label: string;
  reasons: string[];
  metrics: {
    venue_quality_pct: number;
    infra_health_pct: number;
    replay_latency_ms: number;
    replay_step_count: number;
    route_mode_switch_count: number;
  };
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

export function buildVenueDecayMemorySummary(input: {
  venueQualityScore: number;
  replayInfraHealthScore: number;
  replayLatencyMs: number;
  governanceReplayTimeline?: GovernanceReplayDetailedTimelineStep[];
  nowMs?: number;
}): VenueDecayMemorySummary {
  const timeline = input.governanceReplayTimeline || [];
  const routeModeSwitchCount = countRouteModeSwitches(timeline);
  const venueQuality = clamp(input.venueQualityScore, 0, 1);
  const infraHealth = clamp(input.replayInfraHealthScore, 0, 1);
  const replayLatencyMs = Math.max(0, Math.round(input.replayLatencyMs));
  const qualityPenalty = (1 - venueQuality) * 0.34;
  const infraPenalty = (1 - infraHealth) * 0.28;
  const latencyPenalty = replayLatencyMs >= 450
    ? 0.28
    : replayLatencyMs >= 300
      ? 0.18
      : replayLatencyMs >= 200
        ? 0.08
        : 0;
  const churnPenalty = routeModeSwitchCount >= 3
    ? 0.24
    : routeModeSwitchCount >= 1
      ? 0.1
      : 0;
  const decayScorePct = Math.round(clamp((qualityPenalty + infraPenalty + latencyPenalty + churnPenalty) * 100, 0, 100));

  let dominantDriver: VenueDecayMemoryDriver = "NONE";
  const driverScores: Array<[VenueDecayMemoryDriver, number]> = [
    ["SLIPPAGE", qualityPenalty],
    ["INFRA", infraPenalty],
    ["LATENCY", latencyPenalty],
    ["ROUTE_CHURN", churnPenalty],
  ];
  const strongest = driverScores.reduce((best, current) => current[1] > best[1] ? current : best, ["NONE", 0] as [VenueDecayMemoryDriver, number]);
  if (strongest[1] > 0) {
    dominantDriver = strongest[0];
  }

  const state: VenueDecayMemoryState = venueQuality < 0.45 || infraHealth < 0.35 || decayScorePct >= 72
    ? "LOCKED"
    : decayScorePct >= 48
      ? "DECAYED"
      : decayScorePct >= 24
        ? "WATCH"
        : "CLEAR";
  const sizeCapPct = state === "LOCKED"
    ? 0
    : state === "DECAYED"
      ? 35
      : state === "WATCH"
        ? 65
        : 100;
  const severity = state === "LOCKED"
    ? "EXTREME"
    : state === "DECAYED"
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
    ? Math.round(clamp((venueQuality * 0.56 + infraHealth * 0.44) * 100, 0, 100))
    : state === "WATCH"
      ? Math.round(clamp((venueQuality * 0.42 + infraHealth * 0.38 + 0.16) * 100, 0, 100))
      : Math.round(clamp((venueQuality * 0.28 + infraHealth * 0.32) * 100, 0, 100));
  const decayFactor = Number(clamp(1 - decayScorePct / 100, 0, 1).toFixed(3));

  return {
    schema_version: "venue-decay-memory/v1",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    state,
    dominant_driver: dominantDriver,
    decay_score_pct: decayScorePct,
    pressure_pct: decayScorePct,
    severity,
    trajectory,
    recovery_signal_pct: recoverySignalPct,
    decay_factor: decayFactor,
    size_cap_pct: sizeCapPct,
    summary_label: `VENUE ${state} ${decayScorePct}%`,
    reasons: dedupe([
      venueQuality < 0.7 ? `venue_decay_quality:${Math.round(venueQuality * 100)}pct` : "",
      infraHealth < 0.8 ? `venue_decay_infra:${Math.round(infraHealth * 100)}pct` : "",
      replayLatencyMs >= 200 ? `venue_decay_latency:${replayLatencyMs}ms` : "",
      routeModeSwitchCount > 0 ? `venue_decay_route_switches:${routeModeSwitchCount}` : "",
    ]),
    metrics: {
      venue_quality_pct: Math.round(venueQuality * 100),
      infra_health_pct: Math.round(infraHealth * 100),
      replay_latency_ms: replayLatencyMs,
      replay_step_count: timeline.length,
      route_mode_switch_count: routeModeSwitchCount,
    },
  };
}