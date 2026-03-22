import { NextResponse } from "next/server";

import { cpFetch } from "../../../../../lib/controlPlane";
import { listSelfLearningV4Scopes } from "../../../../../lib/selfLearningV4Store";

function noStoreJson(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const accountId = String(url.searchParams.get("account_id") || "").trim();
  const symbol = String(url.searchParams.get("symbol") || "").trim();
  const timeframe = String(url.searchParams.get("timeframe") || "").trim();
  const limitRaw = Number(url.searchParams.get("limit") || 120);
  const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? Math.round(limitRaw) : 120));

  try {
    const params = new URLSearchParams();
    if (accountId) {
      params.set("account_id", accountId);
    }
    if (symbol) {
      params.set("symbol", symbol);
    }
    if (timeframe) {
      params.set("timeframe", timeframe);
    }
    params.set("limit", String(limit));

    const cpResponse = await cpFetch(`/v1/strategies/self-learning-v4/scopes?${params.toString()}`, { method: "GET" });
    if (cpResponse.ok) {
      const payload = await cpResponse.json().catch(() => ({}));
      return noStoreJson({
        status: "ok",
        items: Array.isArray(payload?.items) ? payload.items : [],
        total: Number(payload?.total || 0),
        storage: "control-plane",
      }, 200);
    }
    if (cpResponse.status === 400 || cpResponse.status === 401 || cpResponse.status === 403) {
      const payload = await cpResponse.json().catch(() => ({ detail: "upstream_error" }));
      return noStoreJson({ status: "error", message: payload?.detail || "upstream_error" }, cpResponse.status);
    }

    const items = await listSelfLearningV4Scopes({ accountId, symbol, timeframe, limit });
    return noStoreJson({ status: "ok", items, total: items.length, storage: "local-fallback" }, 200);
  } catch {
    return noStoreJson({ status: "error", message: "unable to list self-learning v4 scopes" }, 500);
  }
}
