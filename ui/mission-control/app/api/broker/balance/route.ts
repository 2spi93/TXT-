import { NextResponse } from "next/server";

import { cpFetchJsonSafe, getControlPlaneNetworkMetricsSnapshot } from "../../../../lib/controlPlane";

const BROKER_BALANCE_TIMEOUT_MS = 4_000;

function fallbackPayload(detail: string): Record<string, unknown> {
  return {
    status: "degraded",
    detail,
    balances: [],
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
      }, BROKER_BALANCE_TIMEOUT_MS);
    });
    const result = await Promise.race([
      cpFetchJsonSafe("/v1/broker/balance", { signal: controller.signal }),
      timeout,
    ]);
    if (!result) {
      return NextResponse.json(fallbackPayload("broker_balance_timeout"), { status: 200 });
    }
    const { response, payload } = result;
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(fallbackPayload("broker_balance_unreachable"), { status: 200 });
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}