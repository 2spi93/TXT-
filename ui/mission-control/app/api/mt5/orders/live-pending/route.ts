import { NextResponse } from "next/server";

import { requireControlPlaneSession } from "../../../../../lib/apiAuth";
import { getControlPlaneNetworkMetricsSnapshot } from "../../../../../lib/controlPlane";
import { cpFetchMt5Live } from "../../../../../lib/controlPlaneMt5Live";

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
  const authError = await requireControlPlaneSession();
  if (authError) {
    return authError;
  }
  try {
    const result = await cpFetchMt5Live("/v1/mt5/orders/live-pending", {
      method: "GET",
      timeoutMs: MT5_LIVE_PENDING_TIMEOUT_MS,
    });
    return NextResponse.json(result.payload, { status: result.status });
  } catch {
    return NextResponse.json(fallbackPayload("mt5_live_pending_unreachable"), { status: 200 });
  }
}
