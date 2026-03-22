const BINANCE_BASE_URL = "https://api.binance.com";

const DEFAULT_BINANCE_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "BNBUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
];

type BinanceBookTicker = {
  symbol: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
};

type Binance24hTicker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
};

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

async function fetchBinanceJson(path: string, timeoutMs = 2500): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BINANCE_BASE_URL}${path}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
      },
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function toBinanceSymbol(instrument: string): string {
  const normalized = String(instrument || "BTCUSDT")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace("-PERP", "")
    .replace(/[\/_-]/g, "");

  if (normalized.endsWith("USDT")) {
    return normalized;
  }
  if (normalized.endsWith("USD")) {
    return `${normalized.slice(0, -3)}USDT`;
  }
  if (normalized.endsWith("PERP")) {
    return `${normalized.slice(0, -4)}USDT`;
  }
  if (normalized.length >= 6) {
    return normalized;
  }
  return `${normalized}USDT`;
}

function toBinanceInterval(timeframe: string): string {
  if (timeframe === "5m" || timeframe === "15m") {
    return timeframe;
  }
  return "1m";
}

export function hasUsableRows(payload: unknown): boolean {
  return Array.isArray(payload) && payload.length > 0;
}

export function hasUsableObject(payload: unknown): boolean {
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload));
}

export async function fallbackOhlcv(instrument: string, timeframe: string, limit: number): Promise<Record<string, unknown>[]> {
  const symbol = toBinanceSymbol(instrument);
  const interval = toBinanceInterval(timeframe);
  const safeLimit = Math.max(10, Math.min(500, limit || 200));
  const payload = await fetchBinanceJson(`/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(String(safeLimit))}`);
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((entry) => (Array.isArray(entry) ? entry : []))
    .filter((entry) => entry.length >= 6)
    .map((entry) => ({
      instrument: symbol,
      venue: "binance-public",
      bucket_start: new Date(toNumber(entry[0], Date.now())).toISOString(),
      open: toNumber(entry[1], 0),
      high: toNumber(entry[2], 0),
      low: toNumber(entry[3], 0),
      close: toNumber(entry[4], 0),
      volume: toNumber(entry[5], 0),
      trade_count: toNumber(entry[8], 0),
      source: "binance-rest-fallback",
    }));
}

export async function fallbackTrades(instrument: string, limit: number): Promise<Record<string, unknown>[]> {
  const symbol = toBinanceSymbol(instrument);
  const safeLimit = Math.max(20, Math.min(1000, limit || 200));
  const payload = await fetchBinanceJson(`/api/v3/trades?symbol=${encodeURIComponent(symbol)}&limit=${encodeURIComponent(String(safeLimit))}`);
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        instrument: symbol,
        venue: "binance-public",
        trade_id: toNumber(row.id, 0),
        traded_at: new Date(toNumber(row.time, Date.now())).toISOString(),
        price: toNumber(row.price, 0),
        size: toNumber(row.qty, 0),
        side: row.isBuyerMaker ? "sell" : "buy",
        source: "binance-rest-fallback",
      };
    });
}

export async function fallbackQuotes(): Promise<Record<string, unknown>[]> {
  const symbolsQuery = encodeURIComponent(JSON.stringify(DEFAULT_BINANCE_SYMBOLS));
  const [bookPayload, tickerPayload] = await Promise.all([
    fetchBinanceJson(`/api/v3/ticker/bookTicker?symbols=${symbolsQuery}`),
    fetchBinanceJson(`/api/v3/ticker/24hr?symbols=${symbolsQuery}`),
  ]);

  const books = (Array.isArray(bookPayload) ? bookPayload : []) as BinanceBookTicker[];
  const tickers = new Map(
    ((Array.isArray(tickerPayload) ? tickerPayload : []) as Binance24hTicker[])
      .map((item) => [String(item.symbol || ""), item]),
  );

  return books.map((book) => {
    const ticker = tickers.get(book.symbol);
    const bid = toNumber(book.bidPrice, 0);
    const ask = toNumber(book.askPrice, 0);
    const last = toNumber(ticker?.lastPrice || ask || bid, 0);
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : Math.max(last, 1);
    const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10_000 : 0;

    return {
      symbol: book.symbol,
      instrument: book.symbol,
      venue: "binance-public",
      bid,
      ask,
      last,
      bid_size: toNumber(book.bidQty, 0),
      ask_size: toNumber(book.askQty, 0),
      spread_bps: spreadBps,
      change_24h_pct: toNumber(ticker?.priceChangePercent, 0),
      quote_volume_24h: toNumber(ticker?.quoteVolume, 0),
      updated_at: new Date().toISOString(),
      source: "binance-rest-fallback",
    };
  });
}

export async function fallbackDepth(instrument: string): Promise<Record<string, unknown> | null> {
  const symbol = toBinanceSymbol(instrument);
  const payload = await fetchBinanceJson(`/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=40`);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const row = payload as Record<string, unknown>;
  const bids = Array.isArray(row.bids) ? row.bids : [];
  const asks = Array.isArray(row.asks) ? row.asks : [];
  const bestBid = Array.isArray(bids[0]) ? toNumber((bids[0] as unknown[])[0], 0) : 0;
  const bestAsk = Array.isArray(asks[0]) ? toNumber((asks[0] as unknown[])[0], 0) : 0;
  const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : Math.max(bestBid, bestAsk, 1);
  const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10_000 : 0;

  return {
    venue: "binance-public",
    instrument: symbol,
    best_bid: bestBid,
    best_ask: bestAsk,
    spread_bps: spreadBps,
    snapshot_at: new Date().toISOString(),
    depth_payload: {
      bids,
      asks,
      lastUpdateId: toNumber(row.lastUpdateId, 0),
      event_time: Date.now(),
      reason: "binance-rest-fallback",
    },
    source: "binance-rest-fallback",
  };
}

export async function fallbackMicrostructure(instrument: string): Promise<Record<string, unknown> | null> {
  const depth = await fallbackDepth(instrument);
  if (!depth) {
    return null;
  }

  const payload = (depth.depth_payload as Record<string, unknown> | undefined) || {};
  const bids = (Array.isArray(payload.bids) ? payload.bids : []) as unknown[];
  const asks = (Array.isArray(payload.asks) ? payload.asks : []) as unknown[];

  let bidTotal = 0;
  for (const row of bids.slice(0, 15)) {
    const tuple = (Array.isArray(row) ? row : []) as unknown[];
    bidTotal += toNumber(tuple[1], 0);
  }

  let askTotal = 0;
  for (const row of asks.slice(0, 15)) {
    const tuple = (Array.isArray(row) ? row : []) as unknown[];
    askTotal += toNumber(tuple[1], 0);
  }
  const imbalance = bidTotal + askTotal > 0 ? (bidTotal - askTotal) / (bidTotal + askTotal) : 0;

  return {
    instrument: String(depth.instrument || "BTCUSDT"),
    venue: String(depth.venue || "binance-public"),
    spread_bps: toNumber(depth.spread_bps, 0),
    depth_imbalance: imbalance,
    bid_depth_top15: bidTotal,
    ask_depth_top15: askTotal,
    source: "binance-rest-fallback",
    snapshot_at: new Date().toISOString(),
  };
}

export function fallbackSessionState(instrument: string): Record<string, unknown> {
  const now = new Date();
  const hour = now.getUTCHours();

  let session = "asia";
  if (hour >= 7 && hour < 13) {
    session = "london";
  } else if (hour >= 13 && hour < 21) {
    session = "new-york";
  }

  return {
    instrument: toBinanceSymbol(instrument),
    session,
    is_open: true,
    source: "binance-rest-fallback",
    snapshot_at: new Date().toISOString(),
  };
}