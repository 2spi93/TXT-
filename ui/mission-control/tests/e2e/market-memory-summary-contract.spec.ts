import { expect, test } from "@playwright/test";

import { buildMarketMemorySummary } from "../../lib/marketMemory";

const NOW_ISO = "2026-05-14T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

function isoHoursAgo(hoursAgo: number): string {
  return new Date(NOW_MS - hoursAgo * 60 * 60 * 1000).toISOString();
}

function createSnapshotEntry(input: {
  id: string;
  hoursAgo: number;
  regime: string;
  oracleFingerprint?: string;
  venue?: string;
  timeframe?: string;
  marketTruthState?: string;
  admissibilityState?: string;
  informationDensityState?: string;
  edgeState?: string;
  blockingLayer?: string;
  truthQualityPct?: number;
  executionQualityPct?: number;
  anomalyBurdenPct?: number;
  falseContextFamily?: string | null;
  falseContextNoTrade?: boolean;
  falseContextReasons?: string[];
}) {
  return {
    id: input.id,
    createdAtIso: isoHoursAgo(input.hoursAgo),
    symbol: "BTCUSD",
    timeframe: input.timeframe || "1m",
    strategy: "terminal",
    action: "market-memory-snapshot",
    detail: `${input.regime} snapshot`,
    meta: {
      market_memory_snapshot: {
        oracle_fingerprint: input.oracleFingerprint || `fdt-${input.id}`,
        volatility_regime: input.regime,
        market_session: "LONDON",
        venue: input.venue || "BINANCE-PUBLIC",
        route_mode: "best_available",
        market_truth_state: input.marketTruthState || "RELIABLE",
        truth_quality_pct: input.truthQualityPct ?? 78,
        admissibility_state: input.admissibilityState || "ADMISSIBLE",
        information_density_state: input.informationDensityState || "SUFFICIENT",
        edge_state: input.edgeState || "ELIGIBLE",
        blocking_layer: input.blockingLayer || "none",
        false_context_family: input.falseContextFamily,
        false_context_no_trade: input.falseContextNoTrade ?? false,
        false_context_trigger_layer: input.falseContextFamily ? "market_truth" : "none",
        false_context_reasons: input.falseContextReasons || [],
        coherence_pct: 80,
        freshness_pct: 84,
        information_density_pct: 74,
        execution_quality_pct: input.executionQualityPct ?? 76,
        anomaly_burden_pct: input.anomalyBurdenPct ?? 18,
      },
    },
  };
}

function createAnomalyEntry(input: {
  id: string;
  hoursAgo: number;
  regime: string;
  anomalyType: string;
  anomalyFamily: string;
}) {
  return {
    id: input.id,
    createdAtIso: isoHoursAgo(input.hoursAgo),
    symbol: "BTCUSD",
    timeframe: "1m",
    strategy: "terminal",
    action: "market-microstructure-anomaly",
    detail: input.anomalyType,
    meta: {
      microstructure_anomaly: {
        anomaly_type: input.anomalyType,
        anomaly_family: input.anomalyFamily,
        operator_family: input.anomalyFamily === "VENUE_DESYNC" ? "venue" : "liquidity",
        venue: "BINANCE-PUBLIC",
        route_mode: "best_available",
        regime: input.regime,
        severity: "warn",
        market_truth_state: "WATCH",
        blocking_layer: "none",
        evidence_metrics: {
          persistence_pct: 66,
          confidence_pct: 59,
        },
        detail: input.anomalyType,
      },
    },
  };
}

function createDegradationEntry(input: {
  id: string;
  hoursAgo: number;
  regime: string;
}) {
  return {
    id: input.id,
    createdAtIso: isoHoursAgo(input.hoursAgo),
    symbol: "BTCUSD",
    timeframe: "1m",
    strategy: "terminal",
    action: "market-execution-degradation",
    detail: "execution quality degraded",
    meta: {
      execution_degradation: {
        degradation_type: "EXECUTION_QUALITY_DEGRADED",
        venue: "BINANCE-PUBLIC",
        route_mode: "best_available",
        regime: input.regime,
        market_truth_state: "DEGRADED",
        edge_state: "BLOCKED",
        blocking_layer: "execution_lock",
        execution_quality_pct: 42,
        detail: "execution quality degraded",
      },
    },
  };
}

function createTransitionEntry(input: {
  id: string;
  hoursAgo: number;
  transitionType?: string;
  fromRegime: string;
  toRegime: string;
  fromAdmissibilityState?: string;
  toAdmissibilityState?: string;
}) {
  return {
    id: input.id,
    createdAtIso: isoHoursAgo(input.hoursAgo),
    symbol: "BTCUSD",
    timeframe: "1m",
    strategy: "terminal",
    action: "market-transition",
    detail: `${input.fromRegime} -> ${input.toRegime}`,
    meta: {
      market_transition: {
        transition_type: input.transitionType || "MARKET_TRUTH_SHIFT",
        from_regime: input.fromRegime,
        to_regime: input.toRegime,
        from_market_truth_state: "WATCH",
        to_market_truth_state: "RELIABLE",
        from_admissibility_state: input.fromAdmissibilityState || "WATCH",
        to_admissibility_state: input.toAdmissibilityState || "ADMISSIBLE",
        from_blocking_layer: "none",
        to_blocking_layer: "none",
        from_density_state: "THIN",
        to_density_state: "SUFFICIENT",
        from_edge_state: "OBSERVE",
        to_edge_state: "ELIGIBLE",
        truth_quality_delta_pct: 14,
      },
    },
  };
}

test("market memory summary compresses hierarchical recall into hot warm cold layers and capsules", () => {
  const summary = buildMarketMemorySummary([
    createSnapshotEntry({ id: "snap-hot-1", hoursAgo: 8, regime: "TREND", falseContextFamily: "FALSE_SYNC", falseContextNoTrade: true, falseContextReasons: ["freshness_degraded"] }),
    createSnapshotEntry({ id: "snap-hot-2", hoursAgo: 48, regime: "TREND", falseContextFamily: "FALSE_SYNC", falseContextReasons: ["venue_desync"] }),
    createSnapshotEntry({ id: "snap-warm-1", hoursAgo: 24 * 12, regime: "CHOP", marketTruthState: "DEGRADED", truthQualityPct: 54, executionQualityPct: 49, anomalyBurdenPct: 44, falseContextFamily: "FALSE_LIQUIDITY", falseContextNoTrade: true, falseContextReasons: ["liquidity_vacuum"] }),
    createSnapshotEntry({ id: "snap-cold-1", hoursAgo: 24 * 45, regime: "RANGE", marketTruthState: "WATCH", truthQualityPct: 61, executionQualityPct: 57, anomalyBurdenPct: 28, falseContextFamily: "FALSE_INTENT", falseContextReasons: ["smart_no_trade"] }),
    createAnomalyEntry({ id: "an-hot-1", hoursAgo: 6, regime: "TREND", anomalyType: "VENUE_ALPHA_DESYNCHRONIZATION", anomalyFamily: "VENUE_DESYNC" }),
    createDegradationEntry({ id: "deg-warm-1", hoursAgo: 24 * 14, regime: "CHOP" }),
    createTransitionEntry({ id: "tr-hot-1", hoursAgo: 16, fromRegime: "CHOP", toRegime: "TREND" }),
  ], { nowMs: NOW_MS });

  expect(summary.hierarchicalCompression.hot.windowLabel).toBe("last_7d");
  expect(summary.hierarchicalCompression.hot.snapshotCount).toBe(2);
  expect(summary.hierarchicalCompression.hot.transitionCount).toBe(1);
  expect(summary.hierarchicalCompression.hot.anomalyCount).toBe(1);
  expect(summary.hierarchicalCompression.hot.dominantRegime).toBe("TREND");
  expect(summary.hierarchicalCompression.hot.dominantFalseContextFamily).toBe("FALSE_SYNC");
  expect(summary.hierarchicalCompression.hot.dominantAnomalyFamily).toBe("VENUE_DESYNC");
  expect(summary.hierarchicalCompression.hot.explanation.join(" ")).toContain("compressed recall");

  expect(summary.hierarchicalCompression.warm.windowLabel).toBe("last_30d");
  expect(summary.hierarchicalCompression.warm.snapshotCount).toBe(1);
  expect(summary.hierarchicalCompression.warm.degradationCount).toBe(1);
  expect(summary.hierarchicalCompression.warm.dominantRegime).toBe("CHOP");

  expect(summary.hierarchicalCompression.cold.windowLabel).toBe("older_than_30d");
  expect(summary.hierarchicalCompression.cold.snapshotCount).toBe(1);
  expect(summary.hierarchicalCompression.cold.dominantRegime).toBe("RANGE");

  expect(summary.hierarchicalCompression.capsules.length).toBeGreaterThan(0);
  expect(summary.hierarchicalCompression.capsules[0]?.contextKey).toContain("BTCUSD:BINANCE-PUBLIC:1m");
  expect(summary.hierarchicalCompression.capsules.some((capsule) => capsule.layer === "hot" && capsule.currentRegime === "TREND")).toBeTruthy();
  expect(summary.hierarchicalCompression.capsules.some((capsule) => capsule.layer === "warm" && capsule.currentRegime === "CHOP")).toBeTruthy();
  expect(summary.hierarchicalCompression.capsules.some((capsule) => capsule.layer === "cold" && capsule.currentRegime === "RANGE")).toBeTruthy();
  expect(summary.hierarchicalCompression.capsules.find((capsule) => capsule.currentRegime === "TREND")?.supportingEpisodes).toContain("snap-hot-1");
  expect(summary.snapshots.find((snapshot) => snapshot.id === "snap-hot-1")?.oracleFingerprint).toBe("fdt-snap-hot-1");
  expect(summary.transitions.find((transition) => transition.id === "tr-hot-1")?.toAdmissibilityState).toBe("ADMISSIBLE");
  expect(summary.marketTemperature.scorePct).toBeGreaterThan(0);
  expect(summary.hierarchicalCompression.capsules[0]?.marketTemperaturePct).toBeGreaterThan(0);
});

test("market memory summary preserves explicit admissibility transitions", () => {
  const summary = buildMarketMemorySummary([
    createSnapshotEntry({ id: "snap-adm-1", hoursAgo: 3, regime: "CHOP" }),
    createTransitionEntry({
      id: "tr-adm-1",
      hoursAgo: 2,
      transitionType: "ADMISSIBILITY_SHIFT",
      fromRegime: "CHOP",
      toRegime: "CHOP",
      fromAdmissibilityState: "WATCH",
      toAdmissibilityState: "INADMISSIBLE",
    }),
  ], { nowMs: NOW_MS });

  const transition = summary.transitions.find((item) => item.id === "tr-adm-1");

  expect(transition?.transitionType).toBe("ADMISSIBILITY_SHIFT");
  expect(transition?.fromAdmissibilityState).toBe("WATCH");
  expect(transition?.toAdmissibilityState).toBe("INADMISSIBLE");
});

test("market memory summary models market temperature and extends structural capsules", () => {
  const summary = buildMarketMemorySummary([
    createSnapshotEntry({
      id: "snap-temp-1",
      hoursAgo: 2,
      regime: "CHOP",
      marketTruthState: "DEGRADED",
      admissibilityState: "INADMISSIBLE",
      informationDensityState: "DEGRADED",
      edgeState: "BLOCKED",
      blockingLayer: "execution_lock",
      executionQualityPct: 28,
      anomalyBurdenPct: 66,
      falseContextFamily: "FALSE_LIQUIDITY",
      falseContextNoTrade: true,
      falseContextReasons: ["liquidity_vacuum", "execution_quality_degraded"],
    }),
    createSnapshotEntry({
      id: "snap-temp-2",
      hoursAgo: 1,
      regime: "CHOP",
      marketTruthState: "DEGRADED",
      admissibilityState: "INADMISSIBLE",
      informationDensityState: "DEGRADED",
      edgeState: "BLOCKED",
      blockingLayer: "execution_lock",
      executionQualityPct: 24,
      anomalyBurdenPct: 72,
      falseContextFamily: "FALSE_LIQUIDITY",
      falseContextNoTrade: true,
      falseContextReasons: ["liquidity_vacuum", "sweep_risk"],
    }),
    createDegradationEntry({ id: "deg-temp-1", hoursAgo: 1, regime: "CHOP" }),
    createTransitionEntry({
      id: "tr-temp-1",
      hoursAgo: 1,
      transitionType: "ADMISSIBILITY_SHIFT",
      fromRegime: "CHOP",
      toRegime: "CHOP",
      fromAdmissibilityState: "WATCH",
      toAdmissibilityState: "INADMISSIBLE",
    }),
  ], { nowMs: NOW_MS });

  expect(summary.marketTemperature.state).toMatch(/HOT|OVERHEATED/);
  expect(summary.marketTemperature.scorePct).toBeGreaterThanOrEqual(56);
  expect(summary.marketTemperature.drivers[0]?.contributionPct).toBeGreaterThan(0);
  expect(summary.marketTemperature.hottestContextKey).toContain("BTCUSD:BINANCE-PUBLIC:1m:CHOP");
  expect(summary.hierarchicalCompression.capsules[0]?.marketTemperatureState).toMatch(/HOT|OVERHEATED/);
  expect(summary.hierarchicalCompression.capsules[0]?.admissibilityShiftCount).toBe(1);
  expect(summary.hierarchicalCompression.capsules[0]?.lastAdmissibilityState).toBe("INADMISSIBLE");
  expect(summary.hierarchicalCompression.capsules[0]?.transitionTypes).toContain("ADMISSIBILITY_SHIFT");
});