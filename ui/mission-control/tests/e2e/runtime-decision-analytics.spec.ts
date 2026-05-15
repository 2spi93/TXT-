import { expect, test } from "@playwright/test";

import { buildExecutionDecisionAudit } from "../../lib/executionDecisionSchema";
import { runtimeDecisionAnalyticsTestables } from "../../lib/runtimeDecisionAnalytics";

const NOW_MS = Date.parse("2026-04-15T12:00:00.000Z");

type DriftRow = Parameters<typeof runtimeDecisionAnalyticsTestables.buildDrift>[0][number];
type OpportunityTelemetry = Parameters<typeof runtimeDecisionAnalyticsTestables.buildDrift>[2];

function createDriftRow(input: {
  hoursAgo: number;
  code: string;
  bucket: "market" | "runtime" | "policy" | "broker" | "confidence" | "external-governance" | "post-trade" | "legacy" | "unknown";
  isNoTrade: boolean;
  falsePositiveCandidate?: boolean;
  volatilityRegime?: string;
  decisionOutcome?: "correct" | "false_positive" | "unknown";
  falseContextFamily?: string;
  falseContextReasons?: string[];
}): DriftRow {
  const timestampMs = NOW_MS - input.hoursAgo * 60 * 60 * 1000;
  return {
    entry: {
      id: `test-${input.code}-${timestampMs}`,
      createdAtIso: new Date(timestampMs).toISOString(),
      symbol: "BTCUSD",
      timeframe: "1m",
      strategy: "terminal",
      action: input.isNoTrade ? "execution-no-trade" : "execution-pass",
      detail: input.code,
      decisionOutcome: input.decisionOutcome,
    },
    timestampMs,
    code: input.code,
    family: input.bucket === "policy" ? "policy" : input.bucket === "runtime" ? "runtime" : "unknown",
    bucket: input.bucket,
    context: {
      attentionState: "stable",
      volatilityRegime: input.volatilityRegime || "medium",
      tripleValidationState: "confirmed",
      shouldBlockTrading: input.isNoTrade,
      executionQualityScore: input.isNoTrade ? 0.42 : 0.88,
      temporalDriftMs: input.isNoTrade ? 120 : 24,
      manipulationRisk: 0.12,
      busSeq: 4,
      depthAgeMs: 120,
      falseContextFamily: input.falseContextFamily || null,
      falseContextNoTrade: input.isNoTrade,
      falseContextReasonTags: input.falseContextReasons || [],
    },
    hasCanonicalAudit: true,
    isNoTrade: input.isNoTrade,
    semanticMismatch: false,
    falsePositiveCandidate: Boolean(input.falsePositiveCandidate),
    opportunityCandidate: true,
  };
}

function createOpportunityTelemetry(overrides: Record<string, unknown> = {}): OpportunityTelemetry {
  return {
    source: "venue-telemetry",
    availability: "ready",
    venueCount: 2,
    marketVenueCount: 2,
    routeVenueCount: 2,
    avgSpreadBps: 1.2,
    avgAvailableDepthUsd: 120_000,
    avgDepthLatencyMs: 45,
    avgFillProbability: 0.86,
    avgStabilityScore: 0.82,
    avgRouteLatencyMs: 150,
    avgFillLatencyMs: 240,
    avgSlippageBps: 1.6,
    spreadBudgetBps: 6,
    latencyBudgetMs: 140,
    summary: "Healthy spread and depth, but latency remains elevated.",
    ...overrides,
  };
}

test("runtime decision drift stays interpretable under routing-heavy recent degradation", () => {
  const rows = [
    ...Array.from({ length: 24 }, (_, index) => createDriftRow({
      hoursAgo: 23 - index * 0.45,
      code: "runtime-guard",
      bucket: "runtime",
      isNoTrade: true,
    })),
    ...Array.from({ length: 12 }, (_, index) => createDriftRow({
      hoursAgo: 11.5 - index * 0.3,
      code: "policy-block",
      bucket: "policy",
      isNoTrade: true,
    })),
    ...Array.from({ length: 8 }, (_, index) => createDriftRow({
      hoursAgo: 5 - index * 0.55,
      code: "routing-score-zero",
      bucket: "unknown",
      isNoTrade: true,
    })),
    ...Array.from({ length: 6 }, (_, index) => createDriftRow({
      hoursAgo: 0.9 - index * 0.12,
      code: "routing-score-zero",
      bucket: "unknown",
      isNoTrade: true,
    })),
    ...Array.from({ length: 14 }, (_, index) => createDriftRow({
      hoursAgo: 20 - index * 1.1,
      code: "entry-valid",
      bucket: "unknown",
      isNoTrade: false,
    })),
  ];
  const telemetry = createOpportunityTelemetry({
    avgSpreadBps: 1.4,
    avgRouteLatencyMs: 88,
    avgFillLatencyMs: 132,
    avgDepthLatencyMs: 52,
    avgAvailableDepthUsd: 140_000,
    avgFillProbability: 0.9,
    avgStabilityScore: 0.9,
    summary: "Routing stays available and market microstructure is healthy.",
  });

  const drift = runtimeDecisionAnalyticsTestables.buildDrift(rows, NOW_MS, telemetry);

  expect(drift.detected).toBe(true);
  expect(drift.type).toBe("EXECUTION_ROUTING");
  expect(["WATCH", "DRIFT", "CRITICAL"]).toContain(drift.state);
  expect(drift.stats.probability).toBeGreaterThan(0.45);
  expect(drift.stats.reliability).toBeGreaterThan(0.5);
  expect(drift.stats.windowConsistency).toBeGreaterThan(0.55);
  expect(drift.windows["1h"].routingZeroRate).toBe(100);
  expect(drift.windows["6h"].routingZeroRate).toBeGreaterThan(50);
});

test("runtime decision opportunity score remains deterministic and exposes the binding constraint", () => {
  const telemetry = createOpportunityTelemetry();
  const row = {
    entry: {
      createdAtIso: "2026-04-15T11:58:00.000Z",
    },
    code: "entry-valid",
    bucket: "market",
    isNoTrade: false,
    context: {
      attentionState: "stable",
      volatilityRegime: "medium",
      depthAgeMs: 50,
    },
  } as never;

  const opportunity = runtimeDecisionAnalyticsTestables.computeOpportunityScore(row, telemetry);
  const aggregate = runtimeDecisionAnalyticsTestables.aggregateOpportunityBreakdown([opportunity]);
  const limitingFactor = aggregate.slice().sort((left, right) => left.score - right.score || left.label.localeCompare(right.label))[0];

  expect(opportunity.score).toBeCloseTo(0.6585, 4);
  expect(opportunity.scorePct).toBe(65.8);
  expect(opportunity.status).toBe("EXECUTED");
  expect(opportunity.confidence).toBe(1);
  expect(opportunity.confidencePct).toBe(100);
  expect(opportunity.missing).toEqual([]);
  expect(limitingFactor?.key).toBe("latency");
  expect(limitingFactor?.score).toBe(0);
  expect(opportunity.breakdown.find((item) => item.key === "spread")?.score).toBeCloseTo(0.8, 4);
  expect(opportunity.breakdown.find((item) => item.key === "depth")?.score).toBeCloseTo(0.855, 3);
  expect(opportunity.breakdown.find((item) => item.key === "regime")?.score).toBeCloseTo(0.82, 4);
  expect(opportunity.rationale).toMatch(/constraint latency/i);
});

test("runtime decision opportunity score degrades gracefully under partial telemetry", () => {
  const telemetry = createOpportunityTelemetry({
    availability: "partial",
    avgSpreadBps: null,
    avgRouteLatencyMs: null,
    avgFillLatencyMs: null,
    summary: "Telemetry partielle: spread, latency manquants.",
  });
  const row = {
    entry: {
      createdAtIso: "2026-04-15T11:58:00.000Z",
    },
    code: "entry-valid",
    bucket: "market",
    isNoTrade: false,
    context: {
      attentionState: "stable",
      volatilityRegime: "medium",
      depthAgeMs: 50,
    },
  } as never;

  const opportunity = runtimeDecisionAnalyticsTestables.computeOpportunityScore(row, telemetry);

  expect(opportunity.score).toBeCloseTo(0.8463, 4);
  expect(opportunity.confidence).toBeCloseTo(0.4, 4);
  expect(opportunity.confidencePct).toBe(40);
  expect(opportunity.missing).toEqual(["spread", "latency"]);
  expect(opportunity.rationale).toMatch(/missing spread \+ latency/i);
});

test("runtime analytics preserves oracle fingerprint across derived rows and inspectable samples", () => {
  const [row] = runtimeDecisionAnalyticsTestables.deriveRows([
    {
      id: "oracle-trace-1",
      createdAtIso: "2026-04-15T11:58:00.000Z",
      symbol: "BTCUSD",
      timeframe: "1m",
      strategy: "terminal",
      action: "execution-v7-blocked",
      detail: "oracle blocked execution",
      meta: {
        decision_audit: buildExecutionDecisionAudit({
          code: "execution-v7-blocked",
          summary: "oracle blocked execution",
          oracleFingerprint: "audit-fp-1234",
        }),
        final_decision_truth: {
          action: "BLOCK",
          blocking_layer: "execution_lock",
          oracle_fingerprint: "truth-fp-9999",
        },
        attention_context: {
          state: "stable",
          shouldBlockTrading: true,
          context: {
            volatilityRegime: "medium",
            manipulationRisk: 0.12,
          },
        },
        sync_diagnostics: {
          bus_seq: 4,
          depth_age_ms: 120,
        },
      },
    } as never,
  ]);

  const sample = runtimeDecisionAnalyticsTestables.buildSample(row);
  const opportunity = runtimeDecisionAnalyticsTestables.computeOpportunityScore(row, createOpportunityTelemetry());

  expect(row.oracleFingerprint).toBe("audit-fp-1234");
  expect(sample.oracleFingerprint).toBe("audit-fp-1234");
  expect(opportunity.oracleFingerprint).toBe("audit-fp-1234");
});

test("runtime observation summary stays bounded to manual review gates", () => {
  const coverageRows = Array.from({ length: 95 }, (_, index) => createDriftRow({
    hoursAgo: 95 - index,
    code: "entry-valid",
    bucket: "market",
    isNoTrade: false,
  }));
  const rows = [
    createDriftRow({ hoursAgo: 96, code: "routing-score-zero", bucket: "unknown", isNoTrade: true, falsePositiveCandidate: true, decisionOutcome: "false_positive" }),
    createDriftRow({ hoursAgo: 72, code: "runtime-guard", bucket: "runtime", isNoTrade: true, decisionOutcome: "correct" }),
    createDriftRow({ hoursAgo: 24, code: "policy-block", bucket: "policy", isNoTrade: true }),
    ...coverageRows,
  ];
  const observation = runtimeDecisionAnalyticsTestables.buildObservationSummary({
    rows,
    noTradeRows: 3,
    effectiveCanonicalCoveragePct: 92,
    semanticMismatchSharePct: 4,
    falsePositiveSharePct: 10,
    exclusiveFalsePositiveSharePct: 10,
    drift: {
      stats: {
        reliability: 0.72,
        windowConsistency: 0.68,
        noiseLevel: 0.18,
      },
      history: [
        { state: "WATCH", noTradeRows: 2 },
        { state: "WATCH", noTradeRows: 3 },
        { state: "DRIFT", noTradeRows: 2 },
        { state: "WATCH", noTradeRows: 1 },
      ],
    } as never,
    opportunityHitRate: 50,
    seriesPoints: [
      { executionRows: 1, driftScore: 0.22 },
      { executionRows: 1, driftScore: 0.25 },
      { executionRows: 1, driftScore: 0.21 },
      { executionRows: 1, driftScore: 0.24 },
    ] as never,
    windowDays: 7,
  });

  expect(observation.status).toBe("OBSERVE");
  expect(observation.autoCalibrationAllowed).toBe(false);
  expect(observation.decisionOutcomeCoveragePct).toBeCloseTo(66.7, 1);
  expect(observation.driftFalsePositiveRate).toBe(10);
  expect(observation.driftDetectionRate).toBe(100);
  expect(observation.driftStability).toBeGreaterThan(70);
  expect(Number.isFinite(observation.decisionConsistency)).toBe(true);
  expect(observation.decisionConsistency).toBeGreaterThan(80);
  expect(observation.manualCalibrationEligible).toBe(false);
  expect(observation.recommendation).toMatch(/sans toucher a l'automatisation/i);
});

test("observation integrity flags sparse gaps and closes the manual gate", () => {
  const timestamps = [
    Date.parse("2026-04-10T00:00:00.000Z"),
    Date.parse("2026-04-10T01:00:00.000Z"),
    Date.parse("2026-04-10T06:00:00.000Z"),
    Date.parse("2026-04-10T07:00:00.000Z"),
  ];

  const integrity = runtimeDecisionAnalyticsTestables.buildObservationIntegrity(timestamps);

  expect(integrity.status).toBe("CRITICAL");
  expect(integrity.coveredHours).toBe(4);
  expect(integrity.expectedHours).toBe(8);
  expect(integrity.missingHours).toBe(4);
  expect(integrity.maxGapHours).toBe(4);
  expect(integrity.anomalies[0]?.gapHours).toBe(4);
});

test("observability guard blocks interpretation when observation integrity breaks reliability", () => {
  const reliability = runtimeDecisionAnalyticsTestables.buildReliability({
    telemetry: createOpportunityTelemetry({
      missingFields: [],
      integrity: {
        state: "OK",
        summary: "execution telemetry OK",
        routeCoveragePct: 100,
        executionVenueCount: 2,
        routeVenueCount: 2,
        marketVenueCount: 2,
        items: [],
      },
    }) as never,
    liveState: "LIVE",
    observation: {
      status: "OBSERVE",
      sampleHours: 8,
      decisionConsistency: 82,
      integrity: {
        status: "CRITICAL",
        score: 0.5,
        scorePct: 50,
        expectedHours: 8,
        coveredHours: 4,
        missingHours: 4,
        maxGapHours: 4,
        anomalies: [{ startIso: "2026-04-10T01:00:00.000Z", endIso: "2026-04-10T06:00:00.000Z", gapHours: 4 }],
        summary: "Observation integrity critical · coverage 4/8h · missing 4h · max gap 4h.",
      },
    } as never,
  });
  const guard = runtimeDecisionAnalyticsTestables.buildOpportunityGuard({
    telemetry: createOpportunityTelemetry({
      missingFields: [],
      integrity: {
        state: "OK",
        summary: "execution telemetry OK",
        routeCoveragePct: 100,
        executionVenueCount: 2,
        routeVenueCount: 2,
        marketVenueCount: 2,
        items: [],
      },
    }) as never,
    liveState: "LIVE",
    observation: {
      status: "OBSERVE",
      integrity: {
        status: "CRITICAL",
        score: 0.5,
        scorePct: 50,
        expectedHours: 8,
        coveredHours: 4,
        missingHours: 4,
        maxGapHours: 4,
        anomalies: [{ startIso: "2026-04-10T01:00:00.000Z", endIso: "2026-04-10T06:00:00.000Z", gapHours: 4 }],
        summary: "Observation integrity critical · coverage 4/8h · missing 4h · max gap 4h.",
      },
    },
    reliability,
  });

  expect(reliability.state).toBe("BLOCKED_BY_DATA");
  expect(guard.state).toBe("BLOCKED_BY_DATA");
  expect(guard.blocked).toBe(true);
  expect(guard.summary).toMatch(/BLOCKED_BY_DATA/i);
  expect(guard.trustScorePct).toBeLessThanOrEqual(35);
});

test("opportunity confidence stays exploratory until reliability is truly reliable", () => {
  const confidence = runtimeDecisionAnalyticsTestables.buildOpportunityConfidence({
    signalScore: 0.81,
    reliability: "DEGRADED",
    sampleSize: 88,
    stability: 0.78,
  });

  expect(confidence.state).toBe("EXPLORATORY");
  expect(confidence.summary).toMatch(/reliability degraded/i);
});

test("reliability engine exposes why degraded without blocking interpretation by data", () => {
  const reliability = runtimeDecisionAnalyticsTestables.buildReliability({
    telemetry: createOpportunityTelemetry({
      avgRouteLatencyMs: 6200,
      avgFillLatencyMs: 6400,
      avgDepthLatencyMs: 120,
      missingFields: [],
      integrity: {
        state: "OK",
        summary: "execution telemetry OK",
        routeCoveragePct: 100,
        executionVenueCount: 2,
        routeVenueCount: 2,
        marketVenueCount: 2,
        items: [],
      },
    }) as never,
    liveState: "LIVE",
    observation: {
      status: "OBSERVE",
      sampleHours: 18,
      decisionConsistency: 61,
      integrity: {
        status: "OK",
        score: 1,
        scorePct: 100,
        expectedHours: 18,
        coveredHours: 18,
        missingHours: 0,
        maxGapHours: 0,
        anomalies: [],
        summary: "Observation integrity OK · coverage 18/18h · max gap 0h.",
      },
    } as never,
  });

  expect(reliability.state).toBe("DEGRADED");
  expect(reliability.blocked).toBe(false);
  expect(reliability.degradedReasons).toEqual(expect.arrayContaining([
    expect.stringMatching(/observation window 18\.0h < 24h/i),
    expect.stringMatching(/freshness 6400ms/i),
    expect.stringMatching(/signal consistency 61%/i),
  ]));
  expect(reliability.blockingReasons).toEqual([]);
});

test("operator monitoring fuses local capture truth with anomalies and NO_TRADE heatmap", () => {
  const rows = [
    createDriftRow({ hoursAgo: 6, code: "routing-score-zero", bucket: "market", isNoTrade: true, volatilityRegime: "high", falseContextFamily: "FALSE_SYNC", falseContextReasons: ["stale_quotes"] }),
    createDriftRow({ hoursAgo: 5, code: "routing-score-zero", bucket: "market", isNoTrade: true, volatilityRegime: "high", falseContextFamily: "FALSE_SYNC", falseContextReasons: ["venue_desync"] }),
    createDriftRow({ hoursAgo: 4, code: "runtime-guard", bucket: "runtime", isNoTrade: true, volatilityRegime: "medium", falseContextFamily: "FALSE_EXECUTION_CONTEXT", falseContextReasons: ["execution_quality_degraded"] }),
    createDriftRow({ hoursAgo: 1, code: "entry-valid", bucket: "market", isNoTrade: false, volatilityRegime: "medium" }),
  ].map((row, index) => ({
    ...row,
    entry: {
      ...row.entry,
      timeframe: index < 2 ? "1m" : "5m",
    },
  })) as never;

  const monitoring = runtimeDecisionAnalyticsTestables.buildOperatorMonitoring({
    rows,
    noTradeRows: 3,
    nowMs: NOW_MS,
    localCaptures: [
      {
        clientId: "desk-a",
        capturedAt: "2026-04-15T11:59:30.000Z",
        chart: { feedLabel: "BTCUSDT · binance-public" },
        runtime: {
          bus: { status: "ok" },
          truth: {
            exchangeStatus: "stale",
            exchangeAgeLabel: "3m",
            exchangeSourceLabel: "quotes",
            busLagMs: 3200,
            endToEndLagMs: 4100,
          },
        },
        dataset: { market_state: { bus_lag_ms: 3200 } },
      },
      {
        clientId: "desk-a",
        capturedAt: "2026-04-15T11:58:30.000Z",
        chart: { feedLabel: "BTCUSDT · binance-public" },
        runtime: {
          bus: { status: "ok" },
          truth: {
            exchangeStatus: "live",
            exchangeAgeLabel: "420ms",
            exchangeSourceLabel: "gpu-trade",
            busLagMs: 180,
            endToEndLagMs: 420,
          },
        },
        dataset: { market_state: { bus_lag_ms: 180 } },
      },
    ] as never,
    drift: {
      state: "DRIFT",
      type: "EXECUTION_ROUTING",
      headline: "execution routing drift confirmed",
      stats: {
        probabilityPct: 71,
        reliabilityPct: 62,
      },
    } as never,
    opportunity: {
      avgScore: 64,
      candidateCount: 2,
      missedOpportunityRate: 50,
      topBlockedBucket: { label: "runtime" },
      breakdown: [
        { label: "Latency", score: 0.32, scorePct: 32, tone: "warn" },
        { label: "Spread", score: 0.78, scorePct: 78, tone: "good" },
      ],
    } as never,
    observation: {
      decisionConsistency: 58,
      sampleHours: 8,
      integrity: {
        status: "CRITICAL",
        score: 0.5,
        scorePct: 50,
        expectedHours: 8,
        coveredHours: 4,
        missingHours: 4,
        maxGapHours: 4,
        anomalies: [{ startIso: "2026-04-15T05:00:00.000Z", endIso: "2026-04-15T09:00:00.000Z", gapHours: 3 }],
        summary: "Observation integrity critical · coverage 4/8h · missing 4h · max gap 4h.",
      },
    } as never,
    reliability: {
      state: "BLOCKED_BY_DATA",
      blocked: true,
      dataCompleteness: 0.66,
      dataCompletenessPct: 66.7,
      observationCoverageHours: 8,
      freshnessMs: 3200,
      anomalyRate: 0.5,
      anomalyRatePct: 50,
      signalConsistency: 0.58,
      signalConsistencyPct: 58,
      summary: "BLOCKED_BY_DATA · missing latency · missing slippage · incomplete coverage",
      reasons: ["missing latency", "missing slippage", "incomplete coverage"],
      degradedReasons: [],
      blockingReasons: ["missing latency", "missing slippage", "incomplete coverage"],
    } as never,
    integrity: {
      state: "BROKEN",
      score: 0.34,
      scorePct: 34,
      summary: "BROKEN 34% · gap_density_high · latency_elevated · capture_not_alive",
      reasons: ["gap_density_high", "latency_elevated", "capture_not_alive"],
      coverageScore: 0.4,
      freshnessScore: 0.2,
      consistencyScore: 0.6,
      continuityScore: 0.2,
      coverageScorePct: 40,
      freshnessScorePct: 20,
      consistencyScorePct: 60,
      continuityScorePct: 20,
      multiChart: {
        state: "INACTIVE",
        score: 1,
        scorePct: 100,
        reasons: [],
        summary: "multi-chart inactive",
      },
      v5: {
        state: "INACTIVE",
        score: 1,
        scorePct: 100,
        reasons: [],
        summary: "v5 inactive",
        enabled: false,
        mode: "inactive",
        drawdownPaused: false,
        sourceLabel: "inactive",
        promotionReady: false,
        requiredShadowCycles: 0,
        observedShadowCycles: 0,
        requiredObservationHours: 0,
        observedObservationHours: 0,
        missingExecutionMetrics: false,
      },
    } as never,
    semanticMismatchSharePct: 7,
    falsePositiveSharePct: 12,
  });

  expect(monitoring.live.latestXchStatus).toBe("STALE");
  expect(monitoring.live.staleRateXchPct).toBe(50);
  expect(monitoring.live.latestBusLagMs).toBe(3200);
  expect(monitoring.anomalies.activeCount).toBeGreaterThanOrEqual(4);
  expect(monitoring.anomalies.rows.some((alert) => alert.id === "interpretation-reliability-gate")).toBe(true);
  expect(monitoring.anomalies.rows.some((alert) => alert.id === "xch-stale-rate")).toBe(true);
  expect(monitoring.noTradeHeatmap.timeframes).toEqual(["1m", "5m"]);
  expect(monitoring.noTradeHeatmap.rows[0]?.regime).toBe("high");
  expect(monitoring.noTradeHeatmap.rows[0]?.cells[0]?.topCode).toBe("routing-score-zero");
  expect(monitoring.noTradeHeatmap.rows[0]?.cells[0]?.topFalseContextFamily).toBe("FALSE_SYNC");
  expect(monitoring.falseContextMotifs[0]?.family).toBe("FALSE_SYNC");
});

test("observation window counts covered hourly buckets and KPI deltas without overstating sparse spans", () => {
  const observationWindow = runtimeDecisionAnalyticsTestables.buildObservationWindow({
    snapshots: [
      {
        bucketStartIso: "2026-04-08T00:00:00.000Z",
        driftProbability: 62,
        reliability: 58,
        opportunityScore: 51,
        driftFalsePositiveRate: 14,
        opportunityHitRate: 41,
        decisionConsistency: 60,
        driftStability: 63,
        driftReliabilityMean: 56,
        observationStatus: "INSUFFICIENT",
        manualCalibrationEligible: false,
      },
      {
        bucketStartIso: "2026-04-14T12:00:00.000Z",
        driftProbability: 49,
        reliability: 64,
        opportunityScore: 57,
        driftFalsePositiveRate: 10,
        opportunityHitRate: 52,
        decisionConsistency: 69,
        driftStability: 71,
        driftReliabilityMean: 63,
        observationStatus: "OBSERVE",
        manualCalibrationEligible: false,
      },
      {
        bucketStartIso: "2026-04-15T12:00:00.000Z",
        driftProbability: 44,
        reliability: 70,
        opportunityScore: 61,
        driftFalsePositiveRate: 8,
        opportunityHitRate: 58,
        decisionConsistency: 74,
        driftStability: 75,
        driftReliabilityMean: 68,
        observationStatus: "READY_FOR_REVIEW",
        manualCalibrationEligible: true,
      },
    ],
    observation: {
      minObservationHours: 72,
      maxObservationHours: 168,
      manualCalibrationEligible: true,
    } as never,
  });

  expect(observationWindow.status).toBe("BUILDING");
  expect(observationWindow.sampleCount).toBe(3);
  expect(observationWindow.coverageHours).toBe(3);
  expect(observationWindow.latest?.decisionConsistency).toBe(74);
  expect(observationWindow.deltas.find((item) => item.metric === "driftFalsePositiveRate")?.delta).toBe(-6);
  expect(observationWindow.deltas.find((item) => item.metric === "opportunityHitRate")?.delta).toBe(17);
});

test("temporal validation summarizes reliability distribution, gap density and NO_TRADE concentration", () => {
  const observationWindow = runtimeDecisionAnalyticsTestables.buildObservationWindow({
    snapshots: [
      {
        bucketStartIso: "2026-04-12T12:00:00.000Z",
        driftProbability: 58,
        reliability: 44,
        opportunityScore: 46,
        driftFalsePositiveRate: 14,
        opportunityHitRate: 38,
        decisionConsistency: 52,
        driftStability: 49,
        driftReliabilityMean: 48,
        observationStatus: "OBSERVE",
        reliabilityState: "BLOCKED_BY_DATA",
        observationIntegrityStatus: "CRITICAL",
        integrityState: "DEGRADED",
        integrityScorePct: 48,
        observationGapDensityPct: 25,
        noTradeConcentrationPct: 12,
        noTradeConcentrationLabel: "high · 1m · routing-score-zero",
        manualCalibrationEligible: false,
      },
      {
        bucketStartIso: "2026-04-13T12:00:00.000Z",
        driftProbability: 49,
        reliability: 58,
        opportunityScore: 53,
        driftFalsePositiveRate: 10,
        opportunityHitRate: 49,
        decisionConsistency: 63,
        driftStability: 61,
        driftReliabilityMean: 57,
        observationStatus: "OBSERVE",
        reliabilityState: "DEGRADED",
        observationIntegrityStatus: "DEGRADED",
        integrityState: "DEGRADED",
        integrityScorePct: 56,
        observationGapDensityPct: 8,
        noTradeConcentrationPct: 28,
        noTradeConcentrationLabel: "medium · 5m · runtime-guard",
        manualCalibrationEligible: false,
      },
      {
        bucketStartIso: "2026-04-15T12:00:00.000Z",
        driftProbability: 42,
        reliability: 71,
        opportunityScore: 62,
        driftFalsePositiveRate: 7,
        opportunityHitRate: 58,
        decisionConsistency: 74,
        driftStability: 76,
        driftReliabilityMean: 69,
        observationStatus: "READY_FOR_REVIEW",
        reliabilityState: "RELIABLE",
        observationIntegrityStatus: "OK",
        integrityState: "HIGH",
        integrityScorePct: 72,
        observationGapDensityPct: 2,
        noTradeConcentrationPct: 47,
        noTradeConcentrationLabel: "medium · 5m · runtime-guard",
        manualCalibrationEligible: true,
      },
    ],
    observation: {
      minObservationHours: 72,
      maxObservationHours: 168,
      manualCalibrationEligible: true,
    } as never,
  });

  expect(observationWindow.validation.reliabilityDistribution.find((item) => item.state === "RELIABLE")?.count).toBe(1);
  expect(observationWindow.validation.reliabilityDistribution.find((item) => item.state === "DEGRADED")?.count).toBe(1);
  expect(observationWindow.validation.reliabilityDistribution.find((item) => item.state === "BLOCKED_BY_DATA")?.count).toBe(1);
  expect(observationWindow.validation.latestGapDensityPct).toBe(2);
  expect(observationWindow.validation.averageGapDensityPct).toBeCloseTo(11.7, 1);
  expect(observationWindow.validation.latestIntegrityState).toBe("HIGH");
  expect(observationWindow.validation.latestIntegrityScorePct).toBe(72);
  expect(observationWindow.validation.integrityTrend.direction).toBe("UP");
  expect(observationWindow.validation.integrityVolatilityPct).toBeCloseTo(12, 1);
  expect(observationWindow.validation.realityCheck.status).toBe("OK");
  expect(observationWindow.validation.latestNoTradeConcentrationPct).toBe(47);
  expect(observationWindow.validation.thresholds.find((item) => item.key === "gapDensityCeiling")?.status).toBe("PASS");
  expect(observationWindow.validation.thresholds.find((item) => item.key === "noTradeConcentrationFloor")?.status).toBe("PASS");
  expect(observationWindow.validation.thresholds.find((item) => item.key === "integrityVolatilityCeiling")?.status).toBe("WATCH");

  const governanceBudget = runtimeDecisionAnalyticsTestables.buildGovernanceBudget({
    observationWindow: {
      ...observationWindow,
      status: "OBSERVING",
      validation: {
        ...observationWindow.validation,
        thresholds: observationWindow.validation.thresholds.map((item) => ({
          ...item,
          status: item.key === "driftStabilityFloor" ? "WATCH" : "PASS",
        })),
      },
    },
    observation: {
      manualCalibrationEligible: false,
    } as never,
    reliability: {
      state: "RELIABLE",
    } as never,
  });

  expect(governanceBudget.state).toBe("OBSERVE_ONLY");
  expect(governanceBudget.conclusionBudgetPct).toBe(15);
  expect(governanceBudget.autoPromotionAllowed).toBe(false);
  expect(governanceBudget.falseContextMotifs).toEqual([]);
});

test("temporal validation stays backward-compatible with legacy KPI snapshots", () => {
  const observationWindow = runtimeDecisionAnalyticsTestables.buildObservationWindow({
    snapshots: [
      {
        bucketStartIso: "2026-04-15T12:00:00.000Z",
        driftProbability: 44,
        reliability: 70,
        opportunityScore: 61,
        driftFalsePositiveRate: 8,
        opportunityHitRate: 58,
        decisionConsistency: 74,
        driftStability: 75,
        driftReliabilityMean: 68,
        observationStatus: "READY_FOR_REVIEW",
        manualCalibrationEligible: true,
      },
    ],
    observation: {
      minObservationHours: 72,
      maxObservationHours: 168,
      manualCalibrationEligible: true,
    } as never,
  });

  expect(observationWindow.validation.unknownReliabilityCount).toBe(1);
  expect(observationWindow.validation.latestReliabilityState).toBe("UNKNOWN");
  expect(observationWindow.validation.latestIntegrityState).toBe("UNKNOWN");
  expect(observationWindow.validation.integrityTrend.direction).toBe("UNKNOWN");
  expect(observationWindow.validation.latestGapDensityPct).toBe(0);
  expect(observationWindow.validation.latestNoTradeConcentrationPct).toBe(0);
  expect(observationWindow.validation.reliabilityDistribution.every((item) => item.count === 0)).toBe(true);
});

test("governance budget collapses to no-conclusion when observation remains blocked by data", () => {
  const observationWindow = runtimeDecisionAnalyticsTestables.buildObservationWindow({
    snapshots: [
      {
        bucketStartIso: "2026-04-15T12:00:00.000Z",
        driftProbability: 63,
        reliability: 31,
        opportunityScore: 44,
        driftFalsePositiveRate: 18,
        opportunityHitRate: 27,
        decisionConsistency: 34,
        driftStability: 41,
        driftReliabilityMean: 39,
        observationStatus: "INSUFFICIENT",
        reliabilityState: "BLOCKED_BY_DATA",
        observationIntegrityStatus: "CRITICAL",
        observationGapDensityPct: 28,
        noTradeConcentrationPct: 9,
        noTradeConcentrationLabel: "high · 1m · routing-score-zero",
        manualCalibrationEligible: false,
      },
    ],
    observation: {
      minObservationHours: 72,
      maxObservationHours: 168,
      manualCalibrationEligible: false,
    } as never,
  });

  const governanceBudget = runtimeDecisionAnalyticsTestables.buildGovernanceBudget({
    observationWindow,
    observation: {
      manualCalibrationEligible: false,
    } as never,
    reliability: {
      state: "BLOCKED_BY_DATA",
    } as never,
  });

  expect(governanceBudget.state).toBe("NO_CONCLUSION");
  expect(governanceBudget.conclusionBudgetPct).toBe(0);
  expect(governanceBudget.summary).toMatch(/droit de ne pas conclure/i);
  expect(governanceBudget.falseContextMotifs).toEqual([]);
});