import { NextResponse } from "next/server";

import { cpFetch, extractMcContextHeaders } from "../../../../../lib/controlPlane";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ decisionId: string }> },
): Promise<NextResponse> {
  const resolved = await params;
  const response = await cpFetch(`/v1/execution/replay/${encodeURIComponent(resolved.decisionId)}`, {
    headers: extractMcContextHeaders(request),
  });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
