import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  buildStructuredRuntimeErrorBreakdown,
  classifyRuntimeErrors,
  formatRuntimeErrorVerdict,
  type RuntimeErrorClassificationOptions,
} from "./support/runtimeErrorClassification";

type ApiFailureMode = "ok" | "status500" | "empty" | "corrupt";
type QuotesFailureMode = ApiFailureMode | "alternate-only";

type TerminalInteractionHarnessOptions = {
  runtimeDecisionStatus?: number;
  liveOpsMode?: ApiFailureMode;
  marketQuotesMode?: QuotesFailureMode;
  marketBusSnapshotMode?: ApiFailureMode;
  marketVenueTelemetryMode?: ApiFailureMode;
  routeVenueTelemetryMode?: ApiFailureMode;
};

type RuntimeCollectors = {
  consoleErrors: string[];
  pageErrors: string[];
  networkErrors: string[];
};

type RuntimeExpectationOptions = {
  allowedConsoleErrors?: RegExp[];
  ignoredConsoleErrors?: RegExp[];
  degradedConsoleErrors?: RegExp[];
  expectedConsoleErrors?: RegExp[];
  ignoredPageErrors?: RegExp[];
  degradedPageErrors?: RegExp[];
  expectedPageErrors?: RegExp[];
  bestEffortSecondaryControls?: boolean;
};

function buildOhlcvRows(instrument: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  const now = Date.now();
  const basePrice = 68450;
  for (let index = 0; index < 48; index += 1) {
    const ts = new Date(now - (47 - index) * 60_000).toISOString();
    const drift = index * 4;
    rows.push({
      t: ts,
      o: basePrice + drift,
      h: basePrice + drift + 8,
      l: basePrice + drift - 8,
      c: basePrice + drift + 3,
      v: 12 + index,
      tf: "1m",
      seq: index + 1,
      instrument,
      venue: "binance-public",
      source: "market-bus-live",
    });
  }
  return rows;
}

function buildQuotesPayload(instrument: string): Array<Record<string, unknown>> {
  const now = new Date().toISOString();
  return [
    { symbol: instrument, instrument, venue: "binance-public", bid: 68640.1, ask: 68640.8, last: 68640.4, updated_at: now },
    { symbol: instrument, instrument, venue: "okx-public", bid: 68640.0, ask: 68640.9, last: 68640.5, updated_at: now },
    { symbol: instrument, instrument: instrument.replace(/USDT$/, "USD"), venue: "coinbase-public", bid: 68639.9, ask: 68641.0, last: 68640.6, updated_at: now },
  ];
}

function buildAlternateQuotesPayload(): Array<Record<string, unknown>> {
  const now = new Date().toISOString();
  return [
    { symbol: "ETHUSD", instrument: "ETHUSD", venue: "binance-public", bid: 3520.1, ask: 3520.8, last: 3520.4, updated_at: now },
    { symbol: "ETHUSD", instrument: "ETHUSD", venue: "okx-public", bid: 3520.0, ask: 3520.9, last: 3520.5, updated_at: now },
  ];
}

function buildSnapshotPayload(instrument: string): Record<string, unknown> {
  const now = Date.now();
  const routingScore = {
    source: "v6-price-fusion",
    reason: "best_route_candidate",
    infra_health: 0.98,
    network_regime: "stable",
    best: {
      venue: "binance-public",
      score: 82,
      spread_bps: 0.7,
      available_depth_usd: 120000,
      freshness_ms: 250,
      fill_probability: 0.93,
      stability_score: 0.91,
      stability_state: "stable",
    },
    backup: {
      venue: "okx-public",
      score: 64,
      spread_bps: 1.1,
      available_depth_usd: 84000,
      freshness_ms: 420,
      fill_probability: 0.78,
      stability_score: 0.72,
      stability_state: "watch",
    },
    candidates: [],
  };

  return {
    instrument,
    venue: "binance-public",
    timeframe: "1m",
    trades: [
      { price: 68640.2, size: 0.14, side: "buy", traded_at: new Date(now - 1800).toISOString(), venue: "binance-public", instrument },
      { price: 68640.4, size: 0.21, side: "buy", traded_at: new Date(now - 1200).toISOString(), venue: "okx-public", instrument },
      { price: 68640.1, size: 0.19, side: "sell", traded_at: new Date(now - 600).toISOString(), venue: "coinbase-public", instrument },
    ],
    microstructure: {
      instrument,
      venue: "binance-public",
      spread_bps: 0.7,
      depth_imbalance: 0.12,
      source: "market-bus-live",
      snapshot_at: new Date().toISOString(),
    },
    session_state: {
      instrument,
      session: "new-york",
      is_open: true,
      source: "market-bus-live",
      snapshot_at: new Date().toISOString(),
    },
    orderbook: {
      venue: "binance-public",
      source: "market-bus-live",
      best_bid: 68640.1,
      best_ask: 68640.8,
    },
    routingScore,
    routing_score: routingScore,
    ohlcv_rows: buildOhlcvRows(instrument),
    depth_snapshot: {
      source: "market-bus-live",
      last_update_id: 8800123,
      timestamp: Date.now() - 600,
      depth_payload: {
        bids: [[68640.1, 18], [68639.8, 25], [68639.5, 31], [68639.1, 28]],
        asks: [[68640.8, 17], [68641.3, 21], [68641.7, 26], [68642.1, 22]],
      },
    },
    meta: {
      health: {
        status: "ok",
        reason: "live_stream_ok",
        components: {
          ohlcv: { freshness_ms: 800 },
          depth: { freshness_ms: 500 },
          trades: { freshness_ms: 1200 },
        },
      },
    },
    as_of: new Date().toISOString(),
  };
}

function buildMarketVenueTelemetryPayload(): Record<string, unknown> {
  return {
    network_state: "healthy",
    updated_at: new Date().toISOString(),
    venues: [
      {
        venue: "binance-public",
        max_quote_freshness_ms: 220,
        max_depth_freshness_ms: 280,
        max_trade_freshness_ms: 340,
        avg_spread_bps: 0.72,
        avg_depth_levels: 18,
        avg_depth_latency_ms: 44,
        instruments: [
          { instrument: "BTCUSD", spread_bps: 0.72 },
          { instrument: "ETHUSD", spread_bps: 0.95 },
        ],
      },
      {
        venue: "okx-public",
        max_quote_freshness_ms: 310,
        max_depth_freshness_ms: 360,
        max_trade_freshness_ms: 410,
        avg_spread_bps: 1.08,
        avg_depth_levels: 14,
        avg_depth_latency_ms: 58,
        instruments: [
          { instrument: "BTCUSD", spread_bps: 1.08 },
        ],
      },
    ],
  };
}

function buildRouteVenueTelemetryPayload(): Record<string, unknown> {
  return {
    network_state: "healthy",
    updated_at: new Date().toISOString(),
    venues: [
      {
        venue: "binance-public",
        market: {
          max_quote_freshness_ms: 220,
          max_depth_freshness_ms: 280,
          max_trade_freshness_ms: 340,
          avg_spread_bps: 0.72,
          avg_depth_levels: 18,
          avg_depth_latency_ms: 44,
          instruments: [
            { instrument: "BTCUSD", spread_bps: 0.72 },
          ],
        },
        execution: {
          fill_count: 42,
          avg_slippage_bps: 1.1,
          avg_fill_latency_ms: 188,
          avg_fill_quality_score: 84,
        },
        stability: {
          state: "stable",
          stability_state: "stable",
        },
        profile: {
          matching_rule: "price-time",
          queue_priority_bias: 0.63,
        },
      },
      {
        venue: "okx-public",
        market: {
          max_quote_freshness_ms: 310,
          max_depth_freshness_ms: 360,
          max_trade_freshness_ms: 410,
          avg_spread_bps: 1.08,
          avg_depth_levels: 14,
          avg_depth_latency_ms: 58,
          instruments: [
            { instrument: "BTCUSD", spread_bps: 1.08 },
          ],
        },
        execution: {
          fill_count: 18,
          avg_slippage_bps: 1.8,
          avg_fill_latency_ms: 214,
          avg_fill_quality_score: 76,
        },
        stability: {
          state: "watch",
          stability_state: "watch",
        },
        profile: {
          matching_rule: "price-time",
          queue_priority_bias: 0.51,
        },
      },
    ],
  };
}

function buildRuntimeDecisionSummary(): Record<string, unknown> {
  return {
    scope: {
      symbol: "BTCUSD",
      timeframe: "1m",
      strategy: "terminal",
      limit: 600,
      sinceDays: 7,
    },
    policyVersion: "v7",
    totals: {
      totalRows: 28,
      executionRows: 24,
      noTradeRows: 9,
      noTradePctWithinExecution: 37.5,
      canonicalRows: 9,
      normalizedLegacyRows: 0,
      unclassifiedLegacyRows: 0,
      canonicalCoveragePct: 100,
      effectiveCanonicalCoveragePct: 100,
    },
    topCodes: [
      { code: "routing-score-zero", family: "runtime", bucket: "runtime", count: 4, sharePct: 44.4 },
      { code: "fallback-mode", family: "runtime", bucket: "runtime", count: 2, sharePct: 22.2 },
    ],
    byBucket: [
      { bucket: "runtime", count: 6, sharePct: 66.7 },
      { bucket: "policy", count: 3, sharePct: 33.3 },
    ],
    byFamily: [
      { family: "runtime", count: 6, sharePct: 66.7 },
      { family: "policy", count: 3, sharePct: 33.3 },
    ],
    marketContext: {
      volatilityRegime: [{ label: "medium", count: 18, sharePct: 75 }],
      attentionState: [{ label: "stable", count: 20, sharePct: 83.3 }],
      tripleValidationState: [{ label: "confirmed", count: 20, sharePct: 83.3 }],
    },
    semanticMismatchCandidates: {
      count: 0,
      sharePct: 0,
      samples: [],
    },
    falsePositiveCandidates: {
      count: 1,
      sharePct: 11.1,
      samples: [],
    },
    opportunity: {
      candidateCount: 15,
      blockedCount: 5,
      executedCount: 10,
      opportunityRate: 62.5,
      missedOpportunityRate: 33.3,
      executionEfficiency: 66.7,
      avgScore: 78,
      confidencePct: 100,
      highQualityRate: 53.3,
      missingSignals: [],
      blockedByBucket: [
        { bucket: "runtime", count: 4, sharePct: 80 },
        { bucket: "policy", count: 1, sharePct: 20 },
      ],
      topBlockedBucket: { label: "runtime", count: 4, sharePct: 80 },
      liveState: "LIVE",
      liveSummary: "LIVE · score 78% · confidence 100% · venues 2 · spread 1.20bp · depth 120k USD · route 188ms · fill 87%",
      telemetry: {
        source: "venue-telemetry",
        availability: "ready",
        venueCount: 2,
        marketVenueCount: 2,
        routeVenueCount: 2,
        avgSpreadBps: 1.2,
        avgAvailableDepthUsd: 120000,
        avgDepthLatencyMs: 44,
        avgFillProbability: 0.87,
        avgStabilityScore: 0.83,
        avgRouteLatencyMs: 188,
        avgFillLatencyMs: 214,
        avgSlippageBps: 1.6,
        spreadBudgetBps: 6,
        latencyBudgetMs: 140,
        summary: "venues 2 · spread 1.20bp · depth 120k USD · route 188ms · fill 87%",
        authState: "OK",
        rootCause: "LIVE",
        missingFields: [],
        integrity: {
          state: "OK",
          summary: "execution telemetry OK · route 2/2 venue(s) avec stats execution",
          routeCoveragePct: 100,
          executionVenueCount: 2,
          routeVenueCount: 2,
          marketVenueCount: 2,
          items: [],
        },
      },
      breakdown: [
        { key: "spread", label: "Spread", score: 0.8, scorePct: 80, tone: "good", detail: "1.20bp vs budget 6.00bp" },
        { key: "depth", label: "Depth", score: 0.84, scorePct: 84, tone: "good", detail: "fresh 44ms · 120k USD · fill 87%" },
        { key: "latency", label: "Latency", score: 0.32, scorePct: 32, tone: "warn", detail: "route 188ms · fill 214ms" },
        { key: "regime", label: "Regime", score: 0.78, scorePct: 78, tone: "good", detail: "vol medium" },
      ],
      topRanked: [
        {
          createdAtIso: "2026-04-15T12:00:00.000Z",
          code: "entry-valid",
          bucket: "market",
          score: 0.78,
          scorePct: 78,
          attentionState: "stable",
          volatilityRegime: "medium",
          status: "EXECUTED",
          breakdown: [
            { key: "spread", label: "Spread", score: 0.8, scorePct: 80, tone: "good", detail: "1.20bp vs budget 6.00bp" },
            { key: "depth", label: "Depth", score: 0.84, scorePct: 84, tone: "good", detail: "fresh 44ms · 120k USD · fill 87%" },
            { key: "latency", label: "Latency", score: 0.32, scorePct: 32, tone: "warn", detail: "route 188ms · fill 214ms" },
            { key: "regime", label: "Regime", score: 0.78, scorePct: 78, tone: "good", detail: "vol medium" },
          ],
          rationale: "constraint latency · support spread + depth · vol medium",
          confidence: 1,
          confidencePct: 100,
          missing: [],
        },
      ],
      summary: "Score moyen 78% · contrainte dominante latency 32% · 33.3% des contextes tradables restent bloques.",
    },
    drift: {
      detected: true,
      tone: "warn",
      state: "DRIFT",
      type: "EXECUTION_LATENCY",
      score: 0.64,
      scorePct: 64,
      stats: {
        confirmed: true,
        ksScore: 0.42,
        ksMetric: "fallbackRate",
        adwinTriggered: true,
        adwinDelta: 0.2,
        adwinSignal: 1,
        currentSampleSize: 6,
        baselineSampleSize: 18,
        sampleSizeFactor: 1,
        probability: 0.72,
        probabilityPct: 72,
        reliability: 0.81,
        reliabilityPct: 81,
        windowConsistency: 0.76,
        windowConsistencyPct: 76,
        noiseLevel: 0.18,
        noiseLevelPct: 18,
        signalVariance: 0.031,
        confidence: 0.75,
        confidencePct: 75,
      },
      cause: {
        summary: "route 188ms vs budget 140ms · fill 214ms vs budget 220ms",
        factors: [
          { key: "routeLatency", label: "Route latency", current: 188, reference: 140, deltaPct: 34.3, tone: "warn", note: "route 188ms vs budget 140ms" },
        ],
      },
      windows: {
        "1h": { label: "1h", hours: 1, executionRows: 4, noTradeRows: 3, highVolatilityRate: 0, routingZeroRate: 33.3, fallbackRate: 66.7, runtimeBlockRate: 33.3, policyBlockRate: 0, falsePositiveRate: 0, driftScore: 0.4667, driftScorePct: 46.7, type: "EXECUTION_LATENCY" },
        "6h": { label: "6h", hours: 6, executionRows: 12, noTradeRows: 5, highVolatilityRate: 0, routingZeroRate: 20, fallbackRate: 40, runtimeBlockRate: 20, policyBlockRate: 20, falsePositiveRate: 0, driftScore: 0.24, driftScorePct: 24, type: "EXECUTION_LATENCY" },
        "24h": { label: "24h", hours: 24, executionRows: 24, noTradeRows: 9, highVolatilityRate: 0, routingZeroRate: 11.1, fallbackRate: 22.2, runtimeBlockRate: 22.2, policyBlockRate: 33.3, falsePositiveRate: 11.1, driftScore: 0.1889, driftScorePct: 18.9, type: "SYSTEM_HEALTH" },
      },
      alerts: [
        { metric: "fallbackRate", currentWindow: "1h", baselineWindow: "24h", currentRate: 66.7, baselineRate: 22.2, drift: 2.0045, type: "EXECUTION_LATENCY", score: 0.4667, scorePct: 46.7, severity: "critical" },
      ],
      history: [
        { t: 1713182400, iso: "2026-04-15T11:00:00.000Z", state: "WATCH", type: "EXECUTION_LATENCY", metric: "fallbackRate", score: 0.31, scorePct: 31, currentRate: 40, baselineRate: 22.2, drift: 0.8018, noTradeRows: 2 },
        { t: 1713186000, iso: "2026-04-15T12:00:00.000Z", state: "DRIFT", type: "EXECUTION_LATENCY", metric: "fallbackRate", score: 0.64, scorePct: 64, currentRate: 66.7, baselineRate: 22.2, drift: 2.0045, noTradeRows: 3 },
      ],
      alertFeed: [
        { t: 1713186000000, iso: "2026-04-15T12:00:00.000Z", state: "DRIFT", type: "EXECUTION_LATENCY", metric: "fallbackRate", severity: "critical", score: 0.4667, scorePct: 46.7, currentRate: 66.7, baselineRate: 22.2, summary: "1h fallbackRate 66.7% vs 22.2%", source: "active-window" },
      ],
      headline: "execution latency drift confirmed",
      summary: "fallbackRate +200% vs 24h. Score 64% · prob 72% · reliability 81% · confidence 75%.",
    },
    series: {
      bucketHours: 1,
      windowHours: 24,
      points: [
        { t: 1713182400, iso: "2026-04-15T11:00:00.000Z", executionRows: 2, noTradeRate: 50, routingZeroRate: 0, fallbackRate: 50, runtimeBlockRate: 0, policyBlockRate: 0, falsePositiveRate: 0, opportunityRate: 50, missedOpportunityRate: 0, executionEfficiency: 100, driftScore: 0.1, driftScorePct: 10 },
        { t: 1713186000, iso: "2026-04-15T12:00:00.000Z", executionRows: 4, noTradeRate: 75, routingZeroRate: 33.3, fallbackRate: 66.7, runtimeBlockRate: 33.3, policyBlockRate: 0, falsePositiveRate: 0, opportunityRate: 75, missedOpportunityRate: 33.3, executionEfficiency: 66.7, driftScore: 0.4667, driftScorePct: 46.7 },
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
      sampleHours: 96,
      minObservationHours: 72,
      maxObservationHours: 168,
      driftFalsePositiveRate: 11.1,
      driftDetectionRate: 50,
      driftStability: 78,
      opportunityHitRate: 66.7,
      decisionConsistency: 82,
      driftReliabilityMean: 79,
      decisionOutcomeCoveragePct: 66.7,
      autoCalibrationAllowed: false,
      manualCalibrationEligible: false,
      recommendation: "Fenetre active 96.0h/168h. Suivre driftFalsePositiveRate, driftDetectionRate, opportunityHitRate, decisionConsistency et driftReliabilityMean sans toucher a l'automatisation.",
    },
    monitoring: {
      live: {
        source: "local-terminal-capture",
        latestCaptureAtIso: "2026-04-15T12:00:00.000Z",
        latestCaptureAgeSec: 12,
        latestFeedLabel: "BTCUSD · binance-public",
        latestXchStatus: "LIVE",
        latestXchAgeLabel: "420ms",
        latestXchSourceLabel: "gpu-trade",
        staleRateXchPct: 0,
        xchSampleCount: 4,
        avgBusLagMs: 185,
        latestBusLagMs: 185,
        latestEndToEndLagMs: 420,
        latestBusState: "ok",
        driftProbabilityPct: 72,
        driftReliabilityPct: 81,
        driftType: "EXECUTION_LATENCY",
        opportunityScorePct: 78,
        opportunityCount: 15,
        limitingFactor: { label: "Latency", scorePct: 32, tone: "warn" },
        decisionConsistencyPct: 82,
        summary: "capture BTCUSD · binance-public · xch live 420ms · stale 0% · bus 185ms · consistency 82%",
      },
      observationWindow: {
        status: "OBSERVING",
        sampleCount: 3,
        coverageHours: 96,
        minObservationHours: 72,
        maxObservationHours: 168,
        points: [],
        latest: {
          bucketStartIso: "2026-04-15T12:00:00.000Z",
          driftProbability: 72,
          reliability: 81,
          opportunityScore: 78,
          driftFalsePositiveRate: 11.1,
          opportunityHitRate: 66.7,
          decisionConsistency: 82,
          driftStability: 78,
          driftReliabilityMean: 79,
          observationStatus: "OBSERVE",
          manualCalibrationEligible: false,
        },
        deltas: [
          { metric: "driftFalsePositiveRate", current: 11.1, baseline: 13.4, delta: -2.3 },
          { metric: "opportunityHitRate", current: 66.7, baseline: 61.2, delta: 5.5 },
        ],
        gateSummary: "Fenetre d'observation active, sans ouverture calibration auto.",
      },
      anomalies: {
        activeCount: 0,
        rows: [],
      },
      noTradeHeatmap: {
        timeframes: ["1m"],
        rows: [],
        summary: "Heatmap NO_TRADE disponible sans cluster dominant.",
      },
    },
    deskRead: {
      tone: "warn",
      headline: "execution latency drift confirmed",
      summary: "Le drift est confirme par la hausse de fallback et la latence route/fill.",
      nextAction: "Traiter d'abord la friction live avant de durcir la policy.",
    },
  };
}

function buildAllowed500ConsoleErrorPatterns(): RegExp[] {
  return [
    /Failed to load resource: the server responded with a status of 500 \(Internal Server Error\)/i,
  ];
}

async function fulfillJsonRoute(
  route: { fulfill: (options: { status?: number; json?: unknown; contentType?: string; body?: string }) => Promise<void> },
  mode: ApiFailureMode,
  okPayload: unknown,
  emptyPayload: unknown,
): Promise<void> {
  if (mode === "status500") {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "simulated_failure" }),
    });
    return;
  }
  if (mode === "empty") {
    await route.fulfill({ json: emptyPayload });
    return;
  }
  if (mode === "corrupt") {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify("corrupt_payload"),
    });
    return;
  }
  await route.fulfill({ json: okPayload });
}

function attachRuntimeCollectors(page: Page): RuntimeCollectors {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const networkErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(String(error?.stack || error));
  });
  page.on("response", (response) => {
    if (response.status() < 500) {
      return;
    }
    try {
      const url = new URL(response.url());
      if (url.pathname.startsWith("/api/")) {
        networkErrors.push(`${response.status()} ${url.pathname}${url.search}`);
      }
    } catch {
      networkErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  return { consoleErrors, pageErrors, networkErrors };
}

async function primeTerminalWalkthroughState(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const runtimeWindow = window as Window & {
      __MC_TEST_ERROR_COUNT__?: number;
      __MC_TEST_ERROR_HOOKS_INSTALLED__?: boolean;
    };
    if (!runtimeWindow.__MC_TEST_ERROR_HOOKS_INSTALLED__) {
      runtimeWindow.__MC_TEST_ERROR_COUNT__ = 0;
      runtimeWindow.__MC_TEST_ERROR_HOOKS_INSTALLED__ = true;
      window.addEventListener("error", () => {
        runtimeWindow.__MC_TEST_ERROR_COUNT__ = (runtimeWindow.__MC_TEST_ERROR_COUNT__ || 0) + 1;
      });
      window.addEventListener("unhandledrejection", () => {
        runtimeWindow.__MC_TEST_ERROR_COUNT__ = (runtimeWindow.__MC_TEST_ERROR_COUNT__ || 0) + 1;
      });
    }
    window.localStorage.setItem("txt.global.walkthrough.state.v1", JSON.stringify({
      version: "3",
      roleGroup: "internal",
      done: true,
      visible: false,
      stepIndex: 0,
      validatedKeys: [],
    }));
    window.localStorage.setItem("txt.global.walkthrough.version", "3");
    window.localStorage.setItem("txt.global.walkthrough.done", "1");
    window.localStorage.setItem("txt.global.walkthrough.visible", "0");
    window.localStorage.setItem("txt.global.walkthrough.index", "0");
  });
}

async function seedOperatorSession(page: Page): Promise<void> {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const origin = new URL(page.url()).origin;
  const payload = Buffer.from(JSON.stringify({ role: "operator", exp: Math.floor(Date.now() / 1000) + 3600 }), "utf8").toString("base64url");
  const token = `${payload}.signature`;

  await page.context().addCookies([
    {
      name: "mc_token",
      value: token,
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
      secure: origin.startsWith("https://"),
    },
    {
      name: "mc_token_compat",
      value: token,
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
      secure: origin.startsWith("https://"),
    },
  ]);
}

async function installTerminalInteractionHarness(
  page: Page,
  options: TerminalInteractionHarnessOptions = {},
): Promise<void> {
  const context = page.context();
  const runtimeDecisionStatus = options.runtimeDecisionStatus ?? 200;
  const liveOpsMode = options.liveOpsMode ?? "ok";
  const marketQuotesMode = options.marketQuotesMode ?? "ok";
  const marketBusSnapshotMode = options.marketBusSnapshotMode ?? "ok";
  const marketVenueTelemetryMode = options.marketVenueTelemetryMode ?? "ok";
  const routeVenueTelemetryMode = options.routeVenueTelemetryMode ?? "ok";

  await context.route("**/api/auth/preferences", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({ json: { preferences: {}, updatedAt: new Date().toISOString() } });
      return;
    }
    await route.fulfill({ json: { ok: true, updatedAt: new Date().toISOString(), preferences: {}, conflict: false } });
  });
  await context.route("**/api/auth/status", async (route) => {
    await route.fulfill({ json: { authenticated: true, role: "operator" } });
  });
  await context.route("**/api/auth/ws-token", async (route) => {
    await route.fulfill({ json: { token: "playwright-token", controlPlaneUrl: "http://127.0.0.1:3000" } });
  });
  await context.route("**/api/dashboard/overview", async (route) => {
    await route.fulfill({ json: { system_mode: "guarded_auto", kill_switch_active: false, open_alerts: 0 } });
  });
  await context.route("**/api/connectors/status", async (route) => {
    await route.fulfill({ json: { alerts: [], connector_status: [], degradation_rows: [], linked_accounts: [] } });
  });
  await context.route("**/api/live-readiness/overview", async (route) => {
    await route.fulfill({ json: { degraded: false, upstream_status: 200, detail: null, network_state: "healthy", network: { failure_kind: "none" }, drift: { suspended_strategies: [], items: [] }, memory_kpi: { summary: {} } } });
  });
  await context.route("**/api/system/runtime-operations**", async (route) => {
    await fulfillJsonRoute(
      route,
      liveOpsMode,
      { watchdog_state: { status: "OK", health_score: 94 }, governance: { mode: "SAFE", backend_mode: "guarded_auto" }, recovery: { active: false, blocked_trades: false, mode: "NOMINAL" }, memory_gap: {}, alerts: [], risk_snapshot: { dd_pct: 0.2 } },
      {},
    );
  });
  await context.route("**/api/system/kill-switch", async (route) => {
    await route.fulfill({ json: { active: false, reason: "clear" } });
  });
  await context.route("**/api/system/micro-live-stage**", async (route) => {
    await route.fulfill({ json: { stage: "idle", provider: "mt5", status: "degraded" } });
  });
  await context.route("**/api/system/micro-live/preview", async (route) => {
    await route.fulfill({ json: { ok: true, provider: "mt5", preview: null } });
  });
  await context.route("**/api/system/shadow-metrics", async (route) => {
    await route.fulfill({ json: { fallback_rate_pct: 0, control_plane_network_pct: { degraded_usage_ratio: 0, timeout_rate: 0 }, metrics_snapshot: {} } });
  });
  await context.route("**/api/audit**", async (route) => {
    await route.fulfill({ json: [] });
  });
  await context.route("**/api/mt5/health", async (route) => {
    await route.fulfill({ json: { status: "ok", degraded: false, upstream_status: 200, latency_ms: 12 } });
  });
  await context.route("**/api/incidents", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await context.route("**/api/ai/health", async (route) => {
    await route.fulfill({ json: { providers: { providers: [] }, degraded: false, network_state: "healthy" } });
  });
  await context.route("**/api/execution/pnl-analyzer**", async (route) => {
    await route.fulfill({ json: { rows: [], stats: {} } });
  });
  await context.route("**/api/execution/reality-gap/recent**", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await context.route("**/api/execution/optimizer/live-state", async (route) => {
    await route.fulfill({ json: { state: "stable", summary: {} } });
  });
  await context.route("**/api/execution/ai/v6/state", async (route) => {
    await route.fulfill({ json: { snapshot: { guardrails: {} } } });
  });
  await context.route("**/api/terminal/v2-risk-journal**", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({
        json: {
          entries: [
            {
              id: "journal-1",
              createdAtIso: new Date().toISOString(),
              symbol: "BTCUSD",
              timeframe: "1m",
              strategy: "terminal",
              action: "execution-v7-blocked",
              detail: "routing score zero under latency stress",
              meta: {
                decision_audit: {
                  code: "routing-score-zero",
                  severity: "warn",
                  source: "runtime",
                  priority: 70,
                  policyVersion: "v7",
                },
              },
            },
          ],
        },
      });
      return;
    }
    await route.fulfill({ json: { ok: true, entry: null } });
  });
  await context.route("**/api/system/runtime-decision**", async (route) => {
    if (runtimeDecisionStatus >= 400) {
      await route.fulfill({
        status: runtimeDecisionStatus,
        contentType: "application/json",
        body: JSON.stringify({ error: "runtime_decision_unavailable" }),
      });
      return;
    }
    await route.fulfill({ json: buildRuntimeDecisionSummary() });
  });
  await context.route("**/api/system/runtime-projection**", async (route) => {
    await route.fulfill({ json: { runtime_projection_snapshot: null } });
  });
  await context.route("**/api/strategies/drift", async (route) => {
    await route.fulfill({ json: { items: [], suspended_strategies: [] } });
  });
  await context.route("**/api/market/venues/telemetry", async (route) => {
    await fulfillJsonRoute(
      route,
      marketVenueTelemetryMode,
      buildMarketVenueTelemetryPayload(),
      { network_state: "healthy", updated_at: new Date().toISOString(), venues: [] },
    );
  });
  await context.route("**/api/execution/routing/venues/telemetry**", async (route) => {
    await fulfillJsonRoute(
      route,
      routeVenueTelemetryMode,
      buildRouteVenueTelemetryPayload(),
      { network_state: "healthy", updated_at: new Date().toISOString(), venues: [] },
    );
  });
  await context.route("**/api/mt5/orders/live-pending", async (route) => {
    await route.fulfill({ json: [] });
  });
  await context.route("**/api/outcomes/recent**", async (route) => {
    await route.fulfill({ json: [] });
  });
  await context.route("**/api/broker/positions", async (route) => {
    await route.fulfill({ json: [] });
  });
  await context.route("**/api/broker/balance", async (route) => {
    await route.fulfill({ json: { balances: [] } });
  });
  await context.route("**/api/performance/summary**", async (route) => {
    await route.fulfill({ json: { totals: {}, returns: {} } });
  });
  await context.route("**/api/performance/attribution**", async (route) => {
    await route.fulfill({ json: { rows: [] } });
  });
  await context.route("**/api/accounts", async (route) => {
    await route.fulfill({ json: [{ account_id: "mt5-demo-01", account_type: "broker", display_name: "MT5 Demo" }] });
  });
  await context.route("**/api/connectors/accounts", async (route) => {
    await route.fulfill({ json: [] });
  });
  await context.route("**/api/investor-reports**", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await context.route("**/api/market/quotes**", async (route) => {
    const instrument = new URL(route.request().url()).searchParams.get("instrument") || "BTCUSD";
    if (marketQuotesMode === "alternate-only") {
      await route.fulfill({ json: buildAlternateQuotesPayload() });
      return;
    }
    await fulfillJsonRoute(route, marketQuotesMode, buildQuotesPayload(instrument), []);
  });
  await context.route("**/api/market/ohlcv**", async (route) => {
    const instrument = new URL(route.request().url()).searchParams.get("instrument") || "BTCUSD";
    await route.fulfill({ json: buildOhlcvRows(instrument) });
  });
  await context.route("**/api/market/orderbook/depth**", async (route) => {
    const instrument = new URL(route.request().url()).searchParams.get("instrument") || "BTCUSD";
    const snapshot = buildSnapshotPayload(instrument).depth_snapshot;
    await route.fulfill({ json: snapshot });
  });
  await context.route("**/api/market/bus/snapshot**", async (route) => {
    const instrument = new URL(route.request().url()).searchParams.get("instrument") || "BTCUSD";
    await fulfillJsonRoute(route, marketBusSnapshotMode, buildSnapshotPayload(instrument), {});
  });
  await context.route("**/api/health/local-terminal", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
}

async function waitForTerminalReady(page: Page): Promise<void> {
  await expect(page.locator("#username")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("mission-control-terminal-page")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("dialog", { name: "Walkthrough global TXT" })).toHaveCount(0);
  await page.waitForTimeout(500);
}

async function readNextRuntimeError(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const win = window as Window & { __NEXT_DATA__?: { err?: unknown } };
    const runtimeError = win.__NEXT_DATA__?.err;
    if (runtimeError == null) {
      return null;
    }
    if (typeof runtimeError === "string") {
      return runtimeError;
    }
    try {
      return JSON.stringify(runtimeError);
    } catch {
      return String(runtimeError);
    }
  });
}

async function expectNoHiddenRuntimeErrors(page: Page, collectors: RuntimeCollectors, checkpoint: string): Promise<void> {
  await expectNoHiddenRuntimeErrorsWithOptions(page, collectors, checkpoint);
}

async function expectNoHiddenRuntimeErrorsWithOptions(
  page: Page,
  collectors: RuntimeCollectors,
  checkpoint: string,
  options: RuntimeExpectationOptions = {},
): Promise<void> {
  await expect(page.locator("#username"), `${checkpoint}: operator session regressed`).toHaveCount(0);
  await expect(page.getByTestId("mission-control-terminal-page"), `${checkpoint}: terminal root missing`).toBeVisible();
  const nextRuntimeError = await readNextRuntimeError(page);
  const globalErrorCount = await page.evaluate(() => {
    const runtimeWindow = window as Window & { __MC_TEST_ERROR_COUNT__?: number };
    return runtimeWindow.__MC_TEST_ERROR_COUNT__ || 0;
  });
  const verdict = classifyRuntimeErrors({
    consoleErrors: collectors.consoleErrors,
    pageErrors: collectors.pageErrors,
    options: {
      ignoredConsoleErrors: options.ignoredConsoleErrors,
      expectedConsoleErrors: options.expectedConsoleErrors,
      degradedConsoleErrors: options.degradedConsoleErrors,
      ignoredPageErrors: options.ignoredPageErrors,
      expectedPageErrors: options.expectedPageErrors,
      degradedPageErrors: options.degradedPageErrors,
      legacyAllowedConsoleErrors: options.allowedConsoleErrors,
    } satisfies RuntimeErrorClassificationOptions,
  });
  const structuredBreakdown = buildStructuredRuntimeErrorBreakdown(checkpoint, verdict);
  if (collectors.consoleErrors.length > 0 || collectors.pageErrors.length > 0) {
    test.info().annotations.push({
      type: "runtime-error-classification",
      description: JSON.stringify(structuredBreakdown),
    });
  }
  expect(nextRuntimeError, `${checkpoint}: Next runtime error surfaced`).toBeNull();
  expect(globalErrorCount, `${checkpoint}: global window error count`).toBe(0);
  expect(verdict.critical.map((item) => `${item.channel}: ${item.message}`), `${checkpoint}: classified runtime errors (${formatRuntimeErrorVerdict(verdict)}) ${JSON.stringify(structuredBreakdown)} network=${JSON.stringify(collectors.networkErrors)}`).toEqual([]);
}

async function toggleButtonAndExpectStateFlip(button: Locator, timeout = 45_000): Promise<void> {
  await expect(button).toBeVisible({ timeout });
  const activeBefore = await button.evaluate((element) => element.classList.contains("active"));
  await button.click({ timeout });
  await expect.poll(async () => button.evaluate((element) => element.classList.contains("active")), { timeout }).toBe(!activeBefore);
}

async function openOpsDiagnosticsSurface(page: Page): Promise<void> {
  const diagnosticsSection = page.getByTestId("terminal-diagnostics-section");
  const stabilityTelemetry = page.getByTestId("terminal-ui-stability-telemetry");
  if (!(await diagnosticsSection.isVisible().catch(() => false))) {
    const opsToggle = page.getByTestId("terminal-focus-toggle-ops");
    if (await opsToggle.count()) {
      await expect(opsToggle).toBeAttached();
      const isActive = await opsToggle.evaluate((element) => element.classList.contains("active")).catch(() => false);
      if (!isActive) {
        await opsToggle.click();
      }
    }
  }
  await expect(diagnosticsSection).toBeAttached();
  await expect(diagnosticsSection).toBeVisible({ timeout: 45_000 });
  await expect(stabilityTelemetry).toHaveAttribute("data-ops-surface-state", "context");
  const diagnosticsButton = page.getByTestId("terminal-surface-diagnostics-button");
  await expect(diagnosticsButton).toBeAttached();
  await expect(diagnosticsButton).toBeVisible({ timeout: 45_000 });
  const isPressed = (await diagnosticsButton.getAttribute("aria-pressed")) === "true";
  if (!isPressed) {
    await diagnosticsButton.click();
  }
  await expect(diagnosticsButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("terminal-diagnostics-grid")).toBeVisible({ timeout: 45_000 });
  await expect(stabilityTelemetry).toHaveAttribute("data-ops-surface-state", "diagnostic");
  await expect(stabilityTelemetry).toHaveAttribute("data-ops-transition-lock", "0");
}

async function runDeterministicSecondaryControlFuzz(
  page: Page,
  collectors: RuntimeCollectors,
  checkpointPrefix: string,
  budget = 8,
  options: RuntimeExpectationOptions = {},
): Promise<void> {
  const terminalRoot = page.getByTestId("mission-control-terminal-page");
  const bestEffortControls = options.bestEffortSecondaryControls === true;
  const interactionTimeout = bestEffortControls ? 5_000 : 45_000;
  const actions: Array<{ name: string; run: () => Promise<void> }> = [
    {
      name: "mode novice",
      run: async () => {
        const button = terminalRoot.getByRole("button", { name: /^Novice$/i });
        await expect(button).toBeVisible({ timeout: interactionTimeout });
        await button.click({ timeout: interactionTimeout });
        await expect(button).toHaveClass(/active/, { timeout: interactionTimeout });
      },
    },
    {
      name: "mode expert",
      run: async () => {
        const button = terminalRoot.getByRole("button", { name: /^Expert$/i });
        await expect(button).toBeVisible({ timeout: interactionTimeout });
        await button.click({ timeout: interactionTimeout });
        await expect(button).toHaveClass(/active/, { timeout: interactionTimeout });
      },
    },
    {
      name: "compute perf on",
      run: async () => {
        const button = page.getByTestId("terminal-compute-perf-toggle");
        await expect(button).toBeVisible({ timeout: interactionTimeout });
        await button.click({ timeout: interactionTimeout });
        await expect(button).toHaveClass(/active/, { timeout: interactionTimeout });
      },
    },
    {
      name: "compute perf off",
      run: async () => {
        const button = page.getByTestId("terminal-compute-perf-toggle");
        await expect(button).toBeVisible({ timeout: interactionTimeout });
        await button.click({ timeout: interactionTimeout });
        await expect(button).not.toHaveClass(/active/, { timeout: interactionTimeout });
      },
    },
    {
      name: "boot full",
      run: async () => {
        const button = page.getByRole("button", { name: /^Boot Full$/i });
        await expect(button).toBeVisible({ timeout: interactionTimeout });
        await button.click({ timeout: interactionTimeout });
        await expect(button).toHaveClass(/active/, { timeout: interactionTimeout });
      },
    },
    {
      name: "boot light",
      run: async () => {
        const button = page.getByRole("button", { name: /^Boot Light$/i });
        await expect(button).toBeVisible({ timeout: interactionTimeout });
        await button.click({ timeout: interactionTimeout });
        await expect(button).toHaveClass(/active/, { timeout: interactionTimeout });
      },
    },
    {
      name: "layout edit on",
      run: async () => {
        await toggleButtonAndExpectStateFlip(page.getByRole("button", { name: /^Layout Edit /i }), interactionTimeout);
      },
    },
    {
      name: "layout edit off",
      run: async () => {
        await toggleButtonAndExpectStateFlip(page.getByRole("button", { name: /^Layout Edit /i }), interactionTimeout);
      },
    },
    {
      name: "full surface",
      run: async () => {
        const button = page.getByRole("button", { name: /^Full Surface$/i });
        await expect(button).toBeVisible({ timeout: interactionTimeout });
        await button.click({ timeout: interactionTimeout });
        await expect(button).toHaveClass(/active/, { timeout: interactionTimeout });
      },
    },
    {
      name: "live focus",
      run: async () => {
        const button = page.getByRole("button", { name: /^Live Focus$/i });
        await expect(button).toBeVisible({ timeout: interactionTimeout });
        await button.click({ timeout: interactionTimeout });
        await expect(button).toHaveClass(/active/, { timeout: interactionTimeout });
      },
    },
  ];

  for (const action of actions.slice(0, budget)) {
    let completed = true;
    try {
      await action.run();
    } catch (error) {
      if (!bestEffortControls) {
        throw error;
      }
      completed = false;
      test.info().annotations.push({
        type: "secondary-control-skipped",
        description: `${action.name}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    await expectNoHiddenRuntimeErrorsWithOptions(page, collectors, `${checkpointPrefix}: ${action.name}${completed ? "" : " (skipped)"}`, options);
  }
}

async function expectLiveOpsFallbackState(
  page: Page,
  mode: ApiFailureMode,
): Promise<void> {
  await expect(page.getByTestId("terminal-diagnostics-grid")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/Operator Monitoring/i).first()).toBeVisible({ timeout: 45_000 });

  if (mode !== "status500") {
    return;
  }

  await expect.poll(async () => {
    const panelFallbackVisible = await page.getByText(/Control room indisponible\./i).first().isVisible().catch(() => false);
    const watchdogUnknownVisible = await page.getByText(/watchdog UNKNOWN/i).first().isVisible().catch(() => false);
    const requestFailureVisible = await page.getByText(/\/api\/system\/runtime-operations\?view=terminal -> 500/i).first().isVisible().catch(() => false);
    return panelFallbackVisible || watchdogUnknownVisible || requestFailureVisible;
  }, { timeout: 45_000 }).toBe(true);
}

async function expectFeedFailureState(page: Page): Promise<void> {
  await expect(page.getByTestId("mission-control-terminal-page")).toBeVisible({ timeout: 45_000 });
  await expect(
    page.getByText(/No renderable candles|LOCAL UNUSABLE|OHLCV UNUSABLE|Preview candles/i).first(),
  ).toBeVisible({ timeout: 45_000 });
}

async function expectOperationalDiagnosticsState(page: Page): Promise<void> {
  await expect(page.getByTestId("mission-control-terminal-page")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("terminal-diagnostics-grid")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("execution-runtime-decision-compact")).toBeVisible({ timeout: 45_000 });
}

async function expectVenueTelemetryState(page: Page): Promise<void> {
  await expect(page.getByText(/^Venue Telemetry$/i).first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/binance-public|okx-public/i).first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/Télémétrie venue indisponible\./i)).toHaveCount(0);
}

test.describe("terminal interaction scan", () => {
  test("covers terminal mode and action transitions without hidden runtime errors", async ({ page }) => {
    test.setTimeout(240_000);

    const collectors = attachRuntimeCollectors(page);
    await primeTerminalWalkthroughState(page);
    await installTerminalInteractionHarness(page);
    await seedOperatorSession(page);

    await page.goto("/terminal?boot=light", { waitUntil: "domcontentloaded" });
    await waitForTerminalReady(page);

    await expect(page.getByTestId("terminal-context-layer")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("terminal-context-card-drift")).toBeVisible();
    await expect(page.getByTestId("terminal-context-card-opportunity")).toBeVisible();
    await expect(page.getByTestId("terminal-context-card-market")).toBeVisible();
    await expectNoHiddenRuntimeErrors(page, collectors, "initial load");

    await test.step("open ops family in focus mode", async () => {
      await page.getByTestId("terminal-focus-toggle-ops").click();
      await expect(page.getByTestId("terminal-diagnostics-section")).toBeVisible({ timeout: 45_000 });
      await expect(page.getByTestId("execution-runtime-decision-compact")).toBeVisible({ timeout: 45_000 });
      await expect(page.getByTestId("execution-runtime-decision-quick-read")).toBeVisible({ timeout: 45_000 });
      await expect(page.getByTestId("execution-runtime-decision-quick-read-observation")).toContainText("OBS observe");
      await expectNoHiddenRuntimeErrors(page, collectors, "ops focus deck opened");
    });

    await test.step("switch diagnostics surface on", async () => {
      const diagnosticsButton = page.getByTestId("terminal-surface-diagnostics-button");
      await diagnosticsButton.click();
      await expect(diagnosticsButton).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("terminal-diagnostics-grid")).toBeVisible({ timeout: 45_000 });
      await expectNoHiddenRuntimeErrors(page, collectors, "diagnostics surface opened");
    });

    await test.step("return to context surface", async () => {
      const contextButton = page.getByTestId("terminal-surface-context-button");
      await contextButton.click();
      await expect(contextButton).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("terminal-diagnostics-grid")).toBeHidden();
      await expectNoHiddenRuntimeErrors(page, collectors, "context surface restored");
    });

    await test.step("toggle additional focus decks", async () => {
      await toggleButtonAndExpectStateFlip(page.getByTestId("terminal-focus-toggle-markets"));
      await toggleButtonAndExpectStateFlip(page.getByTestId("terminal-focus-toggle-micro"));
      await expectNoHiddenRuntimeErrors(page, collectors, "focus deck toggles");
    });

    await test.step("switch density modes", async () => {
      const fullSurfaceButton = page.getByRole("button", { name: /^Full Surface$/i });
      await fullSurfaceButton.click();
      await expect(fullSurfaceButton).toHaveClass(/active/);
      await expect(page.getByTestId("terminal-focus-toggle-ops")).toHaveCount(0);

      const liveFocusButton = page.getByRole("button", { name: /^Live Focus$/i });
      await liveFocusButton.click();
      await expect(liveFocusButton).toHaveClass(/active/);
      await expect(page.getByTestId("terminal-focus-toggle-ops")).toBeVisible({ timeout: 45_000 });
      await expectNoHiddenRuntimeErrors(page, collectors, "density mode switches");
    });

    await test.step("switch boot profiles", async () => {
      const bootFullButton = page.getByRole("button", { name: /^Boot Full$/i });
      await bootFullButton.click();
      await expect(bootFullButton).toHaveClass(/active/);

      const bootLightButton = page.getByRole("button", { name: /^Boot Light$/i });
      await bootLightButton.click();
      await expect(bootLightButton).toHaveClass(/active/);
      await expectNoHiddenRuntimeErrors(page, collectors, "boot profile switches");
    });

    await test.step("apply layout presets and edit toggle", async () => {
      const scalpButton = page.getByRole("button", { name: /^Scalp /i });
      await scalpButton.click();
      await expect(scalpButton).toHaveClass(/active/);

      const monitoringButton = page.getByRole("button", { name: /^Monitoring /i });
      await monitoringButton.click();
      await expect(monitoringButton).toHaveClass(/active/);

      const swingButton = page.getByRole("button", { name: /^Swing /i });
      await swingButton.click();
      await expect(swingButton).toHaveClass(/active/);

      const layoutEditButton = page.getByRole("button", { name: /^Layout Edit /i });
      await toggleButtonAndExpectStateFlip(layoutEditButton);
      await toggleButtonAndExpectStateFlip(layoutEditButton);
      await expectNoHiddenRuntimeErrors(page, collectors, "layout actions and presets");
    });
  });

  test("keeps terminal interactive when runtime decision API fails", async ({ page }) => {
    test.setTimeout(180_000);

    const collectors = attachRuntimeCollectors(page);
    await primeTerminalWalkthroughState(page);
    await installTerminalInteractionHarness(page, { runtimeDecisionStatus: 500 });
    await seedOperatorSession(page);

    await page.goto("/terminal?boot=light", { waitUntil: "domcontentloaded" });
    await waitForTerminalReady(page);

    const allowedRuntimeDecisionFailureConsoleErrors = buildAllowed500ConsoleErrorPatterns();

    await page.getByTestId("terminal-focus-toggle-ops").click();
    await expect(page.getByTestId("terminal-diagnostics-section")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/Runtime decision summary indisponible/i).first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("execution-runtime-decision-quick-read")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("execution-runtime-decision-quick-read")).toHaveAttribute("data-runtime-summary-state", "error");
    await expectNoHiddenRuntimeErrorsWithOptions(page, collectors, "runtime decision api failure visible state", {
      allowedConsoleErrors: allowedRuntimeDecisionFailureConsoleErrors,
    });

    await page.getByTestId("terminal-surface-diagnostics-button").click();
    await expect(page.getByTestId("terminal-diagnostics-grid")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/Runtime decision summary indisponible/i).first()).toBeVisible();
    await expectNoHiddenRuntimeErrorsWithOptions(page, collectors, "runtime decision api failure diagnostics mode", {
      allowedConsoleErrors: allowedRuntimeDecisionFailureConsoleErrors,
    });

    await page.getByTestId("terminal-surface-context-button").click();
    await expect(page.getByTestId("terminal-diagnostics-grid")).toBeHidden();
    await expect(page.getByText(/Runtime decision summary indisponible/i).first()).toBeVisible();
    await expectNoHiddenRuntimeErrorsWithOptions(page, collectors, "runtime decision api failure context mode", {
      allowedConsoleErrors: allowedRuntimeDecisionFailureConsoleErrors,
    });
  });

  test.describe("backend failure matrix", () => {
    const cases: Array<{
      name: string;
      options: TerminalInteractionHarnessOptions;
      assertVisibleEffect: (page: Page) => Promise<void>;
      allowedConsoleErrors?: RegExp[];
    }> = [
      {
        name: "live-ops 500 keeps diagnostics interactive",
        options: { liveOpsMode: "status500" },
        assertVisibleEffect: async (page) => expectLiveOpsFallbackState(page, "status500"),
        allowedConsoleErrors: buildAllowed500ConsoleErrorPatterns(),
      },
      {
        name: "live-ops corrupt payload keeps diagnostics interactive",
        options: { liveOpsMode: "corrupt" },
        assertVisibleEffect: async (page) => expectLiveOpsFallbackState(page, "corrupt"),
      },
      {
        name: "live-ops empty payload degrades safely",
        options: { liveOpsMode: "empty" },
        assertVisibleEffect: async (page) => expectLiveOpsFallbackState(page, "empty"),
      },
      {
        name: "market quotes 500 keeps terminal stable",
        options: { marketQuotesMode: "status500" },
        assertVisibleEffect: expectOperationalDiagnosticsState,
        allowedConsoleErrors: buildAllowed500ConsoleErrorPatterns(),
      },
      {
        name: "market quotes empty payload keeps terminal stable",
        options: { marketQuotesMode: "empty" },
        assertVisibleEffect: expectOperationalDiagnosticsState,
      },
      {
        name: "market snapshot 500 triggers bounded fallback path",
        options: { marketQuotesMode: "alternate-only", marketBusSnapshotMode: "status500" },
        assertVisibleEffect: expectOperationalDiagnosticsState,
        allowedConsoleErrors: buildAllowed500ConsoleErrorPatterns(),
      },
      {
        name: "market snapshot corrupt payload triggers bounded fallback path",
        options: { marketQuotesMode: "alternate-only", marketBusSnapshotMode: "corrupt" },
        assertVisibleEffect: expectOperationalDiagnosticsState,
      },
      {
        name: "market venues telemetry 500 keeps venue diagnostics interactive",
        options: { marketVenueTelemetryMode: "status500" },
        assertVisibleEffect: expectVenueTelemetryState,
        allowedConsoleErrors: buildAllowed500ConsoleErrorPatterns(),
      },
      {
        name: "market venues telemetry corrupt payload keeps venue diagnostics interactive",
        options: { marketVenueTelemetryMode: "corrupt" },
        assertVisibleEffect: expectVenueTelemetryState,
      },
      {
        name: "market venues telemetry empty payload degrades safely",
        options: { marketVenueTelemetryMode: "empty" },
        assertVisibleEffect: expectVenueTelemetryState,
      },
      {
        name: "route venues telemetry 500 keeps venue diagnostics interactive",
        options: { routeVenueTelemetryMode: "status500" },
        assertVisibleEffect: expectVenueTelemetryState,
        allowedConsoleErrors: buildAllowed500ConsoleErrorPatterns(),
      },
      {
        name: "route venues telemetry corrupt payload keeps venue diagnostics interactive",
        options: { routeVenueTelemetryMode: "corrupt" },
        assertVisibleEffect: expectVenueTelemetryState,
      },
      {
        name: "route venues telemetry empty payload degrades safely",
        options: { routeVenueTelemetryMode: "empty" },
        assertVisibleEffect: expectVenueTelemetryState,
      },
    ];

    for (const scenario of cases) {
      test(scenario.name, async ({ page }) => {
        test.setTimeout(180_000);

        const collectors = attachRuntimeCollectors(page);
        await primeTerminalWalkthroughState(page);
        await installTerminalInteractionHarness(page, scenario.options);
        await seedOperatorSession(page);

        await page.goto("/terminal?boot=light", { waitUntil: "domcontentloaded" });
        await waitForTerminalReady(page);
        await openOpsDiagnosticsSurface(page);
        await scenario.assertVisibleEffect(page);
        await expectNoHiddenRuntimeErrorsWithOptions(page, collectors, `${scenario.name}: visible effect`, {
          allowedConsoleErrors: scenario.allowedConsoleErrors,
        });
        await runDeterministicSecondaryControlFuzz(page, collectors, `${scenario.name}: secondary fuzz`, 6, {
          allowedConsoleErrors: scenario.allowedConsoleErrors,
          bestEffortSecondaryControls: true,
        });
      });
    }
  });

  test("runs a bounded deterministic fuzz on secondary terminal controls", async ({ page }) => {
    test.setTimeout(180_000);

    const collectors = attachRuntimeCollectors(page);
    await primeTerminalWalkthroughState(page);
    await installTerminalInteractionHarness(page);
    await seedOperatorSession(page);

    await page.goto("/terminal?boot=light", { waitUntil: "domcontentloaded" });
    await waitForTerminalReady(page);
    await openOpsDiagnosticsSurface(page);
    await runDeterministicSecondaryControlFuzz(page, collectors, "bounded secondary fuzz", 8);
  });
});