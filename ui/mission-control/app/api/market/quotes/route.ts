import { NextResponse } from "next/server";

import { fallbackQuotes, hasUsableRows } from "../../../../lib/binanceMarketFallback";
import { cpFetch } from "../../../../lib/controlPlane";

export async function GET(): Promise<NextResponse> {
  try {
    const response = await cpFetch("/v1/market/quotes");
    const payload = await response.json();
    if (response.ok && hasUsableRows(payload)) {
      return NextResponse.json(payload, { status: response.status });
    }
  } catch {
    // Fall through to market fallback.
  }

  const fallback = await fallbackQuotes();
  return NextResponse.json(fallback, {
    status: 200,
    headers: {
      "X-Data-Source": "fallback-binance",
    },
  });
}