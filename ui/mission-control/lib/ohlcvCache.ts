/**
 * Server-side in-memory OHLCV cache (module-level, per Next.js worker).
 *
 * Reduces redundant Binance/control-plane requests when multiple
 * requests arrive for the same symbol+timeframe within the TTL window.
 *
 * TTL: 20 seconds (fine for 1m bars, cache expires before next full bar).
 */

const CACHE_TTL_MS = 20_000;

type CacheEntry = {
  data: unknown[];
  cachedAt: number;
};

const cache = new Map<string, CacheEntry>();

export function getCachedOhlcv(instrument: string, timeframe: string): unknown[] | null {
  const key = `${instrument}:${timeframe}`;
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCachedOhlcv(instrument: string, timeframe: string, data: unknown[]): void {
  const key = `${instrument}:${timeframe}`;
  cache.set(key, { data, cachedAt: Date.now() });
  // Prune stale entries (keep at most 64 entries)
  if (cache.size > 64) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}
