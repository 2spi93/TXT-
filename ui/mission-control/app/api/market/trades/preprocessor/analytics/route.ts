import { NextRequest, NextResponse } from "next/server";

import { cpFetchJsonSafe, extractMcContextHeaders } from "../../../../../../lib/controlPlane";

type TradesPreprocessorRouteGlobal = typeof globalThis & {
  __tradesPreprocessorAnalyticsCache__?: Map<string, { createdAtMs: number; payload: unknown; status: number }>;
  __tradesPreprocessorAnalyticsInflight__?: Map<string, Promise<{ payload: unknown; status: number }>>;
};

const routeGlobal = globalThis as TradesPreprocessorRouteGlobal;
const analyticsCache = routeGlobal.__tradesPreprocessorAnalyticsCache__ || new Map<string, { createdAtMs: number; payload: unknown; status: number }>();
const analyticsInflight = routeGlobal.__tradesPreprocessorAnalyticsInflight__ || new Map<string, Promise<{ payload: unknown; status: number }>>();
routeGlobal.__tradesPreprocessorAnalyticsCache__ = analyticsCache;
routeGlobal.__tradesPreprocessorAnalyticsInflight__ = analyticsInflight;

const ANALYTICS_CACHE_MS = 5_000;
const ANALYTICS_TIMEOUT_MS = 2_500;

async function fetchAnalyticsBounded(path: string, request: NextRequest): Promise<{ payload: unknown; status: number }> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<{ payload: unknown; status: number }>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve({
        status: 200,
        payload: {
          status: "degraded",
          detail: "trades_preprocessor_analytics_timeout",
          filters: Object.fromEntries(request.nextUrl.searchParams.entries()),
        },
      });
    }, ANALYTICS_TIMEOUT_MS);
  });
  const fetchPromise = cpFetchJsonSafe(path, {
    headers: extractMcContextHeaders(request),
    signal: controller.signal,
  })
    .then(({ response, payload }) => ({ payload, status: response.status }))
    .catch(() => ({
      status: 200,
      payload: {
        status: "degraded",
        detail: "trades_preprocessor_analytics_unreachable",
        filters: Object.fromEntries(request.nextUrl.searchParams.entries()),
      },
    }))
    .finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });
  return Promise.race([fetchPromise, timeoutPromise]);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const venue = request.nextUrl.searchParams.get("venue") || "";
  const instrument = request.nextUrl.searchParams.get("instrument") || "";
  const limit = request.nextUrl.searchParams.get("limit") || "24";
  const params = new URLSearchParams();
  if (venue.trim()) {
    params.set("venue", venue.trim());
  }
  if (instrument.trim()) {
    params.set("instrument", instrument.trim());
  }
  params.set("limit", limit);
  const path = `/v1/market/trades/preprocessor/analytics?${params.toString()}`;
  const key = path;
  const cached = analyticsCache.get(key) || null;
  if (cached && Date.now() - cached.createdAtMs <= ANALYTICS_CACHE_MS) {
    return NextResponse.json(cached.payload, {
      status: cached.status,
      headers: {
        "X-Trades-Preprocessor-Analytics-Cache": "hit",
      },
    });
  }

  let inflight = analyticsInflight.get(key);
  if (!inflight) {
    inflight = fetchAnalyticsBounded(path, request).finally(() => {
      analyticsInflight.delete(key);
    });
    analyticsInflight.set(key, inflight);
  }
  const { status, payload } = await inflight;
  if (status >= 200 && status < 300) {
    analyticsCache.set(key, { createdAtMs: Date.now(), payload, status });
  }
  if (status >= 500 && cached) {
    return NextResponse.json(cached.payload, {
      status: cached.status,
      headers: {
        "X-Trades-Preprocessor-Analytics-Cache": "stale",
      },
    });
  }

  return NextResponse.json(payload, {
    status,
    headers: {
      "X-Trades-Preprocessor-Analytics-Cache": cached ? "refresh" : "miss",
    },
  });
}