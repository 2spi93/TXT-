import { NextRequest, NextResponse } from "next/server";

import { fallbackTrades, hasUsableRows } from "../../../../lib/binanceMarketFallback";
import { cpFetch, extractMcContextHeaders } from "../../../../lib/controlPlane";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const instrument = request.nextUrl.searchParams.get("instrument") || "BTCUSDT";
  const venue = request.nextUrl.searchParams.get("venue") || "binance-public";
  const limit = Number(request.nextUrl.searchParams.get("limit") || "200");

  try {
    const response = await cpFetch(`/v1/market/trades?instrument=${encodeURIComponent(instrument)}&venue=${encodeURIComponent(venue)}&limit=${encodeURIComponent(String(limit))}`, {
      headers: extractMcContextHeaders(request),
    });
    const payload = await response.json();
    if (response.ok && hasUsableRows(payload)) {
      return NextResponse.json(payload, { status: response.status });
    }
  } catch {
    // Fall through to market fallback.
  }

  const fallback = await fallbackTrades(instrument, limit);
  return NextResponse.json(fallback, {
    status: 200,
    headers: {
      "X-Data-Source": "fallback-binance",
    },
  });
}
