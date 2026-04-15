export type LocalFreshnessState = "fresh" | "stale" | "degraded" | "hard-fail";
export type LocalHealthTone = "good" | "warn" | "bad";
export type LocalStreamState = "offline" | "connecting" | "live";
export type LocalOhlcvSignal = "OHLCV_RENDERABLE" | "OHLCV_PARTIAL" | "OHLCV_UNUSABLE";

export type LocalTerminalPerceptualRuntime = {
  engine: "v3" | "v4";
  densityLevel: string;
  visibleBars: number;
  candleStepPx: number;
  profile: string | null;
  renderer: string | null;
  gridLabel: string | null;
  pixelSnapping: boolean;
  denseMode: string | null;
  preferredBodyWidthPx: number | null;
  wickWidthPx: number | null;
  minGapPx: number | null;
  fps: number;
  frameTimeMs: number | null;
  cpuLoad: number | null;
  workerLatencyMs: number | null;
  drawCalls: number | null;
  batchSize: number | null;
  reframeCount: number | null;
  transitionMode: string | null;
  lastPriceDriftPx: number | null;
  peakPriceDriftPx: number | null;
  updatedAt: string;
};

export type LocalRoutingDiagnostics = {
  bus_connected: boolean;
  bus: "OK" | "OFFLINE";
  bus_status: string;
  bus_seq: number;
  bus_lag_ms: number | null;
  flow: "OK" | "EMPTY";
  trades_count: number;
  depth: "OK" | "EMPTY";
  depth_levels: number;
  best_bid: number | null;
  best_ask: number | null;
  routing_state: "READY" | "BLOCKED";
  rejection_reasons: string[];
  routing_candidates: number;
  routing_debug: {
    mode: string;
    backend_source: string | null;
    backend_candidate_count: number;
    fusion_candidate_count: number;
    fusion_venue_count: number;
    fusion_filtered_tick_count: number;
    quote_sync_total: number;
    quote_sync_instrument_matches: number;
    quote_sync_active_venue_matches: number;
    quote_sync_accepted: number;
    quote_sync_active_venues: string[];
    quote_sync_instrument_candidates: string[];
    quote_sync_accepted_venues: string[];
    gate_trace: {
      evaluations: number;
      connect_requested_count: number;
      connect_invoked_count: number;
      last_bus_ref_ready: boolean;
      chart_data_mode: string;
      auth_status: string;
      auth_session_required: boolean;
      bus_ready_version: number;
      instrument: string;
      venue: string;
      timeframe: string;
      should_connect: boolean;
      block_reason: string;
      last_evaluated_at: string | null;
      last_triggered_at: string | null;
      last_bus_instance_id?: string | null;
      last_connect_calls_before?: number;
      last_connect_calls_after?: number;
      last_connect_error?: string | null;
    };
    hydration_trace: {
      instance_id: string | null;
      connect_calls: number;
      last_connect_short_circuit: string | null;
      reset_count: number;
      last_reset_reason: string | null;
      last_reset_at: string | null;
      refresh_count: number;
      refresh_started_count: number;
      refresh_stage: string;
      refresh_skip_reason: string | null;
      refresh_status: number;
      refresh_ok: boolean;
      snapshot_quotes: number;
      snapshot_trades: number;
      snapshot_depth_levels: number;
      snapshot_routing_candidates: number;
      snapshot_seq: number;
      trade_ws_state: string;
      trade_ws_messages: number;
      trade_ws_errors: number;
      trade_ws_last_type: string | null;
      depth_ws_state: string;
      depth_ws_messages: number;
      depth_ws_errors: number;
      depth_ws_last_type: string | null;
      listener_count: number;
      emit_count: number;
      dispatch_trades: number;
      dispatch_depth_levels: number;
      dispatch_routing_candidates: number;
      dispatch_seq: number;
    };
  };
  routing_score_inputs: {
    preferred_route_venue: string | null;
    preferred_route_score: number;
    spread_bps: number | null;
    available_depth_usd: number | null;
    fill_probability: number | null;
    infra_health: number;
    network_regime: string;
    routing_reason: string;
    source_labels: string[];
  };
};

export type LocalDecisionDataset = {
  action: "NO_TRADE" | "WAIT" | "TRADE_ALLOWED";
  execution_lock_active: boolean;
  execution_lock_code: string;
  summary: string;
  detail: string;
};

export type LocalExecutionDataset = {
  status: string | null;
  filled: boolean | null;
  venue: string | null;
  fill_latency_ms: number | null;
  slippage_bps: number | null;
  fill_ratio: number | null;
  pnl_usd: number | null;
  max_drawdown_usd: number | null;
  holding_time_sec: number | null;
  captured_from: string | null;
};

export type LocalTerminalRuntimeCapture = {
  version: 1;
  clientId: string;
  capturedAt: string;
  auth: {
    status: string;
    sessionRequired: boolean;
  };
  chart: {
    symbol: string;
    instrument: string;
    venue: string;
    timeframe: string;
    mode: "line" | "candles" | "footprint";
    visualMode: "auto" | "clean" | "full";
    feedLabel: string;
  };
  localFeed: {
    signal: LocalOhlcvSignal;
    message: string;
    fetchedRows: number;
    renderableRows: number;
    droppedRows: number;
    duplicateTimestamps: number;
    firstTimestamp: string | null;
    lastTimestamp: string | null;
    reasons: string[];
    droppedReasonKinds: string[];
  };
  runtime: {
    bus: {
      status: string;
      tone: LocalHealthTone;
      display: string;
    };
    ohlcv: {
      status: LocalStreamState;
      tone: LocalHealthTone;
      display: string;
    };
    seq: {
      contiguous: boolean;
      latestSeq: number;
      tone: LocalHealthTone;
      display: string;
    };
    dom: {
      status: LocalStreamState;
      tone: LocalHealthTone;
      display: string;
    };
    bars: {
      state: LocalFreshnessState;
      age: string;
      tone: LocalHealthTone;
      display: string;
    };
    depth: {
      state: LocalFreshnessState;
      age: string;
      tone: LocalHealthTone;
      display: string;
    };
    trades: {
      state: LocalFreshnessState;
      age: string;
      tone: LocalHealthTone;
      display: string;
    };
    candles: {
      receivedTicks: number;
      candleUpdates: number;
      syntheticHeartbeatOpens: number;
      lastUpdateAge: string;
    };
    syncDiagnostics?: {
      bus_seq: number;
      last_trade_time: string | null;
      depth_age_ms: number | null;
      ohlcv_time: string | null;
    };
    routingDiagnostics?: LocalRoutingDiagnostics;
    attention?: {
      state: "stable" | "degraded" | "fragile" | "blocked";
      dominantLayer: string;
      reliabilityScore: number;
      coherenceScore: number;
      tone: LocalHealthTone;
      renderable: boolean;
      shouldBlockTrading: boolean;
      preferredRenderSource: "ohlcv" | "bus";
      summary: string;
      detail: string;
      weights: Record<string, number>;
    };
    temporal?: {
      aligned: boolean;
      degraded: boolean;
      driftMs: number;
      seqGap: number;
      freshnessScore: number;
      dominantSource: string;
      sourceCount: number;
      bufferedSourceCount: number;
      bufferWindowMs: number;
      summary: string;
      detail: string;
    };
    smartState?: {
      state: "VALID" | "WAIT" | "NO_TRADE";
      reason: string;
      confidence: number;
      tone: LocalHealthTone;
      summary: string;
      detail: string;
    };
    desync?: {
      type: "NONE" | "FAKE_MOVE" | "ABSORPTION" | "BREAKOUT" | "LIQUIDITY_TRAP";
      state: "aligned" | "opportunity" | "risk";
      tradeBias: "long" | "short" | "neutral";
      strength: number;
      confidence: number;
      shouldBlockTrading: boolean;
      summary: string;
      detail: string;
    };
    intent?: {
      type: "NONE" | "ACCUMULATION" | "DISTRIBUTION" | "LIQUIDITY_HUNT" | "FAKE_ACTIVITY";
      state: "neutral" | "alpha" | "risk";
      tradeBias: "buy" | "sell" | "neutral";
      confidence: number;
      persistence: number;
      aggressiveness: number;
      isInstitutional: boolean;
      shouldBlockTrading: boolean;
      summary: string;
      detail: string;
    };
    perceptual: LocalTerminalPerceptualRuntime | null;
    compactAlertLabel: string;
    alertText: string;
    exactStateVector: string[];
    noCandlesExpected: boolean;
    blockedByFiveStateFailure: boolean;
  };
  dataset: {
    market_state: {
      bus_seq: number;
      bus_lag_ms: number | null;
      ohlcv_time: string | null;
      trades_count: number;
      depth_levels: number;
      bbo_spread_bps: number | null;
    };
    routing: {
      state: "READY" | "BLOCKED";
      reasons: string[];
      score: number;
    };
    context: {
      volatility: string;
      regime: string;
      intent: string;
      desync: string;
    };
    decision: LocalDecisionDataset;
    execution: LocalExecutionDataset | null;
  };
};

export type LocalTerminalAutoIncident = {
  clientId: string;
  signature: string;
  openedAt: string;
  closedAt?: string | null;
  ticketKey: string | null;
  title: string;
  detail: string;
  status: "opened" | "closed" | "suppressed" | "failed" | "close-failed";
};

export type PersistedLocalTerminalCaptureStore = {
  version: 1;
  updatedAt: string | null;
  latestClientId: string | null;
  captures: Record<string, LocalTerminalRuntimeCapture>;
  captureHistory: Record<string, LocalTerminalRuntimeCapture[]>;
  autoIncidents: Record<string, LocalTerminalAutoIncident>;
};

export type BuildLocalTerminalRuntimeCaptureInput = {
  clientId: string;
  capturedAt: string;
  authStatus: string;
  authSessionRequired: boolean;
  symbol: string;
  instrument: string;
  venue: string;
  timeframe: string;
  chartMode: "line" | "candles" | "footprint";
  chartVisualMode: "auto" | "clean" | "full";
  feedLabel: string;
  localFeedSignal: LocalOhlcvSignal;
  localFeedMessage: string;
  fetchedRows: number;
  renderableRows: number;
  droppedRows: number;
  duplicateTimestamps: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  reasons: string[];
  droppedReasonKinds: string[];
  marketBusHealthStatus: string;
  marketBusHealthTone: LocalHealthTone;
  ohlcvStreamState: LocalStreamState;
  displayDepthStreamState: LocalStreamState;
  marketBusOhlcvContiguous: boolean;
  marketBusOhlcvLatestSeq: number;
  ohlcvFreshnessState: LocalFreshnessState;
  depthFreshnessState: LocalFreshnessState;
  tradesFreshnessState: LocalFreshnessState;
  crossLayerAttentionState: "stable" | "degraded" | "fragile" | "blocked";
  crossLayerAttentionTone: LocalHealthTone;
  crossLayerAttentionDominantLayer: string;
  crossLayerAttentionReliabilityScore: number;
  crossLayerAttentionCoherenceScore: number;
  crossLayerAttentionRenderable: boolean;
  crossLayerAttentionShouldBlockTrading: boolean;
  crossLayerAttentionPreferredRenderSource: "ohlcv" | "bus";
  crossLayerAttentionSummaryLabel: string;
  crossLayerAttentionDetailLabel: string;
  crossLayerAttentionWeights: Record<string, number>;
  temporalSyncAligned: boolean;
  temporalSyncDegraded: boolean;
  temporalSyncDriftMs: number;
  temporalSyncSeqGap: number;
  temporalSyncFreshnessScore: number;
  temporalSyncDominantSource: string;
  temporalSyncSourceCount: number;
  temporalSyncBufferedSourceCount: number;
  temporalSyncBufferWindowMs: number;
  temporalSyncSummaryLabel: string;
  temporalSyncDetailLabel: string;
  smartMarketState: "VALID" | "WAIT" | "NO_TRADE";
  smartMarketReason: string;
  smartMarketConfidence: number;
  smartMarketTone: LocalHealthTone;
  smartMarketSummaryLabel: string;
  smartMarketDetailLabel: string;
  desyncType: "NONE" | "FAKE_MOVE" | "ABSORPTION" | "BREAKOUT" | "LIQUIDITY_TRAP";
  desyncState: "aligned" | "opportunity" | "risk";
  desyncTradeBias: "long" | "short" | "neutral";
  desyncStrength: number;
  desyncConfidence: number;
  desyncShouldBlockTrading: boolean;
  desyncSummaryLabel: string;
  desyncDetailLabel: string;
  intentType: "NONE" | "ACCUMULATION" | "DISTRIBUTION" | "LIQUIDITY_HUNT" | "FAKE_ACTIVITY";
  intentState: "neutral" | "alpha" | "risk";
  intentTradeBias: "buy" | "sell" | "neutral";
  intentConfidence: number;
  intentPersistence: number;
  intentAggressiveness: number;
  intentIsInstitutional: boolean;
  intentShouldBlockTrading: boolean;
  intentSummaryLabel: string;
  intentDetailLabel: string;
  barsAge: string;
  depthAge: string;
  tradesAge: string;
  candleTicks: number;
  candleUpdates: number;
  syntheticHeartbeatOpens: number;
  candleLastUpdateAge: string;
  syncBusSeq: number;
  syncLastTradeTime: string | null;
  syncDepthAgeMs: number | null;
  syncOhlcvTime: string | null;
  routingDiagnostics: LocalRoutingDiagnostics;
  volatilityRegime: string;
  marketRegime: string;
  executionLockActive: boolean;
  executionLockCode: string;
  executionLockSummaryLabel: string;
  executionLockDetailLabel: string;
  latestExecutionStatus: string | null;
  latestExecutionFilled: boolean | null;
  latestExecutionVenue: string | null;
  latestExecutionFillLatencyMs: number | null;
  latestExecutionSlippageBps: number | null;
  latestExecutionFillRatio: number | null;
  latestExecutionPnlUsd: number | null;
  latestExecutionMaxDrawdownUsd: number | null;
  latestExecutionHoldingTimeSec: number | null;
  latestExecutionCapturedFrom: string | null;
  chartCompactAlertLabel: string;
  chartFlowAlertText: string;
  perceptual?: LocalTerminalPerceptualRuntime | null;
};

const MAX_CAPTURE_COUNT = 12;
const MAX_CAPTURE_HISTORY_PER_CLIENT = 24;

function asToneForStatus(status: LocalFreshnessState | LocalStreamState | string): LocalHealthTone {
  if (status === "ok" || status === "live" || status === "fresh") {
    return "good";
  }
  if (status === "connecting" || status === "stale") {
    return "warn";
  }
  return "bad";
}

export function defaultLocalTerminalCaptureStore(): PersistedLocalTerminalCaptureStore {
  return {
    version: 1,
    updatedAt: null,
    latestClientId: null,
    captures: {},
    captureHistory: {},
    autoIncidents: {},
  };
}

export function buildLocalTerminalIncidentSignature(capture: LocalTerminalRuntimeCapture): string {
  return JSON.stringify({
    clientId: capture.clientId,
    feed: capture.chart.feedLabel,
    signal: capture.localFeed.signal,
    state: capture.runtime.exactStateVector,
    blocked: capture.runtime.blockedByFiveStateFailure,
    attention: capture.runtime.attention
      ? {
        state: capture.runtime.attention.state,
        dominantLayer: capture.runtime.attention.dominantLayer,
        shouldBlockTrading: capture.runtime.attention.shouldBlockTrading,
      }
      : null,
    smartState: capture.runtime.smartState
      ? {
        state: capture.runtime.smartState.state,
        reason: capture.runtime.smartState.reason,
      }
      : null,
    routing: capture.runtime.routingDiagnostics
      ? {
        bus: capture.runtime.routingDiagnostics.bus,
        bus_seq: capture.runtime.routingDiagnostics.bus_seq,
        bus_lag_ms: capture.runtime.routingDiagnostics.bus_lag_ms,
        flow: capture.runtime.routingDiagnostics.flow,
        depth: capture.runtime.routingDiagnostics.depth,
        routing_state: capture.runtime.routingDiagnostics.routing_state,
        rejection_reasons: capture.runtime.routingDiagnostics.rejection_reasons,
        routing_candidates: capture.runtime.routingDiagnostics.routing_candidates,
        routing_mode: capture.runtime.routingDiagnostics.routing_debug.mode,
        gate_requests: capture.runtime.routingDiagnostics.routing_debug.gate_trace.connect_requested_count,
        gate_invokes: capture.runtime.routingDiagnostics.routing_debug.gate_trace.connect_invoked_count,
        gate_ref_ready: capture.runtime.routingDiagnostics.routing_debug.gate_trace.last_bus_ref_ready,
        gate_should_connect: capture.runtime.routingDiagnostics.routing_debug.gate_trace.should_connect,
        gate_reason: capture.runtime.routingDiagnostics.routing_debug.gate_trace.block_reason,
        backend_candidate_count: capture.runtime.routingDiagnostics.routing_debug.backend_candidate_count,
        fusion_candidate_count: capture.runtime.routingDiagnostics.routing_debug.fusion_candidate_count,
        quote_sync_accepted: capture.runtime.routingDiagnostics.routing_debug.quote_sync_accepted,
        quote_sync_total: capture.runtime.routingDiagnostics.routing_debug.quote_sync_total,
        refresh_status: capture.runtime.routingDiagnostics.routing_debug.hydration_trace.refresh_status,
        refresh_stage: capture.runtime.routingDiagnostics.routing_debug.hydration_trace.refresh_stage,
        reset_reason: capture.runtime.routingDiagnostics.routing_debug.hydration_trace.last_reset_reason,
        reset_count: capture.runtime.routingDiagnostics.routing_debug.hydration_trace.reset_count,
        instance_id: capture.runtime.routingDiagnostics.routing_debug.hydration_trace.instance_id,
        snapshot_seq: capture.runtime.routingDiagnostics.routing_debug.hydration_trace.snapshot_seq,
        trade_ws_messages: capture.runtime.routingDiagnostics.routing_debug.hydration_trace.trade_ws_messages,
        depth_ws_messages: capture.runtime.routingDiagnostics.routing_debug.hydration_trace.depth_ws_messages,
        dispatch_seq: capture.runtime.routingDiagnostics.routing_debug.hydration_trace.dispatch_seq,
      }
      : null,
    dataset: {
      decision: capture.dataset.decision,
      routing: capture.dataset.routing,
      execution: capture.dataset.execution
        ? {
          status: capture.dataset.execution.status,
          filled: capture.dataset.execution.filled,
          venue: capture.dataset.execution.venue,
          pnl_usd: capture.dataset.execution.pnl_usd,
        }
        : null,
    },
    desync: capture.runtime.desync
      ? {
        type: capture.runtime.desync.type,
        state: capture.runtime.desync.state,
      }
      : null,
    intent: capture.runtime.intent
      ? {
        type: capture.runtime.intent.type,
        state: capture.runtime.intent.state,
        tradeBias: capture.runtime.intent.tradeBias,
      }
      : null,
  });
}

export function buildLocalTerminalRuntimeCapture(input: BuildLocalTerminalRuntimeCaptureInput): LocalTerminalRuntimeCapture {
  const exactStateVector = [
    `BUS ${String(input.marketBusHealthStatus || "offline").toUpperCase()}`,
    `OHLCV ${input.ohlcvStreamState.toUpperCase()}`,
    `BARS ${input.ohlcvFreshnessState.toUpperCase()} ${input.barsAge}`,
    `DEPTH ${input.depthFreshnessState.toUpperCase()} ${input.depthAge}`,
    `TRADES ${input.tradesFreshnessState.toUpperCase()} ${input.tradesAge}`,
    input.crossLayerAttentionSummaryLabel,
    input.temporalSyncSummaryLabel,
    input.desyncSummaryLabel,
    input.intentSummaryLabel,
    input.smartMarketSummaryLabel,
  ];
  const hasRenderableRestFeed = input.localFeedSignal === "OHLCV_RENDERABLE"
    && input.renderableRows > 0;
  const hasValidBusState = input.ohlcvStreamState === "live"
    && input.marketBusOhlcvContiguous
    && input.marketBusOhlcvLatestSeq > 0
    && input.ohlcvFreshnessState !== "hard-fail";
  const blockedByFiveStateFailure = input.crossLayerAttentionShouldBlockTrading
    && !hasRenderableRestFeed
    && String(input.marketBusHealthStatus || "offline") !== "ok"
    && input.ohlcvStreamState !== "live"
    && input.ohlcvFreshnessState === "hard-fail"
    && input.depthFreshnessState === "hard-fail"
    && input.tradesFreshnessState === "hard-fail";
  const noCandlesExpected = !input.crossLayerAttentionRenderable && !hasValidBusState;
  const decisionAction: LocalDecisionDataset["action"] = input.executionLockActive
    ? "NO_TRADE"
    : input.smartMarketState === "WAIT"
      ? "WAIT"
      : "TRADE_ALLOWED";
  const bestBid = input.routingDiagnostics.best_bid;
  const bestAsk = input.routingDiagnostics.best_ask;
  const spreadMid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : Number.NaN;
  const bboSpreadBps = Number.isFinite(spreadMid) && spreadMid > 0 && bestBid != null && bestAsk != null
    ? Number((((bestAsk - bestBid) / spreadMid) * 10_000).toFixed(4))
    : null;
  const executionDataset: LocalExecutionDataset | null = input.latestExecutionStatus
    || input.latestExecutionVenue
    || input.latestExecutionFillLatencyMs != null
    || input.latestExecutionSlippageBps != null
    || input.latestExecutionPnlUsd != null
    ? {
      status: input.latestExecutionStatus,
      filled: input.latestExecutionFilled,
      venue: input.latestExecutionVenue,
      fill_latency_ms: input.latestExecutionFillLatencyMs,
      slippage_bps: input.latestExecutionSlippageBps,
      fill_ratio: input.latestExecutionFillRatio,
      pnl_usd: input.latestExecutionPnlUsd,
      max_drawdown_usd: input.latestExecutionMaxDrawdownUsd,
      holding_time_sec: input.latestExecutionHoldingTimeSec,
      captured_from: input.latestExecutionCapturedFrom,
    }
    : null;

  return {
    version: 1,
    clientId: input.clientId,
    capturedAt: input.capturedAt,
    auth: {
      status: input.authStatus,
      sessionRequired: input.authSessionRequired,
    },
    chart: {
      symbol: input.symbol,
      instrument: input.instrument,
      venue: input.venue,
      timeframe: input.timeframe,
      mode: input.chartMode,
      visualMode: input.chartVisualMode,
      feedLabel: input.feedLabel,
    },
    localFeed: {
      signal: input.localFeedSignal,
      message: input.localFeedMessage,
      fetchedRows: input.fetchedRows,
      renderableRows: input.renderableRows,
      droppedRows: input.droppedRows,
      duplicateTimestamps: input.duplicateTimestamps,
      firstTimestamp: input.firstTimestamp,
      lastTimestamp: input.lastTimestamp,
      reasons: input.reasons,
      droppedReasonKinds: input.droppedReasonKinds,
    },
    runtime: {
      bus: {
        status: input.marketBusHealthStatus,
        tone: input.marketBusHealthTone,
        display: `BUS ${String(input.marketBusHealthStatus || "offline").toUpperCase()}`,
      },
      ohlcv: {
        status: input.ohlcvStreamState,
        tone: asToneForStatus(input.ohlcvStreamState),
        display: `OHLCV ${input.ohlcvStreamState.toUpperCase()}`,
      },
      seq: {
        contiguous: input.marketBusOhlcvContiguous,
        latestSeq: input.marketBusOhlcvLatestSeq,
        tone: input.marketBusOhlcvContiguous ? "good" : "warn",
        display: `${input.marketBusOhlcvContiguous ? "SEQ OK" : "SEQ GAP"} ${input.marketBusOhlcvLatestSeq > 0 ? `#${input.marketBusOhlcvLatestSeq}` : "#-"}`,
      },
      dom: {
        status: input.displayDepthStreamState,
        tone: asToneForStatus(input.displayDepthStreamState),
        display: `DOM ${input.displayDepthStreamState.toUpperCase()}`,
      },
      bars: {
        state: input.ohlcvFreshnessState,
        age: input.barsAge,
        tone: asToneForStatus(input.ohlcvFreshnessState),
        display: `BARS ${input.ohlcvFreshnessState.toUpperCase()} ${input.barsAge}`,
      },
      depth: {
        state: input.depthFreshnessState,
        age: input.depthAge,
        tone: asToneForStatus(input.depthFreshnessState),
        display: `DEPTH ${input.depthFreshnessState.toUpperCase()} ${input.depthAge}`,
      },
      trades: {
        state: input.tradesFreshnessState,
        age: input.tradesAge,
        tone: asToneForStatus(input.tradesFreshnessState),
        display: `TRADES ${input.tradesFreshnessState.toUpperCase()} ${input.tradesAge}`,
      },
      candles: {
        receivedTicks: input.candleTicks,
        candleUpdates: input.candleUpdates,
        syntheticHeartbeatOpens: input.syntheticHeartbeatOpens,
        lastUpdateAge: input.candleLastUpdateAge,
      },
      syncDiagnostics: {
        bus_seq: input.syncBusSeq,
        last_trade_time: input.syncLastTradeTime,
        depth_age_ms: input.syncDepthAgeMs,
        ohlcv_time: input.syncOhlcvTime,
      },
      routingDiagnostics: input.routingDiagnostics,
      attention: {
        state: input.crossLayerAttentionState,
        dominantLayer: input.crossLayerAttentionDominantLayer,
        reliabilityScore: input.crossLayerAttentionReliabilityScore,
        coherenceScore: input.crossLayerAttentionCoherenceScore,
        tone: input.crossLayerAttentionTone,
        renderable: input.crossLayerAttentionRenderable,
        shouldBlockTrading: input.crossLayerAttentionShouldBlockTrading,
        preferredRenderSource: input.crossLayerAttentionPreferredRenderSource,
        summary: input.crossLayerAttentionSummaryLabel,
        detail: input.crossLayerAttentionDetailLabel,
        weights: input.crossLayerAttentionWeights,
      },
      temporal: {
        aligned: input.temporalSyncAligned,
        degraded: input.temporalSyncDegraded,
        driftMs: input.temporalSyncDriftMs,
        seqGap: input.temporalSyncSeqGap,
        freshnessScore: input.temporalSyncFreshnessScore,
        dominantSource: input.temporalSyncDominantSource,
        sourceCount: input.temporalSyncSourceCount,
        bufferedSourceCount: input.temporalSyncBufferedSourceCount,
        bufferWindowMs: input.temporalSyncBufferWindowMs,
        summary: input.temporalSyncSummaryLabel,
        detail: input.temporalSyncDetailLabel,
      },
      smartState: {
        state: input.smartMarketState,
        reason: input.smartMarketReason,
        confidence: input.smartMarketConfidence,
        tone: input.smartMarketTone,
        summary: input.smartMarketSummaryLabel,
        detail: input.smartMarketDetailLabel,
      },
      desync: {
        type: input.desyncType,
        state: input.desyncState,
        tradeBias: input.desyncTradeBias,
        strength: input.desyncStrength,
        confidence: input.desyncConfidence,
        shouldBlockTrading: input.desyncShouldBlockTrading,
        summary: input.desyncSummaryLabel,
        detail: input.desyncDetailLabel,
      },
      intent: {
        type: input.intentType,
        state: input.intentState,
        tradeBias: input.intentTradeBias,
        confidence: input.intentConfidence,
        persistence: input.intentPersistence,
        aggressiveness: input.intentAggressiveness,
        isInstitutional: input.intentIsInstitutional,
        shouldBlockTrading: input.intentShouldBlockTrading,
        summary: input.intentSummaryLabel,
        detail: input.intentDetailLabel,
      },
      perceptual: input.perceptual || null,
      compactAlertLabel: input.chartCompactAlertLabel,
      alertText: input.chartFlowAlertText,
      exactStateVector,
      noCandlesExpected,
      blockedByFiveStateFailure,
    },
    dataset: {
      market_state: {
        bus_seq: input.syncBusSeq,
        bus_lag_ms: input.routingDiagnostics.bus_lag_ms,
        ohlcv_time: input.syncOhlcvTime,
        trades_count: input.routingDiagnostics.trades_count,
        depth_levels: input.routingDiagnostics.depth_levels,
        bbo_spread_bps: bboSpreadBps,
      },
      routing: {
        state: input.routingDiagnostics.routing_state,
        reasons: input.routingDiagnostics.rejection_reasons,
        score: input.routingDiagnostics.routing_score_inputs.preferred_route_score,
      },
      context: {
        volatility: input.volatilityRegime,
        regime: input.marketRegime,
        intent: input.intentType,
        desync: input.desyncType,
      },
      decision: {
        action: decisionAction,
        execution_lock_active: input.executionLockActive,
        execution_lock_code: input.executionLockCode,
        summary: input.executionLockActive ? input.executionLockSummaryLabel : input.smartMarketSummaryLabel,
        detail: input.executionLockActive ? input.executionLockDetailLabel : input.smartMarketDetailLabel,
      },
      execution: executionDataset,
    },
  };
}

export function normalizeLocalTerminalCaptureStore(raw: unknown): PersistedLocalTerminalCaptureStore {
  if (!raw || typeof raw !== "object") {
    return defaultLocalTerminalCaptureStore();
  }
  const payload = raw as Partial<PersistedLocalTerminalCaptureStore> & {
    captures?: Record<string, LocalTerminalRuntimeCapture>;
    captureHistory?: Record<string, LocalTerminalRuntimeCapture[]>;
    autoIncidents?: Record<string, LocalTerminalAutoIncident>;
  };
  const captures = payload.captures && typeof payload.captures === "object"
    ? payload.captures
    : {};
  const captureHistoryRaw = payload.captureHistory && typeof payload.captureHistory === "object"
    ? payload.captureHistory
    : {};
  const autoIncidents = payload.autoIncidents && typeof payload.autoIncidents === "object"
    ? Object.entries(payload.autoIncidents).reduce<Record<string, LocalTerminalAutoIncident>>((accumulator, [clientId, incident]) => {
      if (!incident || typeof incident !== "object") {
        return accumulator;
      }
      const candidate = incident as Partial<LocalTerminalAutoIncident>;
      if (typeof candidate.clientId !== "string" || typeof candidate.signature !== "string" || typeof candidate.openedAt !== "string") {
        return accumulator;
      }
      accumulator[clientId] = {
        clientId: candidate.clientId,
        signature: candidate.signature,
        openedAt: candidate.openedAt,
        closedAt: typeof candidate.closedAt === "string" ? candidate.closedAt : null,
        ticketKey: typeof candidate.ticketKey === "string" ? candidate.ticketKey : null,
        title: typeof candidate.title === "string" ? candidate.title : "Local terminal hard fail",
        detail: typeof candidate.detail === "string" ? candidate.detail : "unknown",
        status: candidate.status === "opened" || candidate.status === "closed" || candidate.status === "suppressed" || candidate.status === "failed" || candidate.status === "close-failed"
          ? candidate.status
          : "failed",
      };
      return accumulator;
    }, {})
    : {};
  const orderedCaptures = Object.values(captures)
    .filter((capture) => Boolean(capture && typeof capture === "object" && typeof capture.clientId === "string" && typeof capture.capturedAt === "string"))
    .sort((left, right) => String(right.capturedAt).localeCompare(String(left.capturedAt)))
    .slice(0, MAX_CAPTURE_COUNT);
  const normalizedHistory = Object.entries(captureHistoryRaw).reduce<Record<string, LocalTerminalRuntimeCapture[]>>((accumulator, [clientId, history]) => {
    if (!Array.isArray(history)) {
      return accumulator;
    }
    const entries = history
      .filter((capture) => Boolean(capture && typeof capture === "object" && typeof (capture as LocalTerminalRuntimeCapture).clientId === "string" && typeof (capture as LocalTerminalRuntimeCapture).capturedAt === "string"))
      .sort((left, right) => String(right.capturedAt).localeCompare(String(left.capturedAt)))
      .slice(0, MAX_CAPTURE_HISTORY_PER_CLIENT);
    if (entries.length > 0) {
      accumulator[clientId] = entries;
    }
    return accumulator;
  }, {});

  return {
    version: 1,
    updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
    latestClientId: typeof payload.latestClientId === "string" ? payload.latestClientId : (orderedCaptures[0]?.clientId || null),
    captures: orderedCaptures.reduce<Record<string, LocalTerminalRuntimeCapture>>((accumulator, capture) => {
      accumulator[capture.clientId] = capture;
      return accumulator;
    }, {}),
    captureHistory: normalizedHistory,
    autoIncidents,
  };
}

export function upsertLocalTerminalCaptureStore(
  store: PersistedLocalTerminalCaptureStore,
  capture: LocalTerminalRuntimeCapture,
): PersistedLocalTerminalCaptureStore {
  const nextHistory = [capture, ...(store.captureHistory[capture.clientId] || [])]
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.capturedAt === entry.capturedAt) === index)
    .sort((left, right) => String(right.capturedAt).localeCompare(String(left.capturedAt)))
    .slice(0, MAX_CAPTURE_HISTORY_PER_CLIENT);
  const nextStore = normalizeLocalTerminalCaptureStore({
    ...store,
    updatedAt: capture.capturedAt,
    latestClientId: capture.clientId,
    captures: {
      ...store.captures,
      [capture.clientId]: capture,
    },
    captureHistory: {
      ...store.captureHistory,
      [capture.clientId]: nextHistory,
    },
  });
  return nextStore;
}

export function setLocalTerminalAutoIncident(
  store: PersistedLocalTerminalCaptureStore,
  incident: LocalTerminalAutoIncident,
): PersistedLocalTerminalCaptureStore {
  return normalizeLocalTerminalCaptureStore({
    ...store,
    autoIncidents: {
      ...store.autoIncidents,
      [incident.clientId]: incident,
    },
  });
}

export function getLocalTerminalCaptureByClientId(
  store: PersistedLocalTerminalCaptureStore,
  clientId: string | null | undefined,
): LocalTerminalRuntimeCapture | null {
  if (!clientId) {
    return null;
  }
  return store.captures[clientId] || null;
}

export function getLocalTerminalCaptureHistory(
  store: PersistedLocalTerminalCaptureStore,
  clientId: string | null | undefined,
): LocalTerminalRuntimeCapture[] {
  if (!clientId) {
    return [];
  }
  return store.captureHistory[clientId] || [];
}

export function getLocalTerminalAutoIncident(
  store: PersistedLocalTerminalCaptureStore,
  clientId: string | null | undefined,
): LocalTerminalAutoIncident | null {
  if (!clientId) {
    return null;
  }
  return store.autoIncidents[clientId] || null;
}

export function getLatestLocalTerminalCapture(store: PersistedLocalTerminalCaptureStore): LocalTerminalRuntimeCapture | null {
  const latestClientId = store.latestClientId;
  if (latestClientId && store.captures[latestClientId]) {
    return store.captures[latestClientId];
  }
  const captures = Object.values(store.captures).sort((left, right) => String(right.capturedAt).localeCompare(String(left.capturedAt)));
  return captures[0] || null;
}

export function summarizeLocalTerminalCaptures(store: PersistedLocalTerminalCaptureStore): Array<{
  client_id: string;
  captured_at: string;
  chart_feed: string;
  local_feed_signal: LocalOhlcvSignal;
  exact_state_vector: string[];
  no_candles_expected: boolean;
  synthetic_heartbeat_opens: number;
  history_count: number;
}> {
  return Object.values(store.captures)
    .sort((left, right) => String(right.capturedAt).localeCompare(String(left.capturedAt)))
    .map((capture) => ({
      client_id: capture.clientId,
      captured_at: capture.capturedAt,
      chart_feed: capture.chart.feedLabel,
      local_feed_signal: capture.localFeed.signal,
      exact_state_vector: capture.runtime.exactStateVector,
      no_candles_expected: capture.runtime.noCandlesExpected,
      synthetic_heartbeat_opens: capture.runtime.candles?.syntheticHeartbeatOpens ?? 0,
      history_count: store.captureHistory[capture.clientId]?.length || 0,
    }));
}

export function summarizeRecentLocalTerminalCaptureEvents(store: PersistedLocalTerminalCaptureStore): Array<{
  client_id: string;
  captured_at: string;
  chart_feed: string;
  blocked_by_five_state_failure: boolean;
  exact_state_vector: string[];
}> {
  return Object.entries(store.captureHistory)
    .flatMap(([clientId, history]) => history.map((capture) => ({
      client_id: clientId,
      captured_at: capture.capturedAt,
      chart_feed: capture.chart.feedLabel,
      blocked_by_five_state_failure: capture.runtime.blockedByFiveStateFailure,
      exact_state_vector: capture.runtime.exactStateVector,
    })))
    .sort((left, right) => String(right.captured_at).localeCompare(String(left.captured_at)))
    .slice(0, MAX_CAPTURE_COUNT * 4);
}

export function isLocalTerminalRuntimeCapture(value: unknown): value is LocalTerminalRuntimeCapture {
  if (!value || typeof value !== "object") {
    return false;
  }
  const capture = value as Partial<LocalTerminalRuntimeCapture>;
  return capture.version === 1
    && typeof capture.clientId === "string"
    && typeof capture.capturedAt === "string"
    && Boolean(capture.chart && typeof capture.chart === "object")
    && Boolean(capture.runtime && typeof capture.runtime === "object")
    && Boolean(capture.localFeed && typeof capture.localFeed === "object");
}