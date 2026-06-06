import { NextResponse } from "next/server";

import { cpFetchJsonSafe, getControlPlaneNetworkMetricsSnapshot, withControlPlaneNetwork } from "../../../../lib/controlPlane";

const LIVE_READINESS_OVERVIEW_TIMEOUT_MS = 4_000;

function timedOutPayload(): Record<string, unknown> {
  return {
    status: "degraded",
    degraded: true,
    upstream_status: 0,
    detail: "live_readiness_timeout",
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
      }, LIVE_READINESS_OVERVIEW_TIMEOUT_MS);
    });
    const result = await Promise.race([
      cpFetchJsonSafe("/v1/live-readiness/overview", { signal: controller.signal }),
      timeout,
    ]);
    if (!result) {
      return NextResponse.json(timedOutPayload(), {
        status: 200,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }
    const { response, payload, network } = result;
    const payloadRecord = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    return NextResponse.json(
      {
        ...withControlPlaneNetwork(payloadRecord, network),
        degraded: Boolean(payloadRecord.degraded) || !response.ok,
        upstream_status: response.status,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      },
    );
  } catch {
    return NextResponse.json(
      timedOutPayload(),
      {
        status: 200,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      },
    );
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
