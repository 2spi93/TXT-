type JsonMap = Record<string, unknown>;

import { normalizeOhlcvRows, type NormalizedOhlcvBar } from "./ohlcvIntegrity";
import { MarketDataEngineV5, type GapRange } from "./marketDataEngineV5";
import type { DepthRow } from "./marketDataEngineV4";

export type OhlcvBar = NormalizedOhlcvBar;

export type MarketBusRequestType = "ui" | "ai" | "execution";

export type MarketDataBusConfig = {
  instrument: string;
  venue: string;
  timeframe: string;
};

export type MarketDataBusSnapshot = {
  configKey: string;
  ohlcvBars: OhlcvBar[];
  nativeTrades: JsonMap[];
  marketMicro: JsonMap | null;
  sessionState: JsonMap | null;
  orderbook: JsonMap | null;
  marketDepth: JsonMap | null;
  routingScore: JsonMap | null;
  busMeta: JsonMap | null;
  chartLoading: boolean;
  ohlcvStreamState: "offline" | "connecting" | "live";
  depthStreamState: "offline" | "connecting" | "live";
  lastSyncAt: string | null;
};

type MarketDataBusListener = (snapshot: MarketDataBusSnapshot) => void;

const SIDE_REFRESH_MS = 15_000;
const PUBLIC_SIDE_REFRESH_MS = 30_000;
const SNAPSHOT_RETRY_COOLDOWN_MS = 30_000;
const STREAM_FAILURE_THRESHOLD = 3;
const STREAM_FAILURE_COOLDOWN_MS = 60_000;

type StreamKind = "ohlcv" | "depth";

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildRequestHeaders(requestType: MarketBusRequestType, instrument: string): HeadersInit {
  return {
    "x-mc-request-type": requestType,
    "x-mc-priority": requestType === "execution" ? "execution" : requestType === "ai" ? "high" : "low",
    "x-mc-symbol": instrument,
    "x-mc-origin": "terminal",
  };
}

function isGtixPublicHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "app.txt.gtixt.com"
    || normalized === "staging.txt.gtixt.com"
    || normalized === "api.txt.gtixt.com"
    || normalized === "api.staging.txt.gtixt.com";
}

function buildMarketOhlcvWsUrl(instrument: string, venue: string, timeframe: string, limit = 500): string {
  if (typeof window === "undefined") {
    return "";
  }
  if (isGtixPublicHost(window.location.hostname)) {
    return "";
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const base = `${protocol}://${window.location.host}`;
  const params = new URLSearchParams({
    venue,
    timeframe,
    limit: String(limit),
  });
  return `${base}/ws/v1/market/ohlcv/${encodeURIComponent(instrument)}?${params.toString()}`;
}

function buildMarketDepthWsUrl(instrument: string, venue: string): string {
  if (typeof window === "undefined") {
    return "";
  }
  if (isGtixPublicHost(window.location.hostname)) {
    return "";
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const base = `${protocol}://${window.location.host}`;
  return `${base}/ws/v1/market/orderbook/depth/${encodeURIComponent(instrument)}?venue=${encodeURIComponent(venue)}`;
}

function resolveSideRefreshMs(): number {
  if (typeof window !== "undefined" && isGtixPublicHost(window.location.hostname)) {
    return PUBLIC_SIDE_REFRESH_MS;
  }
  return SIDE_REFRESH_MS;
}

function depthRowToTuple(row: unknown): [number, number] | null {
  if (!Array.isArray(row)) {
    return null;
  }
  const price = toNumber(row[0], 0);
  const size = toNumber(row[1], 0);
  if (price <= 0) {
    return null;
  }
  return [price, Math.max(0, size)];
}

function mapToDepthRows(sideMap: Map<string, number>, side: "bid" | "ask"): Array<[number, number]> {
  return [...sideMap.entries()]
    .map(([price, size]) => [toNumber(price, 0), size] as [number, number])
    .filter(([price, size]) => price > 0 && size > 0)
    .sort((left, right) => (side === "bid" ? right[0] - left[0] : left[0] - right[0]));
}

function mergeDepthDelta(currentDepth: JsonMap | null, deltaPayload: JsonMap): JsonMap {
  const currentPayload = ((currentDepth?.depth_payload as JsonMap | undefined) || {});
  const bidsMap = new Map<string, number>();
  const asksMap = new Map<string, number>();

  const seedSide = (rows: unknown, sideMap: Map<string, number>) => {
    if (!Array.isArray(rows)) {
      return;
    }
    for (const row of rows) {
      const parsed = depthRowToTuple(row);
      if (!parsed) {
        continue;
      }
      const [price, size] = parsed;
      sideMap.set(price.toFixed(8), size);
    }
  };

  seedSide(currentPayload.bids, bidsMap);
  seedSide(currentPayload.asks, asksMap);

  const applySide = (rows: unknown, sideMap: Map<string, number>) => {
    if (!Array.isArray(rows)) {
      return;
    }
    for (const row of rows) {
      const parsed = depthRowToTuple(row);
      if (!parsed) {
        continue;
      }
      const [price, size] = parsed;
      const key = price.toFixed(8);
      if (size <= 0) {
        sideMap.delete(key);
      } else {
        sideMap.set(key, size);
      }
    }
  };

  applySide(deltaPayload.bids, bidsMap);
  applySide(deltaPayload.asks, asksMap);

  const bids = mapToDepthRows(bidsMap, "bid");
  const asks = mapToDepthRows(asksMap, "ask");
  const bestBid = bids.length > 0 ? toNumber(bids[0][0], 0) : 0;
  const bestAsk = asks.length > 0 ? toNumber(asks[0][0], 0) : 0;
  const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
  const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10_000 : 0;
  const eventTime = toNumber(deltaPayload.event_time, Date.now());

  return {
    ...(currentDepth || {}),
    venue: String(deltaPayload.venue || currentDepth?.venue || "binance-public"),
    instrument: String(deltaPayload.instrument || currentDepth?.instrument || "UNKNOWN"),
    snapshot_at: new Date(eventTime).toISOString(),
    best_bid: bestBid,
    best_ask: bestAsk,
    spread_bps: spreadBps,
    depth_payload: {
      bids,
      asks,
      lastUpdateId: toNumber(deltaPayload.update_id, toNumber((currentPayload as JsonMap).lastUpdateId, 0)),
      event_time: eventTime,
      reason: "ws-delta",
    },
    source: "depth-ws-delta",
  };
}

function hasUsableSnapshotData(payload: JsonMap): boolean {
  const health = payload.meta && typeof payload.meta === "object"
    ? (payload.meta as JsonMap).health
    : null;
  const status = health && typeof health === "object"
    ? String((health as JsonMap).status || "")
    : "";
  const hasOhlcvRows = Array.isArray(payload.ohlcv_rows) && payload.ohlcv_rows.length > 0;
  const hasDepthSnapshot = Boolean(payload.depth_snapshot && typeof payload.depth_snapshot === "object");
  const hasTrades = Array.isArray(payload.trades) && payload.trades.length > 0;
  const hasMicro = Boolean(payload.microstructure && typeof payload.microstructure === "object");

  if (status !== "degraded") {
    return hasOhlcvRows || hasDepthSnapshot || hasTrades || hasMicro;
  }

  return hasOhlcvRows || hasDepthSnapshot;
}

class MarketDataBus {
  private listeners = new Set<MarketDataBusListener>();
  private snapshot: MarketDataBusSnapshot = {
    configKey: "",
    ohlcvBars: [],
    nativeTrades: [],
    marketMicro: null,
    sessionState: null,
    orderbook: null,
    marketDepth: null,
    routingScore: null,
    busMeta: null,
    chartLoading: false,
    ohlcvStreamState: "offline",
    depthStreamState: "offline",
    lastSyncAt: null,
  };
  private config: MarketDataBusConfig | null = null;
  // ── MarketDataEngine V5 : pipeline unifié (candles + microstructure + gaps) ──
  private engine: MarketDataEngineV5 | null = null;
  private pendingGaps: GapRange[] = [];
  private sideRefreshTimer: number | null = null;
  private sideFetchController: AbortController | null = null;
  private sideFetchConfigKey = "";
  private ohlcvSocket: WebSocket | null = null;
  private ohlcvReconnectTimer: number | null = null;
  private ohlcvPingTimer: number | null = null;
  private depthSocket: WebSocket | null = null;
  private depthReconnectTimer: number | null = null;
  private depthPingTimer: number | null = null;
  private snapshotFailureCooldownUntil = 0;
  private streamFailureCount: Record<StreamKind, number> = { ohlcv: 0, depth: 0 };
  private streamCooldownUntil: Record<StreamKind, number> = { ohlcv: 0, depth: 0 };

  subscribe(listener: MarketDataBusListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  connect(config: MarketDataBusConfig): void {
    const nextKey = `${config.instrument}|${config.venue}|${config.timeframe}`;
    if (this.snapshot.configKey === nextKey) {
      return;
    }

    this.disconnectSockets();
    this.config = config;
    // Engine V5 : pipeline unifié (candles depuis trades + microstructure)
    this.engine = new MarketDataEngineV5(config.timeframe, config.instrument, config.venue);
    // Backfill callback : V5 nous notifie quand des gaps sont détectés
    this.engine.onGapDetected((startMs, endMs) => {
      this.pendingGaps.push({ startMs, endMs, missingSlots: 0 });
    });
    // Engine V4 : nouveau singleton par config (repart de zéro sur chaque changement)
    // (engine V4 est intégré dans V5, plus besoin de variable séparée)
    this.snapshot = {
      ...this.snapshot,
      configKey: nextKey,
      ohlcvBars: [],
      nativeTrades: [],
      marketMicro: null,
      sessionState: null,
      orderbook: null,
      marketDepth: null,
      routingScore: null,
      busMeta: null,
      chartLoading: true,
      ohlcvStreamState: "connecting",
      depthStreamState: "connecting",
      lastSyncAt: null,
    };
    this.emit();
    this.connectOhlcvSocket();
    this.connectDepthSocket();
    void this.refreshNow("ai");
  }

  disconnect(): void {
    this.disconnectSockets();
    this.config = null;
    this.engine = null;
    this.pendingGaps = [];
    this.snapshot = {
      ...this.snapshot,
      configKey: "",
      ohlcvBars: [],
      nativeTrades: [],
      marketMicro: null,
      sessionState: null,
      orderbook: null,
      marketDepth: null,
      routingScore: null,
      busMeta: null,
      chartLoading: false,
      ohlcvStreamState: "offline",
      depthStreamState: "offline",
      lastSyncAt: null,
    };
    this.emit();
  }

  async refreshNow(requestType: MarketBusRequestType = "ai"): Promise<void> {
    const config = this.config;
    if (!config) {
      return;
    }

    const sideFetchConfigKey = `${config.instrument}|${config.venue}|${config.timeframe}`;
    if (this.sideFetchController && this.sideFetchConfigKey === sideFetchConfigKey) {
      return;
    }

    if (Date.now() < this.snapshotFailureCooldownUntil) {
      this.scheduleSideRefresh(Math.max(5_000, this.snapshotFailureCooldownUntil - Date.now()));
      return;
    }

    if (this.sideFetchController) {
      this.sideFetchController.abort();
    }
    const controller = new AbortController();
    this.sideFetchController = controller;
    this.sideFetchConfigKey = sideFetchConfigKey;

    const releaseSideFetch = () => {
      if (this.sideFetchController === controller) {
        this.sideFetchController = null;
        this.sideFetchConfigKey = "";
      }
    };

    const { instrument, venue } = config;
    const headers = buildRequestHeaders(requestType, instrument);
    const snapshotResponse = await fetch(`/api/market/bus/snapshot?instrument=${encodeURIComponent(instrument)}&venue=${encodeURIComponent(venue)}&timeframe=${encodeURIComponent(config.timeframe)}&lookback_minutes=60&trade_limit=200`, {
      cache: "no-store",
      signal: controller.signal,
      headers,
    }).then(async (response) => ({
      ok: response.ok,
      status: response.status,
      payload: response.ok ? await response.json() : null,
    })).catch(() => ({ ok: false, status: 0, payload: null as unknown }));

    if (controller.signal.aborted || this.config?.instrument !== instrument || this.config?.timeframe !== config.timeframe || this.config?.venue !== venue) {
      releaseSideFetch();
      return;
    }

    let payload = snapshotResponse.payload;
    const snapshotPayload = payload && typeof payload === "object" ? payload as JsonMap : {};
    const snapshotHasBars = Array.isArray(snapshotPayload.ohlcv_rows) && snapshotPayload.ohlcv_rows.length > 0;
    const snapshotHasDepth = Boolean(
      (snapshotPayload.depth_snapshot && typeof snapshotPayload.depth_snapshot === "object")
      || (snapshotPayload.orderbook && typeof snapshotPayload.orderbook === "object"),
    );
    const needsBarsFallback = !snapshotHasBars;
    const needsDepthFallback = !snapshotHasDepth;
    const shouldFetchSideFallbacks = !snapshotResponse.ok || !hasUsableSnapshotData(snapshotPayload) || needsBarsFallback || needsDepthFallback;

    if (shouldFetchSideFallbacks) {
      const [ohlcvPayload, depthPayload] = await Promise.all([
        needsBarsFallback
          ? fetch(`/api/market/ohlcv?instrument=${encodeURIComponent(instrument)}&venue=${encodeURIComponent(venue)}&timeframe=${encodeURIComponent(config.timeframe)}&limit=500`, {
            cache: "no-store",
            signal: controller.signal,
            headers,
          }).then((response) => (response.ok ? response.json() : null)).catch(() => null)
          : Promise.resolve(null),
        needsDepthFallback
          ? fetch(`/api/market/orderbook/depth?instrument=${encodeURIComponent(instrument)}&venue=${encodeURIComponent(venue)}`, {
            cache: "no-store",
            signal: controller.signal,
            headers,
          }).then((response) => (response.ok ? response.json() : null)).catch(() => null)
          : Promise.resolve(null),
      ]);

      const existingHealth = (snapshotPayload.meta && typeof snapshotPayload.meta === "object"
        ? (snapshotPayload.meta as JsonMap).health
        : null) as JsonMap | null;

      payload = {
        ...snapshotPayload,
        orderbook: snapshotPayload.orderbook || (depthPayload && typeof depthPayload === "object" ? depthPayload : null),
        meta: {
          ...((snapshotPayload.meta && typeof snapshotPayload.meta === "object") ? snapshotPayload.meta : {}),
          health: {
            ...((existingHealth && typeof existingHealth === "object") ? existingHealth : {}),
            status: snapshotResponse.ok ? String((((snapshotPayload.meta as JsonMap | undefined)?.health as JsonMap | undefined)?.status) || "degraded") : "degraded",
            reason: snapshotResponse.ok
              ? String((((snapshotPayload.meta as JsonMap | undefined)?.health as JsonMap | undefined)?.reason) || "snapshot_partial_payload")
              : (snapshotResponse.status === 404 ? "snapshot_route_unavailable" : "snapshot_unavailable"),
          },
        },
        as_of: typeof snapshotPayload.as_of === "string" ? snapshotPayload.as_of : new Date().toISOString(),
        ohlcv_rows: Array.isArray(snapshotPayload.ohlcv_rows) && snapshotPayload.ohlcv_rows.length > 0
          ? snapshotPayload.ohlcv_rows
          : (Array.isArray(ohlcvPayload) ? ohlcvPayload : []),
        depth_snapshot: snapshotPayload.depth_snapshot && typeof snapshotPayload.depth_snapshot === "object"
          ? snapshotPayload.depth_snapshot
          : (depthPayload && typeof depthPayload === "object" ? depthPayload : null),
      };

      this.snapshotFailureCooldownUntil = snapshotResponse.ok ? 0 : Date.now() + SNAPSHOT_RETRY_COOLDOWN_MS;
    } else {
      this.snapshotFailureCooldownUntil = 0;
    }

    const busPayload = payload && typeof payload === "object" ? payload as JsonMap : {};
    const fallbackBars = normalizeOhlcvRows(Array.isArray(busPayload.ohlcv_rows) ? busPayload.ohlcv_rows : []);
    const rawTrades = Array.isArray(busPayload.trades) ? busPayload.trades as JsonMap[] : [];
    // Engine V5 : bootstrap complet (OHLCV + trades REST → prebuild avant render)
    if (this.engine) {
      const v5Trades = rawTrades.map((t) => ({
        price: Number(t.p ?? t.price ?? 0),
        size: Number(t.q ?? t.size ?? t.qty ?? 0),
        side: String(t.side || "") || (t.m === true ? "sell" : "buy"),
        tsMs: Number(t.T ?? t.ts ?? t.tsMs ?? Date.now()),
        exchangeTs: Number(t.T ?? t.ts ?? 0) || undefined,
      }));
      this.engine.bootstrap({ ohlcvBars: fallbackBars, trades: v5Trades });
      // Sync latency offset depuis V4
      this.engine.syncLatencyFromV4();
    }
    const canonicalBars = this.engine ? this.engine.getSeries() : fallbackBars;
    const fallbackDepth = busPayload.depth_snapshot && typeof busPayload.depth_snapshot === "object"
      ? busPayload.depth_snapshot as JsonMap
      : null;
    const hasFallbackBars = fallbackBars.length > 0;
    const hasFallbackDepth = fallbackDepth !== null || ((busPayload.orderbook as JsonMap | null | undefined) || null) !== null;

    this.snapshot = {
      ...this.snapshot,
      ohlcvBars: canonicalBars.length > 0 ? canonicalBars : this.snapshot.ohlcvBars,
      nativeTrades: rawTrades,
      marketMicro: this._enrichMicroV5(
        (busPayload.microstructure as JsonMap | null | undefined) || null,
      ),
      sessionState: (busPayload.session_state as JsonMap | null | undefined) || null,
      orderbook: (busPayload.orderbook as JsonMap | null | undefined) || null,
      marketDepth: fallbackDepth || this.snapshot.marketDepth,
      routingScore: (busPayload.routing_score as JsonMap | null | undefined) || null,
      busMeta: (busPayload.meta as JsonMap | null | undefined) || null,
      chartLoading: hasFallbackBars ? false : this.snapshot.chartLoading,
      ohlcvStreamState: this.snapshot.ohlcvStreamState === "live" || hasFallbackBars ? "live" : this.snapshot.ohlcvStreamState,
      depthStreamState: this.snapshot.depthStreamState === "live" || hasFallbackDepth ? "live" : this.snapshot.depthStreamState,
      lastSyncAt: typeof busPayload.as_of === "string" ? busPayload.as_of : new Date().toISOString(),
    };
    releaseSideFetch();
    this.emit();
    this.scheduleSideRefresh();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }

  /**
   * Injection d'un tick prix live (depuis quotes WS).
   * L'engine met à jour la bougie active et émet seulement si changed.
   */
  ingestPriceTick(price: number, tsMs?: number): void {
    if (!this.engine || !this.config) return;
    const ts = tsMs ?? Date.now();
    const changed = this.engine.ingestTick(price, ts, this.config.venue);
    if (changed) {
      this.snapshot = {
        ...this.snapshot,
        ohlcvBars: this.engine.getSeries(),
        marketMicro: this._enrichMicroV5(this.snapshot.marketMicro),
        lastSyncAt: new Date().toISOString(),
      };
      this.emit();
    }
  }

  // ── V5 Helpers ────────────────────────────────────────────────────────────

  private static _toDepthRows(arr: unknown): DepthRow[] {
    if (!Array.isArray(arr)) return [];
    return (arr as unknown[]).map((r) => {
      if (Array.isArray(r) && r.length >= 2) return [Number(r[0]), Number(r[1])] as DepthRow;
      return null;
    }).filter(Boolean) as DepthRow[];
  }

  /**
   * Injecte un snapshot de profondeur dans le moteur V5.
   */
  private _feedDepthToV5(depthPayload: JsonMap): void {
    if (!this.engine) return;
    const dp = depthPayload.depth_payload as JsonMap | undefined;
    const bids = MarketDataBus._toDepthRows((dp?.bids ?? depthPayload.bids));
    const asks = MarketDataBus._toDepthRows((dp?.asks ?? depthPayload.asks));
    this.engine.ingestDepthSnapshot(bids, asks);
  }

  /**
   * Applique un delta de profondeur dans le moteur V5.
   */
  private _feedDepthDeltaToV5(deltaPayload: JsonMap): void {
    if (!this.engine) return;
    this.engine.ingestDepth({
      bids: MarketDataBus._toDepthRows(deltaPayload.bids),
      asks: MarketDataBus._toDepthRows(deltaPayload.asks),
    });
  }

  /**
   * Enrichit marketMicro avec les données calculées par V5 (microstructure + flow score).
   * Les champs backend restent prioritaires ; V5 ajoute/complète.
   */
  private _enrichMicroV5(baseMicro: JsonMap | null): JsonMap | null {
    if (!this.engine) return baseMicro;

    const snap = this.engine.getMicrostructure();
    const flow = this.engine.getFlowScore();

    const v5Extra: JsonMap = {
      depth_imbalance: snap.depthImbalance,
      bid_volume: snap.bidVolume,
      ask_volume: snap.askVolume,
      spread_bps: snap.spreadBps,
      best_bid: snap.bestBid,
      best_ask: snap.bestAsk,
      cvd: snap.cvd,
      cvd_delta: snap.cvdDelta,
      cvd_trend: snap.cvdTrend,
      buy_volume_30s: snap.buyVolume30s,
      sell_volume_30s: snap.sellVolume30s,
      flow_imbalance: snap.flowImbalance,
      trade_aggressiveness: snap.tradeAggressiveness,
      best_venue: snap.bestVenue,
      vwap_price: snap.vwapPrice,
      price_deviation_bps: snap.priceDeviation,
      avg_latency_ms: snap.avgLatencyMs,
      max_latency_ms: snap.maxLatencyMs,
      latency_tier: snap.latencyTier,
      active_events: snap.activeEvents as unknown as JsonMap[],
      last_event_ts: snap.lastEventTs,
      // V5 flow score (unifié)
      flow_score: flow.score,
      flow_direction: flow.direction,
      v5_stable: this.engine.isStable(),
      v5_gap_count: this.engine.getGaps().length,
      v5_latency_offset_ms: this.engine.getLatencyOffset(),
    };

    if (baseMicro) {
      const merged: JsonMap = { ...v5Extra };
      for (const [k, v] of Object.entries(baseMicro)) {
        if (v !== null && v !== undefined) merged[k] = v;
      }
      return merged;
    }
    return v5Extra;
  }

  private scheduleSideRefresh(delayMs = resolveSideRefreshMs()): void {
    if (this.sideRefreshTimer !== null) {
      window.clearTimeout(this.sideRefreshTimer);
    }
    this.sideRefreshTimer = window.setTimeout(() => {
      void this.refreshNow("ai");
    }, delayMs);
  }

  private isStreamCoolingDown(kind: StreamKind): boolean {
    return Date.now() < this.streamCooldownUntil[kind];
  }

  private resetStreamFailures(kind: StreamKind): void {
    this.streamFailureCount[kind] = 0;
    this.streamCooldownUntil[kind] = 0;
  }

  private registerStreamFailure(kind: StreamKind): void {
    this.streamFailureCount[kind] += 1;
    if (this.streamFailureCount[kind] >= STREAM_FAILURE_THRESHOLD) {
      this.streamCooldownUntil[kind] = Date.now() + STREAM_FAILURE_COOLDOWN_MS;
    }
  }

  private disconnectSockets(): void {
    if (this.sideRefreshTimer !== null) {
      window.clearTimeout(this.sideRefreshTimer);
      this.sideRefreshTimer = null;
    }
    if (this.sideFetchController) {
      this.sideFetchController.abort();
      this.sideFetchController = null;
    }
    this.sideFetchConfigKey = "";
    if (this.ohlcvReconnectTimer !== null) {
      window.clearTimeout(this.ohlcvReconnectTimer);
      this.ohlcvReconnectTimer = null;
    }
    if (this.ohlcvPingTimer !== null) {
      window.clearInterval(this.ohlcvPingTimer);
      this.ohlcvPingTimer = null;
    }
    this.ohlcvSocket?.close();
    this.ohlcvSocket = null;
    if (this.depthReconnectTimer !== null) {
      window.clearTimeout(this.depthReconnectTimer);
      this.depthReconnectTimer = null;
    }
    if (this.depthPingTimer !== null) {
      window.clearInterval(this.depthPingTimer);
      this.depthPingTimer = null;
    }
    this.depthSocket?.close();
    this.depthSocket = null;
  }

  private connectOhlcvSocket(): void {
    const config = this.config;
    if (!config) {
      return;
    }
    if (this.isStreamCoolingDown("ohlcv")) {
      this.snapshot = { ...this.snapshot, ohlcvStreamState: "offline", chartLoading: false };
      this.emit();
      void this.refreshNow("execution");
      this.ohlcvReconnectTimer = window.setTimeout(() => {
        if (this.config) {
          this.connectOhlcvSocket();
        }
      }, Math.max(5_000, this.streamCooldownUntil.ohlcv - Date.now()));
      return;
    }
    const wsUrl = buildMarketOhlcvWsUrl(config.instrument, config.venue, config.timeframe);
    if (!wsUrl) {
      this.snapshot = { ...this.snapshot, ohlcvStreamState: "offline", chartLoading: false };
      this.emit();
      return;
    }

    this.snapshot = { ...this.snapshot, ohlcvStreamState: "connecting", chartLoading: true };
    this.emit();
    const socket = new WebSocket(wsUrl);
    this.ohlcvSocket = socket;
    let opened = false;
    let failureRecorded = false;

    socket.onopen = () => {
      opened = true;
      this.resetStreamFailures("ohlcv");
      this.snapshot = { ...this.snapshot, ohlcvStreamState: "live" };
      this.emit();
      this.ohlcvPingTimer = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send("ping");
        }
      }, 20_000);
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data || "{}")) as JsonMap;
        if (!payload || typeof payload !== "object") {
          return;
        }
        const items = normalizeOhlcvRows(payload.items);
        if (payload.type === "snapshot") {
          // Engine V5 : snapshot WS (remplace la série entière)
          if (this.engine) {
            for (const item of items) this.engine.ingestWsBar(item);
          }
          const series = this.engine ? this.engine.getSeries() : items;
          this.snapshot = {
            ...this.snapshot,
            ohlcvBars: series,
            chartLoading: false,
            lastSyncAt: typeof payload.as_of === "string" ? payload.as_of : new Date().toISOString(),
          };
          this.emit();
          return;
        }
        if (payload.type === "update") {
          // Engine V5 : mise à jour incrémentale
          if (this.engine) {
            for (const item of items) this.engine.ingestWsBar(item);
            this.snapshot = {
              ...this.snapshot,
              ohlcvBars: this.engine.getSeries(),
              chartLoading: false,
              lastSyncAt: new Date().toISOString(),
            };
          } else {
            const nextMap = new Map(this.snapshot.ohlcvBars.map((bar) => [bar.t, bar]));
            for (const item of items) {
              nextMap.set(item.t, item);
            }
            this.snapshot = {
              ...this.snapshot,
              ohlcvBars: [...nextMap.values()].sort((left, right) => {
                const leftTs = Date.parse(left.t);
                const rightTs = Date.parse(right.t);
                if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) {
                  return leftTs - rightTs;
                }
                return left.seq - right.seq;
              }),
              chartLoading: false,
              lastSyncAt: new Date().toISOString(),
            };
          }
          this.emit();
        }
      } catch {
        // Ignore malformed websocket frames.
      }
    };

    socket.onerror = () => {
      if (!opened && !failureRecorded) {
        failureRecorded = true;
        this.registerStreamFailure("ohlcv");
      }
      this.snapshot = { ...this.snapshot, ohlcvStreamState: "offline", chartLoading: false };
      this.emit();
    };

    socket.onclose = () => {
      if (this.ohlcvPingTimer !== null) {
        window.clearInterval(this.ohlcvPingTimer);
        this.ohlcvPingTimer = null;
      }
      if (this.ohlcvSocket !== socket) {
        return;
      }
      if (!opened && !failureRecorded) {
        failureRecorded = true;
        this.registerStreamFailure("ohlcv");
      }
      this.snapshot = { ...this.snapshot, ohlcvStreamState: "offline", chartLoading: false };
      this.emit();
      this.ohlcvReconnectTimer = window.setTimeout(() => {
        if (this.config) {
          this.connectOhlcvSocket();
        }
      }, 2500);
    };
  }

  private connectDepthSocket(): void {
    const config = this.config;
    if (!config) {
      return;
    }
    if (this.isStreamCoolingDown("depth")) {
      this.snapshot = { ...this.snapshot, depthStreamState: "offline" };
      this.emit();
      void this.refreshNow("execution");
      this.depthReconnectTimer = window.setTimeout(() => {
        if (this.config) {
          this.connectDepthSocket();
        }
      }, Math.max(5_000, this.streamCooldownUntil.depth - Date.now()));
      return;
    }
    const wsUrl = buildMarketDepthWsUrl(config.instrument, config.venue);
    if (!wsUrl) {
      this.snapshot = { ...this.snapshot, depthStreamState: "offline" };
      this.emit();
      return;
    }

    this.snapshot = { ...this.snapshot, depthStreamState: "connecting" };
    this.emit();
    const socket = new WebSocket(wsUrl);
    this.depthSocket = socket;
    let opened = false;
    let failureRecorded = false;

    socket.onopen = () => {
      opened = true;
      this.resetStreamFailures("depth");
      this.snapshot = { ...this.snapshot, depthStreamState: "live" };
      this.emit();
      this.depthPingTimer = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send("ping");
        }
      }, 20_000);
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data || "{}")) as JsonMap;
        if (!payload || typeof payload !== "object") {
          return;
        }
        if (payload.type === "snapshot") {
          this.snapshot = { ...this.snapshot, marketDepth: payload };
          this._feedDepthToV5(payload);
          this.snapshot = { ...this.snapshot, marketMicro: this._enrichMicroV5(this.snapshot.marketMicro) };
          this.emit();
          return;
        }
        if (payload.type === "delta") {
          const merged = mergeDepthDelta(this.snapshot.marketDepth, payload);
          this.snapshot = { ...this.snapshot, marketDepth: merged };
          this._feedDepthDeltaToV5(payload);
          this.snapshot = { ...this.snapshot, marketMicro: this._enrichMicroV5(this.snapshot.marketMicro) };
          this.emit();
        }
      } catch {
        // Ignore malformed websocket frames.
      }
    };

    socket.onerror = () => {
      if (!opened && !failureRecorded) {
        failureRecorded = true;
        this.registerStreamFailure("depth");
      }
      this.snapshot = { ...this.snapshot, depthStreamState: "offline" };
      this.emit();
    };

    socket.onclose = () => {
      if (this.depthPingTimer !== null) {
        window.clearInterval(this.depthPingTimer);
        this.depthPingTimer = null;
      }
      if (this.depthSocket !== socket) {
        return;
      }
      if (!opened && !failureRecorded) {
        failureRecorded = true;
        this.registerStreamFailure("depth");
      }
      this.snapshot = { ...this.snapshot, depthStreamState: "offline" };
      this.emit();
      this.depthReconnectTimer = window.setTimeout(() => {
        if (this.config) {
          this.connectDepthSocket();
        }
      }, 2500);
    };
  }
}

export function createMarketDataBus(): {
  subscribe: (listener: MarketDataBusListener) => () => void;
  connect: (config: MarketDataBusConfig) => void;
  disconnect: () => void;
  refreshNow: (requestType?: MarketBusRequestType) => Promise<void>;
  ingestPriceTick: (price: number, tsMs?: number) => void;
} {
  const bus = new MarketDataBus();
  return {
    subscribe: (listener) => bus.subscribe(listener),
    connect: (config) => bus.connect(config),
    disconnect: () => bus.disconnect(),
    refreshNow: (requestType) => bus.refreshNow(requestType),
    ingestPriceTick: (price, tsMs) => bus.ingestPriceTick(price, tsMs),
  };
}