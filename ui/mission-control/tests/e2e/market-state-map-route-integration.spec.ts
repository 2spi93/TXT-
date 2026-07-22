import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";

import * as governanceReplayRoute from "../../app/api/terminal/governance-replay/route";
import * as marketStateMapRoute from "../../app/api/market-state-map/route";
import type { CapitalScarMemorySummary } from "../../app/terminal/capitalScarMemory";
import { buildCapitalScarMemorySummary } from "../../app/terminal/capitalScarMemory";
import { buildCapitalAgingGovernanceSummary } from "../../app/terminal/capitalAgingGovernance";
import { buildContagionMemorySummary } from "../../app/terminal/contagionMemory";
import { buildCrossVenueExecutionIntelligenceSummary, resolveCrossVenueLocalRoutingDirective } from "../../app/terminal/crossVenueExecutionIntelligence";
import type { CrossMarketTruthSummary } from "../../app/terminal/crossMarketTruth";
import type { DynamicCapitalPressureSummary } from "../../app/terminal/dynamicCapitalPressure";
import { buildDynamicCapitalPressureSummary } from "../../app/terminal/dynamicCapitalPressure";
import { buildExecutionAttributionSummary } from "../../app/terminal/executionAttributionLayer";
import { buildExecutionRealityMemoryEvent, buildExecutionRealityMemorySnapshot, type ExecutionRealityMemorySnapshot } from "../../app/terminal/executionRealityMemory";
import type { ExecutionRealityGovernanceSummary } from "../../app/terminal/executionRealityGovernance";
import { buildExecutionRealityGovernanceSummary } from "../../app/terminal/executionRealityGovernance";
import type { ExecutionRealitySummary } from "../../app/terminal/executionRealityScore";
import { buildExecutionRealitySummary } from "../../app/terminal/executionRealityScore";
import { buildExecutionTcaFoundationSummary, resolveExecutionTcaSizingImpact } from "../../app/terminal/executionTcaFoundation";
import { buildExecutionRealityTemporalSizingSummary } from "../../app/terminal/executionRealityTemporalSizing";
import { buildFinalDecisionTruth } from "../../app/terminal/finalDecisionTruth";
import { buildFreezeV1ContractsSummary } from "../../app/terminal/freezeV1Contracts";
import { buildAggressionBudgetEngineSummary } from "../../app/terminal/aggressionBudgetEngine";
import { buildGovernanceBalanceSummary } from "../../app/terminal/governanceBalanceEngine";
import { buildGlobalConfidenceDecaySummary } from "../../app/terminal/globalConfidenceDecay";
import { buildGovernanceInertiaMemorySummary } from "../../app/terminal/governanceInertiaMemory";
import { buildGovernanceReplayDetailedTimeline, buildGovernanceReplaySummary } from "../../app/terminal/governanceReplay";
import { buildMarketRegimeArchiveSummary } from "../../app/terminal/marketRegimeArchive";
import { buildPressureNormalizationSummary } from "../../app/terminal/pressureNormalization";
import { computeCapitalScalingDecision } from "../../lib/capitalScalingEngine";
import { buildOracleStabilityMemoryEvent, buildOracleStabilitySnapshot } from "../../app/terminal/oracleStabilityMemory";
import { buildReaccelerationGovernanceSummary } from "../../app/terminal/reaccelerationGovernance";
import { buildRecoveryMomentumSummary } from "../../app/terminal/recoveryMomentumEngine";
import { buildAdaptiveRecoveryCooldown, buildSelfHealingRecoveryMemoryEvent, buildSelfHealingRecoverySnapshot } from "../../app/terminal/selfHealingRecoveryMemory";
import type { SelfPreservationSummary } from "../../app/terminal/selfPreservation";
import { buildSelfPreservationSummary } from "../../app/terminal/selfPreservation";
import { buildVenueDecayMemorySummary } from "../../app/terminal/venueDecayMemory";

function buildTruth(input?: {
  informationDensityImpactWeight?: number;
  executionLockActive?: boolean;
  riskMultiplier?: number;
  generatedAtIso?: string;
  informationDensity?: Partial<{
    orderflowQuality: number;
    domDensity: number;
    touchDensity: number;
    liquidityVacuum: number;
    sweepRisk: number;
    syntheticReliability: number;
    microNoise: number;
  }>;
  crossMarket?: CrossMarketTruthSummary | null;
  executionReality?: ExecutionRealitySummary | null;
  executionRealityGovernance?: ExecutionRealityGovernanceSummary | null;
  executionRealityMemory?: ExecutionRealityMemorySnapshot | null;
  capitalScar?: CapitalScarMemorySummary | null;
  capitalPressure?: DynamicCapitalPressureSummary | null;
  selfPreservation?: SelfPreservationSummary | null;
}) {
  return buildFinalDecisionTruth({
    frameTruth: {
      integrity_status: "OK",
      sync_status: "SYNCED",
      freshness: "FRESH",
      reconstruction_flag: "CLEAN",
      confidence: 0.82,
      tradable: true,
      decision_allowed: true,
      reasons: [],
    },
    smartDecision: {
      state: "ENTRY_VALID",
      confidenceBand: "HIGH",
      headline: "ready",
      reason: "aligned",
    },
    confidence: {
      actionState: "go",
      finalScorePct: 78,
      qualityLabel: "good",
      hardVeto: false,
      hardVetoReasons: [],
    },
    attention: {
      state: "stable",
      shouldBlockTrading: false,
      summaryLabel: "stable",
      detailLabel: "stable",
    },
    executionLock: {
      active: Boolean(input?.executionLockActive),
      code: input?.executionLockActive ? "routing-off" : null,
      detailLabel: input?.executionLockActive ? "routing locked" : null,
    },
    informationDensity: {
      orderflowQuality: input?.informationDensity?.orderflowQuality ?? 0.78,
      domDensity: input?.informationDensity?.domDensity ?? 0.7,
      touchDensity: input?.informationDensity?.touchDensity ?? 0.74,
      liquidityVacuum: input?.informationDensity?.liquidityVacuum ?? 0.18,
      sweepRisk: input?.informationDensity?.sweepRisk ?? 0.2,
      syntheticReliability: input?.informationDensity?.syntheticReliability ?? 0.8,
      microNoise: input?.informationDensity?.microNoise ?? 0.18,
    },
    informationDensityCalibration: {
      thinScoreFloor: 0.5,
      degradedScoreFloor: 0.28,
      thinEntropyCeiling: 0.58,
      degradedEntropyCeiling: 0.72,
    },
    informationDensityImpactWeight: input?.informationDensityImpactWeight ?? 0.22,
    crossMarket: input?.crossMarket ?? null,
    executionReality: input?.executionReality ?? null,
    executionRealityGovernance: input?.executionRealityGovernance ?? null,
    executionRealityMemory: input?.executionRealityMemory ?? null,
    capitalScar: input?.capitalScar ?? null,
    capitalPressure: input?.capitalPressure ?? null,
    selfPreservation: input?.selfPreservation ?? null,
    riskMultiplier: input?.riskMultiplier ?? 0.94,
    preferredVenue: "binance-public",
    truthExecutionVenue: "binance-public",
    marketTruthLockEnabled: false,
    generatedAtIso: input?.generatedAtIso,
  });
}

function buildJournalEntry(input: {
  id: string;
  createdAtIso: string;
  action: string;
  detail: string;
  finalDecisionTruth?: ReturnType<typeof buildTruth> | null;
  meta?: Record<string, unknown>;
}) {
  return {
    id: input.id,
    createdAtIso: input.createdAtIso,
    symbol: "BTCUSD",
    timeframe: "1m",
    strategy: "terminal",
    action: input.action,
    detail: input.detail,
    meta: {
      ...(input.meta || {}),
      ...(input.finalDecisionTruth ? { final_decision_truth: input.finalDecisionTruth } : {}),
    },
  };
}

test("buildFinalDecisionTruth exposes separate market truth family", async () => {
  const truth = buildTruth({ executionLockActive: true, riskMultiplier: 0.42 });

  expect(truth.market_truth).toBeTruthy();
  expect(truth.market_truth.score_pct).toBeGreaterThan(0);
  expect(truth.market_truth.metrics.execution_quality_pct).toBeLessThan(60);
  expect(truth.market_truth.reasons).toContain("execution_quality_degraded");
  expect(truth.false_context.family).toBe("FALSE_EXECUTION_CONTEXT");
  expect(truth.false_context.no_trade).toBeTruthy();
  expect(truth.false_context.taxonomy?.operator_family).toBe("execution");
  expect(truth.false_context.taxonomy?.archetype).toBe("ROUTING_CONTEXT_DRIFT");
  expect(truth.false_context.taxonomy?.severity).toBe("NO_TRADE");
  expect(truth.proofs.some((item) => item.code === "false_context" && item.value.includes("routing context drift"))).toBeTruthy();
  expect(truth.edge_eligibility.calibration.information_density_weight_pct).toBe(22);
});

test("buildFinalDecisionTruth lets the oracle govern no-trade when information density collapses", async () => {
  const truth = buildTruth({
    informationDensity: {
      orderflowQuality: 0.16,
      domDensity: 0.12,
      touchDensity: 0.18,
      liquidityVacuum: 0.82,
      sweepRisk: 0.79,
      syntheticReliability: 0.22,
      microNoise: 0.81,
    },
  });

  expect(truth.smart_decision?.state).toBe("ENTRY_VALID");
  expect(truth.confidence.action_state).toBe("go");
  expect(truth.information_density.state).toBe("DEGRADED");
  expect(truth.execution_allowed).toBe(false);
  expect(truth.should_trade).toBe(false);
  expect(truth.action).toBe("BLOCK");
  expect(truth.blocking_layer).toBe("information_density");
  expect(truth.false_context.family).toBe("FALSE_LIQUIDITY");
  expect(truth.false_context.no_trade).toBe(true);
  expect(truth.false_context.taxonomy?.operator_family).toBe("liquidity");
  expect(truth.false_context.taxonomy?.archetype).toBe("VACUUM_SWEEP");
  expect(truth.false_context.taxonomy?.evidence_tags).toContain("liquidity_vacuum");
  expect(truth.detail_label).toContain("information_density:degraded");
  expect(truth.edge_eligibility.state).toBe("BLOCKED");
  expect(truth.verdict_explanation.some((item) => item.code === "contract" && item.detail.includes("information_density"))).toBeTruthy();
  expect(truth.verdict_explanation.some((item) => item.code === "information_density" && item.detail.includes("degraded"))).toBeTruthy();
  expect(truth.verdict_explanation.some((item) => item.code === "false_context" && item.detail.includes("vacuum_sweep"))).toBeTruthy();
});

test("buildFinalDecisionTruth emits a reproducible oracle fingerprint for identical truth inputs", async () => {
  const first = buildTruth({ generatedAtIso: "2026-05-14T00:00:00.000Z" });
  const second = buildTruth({ generatedAtIso: "2026-05-14T00:05:00.000Z" });
  const changed = buildTruth({ generatedAtIso: "2026-05-14T00:10:00.000Z", riskMultiplier: 0.41, executionLockActive: true });

  expect(first.generated_at_iso).not.toBe(second.generated_at_iso);
  expect(first.oracle_fingerprint).toBe(second.oracle_fingerprint);
  expect(changed.oracle_fingerprint).not.toBe(first.oracle_fingerprint);
});

test("buildFinalDecisionTruth lowers trade eligibility when cross-market coherence breaks without hard-blocking execution", async () => {
  const truth = buildTruth({
    crossMarket: {
      state: "INCOHERENT",
      score_pct: 34,
      reasons: ["cross_market_incoherent", "cross_market_coverage_thin"],
      summary_label: "INCOHERENT · MIXED · 34%",
      dominant_regime: "MIXED",
      metrics: {
        coverage_pct: 62,
        freshness_pct: 78,
        coherence_pct: 22,
        pair_count: 5,
      },
      basket: [
        { code: "BTC", label: "Bitcoin", instrument: "BTCUSDT", venue: "binance-public", timeframe: "5m", role: "risk", available: true, direction: "UP", change_pct: 0.82, freshness_pct: 100, reason_tags: [] },
        { code: "ETH", label: "Ethereum", instrument: "ETHUSDT", venue: "binance-public", timeframe: "5m", role: "risk", available: true, direction: "DOWN", change_pct: -0.41, freshness_pct: 100, reason_tags: [] },
        { code: "DXY", label: "Dollar Index", instrument: "DXY", venue: "mt5", timeframe: "5m", role: "hedge", available: true, direction: "DOWN", change_pct: -0.22, freshness_pct: 72, reason_tags: [] },
        { code: "US100", label: "US100", instrument: "US100", venue: "mt5", timeframe: "5m", role: "risk", available: true, direction: "DOWN", change_pct: -0.66, freshness_pct: 64, reason_tags: [] },
      ],
    },
  });

  expect(truth.cross_market?.state).toBe("INCOHERENT");
  expect(truth.execution_allowed).toBe(true);
  expect(truth.should_trade).toBe(false);
  expect(truth.action).toBe("WAIT");
  expect(truth.reasons).toContain("cross_market:incoherent");
  expect(truth.market_truth.reasons).toContain("cross_market_incoherent");
  expect(truth.edge_eligibility.reasons).toContain("cross_market_incoherent");
});

test("oracle stability snapshot canonicalises adaptive instability context", async () => {
  const truth = buildTruth({
    crossMarket: {
      state: "INCOHERENT",
      score_pct: 34,
      reasons: ["cross_market_incoherent"],
      summary_label: "INCOHERENT · MIXED · 34%",
      dominant_regime: "MIXED",
      metrics: {
        coverage_pct: 62,
        freshness_pct: 78,
        coherence_pct: 22,
        pair_count: 5,
      },
      basket: [
        { code: "BTC", label: "Bitcoin", instrument: "BTCUSDT", venue: "binance-public", timeframe: "5m", role: "risk", available: true, direction: "UP", change_pct: 0.82, freshness_pct: 100, reason_tags: [] },
        { code: "ETH", label: "Ethereum", instrument: "ETHUSDT", venue: "binance-public", timeframe: "5m", role: "risk", available: true, direction: "DOWN", change_pct: -0.41, freshness_pct: 100, reason_tags: [] },
      ],
    },
  });

  const snapshot = buildOracleStabilitySnapshot({
    finalDecisionTruth: truth,
    volatilityRegime: "mixed",
    executionLockActive: false,
  });

  expect(snapshot.oracle_state).toBe("WATCH");
  expect(snapshot.regime).toBe("MIXED");
  expect(snapshot.cross_market_state).toBe("INCOHERENT");
  expect(snapshot.divergence_family).toBe("CROSS_MARKET");
  expect(snapshot.instability_score_pct).toBeGreaterThanOrEqual(74);
});

test("oracle stability memory emits precursor and recovery payloads", async () => {
  const unstableTruth = buildTruth({ executionLockActive: true, generatedAtIso: "2026-05-14T00:00:00.000Z" });
  const stableTruth = buildTruth({ generatedAtIso: "2026-05-14T00:05:00.000Z" });

  const unstableSnapshot = buildOracleStabilitySnapshot({
    finalDecisionTruth: unstableTruth,
    volatilityRegime: "trend",
    executionLockActive: true,
  });
  const stableSnapshot = buildOracleStabilitySnapshot({
    finalDecisionTruth: stableTruth,
    volatilityRegime: "trend",
    executionLockActive: false,
  });

  const instabilityEvent = buildOracleStabilityMemoryEvent({
    previous: stableSnapshot,
    current: unstableSnapshot,
    finalDecisionTruth: unstableTruth,
    executionLockActive: true,
  });
  const recoveryEvent = buildOracleStabilityMemoryEvent({
    previous: unstableSnapshot,
    current: stableSnapshot,
    finalDecisionTruth: stableTruth,
    executionLockActive: false,
  });

  expect(instabilityEvent?.journal_action).toBe("oracle-stability-episode");
  expect(instabilityEvent?.payload.oracle_stability_memory.precursor_context?.oracle_state).toBe("STABLE");
  expect(instabilityEvent?.payload.oracle_stability_memory.divergence_family).toBe("EXECUTION_LOCK");

  expect(recoveryEvent?.journal_action).toBe("oracle-stability-recovery");
  expect(recoveryEvent?.payload.oracle_stability_memory.episode_type).toBe("RECOVERY");
  expect(recoveryEvent?.payload.oracle_stability_memory.recovery_outcome?.admissibility).toBe("ADMISSIBLE");
});

test("dynamic capital pressure canonicalises constrained capital posture without hard blocking execution", async () => {
  const capitalPressure = buildDynamicCapitalPressureSummary({
    capitalScalingDecision: {
      allow: true,
      status: "DEFENSIVE",
      baseRiskPct: 0.01,
      edgeScore: 0.46,
      edgeMultiplier: 0.8,
      riskFactor: 0.6,
      performanceFactor: 1,
      portfolioHeatFactor: 0.75,
      scaleAdjustmentFactor: 1,
      multiplier: 0.36,
      recommendedRiskUsd: 36,
      reasons: ["portfolio_heat_over_6pct", "open_trade_limit_pressure"],
    },
    dailyDrawdownPct: 1.8,
    exposureRatio: 0.078,
    openTradeCount: 3,
    autoSessionGuard: {
      pass: false,
      label: "07-22",
    },
    autoSymbolLoss: {
      pass: true,
      cumulativeLossUsd: 120,
      overCap: false,
      localDisabled: false,
    },
    autoRiskEngine: {
      killSwitchActive: false,
      drawdownKillTriggered: false,
    },
    journalWindowScalingLiveBlocked: false,
  });

  expect(capitalPressure.state).toBe("CONSTRAINED");
  expect(capitalPressure.allow_new_risk).toBe(false);
  expect(capitalPressure.blocks_execution).toBe(false);
  expect(capitalPressure.dominant_constraint).toBe("SESSION");
  expect(capitalPressure.reasons).toContain("session_guard_closed:07-22");
});

test("execution TCA foundation canonicalises replay friction over degraded execution reality", async () => {
  const executionReality: ExecutionRealitySummary = {
    schema_version: "execution-reality/v1",
    state: "DEGRADED",
    score_pct: 41,
    allow_new_risk: false,
    blocks_execution: false,
    size_cap_pct: 25,
    summary_label: "EXEC REAL DEGRADED 41%",
    reasons: ["execution_reality_latency:212ms", "execution_reality_slippage:4.80bps"],
    dominant_drag: "LATENCY",
    metrics: {
      execution_samples: 12,
      liquidity_samples: 9,
      slippage_bps: 4.8,
      latency_ms: 212,
      fill_rate_pct: 69,
      liquidity_accuracy_pct: 64,
      stability_mode: "guarded",
      stability_monitor_pct: 58,
      drift_watchdog: "WATCH",
      optimization_action: "reduce",
    },
  };

  const blockedTruth = buildTruth({
    generatedAtIso: "2026-05-14T11:00:00.000Z",
    executionReality,
    executionLockActive: true,
  });
  const capitalTruth = buildTruth({
    generatedAtIso: "2026-05-14T11:05:00.000Z",
    executionReality,
  });
  const timeline = buildGovernanceReplayDetailedTimeline({
    journalEntries: [
      buildJournalEntry({
        id: "truth-blocked",
        createdAtIso: "2026-05-14T11:00:00.000Z",
        action: "oracle-review-required",
        detail: "execution cost no longer acceptable under current route latency",
        finalDecisionTruth: blockedTruth,
      }),
      buildJournalEntry({
        id: "capital-defensive",
        createdAtIso: "2026-05-14T11:05:00.000Z",
        action: "capital-scaling-updated",
        detail: "capital scaling cut after latency drift",
        finalDecisionTruth: capitalTruth,
        meta: {
          capital_scaling: {
            schema_version: "capital-scaling/v1",
            route_mode: "latency_degraded",
          },
        },
      }),
    ],
  });

  const summary = buildExecutionTcaFoundationSummary({
    executionReality,
    governanceReplayTimeline: timeline,
    nowMs: Date.parse("2026-05-14T11:10:00.000Z"),
  });

  expect(summary.schema_version).toBe("execution-tca-foundation/v1");
  expect(summary.state).toBe("FRICTION");
  expect(summary.dominant_driver).toBe("LATENCY");
  expect(summary.replay_alignment).toBe("CONFIRMED");
  expect(summary.recommended_action).toBe("REDUCE");
  expect(summary.metrics.blocked_step_count).toBe(1);
  expect(summary.metrics.blocked_step_share_pct).toBe(50);
  expect(summary.metrics.capital_step_count).toBe(1);
  expect(summary.metrics.route_mode_switch_count).toBe(1);
  expect(summary.reasons).toContain("tca_driver:latency");
  expect(summary.reasons).toContain("tca_latency:212ms");
  expect(summary.reasons).toContain("tca_replay_block_share:50pct");
});

test("governance balance canonicalises TCA pressure into capital scaling", async () => {
  const frictionSummary = buildExecutionTcaFoundationSummary({
    executionReality: {
      schema_version: "execution-reality/v1",
      state: "DEGRADED",
      score_pct: 39,
      allow_new_risk: false,
      blocks_execution: false,
      size_cap_pct: 25,
      summary_label: "EXEC REAL DEGRADED 39%",
      reasons: ["execution_reality_latency:225ms"],
      dominant_drag: "LATENCY",
      metrics: {
        execution_samples: 11,
        liquidity_samples: 7,
        slippage_bps: 4.4,
        latency_ms: 225,
        fill_rate_pct: 68,
        liquidity_accuracy_pct: 62,
        stability_mode: "guarded",
        stability_monitor_pct: 59,
        drift_watchdog: "WATCH",
        optimization_action: "reduce",
      },
    },
    governanceReplayTimeline: [
      {
        id: "tca-1",
        journal_action: "oracle-review-required",
        phase: "governance",
        label: "Oracle Review Required",
        detail: "latency stress still dominates the route",
        action: "BLOCK",
        layer: "execution_reality_governance",
        regime: "TREND",
        route_mode: "latency_degraded",
        reasons: ["latency spike"],
        contract_versions: ["execution-reality/v1"],
        created_at_iso: "2026-05-14T11:00:00.000Z",
        tone: "warn",
      },
      {
        id: "tca-2",
        journal_action: "capital-scaling-updated",
        phase: "capital",
        label: "Capital Scaling Updated",
        detail: "recommended risk reduced under replay friction",
        action: "DEFENSIVE",
        layer: null,
        regime: "TREND",
        route_mode: "latency_degraded",
        reasons: ["latency spike"],
        contract_versions: ["capital-scaling/v1"],
        created_at_iso: "2026-05-14T11:05:00.000Z",
        tone: "subtle",
      },
    ],
  });
  const frictionImpact = resolveExecutionTcaSizingImpact(frictionSummary);
  const frictionGovernance = buildGovernanceBalanceSummary({
    intentScore: 0.61,
    executionQuality: 0.66,
    attentionScore: 0.7,
    executionTca: frictionSummary,
    temporalSizing: {
      state: "OPEN",
      multiplier: 1,
      cap_pct: 100,
      summary_label: "EXEC SIZE OPEN x1.00 · cap 100%",
      reasons: [],
    },
  });

  const baseline = computeCapitalScalingDecision({
    accountEquity: 10_000,
    intentScore: 0.61,
    executionQuality: 0.66,
    attentionScore: 0.7,
    temporalStability: 0.74,
    desyncAlphaScore: 0.58,
    volatility: 0.34,
    drawdown: 0.02,
    currentPortfolioRisk: 0.01,
    recentWinrate: 0.57,
    openTradeCount: 1,
  });
  const withGovernanceBalance = computeCapitalScalingDecision({
    accountEquity: 10_000,
    intentScore: 0.61,
    executionQuality: 0.66,
    attentionScore: 0.7,
    temporalStability: 0.74,
    desyncAlphaScore: 0.58,
    volatility: 0.34,
    drawdown: 0.02,
    currentPortfolioRisk: 0.01,
    recentWinrate: 0.57,
    openTradeCount: 1,
    governanceBalanceOutput: frictionGovernance,
  });

  expect(frictionImpact.block).toBe(false);
  expect(frictionImpact.multiplier).toBe(0.55);
  expect(frictionGovernance.state).toBe("PRESSURED");
  expect(frictionGovernance.multiplier).toBeLessThan(1);
  expect(withGovernanceBalance.governanceBalanceFactor).toBe(frictionGovernance.multiplier);
  expect(withGovernanceBalance.recommendedRiskUsd).toBeLessThan(baseline.recommendedRiskUsd);
  expect(withGovernanceBalance.reasons).toContain("governance_balance_state:pressured");

  const blockedTca = {
    ...frictionSummary,
    state: "BLOCKED",
    recommended_action: "BLOCK",
  };
  const blockedGovernance = buildGovernanceBalanceSummary({
    intentScore: 0.61,
    executionQuality: 0.66,
    attentionScore: 0.7,
    executionTca: blockedTca,
    temporalSizing: {
      state: "LOCKED",
      multiplier: 0,
      cap_pct: 0,
      summary_label: "EXEC SIZE LOCKED x0.00 · cap 0%",
      reasons: ["execution_reality_temporal_sizing:locked"],
    },
  });
  const blocked = computeCapitalScalingDecision({
    accountEquity: 10_000,
    intentScore: 0.61,
    executionQuality: 0.66,
    attentionScore: 0.7,
    temporalStability: 0.74,
    desyncAlphaScore: 0.58,
    volatility: 0.34,
    drawdown: 0.02,
    currentPortfolioRisk: 0.01,
    recentWinrate: 0.57,
    openTradeCount: 1,
    governanceBalanceOutput: blockedGovernance,
  });

  expect(blockedGovernance.no_trade).toBe(true);
  expect(blocked.allow).toBe(false);
  expect(blocked.recommendedRiskUsd).toBe(0);
  expect(blocked.reasons).toContain("governance_balance_no_trade");
});

test("structural memory layers feed governance balance instead of direct multi-cut sizing", async () => {
  const timeline = buildGovernanceReplayDetailedTimeline({
    journalEntries: [
      buildJournalEntry({
        id: "layer-1",
        createdAtIso: "2026-05-15T10:00:00.000Z",
        action: "capital-scaling-updated",
        detail: "capital throttled after prolonged pressure",
        meta: { route_mode: "maker_primary" },
      }),
      buildJournalEntry({
        id: "layer-2",
        createdAtIso: "2026-05-15T10:03:00.000Z",
        action: "oracle-review-required",
        detail: "routing degraded and risk review remains active",
        meta: { route_mode: "taker_fallback" },
      }),
      buildJournalEntry({
        id: "layer-3",
        createdAtIso: "2026-05-15T10:05:00.000Z",
        action: "capital-scaling-updated",
        detail: "capital still stale under repeated replay pressure",
        meta: { route_mode: "taker_fallback" },
      }),
    ],
    limit: 8,
  });
  const venueDecay = buildVenueDecayMemorySummary({
    venueQualityScore: 0.44,
    replayInfraHealthScore: 0.52,
    replayLatencyMs: 360,
    governanceReplayTimeline: timeline,
  });
  const capitalAging = buildCapitalAgingGovernanceSummary({
    drawdownPct: 6.4,
    exposureRatio: 0.74,
    openTradeCount: 4,
    unrealizedPnlPct: -4.2,
    accountFreeUsd: 4200,
    governanceReplayTimeline: timeline,
  });
  const contagion = buildContagionMemorySummary({
    crossMarket: {
      state: "INCOHERENT",
      score_pct: 31,
      reasons: ["cross_market_incoherent"],
      summary_label: "INCOHERENT · MIXED · 31%",
      dominant_regime: "MIXED",
      metrics: {
        coverage_pct: 78,
        freshness_pct: 66,
        coherence_pct: 24,
        pair_count: 6,
      },
      basket: [
        { code: "BTC", label: "Bitcoin", instrument: "BTCUSDT", venue: "binance-public", timeframe: "5m", role: "risk", available: true, direction: "DOWN", change_pct: -1.12, freshness_pct: 92, reason_tags: [] },
        { code: "ETH", label: "Ethereum", instrument: "ETHUSDT", venue: "binance-public", timeframe: "5m", role: "risk", available: true, direction: "DOWN", change_pct: -0.88, freshness_pct: 90, reason_tags: [] },
        { code: "US100", label: "US100", instrument: "US100", venue: "mt5", timeframe: "5m", role: "risk", available: true, direction: "DOWN", change_pct: -0.66, freshness_pct: 70, reason_tags: [] },
        { code: "DXY", label: "Dollar Index", instrument: "DXY", venue: "mt5", timeframe: "5m", role: "hedge", available: true, direction: "UP", change_pct: 0.44, freshness_pct: 68, reason_tags: [] },
      ],
    },
  });
  const globalDecay = buildGlobalConfidenceDecaySummary({
    adjustedScore: 0.74,
    adjustedScoreBayes: 0.7,
    overlayDecisionConsensus: 38,
    weightedConsensus: 34,
    overlayDecisionRegime: "high",
    replayLatencyMs: 360,
    microSpreadBps: 9.4,
    microImbalance: 0.67,
    venueDecayMemory: venueDecay,
    capitalAgingGovernance: capitalAging,
    contagionMemory: contagion,
  });
  const recoveryMomentum = buildRecoveryMomentumSummary({
    executionRealityTemporalSizing: {
      state: "TIGHT",
      multiplier: 0.4,
      cap_pct: 40,
      summary_label: "EXEC SIZE TIGHT x0.40 · cap 40%",
      reasons: ["execution_reality_memory:recovering"],
    },
    venueDecayMemory: venueDecay,
    contagionMemory: contagion,
    globalConfidenceDecay: globalDecay,
    crossMarket: {
      state: "INCOHERENT",
      score_pct: 31,
      reasons: ["cross_market_incoherent"],
      summary_label: "INCOHERENT · MIXED · 31%",
      dominant_regime: "MIXED",
      metrics: {
        coverage_pct: 78,
        freshness_pct: 66,
        coherence_pct: 24,
        pair_count: 6,
      },
      basket: [
        { code: "BTC", label: "Bitcoin", instrument: "BTCUSDT", venue: "binance-public", timeframe: "5m", role: "risk", available: true, direction: "DOWN", change_pct: -1.12, freshness_pct: 92, reason_tags: [] },
      ],
    },
  });
  const governanceBalance = buildGovernanceBalanceSummary({
    intentScore: 0.64,
    executionQuality: 0.68,
    attentionScore: 0.74,
    temporalSizing: {
      state: "TIGHT",
      multiplier: 0.4,
      cap_pct: 40,
      summary_label: "EXEC SIZE TIGHT x0.40 · cap 40%",
      reasons: ["execution_reality_memory:recovering"],
    },
    venueDecayMemory: venueDecay,
    capitalAgingGovernance: capitalAging,
    contagionMemory: contagion,
    globalConfidenceDecay: globalDecay,
    recoveryMomentum,
    crossMarket: {
      state: "INCOHERENT",
      score_pct: 31,
      reasons: ["cross_market_incoherent"],
      summary_label: "INCOHERENT · MIXED · 31%",
      dominant_regime: "MIXED",
      metrics: {
        coverage_pct: 78,
        freshness_pct: 66,
        coherence_pct: 24,
        pair_count: 6,
      },
      basket: [
        { code: "BTC", label: "Bitcoin", instrument: "BTCUSDT", venue: "binance-public", timeframe: "5m", role: "risk", available: true, direction: "DOWN", change_pct: -1.12, freshness_pct: 92, reason_tags: [] },
      ],
    },
  });
  const capitalDecision = computeCapitalScalingDecision({
    accountEquity: 10_000,
    intentScore: 0.64,
    executionQuality: 0.68,
    attentionScore: 0.74,
    temporalStability: 0.7,
    desyncAlphaScore: 0.6,
    volatility: 0.36,
    drawdown: 0.064,
    currentPortfolioRisk: 0.03,
    recentWinrate: 0.58,
    openTradeCount: 4,
    governanceBalanceOutput: governanceBalance,
  });

  expect(venueDecay.state).toBe("LOCKED");
  expect(capitalAging.state).toBe("STALE");
  expect(contagion.state).toBe("SYSTEMIC");
  expect(globalDecay.state).toBe("BLOCKED");
  expect(globalDecay.effective_score_full).toBeLessThan(globalDecay.base_score);
  expect(globalDecay.reasons).toContain("global_confidence_venue:locked");
  expect(globalDecay.reasons).toContain("global_confidence_capital:stale");
  expect(governanceBalance.state).toBe("LOCKED");
  expect(governanceBalance.pressure_normalization.normalized_protection_pct).toBeGreaterThan(governanceBalance.pressure_normalization.normalized_opportunity_pct);
  expect(governanceBalance.no_trade).toBe(true);
  expect(governanceBalance.aggression_budget.allowed_exposure_pct).toBe(0);
  expect(capitalDecision.governanceBalanceFactor).toBe(0);
  expect(capitalDecision.reasons).toContain("governance_balance_no_trade");
});

test("buildFinalDecisionTruth degrades admissibility when capital pressure constrains new risk without forcing a hard block", async () => {
  const truth = buildTruth({
    capitalPressure: {
      state: "CONSTRAINED",
      score_pct: 72,
      allow_new_risk: false,
      blocks_execution: false,
      summary_label: "CAP PRESSURE CONSTRAINED 72% · x0.42",
      reasons: ["session_guard_closed:07-22", "portfolio_heat_over_6pct"],
      dominant_constraint: "SESSION",
      metrics: {
        capital_multiplier_pct: 42,
        recommended_risk_usd: 42,
        drawdown_pct: 1.6,
        exposure_pct: 7.2,
        open_trade_count: 2,
        session_window_pass: false,
        symbol_loss_pass: true,
        symbol_loss_usd: 80,
        kill_switch_active: false,
        journal_scaling_blocked: false,
      },
    },
  });

  expect(truth.capital_pressure?.state).toBe("CONSTRAINED");
  expect(truth.execution_allowed).toBe(true);
  expect(truth.should_trade).toBe(false);
  expect(truth.action).toBe("WAIT");
  expect(truth.reasons).toContain("capital_pressure:constrained");
  expect(truth.capital_pressure?.reasons).toContain("session_guard_closed:07-22");
});

test("capital scar memory canonicalises scarred regime memory that destroyed capital", async () => {
  const capitalScar = buildCapitalScarMemorySummary({
    pnlAnalyticsSnapshot: {
      stats: {
        tradeCount: 12,
        pnlUsd: -420,
        winrate: 0.33,
        avgWin: 38,
        avgLoss: -64,
        expectancy: -22,
        sharpeLike: -0.44,
        profitFactor: 0.62,
        maxDrawdownPct: 6.4,
      },
      execution: {
        avgSlippageBps: 6.8,
        avgLatencyMs: 144,
        avgFillRate: 0.58,
        samples: 9,
      },
      liquidity: {
        accuracy: 0.42,
        samples: 9,
        supportiveHitRate: 0.4,
        adverseHitRate: 0.46,
      },
      regimePerformance: {
        trend: {
          tradeCount: 2,
          pnlUsd: 24,
          winrate: 0.5,
          avgWin: 18,
          avgLoss: -12,
          expectancy: 3,
          sharpeLike: 0.2,
          profitFactor: 1.2,
          maxDrawdownPct: 1.1,
        },
        chop: {
          tradeCount: 3,
          pnlUsd: -36,
          winrate: 0.33,
          avgWin: 16,
          avgLoss: -20,
          expectancy: -6,
          sharpeLike: -0.18,
          profitFactor: 0.8,
          maxDrawdownPct: 2.2,
        },
        crash: {
          tradeCount: 7,
          pnlUsd: -384,
          winrate: 0.14,
          avgWin: 22,
          avgLoss: -68,
          expectancy: -38,
          sharpeLike: -0.72,
          profitFactor: 0.34,
          maxDrawdownPct: 6.1,
        },
      },
      autoOptimization: {
        action: "disable",
        sizeMultiplier: 0.25,
        reasons: ["negative_expectancy", "drawdown"],
      },
    },
    currentRegime: "CRASH",
  });

  expect(capitalScar.state).toBe("TRAUMA");
  expect(capitalScar.allow_new_risk).toBe(false);
  expect(capitalScar.pressure_bias_pct).toBeGreaterThanOrEqual(32);
  expect(capitalScar.dominant_scar).toBe("CRASH");
  expect(capitalScar.reasons).toContain("capital_scar_negative_expectancy:crash");
});

test("dynamic capital pressure absorbs capital scar memory as reusable pressure bias", async () => {
  const capitalPressure = buildDynamicCapitalPressureSummary({
    capitalScalingDecision: {
      allow: true,
      status: "BALANCED",
      baseRiskPct: 0.01,
      edgeScore: 0.58,
      edgeMultiplier: 1,
      riskFactor: 0.9,
      performanceFactor: 0.9,
      portfolioHeatFactor: 1,
      scaleAdjustmentFactor: 1,
      multiplier: 0.88,
      recommendedRiskUsd: 88,
      reasons: ["performance_soft_cap"],
    },
    dailyDrawdownPct: 1.2,
    exposureRatio: 0.038,
    openTradeCount: 1,
    autoSessionGuard: {
      pass: true,
      label: "07-22",
    },
    autoSymbolLoss: {
      pass: true,
      cumulativeLossUsd: 40,
      overCap: false,
      localDisabled: false,
    },
    autoRiskEngine: {
      killSwitchActive: false,
      drawdownKillTriggered: false,
    },
    journalWindowScalingLiveBlocked: false,
    capitalScar: {
      state: "SCARRED",
      score_pct: 61,
      allow_new_risk: false,
      pressure_bias_pct: 18,
      summary_label: "CAP SCAR SCARRED 61% · CRASH",
      reasons: ["capital_scar_negative_expectancy:crash"],
      dominant_scar: "CRASH",
      metrics: {
        regime: "CRASH",
        regime_trade_count: 7,
        regime_pnl_usd: -384,
        regime_expectancy_usd: -38,
        regime_drawdown_pct: 6.1,
        global_drawdown_pct: 6.4,
        execution_slippage_bps: 6.8,
        execution_fill_rate_pct: 58,
        liquidity_accuracy_pct: 42,
      },
    },
  });

  expect(capitalPressure.state).toBe("ELEVATED");
  expect(capitalPressure.dominant_constraint).toBe("CAPITAL_SCAR");
  expect(capitalPressure.reasons).toContain("capital_scar:scarred");
});

test("buildFinalDecisionTruth increases no-trade sensitivity when capital scar memory marks current regime as scarred", async () => {
  const truth = buildTruth({
    capitalScar: {
      state: "SCARRED",
      score_pct: 61,
      allow_new_risk: false,
      pressure_bias_pct: 18,
      summary_label: "CAP SCAR SCARRED 61% · CRASH",
      reasons: ["capital_scar_negative_expectancy:crash"],
      dominant_scar: "CRASH",
      metrics: {
        regime: "CRASH",
        regime_trade_count: 7,
        regime_pnl_usd: -384,
        regime_expectancy_usd: -38,
        regime_drawdown_pct: 6.1,
        global_drawdown_pct: 6.4,
        execution_slippage_bps: 6.8,
        execution_fill_rate_pct: 58,
        liquidity_accuracy_pct: 42,
      },
    },
  });

  expect(truth.capital_scar?.state).toBe("SCARRED");
  expect(truth.execution_allowed).toBe(true);
  expect(truth.should_trade).toBe(false);
  expect(truth.action).toBe("REDUCE");
  expect(truth.reasons).toContain("capital_scar:scarred");
});

test("execution reality score closes the loop between real execution costs and stability", async () => {
  const executionReality = buildExecutionRealitySummary({
    pnlAnalyticsSnapshot: {
      stats: {
        tradeCount: 9,
        pnlUsd: -120,
        winrate: 0.44,
        avgWin: 32,
        avgLoss: -40,
        expectancy: -7,
        sharpeLike: -0.18,
        profitFactor: 0.88,
        maxDrawdownPct: 3.2,
      },
      execution: {
        avgSlippageBps: 8.6,
        avgLatencyMs: 620,
        avgFillRate: 0.63,
        samples: 8,
      },
      liquidity: {
        accuracy: 0.49,
        samples: 8,
        supportiveHitRate: 0.46,
        adverseHitRate: 0.39,
      },
      regimePerformance: {
        trend: {
          tradeCount: 3,
          pnlUsd: 20,
          winrate: 0.66,
          avgWin: 15,
          avgLoss: -10,
          expectancy: 4,
          sharpeLike: 0.21,
          profitFactor: 1.15,
          maxDrawdownPct: 1.1,
        },
        chop: {
          tradeCount: 3,
          pnlUsd: -48,
          winrate: 0.33,
          avgWin: 14,
          avgLoss: -18,
          expectancy: -6,
          sharpeLike: -0.22,
          profitFactor: 0.76,
          maxDrawdownPct: 2.4,
        },
        crash: {
          tradeCount: 3,
          pnlUsd: -92,
          winrate: 0.33,
          avgWin: 18,
          avgLoss: -32,
          expectancy: -12,
          sharpeLike: -0.31,
          profitFactor: 0.7,
          maxDrawdownPct: 3.2,
        },
      },
      autoOptimization: {
        action: "reduce",
        sizeMultiplier: 0.5,
        reasons: ["fill_rate_degraded", "slippage_above_budget"],
      },
    },
    stabilitySnapshot: {
      mode: "guarded",
      monitorScore: 0.57,
      driftWatchdog: "WATCH",
      shadowFallbackRatePct: 1.8,
      timeoutRatePct: 0.9,
      dnsTransientRatePct: 0.3,
      degradedUsageRatioPct: 2.2,
      externalKillSwitchActive: false,
      shouldBlockExecution: false,
      comparatorLabel: "guarded comparator",
      alerts: [],
      reasons: ["partial_fill_watchdog"],
    },
  });

  expect(executionReality.state).toBe("DEGRADED");
  expect(executionReality.blocks_execution).toBe(false);
  expect(executionReality.allow_new_risk).toBe(false);
  expect(executionReality.dominant_drag).toBe("SLIPPAGE");
  expect(executionReality.reasons).toContain("execution_reality_optimizer:reduce");
});

test("buildFinalDecisionTruth degrades admissibility when execution reality score shows real execution drift", async () => {
  const truth = buildTruth({
    executionReality: {
      state: "CAUTION",
      score_pct: 61,
      allow_new_risk: true,
      blocks_execution: false,
      size_cap_pct: 60,
      summary_label: "EXEC REAL CAUTION 61%",
      reasons: ["execution_reality_slippage:5.20bps", "execution_reality_watchdog:watch"],
      dominant_drag: "SLIPPAGE",
      metrics: {
        execution_samples: 7,
        liquidity_samples: 7,
        slippage_bps: 5.2,
        latency_ms: 410,
        fill_rate_pct: 76,
        liquidity_accuracy_pct: 63,
        stability_mode: "guarded",
        stability_monitor_pct: 63,
        drift_watchdog: "WATCH",
        optimization_action: "reduce",
      },
    },
  });

  expect(truth.execution_reality?.state).toBe("CAUTION");
  expect(truth.execution_allowed).toBe(true);
  expect(truth.should_trade).toBe(false);
  expect(truth.action).toBe("REDUCE");
  expect(truth.reasons).toContain("execution_reality:caution");
});

test("buildFinalDecisionTruth blocks execution when execution reality score reaches halt", async () => {
  const truth = buildTruth({
    executionReality: {
      state: "HALT",
      score_pct: 18,
      allow_new_risk: false,
      blocks_execution: true,
      size_cap_pct: 0,
      summary_label: "EXEC REAL HALT 18%",
      reasons: ["execution_reality_stability_mode:halted", "execution_reality_optimizer:disable"],
      dominant_drag: "STABILITY",
      metrics: {
        execution_samples: 9,
        liquidity_samples: 9,
        slippage_bps: 11.6,
        latency_ms: 880,
        fill_rate_pct: 52,
        liquidity_accuracy_pct: 41,
        stability_mode: "halted",
        stability_monitor_pct: 28,
        drift_watchdog: "CRITICAL",
        optimization_action: "disable",
      },
    },
  });

  expect(truth.execution_allowed).toBe(false);
  expect(truth.blocking_layer).toBe("execution_reality");
  expect(truth.action).toBe("BLOCK");
  expect(truth.reasons).toContain("execution_reality:halt");
});

test("execution reality memory distinguishes episodic accidents from persistent drift", async () => {
  const episodic = buildExecutionRealityMemorySnapshot({
    previous: null,
    current: {
      state: "CAUTION",
      score_pct: 61,
      allow_new_risk: true,
      blocks_execution: false,
      size_cap_pct: 60,
      summary_label: "EXEC REAL CAUTION 61%",
      reasons: ["execution_reality_slippage:5.20bps"],
      dominant_drag: "SLIPPAGE",
      metrics: {
        execution_samples: 7,
        liquidity_samples: 7,
        slippage_bps: 5.2,
        latency_ms: 410,
        fill_rate_pct: 76,
        liquidity_accuracy_pct: 63,
        stability_mode: "guarded",
        stability_monitor_pct: 63,
        drift_watchdog: "WATCH",
        optimization_action: "reduce",
      },
    },
    stabilitySnapshot: {
      mode: "guarded",
      monitorScore: 0.63,
      driftWatchdog: "WATCH",
      shadowFallbackRatePct: 1.1,
      timeoutRatePct: 0.2,
      dnsTransientRatePct: 0.1,
      degradedUsageRatioPct: 0.4,
      externalKillSwitchActive: false,
      shouldBlockExecution: false,
      comparatorLabel: "stable comparator",
      alerts: [],
      reasons: ["partial_fill_watchdog"],
    },
    volatilityRegime: "CHOP",
  });
  const persistent = buildExecutionRealityMemorySnapshot({
    previous: episodic,
    current: {
      ...episodic,
      state: "DEGRADED",
      score_pct: 44,
      allow_new_risk: false,
      summary_label: "EXEC REAL DEGRADED 44%",
      reasons: ["execution_reality_slippage:8.60bps", "execution_reality_optimizer:reduce"],
      metrics: {
        execution_samples: 8,
        liquidity_samples: 8,
        slippage_bps: 8.6,
        latency_ms: 620,
        fill_rate_pct: 63,
        liquidity_accuracy_pct: 49,
        stability_mode: "guarded",
        stability_monitor_pct: 57,
        drift_watchdog: "WATCH",
        optimization_action: "reduce",
      },
      dominant_drag: "SLIPPAGE",
      blocks_execution: false,
      size_cap_pct: 25,
    },
    stabilitySnapshot: {
      mode: "guarded",
      monitorScore: 0.57,
      driftWatchdog: "WATCH",
      shadowFallbackRatePct: 1.8,
      timeoutRatePct: 0.9,
      dnsTransientRatePct: 0.3,
      degradedUsageRatioPct: 2.2,
      externalKillSwitchActive: false,
      shouldBlockExecution: false,
      comparatorLabel: "guarded comparator",
      alerts: [],
      reasons: ["partial_fill_watchdog"],
    },
    volatilityRegime: "CHOP",
  });

  expect(episodic.memory_state).toBe("EPISODIC");
  expect(episodic.allow_new_risk).toBe(true);
  expect(persistent.memory_state).toBe("PERSISTENT");
  expect(persistent.allow_new_risk).toBe(false);
  expect(persistent.persistent_cycles).toBeGreaterThanOrEqual(2);
  expect(persistent.reasons).toContain("execution_reality_memory_repeat:slippage");
});

test("execution reality memory emits persistent and stabilized temporal events", async () => {
  const previous = buildExecutionRealityMemorySnapshot({
    previous: null,
    current: {
      state: "DEGRADED",
      score_pct: 44,
      allow_new_risk: false,
      blocks_execution: false,
      size_cap_pct: 25,
      summary_label: "EXEC REAL DEGRADED 44%",
      reasons: ["execution_reality_slippage:8.60bps"],
      dominant_drag: "SLIPPAGE",
      metrics: {
        execution_samples: 8,
        liquidity_samples: 8,
        slippage_bps: 8.6,
        latency_ms: 620,
        fill_rate_pct: 63,
        liquidity_accuracy_pct: 49,
        stability_mode: "guarded",
        stability_monitor_pct: 57,
        drift_watchdog: "WATCH",
        optimization_action: "reduce",
      },
    },
    stabilitySnapshot: {
      mode: "guarded",
      monitorScore: 0.57,
      driftWatchdog: "WATCH",
      shadowFallbackRatePct: 1.8,
      timeoutRatePct: 0.9,
      dnsTransientRatePct: 0.3,
      degradedUsageRatioPct: 2.2,
      externalKillSwitchActive: false,
      shouldBlockExecution: false,
      comparatorLabel: "guarded comparator",
      alerts: [],
      reasons: ["partial_fill_watchdog"],
    },
    volatilityRegime: "CHOP",
  });
  const persistent = buildExecutionRealityMemorySnapshot({
    previous,
    current: {
      state: "DEGRADED",
      score_pct: 41,
      allow_new_risk: false,
      blocks_execution: false,
      size_cap_pct: 25,
      summary_label: "EXEC REAL DEGRADED 41%",
      reasons: ["execution_reality_slippage:9.40bps"],
      dominant_drag: "SLIPPAGE",
      metrics: {
        execution_samples: 9,
        liquidity_samples: 9,
        slippage_bps: 9.4,
        latency_ms: 680,
        fill_rate_pct: 61,
        liquidity_accuracy_pct: 47,
        stability_mode: "guarded",
        stability_monitor_pct: 54,
        drift_watchdog: "WATCH",
        optimization_action: "reduce",
      },
    },
    stabilitySnapshot: {
      mode: "guarded",
      monitorScore: 0.54,
      driftWatchdog: "WATCH",
      shadowFallbackRatePct: 1.9,
      timeoutRatePct: 1.2,
      dnsTransientRatePct: 0.4,
      degradedUsageRatioPct: 2.5,
      externalKillSwitchActive: false,
      shouldBlockExecution: false,
      comparatorLabel: "guarded comparator",
      alerts: [],
      reasons: ["partial_fill_watchdog"],
    },
    volatilityRegime: "CHOP",
  });
  const recovered = buildExecutionRealityMemorySnapshot({
    previous: persistent,
    current: {
      state: "ALIGNED",
      score_pct: 84,
      allow_new_risk: true,
      blocks_execution: false,
      size_cap_pct: 100,
      summary_label: "EXEC REAL ALIGNED 84%",
      reasons: [],
      dominant_drag: "NONE",
      metrics: {
        execution_samples: 10,
        liquidity_samples: 10,
        slippage_bps: 2.1,
        latency_ms: 180,
        fill_rate_pct: 91,
        liquidity_accuracy_pct: 74,
        stability_mode: "live",
        stability_monitor_pct: 81,
        drift_watchdog: "CALM",
        optimization_action: "hold",
      },
    },
    stabilitySnapshot: {
      mode: "live",
      monitorScore: 0.81,
      driftWatchdog: "CALM",
      shadowFallbackRatePct: 0.2,
      timeoutRatePct: 0,
      dnsTransientRatePct: 0,
      degradedUsageRatioPct: 0,
      externalKillSwitchActive: false,
      shouldBlockExecution: false,
      comparatorLabel: "live comparator",
      alerts: [],
      reasons: [],
    },
    volatilityRegime: "TREND",
  });
  const event = buildExecutionRealityMemoryEvent({
    previous: persistent,
    current: recovered,
    executionReality: {
      state: "ALIGNED",
      score_pct: 84,
      allow_new_risk: true,
      blocks_execution: false,
      size_cap_pct: 100,
      summary_label: "EXEC REAL ALIGNED 84%",
      reasons: [],
      dominant_drag: "NONE",
      metrics: {
        execution_samples: 10,
        liquidity_samples: 10,
        slippage_bps: 2.1,
        latency_ms: 180,
        fill_rate_pct: 91,
        liquidity_accuracy_pct: 74,
        stability_mode: "live",
        stability_monitor_pct: 81,
        drift_watchdog: "CALM",
        optimization_action: "hold",
      },
    },
    stabilitySnapshot: {
      mode: "live",
      monitorScore: 0.81,
      driftWatchdog: "CALM",
      shadowFallbackRatePct: 0.2,
      timeoutRatePct: 0,
      dnsTransientRatePct: 0,
      degradedUsageRatioPct: 0,
      externalKillSwitchActive: false,
      shouldBlockExecution: false,
      comparatorLabel: "live comparator",
      alerts: [],
      reasons: [],
    },
    truthContext: {
      oracle_fingerprint: "fp-exec-memory",
      preferred_venue: "binance-public",
      route_mode: "best_available",
      reasons: ["execution_reality_memory:recovering"],
      should_trade: false,
      execution_allowed: true,
    },
  });

  expect(persistent.memory_state).toBe("PERSISTENT");
  expect(recovered.memory_state).toBe("RECOVERING");
  expect(event?.journal_action).toBe("execution-reality-memory-stabilized");
  expect(event?.payload.execution_reality_memory.episode_type).toBe("STABILIZED");
});

test("buildFinalDecisionTruth keeps execution guarded when execution reality memory is recovering from persistent drift", async () => {
  const truth = buildTruth({
    executionReality: {
      state: "ALIGNED",
      score_pct: 82,
      allow_new_risk: true,
      blocks_execution: false,
      size_cap_pct: 100,
      summary_label: "EXEC REAL ALIGNED 82%",
      reasons: [],
      dominant_drag: "NONE",
      metrics: {
        execution_samples: 12,
        liquidity_samples: 12,
        slippage_bps: 2.4,
        latency_ms: 190,
        fill_rate_pct: 92,
        liquidity_accuracy_pct: 76,
        stability_mode: "live",
        stability_monitor_pct: 83,
        drift_watchdog: "CALM",
        optimization_action: "hold",
      },
    },
    executionRealityMemory: {
      memory_state: "RECOVERING",
      regime: "TREND",
      current_state: "ALIGNED",
      dominant_drag: "SLIPPAGE",
      dominant_reason: "execution_reality_slippage:9.40bps",
      persistence_score_pct: 62,
      recurrence_count: 0,
      persistent_cycles: 0,
      size_cap_pct: 40,
      allow_new_risk: false,
      blocks_execution: false,
      summary_label: "EXEC MEM RECOVERING 62% · TREND",
      reasons: ["execution_reality_memory_recovering"],
      metrics: {
        current_score_pct: 82,
        current_size_cap_pct: 100,
        current_slippage_bps: 2.4,
        current_fill_rate_pct: 92,
        stability_mode: "live",
        stability_monitor_pct: 83,
        drift_watchdog: "CALM",
      },
    },
  });

  expect(truth.execution_reality_memory?.memory_state).toBe("RECOVERING");
  expect(truth.execution_allowed).toBe(true);
  expect(truth.should_trade).toBe(false);
  expect(truth.action).toBe("REDUCE");
  expect(truth.reasons).toContain("execution_reality_memory:recovering");
});

test("execution reality temporal sizing reinjects persistent memory into live size calibration", async () => {
  const sizing = buildExecutionRealityTemporalSizingSummary({
    executionReality: {
      state: "ALIGNED",
      score_pct: 84,
      allow_new_risk: true,
      blocks_execution: false,
      size_cap_pct: 100,
      summary_label: "EXEC REAL ALIGNED 84%",
      reasons: [],
      dominant_drag: "NONE",
      metrics: {
        execution_samples: 10,
        liquidity_samples: 10,
        slippage_bps: 2.1,
        latency_ms: 180,
        fill_rate_pct: 91,
        liquidity_accuracy_pct: 74,
        stability_mode: "live",
        stability_monitor_pct: 81,
        drift_watchdog: "CALM",
        optimization_action: "hold",
      },
    },
    executionRealityMemory: {
      memory_state: "RECOVERING",
      regime: "TREND",
      current_state: "ALIGNED",
      dominant_drag: "SLIPPAGE",
      dominant_reason: "execution_reality_slippage:9.40bps",
      persistence_score_pct: 62,
      recurrence_count: 0,
      persistent_cycles: 0,
      size_cap_pct: 40,
      allow_new_risk: false,
      blocks_execution: false,
      summary_label: "EXEC MEM RECOVERING 62% · TREND",
      reasons: ["execution_reality_memory_recovering"],
      metrics: {
        current_score_pct: 82,
        current_size_cap_pct: 100,
        current_slippage_bps: 2.4,
        current_fill_rate_pct: 92,
        stability_mode: "live",
        stability_monitor_pct: 83,
        drift_watchdog: "CALM",
      },
    },
  });

  expect(sizing.state).toBe("CAUTION");
  expect(sizing.cap_pct).toBe(40);
  expect(sizing.multiplier).toBe(0.4);
  expect(sizing.reasons).toContain("execution_reality_memory:recovering");
});

test("execution reality governance degrades before pnl damage when live engine diverges from aligned replay", async () => {
  const governance = buildExecutionRealityGovernanceSummary({
    executionReality: {
      state: "ALIGNED",
      score_pct: 84,
      allow_new_risk: true,
      blocks_execution: false,
      size_cap_pct: 100,
      summary_label: "EXEC REAL ALIGNED 84%",
      reasons: [],
      dominant_drag: "NONE",
      metrics: {
        execution_samples: 12,
        liquidity_samples: 12,
        slippage_bps: 2.1,
        latency_ms: 160,
        fill_rate_pct: 94,
        liquidity_accuracy_pct: 79,
        stability_mode: "live",
        stability_monitor_pct: 86,
        drift_watchdog: "CALM",
        optimization_action: "hold",
      },
    },
    executionRealityMemory: {
      memory_state: "CLEAR",
      regime: "TREND",
      current_state: "ALIGNED",
      dominant_drag: "NONE",
      dominant_reason: "",
      persistence_score_pct: 0,
      recurrence_count: 0,
      persistent_cycles: 0,
      size_cap_pct: 100,
      allow_new_risk: true,
      blocks_execution: false,
      summary_label: "EXEC MEM CLEAR 0% · TREND",
      reasons: [],
      metrics: {
        current_score_pct: 84,
        current_size_cap_pct: 100,
        current_slippage_bps: 2.1,
        current_fill_rate_pct: 94,
        stability_mode: "live",
        stability_monitor_pct: 86,
        drift_watchdog: "CALM",
      },
    },
    executionEngine: {
      mode: "AGGRESSIVE",
      action: "WAIT",
      activation: "FULL_LIVE",
      reasons: ["spread_wait", "latency_elevated"],
      entry: {
        style: "cross-spread",
        venue: "binance-public",
        price: 101.2,
        referencePrice: 101,
        targetSpreadBps: 8.8,
        initialDelayMs: 180,
        slices: 3,
      },
      latency: {
        currentMs: 242,
        guardMs: 160,
        state: "elevated",
      },
      slippage: {
        expectedBps: 7.6,
        recentBps: 2.1,
        budgetBps: 3.4,
      },
      repricing: {
        enabled: true,
        action: "reprice",
        trigger: "spread_expansion",
        maxAttempts: 2,
        stepBps: 1.2,
      },
      partialFillHandling: {
        action: "cancel_replace",
        expectedFillRatio: 0.54,
        recentFillRatio: 0.58,
        targetFillRatio: 0.82,
        resliceDelayMs: 320,
      },
      shadow: {
        status: "shadow",
        confidence: 0.41,
      },
    },
  });

  expect(governance.state).toBe("DEFENSIVE");
  expect(governance.allow_new_risk).toBe(false);
  expect(governance.reality_drift).toBe("DIVERGENT");
  expect(governance.size_cap_pct).toBe(35);
  expect(governance.reasons).toContain("execution_reality_governance_drift:divergent");
  expect(governance.reasons).toContain("execution_reality_governance_spread:dislocated");
});

test("buildFinalDecisionTruth reduces execution when governance detects live reality drift before pnl damage", async () => {
  const truth = buildTruth({
    executionReality: {
      state: "ALIGNED",
      score_pct: 84,
      allow_new_risk: true,
      blocks_execution: false,
      size_cap_pct: 100,
      summary_label: "EXEC REAL ALIGNED 84%",
      reasons: [],
      dominant_drag: "NONE",
      metrics: {
        execution_samples: 12,
        liquidity_samples: 12,
        slippage_bps: 2.1,
        latency_ms: 160,
        fill_rate_pct: 94,
        liquidity_accuracy_pct: 79,
        stability_mode: "live",
        stability_monitor_pct: 86,
        drift_watchdog: "CALM",
        optimization_action: "hold",
      },
    },
    executionRealityGovernance: {
      state: "CAUTION",
      score_pct: 61,
      allow_new_risk: false,
      blocks_execution: false,
      size_cap_pct: 72,
      summary_label: "EXEC GOV CAUTION 61% · drift WATCH",
      reasons: ["execution_reality_governance_drift:watch", "execution_reality_governance_routing:watch"],
      dominant_driver: "REALITY_DRIFT",
      reality_drift: "WATCH",
      slippage_regime: "ELEVATED",
      venue_stability: "FRAGILE",
      routing_fragility: "WATCH",
      latency_pressure: "ELEVATED",
      spread_degradation: "ELEVATED",
      fill_reliability: "WATCH",
      microstructure_integrity: "WATCH",
      metrics: {
        execution_quality_score_pct: 74,
        venue_stability_pct: 61,
        routing_fragility_pct: 42,
        latency_pressure_pct: 48,
        spread_degradation_pct: 44,
        fill_reliability_pct: 69,
        microstructure_integrity_pct: 63,
        reality_drift_pct: 34,
      },
    },
    executionRealityMemory: {
      memory_state: "CLEAR",
      regime: "TREND",
      current_state: "ALIGNED",
      dominant_drag: "NONE",
      dominant_reason: "",
      persistence_score_pct: 0,
      recurrence_count: 0,
      persistent_cycles: 0,
      size_cap_pct: 100,
      allow_new_risk: true,
      blocks_execution: false,
      summary_label: "EXEC MEM CLEAR 0% · TREND",
      reasons: [],
      metrics: {
        current_score_pct: 84,
        current_size_cap_pct: 100,
        current_slippage_bps: 2.1,
        current_fill_rate_pct: 94,
        stability_mode: "live",
        stability_monitor_pct: 86,
        drift_watchdog: "CALM",
      },
    },
    riskMultiplier: 1,
  });

  expect(truth.execution_reality_governance?.state).toBe("CAUTION");
  expect(truth.execution_allowed).toBe(true);
  expect(truth.should_trade).toBe(false);
  expect(truth.action).toBe("REDUCE");
  expect(truth.reasons).toContain("execution_reality_governance:caution");
  expect(truth.reasons).toContain("reality_drift:watch");
});

test("capital scaling canonicalises execution reality temporal memory into recommended risk", async () => {
  const withoutTemporalMemory = computeCapitalScalingDecision({
    accountEquity: 10_000,
    intentScore: 0.64,
    executionQuality: 0.71,
    attentionScore: 0.72,
    temporalStability: 0.7,
    desyncAlphaScore: 0.58,
    volatility: 0.32,
    drawdown: 0.02,
    currentPortfolioRisk: 0.018,
    recentWinrate: 0.56,
    openTradeCount: 1,
    unrealizedPnlPct: 0.01,
  });
  const temporalBalance = buildGovernanceBalanceSummary({
    intentScore: 0.64,
    executionQuality: 0.71,
    attentionScore: 0.72,
    temporalSizing: {
      state: "TIGHT",
      multiplier: 0.4,
      cap_pct: 40,
      summary_label: "EXEC SIZE TIGHT x0.40 · cap 40%",
      reasons: ["execution_reality_memory:recovering", "execution_reality_temporal_cap:40%"],
    },
  });
  const withTemporalMemory = computeCapitalScalingDecision({
    accountEquity: 10_000,
    intentScore: 0.64,
    executionQuality: 0.71,
    attentionScore: 0.72,
    temporalStability: 0.7,
    desyncAlphaScore: 0.58,
    volatility: 0.32,
    drawdown: 0.02,
    currentPortfolioRisk: 0.018,
    recentWinrate: 0.56,
    openTradeCount: 1,
    unrealizedPnlPct: 0.01,
    governanceBalanceOutput: temporalBalance,
  });

  expect(withoutTemporalMemory.recommendedRiskUsd).toBeGreaterThan(withTemporalMemory.recommendedRiskUsd);
  expect(temporalBalance.state).toBe("PRESSURED");
  expect(withTemporalMemory.governanceBalanceFactor).toBe(temporalBalance.multiplier);
  expect(withTemporalMemory.reasons).toContain("governance_balance_state:pressured");
  expect(withTemporalMemory.multiplier).toBeCloseTo(withoutTemporalMemory.multiplier * temporalBalance.multiplier, 5);
  expect(withTemporalMemory.reasons).toContain("governance_balance_action:stabilize");
});

test("capital scaling rejects legacy governance side-channel inputs outside governance balance output", async () => {
  expect(() => computeCapitalScalingDecision({
    accountEquity: 10_000,
    intentScore: 0.64,
    executionQuality: 0.71,
    attentionScore: 0.72,
    temporalStability: 0.7,
    desyncAlphaScore: 0.58,
    volatility: 0.32,
    drawdown: 0.02,
    currentPortfolioRisk: 0.018,
    recentWinrate: 0.56,
    openTradeCount: 1,
    governanceBalanceMultiplier: 0.5,
  } as any)).toThrow(/Use governanceBalanceOutput only/);
});

test("governance inertia memory detects halt recovery oscillation before reacceleration", async () => {
  const timeline = buildGovernanceReplayDetailedTimeline({
    journalEntries: [
      buildJournalEntry({ id: "osc-1", createdAtIso: "2026-05-15T10:00:00.000Z", action: "oracle-review-required", detail: "latency spike blocks route", meta: { route_mode: "halt" } }),
      buildJournalEntry({ id: "osc-2", createdAtIso: "2026-05-15T10:02:00.000Z", action: "capital-scaling-updated", detail: "recovery window opened", meta: { route_mode: "recover" } }),
      buildJournalEntry({ id: "osc-3", createdAtIso: "2026-05-15T10:04:00.000Z", action: "oracle-review-required", detail: "route degraded again", meta: { route_mode: "halt" } }),
      buildJournalEntry({ id: "osc-4", createdAtIso: "2026-05-15T10:06:00.000Z", action: "capital-scaling-updated", detail: "recovery resumes", meta: { route_mode: "recover" } }),
    ],
    limit: 8,
  });
  const inertia = buildGovernanceInertiaMemorySummary({
    temporalPressure: 76,
    tcaPressure: 74,
    venuePressure: 62,
    agingPressure: 44,
    contagionPressure: 40,
    confidenceDecayPressure: 58,
    memoryPressure: 68,
    scarPressure: 20,
    timeline,
    falseRecoveryRiskPct: 52,
  });

  expect(inertia.oscillation_frequency_pct).toBeGreaterThan(0);
  expect(inertia.false_recovery_rate_pct).toBeGreaterThan(0);
  expect(inertia.recovery_stability_pct).toBeLessThan(70);
  expect(inertia.state === "WATCH" || inertia.state === "FATIGUED" || inertia.state === "LOCKED").toBeTruthy();
});

test("reacceleration governance opens only when recovery is stable and inertia stays contained", async () => {
  const calmInertia = buildGovernanceInertiaMemorySummary({
    temporalPressure: 14,
    tcaPressure: 18,
    venuePressure: 20,
    agingPressure: 12,
    contagionPressure: 10,
    confidenceDecayPressure: 22,
    memoryPressure: 18,
    scarPressure: 4,
    falseRecoveryRiskPct: 12,
  });
  const ready = buildReaccelerationGovernanceSummary({
    protectionPressurePct: 22,
    opportunityPressurePct: 74,
    confidenceRecoveryPct: 78,
    recoveryMomentumPct: 76,
    riskReaccelerationPct: 72,
    falseRecoveryRiskPct: 12,
    governanceInertiaMemory: calmInertia,
  });

  expect(ready.reacceleration_eligible).toBeTruthy();
  expect(ready.aggression_budget_pct).toBeGreaterThan(50);
  expect(ready.state === "REACCELERATION_READY" || ready.state === "REACCELERATING").toBeTruthy();

  const fatiguedInertia = buildGovernanceInertiaMemorySummary({
    temporalPressure: 72,
    tcaPressure: 68,
    venuePressure: 72,
    agingPressure: 58,
    contagionPressure: 52,
    confidenceDecayPressure: 66,
    memoryPressure: 76,
    scarPressure: 22,
    falseRecoveryRiskPct: 64,
  });
  const blocked = buildReaccelerationGovernanceSummary({
    protectionPressurePct: 78,
    opportunityPressurePct: 70,
    confidenceRecoveryPct: 62,
    recoveryMomentumPct: 58,
    riskReaccelerationPct: 64,
    falseRecoveryRiskPct: 64,
    governanceInertiaMemory: fatiguedInertia,
  });

  expect(blocked.reacceleration_eligible).toBeFalsy();
  expect(blocked.state === "RECOVERING" || blocked.state === "OVEREXTENDED").toBeTruthy();
  expect(blocked.aggression_budget_pct).toBeLessThan(ready.aggression_budget_pct);
});

test("pressure normalization clips inflating producers and arbitrates directional conflict", async () => {
  const normalized = buildPressureNormalizationSummary({
    signals: [
      { key: "temporal", direction: "PROTECTION", raw_pct: 96, confidence_pct: 96, recency_pct: 98, prior_pct: 82 },
      { key: "tca", direction: "PROTECTION", raw_pct: 88, confidence_pct: 92, recency_pct: 94, prior_pct: 76 },
      { key: "memory", direction: "PROTECTION", raw_pct: 74, confidence_pct: 78, recency_pct: 70, prior_pct: 66 },
      { key: "intent", direction: "OPPORTUNITY", raw_pct: 82, confidence_pct: 78, recency_pct: 86, prior_pct: 70 },
      { key: "execution", direction: "OPPORTUNITY", raw_pct: 76, confidence_pct: 72, recency_pct: 82, prior_pct: 64 },
    ],
  });

  expect(normalized.normalized_protection_pct).toBeLessThan(96);
  expect(normalized.normalized_opportunity_pct).toBeLessThan(82);
  expect(normalized.conflict_pct).toBeGreaterThan(0);
  expect(normalized.reasons.some((reason) => reason.startsWith("pressure_normalization_conflict:"))).toBeTruthy();
  expect(normalized.arbitration_state === "CONFLICTED" || normalized.arbitration_state === "PROTECTION_DOMINANT").toBeTruthy();
});

test("aggression budget engine allocates cadence exposure routing diversification and velocity from governance decision", async () => {
  const budget = buildAggressionBudgetEngineSummary({
    state: "OPPORTUNISTIC",
    action: "REACCELERATE",
    cadence: "FAST",
    protectionPressurePct: 26,
    opportunityPressurePct: 78,
    confidenceRecoveryPct: 80,
    recoveryMomentumPct: 76,
    riskReaccelerationPct: 72,
    governanceInertiaPct: 18,
    freezeDragPct: 10,
    reaccelerationReadinessPct: 82,
    falseRecoveryRiskPct: 12,
    conflictPct: 14,
    baseAggressionBudgetPct: 74,
    baseCadenceBudgetPct: 68,
    baseExposureBudgetPct: 66,
    reaccelerationEligible: true,
  });

  expect(budget.aggression_budget_pct).toBeGreaterThan(60);
  expect(budget.cadence_budget_pct).toBeGreaterThan(55);
  expect(budget.exposure_budget_pct).toBeGreaterThan(60);
  expect(budget.routing_aggressiveness_pct).toBeGreaterThan(55);
  expect(budget.venue_diversification_pct).toBeGreaterThan(20);
  expect(budget.reacceleration_velocity_pct).toBeGreaterThan(45);
  expect(budget.multiplier).toBeGreaterThan(1);
});

test("execution attribution isolates execution loss from signal loss under routing and microstructure drift", async () => {
  const attribution = buildExecutionAttributionSummary({
    replayLatencyMs: 420,
    replaySlippageBps: 5.8,
    microSpreadBps: 10.2,
    microImbalance: 0.64,
    routingInfraHealthScore: 0.44,
    venueQualityScore: 0.47,
    executionQualityScore: 0.41,
    preferredRouteStability: 0.34,
    backupRouteStability: 0.68,
    predictedDeltaBps: 5.6,
    crossMarket: {
      state: "CONFIRMED",
      score_pct: 74,
      reasons: ["cross_market_confirmed"],
      summary_label: "CONFIRMED · RISK_ON · 74%",
      dominant_regime: "RISK_ON",
      metrics: {
        coverage_pct: 82,
        freshness_pct: 88,
        coherence_pct: 79,
        pair_count: 5,
      },
      basket: [
        { code: "BTC", label: "Bitcoin", instrument: "BTCUSDT", venue: "binance-public", timeframe: "5m", role: "risk", available: true, direction: "UP", change_pct: 0.94, freshness_pct: 92, reason_tags: [] },
      ],
    },
  });

  expect(attribution.state).toBe("DEGRADED");
  expect(attribution.execution_loss_share_pct).toBeGreaterThan(attribution.signal_loss_share_pct);
  expect(attribution.primary_driver === "LATENCY" || attribution.primary_driver === "MIXED").toBeTruthy();
  expect(attribution.reasons).toContain("execution_attr_latency:420ms");
  expect(attribution.reasons).toContain("execution_attr_routing:44pct");
});

test("cross venue execution intelligence rotates to backup when routing drift dominates execution loss", async () => {
  const intelligence = buildCrossVenueExecutionIntelligenceSummary({
    marketTruthLockEnabled: false,
    routingInfraHealthScore: 0.41,
    routingFailureClassification: "gateway_stale",
    preferredRoute: {
      venue: "binance-public",
      score: 0.46,
      stability_score: 0.34,
      fill_probability: 0.52,
    },
    backupRoute: {
      venue: "okx-public",
      score: 0.71,
      stability_score: 0.68,
      fill_probability: 0.76,
    },
    smartRoutingPlan: {
      orders: [
        {
          venue: "okx-public",
          side: "buy",
          price: 101.2,
          size: 48,
          notionalUsd: 4850,
          sharePct: 0.7,
          expectedLatencyMs: 118,
          expectedFillProbability: 0.76,
          routeScore: 0.71,
        },
        {
          venue: "binance-public",
          side: "buy",
          price: 101.24,
          size: 21,
          notionalUsd: 2050,
          sharePct: 0.3,
          expectedLatencyMs: 164,
          expectedFillProbability: 0.52,
          routeScore: 0.46,
        },
      ],
      requestedNotionalUsd: 6900,
      routedNotionalUsd: 6900,
      remainingNotionalUsd: 0,
      coverageRatio: 1,
      estimatedAveragePrice: 101.212,
      estimatedSlippageBps: 1.6,
      primaryVenue: "okx-public",
      venueCount: 2,
    },
    executionAttribution: {
      state: "DEGRADED",
      primary_driver: "ROUTING",
      execution_loss_share_pct: 68,
      components: {
        spread_impact_pct: 28,
        latency_impact_pct: 42,
        routing_impact_pct: 74,
        venue_impact_pct: 61,
        market_impact_pct: 18,
        timing_impact_pct: 22,
        slippage_impact_pct: 36,
        liquidity_impact_pct: 30,
      },
    },
    arbitrageActive: false,
    arbitrageNetSpreadBps: 0,
  });

  expect(intelligence.state).toBe("ROTATE");
  expect(intelligence.action).toBe("ROTATE_BACKUP");
  expect(intelligence.recommended_primary_venue).toBe("okx-public");
  expect(intelligence.reasons).toContain("cross_venue_intel:rotate:okx-public");
});

test("cross venue local routing directive becomes prescriptive for rotate and split actions", async () => {
  const rotateDirective = resolveCrossVenueLocalRoutingDirective({
    summary: {
      action: "ROTATE_BACKUP",
      recommended_primary_venue: "okx-public",
      summary_label: "XVEN ROTATE okx-public",
    },
    smartRoutingPlan: {
      primaryVenue: "binance-public",
      venueCount: 2,
      coverageRatio: 1,
    },
  });

  expect(rotateDirective.preferred_venue).toBe("okx-public");
  expect(rotateDirective.route_mode_override).toBe("bestSingleVenue");
  expect(rotateDirective.allow_smart_routing_split).toBeFalsy();

  const splitDirective = resolveCrossVenueLocalRoutingDirective({
    summary: {
      action: "SPLIT_ROUTE",
      recommended_primary_venue: "okx-public",
      summary_label: "XVEN SPLIT okx-public",
    },
    smartRoutingPlan: {
      primaryVenue: "okx-public",
      venueCount: 3,
      coverageRatio: 0.92,
    },
  });

  expect(splitDirective.preferred_venue).toBe("okx-public");
  expect(splitDirective.route_mode_override).toBeNull();
  expect(splitDirective.allow_smart_routing_split).toBeTruthy();
});

test("self preservation canonicalises protect posture when human review freezes new exposure", async () => {
  const selfPreservation = buildSelfPreservationSummary({
    stabilitySnapshot: {
      mode: "guarded",
      monitorScore: 0.64,
      driftWatchdog: "WATCH",
      shadowFallbackRatePct: 2.4,
      timeoutRatePct: 0,
      dnsTransientRatePct: 0,
      degradedUsageRatioPct: 0,
      externalKillSwitchActive: false,
      shouldBlockExecution: false,
      comparatorLabel: "fallback 2.40% · diff 1 · net 0.0/0.0/0.0%",
      alerts: [],
      reasons: ["partial_fill_watchdog"],
    },
    systemRuntimeGuard: null,
    watchdogStatus: "OK",
    governanceMode: "ADAPTIVE",
    opportunityGateReasons: [],
    mt5ReviewRequired: true,
    mt5ReviewAcknowledged: false,
    backendHaltNewExposure: false,
    backendCloseOnly: false,
    backendReasons: [],
    learningFrozen: false,
    persistenceAvailable: true,
    freezeReasons: [],
  });

  expect(selfPreservation.state).toBe("PROTECT");
  expect(selfPreservation.allow_new_risk).toBe(false);
  expect(selfPreservation.blocks_execution).toBe(false);
  expect(selfPreservation.dominant_trigger).toBe("MT5_REVIEW");
  expect(selfPreservation.reasons).toContain("mt5_review_required");
});

test("buildFinalDecisionTruth degrades admissibility when self preservation protects the stack without hard blocking execution", async () => {
  const truth = buildTruth({
    selfPreservation: {
      state: "PROTECT",
      score_pct: 68,
      allow_new_risk: false,
      blocks_execution: false,
      summary_label: "SELF PRES PROTECT 68% · GUARDED",
      reasons: ["mt5_review_required", "partial_fill_watchdog"],
      dominant_trigger: "MT5_REVIEW",
      metrics: {
        stability_mode: "guarded",
        stability_monitor_pct: 64,
        drift_watchdog: "WATCH",
        runtime_guard_active: false,
        runtime_guard_code: "none",
        watchdog_status: "OK",
        governance_mode: "ADAPTIVE",
        opportunity_gate_count: 0,
        mt5_review_required: true,
        mt5_review_acknowledged: false,
        halt_new_exposure: false,
        close_only: false,
        learning_frozen: false,
        persistence_available: true,
      },
    },
  });

  expect(truth.self_preservation?.state).toBe("PROTECT");
  expect(truth.execution_allowed).toBe(true);
  expect(truth.should_trade).toBe(false);
  expect(truth.action).toBe("WAIT");
  expect(truth.reasons).toContain("self_preservation:protect");
  expect(truth.self_preservation?.reasons).toContain("mt5_review_required");
});

test("self healing recovery memory canonicalises revalidation confidence after recovery pressure", async () => {
  const truth = buildTruth({
    selfPreservation: {
      state: "DEFENSIVE",
      score_pct: 46,
      allow_new_risk: false,
      blocks_execution: false,
      summary_label: "SELF PRES DEFENSIVE 46% · GUARDED",
      reasons: ["partial_fill_watchdog"],
      dominant_trigger: "STABILITY",
      metrics: {
        stability_mode: "guarded",
        stability_monitor_pct: 62,
        drift_watchdog: "WATCH",
        runtime_guard_active: false,
        runtime_guard_code: "none",
        watchdog_status: "OK",
        governance_mode: "ADAPTIVE",
        opportunity_gate_count: 0,
        mt5_review_required: false,
        mt5_review_acknowledged: false,
        halt_new_exposure: false,
        close_only: false,
        learning_frozen: false,
        persistence_available: true,
      },
    },
  });

  const snapshot = buildSelfHealingRecoverySnapshot({
    finalDecisionTruth: truth,
    selfHealingSnapshot: {
      mode: "defensive",
      riskMultiplier: 0.4,
      action: "LIMIT_TRADING",
      drift: "EXECUTION_DRIFT",
      lossRate: 0.42,
      executionEnabled: true,
      dominantFailureSource: "execution",
      adaptSpeed: 0.58,
      reasons: ["loss_spiral_guard", "execution_drift_detected"],
    },
    selfPreservation: truth.self_preservation,
    stabilitySnapshot: {
      mode: "guarded",
      monitorScore: 0.62,
      driftWatchdog: "WATCH",
      shadowFallbackRatePct: 3.2,
      timeoutRatePct: 0.4,
      dnsTransientRatePct: 0,
      degradedUsageRatioPct: 0,
      externalKillSwitchActive: false,
      shouldBlockExecution: false,
      comparatorLabel: "fallback 3.20% · diff 2 · net 0.4/0.0/0.0%",
      alerts: [],
      reasons: ["partial_fill_watchdog"],
    },
    volatilityRegime: "volatile",
  });

  expect(snapshot.recovery_tier).toBe("REVALIDATING");
  expect(snapshot.recovery_confidence_pct).toBeGreaterThan(30);
  expect(snapshot.relapse_probability_pct).toBeGreaterThanOrEqual(40);
  expect(snapshot.adaptive_cooldown_ms).toBeGreaterThanOrEqual(120000);
});

test("adaptive recovery cooldown scales with fragility, relapse and protection state", async () => {
  const baseCooldown = buildAdaptiveRecoveryCooldown({
    fragilityScore: 0.22,
    relapseProbabilityScore: 0.18,
    selfHealingAction: "SAFE",
    selfPreservationState: "OPEN",
  });
  const protectedCooldown = buildAdaptiveRecoveryCooldown({
    fragilityScore: 0.58,
    relapseProbabilityScore: 0.64,
    selfHealingAction: "LIMIT_TRADING",
    selfPreservationState: "PROTECT",
  });
  const recoveryCooldown = buildAdaptiveRecoveryCooldown({
    fragilityScore: 0.58,
    relapseProbabilityScore: 0.64,
    selfHealingAction: "RECOVERY",
    selfPreservationState: "LOCKDOWN",
  });

  expect(baseCooldown).toBeGreaterThanOrEqual(30000);
  expect(protectedCooldown).toBeGreaterThan(baseCooldown);
  expect(recoveryCooldown).toBeGreaterThan(protectedCooldown);
  expect(recoveryCooldown % 5000).toBe(0);
});

test("self healing recovery memory emits precursor and stabilized payloads", async () => {
  const fragileTruth = buildTruth({
    selfPreservation: {
      state: "DEFENSIVE",
      score_pct: 48,
      allow_new_risk: false,
      blocks_execution: false,
      summary_label: "SELF PRES DEFENSIVE 48% · GUARDED",
      reasons: ["partial_fill_watchdog"],
      dominant_trigger: "STABILITY",
      metrics: {
        stability_mode: "guarded",
        stability_monitor_pct: 60,
        drift_watchdog: "WATCH",
        runtime_guard_active: false,
        runtime_guard_code: "none",
        watchdog_status: "OK",
        governance_mode: "ADAPTIVE",
        opportunity_gate_count: 0,
        mt5_review_required: false,
        mt5_review_acknowledged: false,
        halt_new_exposure: false,
        close_only: false,
        learning_frozen: false,
        persistence_available: true,
      },
    },
  });
  const stableTruth = buildTruth({ generatedAtIso: "2026-05-14T00:05:00.000Z" });

  const fragileSnapshot = buildSelfHealingRecoverySnapshot({
    finalDecisionTruth: fragileTruth,
    selfHealingSnapshot: {
      mode: "defensive",
      riskMultiplier: 0.5,
      action: "LIMIT_TRADING",
      drift: "EXECUTION_DRIFT",
      lossRate: 0.3,
      executionEnabled: true,
      dominantFailureSource: "execution",
      adaptSpeed: 0.52,
      reasons: ["execution_drift_detected"],
    },
    selfPreservation: fragileTruth.self_preservation,
    stabilitySnapshot: {
      mode: "guarded",
      monitorScore: 0.61,
      driftWatchdog: "WATCH",
      shadowFallbackRatePct: 2.1,
      timeoutRatePct: 0,
      dnsTransientRatePct: 0,
      degradedUsageRatioPct: 0,
      externalKillSwitchActive: false,
      shouldBlockExecution: false,
      comparatorLabel: "fallback 2.10% · diff 1 · net 0.0/0.0/0.0%",
      alerts: [],
      reasons: ["partial_fill_watchdog"],
    },
    volatilityRegime: "trend",
  });
  const stableSnapshot = buildSelfHealingRecoverySnapshot({
    finalDecisionTruth: stableTruth,
    selfHealingSnapshot: {
      mode: "normal",
      riskMultiplier: 1,
      action: "SAFE",
      drift: "STABLE",
      lossRate: 0.08,
      executionEnabled: true,
      dominantFailureSource: "execution",
      adaptSpeed: 0.84,
      reasons: [],
    },
    selfPreservation: stableTruth.self_preservation,
    stabilitySnapshot: {
      mode: "live",
      monitorScore: 0.88,
      driftWatchdog: "CALM",
      shadowFallbackRatePct: 0,
      timeoutRatePct: 0,
      dnsTransientRatePct: 0,
      degradedUsageRatioPct: 0,
      externalKillSwitchActive: false,
      shouldBlockExecution: false,
      comparatorLabel: "fallback 0.00% · diff 0 · net 0.0/0.0/0.0%",
      alerts: [],
      reasons: [],
    },
    volatilityRegime: "trend",
  });

  const episodeEvent = buildSelfHealingRecoveryMemoryEvent({
    previous: stableSnapshot,
    current: fragileSnapshot,
    finalDecisionTruth: fragileTruth,
    selfHealingSnapshot: {
      mode: "defensive",
      riskMultiplier: 0.5,
      action: "LIMIT_TRADING",
      drift: "EXECUTION_DRIFT",
      lossRate: 0.3,
      executionEnabled: true,
      dominantFailureSource: "execution",
      adaptSpeed: 0.52,
      reasons: ["execution_drift_detected"],
    },
    selfPreservation: fragileTruth.self_preservation,
    stabilitySnapshot: {
      mode: "guarded",
      monitorScore: 0.61,
      driftWatchdog: "WATCH",
      shadowFallbackRatePct: 2.1,
      timeoutRatePct: 0,
      dnsTransientRatePct: 0,
      degradedUsageRatioPct: 0,
      externalKillSwitchActive: false,
      shouldBlockExecution: false,
      comparatorLabel: "fallback 2.10% · diff 1 · net 0.0/0.0/0.0%",
      alerts: [],
      reasons: ["partial_fill_watchdog"],
    },
  });
  const stabilizedEvent = buildSelfHealingRecoveryMemoryEvent({
    previous: fragileSnapshot,
    current: stableSnapshot,
    finalDecisionTruth: stableTruth,
    selfHealingSnapshot: {
      mode: "normal",
      riskMultiplier: 1,
      action: "SAFE",
      drift: "STABLE",
      lossRate: 0.08,
      executionEnabled: true,
      dominantFailureSource: "execution",
      adaptSpeed: 0.84,
      reasons: [],
    },
    selfPreservation: stableTruth.self_preservation,
    stabilitySnapshot: {
      mode: "live",
      monitorScore: 0.88,
      driftWatchdog: "CALM",
      shadowFallbackRatePct: 0,
      timeoutRatePct: 0,
      dnsTransientRatePct: 0,
      degradedUsageRatioPct: 0,
      externalKillSwitchActive: false,
      shouldBlockExecution: false,
      comparatorLabel: "fallback 0.00% · diff 0 · net 0.0/0.0/0.0%",
      alerts: [],
      reasons: [],
    },
  });

  expect(episodeEvent?.journal_action).toBe("self-healing-recovery-revalidation");
  expect(episodeEvent?.payload.self_healing_recovery_memory.precursor_context?.recovery_tier).toBe("STABLE");
  expect(stabilizedEvent?.journal_action).toBe("self-healing-recovery-stabilized");
  expect(stabilizedEvent?.payload.self_healing_recovery_memory.recovery_outcome?.admissibility).toBe("ADMISSIBLE");
});

test("market state map route composes tradability, market memory and edge observation", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "mc-market-state-map-"));
  const journalFile = path.join(tempDir, "journal.jsonl");
  const edgeFile = path.join(tempDir, "edge.jsonl");
  const previousJournalDir = process.env.V2_RISK_JOURNAL_DIR;
  const previousJournalFile = process.env.V2_RISK_JOURNAL_FILE;
  const previousEdgeFile = process.env.MC_EDGE_MAP_FILE;
  const previousToken = process.env.CONTROL_PLANE_TOKEN;

  process.env.V2_RISK_JOURNAL_DIR = tempDir;
  process.env.V2_RISK_JOURNAL_FILE = "journal.jsonl";
  process.env.MC_EDGE_MAP_FILE = edgeFile;
  process.env.CONTROL_PLANE_TOKEN = "test-token";

  const nowIso = new Date().toISOString();
  const finalDecisionTruth = buildTruth({ informationDensityImpactWeight: 0.22 });
  const lines = [
    {
      id: "tradability-1",
      createdAtIso: nowIso,
      symbol: "BTCUSD",
      timeframe: "1m",
      strategy: "terminal",
      action: "tradability-snapshot",
      detail: "SUFFICIENT TREND · EXECUTE ELIGIBLE 78%",
      meta: {
        final_decision_truth: finalDecisionTruth,
        tradability_snapshot: {
          volatility_regime: "TREND",
          market_session: "LONDON",
          state: "TRADABLE",
          action: "EXECUTE",
          route_mode: "best_available",
          execution_allowed: true,
          should_trade: true,
          edge_state: "ELIGIBLE",
          blocking_layer: "none",
          information_density_state: "SUFFICIENT",
          score_pct: 78,
          entropy_pct: 24,
          reasons: [],
        },
      },
    },
    {
      id: "memory-1",
      createdAtIso: nowIso,
      symbol: "BTCUSD",
      timeframe: "1m",
      strategy: "terminal",
      action: "market-memory-snapshot",
      detail: "RELIABLE TREND · truth 82% · exec 86%",
      meta: {
        final_decision_truth: finalDecisionTruth,
        market_memory_snapshot: {
          volatility_regime: "TREND",
          market_session: "LONDON",
          venue: "BINANCE-PUBLIC",
          route_mode: "best_available",
          market_truth_state: "RELIABLE",
          truth_quality_pct: 82,
          admissibility_state: "ADMISSIBLE",
          information_density_state: "SUFFICIENT",
          edge_state: "ELIGIBLE",
          blocking_layer: "none",
          false_context_family: "FALSE_SYNC",
          false_context_no_trade: false,
          false_context_trigger_layer: "market_truth",
          false_context_reasons: ["freshness_degraded"],
          coherence_pct: 84,
          freshness_pct: 94,
          information_density_pct: 78,
          execution_quality_pct: 86,
          anomaly_burden_pct: 18,
        },
      },
    },
    {
      id: "transition-1",
      createdAtIso: nowIso,
      symbol: "BTCUSD",
      timeframe: "1m",
      strategy: "terminal",
      action: "market-transition",
      detail: "MARKET_TRUTH_SHIFT RANGE/WATCH -> TREND/RELIABLE",
      meta: {
        market_transition: {
          transition_type: "MARKET_TRUTH_SHIFT",
          from_regime: "RANGE",
          to_regime: "TREND",
          from_market_truth_state: "WATCH",
          to_market_truth_state: "RELIABLE",
          from_admissibility_state: "WATCH",
          to_admissibility_state: "ADMISSIBLE",
          from_blocking_layer: "none",
          to_blocking_layer: "none",
          from_density_state: "THIN",
          to_density_state: "SUFFICIENT",
          from_edge_state: "OBSERVE",
          to_edge_state: "ELIGIBLE",
          truth_quality_delta_pct: 18,
        },
      },
    },
    {
      id: "transition-2",
      createdAtIso: nowIso,
      symbol: "BTCUSD",
      timeframe: "1m",
      strategy: "terminal",
      action: "market-transition",
      detail: "ADMISSIBILITY_SHIFT CHOP/WATCH/WATCH -> CHOP/DEGRADED/INADMISSIBLE",
      meta: {
        market_transition: {
          transition_type: "ADMISSIBILITY_SHIFT",
          from_regime: "CHOP",
          to_regime: "CHOP",
          from_market_truth_state: "WATCH",
          to_market_truth_state: "DEGRADED",
          from_admissibility_state: "WATCH",
          to_admissibility_state: "INADMISSIBLE",
          from_blocking_layer: "none",
          to_blocking_layer: "execution_lock",
          from_density_state: "THIN",
          to_density_state: "DEGRADED",
          from_edge_state: "OBSERVE",
          to_edge_state: "BLOCKED",
          truth_quality_delta_pct: -24,
        },
      },
    },
    {
      id: "degradation-1",
      createdAtIso: nowIso,
      symbol: "BTCUSD",
      timeframe: "1m",
      strategy: "terminal",
      action: "market-execution-degradation",
      detail: "execution quality 42% under CHOP",
      meta: {
        execution_degradation: {
          degradation_type: "EXECUTION_QUALITY_DEGRADED",
          venue: "BINANCE-PUBLIC",
          route_mode: "best_available",
          regime: "CHOP",
          market_truth_state: "DEGRADED",
          edge_state: "BLOCKED",
          blocking_layer: "execution_lock",
          execution_quality_pct: 42,
          detail: "execution quality 42% under CHOP",
        },
      },
    },
    {
      id: "anomaly-1",
      createdAtIso: nowIso,
      symbol: "BTCUSD",
      timeframe: "1m",
      strategy: "terminal",
      action: "market-microstructure-anomaly",
      detail: "venue desynchronization on alpha window",
      meta: {
        microstructure_anomaly: {
          anomaly_type: "VENUE_ALPHA_DESYNCHRONIZATION",
          anomaly_family: "VENUE_DESYNC",
          operator_family: "venue",
          venue: "BINANCE-PUBLIC",
          route_mode: "best_available",
          regime: "TREND",
          severity: "warn",
          market_truth_state: "WATCH",
          blocking_layer: "none",
          evidence_metrics: {
            persistence_pct: 66,
            confidence_pct: 58,
          },
          detail: "venue desynchronization on alpha window",
        },
      },
    },
  ];
  await writeFile(journalFile, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  await writeFile(edgeFile, `${JSON.stringify({
    intent_id: "edge-1",
    venue: "binance-public",
    instrument: "BTCUSD",
    ts_intent: nowIso,
    side: "long",
    pnl_bps: 12.5,
    outcome: "win",
    reaction_class: "FAST",
    regime: "TREND",
    regime_confidence: 0.84,
  })}\n`, "utf8");

  try {
    const request = new NextRequest("http://localhost:3000/api/market-state-map?symbol=BTCUSD&timeframe=1m&strategy=terminal&sinceDays=14&limit=1200&windowHours=24");
    const response = await marketStateMapRoute.GET(request);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.scope.symbol).toBe("BTCUSD");
    expect(payload.cells.length).toBeGreaterThan(0);
    expect(payload.cells[0].truthQualityPct).toBeGreaterThan(0);
    expect(payload.cells.some((cell: { key: { regime: string } }) => cell.key.regime === "TREND")).toBeTruthy();
    expect(payload.transitions.some((transition: { transitionType: string }) => transition.transitionType === "MARKET_TRUTH_SHIFT")).toBeTruthy();
    expect(payload.transitions.some((transition: { transitionType: string; fromAdmissibilityState: string; toAdmissibilityState: string; regime: string }) => transition.transitionType === "ADMISSIBILITY_SHIFT" && transition.fromAdmissibilityState === "WATCH" && transition.toAdmissibilityState === "INADMISSIBLE" && transition.regime === "CHOP")).toBeTruthy();
    expect(payload.inadmissibleZones.length).toBeGreaterThanOrEqual(0);
    expect(payload.cells[0].reasons.some((reason: string) => reason.includes("anomalies") || reason.includes("truth"))).toBeTruthy();
    expect(payload.anomalyFamilyBreakdown.some((row: { anomalyFamily: string; venue: string; timeframe: string }) => row.anomalyFamily === "VENUE_DESYNC" && row.venue === "BINANCE-PUBLIC" && row.timeframe === "1m")).toBeTruthy();
    expect(payload.falseContextTaxonomy.some((row: { contextFamily: string }) => row.contextFamily === "FALSE_SYNC")).toBeTruthy();
    expect(payload.falseContextTaxonomy.some((row: { contextFamily: string }) => row.contextFamily === "FALSE_EXECUTION_CONTEXT")).toBeTruthy();
    expect(payload.venueTimeframeRegimeMap.some((row: { venue: string; timeframe: string; regime: string }) => row.venue === "BINANCE-PUBLIC" && row.timeframe === "1m" && row.regime === "TREND")).toBeTruthy();
    expect(payload.venueTimeframeRegimeMap.some((row: { venue: string; timeframe: string; regime: string; state: string }) => row.venue === "BINANCE-PUBLIC" && row.timeframe === "1m" && row.regime === "CHOP" && (row.state === "DEGRADED" || row.state === "INADMISSIBLE"))).toBeTruthy();
    expect(payload.marketTemperature.scorePct).toBeGreaterThan(0);
    expect(["COLD", "WARM", "HOT", "OVERHEATED"]).toContain(payload.marketTemperature.state);
    expect(payload.structuralContexts.some((row: { regime: string; marketTemperaturePct: number; transitionTypes: string[] }) => row.regime === "CHOP" && row.marketTemperaturePct > 0 && row.transitionTypes.includes("ADMISSIBILITY_SHIFT"))).toBeTruthy();
    expect(payload.summary.dominantFailureModes.length).toBeGreaterThanOrEqual(0);
  } finally {
    if (previousJournalDir === undefined) {
      delete process.env.V2_RISK_JOURNAL_DIR;
    } else {
      process.env.V2_RISK_JOURNAL_DIR = previousJournalDir;
    }
    if (previousJournalFile === undefined) {
      delete process.env.V2_RISK_JOURNAL_FILE;
    } else {
      process.env.V2_RISK_JOURNAL_FILE = previousJournalFile;
    }
    if (previousEdgeFile === undefined) {
      delete process.env.MC_EDGE_MAP_FILE;
    } else {
      process.env.MC_EDGE_MAP_FILE = previousEdgeFile;
    }
    if (previousToken === undefined) {
      delete process.env.CONTROL_PLANE_TOKEN;
    } else {
      process.env.CONTROL_PLANE_TOKEN = previousToken;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("market regime archive compresses regime governance history into canonical rows", async () => {
  const allowTruth = buildTruth({ generatedAtIso: "2026-05-15T08:00:00.000Z" });
  const blockedTruth = buildTruth({
    generatedAtIso: "2026-05-15T08:05:00.000Z",
    executionRealityGovernance: {
      state: "LOCKDOWN",
      score_pct: 82,
      summary_label: "LOCKDOWN · BROKEN · 82%",
      dominant_driver: "REALITY_DRIFT",
      reasons: ["execution_reality_governance_drift:broken", "execution_reality_governance_route:fragile"],
      reality_drift: "BROKEN",
      slippage_regime: "DISLOCATED",
      venue_stability: "UNSTABLE",
      routing_fragility: "FRAGILE",
      latency_pressure: "SEVERE",
      spread_degradation: "DISLOCATED",
      fill_reliability: "FAILED",
      microstructure_integrity: "BROKEN",
      allows_new_risk: false,
      blocks_execution: true,
      size_cap_pct: 0,
      metrics: {
        reality_drift_pct: 92,
        slippage_regime_pct: 85,
        venue_stability_pct: 78,
        routing_fragility_pct: 82,
        latency_pressure_pct: 81,
        spread_degradation_pct: 88,
        fill_reliability_pct: 79,
        microstructure_integrity_pct: 90,
      },
    },
  });
  const entries = [
    buildJournalEntry({
      id: "snap-trend-1",
      createdAtIso: "2026-05-15T08:00:00.000Z",
      action: "market-memory-snapshot",
      detail: "RELIABLE TREND · truth 82% · exec 86%",
      finalDecisionTruth: allowTruth,
      meta: {
        market_memory_snapshot: {
          volatility_regime: "TREND",
          market_session: "LONDON",
          venue: "BINANCE-PUBLIC",
          route_mode: "best_available",
          market_truth_state: "RELIABLE",
          truth_quality_pct: 82,
          admissibility_state: "ADMISSIBLE",
          information_density_state: "SUFFICIENT",
          edge_state: "ELIGIBLE",
          blocking_layer: "none",
          false_context_family: null,
          false_context_no_trade: false,
          false_context_trigger_layer: "none",
          false_context_reasons: [],
          coherence_pct: 84,
          freshness_pct: 92,
          information_density_pct: 78,
          execution_quality_pct: 86,
          anomaly_burden_pct: 16,
        },
      },
    }),
    buildJournalEntry({
      id: "transition-chop-1",
      createdAtIso: "2026-05-15T08:03:00.000Z",
      action: "market-transition",
      detail: "REGIME_SHIFT TREND/RELIABLE/ADMISSIBLE -> CHOP/DEGRADED/INADMISSIBLE",
      meta: {
        market_transition: {
          transition_type: "REGIME_SHIFT",
          from_regime: "TREND",
          to_regime: "CHOP",
          from_market_truth_state: "RELIABLE",
          to_market_truth_state: "DEGRADED",
          from_admissibility_state: "ADMISSIBLE",
          to_admissibility_state: "INADMISSIBLE",
          from_blocking_layer: "none",
          to_blocking_layer: "execution_reality",
          from_density_state: "SUFFICIENT",
          to_density_state: "DEGRADED",
          from_edge_state: "ELIGIBLE",
          to_edge_state: "BLOCKED",
          truth_quality_delta_pct: -22,
        },
      },
    }),
    buildJournalEntry({
      id: "snap-chop-1",
      createdAtIso: "2026-05-15T08:05:00.000Z",
      action: "market-memory-snapshot",
      detail: "DEGRADED CHOP · truth 46% · exec 42%",
      finalDecisionTruth: blockedTruth,
      meta: {
        market_memory_snapshot: {
          volatility_regime: "CHOP",
          market_session: "LONDON",
          venue: "BINANCE-PUBLIC",
          route_mode: "best_available",
          market_truth_state: "DEGRADED",
          truth_quality_pct: 46,
          admissibility_state: "INADMISSIBLE",
          information_density_state: "DEGRADED",
          edge_state: "BLOCKED",
          blocking_layer: "execution_reality",
          false_context_family: "FALSE_EXECUTION_CONTEXT",
          false_context_no_trade: true,
          false_context_trigger_layer: "execution_reality",
          false_context_reasons: ["execution_reality_governance_drift:broken"],
          coherence_pct: 52,
          freshness_pct: 74,
          information_density_pct: 38,
          execution_quality_pct: 42,
          anomaly_burden_pct: 61,
        },
      },
    }),
    buildJournalEntry({
      id: "degradation-chop-1",
      createdAtIso: "2026-05-15T08:06:00.000Z",
      action: "market-execution-degradation",
      detail: "execution quality 42% under CHOP",
      meta: {
        execution_degradation: {
          degradation_type: "EXECUTION_QUALITY_DEGRADED",
          venue: "BINANCE-PUBLIC",
          route_mode: "best_available",
          regime: "CHOP",
          market_truth_state: "DEGRADED",
          edge_state: "BLOCKED",
          blocking_layer: "execution_reality",
          execution_quality_pct: 42,
          detail: "execution quality 42% under CHOP",
        },
      },
    }),
  ];

  const summary = buildMarketRegimeArchiveSummary(entries, {
    currentRegime: "CHOP",
    nowMs: Date.parse("2026-05-15T09:00:00.000Z"),
  });

  expect(summary.schema_version).toBe("market-regime-archive/v1");
  expect(summary.active_regime).toBe("CHOP");
  expect(summary.hottest_regime).toBe("CHOP");
  expect(summary.dominant_blocking_layer).toBe("execution_reality");
  expect(["WATCH", "FRAGILE", "BROKEN"]).toContain(summary.archive_state);
  expect(summary.rows.find((row) => row.regime === "CHOP")?.block_count).toBeGreaterThan(0);
  expect(summary.rows.find((row) => row.regime === "CHOP")?.dominant_blocking_layer).toBe("execution_reality");
  expect(summary.latest_transition?.to_regime).toBe("CHOP");
  expect(summary.reasons.some((reason) => reason.includes("blocking_layer:execution_reality"))).toBeTruthy();
  expect(summary.persistent_compression.compression_ratio_pct).toBeGreaterThan(0);
  expect(summary.persistent_compression.state === "LEARNING" || summary.persistent_compression.state === "COMPACT" || summary.persistent_compression.state === "SATURATED").toBeTruthy();
});

test("market regime archive exposes persistent compression and relapse risk from repeated transitions", async () => {
  const truth = buildTruth({ generatedAtIso: "2026-05-15T08:00:00.000Z" });
  const entries = [
    buildJournalEntry({
      id: "trend-a",
      createdAtIso: "2026-05-12T08:00:00.000Z",
      action: "market-memory-snapshot",
      detail: "TREND stable",
      finalDecisionTruth: truth,
      meta: {
        market_memory_snapshot: {
          volatility_regime: "TREND",
          market_session: "LONDON",
          venue: "BINANCE-PUBLIC",
          route_mode: "best_available",
          market_truth_state: "RELIABLE",
          truth_quality_pct: 82,
          admissibility_state: "ADMISSIBLE",
          information_density_state: "SUFFICIENT",
          edge_state: "ELIGIBLE",
          blocking_layer: "none",
          false_context_family: null,
          false_context_no_trade: false,
          false_context_trigger_layer: "none",
          false_context_reasons: [],
          coherence_pct: 84,
          freshness_pct: 92,
          information_density_pct: 78,
          execution_quality_pct: 83,
          anomaly_burden_pct: 16,
        },
        market_transition: {
          transition_type: "REGIME_SHIFT",
          from_regime: "CHOP",
          to_regime: "TREND",
          from_market_truth_state: "DEGRADED",
          to_market_truth_state: "RELIABLE",
          from_admissibility_state: "WATCH",
          to_admissibility_state: "ADMISSIBLE",
        },
      },
    }),
    buildJournalEntry({
      id: "chop-a",
      createdAtIso: "2026-05-13T08:00:00.000Z",
      action: "market-memory-snapshot",
      detail: "CHOP degraded",
      finalDecisionTruth: truth,
      meta: {
        market_memory_snapshot: {
          volatility_regime: "CHOP",
          market_session: "LONDON",
          venue: "BINANCE-PUBLIC",
          route_mode: "best_available",
          market_truth_state: "DEGRADED",
          truth_quality_pct: 48,
          admissibility_state: "INADMISSIBLE",
          information_density_state: "DEGRADED",
          edge_state: "BLOCKED",
          blocking_layer: "execution_reality",
          false_context_family: "FALSE_EXECUTION_CONTEXT",
          false_context_no_trade: true,
          false_context_trigger_layer: "execution_reality",
          false_context_reasons: ["execution_reality_governance_drift:broken"],
          coherence_pct: 52,
          freshness_pct: 75,
          information_density_pct: 38,
          execution_quality_pct: 41,
          anomaly_burden_pct: 63,
        },
        market_transition: {
          transition_type: "REGIME_SHIFT",
          from_regime: "TREND",
          to_regime: "CHOP",
          from_market_truth_state: "RELIABLE",
          to_market_truth_state: "DEGRADED",
          from_admissibility_state: "ADMISSIBLE",
          to_admissibility_state: "INADMISSIBLE",
        },
      },
    }),
    buildJournalEntry({
      id: "trend-b",
      createdAtIso: "2026-05-14T08:00:00.000Z",
      action: "market-memory-snapshot",
      detail: "TREND stable again",
      finalDecisionTruth: truth,
      meta: {
        market_memory_snapshot: {
          volatility_regime: "TREND",
          market_session: "LONDON",
          venue: "BINANCE-PUBLIC",
          route_mode: "best_available",
          market_truth_state: "RELIABLE",
          truth_quality_pct: 84,
          admissibility_state: "ADMISSIBLE",
          information_density_state: "SUFFICIENT",
          edge_state: "ELIGIBLE",
          blocking_layer: "none",
          false_context_family: null,
          false_context_no_trade: false,
          false_context_trigger_layer: "none",
          false_context_reasons: [],
          coherence_pct: 86,
          freshness_pct: 93,
          information_density_pct: 80,
          execution_quality_pct: 85,
          anomaly_burden_pct: 14,
        },
        market_transition: {
          transition_type: "REGIME_SHIFT",
          from_regime: "CHOP",
          to_regime: "TREND",
          from_market_truth_state: "DEGRADED",
          to_market_truth_state: "RELIABLE",
          from_admissibility_state: "INADMISSIBLE",
          to_admissibility_state: "ADMISSIBLE",
        },
      },
    }),
    buildJournalEntry({
      id: "transition-a",
      createdAtIso: "2026-05-12T08:05:00.000Z",
      action: "market-transition",
      detail: "CHOP -> TREND",
      finalDecisionTruth: truth,
      meta: {
        market_transition: {
          transition_type: "REGIME_SHIFT",
          from_regime: "CHOP",
          to_regime: "TREND",
          from_market_truth_state: "DEGRADED",
          to_market_truth_state: "RELIABLE",
          from_admissibility_state: "WATCH",
          to_admissibility_state: "ADMISSIBLE",
        },
      },
    }),
    buildJournalEntry({
      id: "transition-b",
      createdAtIso: "2026-05-13T08:05:00.000Z",
      action: "market-transition",
      detail: "TREND -> CHOP",
      finalDecisionTruth: truth,
      meta: {
        market_transition: {
          transition_type: "REGIME_SHIFT",
          from_regime: "TREND",
          to_regime: "CHOP",
          from_market_truth_state: "RELIABLE",
          to_market_truth_state: "DEGRADED",
          from_admissibility_state: "ADMISSIBLE",
          to_admissibility_state: "INADMISSIBLE",
        },
      },
    }),
    buildJournalEntry({
      id: "transition-c",
      createdAtIso: "2026-05-14T08:05:00.000Z",
      action: "market-transition",
      detail: "CHOP -> TREND again",
      finalDecisionTruth: truth,
      meta: {
        market_transition: {
          transition_type: "REGIME_SHIFT",
          from_regime: "CHOP",
          to_regime: "TREND",
          from_market_truth_state: "DEGRADED",
          to_market_truth_state: "RELIABLE",
          from_admissibility_state: "INADMISSIBLE",
          to_admissibility_state: "ADMISSIBLE",
        },
      },
    }),
  ];

  const summary = buildMarketRegimeArchiveSummary(entries, {
    currentRegime: "TREND",
    nowMs: Date.parse("2026-05-15T09:00:00.000Z"),
  });

  expect(summary.persistent_compression.persistent_transition_count).toBeGreaterThan(0);
  expect(summary.persistent_compression.dominant_transition?.from_regime).toBe("CHOP");
  expect(summary.persistent_compression.dominant_transition?.to_regime).toBe("TREND");
  expect(summary.persistent_compression.relapse_probability_pct).toBeGreaterThan(0);
  expect(summary.persistent_compression.retention_half_life_hours).toBeGreaterThanOrEqual(0);
  expect(summary.reasons.some((reason) => reason.includes("compression "))).toBeTruthy();
});

test("governance replay answers allow block and failure-layer questions from journal truth", async () => {
  const allowTruth = buildTruth({ generatedAtIso: "2026-05-15T08:00:00.000Z" });
  const blockedTruth = buildTruth({
    generatedAtIso: "2026-05-15T08:05:00.000Z",
    executionRealityGovernance: {
      state: "LOCKDOWN",
      score_pct: 82,
      summary_label: "LOCKDOWN · BROKEN · 82%",
      dominant_driver: "REALITY_DRIFT",
      reasons: ["execution_reality_governance_drift:broken", "execution_reality_governance_route:fragile"],
      reality_drift: "BROKEN",
      slippage_regime: "DISLOCATED",
      venue_stability: "UNSTABLE",
      routing_fragility: "FRAGILE",
      latency_pressure: "SEVERE",
      spread_degradation: "DISLOCATED",
      fill_reliability: "FAILED",
      microstructure_integrity: "BROKEN",
      allows_new_risk: false,
      blocks_execution: true,
      size_cap_pct: 0,
      metrics: {
        reality_drift_pct: 92,
        slippage_regime_pct: 85,
        venue_stability_pct: 78,
        routing_fragility_pct: 82,
        latency_pressure_pct: 81,
        spread_degradation_pct: 88,
        fill_reliability_pct: 79,
        microstructure_integrity_pct: 90,
      },
    },
  });
  const entries = [
    buildJournalEntry({
      id: "allow-1",
      createdAtIso: "2026-05-15T08:00:00.000Z",
      action: "market-memory-snapshot",
      detail: "RELIABLE TREND · truth 82% · exec 86%",
      finalDecisionTruth: allowTruth,
      meta: {
        market_memory_snapshot: {
          volatility_regime: "TREND",
          market_session: "LONDON",
          venue: "BINANCE-PUBLIC",
          route_mode: "best_available",
          market_truth_state: "RELIABLE",
          truth_quality_pct: 82,
          admissibility_state: "ADMISSIBLE",
          information_density_state: "SUFFICIENT",
          edge_state: "ELIGIBLE",
          blocking_layer: "none",
          false_context_family: null,
          false_context_no_trade: false,
          false_context_trigger_layer: "none",
          false_context_reasons: [],
          coherence_pct: 84,
          freshness_pct: 92,
          information_density_pct: 78,
          execution_quality_pct: 86,
          anomaly_burden_pct: 16,
        },
      },
    }),
    buildJournalEntry({
      id: "block-1",
      createdAtIso: "2026-05-15T08:05:00.000Z",
      action: "market-memory-snapshot",
      detail: "DEGRADED CHOP · truth 46% · exec 42%",
      finalDecisionTruth: blockedTruth,
      meta: {
        market_memory_snapshot: {
          volatility_regime: "CHOP",
          market_session: "LONDON",
          venue: "BINANCE-PUBLIC",
          route_mode: "best_available",
          market_truth_state: "DEGRADED",
          truth_quality_pct: 46,
          admissibility_state: "INADMISSIBLE",
          information_density_state: "DEGRADED",
          edge_state: "BLOCKED",
          blocking_layer: "execution_reality",
          false_context_family: "FALSE_EXECUTION_CONTEXT",
          false_context_no_trade: true,
          false_context_trigger_layer: "execution_reality",
          false_context_reasons: ["execution_reality_governance_drift:broken"],
          coherence_pct: 52,
          freshness_pct: 74,
          information_density_pct: 38,
          execution_quality_pct: 42,
          anomaly_burden_pct: 61,
        },
      },
    }),
  ];
  const archive = buildMarketRegimeArchiveSummary(entries, {
    currentRegime: "CHOP",
    nowMs: Date.parse("2026-05-15T09:00:00.000Z"),
  });

  const replay = buildGovernanceReplaySummary({
    journalEntries: entries,
    currentTruth: blockedTruth,
    archive,
    nowMs: Date.parse("2026-05-15T09:00:00.000Z"),
  });

  expect(replay.schema_version).toBe("governance-replay/v1");
  expect(replay.state).toBe("BLOCKED");
  expect(replay.active_layer).toBe("execution_reality");
  expect(replay.allow_answer.action).toBe("EXECUTE");
  expect(replay.block_answer.action).toBe("BLOCK");
  expect(replay.failure_answer.layer).toBe("execution_reality");
  expect(replay.timeline.length).toBeGreaterThan(0);
  expect(replay.reasons.some((reason) => reason.includes("failure_layer:execution_reality"))).toBeTruthy();
});

test("freeze v1 contracts locks the canonical truth archive and replay surfaces", async () => {
  const truth = buildTruth({ generatedAtIso: "2026-05-15T08:00:00.000Z" });
  const archive = buildMarketRegimeArchiveSummary([], { nowMs: Date.parse("2026-05-15T09:00:00.000Z") });
  const replay = buildGovernanceReplaySummary({ journalEntries: [], currentTruth: truth, archive, nowMs: Date.parse("2026-05-15T09:00:00.000Z") });

  const freeze = buildFreezeV1ContractsSummary({
    finalDecisionTruth: truth,
    marketRegimeArchive: archive,
    governanceReplay: replay,
    executionReality: { schema_version: "execution-reality/v1" },
    executionRealityGovernance: { schema_version: "execution-reality-governance/v1" },
    executionRealityMemory: { schema_version: "execution-reality-memory/v1" },
    capitalScar: { schema_version: "capital-scar-memory/v1" },
    capitalPressure: { schema_version: "dynamic-capital-pressure/v1" },
    selfPreservation: { schema_version: "self-preservation/v1" },
    capitalScaling: { schema_version: "capital-scaling/v1" },
    executionRealityTemporalSizing: { schema_version: "execution-reality-temporal-sizing/v1" },
    nowMs: Date.parse("2026-05-15T09:00:00.000Z"),
  });

  expect(freeze.schema_version).toBe("freeze-v1-contracts/v1");
  expect(freeze.freeze_state).toBe("LOCKED");
  expect(freeze.locked_contract_count).toBe(11);
  expect(freeze.contracts.every((contract) => contract.status === "LOCKED")).toBeTruthy();
  expect(freeze.reasons).toContain("final_decision_truth:final-decision-truth/v1");
});

test("governance replay route serves persisted archive replay and freeze state", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "mc-governance-replay-"));
  const journalFile = path.join(tempDir, "journal.jsonl");
  const previousJournalDir = process.env.V2_RISK_JOURNAL_DIR;
  const previousJournalFile = process.env.V2_RISK_JOURNAL_FILE;
  const previousToken = process.env.CONTROL_PLANE_TOKEN;

  process.env.V2_RISK_JOURNAL_DIR = tempDir;
  process.env.V2_RISK_JOURNAL_FILE = "journal.jsonl";
  process.env.CONTROL_PLANE_TOKEN = "test-token";

  const allowTruth = buildTruth({ generatedAtIso: "2026-05-15T08:00:00.000Z" });
  const lines = [
    buildJournalEntry({
      id: "allow-1",
      createdAtIso: "2026-05-15T08:00:00.000Z",
      action: "market-memory-snapshot",
      detail: "RELIABLE TREND · truth 82% · exec 86%",
      finalDecisionTruth: allowTruth,
      meta: {
        market_memory_snapshot: {
          volatility_regime: "TREND",
          market_session: "LONDON",
          venue: "BINANCE-PUBLIC",
          route_mode: "best_available",
          market_truth_state: "RELIABLE",
          truth_quality_pct: 82,
          admissibility_state: "ADMISSIBLE",
          information_density_state: "SUFFICIENT",
          edge_state: "ELIGIBLE",
          blocking_layer: "none",
          false_context_family: null,
          false_context_no_trade: false,
          false_context_trigger_layer: "none",
          false_context_reasons: [],
          coherence_pct: 84,
          freshness_pct: 92,
          information_density_pct: 78,
          execution_quality_pct: 86,
          anomaly_burden_pct: 16,
        },
      },
    }),
    buildJournalEntry({
      id: "capital-1",
      createdAtIso: "2026-05-15T08:02:00.000Z",
      action: "capital-scaling-updated",
      detail: "Capital BALANCED x1.12 · erm x0.72 · journal hot x0.94.",
      finalDecisionTruth: allowTruth,
      meta: {
        capital_scaling: {
          schema_version: "capital-scaling/v1",
          allow: true,
          status: "BALANCED",
          baseRiskPct: 0.01,
          edgeScore: 0.68,
          edgeMultiplier: 1.2,
          riskFactor: 1,
          performanceFactor: 1,
          portfolioHeatFactor: 1,
          scaleAdjustmentFactor: 0.94,
          executionRealityTemporalFactor: 0.72,
          multiplier: 1.12,
          recommendedRiskUsd: 112,
          reasons: ["execution_reality_temporal_sizing:caution"],
          execution_reality_temporal_sizing: {
            schema_version: "execution-reality-temporal-sizing/v1",
            state: "CAUTION",
            multiplier: 0.72,
            cap_pct: 72,
            summary_label: "EXEC SIZE CAUTION x0.72 · cap 72%",
            reasons: ["execution_reality_temporal_sizing:caution"],
          },
        },
      },
    }),
    buildJournalEntry({
      id: "block-1",
      createdAtIso: "2026-05-15T08:05:00.000Z",
      action: "market-transition",
      detail: "REGIME_SHIFT TREND/RELIABLE/ADMISSIBLE -> CHOP/DEGRADED/INADMISSIBLE",
      meta: {
        market_transition: {
          transition_type: "REGIME_SHIFT",
          from_regime: "TREND",
          to_regime: "CHOP",
          from_market_truth_state: "RELIABLE",
          to_market_truth_state: "DEGRADED",
          from_admissibility_state: "ADMISSIBLE",
          to_admissibility_state: "INADMISSIBLE",
          from_blocking_layer: "none",
          to_blocking_layer: "execution_reality",
          from_density_state: "SUFFICIENT",
          to_density_state: "DEGRADED",
          from_edge_state: "ELIGIBLE",
          to_edge_state: "BLOCKED",
          truth_quality_delta_pct: -22,
        },
      },
    }),
  ];
  await writeFile(journalFile, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");

  try {
    const request = new NextRequest("http://localhost:3000/api/terminal/governance-replay?symbol=BTCUSD&timeframe=1m&strategy=terminal&currentRegime=CHOP&sinceDays=30&limit=1200");
    const response = await governanceReplayRoute.GET(request);
    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.schema_version).toBe("governance-replay-view/v3");
    expect(payload.source).toBe("persisted_journal");
    expect(payload.scope.symbol).toBe("BTCUSD");
    expect(payload.archive.active_regime).toBe("CHOP");
    expect(payload.archive.persistent_compression).toBeTruthy();
    expect(payload.archive.persistent_compression.state === "THIN" || payload.archive.persistent_compression.state === "LEARNING" || payload.archive.persistent_compression.state === "COMPACT" || payload.archive.persistent_compression.state === "SATURATED").toBeTruthy();
    expect(payload.archive_contracts.schema_version).toBe("governance-replay-archive-contracts/v1");
    expect(payload.archive_contracts.market_regime_archive.current_summary_version).toBe("market-regime-archive/v1");
    expect(payload.archive_contracts.market_regime_archive.status).toBe("LOCKED");
    expect(payload.archive_contracts.governance_replay.current_summary_version).toBe("governance-replay/v1");
    expect(payload.archive_contracts.governance_replay.status).toBe("LOCKED");
    expect(payload.archive.latest_transition.to_regime).toBe("CHOP");
    expect(payload.replay.allow_answer.action).toBe("EXECUTE");
    expect(payload.timeline_detailed.some((step: { journal_action: string }) => step.journal_action === "capital-scaling-updated")).toBeTruthy();
    expect(payload.timeline_detailed.some((step: { journal_action: string; phase: string }) => step.journal_action === "market-transition" && step.phase === "market")).toBeTruthy();
    expect(payload.freeze.contracts.some((contract: { key: string; status: string }) => contract.key === "capital_scaling" && contract.status === "LOCKED")).toBeTruthy();
    expect(payload.freeze.contracts.some((contract: { key: string; status: string }) => contract.key === "execution_reality_temporal_sizing" && contract.status === "LOCKED")).toBeTruthy();
  } finally {
    if (previousJournalDir === undefined) {
      delete process.env.V2_RISK_JOURNAL_DIR;
    } else {
      process.env.V2_RISK_JOURNAL_DIR = previousJournalDir;
    }
    if (previousJournalFile === undefined) {
      delete process.env.V2_RISK_JOURNAL_FILE;
    } else {
      process.env.V2_RISK_JOURNAL_FILE = previousJournalFile;
    }
    if (previousToken === undefined) {
      delete process.env.CONTROL_PLANE_TOKEN;
    } else {
      process.env.CONTROL_PLANE_TOKEN = previousToken;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});