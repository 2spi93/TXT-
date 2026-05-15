import { NextRequest, NextResponse } from "next/server";

import { cpFetchJsonSafe, extractMcContextHeaders } from "../../../../../../lib/controlPlane";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const venue = request.nextUrl.searchParams.get("venue") || "";
  const instrument = request.nextUrl.searchParams.get("instrument") || "";
  const limit = request.nextUrl.searchParams.get("limit") || "24";
  const params = new URLSearchParams();
  if (venue.trim()) {
    params.set("venue", venue.trim());
  }
  if (instrument.trim()) {
    params.set("instrument", instrument.trim());
  }
  params.set("limit", limit);

  const { response, payload } = await cpFetchJsonSafe(
    `/v1/market/trades/preprocessor/analytics?${params.toString()}`,
    { headers: extractMcContextHeaders(request) },
  );

  return NextResponse.json(payload, { status: response.status });
}