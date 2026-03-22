import { NextRequest, NextResponse } from "next/server";

import { cpFetch, extractMcContextHeaders } from "../../../../../lib/controlPlane";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limit = request.nextUrl.searchParams.get("limit") || "50";

  const response = await cpFetch(`/v1/execution/telemetry/recent?limit=${encodeURIComponent(limit)}`, {
    headers: extractMcContextHeaders(request),
  });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
