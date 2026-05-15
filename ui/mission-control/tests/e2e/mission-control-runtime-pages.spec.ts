import { expect, test } from "@playwright/test";

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
      exposure_by_symbol: [{ symbol: "BTCUSD", notionalUsd: 125000 }],
    },
    risk_timeline: [{ at: nowIso, exposure_symbol: "BTCUSD", dd_pct: 1.75 }],
    audit_trail: [{ at: nowIso, route: "route-live", result: "BLOCK" }],
    warfare_core: {
      market_state: { state: "HIGH_VOL", confidence: 0.82 },
      smart_money: { state: "ACTIVE" },
      spoof: { state: "ALERT" },
      domination: { state: "SELLER" },
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
        fallback_mode: "guarded_auto",
        no_trade_dominance: true,
        dominant_reasons: ["latency spike", "latency spike"],
        no_trade_reasons: ["book vacuum"],
      },
    ],
    by_regime: [{ regime: "TREND", trade_count: 6, win_rate_pct: 50, net_pnl_usd: 24 }],
    by_venue: [{ venue: "binance-public", avg_latency_ms: 148, avg_slippage_bps: 2.8, net_pnl_usd: 84 }],
    by_execution_mode: [{ execution_mode: "guarded_auto", high_confidence_losses: 2, net_pnl_usd: 84 }],
    bad_model_flags: [{ decision_id: "decision-latency", regime: "TREND", venue: "binance-public", net_result_usd: -30 }],
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

function buildIncidentsPayload() {
  return {
    sla_minutes: 30,
    items: [
      {
        ticket_key: "INC-SMOKE",
        title: "Broker disconnect",
        provider: "binance-public",
        severity: "high",
        status: "open",
        assignee: "",
        age_minutes: 12,
        sla_breached: false,
        diagnosis: ["latency spike"],
      },
    ],
    summary: {
      status: { open: 1, assigned: 0, closed: 0 },
      severity: { critical: 0, high: 1, medium: 0, low: 0 },
      active_connector_incidents: 1,
    },
    connector_summary: [
      {
        provider: "binance-public",
        active_count: 1,
        critical_count: 0,
        uptime_24h_pct: 99.2,
        uptime_7d_pct: 98.7,
        top_diagnostic: "latency spike",
        last_incident_at: "2026-04-16T12:34:56.000Z",
        history: [{ severity: "high", title: "Broker disconnect" }],
      },
    ],
  };
}

function buildRuntimeDecisionSummary() {
  const opportunityBreakdown = [
    { key: "spread", label: "Spread", score: 0.8, scorePct: 80, tone: "good", detail: "1.20bp vs budget 6.00bp" },
    { key: "depth", label: "Depth", score: 0.74, scorePct: 74, tone: "good", detail: "fresh 44ms · 120k USD · fill 87%" },
    { key: "latency", label: "Latency", score: 0.32, scorePct: 32, tone: "warn", detail: "route 188ms · fill 214ms" },
    { key: "regime", label: "Regime", score: 0.62, scorePct: 62, tone: "subtle", detail: "vol medium" },
  ];

  return {
    scope: {
      symbol: "BTCUSD",
      timeframe: "1m",
      strategy: "terminal",
      limit: 1200,
      sinceDays: 7,
    },
    policyVersion: "v7",
    totals: { totalRows: 28, executionRows: 24, noTradeRows: 9, noTradePctWithinExecution: 37.5, canonicalRows: 8, normalizedLegacyRows: 1, unclassifiedLegacyRows: 0, canonicalCoveragePct: 88.9, effectiveCanonicalCoveragePct: 100 },
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
      liveState: "LIVE",
      liveSummary: "LIVE · score 62% · confidence 100% · venues 2 · spread 1.20bp · depth 120k USD · route 188ms · fill 87%",
      guard: {
        state: "OK",
        blocked: false,
        trustScorePct: 84,
        summary: "OK · telemetry stable enough for observation.",
        reasons: [],
      },
      confidenceEngine: {
        state: "EXPLORATORY",
        sampleSize: 15,
        stability: 0.53,
        stabilityPct: 53,
        summary: "EXPLORATORY · reliability degraded.",
      },
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
      topRanked: [{
        createdAtIso: "2026-04-16T12:34:56.000Z",
        code: "entry-valid",
        bucket: "market",
        score: 0.62,
        scorePct: 62,
        attentionState: "stable",
        volatilityRegime: "medium",
        status: "BLOCKED",
        breakdown: opportunityBreakdown,
        rationale: "constraint latency · support spread + depth · full telemetry · vol medium",
        confidence: 1,
        confidencePct: 100,
        missing: [],
      }],
      summary: "Score moyen 62% · confiance 100% · contrainte dominante latency 32% · 33.3% des contextes tradables restent bloques.",
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
      cause: {
        summary: "runtime guards et watchdog restent la friction dominante.",
        factors: [{ key: "runtimeBlockRate", label: "Runtime block rate", current: 50, reference: 16.7, deltaPct: 199.4, tone: "warn", note: "runtime guard pressure remains the primary friction." }],
      },
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
    observation: {
      status: "OBSERVE",
      windowDays: 7,
      sampleHours: 120,
      minObservationHours: 72,
      maxObservationHours: 168,
      driftFalsePositiveRate: 12,
      driftDetectionRate: 67,
      driftStability: 61,
      opportunityHitRate: 58,
      decisionConsistency: 58,
      driftReliabilityMean: 69,
      decisionOutcomeCoveragePct: 64,
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
      score: 0.88,
      scorePct: 88,
      summary: "Runtime integrity degraded but still readable for observation.",
      reasons: ["observation gaps", "signal consistency 58%"],
      coverageScore: 0.9,
      freshnessScore: 0.86,
      consistencyScore: 0.58,
      continuityScore: 0.89,
      coverageScorePct: 90,
      freshnessScorePct: 86,
      consistencyScorePct: 58,
      continuityScorePct: 89,
      multiChart: {
        state: "INACTIVE",
        score: 0,
        scorePct: 0,
        reasons: [],
        summary: "Multi-chart inactive for smoke runtime.",
      },
      v5: {
        state: "INACTIVE",
        status: "inactive",
        sourceLabel: "smoke",
        summary: "V5 inactive for smoke runtime.",
      },
    },
    dominant: {
      bucket: { label: "runtime", count: 6, sharePct: 66.7 },
      code: { label: "routing-score-zero", count: 4, sharePct: 44.4 },
      attentionState: { label: "stable", count: 20, sharePct: 83.3 },
      volatilityRegime: { label: "medium", count: 18, sharePct: 75 },
    },
    monitoring: {
      live: {
        source: "local-terminal-capture",
        latestCaptureAtIso: "2026-04-16T12:34:56.000Z",
        latestCaptureAgeSec: 18,
        staleRateXchPct: 50,
        latestXchStatus: "LIVE",
        latestFeedLabel: "binance-public",
        latestXchAgeLabel: "18s",
        latestXchSourceLabel: "quotes",
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
        limitingFactor: { label: "Latency", scorePct: 32, tone: "warn" },
        decisionConsistencyPct: 58,
        summary: "local capture · system health drift elevated · stale XCH 50%",
      },
      observationWindow: {
        status: "OBSERVING",
        sampleCount: 3,
        coverageHours: 120,
        minObservationHours: 72,
        maxObservationHours: 168,
        points: [
          { bucketStartIso: "2026-04-12T12:00:00.000Z", driftProbability: 58, reliability: 44, opportunityScore: 46, driftFalsePositiveRate: 14, opportunityHitRate: 38, decisionConsistency: 52, driftStability: 49, driftReliabilityMean: 48, observationStatus: "OBSERVE", reliabilityState: "BLOCKED_BY_DATA", observationIntegrityStatus: "CRITICAL", gapDensityPct: 25, noTradeConcentrationPct: 12, noTradeConcentrationLabel: "high · 1m · routing-score-zero", manualCalibrationEligible: false },
          { bucketStartIso: "2026-04-13T12:00:00.000Z", driftProbability: 49, reliability: 58, opportunityScore: 53, driftFalsePositiveRate: 10, opportunityHitRate: 49, decisionConsistency: 63, driftStability: 61, driftReliabilityMean: 57, observationStatus: "OBSERVE", reliabilityState: "DEGRADED", observationIntegrityStatus: "DEGRADED", gapDensityPct: 8, noTradeConcentrationPct: 28, noTradeConcentrationLabel: "medium · 5m · runtime-guard", manualCalibrationEligible: false },
          { bucketStartIso: "2026-04-15T12:00:00.000Z", driftProbability: 42, reliability: 71, opportunityScore: 62, driftFalsePositiveRate: 7, opportunityHitRate: 58, decisionConsistency: 74, driftStability: 76, driftReliabilityMean: 69, observationStatus: "READY_FOR_REVIEW", reliabilityState: "RELIABLE", observationIntegrityStatus: "OK", gapDensityPct: 2, noTradeConcentrationPct: 47, noTradeConcentrationLabel: "medium · 5m · runtime-guard", manualCalibrationEligible: true },
        ],
        latest: { bucketStartIso: "2026-04-15T12:00:00.000Z", driftProbability: 42, reliability: 71, opportunityScore: 62, driftFalsePositiveRate: 7, opportunityHitRate: 58, decisionConsistency: 74, driftStability: 76, driftReliabilityMean: 69, observationStatus: "READY_FOR_REVIEW", reliabilityState: "RELIABLE", observationIntegrityStatus: "OK", gapDensityPct: 2, noTradeConcentrationPct: 47, noTradeConcentrationLabel: "medium · 5m · runtime-guard", manualCalibrationEligible: true },
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
          ],
          summary: "Reliability mix RELIABLE 33.3% · DEGRADED 33.3% · BLOCKED_BY_DATA 33.3% · drift avg 62% · gaps latest 2% · NO_TRADE concentration 47%",
        },
        gateSummary: "Observation active 120.0h/168h: verifier que FP baisse et que hit rate + consistency restent stables.",
      },
      governanceBudget: {
        state: "OBSERVE_ONLY",
        conclusionBudgetPct: 15,
        autoPromotionAllowed: false,
        summary: "Governance budget 15%: observation et annotation manuelle seulement, sans conclusion forte ni durcissement du score.",
        reasons: ["reliability DEGRADED", "Drift stability floor", "FALSE_SYNC 40%"],
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
  };
}

function buildTradabilityAnalyticsSummary() {
  return {
    generatedAtIso: "2026-04-16T12:34:56.000Z",
    sampleCount: 16,
    windows: {
      last_24h: {
        sampleHours: 24,
        totalSamples: 7,
        rows: [
          { regime: "TREND", sampleCount: 4, thinSharePct: 25, degradedSharePct: 0, sufficientSharePct: 75, avgScorePct: 68, avgEntropyPct: 31, lastState: "SUFFICIENT", lastAction: "ALLOW", lastSeenIso: "2026-04-16T12:34:56.000Z", reviewLabel: "candidate pour poids ++", reviewTone: "good" },
          { regime: "CHOP", sampleCount: 3, thinSharePct: 33, degradedSharePct: 33, sufficientSharePct: 34, avgScorePct: 49, avgEntropyPct: 58, lastState: "DEGRADED", lastAction: "BLOCK", lastSeenIso: "2026-04-16T11:34:56.000Z", reviewLabel: "sample faible", reviewTone: "subtle" },
        ],
      },
      last_7d: {
        sampleHours: 168,
        totalSamples: 16,
        rows: [
          { regime: "TREND", sampleCount: 10, thinSharePct: 40, degradedSharePct: 10, sufficientSharePct: 50, avgScorePct: 60, avgEntropyPct: 39, lastState: "THIN", lastAction: "GUARD", lastSeenIso: "2026-04-15T12:34:56.000Z", reviewLabel: "observer", reviewTone: "subtle" },
          { regime: "CHOP", sampleCount: 6, thinSharePct: 50, degradedSharePct: 16, sufficientSharePct: 34, avgScorePct: 46, avgEntropyPct: 61, lastState: "THIN", lastAction: "GUARD", lastSeenIso: "2026-04-14T12:34:56.000Z", reviewLabel: "observer", reviewTone: "subtle" },
        ],
      },
    },
    comparison: {
      rows: [
        { regime: "TREND", window24h: { regime: "TREND", sampleCount: 4, thinSharePct: 25, degradedSharePct: 0, sufficientSharePct: 75, avgScorePct: 68, avgEntropyPct: 31, lastState: "SUFFICIENT", lastAction: "ALLOW", lastSeenIso: "2026-04-16T12:34:56.000Z", reviewLabel: "candidate pour poids ++", reviewTone: "good" }, window7d: { regime: "TREND", sampleCount: 10, thinSharePct: 40, degradedSharePct: 10, sufficientSharePct: 50, avgScorePct: 60, avgEntropyPct: 39, lastState: "THIN", lastAction: "GUARD", lastSeenIso: "2026-04-15T12:34:56.000Z", reviewLabel: "observer", reviewTone: "subtle" }, driftLabel: "derive -15 pts", driftTone: "good" },
      ],
    },
    calibration: {
      currentRegime: "TREND",
      driftTone: "good",
      sampleCount24h: 4,
      sampleCount7d: 10,
      thinSharePct24h: 25,
      thinSharePct7d: 40,
      degradedSharePct24h: 0,
      degradedSharePct7d: 10,
      thinDeltaPct: -15,
      degradedDeltaPct: -10,
      thresholds: {
        thinScoreFloor: 0.47,
        degradedScoreFloor: 0.25,
        thinEntropyCeiling: 0.61,
        degradedEntropyCeiling: 0.75,
      },
      summaryLabel: "TREND: derive recente en amelioration, seuils legerement relaches. TREND: impact information_density renforce dans edge eligibility.",
      sensitivity: {
        mode: "RELAX",
        thresholds: {
          thinScoreFloor: 0.47,
          degradedScoreFloor: 0.25,
          thinEntropyCeiling: 0.61,
          degradedEntropyCeiling: 0.75,
        },
        summaryLabel: "TREND: derive recente en amelioration, seuils legerement relaches.",
      },
      impact: {
        mode: "BOOST",
        edgeEligibilityWeight: 0.22,
        edgeEligibilityWeightPct: 22,
        summaryLabel: "TREND: impact information_density renforce dans edge eligibility.",
      },
    },
  };
}

function buildMarketStateMapSnapshot() {
  return {
    generatedAtIso: "2026-04-16T12:34:56.000Z",
    scope: {
      symbol: "DESK",
      timeframe: "live",
      venue: "MULTI",
      windowHours: 24,
    },
    cells: [
      {
        key: {
          symbol: "DESK",
          venue: "MULTI",
          timeframe: "live",
          regime: "TREND",
          densityBand: "RICH",
          executionBand: "STABLE",
          freshnessBand: "FRESH",
        },
        sampleCount: 12,
        truthQualityPct: 78,
        admissibilityPct: 74,
        opportunityPct: 63,
        informationDensityPct: 71,
        entropyPct: 28,
        coherencePct: 76,
        freshnessPct: 82,
        executionQualityPct: 66,
        falseContextRiskPct: 22,
        transitionPressurePct: 31,
        memoryConfidencePct: 64,
        state: "WATCH",
        reasons: ["TREND: candidate pour poids ++", "truth 74% · exec 66%", "anomalies venue_desynchronization", "edge breakout MEDIUM 63%"],
        updatedAtIso: "2026-04-16T12:34:56.000Z",
      },
      {
        key: {
          symbol: "DESK",
          venue: "MULTI",
          timeframe: "live",
          regime: "CHOP",
          densityBand: "THIN",
          executionBand: "WEAK",
          freshnessBand: "AGING",
        },
        sampleCount: 9,
        truthQualityPct: 34,
        admissibilityPct: 29,
        opportunityPct: 18,
        informationDensityPct: 41,
        entropyPct: 61,
        coherencePct: 38,
        freshnessPct: 54,
        executionQualityPct: 31,
        falseContextRiskPct: 71,
        transitionPressurePct: 67,
        memoryConfidencePct: 52,
        state: "INADMISSIBLE",
        reasons: ["CHOP: sample faible", "truth 38% · exec 31%", "anomalies liquidity_trap, predictive_trap", "edge fade LOW 18%"],
        updatedAtIso: "2026-04-16T11:34:56.000Z",
      },
    ],
    transitions: [
      { regime: "CHOP", transitionType: "trend_to_chop", detectedAtIso: "2026-04-16T11:30:00.000Z", truthQualityDeltaPct: -24 },
      { regime: "TREND", transitionType: "chop_to_trend", detectedAtIso: "2026-04-16T10:05:00.000Z", truthQualityDeltaPct: 18 },
    ],
    inadmissibleZones: [
      { zoneKey: "MULTI:live:CHOP", regime: "CHOP", reason: "anomalies liquidity_trap, predictive_trap", severity: "critical" },
    ],
    anomalyFamilyBreakdown: [
      {
        anomalyFamily: "VENUE_DESYNC",
        operatorFamily: "venue",
        venue: "BINANCE-PUBLIC",
        timeframe: "1m",
        count: 2,
        criticalCount: 0,
        latestAtIso: "2026-04-16T12:34:56.000Z",
        exampleTypes: ["VENUE_ALPHA_DESYNCHRONIZATION"],
        dominantRegimes: ["TREND"],
      },
      {
        anomalyFamily: "LIQUIDITY_TRAP",
        operatorFamily: "liquidity",
        venue: "BINANCE-PUBLIC",
        timeframe: "5m",
        count: 1,
        criticalCount: 1,
        latestAtIso: "2026-04-16T11:34:56.000Z",
        exampleTypes: ["LIQUIDITY_TRAP"],
        dominantRegimes: ["CHOP"],
      },
    ],
    falseContextTaxonomy: [
      {
        contextFamily: "FALSE_SYNC",
        count: 2,
        noTradeSharePct: 50,
        dominantBlockingLayers: ["none"],
        latestAtIso: "2026-04-16T12:34:56.000Z",
        auditReasons: ["VENUE_ALPHA_DESYNCHRONIZATION"],
      },
      {
        contextFamily: "FALSE_EXECUTION_CONTEXT",
        count: 1,
        noTradeSharePct: 100,
        dominantBlockingLayers: ["execution_lock"],
        latestAtIso: "2026-04-16T11:34:56.000Z",
        auditReasons: ["EXECUTION_QUALITY_DEGRADED"],
      },
    ],
    summary: {
      admissibleCells: 0,
      watchCells: 1,
      degradedCells: 0,
      inadmissibleCells: 1,
      dominantFailureModes: ["anomalies liquidity_trap, predictive_trap", "CHOP: sample faible"],
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
  ];
}

function buildGovernanceReplayViewPayload() {
  return {
    schema_version: "governance-replay-view/v3",
    generated_at_iso: "2026-04-16T12:34:56.000Z",
    source: "persisted_journal",
    scope: {
      symbol: "BTCUSD",
      timeframe: "1m",
      strategy: "terminal",
      current_regime: "TREND",
    },
    entries_count: 3,
    archive: {
      schema_version: "market-regime-archive/v1",
      generated_at_iso: "2026-04-16T12:34:56.000Z",
      archive_state: "WATCH",
      active_regime: "TREND",
      dominant_regime: "TREND",
      hottest_regime: "CHOP",
      dominant_blocking_layer: "execution_reality_governance",
      market_temperature_state: "WARM",
      market_temperature_pct: 58,
      persistent_compression: {
        state: "COMPACT",
        compression_ratio_pct: 64,
        relapse_probability_pct: 27,
        retention_half_life_hours: 18,
        persistent_transition_count: 6,
        hot_capsule_count: 2,
        dominant_transition: {
          from_regime: "CHOP",
          to_regime: "TREND",
          transition_type: "REGIME_SHIFT",
          count: 3,
        },
      },
      latest_transition: {
        id: "transition-trend",
        created_at_iso: "2026-04-16T12:30:56.000Z",
        transition_type: "REGIME_SHIFT",
        from_regime: "CHOP",
        to_regime: "TREND",
        from_admissibility_state: "WATCH",
        to_admissibility_state: "ADMISSIBLE",
      },
      rows: [{ stress_score_pct: 63 }],
      reasons: ["trend remains readable", "governance pressure elevated"],
    },
    replay: {
      schema_version: "governance-replay/v1",
      state: "BLOCKED",
      active_layer: "execution_reality_governance",
      allow_answer: {
        headline: "Execute via aligned truth",
        detail: "spread healthy and truth aligned",
        layer: null,
        action: "EXECUTE",
        reasons: ["spread_ok"],
        created_at_iso: "2026-04-16T12:32:56.000Z",
      },
      block_answer: {
        headline: "Block via execution reality governance",
        detail: "latency stress dominates current route",
        layer: "execution_reality_governance",
        action: "BLOCK",
        reasons: ["latency spike"],
        created_at_iso: "2026-04-16T12:34:56.000Z",
      },
      failure_answer: {
        headline: "Failure unresolved",
        detail: "execution reality governance remains dominant",
        layer: "execution_reality_governance",
        action: "BLOCK",
        reasons: ["latency spike"],
        created_at_iso: "2026-04-16T12:34:56.000Z",
      },
      timeline: [],
      reasons: ["latency spike"],
    },
    archive_contracts: {
      schema_version: "governance-replay-archive-contracts/v1",
      generated_at_iso: "2026-04-16T12:34:56.000Z",
      market_regime_archive: {
        schema_version: "governance-replay-archive-contract/v1",
        contract_key: "market_regime_archive",
        expected_summary_version: "market-regime-archive/v1",
        current_summary_version: "market-regime-archive/v1",
        status: "LOCKED",
        summary: {
          schema_version: "market-regime-archive/v1",
          active_regime: "TREND",
        },
      },
      governance_replay: {
        schema_version: "governance-replay-archive-contract/v1",
        contract_key: "governance_replay",
        expected_summary_version: "governance-replay/v1",
        current_summary_version: "governance-replay/v1",
        status: "LOCKED",
        summary: {
          schema_version: "governance-replay/v1",
          state: "BLOCKED",
        },
      },
      reasons: [
        "market_regime_archive:market-regime-archive/v1:locked",
        "governance_replay:governance-replay/v1:locked",
      ],
    },
    timeline_detailed: [
      {
        id: "timeline-governance-warn",
        journal_action: "oracle-review-required",
        phase: "governance",
        label: "Oracle Review Required",
        detail: "latency stress still dominates the route",
        action: "BLOCK",
        layer: "execution_reality_governance",
        regime: "TREND",
        route_mode: "latency_degraded",
        reasons: ["latency spike"],
        contract_versions: ["execution-reality/v1", "governance-replay/v1"],
        created_at_iso: "2026-04-16T12:34:56.000Z",
        tone: "warn",
      },
      {
        id: "timeline-capital-subtle",
        journal_action: "capital-scaling-updated",
        phase: "capital",
        label: "Capital Scaling Updated",
        detail: "risk was reduced after replay friction",
        action: "DEFENSIVE",
        layer: null,
        regime: "TREND",
        route_mode: "latency_degraded",
        reasons: ["latency spike"],
        contract_versions: ["capital-scaling/v1"],
        created_at_iso: "2026-04-16T12:33:56.000Z",
        tone: "subtle",
      },
      {
        id: "timeline-market-good",
        journal_action: "market-transition",
        phase: "market",
        label: "Market Transition",
        detail: "trend resumed with broader cross-market support",
        action: "EXECUTE",
        layer: null,
        regime: "TREND",
        route_mode: "balanced",
        reasons: ["cross-market aligned"],
        contract_versions: ["market-regime-archive/v1"],
        created_at_iso: "2026-04-16T12:30:56.000Z",
        tone: "good",
      },
    ],
    freeze: {
      freeze_state: "LOCKED",
      locked_contract_count: 3,
      contracts: [
        { key: "final_decision_truth", current_version: "final-decision-truth/v1", status: "LOCKED" },
        { key: "governance_replay", current_version: "governance-replay/v1", status: "LOCKED" },
        { key: "capital_scaling", current_version: "capital-scaling/v1", status: "LOCKED" },
      ],
      reasons: ["frozen canonical contracts"],
    },
  };
}

test("runtime smoke covers terminal, live ops, connectors and connections", async ({ page }) => {
  let integrationRouteUpsertPayload: Record<string, unknown> | null = null;
  let connectorsMt5Payload: Record<string, unknown> | null = null;

  test.setTimeout(180_000);
  const browserErrors: string[] = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("txt.global.walkthrough.state.v1", JSON.stringify({
      version: "3",
      roleGroup: "internal",
      done: false,
      visible: true,
      stepIndex: 5,
      validatedKeys: ["dashboard", "learn", "connectors", "readiness", "live-ops"],
    }));
  });
  page.on("pageerror", (error) => {
    const detail = error.stack || error.message || String(error);
    browserErrors.push(detail);
    console.error(`[runtime smoke] pageerror: ${detail}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.error(`[runtime smoke] console.error: ${message.text()}`);
    }
  });

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const origin = new URL(page.url()).origin;
  const payload = Buffer.from(JSON.stringify({ role: "operator", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  await page.context().addCookies([
    {
      name: "mc_token",
      value: `${payload}.signature`,
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
      secure: origin.startsWith("https://"),
    },
    {
      name: "mc_token_compat",
      value: `${payload}.signature`,
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
      secure: origin.startsWith("https://"),
    },
  ]);

  await page.route("**/api/system/mode", async (route) => {
    await route.fulfill({ json: { detail: "Mode systeme mis a jour" } });
  });

  await page.route("**/api/system/live-ops", async (route) => {
    await route.fulfill({ json: buildLiveOpsPayload() });
  });

  await page.route("**/api/dashboard/overview", async (route) => {
    await route.fulfill({
      json: {
        system_mode: "guarded_auto",
        kill_switch_active: false,
        open_alerts: 0,
      },
    });
  });

  await page.route("**/api/execution/optimizer/live-state", async (route) => {
    await route.fulfill({
      json: {
        state: "stable",
        summary: { latency_budget_ms: 80, slippage_budget_bps: 1.5 },
      },
    });
  });

  await page.route("**/api/market/venues/telemetry", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            venue: "binance-public",
            freshness_ms: 45,
            spread_bps: 0.9,
            fill_quality: "good",
          },
        ],
      },
    });
  });

  await page.route("**/api/execution/routing/venues/telemetry**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            venue: "binance-public",
            score_gap: 0.11,
            latency_ms: 42,
          },
        ],
      },
    });
  });

  await page.route("**/api/outcomes/recent**", async (route) => {
    await route.fulfill({
      json: [
        {
          decision_id: "outcome-1",
          symbol: "BTCUSD",
          side: "buy",
          net_result_usd: 24.5,
          created_at: new Date().toISOString(),
        },
      ],
    });
  });

  await page.route("**/api/execution/replay/**", async (route) => {
    await route.fulfill({
      json: {
        decision_id: "outcome-1",
        steps: [],
        summary: { status: "ok" },
      },
    });
  });

  await page.route("**/api/market/quotes", async (route) => {
    await route.fulfill({
      json: [
        {
          instrument: "BTCUSD",
          bid: 68000.1,
          ask: 68000.7,
          last: 68000.4,
        },
      ],
    });
  });

  await page.route("**/api/broker/positions", async (route) => {
    await route.fulfill({
      json: [
        {
          symbol: "BTCUSD",
          side: "long",
          qty: 0.01,
          unrealized_pnl_usd: 4.2,
        },
      ],
    });
  });

  await page.route("**/api/broker/balance", async (route) => {
    await route.fulfill({
      json: {
        equity_usd: 25000,
        free_margin_usd: 18000,
      },
    });
  });

  await page.route("**/api/performance/summary**", async (route) => {
    await route.fulfill({
      json: {
        realized_pnl_usd: 132.5,
        win_rate_pct: 62.5,
      },
    });
  });

  await page.route("**/api/performance/attribution**", async (route) => {
    await route.fulfill({
      json: {
        rows: [
          {
            strategy: "mt5-live",
            strategy_id: "mt5-live",
            symbol: "BTCUSD",
            venue: "binance-public",
            trade_count: 8,
            pnl_contribution_pct: 100,
            realized_pnl_usd: 132.5,
            pnl_usd: 132.5,
          },
        ],
      },
    });
  });

  await page.route("**/api/investor-reports**", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });

  await page.route("**/api/execution/reality-gap/recent**", async (route) => {
    await route.fulfill({ json: { items: [] } });
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

  await page.route("**/api/live-readiness/overview**", async (route) => {
    await route.fulfill({
      json: {
        memory_kpi: { summary: {} },
        drift: { items: [], suspended_strategies: [], auto_resume: {} },
        memory_ab: { arms: [], with_vs_without_memory: {} },
      },
    });
  });

  await page.route("**/api/strategies/drift-thresholds**", async (route, request) => {
    if (request.method() === "POST") {
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ json: { items: [] } });
  });

  await page.route("**/api/market/bus/snapshot**", async (route) => {
    await route.fulfill({
      json: {
        meta: {
          health: {
            components: {
              ohlcv: { freshness_ms: 1_000 },
              depth: { freshness_ms: 1_200 },
              trades: { freshness_ms: 900 },
            },
          },
          sequencing: { ohlcv: {} },
          preprocessor: { trades: { journal: [], journal_summary: {}, analytics: {}, alert: {} } },
        },
        routing_score: { candidates: [], best: null, reason: "missing", source: "mock" },
        trades: [],
        order_book: { bids: [], asks: [] },
      },
    });
  });

  await page.route("**/api/system/healthwatch/dashboard**", async (route) => {
    await route.fulfill({
      json: {
        healthwatch: {},
        chart_offline_capture: {},
        public_chart_visibility: {},
      },
    });
  });

  await page.route("**/api/system/observation/controlled-collection**", async (route) => {
    await route.fulfill({
      json: {
        available: true,
        active: false,
        phase: "NO_SESSION",
        gateStatus: "idle",
        gateHealthScore: 0,
        fillsSeen: 0,
        labelsSeen: 0,
        durationMinutes: 0,
        killSwitchRearmed: true,
        killSwitchActive: false,
        killSwitchReason: "-",
      },
    });
  });

  await page.route("**/api/terminal/tradability/analytics**", async (route) => {
    await route.fulfill({ json: buildTradabilityAnalyticsSummary() });
  });

  await page.route("**/api/market-state-map**", async (route) => {
    await route.fulfill({ json: buildMarketStateMapSnapshot() });
  });

  await page.route("**/api/strategies/drift", async (route) => {
    await route.fulfill({ json: { items: [], suspended_strategies: [] } });
  });

  await page.route("**/api/terminal/v2-risk-journal**", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({ json: { entries: buildJournalEntries() } });
      return;
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      json: {
        ok: true,
        entry: {
          id: `journal-${Date.now()}`,
          createdAtIso: new Date().toISOString(),
          symbol: String(body.symbol || "BTCUSD"),
          timeframe: String(body.timeframe || "1m"),
          strategy: String(body.strategy || "scalp"),
          action: String(body.action || "note"),
          detail: String(body.detail || ""),
          meta: body.meta && typeof body.meta === "object" ? body.meta : {},
        },
      },
    });
  });
  await page.route("**/api/terminal/governance-replay**", async (route) => {
    await route.fulfill({ json: buildGovernanceReplayViewPayload() });
  });

  await page.route("**/api/connectors/status", async (route) => {
    await route.fulfill({ json: { alerts: [], connector_status: [], degradation_rows: [] } });
  });
  await page.route("**/api/mt5/health", async (route) => {
    await route.fulfill({ json: { status: "ok", latency_ms: 12 } });
  });
  await page.route("**/api/mt5/accounts", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({ json: [{ account_id: "mt5-demo-01", broker: "metaquotes", server: "MetaQuotes-Demo", login: "10001234", mode: "paper", metadata: { broker_session: { snapshot_url: "http://mt5-bridge:18086/state.json", truth_source: "mt5-external-session-smoke" }, broker_runtime_session: { terminal: "mt5-main-live", connected: true } } }] });
      return;
    }
    connectorsMt5Payload = (request.postDataJSON() || {}) as Record<string, unknown>;
    await route.fulfill({ json: { ok: true, account_id: "mt5-smoke" } });
  });
  let brokerSessionPayload: Record<string, unknown> | null = null;
  await page.route("**/api/mt5/accounts/*/broker-session", async (route, request) => {
    brokerSessionPayload = (request.postDataJSON() || {}) as Record<string, unknown>;
    await route.fulfill({ json: { status: "ok", bridge: { status: "updated" }, normalized_state: { truth_source: "mt5-broker-state" } } });
  });
  await page.route("**/api/accounts", async (route) => {
    await route.fulfill({ json: [{ account_id: "mt5-demo-01", account_type: "broker", display_name: "MT5 Demo", latest_equity_usd: 25000, gross_exposure_usd: 0, net_exposure_usd: 0 }] });
  });
  await page.route("**/api/portfolios/pf-internal-main/risk", async (route) => {
    await route.fulfill({ json: { risk_budget_usd: 1500, heat: "clean" } });
  });
  await page.route("**/api/mt5/orders/live-pending", async (route) => {
    await route.fulfill({ json: [{ approval_id: "approval-1", symbol: "EURUSD", side: "buy", lots: 0.1 }] });
  });
  await page.route("**/api/auth/ws-token", async (route) => {
    await route.fulfill({ json: { token: "smoke-token", controlPlaneUrl: "http://127.0.0.1:3000" } });
  });
  await page.route("**/api/system/mt5-rebuild", async (route) => {
    await route.fulfill({ json: { ok: true, detail: "rebuild queued" } });
  });
  await page.route("**/api/mt5/orders/filter", async (route) => {
    await route.fulfill({ json: { ok: true, order_id: "filter-1" } });
  });
  await page.route("**/api/ai/regimes/detect", async (route) => {
    await route.fulfill({ json: { regime: "trend", confidence: 0.72 } });
  });
  await page.route("**/api/ai/backtests/geopolitical", async (route) => {
    await route.fulfill({ json: { scenario: "Fed emergency hike", pnl_usd: -42 } });
  });
  await page.route("**/api/incidents", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({ json: buildIncidentsPayload() });
      return;
    }
    await route.fulfill({ json: { ok: true, incident_id: "INC-SMOKE" } });
  });

  await page.route("**/api/connectors/accounts", async (route) => {
    await route.fulfill({
      json: {
        accounts: [
          {
            provider: "mt5",
            provider_type: "broker",
            account_id: "ftmo-10k",
            label: "FTMO 10k",
            mode: "trade",
            auth_method: "password",
            client_id: "client-live",
            owner_username: "operator",
            has_credentials: true,
            address: null,
            broker_capabilities: { preferred_venue: "mt5" },
            permissions_view: { permissions: { trade: true } },
          },
          {
            provider: "bitget",
            provider_type: "exchange",
            account_id: "bitget-primary",
            label: "Bitget Primary",
            mode: "trade",
            auth_method: "api_key",
            client_id: "client-live",
            owner_username: "operator",
            has_credentials: true,
            address: null,
          },
          {
            provider: "ledger",
            provider_type: "wallet",
            account_id: "wallet-treasury",
            label: "Treasury Wallet",
            mode: "read",
            auth_method: "wallet_public_key",
            client_id: "client-live",
            owner_username: "operator",
            has_credentials: true,
            address: "0xabc",
          },
        ],
      },
    });
  });
  await page.route("**/api/integrations/routes", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({ json: { routes: [{ source: "kairos", route_key: "default", account_id: "bitget-primary", preferred_venue: "bitget", notional_usd: 7, live_enabled: true }] } });
      return;
    }
    integrationRouteUpsertPayload = (request.postDataJSON() || {}) as Record<string, unknown>;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/connectors/exchange-capabilities", async (route) => {
    await route.fulfill({ json: { bitget: { api_key_requires_passphrase: true } } });
  });
  await page.route("**/api/connectors/accounts/link-api-key", async (route) => {
    await route.fulfill({ json: { ok: true, account_id: "bitget-smoke" } });
  });
  await page.route("**/api/connectors/accounts/link", async (route) => {
    await route.fulfill({ json: { ok: true, account_id: "wallet-smoke" } });
  });

  await page.goto("/terminal?v2=1&engine=v4&boot=full", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("mission-control-terminal-page")).toBeVisible();
  await expect(page.locator("#txt-global-nav[data-hydrated='1']")).toBeVisible({ timeout: 30_000 });
  const governanceTimelinePanel = page.getByTestId("terminal-governance-replay-timeline-panel");
  await expect(governanceTimelinePanel).toBeVisible({ timeout: 30_000 });
  await expect(governanceTimelinePanel).toContainText("timeline persisted");
  await expect(governanceTimelinePanel).toContainText("Oracle Review Required");
  await expect(governanceTimelinePanel).toContainText("Capital Scaling Updated");
  await page.getByTestId("terminal-governance-replay-phase-filter-governance").click();
  await expect(governanceTimelinePanel).toContainText("filtered 1");
  await expect(governanceTimelinePanel).toContainText("Oracle Review Required");
  await expect(governanceTimelinePanel).not.toContainText("Capital Scaling Updated");
  await page.getByTestId("terminal-governance-replay-phase-filter-all").click();
  await page.getByTestId("terminal-governance-replay-tone-filter-good").click();
  await expect(governanceTimelinePanel).toContainText("filtered 1");
  await expect(governanceTimelinePanel).toContainText("Market Transition");
  await expect(governanceTimelinePanel).not.toContainText("Oracle Review Required");
  await page.getByTestId("terminal-governance-replay-tone-filter-all").click();
  await expect(page.getByTestId("terminal-cross-market-pressure-graph-panel")).toBeVisible();
  await expect(page.getByTestId("terminal-governance-balance-engine-panel")).toBeVisible();
  await expect(page.getByTestId("terminal-execution-attribution-layer-panel")).toBeVisible();
  await expect(page.getByTestId("terminal-cross-venue-execution-intelligence-panel")).toBeVisible();
  await expect(page.getByTestId("terminal-governance-archive-contracts-panel")).toBeVisible();
  await expect(page.getByTestId("terminal-governance-archive-contracts-panel")).toContainText("archive locked");
  await expect(page.getByTestId("terminal-governance-archive-contracts-panel")).toContainText("replay locked");
  await expect(page.getByTestId("terminal-structural-memory-layers-panel")).toBeVisible();
  await expect(page.getByTestId("terminal-structural-layer-global-confidence")).toContainText("Global confidence decay");
  await page.locator("#txt-global-nav-link-connectors").click();
  await page.waitForURL("**/connectors", { timeout: 30_000 });
  await expect(page.getByTestId("mission-control-connectors-page")).toBeVisible({ timeout: 30_000 });

  await page.goto("/terminal?v2=1&engine=v4&boot=full", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("mission-control-terminal-page")).toBeVisible();
  await page.getByRole("button", { name: "Walkthrough", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Walkthrough global TXT" })).toBeVisible({ timeout: 30_000 });
  if (browserErrors.length > 0) {
    console.error(`[runtime smoke] browser errors before terminal assertions:\n${browserErrors.join("\n\n")}`);
  }
  await expect(page.locator(".terminal-v2-truth-strip")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".terminal-v2-truth-pill").filter({ hasText: /^SOURCE / })).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("terminal-topbar-link-dashboard").click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
  await expect(page.getByTestId("runtime-decision-dashboard-panel")).toBeVisible({ timeout: 30_000 });

  await page.goto("/terminal?v2=1&engine=v4&boot=full", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("mission-control-terminal-page")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("terminal-topbar-link-learn").click();
  await page.waitForURL("**/learn", { timeout: 30_000 });
  await expect(page.locator("#global-guide-learn-hero")).toBeVisible({ timeout: 30_000 });

  await page.goto("/terminal?v2=1&engine=v4&boot=full", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("mission-control-terminal-page")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("terminal-topbar-link-incidents").click();
  await page.waitForURL("**/incidents", { timeout: 30_000 });
  await expect(page.locator("#global-guide-incidents-hero")).toBeVisible({ timeout: 30_000 });

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("runtime-decision-dashboard-panel")).toBeVisible();
  await expect(page.getByTestId("runtime-decision-false-context-panel")).toContainText("False context motifs");
  await expect(page.getByTestId("runtime-decision-false-context-panel")).toContainText(/none|false sync|false execution context/i);
  await expect(page.getByTestId("runtime-operator-monitor-panel")).toBeVisible();
  await expect(page.getByTestId("runtime-operator-false-context-panel")).toContainText("operator motifs");
  await expect(page.getByTestId("runtime-operator-false-context-panel")).toContainText(/none|false sync|false execution context/i);
  await expect(page.getByTestId("runtime-observation-dashboard-panel")).toBeVisible();
  await expect(page.getByTestId("runtime-temporal-validation")).toContainText("Temporal validation 24h - 7j");
  await expect(page.getByTestId("runtime-temporal-validation")).toContainText("Reliability distribution");
  await expect(page.getByTestId("runtime-governance-budget")).toContainText(/NO_CONCLUSION|OBSERVE_ONLY|MANUAL_REVIEW_ONLY/);
  await expect(page.getByTestId("runtime-governance-budget")).toContainText("conclusion budget");
  await expect(page.getByTestId("dashboard-runtime-stability-debug-panel")).toContainText("/ -> /dashboard");
  await expect(page.getByTestId("runtime-observation-tradability-audit")).toContainText("Tradability Audit Trail");
  await expect(page.getByTestId("runtime-observation-tradability-audit")).toContainText("22% info_density");

  await page.goto("/live-readiness", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Live Readiness Center", { exact: true })).toBeVisible({ timeout: 30_000 });
  const tradabilitySciencePanel = page.getByTestId("live-readiness-tradability-science-panel");
  await expect(tradabilitySciencePanel).toBeVisible({ timeout: 30_000 });
  await expect(tradabilitySciencePanel).toContainText("Tradability Science Desk");
  await expect(tradabilitySciencePanel).toContainText("SENSITIVITY RELAX");
  await expect(tradabilitySciencePanel).toContainText("IMPACT BOOST");
  await expect(tradabilitySciencePanel).toContainText("22% info_density");
  await expect(tradabilitySciencePanel).toContainText("derive -15 pts");
  const marketStateMapPanel = page.getByTestId("live-readiness-market-state-map-panel");
  await expect(marketStateMapPanel).toBeVisible({ timeout: 30_000 });
  await expect(marketStateMapPanel).toContainText("Market State Map");
  await expect(marketStateMapPanel).toContainText("INADMISSIBLE 1");
  await expect(marketStateMapPanel).toContainText("CHOP");
  await expect(marketStateMapPanel).toContainText("liquidity trap");

  await page.goto("/live-readiness/edge-map", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("edge-map-page")).toBeVisible({ timeout: 30_000 });
  const edgeMapTradabilityDesk = page.getByTestId("edge-map-tradability-science-panel");
  await expect(edgeMapTradabilityDesk).toBeVisible({ timeout: 30_000 });
  await expect(edgeMapTradabilityDesk).toContainText("Tradability Science Desk");
  await expect(edgeMapTradabilityDesk).toContainText("SENSITIVITY RELAX");
  await expect(edgeMapTradabilityDesk).toContainText("IMPACT BOOST");
  await expect(edgeMapTradabilityDesk).toContainText("22% info_density");

  await page.goto("/live-readiness/market-state-map", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("market-state-map-page")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("market-state-map-filter-symbol")).toHaveValue("DESK");
  await expect(page.getByTestId("market-state-map-filter-venue")).toHaveValue("MULTI");
  await expect(page.getByTestId("market-state-map-filter-timeframe")).toHaveValue("ALL");
  await expect(page.getByTestId("market-state-map-cells-panel")).toContainText("TREND");
  await expect(page.getByTestId("market-state-map-zones-panel")).toContainText("liquidity trap");
  await expect(page.getByTestId("market-state-map-anomaly-family-panel")).toContainText("VENUE DESYNC");
  await expect(page.getByTestId("market-state-map-anomaly-family-panel")).toContainText("BINANCE-PUBLIC");
  await expect(page.getByTestId("market-state-map-false-context-panel")).toContainText("FALSE SYNC");
  await expect(page.getByTestId("market-state-map-false-context-panel")).toContainText("FALSE EXECUTION CONTEXT");

  await page.goto("/live-ops", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("mission-control-live-ops-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "H24 Control Room" })).toBeVisible();
  const operatorActionPanel = page.locator(".operator-action-panel");
  await expect(operatorActionPanel).toContainText("Que faire maintenant");
  await expect(operatorActionPanel).toContainText(/watchdog en HALT/i);
  await expect(operatorActionPanel).toContainText(/latence 148ms/i);
  await expect(page.getByTestId("execution-runtime-decision-quick-read-drift")).toContainText("DRIFT system health");
  await expect(page.getByTestId("execution-runtime-decision-quick-read-drift")).toContainText("P 81% | R 73% | C 77%");
  await expect(page.getByTestId("execution-runtime-decision-quick-read-opportunity")).toContainText("OPPORTUNITY 62%");
  await expect(page.getByTestId("execution-runtime-decision-quick-read-opportunity")).toContainText("facteur limitant latency 32%");
  await expect(page.getByTestId("execution-runtime-decision-quick-read-live")).toContainText("stale 50%");
  const controlRoomPanel = page.locator(".monitoring-col").filter({ hasText: "H24 Control Room" }).first();
  await expect(controlRoomPanel).toContainText(/watchdog HALT/i);
  await expect(controlRoomPanel).toContainText(/Triggers: latency spike · broker disconnect/i);
  await expect(controlRoomPanel).toContainText(/1\.75% · 425 USD/i);
  await expect(controlRoomPanel).toContainText(/HIGH_VOL · 82%/i);
  await expect(controlRoomPanel).toContainText(/route-live/i);
  const pnlTruthPanel = page.locator(".monitoring-col").filter({ hasText: "Execution PnL Truth" }).first();
  await expect(pnlTruthPanel).toBeVisible();
  await expect(pnlTruthPanel).toContainText(/trades 11/i);
  await expect(pnlTruthPanel).toContainText(/flags 2/i);
  await expect(pnlTruthPanel).toContainText(/No-trade dominance/i);
  await expect(pnlTruthPanel).toContainText(/latency spike x2/i);
  await expect(pnlTruthPanel).toContainText(/TREND/i);
  await expect(pnlTruthPanel).toContainText(/guarded_auto/i);
  await page.getByRole("button", { name: "Recaler le sprint a aujourd'hui", exact: true }).click();
  await page.getByRole("button", { name: "Suggest", exact: true }).click();

  await page.goto("/connectors", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("mission-control-connectors-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connecteurs trading augmentes" })).toBeVisible();
  await page.getByPlaceholder("scenario").fill("Smoke macro shock");
  await page.getByRole("button", { name: "Lancer backtest", exact: true }).click();
  await page.getByPlaceholder("account_id").fill("mt5-smoke-01");
  await page.getByPlaceholder("mot de passe MT5").fill("ftmo-secret");
  await page.getByRole("button", { name: "Connecter le compte", exact: true }).click();
  await expect.poll(() => connectorsMt5Payload).not.toBeNull();
  expect(connectorsMt5Payload).toMatchObject({
    account_id: "mt5-smoke-01",
    password: "ftmo-secret",
  });

  await page.goto("/connections", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("mission-control-connections-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vos connexions de trading" })).toBeVisible();
  await page.getByPlaceholder("snapshot_url http://mt5-bridge:18086/state.json").fill("http://mt5-bridge:18086/state.json");
  await page.getByPlaceholder("truth_source").fill("mt5-external-session-smoke");
  await expect(page.locator(".panel").filter({ hasText: "Source broker_session MT5" }).first()).toContainText("Etat live broker");
  await expect(page.locator(".panel").filter({ hasText: "Source broker_session MT5" }).first()).toContainText("mt5-main-live");
  await page.getByRole("button", { name: "Sauvegarder la source broker", exact: true }).click();
  await expect.poll(() => brokerSessionPayload).not.toBeNull();
  expect(brokerSessionPayload).toMatchObject({
    merge: false,
    refresh: true,
    broker_session: {
      snapshot_url: "http://mt5-bridge:18086/state.json",
      truth_source: "mt5-external-session-smoke",
    },
  });
  const liveRoutePanel = page.locator(".panel").filter({ hasText: "Route d'integration live" }).first();
  await liveRoutePanel.locator("select").nth(0).selectOption("ftmo-10k");
  await expect(liveRoutePanel).toContainText(/mt5 \| ftmo-10k \| FTMO 10k/i);
  await expect(liveRoutePanel).toContainText(/Venue suggere/);
  await expect(liveRoutePanel).toContainText(/mt5/i);
  await liveRoutePanel.getByRole("button", { name: "Enregistrer la route", exact: true }).click();
  await expect.poll(() => integrationRouteUpsertPayload).not.toBeNull();
  expect(integrationRouteUpsertPayload).toMatchObject({
    provider: "mt5",
    account_id: "ftmo-10k",
    preferred_venue: "mt5",
  });
  await page.getByPlaceholder("Identifiant du compte sur l'exchange ou sous-compte").fill("bitget-smoke");
  await page.getByPlaceholder("Clé API").fill("key-smoke");
  await page.getByPlaceholder("Secret API").fill("secret-smoke");
  await page.getByPlaceholder(/Passphrase API/).fill("pass-smoke");
  await page.getByRole("button", { name: "Enregistrer le compte", exact: true }).click();
  await page.getByPlaceholder("adresse publique / custody ref").fill("0xfeedbeef");
  await page.getByPlaceholder("account label / wallet / API ref").fill("wallet-smoke-ref");
  await page.getByRole("button", { name: "Creer demande d'onboarding", exact: true }).click();
});