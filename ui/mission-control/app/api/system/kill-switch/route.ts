import { NextResponse } from "next/server";

import { requireControlPlaneSession } from "../../../../lib/apiAuth";
import { cpFetchJsonSafe, withControlPlaneNetwork, type ControlPlaneNetworkMeta } from "../../../../lib/controlPlane";

const KILL_SWITCH_TIMEOUT_MS = 4_000;

type CpFetchJsonSafeResult = Awaited<ReturnType<typeof cpFetchJsonSafe>>;

function timedOutNetworkMeta(path: string): ControlPlaneNetworkMeta {
  return {
    network_state: "degraded",
    retry_count: 0,
    degraded_flag: true,
    failure_classification: "timeout",
    failure_detail: `Kill switch bounded fetch timed out for ${path}`,
    attempted_targets: [path],
    attempted_base_urls: [],
    upstream_status: 504,
  };
}

function timedOutPayload(path: string): Record<string, unknown> {
  return {
    status: "degraded",
    degraded: true,
    detail: "kill_switch_timeout",
    path,
    state: {
      active: true,
      reason: "kill_switch_status_timeout",
      source: "mission_control_ui_fallback",
    },
    thresholds: {},
  };
}

function timedOutCpFetchResult(path: string, status = 200): CpFetchJsonSafeResult {
  const payload = timedOutPayload(path);
  return {
    response: new Response(JSON.stringify(payload), { status }),
    payload,
    network: timedOutNetworkMeta(path),
  };
}

function cpFetchJsonSafeBounded(path: string, init?: RequestInit, timeoutMs = KILL_SWITCH_TIMEOUT_MS, timeoutStatus = 200): Promise<CpFetchJsonSafeResult> {
  const fallback = timedOutCpFetchResult(path, timeoutStatus);
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<CpFetchJsonSafeResult>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve(fallback);
    }, timeoutMs);
  });
  const fetchPromise = cpFetchJsonSafe(path, { ...(init || {}), signal: controller.signal })
    .catch(() => fallback)
    .finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });
  return Promise.race([fetchPromise, timeoutPromise]);
}

export async function GET(): Promise<NextResponse> {
  const authError = await requireControlPlaneSession();
  if (authError) {
    return authError;
  }
  const { response, payload, network } = await cpFetchJsonSafeBounded("/v1/system/kill-switch");
  return NextResponse.json(withControlPlaneNetwork(payload, network), { status: response.status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const authError = await requireControlPlaneSession();
  if (authError) {
    return authError;
  }
  const body = await request.json().catch(() => ({}));
  const { response, payload, network } = await cpFetchJsonSafeBounded("/v1/system/kill-switch/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  }, KILL_SWITCH_TIMEOUT_MS, 504);
  return NextResponse.json(withControlPlaneNetwork(payload, network), { status: response.status });
}
