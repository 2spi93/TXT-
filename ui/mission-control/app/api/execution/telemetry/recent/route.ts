import { NextRequest, NextResponse } from "next/server";

import { cpFetchJsonSafe, extractMcContextHeaders } from "../../../../../lib/controlPlane";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limit = request.nextUrl.searchParams.get("limit") || "50";

  const { response, payload } = await cpFetchJsonSafe(`/v1/execution/telemetry/recent?limit=${encodeURIComponent(limit)}`, {
    headers: extractMcContextHeaders(request),
  });
  return NextResponse.json(payload, { status: response.status });
}
