export type DivergenceVenueInput = {
  venue: string;
  price: number;
  bid?: number;
  ask?: number;
  latencyMs?: number;
  freshnessMs?: number;
  availableDepthUsd?: number;
  reliabilityScore?: number;
  isOracle?: boolean;
};

export type DivergenceSignalRow = {
  venue: string;
  driftBps: number;
  spreadDivergenceBps: number;
  depthVolumeDivergencePct: number;
  latencyOffsetMs: number;
  reliabilityScore: number;
  severity: "normal" | "watch" | "alert";
  signal: "normal" | "arb-watch" | "inefficiency";
  inefficiencyScore: number;
};

export type DivergenceSnapshot = {
  oracleVenue: string | null;
  signal: "normal" | "arb-watch" | "inefficiency";
  rows: DivergenceSignalRow[];
  maxDriftBps: number;
  maxLatencyOffsetMs: number;
  opportunities: number;
  summary: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeVenue(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function midpoint(input: DivergenceVenueInput): number {
  const bid = toNumber(input.bid, 0);
  const ask = toNumber(input.ask, 0);
  const price = toNumber(input.price, 0);
  if (bid > 0 && ask > 0) {
    return (bid + ask) * 0.5;
  }
  return price;
}

function spreadBps(input: DivergenceVenueInput): number {
  const bid = toNumber(input.bid, 0);
  const ask = toNumber(input.ask, 0);
  const mid = midpoint(input);
  if (!(bid > 0) || !(ask > 0) || !(mid > 0) || ask <= bid) {
    return 0;
  }
  return ((ask - bid) / mid) * 10000;
}

export function buildVenueDivergenceSnapshot(input: {
  venues: DivergenceVenueInput[];
  oracleVenue?: string | null;
}): DivergenceSnapshot {
  const rows = input.venues
    .map((venue) => ({
      ...venue,
      venue: normalizeVenue(venue.venue),
      price: midpoint(venue),
      latencyMs: Math.max(0, toNumber(venue.latencyMs, 0)),
      freshnessMs: Math.max(0, toNumber(venue.freshnessMs, 0)),
      availableDepthUsd: Math.max(0, toNumber(venue.availableDepthUsd, 0)),
      reliabilityScore: clamp(toNumber(venue.reliabilityScore, 0), 0, 1),
    }))
    .filter((venue) => venue.venue && venue.price > 0);

  if (rows.length <= 1) {
    return {
      oracleVenue: rows[0]?.venue || normalizeVenue(input.oracleVenue),
      signal: "normal",
      rows: [],
      maxDriftBps: 0,
      maxLatencyOffsetMs: 0,
      opportunities: 0,
      summary: "single venue",
    };
  }

  const requestedOracleVenue = normalizeVenue(input.oracleVenue);
  const oracle = rows.find((venue) => venue.venue === requestedOracleVenue)
    || rows.find((venue) => venue.isOracle)
    || rows[0];
  const oracleSpreadBps = spreadBps(oracle);
  const oracleDepthUsd = Math.max(oracle.availableDepthUsd, 1);

  const signals = rows
    .filter((venue) => venue.venue !== oracle.venue)
    .map((venue) => {
      const driftBps = ((venue.price - oracle.price) / oracle.price) * 10000;
      const spreadDivergenceBps = spreadBps(venue) - oracleSpreadBps;
      const depthVolumeDivergencePct = ((venue.availableDepthUsd - oracle.availableDepthUsd) / oracleDepthUsd) * 100;
      const latencyOffsetMs = venue.latencyMs - oracle.latencyMs;
      const inefficiencyScore = clamp(
        Math.abs(driftBps) / 8 * 0.45
          + Math.abs(spreadDivergenceBps) / 5 * 0.2
          + Math.abs(depthVolumeDivergencePct) / 75 * 0.15
          + Math.max(0, 1 - Math.abs(latencyOffsetMs) / 250) * 0.1
          + venue.reliabilityScore * 0.1,
        0,
        1,
      );
      const signal = Math.abs(driftBps) >= 6 && Math.abs(latencyOffsetMs) <= 180 && venue.freshnessMs <= 1500 && venue.reliabilityScore >= 0.55
        ? "inefficiency"
        : Math.abs(driftBps) >= 3 || Math.abs(spreadDivergenceBps) >= 2.5
          ? "arb-watch"
          : "normal";
      const severity = signal === "inefficiency"
        ? "alert"
        : signal === "arb-watch" || Math.abs(latencyOffsetMs) >= 200 || Math.abs(depthVolumeDivergencePct) >= 35
          ? "watch"
          : "normal";
      return {
        venue: venue.venue,
        driftBps: Number(driftBps.toFixed(2)),
        spreadDivergenceBps: Number(spreadDivergenceBps.toFixed(2)),
        depthVolumeDivergencePct: Number(depthVolumeDivergencePct.toFixed(1)),
        latencyOffsetMs: Number(latencyOffsetMs.toFixed(0)),
        reliabilityScore: Number(venue.reliabilityScore.toFixed(3)),
        severity,
        signal,
        inefficiencyScore: Number(inefficiencyScore.toFixed(3)),
      } satisfies DivergenceSignalRow;
    })
    .sort((left, right) => right.inefficiencyScore - left.inefficiencyScore || Math.abs(right.driftBps) - Math.abs(left.driftBps));

  const topSignal = signals[0] || null;
  const signal = topSignal?.signal || "normal";
  const opportunities = signals.filter((row) => row.signal === "inefficiency").length;
  const summary = topSignal
    ? `${topSignal.signal} ${topSignal.venue} drift ${topSignal.driftBps >= 0 ? "+" : ""}${topSignal.driftBps.toFixed(2)}bps latency ${topSignal.latencyOffsetMs >= 0 ? "+" : ""}${topSignal.latencyOffsetMs}ms`
    : "no divergence";

  return {
    oracleVenue: oracle.venue,
    signal,
    rows: signals,
    maxDriftBps: signals.reduce((max, row) => Math.max(max, Math.abs(row.driftBps)), 0),
    maxLatencyOffsetMs: signals.reduce((max, row) => Math.max(max, Math.abs(row.latencyOffsetMs)), 0),
    opportunities,
    summary,
  };
}