import { NextResponse } from "next/server";

import { cpFetchJsonSafe } from "../../../../lib/controlPlane";

export async function GET(): Promise<NextResponse> {
  try {
    const [healthResult, capacityResult, providersResult] = await Promise.all([
      cpFetchJsonSafe("/v1/ai/health"),
      cpFetchJsonSafe("/v1/ai/capacity"),
      cpFetchJsonSafe("/v1/ai/providers"),
    ]);

    const degraded = !healthResult.response.ok || !capacityResult.response.ok || !providersResult.response.ok;
    return NextResponse.json(
      {
        health: healthResult.payload,
        capacity: capacityResult.payload,
        providers: providersResult.payload,
        degraded,
        upstream: {
          health: healthResult.response.status,
          capacity: capacityResult.response.status,
          providers: providersResult.response.status,
        },
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
      {
        health: { status: "unavailable" },
        capacity: { status: "unavailable" },
        providers: [],
        degraded: true,
        detail: "ai_health_unreachable",
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      },
    );
  }
}
