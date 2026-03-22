import { NextRequest, NextResponse } from "next/server";

import { fallbackOhlcv, hasUsableRows } from "../../../../lib/binanceMarketFallback";
import { cpFetch, extractMcContextHeaders } from "../../../../lib/controlPlane";
import { getCachedOhlcv, setCachedOhlcv } from "../../../../lib/ohlcvCache";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const instrument = request.nextUrl.searchParams.get("instrument") || "BTCUSDT";
  const venue = request.nextUrl.searchParams.get("venue") || "binance-public";
  const timeframe = request.nextUrl.searchParams.get("timeframe") || "1m";
  const limit = Number(request.nextUrl.searchParams.get("limit") || "500");

  // Serve from cache when available (20s TTL — keeps data fresh but avoids hammering upstream).
  const cached = getCachedOhlcv(instrument, timeframe);
  if (cached && cached.length >= Math.min(limit, cached.length)) {
    return NextResponse.json(cached.slice(-limit), {
      status: 200,
      headers: { "X-Data-Source": "cache" },
    });
  }

  try {
    const response = await cpFetch(`/v1/market/ohlcv?instrument=${encodeURIComponent(instrument)}&venue=${encodeURIComponent(venue)}&timeframe=${encodeURIComponent(timeframe)}&limit=${encodeURIComponent(String(limit))}`, {
      headers: extractMcContextHeaders(request),
    });
    const payload = await response.json();
    if (response.ok && hasUsableRows(payload)) {
      const rows = Array.isArray(payload) ? payload : (payload?.rows ?? []);
      setCachedOhlcv(instrument, timeframe, rows);
      return NextResponse.json(rows, { status: response.status });
    }
  } catch {
    // Fall through to market fallback.
  }

  const fallback = await fallbackOhlcv(instrument, timeframe, limit);
  setCachedOhlcv(instrument, timeframe, fallback);
  return NextResponse.json(fallback, {
    status: 200,
    headers: {
      "X-Data-Source": "fallback-binance",
    },
  });
}
