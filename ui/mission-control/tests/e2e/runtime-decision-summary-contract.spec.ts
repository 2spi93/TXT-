import { expect, test } from "@playwright/test";

import RuntimeDecisionOverviewCard from "../../components/ui/RuntimeDecisionOverviewCard";
import RuntimeObservationDashboard from "../../components/ui/RuntimeObservationDashboard";
import type { RuntimeDecisionAnalyticsSummary } from "../../lib/runtimeDecisionAnalytics";
import { terminalSecondaryPanelsTestables } from "../../app/terminal/TerminalSecondaryPanels";

function collectElementText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (!node || typeof node !== "object") {
    return "";
  }

  if (Array.isArray(node)) {
    return node.map((item) => collectElementText(item)).join(" ");
  }

  const props = "props" in node ? (node as { props?: Record<string, unknown> }).props : undefined;
  const children = props?.children;
  return collectElementText(children);
}

function createSummary(): RuntimeDecisionAnalyticsSummary {
  return {
    scope: {
      symbol: "BTCUSD",
      timeframe: "1m",
      strategy: "terminal",
      limit: 1200,
      sinceDays: 7,
    },
    policyVersion: "v7",
    totals: {
      totalRows: 28,
      executionRows: 24,
      noTradeRows: 9,
      noTradePctWithinExecution: 37.5,
      canonicalRows: 8,
      normalizedLegacyRows: 1,
      unclassifiedLegacyRows: 0,
      canonicalCoveragePct: 88.9,
      effectiveCanonicalCoveragePct: 100,
    },
    topCodes: [{ code: "routing-score-zero", family: "runtime", bucket: "runtime", count: 4, sharePct: 44.4 }],
    byBucket: [{ bucket: "runtime", count: 6, sharePct: 66.7 }],
    byFamily: [{ family: "runtime", count: 6, sharePct: 66.7 }],
    marketContext: {
      volatilityRegime: [{ label: "medium", count: 18, sharePct: 75 }],
      attentionState: [{ label: "stable", count: 20, sharePct: 83.3 }],
      tripleValidationState: [{ label: "confirmed", count: 20, sharePct: 83.3 }],
    },
    semanticMismatchCandidates: { count: 0, sharePct: 0, samples: [] },
    falsePositiveCandidates: { count: 1, sharePct: 11.1, samples: [] },
    reliability: {
      state: "DEGRADED",
      blocked: false,
      dataCompleteness: 0.84,
      dataCompletenessPct: 84,
      observationCoverageHours: 120,
      freshnessMs: 214,
      anomalyRate: 0.12,
      anomalyRatePct: 12,
      signalConsistency: 0.58,
      signalConsistencyPct: 58,
      summary: "DEGRADED · observation window 120.0h · signal consistency 58%",
      reasons: ["observation window 120.0h", "signal consistency 58%"],
      degradedReasons: ["signal consistency 58%"],
      blockingReasons: [],
    },
    opportunity: {
      candidateCount: 15,
      blockedCount: 5,
      executedCount: 10,
      opportunityRate: 62.5,
      missedOpportunityRate: 33.3,
      executionEfficiency: 66.7,
      avgScore: 62,
      confidencePct: 100,
      highQualityRate: 40,
      missingSignals: [],
      blockedByBucket: [{ bucket: "runtime", count: 4, sharePct: 80 }],
      topBlockedBucket: { label: "runtime", count: 4, sharePct: 80 },
      liveState: "NO_DATA_PARTIAL",
      liveSummary: "NO_DATA_PARTIAL · telemetry incomplete but parsable.",
      guard: {
        state: "PARTIAL_DATA",
        blocked: true,
        trustScorePct: 41,
        summary: "PARTIAL_DATA · telemetry incomplete but parsable.",
        reasons: ["missing latency"],
      },
      confidenceEngine: {
        state: "EXPLORATORY",
        sampleSize: 15,
        stability: 0.53,
        stabilityPct: 53,
        summary: "EXPLORATORY · reliability degraded.",
      },
      telemetry: {
        availability: "partial",
        source: "venue-telemetry",
        venueCount: 2,
        marketVenueCount: 2,
        routeVenueCount: 2,
        avgSpreadBps: 1.2,
        avgAvailableDepthUsd: 120000,
        avgDepthLatencyMs: 44,
        avgFillProbability: 0.87,
        avgStabilityScore: 0.78,
        avgRouteLatencyMs: null,
        avgFillLatencyMs: 214,
        avgSlippageBps: 2.1,
        spreadBudgetBps: 6,
        latencyBudgetMs: 140,
        summary: "venues 2 · spread 1.20bp · depth 120k USD · route n/a · fill 87%",
        authState: "OK",
        rootCause: "PARTIAL_PAYLOAD",
        missingFields: ["latency"],
        integrity: {
          state: "PARTIAL",
          summary: "execution telemetry partial · route 2/2 venue(s) mais latency manquante",
          routeCoveragePct: 100,
          executionVenueCount: 2,
          routeVenueCount: 2,
          marketVenueCount: 2,
          items: [],
        },
      },
      breakdown: [
        { key: "spread", label: "Spread", score: 0.8, scorePct: 80, tone: "good", detail: "1.20bp" },
        { key: "latency", label: "Latency", score: 0.32, scorePct: 32, tone: "warn", detail: "missing route latency" },
      ],
      topRanked: [],
      summary: "Score moyen 62% · contrainte dominante latency 32%.",
    },
    drift: {
      detected: true,
      tone: "warn",
      state: "DRIFT",
      type: "SYSTEM_HEALTH",
      score: 0.64,
      scorePct: 64,
      stats: {
        confirmed: true,
        ksScore: 0.64,
        ksMetric: "runtimeBlockRate",
        adwinTriggered: true,
        adwinDelta: 0.12,
        adwinSignal: 0.61,
        currentSampleSize: 18,
        baselineSampleSize: 61,
        sampleSizeFactor: 0.74,
        probability: 0.81,
        probabilityPct: 81,
        reliability: 0.73,
        reliabilityPct: 73,
        windowConsistency: 0.68,
        windowConsistencyPct: 68,
        noiseLevel: 0.21,
        noiseLevelPct: 21,
        signalVariance: 0.19,
        confidence: 0.77,
        confidencePct: 77,
      },
      cause: { summary: "runtime guards et watchdog restent la friction dominante.", factors: [] },
      windows: {
        "1h": { label: "1h", hours: 1, executionRows: 4, noTradeRows: 2, highVolatilityRate: 0, routingZeroRate: 33.3, fallbackRate: 0, runtimeBlockRate: 50, policyBlockRate: 0, falsePositiveRate: 12, driftScore: 0.64, driftScorePct: 64, type: "SYSTEM_HEALTH" },
        "6h": { label: "6h", hours: 6, executionRows: 11, noTradeRows: 4, highVolatilityRate: 0, routingZeroRate: 22.2, fallbackRate: 0, runtimeBlockRate: 33.3, policyBlockRate: 0, falsePositiveRate: 11, driftScore: 0.42, driftScorePct: 42, type: "SYSTEM_HEALTH" },
        "24h": { label: "24h", hours: 24, executionRows: 24, noTradeRows: 9, highVolatilityRate: 0, routingZeroRate: 11.1, fallbackRate: 0, runtimeBlockRate: 16.7, policyBlockRate: 0, falsePositiveRate: 11.1, driftScore: 0.19, driftScorePct: 19, type: "SYSTEM_HEALTH" },
      },
      alerts: [],
      history: [],
      alertFeed: [],
      headline: "system health drift remains elevated",
      summary: "latency and guards remain the dominant source of runtime friction.",
    },
    series: {
      bucketHours: 6,
      windowHours: 24,
      points: [
        { t: 1, iso: "2026-04-12T12:00:00.000Z", executionRows: 4, noTradeRate: 50, routingZeroRate: 33.3, fallbackRate: 0, runtimeBlockRate: 50, policyBlockRate: 0, falsePositiveRate: 12, opportunityRate: 38, missedOpportunityRate: 50, executionEfficiency: 50, driftScore: 0.64, driftScorePct: 64 },
        { t: 2, iso: "2026-04-13T12:00:00.000Z", executionRows: 5, noTradeRate: 40, routingZeroRate: 22.2, fallbackRate: 0, runtimeBlockRate: 33.3, policyBlockRate: 0, falsePositiveRate: 10, opportunityRate: 49, missedOpportunityRate: 40, executionEfficiency: 60, driftScore: 0.42, driftScorePct: 42 },
        { t: 3, iso: "2026-04-15T12:00:00.000Z", executionRows: 6, noTradeRate: 25, routingZeroRate: 11.1, fallbackRate: 0, runtimeBlockRate: 16.7, policyBlockRate: 0, falsePositiveRate: 7, opportunityRate: 58, missedOpportunityRate: 22, executionEfficiency: 78, driftScore: 0.19, driftScorePct: 19 },
      ],
    },
    dominant: {
      bucket: { label: "runtime", count: 6, sharePct: 66.7 },
      code: { label: "routing-score-zero", count: 4, sharePct: 44.4 },
      attentionState: { label: "stable", count: 20, sharePct: 83.3 },
      volatilityRegime: { label: "medium", count: 18, sharePct: 75 },
    },
    observation: {
      status: "OBSERVE",
      windowDays: 7,
      sampleHours: 120,
      minObservationHours: 72,
      maxObservationHours: 168,
      decisionOutcomeCoveragePct: 64,
      driftFalsePositiveRate: 12,
      driftDetectionRate: 67,
      driftStability: 61,
      opportunityHitRate: 58,
      decisionConsistency: 58,
      driftReliabilityMean: 69,
      manualCalibrationEligible: false,
      autoCalibrationAllowed: false,
      integrity: {
        status: "DEGRADED",
        score: 0.88,
        scorePct: 88,
        expectedHours: 168,
        coveredHours: 150,
        missingHours: 18,
        maxGapHours: 4,
        anomalies: [],
        summary: "Observation integrity degraded · coverage 150/168h · missing 18h · max gap 4h.",
      },
      recommendation: "Fenetre active 120.0h/168h. Continuer la revue manuelle sans toucher a l'automatisation.",
    },
    integrity: {
      state: "DEGRADED",
      score: 0.62,
      scorePct: 62,
      summary: "DEGRADED 62% · latency_elevated · capture_not_alive · multi_chart_source_divergence",
      reasons: ["latency_elevated", "capture_not_alive", "multi_chart_source_divergence"],
      coverageScore: 1,
      freshnessScore: 0.6,
      consistencyScore: 0.6,
      continuityScore: 0.5,
      coverageScorePct: 100,
      freshnessScorePct: 60,
      consistencyScorePct: 60,
      continuityScorePct: 50,
      multiChart: {
        state: "DEGRADED",
        score: 0.55,
        scorePct: 55,
        reasons: ["multi_chart_source_divergence"],
        summary: "degraded 3/4 · skew 820ms · multi_chart_source_divergence",
        activeTiles: 3,
        expectedTiles: 4,
        syncAgeMs: 1600,
        sourceDivergenceCount: 1,
        masterClockDriftMs: 820,
      },
      v5: {
        state: "DEGRADED",
        score: 0.55,
        scorePct: 55,
        reasons: ["v5_promotion_not_ready"],
        summary: "v5 shadow shadow · v5_promotion_not_ready",
        enabled: true,
        mode: "shadow",
        drawdownPaused: false,
        sourceLabel: "shadow",
        promotionReady: false,
        requiredShadowCycles: 20,
        observedShadowCycles: 12,
        requiredObservationHours: 48,
        observedObservationHours: 26,
        missingExecutionMetrics: false,
      },
    },
    monitoring: {
      live: {
        source: "local-terminal-capture",
        latestCaptureAtIso: "2026-04-16T12:34:56.000Z",
        latestCaptureAgeSec: 18,
        latestFeedLabel: "binance-public",
        latestXchStatus: "LIVE",
        latestXchAgeLabel: "18s",
        latestXchSourceLabel: "quotes",
        staleRateXchPct: 50,
        xchSampleCount: 2,
        avgBusLagMs: 210,
        latestBusLagMs: 185,
        latestEndToEndLagMs: 420,
        latestBusState: "ok",
        driftProbabilityPct: 81,
        driftReliabilityPct: 73,
        driftType: "SYSTEM_HEALTH",
        opportunityScorePct: 62,
        opportunityCount: 15,
        limitingFactor: { key: "latency", label: "Latency", score: 0.32, scorePct: 32, tone: "warn", detail: "route latency missing" },
        decisionConsistencyPct: 58,
        multiChart: {
          state: "DEGRADED",
          score: 0.55,
          scorePct: 55,
          reasons: ["multi_chart_source_divergence"],
          summary: "degraded 3/4 · skew 820ms · multi_chart_source_divergence",
          activeTiles: 3,
          expectedTiles: 4,
          syncAgeMs: 1600,
          sourceDivergenceCount: 1,
          masterClockDriftMs: 820,
        },
        v5: {
          state: "DEGRADED",
          score: 0.55,
          scorePct: 55,
          reasons: ["v5_promotion_not_ready"],
          summary: "v5 shadow shadow · v5_promotion_not_ready",
          enabled: true,
          mode: "shadow",
          drawdownPaused: false,
          sourceLabel: "shadow",
          promotionReady: false,
          requiredShadowCycles: 20,
          observedShadowCycles: 12,
          requiredObservationHours: 48,
          observedObservationHours: 26,
          missingExecutionMetrics: false,
        },
        summary: "local capture · system health drift elevated · stale XCH 50% · grid degraded · v5 degraded",
      },
      observationWindow: {
        status: "OBSERVING",
        sampleCount: 3,
        coverageHours: 120,
        minObservationHours: 72,
        maxObservationHours: 168,
        points: [
          { bucketStartIso: "2026-04-12T12:00:00.000Z", driftProbability: 58, reliability: 44, opportunityScore: 46, driftFalsePositiveRate: 14, opportunityHitRate: 38, decisionConsistency: 52, driftStability: 49, driftReliabilityMean: 48, observationStatus: "OBSERVE", reliabilityState: "BLOCKED_BY_DATA", observationIntegrityStatus: "CRITICAL", integrityState: "DEGRADED", integrityScorePct: 48, gapDensityPct: 25, noTradeConcentrationPct: 12, noTradeConcentrationLabel: "high · 1m · routing-score-zero", manualCalibrationEligible: false },
          { bucketStartIso: "2026-04-13T12:00:00.000Z", driftProbability: 49, reliability: 58, opportunityScore: 53, driftFalsePositiveRate: 10, opportunityHitRate: 49, decisionConsistency: 63, driftStability: 61, driftReliabilityMean: 57, observationStatus: "OBSERVE", reliabilityState: "DEGRADED", observationIntegrityStatus: "DEGRADED", integrityState: "DEGRADED", integrityScorePct: 56, gapDensityPct: 8, noTradeConcentrationPct: 28, noTradeConcentrationLabel: "medium · 5m · runtime-guard", manualCalibrationEligible: false },
          { bucketStartIso: "2026-04-15T12:00:00.000Z", driftProbability: 42, reliability: 71, opportunityScore: 62, driftFalsePositiveRate: 7, opportunityHitRate: 58, decisionConsistency: 74, driftStability: 76, driftReliabilityMean: 69, observationStatus: "READY_FOR_REVIEW", reliabilityState: "RELIABLE", observationIntegrityStatus: "OK", integrityState: "HIGH", integrityScorePct: 72, gapDensityPct: 2, noTradeConcentrationPct: 47, noTradeConcentrationLabel: "medium · 5m · runtime-guard", manualCalibrationEligible: true },
        ],
        latest: { bucketStartIso: "2026-04-15T12:00:00.000Z", driftProbability: 42, reliability: 71, opportunityScore: 62, driftFalsePositiveRate: 7, opportunityHitRate: 58, decisionConsistency: 74, driftStability: 76, driftReliabilityMean: 69, observationStatus: "READY_FOR_REVIEW", reliabilityState: "RELIABLE", observationIntegrityStatus: "OK", integrityState: "HIGH", integrityScorePct: 72, gapDensityPct: 2, noTradeConcentrationPct: 47, noTradeConcentrationLabel: "medium · 5m · runtime-guard", manualCalibrationEligible: true },
        deltas: [
          { metric: "driftFalsePositiveRate", current: 7, baseline: 14, delta: -7 },
          { metric: "opportunityHitRate", current: 58, baseline: 38, delta: 20 },
          { metric: "decisionConsistency", current: 74, baseline: 52, delta: 22 },
          { metric: "driftReliabilityMean", current: 69, baseline: 48, delta: 21 },
        ],
        validation: {
          reliabilityDistribution: [
            { state: "RELIABLE", count: 1, sharePct: 33.3, tone: "good" },
            { state: "DEGRADED", count: 1, sharePct: 33.3, tone: "subtle" },
            { state: "BLOCKED_BY_DATA", count: 1, sharePct: 33.3, tone: "warn" },
          ],
          unknownReliabilityCount: 0,
          latestReliabilityState: "RELIABLE",
          latestIntegrityState: "HIGH",
          latestIntegrityScorePct: 72,
          averageIntegrityScorePct: 58.7,
          integrityTrend: {
            direction: "UP",
            deltaPct: 16,
            baselineScorePct: 56,
            latestScorePct: 72,
            summary: "Integrity improving +16%",
          },
          integrityVolatilityPct: 12,
          realityCheck: {
            status: "WATCH",
            summary: "Integrity HIGH stays under watch while reliability remains degraded.",
            reasons: ["integrity_high_vs_reliability_degraded"],
          },
          latestGapDensityPct: 2,
          averageGapDensityPct: 11.7,
          latestDriftStability: 76,
          averageDriftStability: 62,
          latestNoTradeConcentrationPct: 47,
          averageNoTradeConcentrationPct: 29,
          latestNoTradeConcentrationLabel: "medium · 5m · runtime-guard",
          thresholds: [
            { key: "reliableShareCeiling", label: "Reliable share ceiling", status: "PASS", value: 33.3, threshold: 45, summary: "RELIABLE 33.3%: la prudence reste dominante." },
            { key: "driftStabilityFloor", label: "Drift stability floor", status: "WATCH", value: 62, threshold: 65, summary: "Drift stability moyenne 62.0%: validation encore fragile." },
            { key: "gapDensityCeiling", label: "Gap density ceiling", status: "PASS", value: 2, threshold: 5, summary: "Gap density 2%: couverture temporelle saine." },
            { key: "noTradeConcentrationFloor", label: "NO_TRADE concentration floor", status: "PASS", value: 47, threshold: 35, summary: "NO_TRADE concentration 47%: cluster localise exploitable." },
            { key: "integrityVolatilityCeiling", label: "Integrity volatility ceiling", status: "WATCH", value: 12, threshold: 10, summary: "Integrity volatility 12.0%: variations rapides a surveiller." },
          ],
          summary: "Reliability mix RELIABLE 33.3% · DEGRADED 33.3% · BLOCKED_BY_DATA 33.3% · integrity HIGH 72% · integrity improving +16% · gaps latest 2% · NO_TRADE concentration 47%",
        },
        gateSummary: "Observation active 120.0h/168h: verifier que FP baisse et que hit rate + consistency restent stables.",
      },
      governanceBudget: {
        state: "OBSERVE_ONLY",
        conclusionBudgetPct: 15,
        autoPromotionAllowed: false,
        summary: "Governance budget 15%: observation et annotation manuelle seulement, sans conclusion forte ni durcissement du score.",
        reasons: ["reliability DEGRADED", "Drift stability floor"],
        falseContextMotifs: [
          { family: "FALSE_SYNC", count: 2, sharePct: 40 },
          { family: "FALSE_EXECUTION_CONTEXT", count: 1, sharePct: 20 },
        ],
      },
      anomalies: {
        activeCount: 2,
        rows: [
          { id: "interpretation-reliability-gate", severity: "critical", label: "reliability gate", summary: "interpretation remains degraded.", action: "Keep the system in observation mode.", source: "observation" },
          { id: "xch-stale-rate", severity: "warning", label: "stale XCH", summary: "live exchange freshness remains mixed.", action: "Confirm source freshness before reading edge.", source: "live-capture" },
        ],
      },
      noTradeHeatmap: {
        timeframes: ["1m", "5m"],
        rows: [
          {
            regime: "medium",
            totalCount: 5,
            totalSharePct: 55.6,
            cells: [
              { timeframe: "1m", count: 1, sharePct: 11.1, tone: "subtle", topCode: "runtime-guard", topCodeSharePct: 100, topFalseContextFamily: "FALSE_EXECUTION_CONTEXT", topFalseContextSharePct: 100 },
              { timeframe: "5m", count: 4, sharePct: 44.4, tone: "warn", topCode: "runtime-guard", topCodeSharePct: 100, topFalseContextFamily: "FALSE_EXECUTION_CONTEXT", topFalseContextSharePct: 100 },
            ],
          },
        ],
        summary: "NO_TRADE clusters remain concentrated in medium volatility on 5m runtime guards · motif FALSE_EXECUTION_CONTEXT.",
      },
      falseContextMotifs: [
        { family: "FALSE_SYNC", count: 2, sharePct: 40, topReasons: ["stale_quotes"] },
        { family: "FALSE_EXECUTION_CONTEXT", count: 3, sharePct: 60, topReasons: ["execution_quality_degraded"] },
      ],
    },
    deskRead: {
      tone: "warn",
      headline: "System health drift dominates current refusals",
      summary: "Runtime guards and watchdog pressure remain the dominant blockers.",
      nextAction: "Treat system-health friction before revisiting calibration or policy.",
    },
  } as RuntimeDecisionAnalyticsSummary;
}

test("runtime observation dashboard accepts the analytics summary contract without UI recalculation", () => {
  const tree = RuntimeObservationDashboard({
    summary: createSummary(),
    title: "Observation Dashboard",
  });
  const markup = collectElementText(tree);

  expect(markup).toContain("Observation Dashboard");
  expect(markup).toContain("Temporal validation 24h - 7j");
  expect(markup).toContain("Decision governance budget");
  expect(markup).toContain("OBSERVE_ONLY");
  expect(markup).toContain("Runtime Integrity Block");
  expect(markup).toContain("auto trader v5");
  expect(markup).toContain("integrity trend");
  expect(markup).toContain("Integrity improving +16%");
  expect(markup).toContain("Observation Runbook");
  expect(markup).toContain("observer sans influencer");
  expect(markup).toContain("Reliability distribution");
  expect(markup).toContain("Gap density 2%: couverture temporelle saine.");
  expect(markup).toContain("NO_TRADE concentration 47%: cluster localise exploitable.");
});

test("runtime decision overview renders false context motifs in the synthetic refusal read", () => {
  const tree = RuntimeDecisionOverviewCard({
    summary: createSummary(),
    title: "Runtime Decision Desk",
  });
  const markup = collectElementText(tree);

  expect(markup).toContain("False context motifs");
  expect(markup).toContain("false sync 40%");
  expect(markup).toContain("false execution context 60%");
});

test("terminal compact read stays compatible with reliability-first summary semantics", () => {
  const compact = terminalSecondaryPanelsTestables.buildRuntimeDecisionCompactRead(createSummary(), {
    busy: false,
    error: null,
  });

  expect(compact.opportunityLabel).toBe("OPPORTUNITY PARTIAL_DATA");
  expect(compact.opportunityMeta).toMatch(/PARTIAL_DATA/i);
  expect(compact.observationLabel).toBe("OBS observe");
  expect(compact.observationMeta).toContain("Runtime Integrity DEGRADED 62%");
  expect(compact.observationMeta).toContain("Trend UP");
  expect(compact.observationMeta).toContain("Reliability DEGRADED");
  expect(compact.liveLabel).toContain("CHART FEED binance-public");
  expect(compact.liveMeta).toContain("EXCHANGE FRESHNESS LIVE 18s");
  expect(compact.liveMeta).toContain("grid degraded");
  expect(compact.state).toBe("ready");
});

test("terminal compact read surfaces false context motifs in the observation line", () => {
  const compact = terminalSecondaryPanelsTestables.buildRuntimeDecisionCompactRead(createSummary(), {
    busy: false,
    error: null,
  });

  expect(compact.observationLabel).toBe("OBS observe");
  expect(compact.observationMeta).toContain("FalseCtx FALSE_SYNC 40%");
  expect(compact.observationMeta).toContain("FALSE_EXECUTION_CONTEXT 60%");
});