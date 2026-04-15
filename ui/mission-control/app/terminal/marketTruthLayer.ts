export const PRIMARY_TRUTH_VENUE = "binance-public";
export const DEFAULT_TRUTH_RELIABILITY_THRESHOLD = 0.6;

export type MarketTruthVenueInput = {
  venue: string;
  last: number;
  bid?: number;
  ask?: number;
  latencyMs?: number | null;
  freshnessMs?: number | null;
  lastTradeTsMs?: number | null;
  availableDepthUsd?: number | null;
};

export type MarketTruthVenueState = {
  venue: string;
  price: number;
  latencyMs: number;
  freshnessMs: number;
  driftBps: number;
  reliabilityScore: number;
  continuityScore: number;
  availableDepthUsd: number;
  isPrimaryOracle: boolean;
  flags: string[];
};

export type MarketTruthSelection = {
  activeVenue: string | null;
  states: MarketTruthVenueState[];
  validationVenues: string[];
  maxDriftBps: number;
  degraded: boolean;
  reason: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeVenue(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function safeNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function midpoint(input: MarketTruthVenueInput): number {
  const bid = safeNumber(input.bid, 0);
  const ask = safeNumber(input.ask, 0);
  const last = safeNumber(input.last, 0);
  if (bid > 0 && ask > 0) {
    return (bid + ask) * 0.5;
  }
  return last;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length * 0.5);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) * 0.5;
  }
  return sorted[middle];
}

export function computeReliabilityScore(input: {
  freshnessMs: number;
  latencyMs: number;
  driftMsEquivalent: number;
  continuityScore: number;
}): number {
  const freshness = clamp(1 - input.freshnessMs / 2000, 0, 1);
  const latency = clamp(1 - input.latencyMs / 1000, 0, 1);
  const drift = clamp(1 - Math.abs(input.driftMsEquivalent) / 2000, 0, 1);
  const continuity = clamp(input.continuityScore, 0, 1);
  return 0.4 * freshness + 0.3 * latency + 0.2 * drift + 0.1 * continuity;
}

export function resolveMarketTruthSelection(input: {
  venues: MarketTruthVenueInput[];
  preferredOracle?: string;
  reliabilityThreshold?: number;
}): MarketTruthSelection {
  const preferredOracle = normalizeVenue(input.preferredOracle || PRIMARY_TRUTH_VENUE);
  const reliabilityThreshold = Number.isFinite(input.reliabilityThreshold)
    ? clamp(Number(input.reliabilityThreshold), 0.3, 0.95)
    : DEFAULT_TRUTH_RELIABILITY_THRESHOLD;
  const priced = input.venues
    .map((venue) => ({
      ...venue,
      venue: normalizeVenue(venue.venue),
      price: midpoint(venue),
      latencyMs: Math.max(0, safeNumber(venue.latencyMs, 0)),
      freshnessMs: Math.max(0, safeNumber(venue.freshnessMs, safeNumber(venue.latencyMs, 250))),
      availableDepthUsd: Math.max(0, safeNumber(venue.availableDepthUsd, 0)),
      lastTradeTsMs: venue.lastTradeTsMs ?? null,
    }))
    .filter((venue) => venue.venue && venue.price > 0);

  const medianPrice = median(priced.map((venue) => venue.price));
  const now = Date.now();
  const states = priced
    .map((venue) => {
      const driftBps = medianPrice > 0 ? ((venue.price - medianPrice) / medianPrice) * 10000 : 0;
      const tradeAgeMs = venue.lastTradeTsMs != null && Number.isFinite(venue.lastTradeTsMs)
        ? Math.max(0, now - Number(venue.lastTradeTsMs))
        : Number.POSITIVE_INFINITY;
      const continuityScore = tradeAgeMs <= 2_000
        ? 1
        : venue.freshnessMs <= 1_000
          ? 0.85
          : venue.freshnessMs <= 2_500
            ? 0.6
            : 0.2;
      const reliabilityScore = computeReliabilityScore({
        freshnessMs: venue.freshnessMs,
        latencyMs: venue.latencyMs,
        driftMsEquivalent: Math.abs(driftBps) * 10,
        continuityScore,
      });
      const flags: string[] = [];
      if (venue.latencyMs >= 2_000) {
        flags.push("LATENCY_DANGEROUS");
      } else if (venue.latencyMs >= 1_000) {
        flags.push("LATENCY_SUSPECT");
      }
      if (venue.freshnessMs >= 2_000) {
        flags.push("STALE_FEED");
      }
      if (Math.abs(driftBps) >= 8) {
        flags.push("DRIFT_ANOMALY");
      }
      return {
        venue: venue.venue,
        price: venue.price,
        latencyMs: venue.latencyMs,
        freshnessMs: venue.freshnessMs,
        driftBps: Number(driftBps.toFixed(2)),
        reliabilityScore: Number(reliabilityScore.toFixed(3)),
        continuityScore: Number(continuityScore.toFixed(3)),
        availableDepthUsd: venue.availableDepthUsd,
        isPrimaryOracle: venue.venue === preferredOracle,
        flags,
      } satisfies MarketTruthVenueState;
    })
    .sort((left, right) => {
      if (left.isPrimaryOracle !== right.isPrimaryOracle) {
        return Number(right.isPrimaryOracle) - Number(left.isPrimaryOracle);
      }
      return right.reliabilityScore - left.reliabilityScore
        || left.latencyMs - right.latencyMs
        || right.availableDepthUsd - left.availableDepthUsd;
    });

  if (states.length === 0) {
    return {
      activeVenue: null,
      states: [],
      validationVenues: [],
      maxDriftBps: 0,
      degraded: true,
      reason: "no-priced-venues",
    };
  }

  const primary = states.find((state) => state.isPrimaryOracle) || null;
  const best = [...states].sort((left, right) => right.reliabilityScore - left.reliabilityScore || left.latencyMs - right.latencyMs)[0];
  const chosen = primary && primary.reliabilityScore >= reliabilityThreshold ? primary : best;
  return {
    activeVenue: chosen?.venue || null,
    states,
    validationVenues: states.filter((state) => state.venue !== chosen?.venue).map((state) => state.venue),
    maxDriftBps: states.reduce((max, state) => Math.max(max, Math.abs(state.driftBps)), 0),
    degraded: !chosen || chosen.reliabilityScore < reliabilityThreshold,
    reason: primary && primary.reliabilityScore >= reliabilityThreshold
      ? "primary-oracle-healthy"
      : primary
        ? "primary-oracle-degraded-switch-best"
        : "primary-oracle-missing",
  };
}