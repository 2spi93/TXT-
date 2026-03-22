import { NextRequest, NextResponse } from "next/server";

import { fallbackSessionState, hasUsableObject } from "../../../../lib/binanceMarketFallback";
import { cpFetch, extractMcContextHeaders } from "../../../../lib/controlPlane";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const instrument = request.nextUrl.searchParams.get("instrument") || "BTCUSDT";

  try {
    const response = await cpFetch(`/v1/market/session-state?instrument=${encodeURIComponent(instrument)}`, {
      headers: extractMcContextHeaders(request),
    });
    const payload = await response.json();
    if (response.ok && hasUsableObject(payload)) {
      return NextResponse.json(payload, { status: response.status });
    }
  } catch {
    // Fall through to market fallback.
  }

  return NextResponse.json(fallbackSessionState(instrument), {
    status: 200,
    headers: {
      "X-Data-Source": "fallback-binance",
    },
  });
}
