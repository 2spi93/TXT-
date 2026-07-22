import { expect, test } from "@playwright/test";

import { loginIfRequired } from "./helpers/terminal";

function buildLiveOpsPayload() {
  const nowIso = "2026-04-16T12:34:56.000Z";

  return {
    updated_at: nowIso,
    watchdog_state: {
      status: "HALT",
      health_score: 37,
      triggers: ["latency spike", "broker disconnect"],
    },
    governance: {
      mode: "LOCKED",
      backend_mode: "managed_live",
    },
    recovery: {
      active: true,
      mode: "SAFE_RECOVERY",
    },
    memory_gap: {
      memory_decision: "BLOCKED",
    },
    alerts: [{ id: "ops-1" }, { id: "ops-2" }],
    risk_snapshot: {
      dd_pct: 1.75,
      dd_usd: 425,
      avg_slippage_bps: 2.4,
      daily_used_usd: 2400,
      exposure_by_symbol: [
        {
          symbol: "BTCUSD",
          notionalUsd: 125000,
        },
      ],
    },
    risk_timeline: [
      {
        at: nowIso,
        exposure_symbol: "BTCUSD",
        dd_pct: 1.75,
      },
    ],
    audit_trail: [
      {
        at: nowIso,
        route: "route-live",
        result: "BLOCK",
      },
    ],
    warfare_core: {
      market_state: {
        state: "HIGH_VOL",
        confidence: 0.82,
      },
      smart_money: {
        state: "ACTIVE",
      },
      spoof: {
        state: "ALERT",
      },
      domination: {
        state: "SELLER",
      },
      arbitrage: {
        executable: true,
        netEdgeBps: 9.5,
        maxExecutableUsd: 18000,
        buyVenue: "binance-public",
        sellVenue: "okx-public",
        rankings: [
          {
            venue: "binance-public",
            totalCostBps: 1.2,
            latencyMs: 46,
            availableDepthUsd: 22000,
            executable: true,
          },
        ],
      },
    },
  };
}

function buildExecutionPnlPayload() {
  const nowIso = "2026-04-16T12:34:56.000Z";

  return {
    updated_at: nowIso,
    summary: {
      trade_count: 11,
      avg_latency_ms: 148,
      avg_slippage_bps: 2.8,
      net_pnl_usd: 84,
      high_confidence_loss_count: 2,
      no_trade_dominance_count: 5,
      win_rate_pct: 54.5,
      avg_pnl_usd: 7.64,
      fees_usd: 18,
    },
    trades: [
      {
        decision_id: "decision-latency",
        created_at: nowIso,
        venue: "binance-public",
        regime: "TREND",
        net_result_usd: -30,
        latency_ms: 166,
        slippage_real_bps: 3.2,
        confidence: 0.82,
        fallback_mode: "latency_degraded",
        no_trade_dominance: true,
        dominant_reasons: ["latency spike"],
        no_trade_reasons: ["book vacuum"],
      },
      {
        decision_id: "decision-retry",
        created_at: "2026-04-16T12:20:00.000Z",
        venue: "binance-public",
        regime: "TREND",
        net_result_usd: 46,
        latency_ms: 132,
        slippage_real_bps: 2.1,
        confidence: 0.76,
        fallback_mode: "guarded_auto",
        no_trade_dominance: true,
        dominant_reasons: ["latency spike"],
        no_trade_reasons: ["book vacuum"],
      },
    ],
    by_regime: [
      {
        regime: "TREND",
        trade_count: 6,
        win_rate_pct: 50,
        net_pnl_usd: 24,
      },
      {
        regime: "RANGE",
        trade_count: 5,
        win_rate_pct: 60,
        net_pnl_usd: 60,
      },
    ],
    by_venue: [
      {
        venue: "binance-public",
        avg_latency_ms: 148,
        avg_slippage_bps: 2.8,
        net_pnl_usd: 84,
      },
    ],
    by_execution_mode: [
      {
        execution_mode: "guarded_auto",
        high_confidence_losses: 2,
        net_pnl_usd: 84,
      },
    ],
    bad_model_flags: [
      {
        decision_id: "decision-latency",
        regime: "TREND",
        venue: "binance-public",
        net_result_usd: -30,
      },
    ],
  };
}

function buildExecutionAiPayload() {
  return {
    snapshot: {
      context_count: 12,
      guardrails: {
        learning_frozen: false,
        persistence_available: true,
      },
    },
  };
}

function buildRuntimeDecisionSummary() {
  const opportunityBreakdown = [
    {
      key: "spread",
      label: "Spread",
      score: 0.8,
      scorePct: 80,
      tone: "good",
      detail: "1.20bp vs budget 6.00bp",
    },
    {
      key: "depth",
      label: "Depth",
      score: 0.74,
      scorePct: 74,
      tone: "good",
      detail: "fresh 44ms · 120k USD · fill 87%",
    },
    {
      key: "latency",
      label: "Latency",
      score: 0.32,
      scorePct: 32,
      tone: "warn",
      detail: "route 188ms · fill 214ms",
    },
    {
      key: "regime",
      label: "Regime",
      score: 0.62,
      scorePct: 62,
      tone: "subtle",
      detail: "vol medium",
    },
  ];

  return {
    scope: {
      symbol: "DESK",
      timeframe: "live",
      strategy: "live-ops",
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
      {
        code: "routing-score-zero",
        family: "runtime",
        bucket: "runtime",
        count: 4,
        sharePct: 44.4,
      },
      {
        code: "fallback-mode",
        family: "runtime",
        bucket: "runtime",
        count: 2,
        sharePct: 22.2,
      },
    ],
    byBucket: [
      {
        bucket: "runtime",
        count: 6,
        sharePct: 66.7,
      },
      {
        bucket: "policy",
        count: 3,
        sharePct: 33.3,
      },
    ],
    byFamily: [
      {
        family: "runtime",
        count: 6,
        sharePct: 66.7,
      },
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
      avgScore: 62,
      confidencePct: 100,
      highQualityRate: 40,
      missingSignals: [],
      blockedByBucket: [
        {
          bucket: "runtime",
          count: 4,
          sharePct: 80,
        },
        {
          bucket: "policy",
          count: 1,
          sharePct: 20,
        },
      ],
      topBlockedBucket: {
        label: "runtime",
        count: 4,
        sharePct: 80,
      },
      liveState: "CONSTRAINED",
      liveSummary: "Gate live contraint par route 188ms > 140ms.",
      telemetry: {
        availability: "ready",
        source: "venue-telemetry",
        venueCount: 2,
        marketVenueCount: 2,
        routeVenueCount: 2,
        avgSpreadBps: 1.2,
        avgAvailableDepthUsd: 120000,
        avgDepthLatencyMs: 44,
        avgFillProbability: 0.87,
        avgStabilityScore: 0.78,
        avgRouteLatencyMs: 188,
        avgFillLatencyMs: 214,
        avgSlippageBps: 2.1,
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
      breakdown: opportunityBreakdown,
      topRanked: [
        {
          createdAtIso: "2026-04-16T12:34:56.000Z",
          code: "entry-valid",
          bucket: "market",
          score: 0.62,
          scorePct: 62,
          attentionState: "stable",
          volatilityRegime: "medium",
          status: "BLOCKED",
          breakdown: opportunityBreakdown,
          rationale: "constraint latency · support spread + depth · vol medium",
          confidence: 1,
          confidencePct: 100,
          missing: [],
        },
      ],
      summary: "Score moyen 62% · contrainte dominante latency 32% · 33.3% des contextes tradables restent bloques.",
    },
    drift: {
      detected: true,
      tone: "warn",
      state: "DRIFT",
      type: "SYSTEM_HEALTH",
      score: 0.64,
      scorePct: 64,
      stats: {
        probabilityPct: 81,
        reliabilityPct: 73,
        confidencePct: 77,
      },
      cause: {
        summary: "runtime guards et watchdog restent la friction dominante.",
      },
      windows: {
        "1h": {
          label: "1h",
          type: "SYSTEM_HEALTH",
          driftScorePct: 64,
          routingZeroRate: 33.3,
          runtimeBlockRate: 50,
        },
        "6h": {
          label: "6h",
          type: "SYSTEM_HEALTH",
          driftScorePct: 42,
          routingZeroRate: 22.2,
          runtimeBlockRate: 33.3,
        },
        "24h": {
          label: "24h",
          type: "SYSTEM_HEALTH",
          driftScorePct: 19,
          routingZeroRate: 11.1,
          runtimeBlockRate: 16.7,
        },
      },
      alerts: [
        {
          currentWindow: "1h",
          metric: "runtimeBlockRate",
          type: "SYSTEM_HEALTH",
          severity: "critical",
          currentRate: 50,
          baselineRate: 16.7,
        },
      ],
      history: [
        {
          iso: "2026-04-16T12:00:00.000Z",
          state: "WATCH",
          metric: "runtimeBlockRate",
        },
        {
          iso: "2026-04-16T12:30:00.000Z",
          state: "DRIFT",
          metric: "runtimeBlockRate",
        },
      ],
      alertFeed: [],
      headline: "system health drift confirmed",
      summary: "runtimeBlockRate +200% vs 24h.",
    },
    series: {
      bucketHours: 1,
      windowHours: 24,
      points: [
        {
          routingZeroRate: 10,
          runtimeBlockRate: 20,
          opportunityRate: 60,
          driftScorePct: 31,
        },
        {
          routingZeroRate: 33.3,
          runtimeBlockRate: 50,
          opportunityRate: 62.5,
          driftScorePct: 64,
        },
      ],
    },
    dominant: {
      bucket: {
        label: "runtime",
        count: 6,
        sharePct: 66.7,
      },
      code: {
        label: "routing-score-zero",
        count: 4,
        sharePct: 44.4,
      },
      attentionState: {
        label: "stable",
        count: 20,
        sharePct: 83.3,
      },
      volatilityRegime: {
        label: "medium",
        count: 18,
        sharePct: 75,
      },
    },
    observation: {
      status: "READY_FOR_REVIEW",
      sampleHours: 120,
      minObservationHours: 72,
      maxObservationHours: 168,
      driftFalsePositiveRate: 9.2,
      driftDetectionRate: 66,
      driftStability: 74,
      opportunityHitRate: 58,
      decisionConsistency: 71,
      driftReliabilityMean: 69,
      decisionOutcomeCoveragePct: 64,
      manualCalibrationEligible: false,
      recommendation: "Fenetre active 120.0h/168h. Continuer la revue manuelle sans toucher a l'automatisation.",
    },
    monitoring: {
      live: {
        staleRateXchPct: 50,
        latestXchStatus: "LIVE",
        latestFeedLabel: "binance-public",
        latestXchAgeLabel: "18s",
        latestBusLagMs: 185,
      },
      anomalies: {
        rows: [],
      },
    },
    deskRead: {
      tone: "warn",
      headline: "System health drift dominates current refusals",
      summary: "Runtime guards and watchdog pressure remain the dominant blockers.",
      nextAction: "Treat system-health friction before revisiting calibration or policy.",
    },
  };
}

function buildNominalLiveOpsPayload() {
  const payload = buildLiveOpsPayload();
  return {
    ...payload,
    watchdog_state: {
      ...payload.watchdog_state,
      status: "OK",
      health_score: 84,
      triggers: [],
    },
    governance: {
      mode: "SAFE",
      backend_mode: "guarded_auto",
    },
    recovery: {
      active: false,
      mode: "NOMINAL",
    },
    memory_gap: {
      memory_decision: "OK",
    },
    alerts: [],
    risk_snapshot: {
      ...payload.risk_snapshot,
      dd_pct: 0.35,
      dd_usd: 72,
      avg_slippage_bps: 1.1,
      daily_used_usd: 900,
    },
    risk_timeline: [{ at: payload.updated_at, exposure_symbol: "BTCUSD", dd_pct: 0.35 }],
    audit_trail: [{ at: payload.updated_at, route: "route-live", result: "OK" }],
    warfare_core: {
      market_state: { state: "TREND", confidence: 0.74 },
      smart_money: { state: "ACTIVE" },
      spoof: { state: "CLEAR" },
      domination: { state: "BALANCED" },
    },
  };
}

function buildNominalExecutionPnlPayload() {
  const payload = buildExecutionPnlPayload();
  return {
    ...payload,
    summary: {
      ...payload.summary,
      avg_latency_ms: 64,
      avg_slippage_bps: 1.1,
      net_pnl_usd: 52,
      high_confidence_loss_count: 0,
      no_trade_dominance_count: 4,
      win_rate_pct: 63.6,
      avg_pnl_usd: 4.73,
      fees_usd: 9,
    },
    trades: [
      {
        ...payload.trades[0],
        net_result_usd: 12,
        latency_ms: 72,
        slippage_real_bps: 1.2,
        confidence: 0.76,
        fallback_mode: "normal",
        no_trade_dominance: false,
        dominant_reasons: ["telemetry guard"],
        no_trade_reasons: ["route execution missing"],
      },
    ],
    by_venue: [{ venue: "binance-public", avg_latency_ms: 64, avg_slippage_bps: 1.1, net_pnl_usd: 52 }],
    by_execution_mode: [{ execution_mode: "guarded_auto", high_confidence_losses: 0, net_pnl_usd: 52 }],
    bad_model_flags: [],
  };
}

function buildRuntimeDecisionPartialSummary() {
  const summary = buildRuntimeDecisionSummary();
  const breakdown = summary.opportunity.breakdown.map((item) => item.key === "latency"
    ? {
        ...item,
        score: 0,
        scorePct: 0,
        tone: "warn",
        detail: "latency missing",
        available: false,
      }
    : item);
  const telemetrySummary = "Telemetry partielle: stats execution route absentes sur 2 venue(s) · latence route non observee · slippage route absent · profile route brut detecte (latency_base_ms) sans budgets max_*.";
  return {
    ...summary,
    opportunity: {
      ...summary.opportunity,
      avgScore: 71,
      confidencePct: 80,
      missingSignals: ["latency"],
      liveState: "NO_DATA_PARTIAL",
      liveSummary: `NO_DATA_PARTIAL · ${telemetrySummary}`,
      telemetry: {
        ...summary.opportunity.telemetry,
        availability: "partial",
        avgRouteLatencyMs: null,
        avgFillLatencyMs: null,
        avgSlippageBps: null,
        spreadBudgetBps: null,
        latencyBudgetMs: null,
        summary: telemetrySummary,
        rootCause: "PARTIAL_PAYLOAD",
        missingFields: ["execution", "latency", "slippage", "budget_profile"],
        integrity: {
          state: "PARTIAL",
          summary: "execution telemetry partial · route 0/2 venue(s) avec stats execution · NO_EXECUTION_STATS · NO_EXECUTION_LATENCY · NO_EXECUTION_SLIPPAGE · RAW_EXECUTION_PROFILE · NO_EXECUTION_BUDGET",
          routeCoveragePct: 0,
          executionVenueCount: 0,
          routeVenueCount: 2,
          marketVenueCount: 2,
          items: [
            { code: "NO_EXECUTION_STATS", label: "NO_EXECUTION_STATS", detail: "stats execution route absentes sur 2 venue(s)", severity: "critical", source: "route", affectedVenueCount: 2 },
            { code: "NO_EXECUTION_LATENCY", label: "NO_EXECUTION_LATENCY", detail: "latence execution/route non observee", severity: "critical", source: "route", affectedVenueCount: 2 },
            { code: "NO_EXECUTION_SLIPPAGE", label: "NO_EXECUTION_SLIPPAGE", detail: "slippage execution absent", severity: "critical", source: "route", affectedVenueCount: 2 },
            { code: "RAW_EXECUTION_PROFILE", label: "RAW_EXECUTION_PROFILE", detail: "profile route brut detecte (latency_base_ms, latency_jitter_ms)", severity: "warning", source: "route", affectedVenueCount: 2 },
            { code: "NO_EXECUTION_BUDGET", label: "NO_EXECUTION_BUDGET", detail: "budgets route max_* absents", severity: "warning", source: "route", affectedVenueCount: 2 },
          ],
        },
      },
      breakdown,
      topRanked: [{
        ...summary.opportunity.topRanked[0],
        score: 0.71,
        scorePct: 71,
        breakdown,
        rationale: "support spread + depth · missing latency · vol medium",
        confidence: 0.8,
        confidencePct: 80,
        missing: ["latency"],
      }],
      summary: `NO_DATA_PARTIAL · ${telemetrySummary}`,
    },
    deskRead: {
      tone: "warn",
      headline: "Live telemetry is partial",
      summary: `NO_DATA_PARTIAL · ${telemetrySummary}`,
      nextAction: "Restaurer les stats execution route ou adapter le parseur a la shape profile brute avant toute lecture du gate live.",
    },
  };
}

function buildJournalEntries() {
  return [
    {
      id: "journal-1",
      createdAtIso: "2026-04-16T12:34:56.000Z",
      symbol: "DESK",
      timeframe: "live",
      strategy: "live-ops",
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
    {
      id: "journal-2",
      createdAtIso: "2026-04-16T12:20:00.000Z",
      symbol: "DESK",
      timeframe: "live",
      strategy: "live-ops",
      action: "execution-v7-outcome-positive",
      detail: "guarded execution recovered into positive pnl",
      meta: {
        decision_audit: {
          code: "execution-v7-outcome-positive",
          severity: "good",
          source: "runtime",
          priority: 40,
          policyVersion: "v7",
        },
      },
    },
  ];
}

test("live-ops panels hydrate their payloads", async ({ page }) => {
  test.setTimeout(180_000);

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.stack || error.message || String(error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.route("**/api/system/live-ops", async (route) => {
    await route.fulfill({ json: buildLiveOpsPayload() });
  });
  await page.route("**/api/execution/pnl-analyzer**", async (route) => {
    await route.fulfill({ json: buildExecutionPnlPayload() });
  });
  await page.route("**/api/execution/ai/v6/state", async (route) => {
    await route.fulfill({ json: buildExecutionAiPayload() });
  });
  await page.route("**/api/system/runtime-decision**", async (route) => {
    await route.fulfill({ json: buildRuntimeDecisionSummary() });
  });
  await page.route("**/api/strategies/drift", async (route) => {
    await route.fulfill({ json: { items: [], suspended_strategies: [] } });
  });
  await page.route("**/api/terminal/v2-risk-journal**", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({ json: { entries: buildJournalEntries() } });
      return;
    }

    await route.fulfill({ json: { ok: true, entry: null } });
  });

  await loginIfRequired(page, "/live-ops", "live ops panel hydration");

  await expect(page.getByTestId("mission-control-live-ops-page")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "H24 Control Room" })).toBeVisible({ timeout: 45_000 });

  const operatorActionPanel = page.locator(".operator-action-panel");
  await expect(operatorActionPanel).toContainText("STOP");
  await expect(operatorActionPanel).toContainText("Arrete le live et repasse par la verification.");
  await expect(operatorActionPanel).toContainText("watchdog en HALT");
  await expect(operatorActionPanel).toContainText("latence moyenne 148ms");
  await expect(operatorActionPanel.locator(".operator-dominance-card")).toContainText("45%");
  await expect(operatorActionPanel.locator(".operator-dominance-card")).toContainText("EXPLOITABLE");
  await expect(page.getByTestId("execution-runtime-decision-quick-read-drift")).toContainText("DRIFT system health");
  await expect(page.getByTestId("execution-runtime-decision-quick-read-drift")).toContainText("P 81% | R 73% | C 77%");
  await expect(page.getByTestId("execution-runtime-decision-quick-read-opportunity")).toContainText("OPPORTUNITY 62%");
  await expect(page.getByTestId("execution-runtime-decision-quick-read-opportunity")).toContainText("facteur limitant latency 32%");
  await expect(page.getByTestId("execution-runtime-decision-quick-read-live")).toContainText("LIVE XCH 50%");

  const controlRoomPanel = page.locator(".monitoring-col").filter({ hasText: "H24 Control Room" }).first();
  await expect(controlRoomPanel).toContainText("Health score");
  await expect(controlRoomPanel).toContainText("37%");
  await expect(controlRoomPanel).toContainText("watchdog HALT");
  await expect(controlRoomPanel).toContainText("System lock");
  await expect(controlRoomPanel).toContainText("LOCKED");
  await expect(controlRoomPanel).toContainText("Memory gate");
  await expect(controlRoomPanel).toContainText("BLOCKED");
  await expect(controlRoomPanel).toContainText("1.75% · 425 USD");
  await expect(controlRoomPanel).toContainText("HIGH_VOL · 82%");
  await expect(controlRoomPanel).toContainText("Triggers: latency spike · broker disconnect");
  await expect(controlRoomPanel).toContainText("binance-pu");
  await expect(controlRoomPanel).toContainText("route-live");

  const pnlTruthPanel = page.locator(".monitoring-col").filter({ hasText: "Execution PnL Truth" }).first();
  await expect(pnlTruthPanel).toContainText("trades 11");
  await expect(pnlTruthPanel).toContainText("flags 2");
  await expect(pnlTruthPanel).toContainText("Reward pro");
  await expect(pnlTruthPanel).toContainText("No-trade dominance");
  await expect(pnlTruthPanel).toContainText("Dominance trades");
  await expect(pnlTruthPanel).toContainText("5 / 11");
  await expect(pnlTruthPanel).toContainText("latency spike x2");
  await expect(pnlTruthPanel).toContainText("TREND");
  await expect(pnlTruthPanel).toContainText("binance-public");
  await expect(pnlTruthPanel).toContainText("guarded_auto");
  await expect(pnlTruthPanel).toContainText("decision-latency");

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("live-ops panels surface NO_DATA_PARTIAL telemetry guardrails beyond the runtime summary", async ({ page }) => {
  test.setTimeout(180_000);

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.stack || error.message || String(error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.route("**/api/system/live-ops", async (route) => {
    await route.fulfill({ json: buildNominalLiveOpsPayload() });
  });
  await page.route("**/api/execution/pnl-analyzer**", async (route) => {
    await route.fulfill({ json: buildNominalExecutionPnlPayload() });
  });
  await page.route("**/api/execution/ai/v6/state", async (route) => {
    await route.fulfill({ json: buildExecutionAiPayload() });
  });
  await page.route("**/api/system/runtime-decision**", async (route) => {
    await route.fulfill({ json: buildRuntimeDecisionPartialSummary() });
  });
  await page.route("**/api/strategies/drift", async (route) => {
    await route.fulfill({ json: { items: [], suspended_strategies: [] } });
  });
  await page.route("**/api/terminal/v2-risk-journal**", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({ json: { entries: buildJournalEntries() } });
      return;
    }

    await route.fulfill({ json: { ok: true, entry: null } });
  });

  await loginIfRequired(page, "/live-ops", "live ops partial telemetry guardrails");

  await expect(page.getByTestId("mission-control-live-ops-page")).toBeVisible({ timeout: 45_000 });

  const operatorActionPanel = page.locator(".operator-action-panel");
  await expect(operatorActionPanel).toContainText("REDUCE SIZE");
  await expect(operatorActionPanel).toContainText("NO_DATA_PARTIAL");
  await expect(operatorActionPanel).toContainText(/stats execution route absentes/i);
  await expect(page.getByTestId("operator-runtime-telemetry-integrity")).toContainText("NO_EXECUTION_STATS");
  await expect(page.getByTestId("operator-runtime-telemetry-integrity")).toContainText("NO_EXECUTION_LATENCY");
  await expect(page.getByTestId("execution-runtime-decision-quick-read-opportunity")).toContainText("OPPORTUNITY NO_DATA_PARTIAL");

  const pnlTruthPanel = page.locator(".monitoring-col").filter({ hasText: "Execution PnL Truth" }).first();
  await expect(pnlTruthPanel).toContainText("NO_DATA_PARTIAL");
  await expect(pnlTruthPanel).toContainText(/stats execution route absentes/i);
  await expect(pnlTruthPanel).toContainText(/profile route brut detecte/i);
  await expect(pnlTruthPanel).toContainText(/Runtime telemetry/i);
  await expect(page.getByTestId("execution-pnl-telemetry-integrity")).toContainText("NO_EXECUTION_STATS");
  await expect(page.getByTestId("execution-pnl-telemetry-integrity")).toContainText("NO_EXECUTION_BUDGET");

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});