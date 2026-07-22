import { NextResponse } from "next/server";

import { fallbackQuotes, hasUsableRows } from "../../../../lib/binanceMarketFallback";
import { cpFetchJsonSafe } from "../../../../lib/controlPlane";

type QuotesRouteGlobal = typeof globalThis & {
  __marketQuotesRouteCache__?: { createdAtMs: number; payload: unknown };
  __marketQuotesRouteInflight__?: Promise<unknown>;
};

const quotesRouteGlobal = globalThis as QuotesRouteGlobal;
const QUOTES_ROUTE_CACHE_MS = 2_000;
const QUOTES_ROUTE_TIMEOUT_MS = 1_800;

async function fetchControlPlaneQuotesBounded(): Promise<unknown> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, QUOTES_ROUTE_TIMEOUT_MS);
  });
  const fetchPromise = cpFetchJsonSafe("/v1/market/quotes", { signal: controller.signal })
    .then(({ response, payload }) => (response.ok && hasUsableRows(payload) ? payload : null))
    .catch(() => null)
    .finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });
  return Promise.race([fetchPromise, timeoutPromise]);
}

export async function GET(): Promise<NextResponse> {
  const cached = quotesRouteGlobal.__marketQuotesRouteCache__;
  if (cached && Date.now() - cached.createdAtMs <= QUOTES_ROUTE_CACHE_MS) {
    return NextResponse.json(cached.payload, {
      status: 200,
      headers: {
        "X-Market-Quotes-Cache": "hit",
      },
    });
  }

  let inflight = quotesRouteGlobal.__marketQuotesRouteInflight__;
  if (!inflight) {
    inflight = fetchControlPlaneQuotesBounded().finally(() => {
      quotesRouteGlobal.__marketQuotesRouteInflight__ = undefined;
    });
    quotesRouteGlobal.__marketQuotesRouteInflight__ = inflight;
  }

  const payload = await inflight;
  if (hasUsableRows(payload)) {
    quotesRouteGlobal.__marketQuotesRouteCache__ = { createdAtMs: Date.now(), payload };
    return NextResponse.json(payload, {
      status: 200,
      headers: {
        "X-Market-Quotes-Cache": cached ? "refresh" : "miss",
      },
    });
  }

  if (cached && hasUsableRows(cached.payload)) {
    return NextResponse.json(cached.payload, {
      status: 200,
      headers: {
        "X-Market-Quotes-Cache": "stale",
      },
    });
  }

  const fallback = await fallbackQuotes();
  if (hasUsableRows(fallback)) {
    quotesRouteGlobal.__marketQuotesRouteCache__ = { createdAtMs: Date.now(), payload: fallback };
  }
  return NextResponse.json(fallback, {
    status: 200,
    headers: {
      "X-Data-Source": "fallback-binance",
    },
  });
}