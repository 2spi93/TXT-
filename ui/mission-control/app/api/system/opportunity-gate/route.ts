import { NextResponse } from "next/server";

import { cpFetchJsonSafe, getControlPlaneNetworkMetricsSnapshot } from "../../../../lib/controlPlane";

const OPPORTUNITY_GATE_TIMEOUT_MS = 4_000;

function fallbackPayload(detail: string): Record<string, unknown> {
  return {
    status: "unknown",
    opportunity_enabled: false,
    valid_observation: false,
    kill_switch_recommended: false,
    detail,
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
      }, OPPORTUNITY_GATE_TIMEOUT_MS);
    });
    const result = await Promise.race([
      cpFetchJsonSafe("/v1/system/opportunity-gate", { signal: controller.signal }),
      timeout,
    ]);
    if (!result) {
      return NextResponse.json(fallbackPayload("opportunity_gate_timeout"), { status: 200 });
    }
    const { response, payload } = result;
    return NextResponse.json(payload, { status: response.ok ? 200 : response.status });
  } catch {
    return NextResponse.json(fallbackPayload("opportunity_gate_unreachable"), { status: 200 });
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}