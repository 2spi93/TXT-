import { NextResponse } from "next/server";

import { cpFetchJsonSafe, getControlPlaneNetworkMetricsSnapshot } from "../../../../../lib/controlPlane";

const MT5_LIVE_PENDING_TIMEOUT_MS = 4_000;

function fallbackPayload(detail: string): Record<string, unknown> {
  return {
    status: "degraded",
    detail,
    rows: [],
    network_metrics: getControlPlaneNetworkMetricsSnapshot(),
  };
}

export async function GET(): Promise<NextResponse> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, MT5_LIVE_PENDING_TIMEOUT_MS);
    });
    const result = await Promise.race([
      cpFetchJsonSafe("/v1/mt5/orders/live-pending", { signal: controller.signal }),
      timeout,
    ]);
    if (!result) {
      return NextResponse.json(fallbackPayload("mt5_live_pending_timeout"), { status: 200 });
    }
    const { response, payload } = result;
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(fallbackPayload("mt5_live_pending_unreachable"), { status: 200 });
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
