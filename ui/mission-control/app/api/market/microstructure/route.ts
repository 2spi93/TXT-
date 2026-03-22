import { NextRequest, NextResponse } from "next/server";

import { fallbackMicrostructure, hasUsableObject } from "../../../../lib/binanceMarketFallback";
import { cpFetch, extractMcContextHeaders } from "../../../../lib/controlPlane";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const instrument = request.nextUrl.searchParams.get("instrument") || "BTCUSDT";
  const venue = request.nextUrl.searchParams.get("venue") || "binance-public";
  const lookbackMinutes = request.nextUrl.searchParams.get("lookback_minutes") || "60";

  try {
    const response = await cpFetch(`/v1/market/microstructure?instrument=${encodeURIComponent(instrument)}&venue=${encodeURIComponent(venue)}&lookback_minutes=${encodeURIComponent(lookbackMinutes)}`, {
      headers: extractMcContextHeaders(request),
    });
    const payload = await response.json();
    if (response.ok && hasUsableObject(payload)) {
      return NextResponse.json(payload, { status: response.status });
    }
  } catch {
    // Fall through to market fallback.
  }

  const fallback = await fallbackMicrostructure(instrument);
  if (!fallback) {
    return NextResponse.json({ detail: "market_microstructure_unavailable" }, { status: 503 });
  }

  return NextResponse.json(fallback, {
    status: 200,
    headers: {
      "X-Data-Source": "fallback-binance",
    },
  });
}
