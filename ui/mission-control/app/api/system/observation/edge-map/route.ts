import { NextResponse } from "next/server";

import { getEdgeObservationSummary } from "../../../../../lib/edgeObservation";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const windowHours = Number(url.searchParams.get("windowHours") || 24);
  const payload = await getEdgeObservationSummary(Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24);
  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}