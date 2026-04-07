export type MultiExchangeLevel = {
  venue: string;
  side: "bid" | "ask";
  price: number;
  size: number;
  notionalUsd: number;
  latencyMs: number;
  feeBps: number;
  fillProbability: number;
  routeScore: number;
};

export type VenueOrderbook = {
  venue: string;
  bids: MultiExchangeLevel[];
  asks: MultiExchangeLevel[];
  bestBid: number;
  bestAsk: number;
  availableDepthUsd: number;
  latencyMs: number;
  feeBps: number;
  fillProbability: number;
  routeScore: number;
};

export type AggregatedOrderbook = {
  bids: MultiExchangeLevel[];
  asks: MultiExchangeLevel[];
  venues: string[];
  bestBid: number;
  bestBidVenue: string | null;
  bestAsk: number;
  bestAskVenue: string | null;
  totalBidNotionalUsd: number;
  totalAskNotionalUsd: number;
};

export type MultiExchangeArbitrageSnapshot = {
  arbitrage: boolean;
  buyVenue: string | null;
  sellVenue: string | null;
  grossSpread: number;
  grossSpreadBps: number;
  netSpreadBps: number;
  maxExecutableUsd: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeVenue(value: string): string {
  return String(value || "").trim().toLowerCase() || "unknown";
}

function safeNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeLevels(levels: MultiExchangeLevel[], side: "bid" | "ask"): MultiExchangeLevel[] {
  return levels
    .map((level) => ({
      ...level,
      venue: normalizeVenue(level.venue),
      side,
      price: Math.max(0, safeNumber(level.price, 0)),
      size: Math.max(0, safeNumber(level.size, 0)),
      notionalUsd: Math.max(0, safeNumber(level.notionalUsd, safeNumber(level.price, 0) * safeNumber(level.size, 0))),
      latencyMs: Math.max(0, safeNumber(level.latencyMs, 0)),
      feeBps: Math.max(0, safeNumber(level.feeBps, 0)),
      fillProbability: clamp(safeNumber(level.fillProbability, 0), 0, 1),
      routeScore: Math.max(0, safeNumber(level.routeScore, 0)),
    }))
    .filter((level) => level.price > 0 && (level.size > 0 || level.notionalUsd > 0));
}

export function aggregateOrderbooks(orderbooks: VenueOrderbook[]): AggregatedOrderbook {
  const bids = orderbooks.flatMap((orderbook) => normalizeLevels(orderbook.bids, "bid"));
  const asks = orderbooks.flatMap((orderbook) => normalizeLevels(orderbook.asks, "ask"));

  bids.sort((left, right) => right.price - left.price || right.notionalUsd - left.notionalUsd || left.latencyMs - right.latencyMs);
  asks.sort((left, right) => left.price - right.price || right.notionalUsd - left.notionalUsd || left.latencyMs - right.latencyMs);

  return {
    bids,
    asks,
    venues: [...new Set(orderbooks.map((orderbook) => normalizeVenue(orderbook.venue)).filter(Boolean))],
    bestBid: bids[0]?.price || 0,
    bestBidVenue: bids[0]?.venue || null,
    bestAsk: asks[0]?.price || 0,
    bestAskVenue: asks[0]?.venue || null,
    totalBidNotionalUsd: bids.reduce((sum, level) => sum + level.notionalUsd, 0),
    totalAskNotionalUsd: asks.reduce((sum, level) => sum + level.notionalUsd, 0),
  };
}

export function detectArbitrage(orderbooks: VenueOrderbook[]): MultiExchangeArbitrageSnapshot {
  const aggregated = aggregateOrderbooks(orderbooks);
  const bestBid = aggregated.bids[0] || null;
  const bestAsk = aggregated.asks[0] || null;
  if (!bestBid || !bestAsk) {
    return {
      arbitrage: false,
      buyVenue: null,
      sellVenue: null,
      grossSpread: 0,
      grossSpreadBps: 0,
      netSpreadBps: 0,
      maxExecutableUsd: 0,
    };
  }

  const mid = Math.max((bestBid.price + bestAsk.price) * 0.5, 1e-9);
  const grossSpread = bestBid.price - bestAsk.price;
  const grossSpreadBps = (grossSpread / mid) * 10000;
  const netSpreadBps = grossSpreadBps - bestBid.feeBps - bestAsk.feeBps;
  const maxExecutableUsd = Math.max(0, Math.min(bestBid.notionalUsd, bestAsk.notionalUsd));
  const crossVenue = bestBid.venue !== bestAsk.venue;

  return {
    arbitrage: crossVenue && grossSpread > 0 && netSpreadBps > 0 && maxExecutableUsd > 0,
    buyVenue: bestAsk.venue,
    sellVenue: bestBid.venue,
    grossSpread: Number(grossSpread.toFixed(8)),
    grossSpreadBps: Number(grossSpreadBps.toFixed(4)),
    netSpreadBps: Number(netSpreadBps.toFixed(4)),
    maxExecutableUsd: Number(maxExecutableUsd.toFixed(2)),
  };
}