/* eslint-disable no-restricted-globals */

const RENDER_FRAME_STALL_TIMEOUT_MS = 150;
const MAX_QUEUE_DEPTH = 512;

let renderGateTimer = null;
let sequenceTimer = null;
let pendingFrame = null;
let queue = [];
let expectedSequence = null;
let gapStartedAt = 0;
let currentGraceWindowMs = 5;

function clearTimers() {
  if (renderGateTimer !== null) {
    clearTimeout(renderGateTimer);
    renderGateTimer = null;
  }
  if (sequenceTimer !== null) {
    clearTimeout(sequenceTimer);
    sequenceTimer = null;
  }
}

function resetState() {
  clearTimers();
  pendingFrame = null;
  queue = [];
  expectedSequence = null;
  gapStartedAt = 0;
  currentGraceWindowMs = 5;
  postState(0, 0);
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function postState(syncGapCountDelta, coalescedFramesDelta) {
  self.postMessage({
    type: "state",
    telemetry: {
      sequenceQueueDepth: queue.length,
      syncGapCountDelta,
      adaptiveGraceMs: currentGraceWindowMs,
      coalescedFramesDelta,
    },
  });
}

function isAtomic(frame) {
  if (!(frame.tradeTsMs > 0)) {
    return true;
  }
  if (!(frame.depthTsMs > 0)) {
    return false;
  }
  return Math.abs(frame.tradeTsMs - frame.depthTsMs) <= Math.max(8, frame.dynamicBufferMs);
}

function computeConfidence(frame, partial, stallAgeMs) {
  const backlogPenalty = Math.min(0.42, Number(frame.backlog || 0) / 1200);
  const syncPenalty = partial ? 0.34 : 0;
  const stallPenalty = Math.min(0.28, stallAgeMs / 600);
  const coalescePenalty = frame.coalesced ? 0.12 : 0;
  return clampNumber(1 - backlogPenalty - syncPenalty - stallPenalty - coalescePenalty, 0.05, 1);
}

function resolveFrameCandleTimestampMs(frame) {
  const candles = Array.isArray(frame && frame.candles) ? frame.candles : [];
  const last = candles[candles.length - 1];
  if (last && typeof last.label === "string") {
    const parsed = Date.parse(last.label);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Number.isFinite(frame && frame.createdAt) ? frame.createdAt : Date.now();
}

function buildTruthLayer(frame, reconstructionMeta, renderMeta) {
  const candles = Array.isArray(frame && frame.candles) ? frame.candles : [];
  const reasons = [];
  let integrityStatus = "clean";
  let previousTs = 0;
  if (candles.length === 0) {
    integrityStatus = "invalid";
    reasons.push("no_candles");
  }
  for (const candle of candles.slice(-64)) {
    const open = Number(candle && candle.open);
    const high = Number(candle && candle.high);
    const low = Number(candle && candle.low);
    const close = Number(candle && candle.close);
    const ts = Date.parse(String((candle && candle.label) || ""));
    if (!Number.isFinite(ts) || !(open > 0) || !(high > 0) || !(low > 0) || !(close > 0) || high < Math.max(open, close) || low > Math.min(open, close)) {
      integrityStatus = "invalid";
      reasons.push("invalid_ohlc");
      break;
    }
    if (previousTs > 0 && ts < previousTs) {
      integrityStatus = "invalid";
      reasons.push("non_monotonic_time");
      break;
    }
    previousTs = ts;
  }
  if (integrityStatus === "clean" && candles.length < 2) {
    integrityStatus = "degraded";
    reasons.push("thin_frame");
  }

  const sourceAgeMs = Number.isFinite(reconstructionMeta && reconstructionMeta.sourceAgeMs) ? Number(reconstructionMeta.sourceAgeMs) : null;
  const freshness = sourceAgeMs == null
    ? "unknown"
    : reconstructionMeta.sourceFreshness === "fresh"
      ? "fresh"
      : sourceAgeMs <= 120000
        ? "aging"
        : "stale";
  if (freshness === "unknown") {
    reasons.push("source_age_unknown");
  } else if (freshness !== "fresh") {
    reasons.push(`source_${freshness}`);
  }

  const reconstructionReason = String((reconstructionMeta && reconstructionMeta.reconstructionReason) || "").trim();
  const observationContinuity = (reconstructionMeta && reconstructionMeta.observationContinuity) || "unknown";
  const reconstructionFlag = observationContinuity === "resumed"
    ? "observer_resumed"
    : /gap|stale|missing/i.test(reconstructionReason)
      ? "source_gap"
      : reconstructionReason
        ? "reconstructed"
        : "none";
  if (reconstructionFlag !== "none") {
    reasons.push(reconstructionFlag);
  }

  const syncStatus = observationContinuity === "resumed"
    ? "resumed"
    : freshness === "stale"
      ? "stale"
      : renderMeta.partial || renderMeta.syncStatus !== "atomic"
        ? "delayed"
        : "live";
  if (syncStatus !== "live") {
    reasons.push(`sync_${syncStatus}`);
  }

  const tradable = integrityStatus === "clean"
    && syncStatus === "live"
    && freshness === "fresh"
    && reconstructionFlag === "none"
    && !renderMeta.partial
    && sourceAgeMs != null;
  if (!tradable && reasons.length === 0) {
    reasons.push("truth_validation_failed");
  }

  const penalty = (integrityStatus === "invalid" ? 1 : integrityStatus === "degraded" ? 0.35 : 0)
    + (freshness === "stale" ? 0.4 : freshness === "aging" ? 0.18 : freshness === "unknown" ? 0.22 : 0)
    + (syncStatus === "stale" ? 0.38 : syncStatus === "resumed" ? 0.26 : syncStatus === "delayed" ? 0.16 : syncStatus === "unknown" ? 0.2 : 0)
    + (reconstructionFlag === "source_gap" ? 0.3 : reconstructionFlag === "observer_resumed" ? 0.22 : reconstructionFlag === "reconstructed" ? 0.14 : 0);
  const confidence = integrityStatus === "invalid" ? 0 : clampNumber(Number(renderMeta.confidence || 0) - penalty, 0, 1);
  return {
    integrity_status: integrityStatus,
    sync_status: syncStatus,
    freshness,
    reconstruction_flag: reconstructionFlag,
    confidence,
    tradable,
    decision_allowed: tradable,
    reasons: Array.from(new Set(reasons)).slice(0, 8),
  };
}

function buildPublishedFrame(frame, options) {
  const publishedAt = Number.isFinite(options && options.publishedAt) ? options.publishedAt : Date.now();
  const stallAgeMs = Math.max(0, publishedAt - frame.createdAt);
  const atomic = isAtomic(frame);
  const batchSkewMs = Math.max(0, Number(options && options.batchSkewMs) || 0);
  const batchSkewBudgetMs = Math.max(48, Math.round(Math.max(20, frame.dynamicBufferMs || 50) * 1.6));
  const partial = !atomic || batchSkewMs > batchSkewBudgetMs;
  const syncStatus = partial
    ? "loose-sync"
    : frame.coalesced
      ? "coalesced"
      : "atomic";
  const baseConfidence = computeConfidence(frame, !atomic, stallAgeMs);
  const batchPenalty = Math.min(0.38, batchSkewMs / Math.max(240, batchSkewBudgetMs * 4));
  const confidence = clampNumber(baseConfidence - batchPenalty, 0.05, 1);
  const reconstructionMeta = frame.reconstructionMeta || {};
  return {
    feedKey: frame.feedKey,
    candles: frame.candles,
    meta: {
      ...reconstructionMeta,
      syncStatus,
      partial,
      coalesced: Boolean(frame.coalesced),
      confidence,
      truth: buildTruthLayer(frame, reconstructionMeta, { syncStatus, partial, confidence }),
      dynamicBufferMs: frame.dynamicBufferMs,
      stallAgeMs: partial ? Math.max(stallAgeMs, batchSkewMs) : 0,
      depthSequence: Number.isFinite(frame.depthSequence) ? frame.depthSequence : null,
      depthEventTs: Number.isFinite(frame.depthTsMs) ? frame.depthTsMs : null,
      tradeEventTs: Number.isFinite(frame.tradeTsMs) ? frame.tradeTsMs : null,
      batchSkewMs,
      batchPublishedAt: publishedAt,
      batchFrameCount: Number.isFinite(options && options.batchFrameCount) ? options.batchFrameCount : null,
    },
  };
}

function scheduleRenderGate(delayMs) {
  if (renderGateTimer !== null) {
    clearTimeout(renderGateTimer);
  }
  renderGateTimer = setTimeout(() => {
    renderGateTimer = null;
    flushRenderGate(false);
  }, clampNumber(Math.round(delayMs || 0), 0, RENDER_FRAME_STALL_TIMEOUT_MS));
}

function scheduleSequenceWake(delayMs) {
  if (sequenceTimer !== null) {
    clearTimeout(sequenceTimer);
  }
  sequenceTimer = setTimeout(() => {
    sequenceTimer = null;
    advanceSequencedFrames();
  }, Math.max(1, Math.round(delayMs || 1)));
}

function armRenderFrame(frame) {
  pendingFrame = frame;
  scheduleRenderGate(frame.dynamicBufferMs);
  postState(0, 0);
}

function pollSequence(now) {
  if (queue.length === 0) {
    return {
      ready: null,
      skippedGapCount: 0,
      nextWakeDelayMs: null,
    };
  }

  if (expectedSequence === null) {
    expectedSequence = queue[0].sequence;
  }

  let skippedGapCount = 0;
  while (queue.length > 0 && expectedSequence !== null) {
    const head = queue[0];
    if (!head) {
      break;
    }
    if (head.sequence < expectedSequence) {
      queue.shift();
      continue;
    }
    if (head.sequence === expectedSequence) {
      queue.shift();
      const ready = head.payload;
      expectedSequence += 1;
      gapStartedAt = 0;
      return {
        ready,
        skippedGapCount,
        nextWakeDelayMs: null,
      };
    }
    if (gapStartedAt <= 0) {
      gapStartedAt = now;
      return {
        ready: null,
        skippedGapCount,
        nextWakeDelayMs: currentGraceWindowMs,
      };
    }
    const elapsedMs = now - gapStartedAt;
    if (elapsedMs < currentGraceWindowMs) {
      return {
        ready: null,
        skippedGapCount,
        nextWakeDelayMs: currentGraceWindowMs - elapsedMs,
      };
    }
    skippedGapCount += 1;
    expectedSequence += 1;
    gapStartedAt = now;
  }

  return {
    ready: null,
    skippedGapCount,
    nextWakeDelayMs: queue.length > 0 ? currentGraceWindowMs : null,
  };
}

function advanceSequencedFrames() {
  if (pendingFrame) {
    return;
  }
  const result = pollSequence(Date.now());
  if (result.skippedGapCount > 0) {
    postState(result.skippedGapCount, 0);
  } else {
    postState(0, 0);
  }
  if (result.ready) {
    armRenderFrame(result.ready);
    return;
  }
  if (result.nextWakeDelayMs !== null) {
    scheduleSequenceWake(result.nextWakeDelayMs);
  }
}

function flushRenderGate(force) {
  if (!pendingFrame) {
    return;
  }
  const frame = pendingFrame;
  const now = Date.now();
  const stallAgeMs = Math.max(0, now - frame.createdAt);
  const atomic = isAtomic(frame);
  if (!force && !atomic && stallAgeMs < RENDER_FRAME_STALL_TIMEOUT_MS) {
    scheduleRenderGate(Math.min(frame.dynamicBufferMs, RENDER_FRAME_STALL_TIMEOUT_MS - stallAgeMs));
    return;
  }
  const partial = !atomic;
  const syncStatus = partial
    ? "loose-sync"
    : frame.coalesced
      ? "coalesced"
      : "atomic";
  const publishFrame = buildPublishedFrame(frame, {
    publishedAt: now,
    batchSkewMs: 0,
    batchFrameCount: 1,
  });
  pendingFrame = null;
  self.postMessage({
    type: "publish-frame",
    telemetry: {
      sequenceQueueDepth: queue.length,
      syncGapCountDelta: 0,
      adaptiveGraceMs: currentGraceWindowMs,
      coalescedFramesDelta: 0,
    },
    frame: publishFrame,
  });
  advanceSequencedFrames();
}

function enqueueSequencedFrame(frame) {
  const sequence = Math.max(0, Math.trunc(frame.depthSequence));
  const existingIndex = queue.findIndex((item) => item.sequence === sequence);
  const entry = { sequence, payload: frame };
  if (existingIndex >= 0) {
    queue[existingIndex] = entry;
  } else {
    queue.push(entry);
  }
  queue.sort((left, right) => left.sequence - right.sequence);
  if (expectedSequence === null) {
    expectedSequence = sequence;
    gapStartedAt = 0;
  }
  while (queue.length > MAX_QUEUE_DEPTH) {
    queue.shift();
    if (expectedSequence !== null) {
      expectedSequence += 1;
    }
  }
}

function queueFrame(frame) {
  currentGraceWindowMs = Math.max(1, Math.round(frame.adaptiveGraceMs || currentGraceWindowMs || 5));
  if (Number.isFinite(frame.depthSequence)) {
    enqueueSequencedFrame(frame);
    postState(0, frame.coalesced ? 1 : 0);
    advanceSequencedFrames();
    return;
  }
  if (!pendingFrame || pendingFrame.feedKey !== frame.feedKey) {
    armRenderFrame(frame);
    return;
  }
  pendingFrame.candles = frame.candles;
  pendingFrame.tradeTsMs = Number.isFinite(frame.tradeTsMs) ? frame.tradeTsMs : pendingFrame.tradeTsMs;
  pendingFrame.depthTsMs = Number.isFinite(frame.depthTsMs) ? frame.depthTsMs : pendingFrame.depthTsMs;
  pendingFrame.coalesced = Boolean(pendingFrame.coalesced || frame.coalesced);
  pendingFrame.dynamicBufferMs = frame.dynamicBufferMs;
  pendingFrame.backlog = frame.backlog;
  pendingFrame.adaptiveGraceMs = frame.adaptiveGraceMs;
  scheduleRenderGate(frame.dynamicBufferMs);
  postState(0, 1);
}

function publishFrameBatch(batch) {
  const frames = Array.isArray(batch && batch.frames) ? batch.frames.filter((frame) => frame && frame.feedKey && Array.isArray(frame.candles) && frame.candles.length > 0) : [];
  if (frames.length === 0) {
    postState(0, 0);
    return;
  }
  const publishedAt = Date.now();
  const batchKey = typeof batch.batchKey === "string" && batch.batchKey.trim() ? batch.batchKey.trim() : `grid-${publishedAt}`;
  const anchorTsMs = frames.reduce((max, frame) => Math.max(max, resolveFrameCandleTimestampMs(frame)), 0);
  const publishedFrames = frames.map((frame) => {
    const frameTsMs = resolveFrameCandleTimestampMs(frame);
    return buildPublishedFrame(frame, {
      publishedAt,
      batchSkewMs: Math.max(0, anchorTsMs - frameTsMs),
      batchFrameCount: frames.length,
    });
  });
  self.postMessage({
    type: "publish-frame-batch",
    telemetry: {
      sequenceQueueDepth: queue.length,
      syncGapCountDelta: 0,
      adaptiveGraceMs: currentGraceWindowMs,
      coalescedFramesDelta: publishedFrames.filter((frame) => frame.meta.coalesced).length,
    },
    batch: {
      batchKey,
      publishedAt,
      frames: publishedFrames,
    },
  });
}

self.onmessage = (event) => {
  const payload = event.data || {};
  if (payload.type === "reset") {
    resetState();
    return;
  }
  if (payload.type === "queue-frame" && payload.frame) {
    queueFrame(payload.frame);
  }
  if (payload.type === "queue-frame-batch" && payload.batch) {
    publishFrameBatch(payload.batch);
  }
};