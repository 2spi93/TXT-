import { NextRequest, NextResponse } from "next/server";

import { cpFetch, extractMcContextHeaders } from "../../../../../../lib/controlPlane";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ venue: string; instrument: string }> },
): Promise<NextResponse> {
  const resolved = await params;
  const response = await cpFetch(`/v1/broker/orderbook/${encodeURIComponent(resolved.venue)}/${encodeURIComponent(resolved.instrument)}`, {
    headers: extractMcContextHeaders(request),
  });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}