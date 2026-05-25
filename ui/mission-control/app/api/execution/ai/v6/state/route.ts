import { NextResponse } from "next/server";

import { cpFetchJsonSafe, withControlPlaneNetwork } from "../../../../../../lib/controlPlane";

type ExecutionAiV6StateCacheEntry = {
  createdAtMs: number;
  status: number;
  payload: unknown;
};

type ExecutionAiV6StateGlobal = typeof globalThis & {
  __executionAiV6StateRouteCache__?: ExecutionAiV6StateCacheEntry | null;
  __executionAiV6StateRouteInflight__?: Promise<ExecutionAiV6StateCacheEntry> | null;
};

const executionAiV6StateGlobal = globalThis as ExecutionAiV6StateGlobal;

function routeCacheTtlMs(): number {
  const configured = Number(process.env.EXECUTION_AI_V6_STATE_ROUTE_CACHE_MS || "");
  if (Number.isFinite(configured) && configured >= 0) {
    return Math.min(60_000, Math.round(configured));
  }
  return process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development" ? 0 : 5_000;
}

async function loadExecutionAiV6State(): Promise<ExecutionAiV6StateCacheEntry> {
  const { response, payload, network } = await cpFetchJsonSafe("/v1/execution-ai/v6/state");
  return {
    createdAtMs: Date.now(),
    status: response.status,
    payload: withControlPlaneNetwork(payload, network, { includeMetrics: false }),
  };
}

export async function GET(): Promise<NextResponse> {
  const ttlMs = routeCacheTtlMs();
  const cached = ttlMs > 0 ? executionAiV6StateGlobal.__executionAiV6StateRouteCache__ || null : null;
  if (cached && Date.now() - cached.createdAtMs <= ttlMs) {
    return NextResponse.json(cached.payload, {
      status: cached.status,
      headers: {
        "Cache-Control": "no-store",
        "X-Execution-AI-V6-State-Cache": "hit",
      },
    });
  }

  let inflight = ttlMs > 0 ? executionAiV6StateGlobal.__executionAiV6StateRouteInflight__ || null : null;
  if (!inflight) {
    inflight = loadExecutionAiV6State();
    if (ttlMs > 0) {
      executionAiV6StateGlobal.__executionAiV6StateRouteInflight__ = inflight;
    }
  }

  const result = await inflight.finally(() => {
    executionAiV6StateGlobal.__executionAiV6StateRouteInflight__ = null;
  });
  if (ttlMs > 0) {
    executionAiV6StateGlobal.__executionAiV6StateRouteCache__ = result;
  }
  return NextResponse.json(result.payload, {
    status: result.status,
    headers: {
      "Cache-Control": "no-store",
      "X-Execution-AI-V6-State-Cache": cached ? "stale" : "miss",
    },
  });
}