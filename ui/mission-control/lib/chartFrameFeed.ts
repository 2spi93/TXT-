export type LiveChartCandle = {
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type LiveChartFrameTruth = {
  integrity_status: "clean" | "degraded" | "invalid";
  sync_status: "live" | "delayed" | "stale" | "resumed" | "unknown";
  freshness: "fresh" | "aging" | "stale" | "unknown";
  reconstruction_flag: "none" | "reconstructed" | "observer_resumed" | "source_gap";
  confidence: number;
  tradable: boolean;
  decision_allowed: boolean;
  reasons: string[];
};

export type LiveChartFrameMeta = {
  syncStatus: "atomic" | "loose-sync" | "coalesced";
  partial: boolean;
  coalesced: boolean;
  confidence: number;
  dynamicBufferMs: number;
  stallAgeMs: number;
  depthSequence: number | null;
  depthEventTs: number | null;
  tradeEventTs: number | null;
  batchSkewMs?: number | null;
  batchPublishedAt?: number | null;
  batchFrameCount?: number | null;
  viewportUpdatedAt?: number | null;
  observerSessionId?: string | null;
  observerStartedAt?: string | null;
  observerUptimeMs?: number | null;
  observerResetCount?: number;
  observerLastResetReason?: string | null;
  observerLastResetAt?: string | null;
  observationGapMs?: number | null;
  observationContinuity?: "continuous" | "resumed" | "unknown";
  sourceAgeMs?: number | null;
  sourceFreshness?: "fresh" | "stale" | "unknown";
  reconstructionReason?: string | null;
  truth?: LiveChartFrameTruth;
};

export type LiveChartFrame = {
  feedKey: string;
  candles: LiveChartCandle[];
  publishedAt: number;
  signature: string;
  meta: LiveChartFrameMeta;
};

export type LiveChartFrameBatch = {
  batchKey: string;
  publishedAt: number;
  frames: LiveChartFrame[];
};

export type ChartFramePublishOutcome = "published" | "rejected-invalid-feed-key" | "rejected-empty" | "rejected-duplicate";

export type ChartFramePublishResult = {
  feedKey: string;
  requestedAt: number;
  publishedAt: number | null;
  outcome: ChartFramePublishOutcome;
  reason: string | null;
  candleCount: number;
  signature: string | null;
  previousSignature: string | null;
  requestedCount: number;
  publishedCount: number;
  rejectedCount: number;
  meta: Pick<LiveChartFrameMeta, "syncStatus" | "partial" | "coalesced" | "confidence"> | null;
};

type LiveChartFrameListener = (frame: LiveChartFrame) => void;
type LiveChartFrameBatchListener = (batch: LiveChartFrameBatch) => void;

const frameListeners = new Map<string, Set<LiveChartFrameListener>>();
const batchListeners = new Set<LiveChartFrameBatchListener>();
const latestFrames = new Map<string, LiveChartFrame>();
const latestPublishResults = new Map<string, ChartFramePublishResult>();
const publishCounters = new Map<string, { requested: number; published: number; rejected: number }>();
let latestBatch: LiveChartFrameBatch | null = null;

function nextPublishCounters(feedKey: string): { requested: number; published: number; rejected: number } {
  const previous = publishCounters.get(feedKey) || { requested: 0, published: 0, rejected: 0 };
  const next = {
    requested: previous.requested + 1,
    published: previous.published,
    rejected: previous.rejected,
  };
  publishCounters.set(feedKey, next);
  return next;
}

function storePublishResult(result: ChartFramePublishResult): ChartFramePublishResult {
  if (result.feedKey) {
    latestPublishResults.set(result.feedKey, result);
  }
  return result;
}

function normalizeFrameTruth(truth?: Partial<LiveChartFrameTruth>): LiveChartFrameTruth {
  const integrityStatus = truth?.integrity_status === "clean" || truth?.integrity_status === "degraded" || truth?.integrity_status === "invalid"
    ? truth.integrity_status
    : "degraded";
  const syncStatus = truth?.sync_status === "live" || truth?.sync_status === "delayed" || truth?.sync_status === "stale" || truth?.sync_status === "resumed" || truth?.sync_status === "unknown"
    ? truth.sync_status
    : "unknown";
  const freshness = truth?.freshness === "fresh" || truth?.freshness === "aging" || truth?.freshness === "stale" || truth?.freshness === "unknown"
    ? truth.freshness
    : "unknown";
  const reconstructionFlag = truth?.reconstruction_flag === "none" || truth?.reconstruction_flag === "reconstructed" || truth?.reconstruction_flag === "observer_resumed" || truth?.reconstruction_flag === "source_gap"
    ? truth.reconstruction_flag
    : "none";
  const confidence = Number.isFinite(truth?.confidence) ? Math.max(0, Math.min(1, Number(truth?.confidence))) : 0;
  const reasons = Array.isArray(truth?.reasons)
    ? truth.reasons.map((reason) => String(reason || "").trim()).filter(Boolean).slice(0, 12)
    : [];
  return {
    integrity_status: integrityStatus,
    sync_status: syncStatus,
    freshness,
    reconstruction_flag: reconstructionFlag,
    confidence,
    tradable: Boolean(truth?.tradable),
    decision_allowed: Boolean(truth?.decision_allowed),
    reasons,
  };
}

function normalizeFrameMeta(meta?: Partial<LiveChartFrameMeta>): LiveChartFrameMeta {
  return {
    syncStatus: meta?.syncStatus === "loose-sync" || meta?.syncStatus === "coalesced" ? meta.syncStatus : "atomic",
    partial: Boolean(meta?.partial),
    coalesced: Boolean(meta?.coalesced),
    confidence: Number.isFinite(meta?.confidence) ? Math.max(0, Math.min(1, Number(meta?.confidence))) : 1,
    dynamicBufferMs: Number.isFinite(meta?.dynamicBufferMs) ? Math.max(0, Math.round(Number(meta?.dynamicBufferMs))) : 50,
    stallAgeMs: Number.isFinite(meta?.stallAgeMs) ? Math.max(0, Math.round(Number(meta?.stallAgeMs))) : 0,
    depthSequence: Number.isFinite(meta?.depthSequence) ? Number(meta?.depthSequence) : null,
    depthEventTs: Number.isFinite(meta?.depthEventTs) ? Number(meta?.depthEventTs) : null,
    tradeEventTs: Number.isFinite(meta?.tradeEventTs) ? Number(meta?.tradeEventTs) : null,
    batchSkewMs: Number.isFinite(meta?.batchSkewMs) ? Math.max(0, Math.round(Number(meta?.batchSkewMs))) : null,
    batchPublishedAt: Number.isFinite(meta?.batchPublishedAt) ? Number(meta?.batchPublishedAt) : null,
    batchFrameCount: Number.isFinite(meta?.batchFrameCount) ? Math.max(1, Math.round(Number(meta?.batchFrameCount))) : null,
    viewportUpdatedAt: Number.isFinite(meta?.viewportUpdatedAt) ? Number(meta?.viewportUpdatedAt) : null,
    observerSessionId: typeof meta?.observerSessionId === "string" && meta.observerSessionId.trim() ? meta.observerSessionId.trim() : null,
    observerStartedAt: typeof meta?.observerStartedAt === "string" && meta.observerStartedAt.trim() ? meta.observerStartedAt.trim() : null,
    observerUptimeMs: Number.isFinite(meta?.observerUptimeMs) ? Math.max(0, Math.round(Number(meta?.observerUptimeMs))) : null,
    observerResetCount: Number.isFinite(meta?.observerResetCount) ? Math.max(0, Math.round(Number(meta?.observerResetCount))) : 0,
    observerLastResetReason: typeof meta?.observerLastResetReason === "string" && meta.observerLastResetReason.trim() ? meta.observerLastResetReason.trim() : null,
    observerLastResetAt: typeof meta?.observerLastResetAt === "string" && meta.observerLastResetAt.trim() ? meta.observerLastResetAt.trim() : null,
    observationGapMs: Number.isFinite(meta?.observationGapMs) ? Math.max(0, Math.round(Number(meta?.observationGapMs))) : null,
    observationContinuity: meta?.observationContinuity === "continuous" || meta?.observationContinuity === "resumed" ? meta.observationContinuity : "unknown",
    sourceAgeMs: Number.isFinite(meta?.sourceAgeMs) ? Math.max(0, Math.round(Number(meta?.sourceAgeMs))) : null,
    sourceFreshness: meta?.sourceFreshness === "fresh" || meta?.sourceFreshness === "stale" ? meta.sourceFreshness : "unknown",
    reconstructionReason: typeof meta?.reconstructionReason === "string" && meta.reconstructionReason.trim() ? meta.reconstructionReason.trim() : null,
    truth: normalizeFrameTruth(meta?.truth),
  };
}

function cloneCandleSnapshot(candles: LiveChartCandle[]): LiveChartCandle[] {
  const next: LiveChartCandle[] = [];
  for (const candle of candles) {
    if (!candle) {
      continue;
    }
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const volume = Number(candle.volume);
    if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close) || !Number.isFinite(volume)) {
      continue;
    }
    next.push({
      label: String(candle.label || ""),
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume,
    });
  }
  return next;
}

function buildFrameSnapshot(feedKey: string, candles: LiveChartCandle[], publishedAt: number, meta: LiveChartFrameMeta): LiveChartFrame {
  const candleSnapshot = cloneCandleSnapshot(candles);
  const metaSnapshot = normalizeFrameMeta(meta);
  return {
    feedKey,
    candles: candleSnapshot,
    publishedAt,
    signature: frameSignature(candleSnapshot, metaSnapshot),
    meta: metaSnapshot,
  };
}

function cloneFrameFromLatest(feedKey: string): LiveChartFrame | null {
  const latest = latestFrames.get(feedKey);
  if (!latest) {
    return null;
  }
  return buildFrameSnapshot(latest.feedKey, latest.candles, latest.publishedAt, latest.meta);
}

function frameSignature(candles: LiveChartCandle[], meta: LiveChartFrameMeta): string {
  const last = candles[candles.length - 1];
  if (!last) {
    return ["0", meta.syncStatus, meta.partial ? "p1" : "p0", meta.coalesced ? "c1" : "c0"].join("|");
  }
  return [
    candles.length,
    last.label,
    last.open.toFixed(8),
    last.high.toFixed(8),
    last.low.toFixed(8),
    last.close.toFixed(8),
    last.volume.toFixed(8),
    meta.syncStatus,
    meta.partial ? "p1" : "p0",
    meta.coalesced ? "c1" : "c0",
    meta.confidence.toFixed(3),
    meta.dynamicBufferMs,
    meta.depthSequence ?? "-",
    meta.batchSkewMs ?? "-",
    meta.batchFrameCount ?? "-",
    meta.observerResetCount ?? 0,
    meta.observationContinuity ?? "unknown",
    meta.sourceFreshness ?? "unknown",
    meta.truth?.integrity_status ?? "degraded",
    meta.truth?.sync_status ?? "unknown",
    meta.truth?.freshness ?? "unknown",
    meta.truth?.reconstruction_flag ?? "none",
    meta.truth?.tradable ? "t1" : "t0",
    meta.truth?.decision_allowed ? "d1" : "d0",
    meta.truth?.confidence.toFixed(3) ?? "0.000",
  ].join("|");
}

export function publishChartFrame(feedKey: string, candles: LiveChartCandle[], meta?: Partial<LiveChartFrameMeta>): ChartFramePublishResult {
  const requestedAt = Date.now();
  if (!feedKey) {
    return {
      feedKey: "",
      requestedAt,
      publishedAt: null,
      outcome: "rejected-invalid-feed-key",
      reason: "feed_key_missing",
      candleCount: Array.isArray(candles) ? candles.length : 0,
      signature: null,
      previousSignature: null,
      requestedCount: 0,
      publishedCount: 0,
      rejectedCount: 1,
      meta: null,
    };
  }
  const counters = nextPublishCounters(feedKey);
  const normalizedMeta = normalizeFrameMeta(meta);
  const frame = buildFrameSnapshot(feedKey, candles, requestedAt, normalizedMeta);
  if (frame.candles.length === 0) {
    const nextCounters = {
      requested: counters.requested,
      published: counters.published,
      rejected: counters.rejected + 1,
    };
    publishCounters.set(feedKey, nextCounters);
    return storePublishResult({
      feedKey,
      requestedAt,
      publishedAt: null,
      outcome: "rejected-empty",
      reason: "empty_candle_snapshot",
      candleCount: 0,
      signature: frame.signature,
      previousSignature: latestFrames.get(feedKey)?.signature || null,
      requestedCount: nextCounters.requested,
      publishedCount: nextCounters.published,
      rejectedCount: nextCounters.rejected,
      meta: {
        syncStatus: frame.meta.syncStatus,
        partial: frame.meta.partial,
        coalesced: frame.meta.coalesced,
        confidence: frame.meta.confidence,
      },
    });
  }
  const signature = frame.signature;
  const previous = latestFrames.get(feedKey);
  if (previous?.signature === signature) {
    const nextCounters = {
      requested: counters.requested,
      published: counters.published,
      rejected: counters.rejected + 1,
    };
    publishCounters.set(feedKey, nextCounters);
    return storePublishResult({
      feedKey,
      requestedAt,
      publishedAt: null,
      outcome: "rejected-duplicate",
      reason: "duplicate_signature",
      candleCount: frame.candles.length,
      signature,
      previousSignature: previous.signature,
      requestedCount: nextCounters.requested,
      publishedCount: nextCounters.published,
      rejectedCount: nextCounters.rejected,
      meta: {
        syncStatus: frame.meta.syncStatus,
        partial: frame.meta.partial,
        coalesced: frame.meta.coalesced,
        confidence: frame.meta.confidence,
      },
    });
  }
  latestFrames.set(feedKey, frame);
  const nextCounters = {
    requested: counters.requested,
    published: counters.published + 1,
    rejected: counters.rejected,
  };
  publishCounters.set(feedKey, nextCounters);
  const listeners = frameListeners.get(feedKey);
  const result = storePublishResult({
    feedKey,
    requestedAt,
    publishedAt: frame.publishedAt,
    outcome: "published",
    reason: null,
    candleCount: frame.candles.length,
    signature,
    previousSignature: previous?.signature || null,
    requestedCount: nextCounters.requested,
    publishedCount: nextCounters.published,
    rejectedCount: nextCounters.rejected,
    meta: {
      syncStatus: frame.meta.syncStatus,
      partial: frame.meta.partial,
      coalesced: frame.meta.coalesced,
      confidence: frame.meta.confidence,
    },
  });
  if (!listeners || listeners.size === 0) {
    return result;
  }
  for (const listener of listeners) {
    listener(frame);
  }
  return result;
}

export function subscribeChartFrame(feedKey: string, listener: LiveChartFrameListener): () => void {
  if (!feedKey) {
    return () => {};
  }
  const listeners = frameListeners.get(feedKey) || new Set<LiveChartFrameListener>();
  listeners.add(listener);
  frameListeners.set(feedKey, listeners);

  const latest = latestFrames.get(feedKey);
  if (latest) {
    listener(latest);
  }

  return () => {
    const active = frameListeners.get(feedKey);
    if (!active) {
      return;
    }
    active.delete(listener);
    if (active.size === 0) {
      frameListeners.delete(feedKey);
    }
  };
}

export function publishChartFrameBatch(batchKey: string, entries: Array<{ feedKey: string; candles: LiveChartCandle[]; meta?: Partial<LiveChartFrameMeta> }>): void {
  const normalizedKey = String(batchKey || "").trim() || `batch-${Date.now()}`;
  const publishedAt = Date.now();
  const frames: LiveChartFrame[] = [];
  for (const entry of entries) {
    if (!entry || !entry.feedKey) {
      continue;
    }
    publishChartFrame(entry.feedKey, entry.candles, {
      ...(entry.meta || {}),
      batchPublishedAt: publishedAt,
      batchFrameCount: entries.length,
    });
    const frame = cloneFrameFromLatest(entry.feedKey);
    if (frame) {
      frames.push(frame);
    }
  }
  latestBatch = {
    batchKey: normalizedKey,
    publishedAt,
    frames,
  };
  for (const listener of batchListeners) {
    listener(latestBatch);
  }
}

export function subscribeChartFrameBatch(listener: LiveChartFrameBatchListener): () => void {
  batchListeners.add(listener);
  if (latestBatch) {
    listener(latestBatch);
  }
  return () => {
    batchListeners.delete(listener);
  };
}

export function getLatestChartFrameBatch(): LiveChartFrameBatch | null {
  return latestBatch;
}

export function getLatestChartFramePublishResult(feedKey: string): ChartFramePublishResult | null {
  if (!feedKey) {
    return null;
  }
  return latestPublishResults.get(feedKey) || null;
}

export function clearChartFrame(feedKey: string): void {
  if (!feedKey) {
    return;
  }
  latestFrames.delete(feedKey);
  latestPublishResults.delete(feedKey);
}