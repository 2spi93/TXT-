export type TemporalInput = {
  name: string;
  timestamp: number;
  seq?: number;
  latency: number;
  data?: unknown;
};

export type TemporalState = {
  aligned: boolean;
  driftMs: number;
  seqGap: number;
  freshnessScore: number;
  dominantSource: string;
  degraded: boolean;
  sourceCount: number;
  bufferedSourceCount: number;
  bufferWindowMs: number;
};

const DEFAULT_BUFFER_WINDOW_MS = 500;
const ALIGNED_DRIFT_MS = 500;
const DEGRADED_DRIFT_MS = 2_000;
const DEGRADED_SEQ_GAP = 5;
const DEGRADED_FRESHNESS_SCORE = 0.3;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function alignWithBuffer(inputs: TemporalInput[], bufferWindowMs = DEFAULT_BUFFER_WINDOW_MS): TemporalInput[] {
  if (inputs.length === 0) {
    return [];
  }
  const latestTimestamp = Math.max(...inputs.map((input) => input.timestamp));
  return inputs.filter((input) => latestTimestamp - input.timestamp <= bufferWindowMs);
}

export function computeTemporalSync(inputs: TemporalInput[], bufferWindowMs = DEFAULT_BUFFER_WINDOW_MS): TemporalState {
  const normalized = inputs
    .filter((input) => Number.isFinite(input.timestamp) && input.timestamp > 0)
    .sort((left, right) => right.timestamp - left.timestamp);

  if (normalized.length === 0) {
    return {
      aligned: false,
      driftMs: Number.POSITIVE_INFINITY,
      seqGap: Number.POSITIVE_INFINITY,
      freshnessScore: 0,
      dominantSource: "none",
      degraded: true,
      sourceCount: 0,
      bufferedSourceCount: 0,
      bufferWindowMs,
    };
  }

  const timestamps = normalized.map((input) => input.timestamp);
  const maxTimestamp = Math.max(...timestamps);
  const minTimestamp = Math.min(...timestamps);
  const driftMs = maxTimestamp - minTimestamp;
  const bufferedInputs = alignWithBuffer(normalized, bufferWindowMs);
  const seqs = normalized
    .map((input) => input.seq)
    .filter((seq): seq is number => Number.isFinite(seq));
  const seqGap = seqs.length >= 2 ? Math.max(...seqs) - Math.min(...seqs) : 0;
  const now = Date.now();
  const freshnessScores = normalized.map((input) => {
    const age = Math.max(0, now - input.timestamp);
    return clamp01(Math.exp(-age / 3_000));
  });
  const freshnessScore = freshnessScores.length > 0
    ? freshnessScores.reduce((sum, score) => sum + score, 0) / freshnessScores.length
    : 0;
  const dominantSource = normalized[0]?.name || "none";
  const degraded = driftMs > DEGRADED_DRIFT_MS
    || seqGap > DEGRADED_SEQ_GAP
    || freshnessScore < DEGRADED_FRESHNESS_SCORE;

  return {
    aligned: driftMs < ALIGNED_DRIFT_MS,
    driftMs,
    seqGap,
    freshnessScore,
    dominantSource,
    degraded,
    sourceCount: normalized.length,
    bufferedSourceCount: bufferedInputs.length,
    bufferWindowMs,
  };
}