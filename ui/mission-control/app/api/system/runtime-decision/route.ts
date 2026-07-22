import { NextRequest, NextResponse } from "next/server";

import { getControlPlaneToken } from "../../../../lib/controlPlane";
import { getRuntimeDecisionAnalytics } from "../../../../lib/runtimeDecisionAnalytics";
import { ensureRuntimeDecisionWriterStarted } from "../../../../lib/runtimeDecisionWriter";

type RuntimeDecisionRouteCacheEntry = {
  createdAtMs: number;
  payload: Awaited<ReturnType<typeof getRuntimeDecisionAnalytics>>;
};

type RuntimeDecisionRouteGlobal = typeof globalThis & {
  __runtimeDecisionRouteCache__?: Map<string, RuntimeDecisionRouteCacheEntry>;
  __runtimeDecisionRouteInflight__?: Map<string, Promise<Awaited<ReturnType<typeof getRuntimeDecisionAnalytics>>>>;
};

const runtimeDecisionRouteGlobal = globalThis as RuntimeDecisionRouteGlobal;
const runtimeDecisionRouteCache = runtimeDecisionRouteGlobal.__runtimeDecisionRouteCache__ || new Map<string, RuntimeDecisionRouteCacheEntry>();
const runtimeDecisionRouteInflight = runtimeDecisionRouteGlobal.__runtimeDecisionRouteInflight__ || new Map<string, Promise<Awaited<ReturnType<typeof getRuntimeDecisionAnalytics>>>>();

runtimeDecisionRouteGlobal.__runtimeDecisionRouteCache__ = runtimeDecisionRouteCache;
runtimeDecisionRouteGlobal.__runtimeDecisionRouteInflight__ = runtimeDecisionRouteInflight;

function routeCacheTtlMs(): number {
  const configured = Number(process.env.RUNTIME_DECISION_ROUTE_CACHE_MS || "");
  if (Number.isFinite(configured) && configured >= 0) {
    return Math.min(60_000, Math.round(configured));
  }
  return process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development" ? 0 : 5_000;
}

function cacheKey(input: { symbol: string; timeframe: string; strategy: string; limit: number; sinceDays: number; samples: number }): string {
  return [
    String(process.env.V2_RISK_JOURNAL_DIR || "/tmp"),
    String(process.env.V2_RISK_JOURNAL_FILE || "mission-control-v2-risk-journal.jsonl"),
    input.symbol.trim().toUpperCase(),
    input.timeframe.trim(),
    input.strategy.trim().toLowerCase(),
    String(input.limit),
    String(input.sinceDays),
    String(input.samples),
  ].join("::");
}

function unauthorized(): NextResponse {
  return NextResponse.json({ message: "Authentication required" }, { status: 401 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = await getControlPlaneToken();
  if (!token) {
    return unauthorized();
  }

  ensureRuntimeDecisionWriterStarted();

  const requestedSymbol = request.nextUrl.searchParams.get("symbol") || "";
  const deskScope = requestedSymbol.trim().toUpperCase() === "DESK";
  const symbol = deskScope ? "" : requestedSymbol;
  const timeframe = deskScope ? "" : request.nextUrl.searchParams.get("timeframe") || "";
  const strategy = deskScope ? "" : request.nextUrl.searchParams.get("strategy") || "";
  const limit = Number(request.nextUrl.searchParams.get("limit") || 1200);
  const sinceDays = Number(request.nextUrl.searchParams.get("sinceDays") || 7);
  const samples = Number(request.nextUrl.searchParams.get("samples") || 3);
  const ttlMs = routeCacheTtlMs();
  const key = cacheKey({ symbol, timeframe, strategy, limit, sinceDays, samples });
  const cached = ttlMs > 0 ? runtimeDecisionRouteCache.get(key) : null;
  if (cached && Date.now() - cached.createdAtMs <= ttlMs) {
    return NextResponse.json(cached.payload, {
      headers: {
        "Cache-Control": "no-store",
        "X-Runtime-Decision-Route-Cache": "hit",
      },
    });
  }

  let inflight = ttlMs > 0 ? runtimeDecisionRouteInflight.get(key) : null;
  if (!inflight) {
    inflight = getRuntimeDecisionAnalytics({ symbol, timeframe, strategy, limit, sinceDays, samples });
    if (ttlMs > 0) {
      runtimeDecisionRouteInflight.set(key, inflight);
    }
  }

  const summary = await inflight.finally(() => {
    runtimeDecisionRouteInflight.delete(key);
  });
  if (ttlMs > 0) {
    runtimeDecisionRouteCache.set(key, { createdAtMs: Date.now(), payload: summary });
  }

  return NextResponse.json(summary, {
    headers: {
      "Cache-Control": "no-store",
      "X-Runtime-Decision-Route-Cache": cached ? "stale" : "miss",
    },
  });
}