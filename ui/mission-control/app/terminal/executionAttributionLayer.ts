import type { CrossMarketTruthSummary } from "./crossMarketTruth";

export type ExecutionAttributionState = "CLEAN" | "WATCH" | "DEGRADED" | "TOXIC";
export type ExecutionAttributionDriver = "NONE" | "SPREAD" | "LATENCY" | "ROUTING" | "VENUE" | "MARKET_IMPACT" | "TIMING" | "SLIPPAGE" | "LIQUIDITY" | "MIXED";

export type ExecutionAttributionSummary = {
  schema_version: "execution-attribution/v1";
  generated_at_iso: string;
  state: ExecutionAttributionState;
  primary_driver: ExecutionAttributionDriver;
  execution_loss_share_pct: number;
  signal_loss_share_pct: number;
  summary_label: string;
  reasons: string[];
  components: {
    spread_impact_pct: number;
    latency_impact_pct: number;
    routing_impact_pct: number;
    venue_impact_pct: number;
    market_impact_pct: number;
    timing_impact_pct: number;
    slippage_impact_pct: number;
    liquidity_impact_pct: number;
  };
  metrics: {
    replay_latency_ms: number;
    replay_slippage_bps: number;
    micro_spread_bps: number;
    micro_imbalance: number;
    routing_infra_health_pct: number;
    venue_quality_pct: number;
    execution_quality_pct: number;
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildExecutionAttributionSummary(input: {
  replayLatencyMs: number;
  replaySlippageBps: number;
  microSpreadBps: number;
  microImbalance: number;
  routingInfraHealthScore: number;
  venueQualityScore: number;
  executionQualityScore: number | null;
  preferredRouteStability: number;
  backupRouteStability: number;
  predictedDeltaBps: number;
  crossMarket?: CrossMarketTruthSummary | null;
  nowMs?: number;
}): ExecutionAttributionSummary {
  const latencyImpactPct = Math.round(clamp(input.replayLatencyMs >= 450 ? 78 : input.replayLatencyMs >= 300 ? 58 : input.replayLatencyMs >= 180 ? 34 : 12, 0, 100));
  const slippageImpactPct = Math.round(clamp(Math.abs(input.replaySlippageBps) / 8 * 100, 0, 100));
  const spreadImpactPct = Math.round(clamp(input.microSpreadBps / 12 * 100, 0, 100));
  const liquidityImpactPct = Math.round(clamp(input.microImbalance * 100, 0, 100));
  const routingImpactPct = Math.round(clamp((1 - clamp(input.routingInfraHealthScore, 0, 1)) * 100 + (input.preferredRouteStability < 0.5 ? 18 : 0), 0, 100));
  const venueImpactPct = Math.round(clamp((1 - clamp(input.venueQualityScore, 0, 1)) * 100 + (input.backupRouteStability > 0 && input.backupRouteStability > input.preferredRouteStability ? 10 : 0), 0, 100));
  const marketImpactPct = Math.round(clamp(input.crossMarket?.state === "INCOHERENT" ? 42 : input.crossMarket?.state === "WATCH" ? 24 : 10, 0, 100));
  const timingImpactPct = Math.round(clamp(Math.abs(input.predictedDeltaBps) / 6 * 100, 0, 100));
  const executionQualityPct = Math.round(clamp((input.executionQualityScore ?? 0.5) * 100, 0, 100));

  const driverScores: Array<[ExecutionAttributionDriver, number]> = [
    ["SPREAD", spreadImpactPct],
    ["LATENCY", latencyImpactPct],
    ["ROUTING", routingImpactPct],
    ["VENUE", venueImpactPct],
    ["MARKET_IMPACT", marketImpactPct],
    ["TIMING", timingImpactPct],
    ["SLIPPAGE", slippageImpactPct],
    ["LIQUIDITY", liquidityImpactPct],
  ];
  const strongest = driverScores.reduce((best, current) => current[1] > best[1] ? current : best, ["NONE", 0] as [ExecutionAttributionDriver, number]);
  const secondary = driverScores.filter((item) => item[0] !== strongest[0]).sort((left, right) => right[1] - left[1])[0];
  const primaryDriver = strongest[1] >= 48 && secondary && Math.abs(strongest[1] - secondary[1]) <= 8
    ? "MIXED"
    : strongest[0];

  const executionLossSharePct = Math.round(clamp(
    latencyImpactPct * 0.16
      + slippageImpactPct * 0.18
      + spreadImpactPct * 0.12
      + routingImpactPct * 0.16
      + venueImpactPct * 0.12
      + timingImpactPct * 0.1
      + liquidityImpactPct * 0.1
      + clamp(100 - executionQualityPct, 0, 100) * 0.06,
    0,
    100,
  ));
  const signalLossSharePct = Math.round(clamp(100 - executionLossSharePct, 0, 100));
  const state: ExecutionAttributionState = executionLossSharePct >= 72
    ? "TOXIC"
    : executionLossSharePct >= 48
      ? "DEGRADED"
      : executionLossSharePct >= 24
        ? "WATCH"
        : "CLEAN";

  return {
    schema_version: "execution-attribution/v1",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    state,
    primary_driver: primaryDriver,
    execution_loss_share_pct: executionLossSharePct,
    signal_loss_share_pct: signalLossSharePct,
    summary_label: `ATTR ${state} ${primaryDriver} exec ${executionLossSharePct}%`,
    reasons: dedupe([
      latencyImpactPct >= 34 ? `execution_attr_latency:${input.replayLatencyMs}ms` : "",
      slippageImpactPct >= 34 ? `execution_attr_slippage:${input.replaySlippageBps.toFixed(2)}bps` : "",
      spreadImpactPct >= 34 ? `execution_attr_spread:${input.microSpreadBps.toFixed(2)}bps` : "",
      routingImpactPct >= 34 ? `execution_attr_routing:${Math.round(input.routingInfraHealthScore * 100)}pct` : "",
      venueImpactPct >= 34 ? `execution_attr_venue:${Math.round(input.venueQualityScore * 100)}pct` : "",
      timingImpactPct >= 34 ? `execution_attr_timing:${input.predictedDeltaBps.toFixed(2)}bps` : "",
      liquidityImpactPct >= 34 ? `execution_attr_liquidity:${input.microImbalance.toFixed(2)}` : "",
      input.crossMarket?.state === "INCOHERENT" ? "execution_attr_market_context:incoherent" : "",
    ]),
    components: {
      spread_impact_pct: spreadImpactPct,
      latency_impact_pct: latencyImpactPct,
      routing_impact_pct: routingImpactPct,
      venue_impact_pct: venueImpactPct,
      market_impact_pct: marketImpactPct,
      timing_impact_pct: timingImpactPct,
      slippage_impact_pct: slippageImpactPct,
      liquidity_impact_pct: liquidityImpactPct,
    },
    metrics: {
      replay_latency_ms: Math.round(input.replayLatencyMs),
      replay_slippage_bps: Number(input.replaySlippageBps.toFixed(2)),
      micro_spread_bps: Number(input.microSpreadBps.toFixed(2)),
      micro_imbalance: Number(input.microImbalance.toFixed(2)),
      routing_infra_health_pct: Math.round(clamp(input.routingInfraHealthScore, 0, 1) * 100),
      venue_quality_pct: Math.round(clamp(input.venueQualityScore, 0, 1) * 100),
      execution_quality_pct: executionQualityPct,
    },
  };
}