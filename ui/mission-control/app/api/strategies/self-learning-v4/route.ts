import { NextResponse } from "next/server";

import { cpFetch } from "../../../../lib/controlPlane";
import {
  parseSelfLearningV4Scope,
  readSelfLearningV4State,
  writeSelfLearningV4State,
} from "../../../../lib/selfLearningV4Store";

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
  const scope = parseSelfLearningV4Scope({
    accountId: url.searchParams.get("account_id"),
    symbol: url.searchParams.get("symbol"),
    timeframe: url.searchParams.get("timeframe"),
  });
  if (!scope) {
    return noStoreJson({ status: "error", message: "account_id, symbol and timeframe are required" }, 400);
  }

  try {
    const cpResponse = await cpFetch(
      `/v1/strategies/self-learning-v4?account_id=${encodeURIComponent(scope.accountId)}&symbol=${encodeURIComponent(scope.symbol)}&timeframe=${encodeURIComponent(scope.timeframe)}`,
      { method: "GET" },
    );
    if (cpResponse.ok) {
      const payload = await cpResponse.json().catch(() => ({}));
      return noStoreJson({
        status: "ok",
        state: payload?.state ?? null,
        updatedAt: payload?.updated_at || null,
        storage: "control-plane",
      }, 200);
    }
    if (cpResponse.status === 400 || cpResponse.status === 401 || cpResponse.status === 403) {
      const payload = await cpResponse.json().catch(() => ({ detail: "upstream_error" }));
      return noStoreJson({ status: "error", message: payload?.detail || "upstream_error" }, cpResponse.status);
    }

    const state = await readSelfLearningV4State(scope);
    return noStoreJson({ status: "ok", state, updatedAt: state?.updatedAt || null, storage: "local-fallback" }, 200);
  } catch {
    return noStoreJson({ status: "error", message: "unable to read self-learning v4 state" }, 500);
  }
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return noStoreJson({ status: "error", message: "invalid payload" }, 400);
  }

  try {
    const cpResponse = await cpFetch("/v1/strategies/self-learning-v4", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (cpResponse.ok) {
      const payload = await cpResponse.json().catch(() => ({}));
      return noStoreJson({
        status: "ok",
        state: payload?.state ?? null,
        updatedAt: payload?.updated_at || null,
        storage: "control-plane",
      }, 200);
    }
    if (cpResponse.status === 400 || cpResponse.status === 401 || cpResponse.status === 403) {
      const payload = await cpResponse.json().catch(() => ({ detail: "upstream_error" }));
      return noStoreJson({ status: "error", message: payload?.detail || "upstream_error" }, cpResponse.status);
    }

    const state = await writeSelfLearningV4State(body);
    return noStoreJson({ status: "ok", state, updatedAt: state.updatedAt, storage: "local-fallback" }, 200);
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_self_learning_v4_state") {
      return noStoreJson({ status: "error", message: "invalid self-learning v4 state" }, 400);
    }
    return noStoreJson({ status: "error", message: "unable to persist self-learning v4 state" }, 500);
  }
}