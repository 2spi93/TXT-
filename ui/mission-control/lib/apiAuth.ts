import { NextResponse } from "next/server";

import { getServerRole } from "./serverAuth";

type ControlPlaneSessionOptions = {
  allowServiceProbe?: boolean;
};

export function unauthorizedJson(message = "Authentication required"): NextResponse {
  return NextResponse.json(
    { message },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    },
  );
}

function extractBearerToken(request?: Request): string {
  const header = String(request?.headers.get("authorization") || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return header.slice("bearer ".length).trim();
}

function resolveServiceProbeToken(): string {
  return String(
    process.env.CONTROLLED_LIVE_GATE_AUTH_TOKEN
    || process.env.MC_OPERATOR_PROBE_TOKEN
    || process.env.CONTROL_PLANE_INTERNAL_TOKEN
    || process.env.CONTROL_PLANE_TOKEN
    || "",
  ).trim();
}

export async function requireControlPlaneSession(
  request?: Request,
  options?: ControlPlaneSessionOptions,
): Promise<NextResponse | null> {
  if (options?.allowServiceProbe) {
    const bearerToken = extractBearerToken(request);
    const serviceProbeToken = resolveServiceProbeToken();
    if (bearerToken && serviceProbeToken && bearerToken === serviceProbeToken) {
      return null;
    }
  }
  const role = await getServerRole();
  return role ? null : unauthorizedJson();
}
