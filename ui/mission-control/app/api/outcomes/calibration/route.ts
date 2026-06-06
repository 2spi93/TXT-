import { NextResponse } from "next/server";

import { cpFetchJsonSafe, getControlPlaneNetworkMetricsSnapshot } from "../../../../lib/controlPlane";

const OUTCOMES_CALIBRATION_TIMEOUT_MS = 4_000;

function fallbackPayload(detail: string): Record<string, unknown> {
  return {
    status: "degraded",
    detail,
    buckets: [],
    edge_state_buckets: [],
    edge_score_buckets: [],
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
      }, OUTCOMES_CALIBRATION_TIMEOUT_MS);
    });
    const result = await Promise.race([
      cpFetchJsonSafe("/v1/outcomes/calibration", { signal: controller.signal }),
      timeout,
    ]);
    if (!result) {
      return NextResponse.json(fallbackPayload("outcomes_calibration_timeout"), { status: 200 });
    }
    const { response, payload } = result;
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(fallbackPayload("outcomes_calibration_unreachable"), { status: 200 });
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
