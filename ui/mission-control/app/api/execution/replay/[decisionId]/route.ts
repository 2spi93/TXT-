import { NextResponse } from "next/server";

import { cpFetchJsonSafe, extractMcContextHeaders } from "../../../../../lib/controlPlane";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ decisionId: string }> },
): Promise<NextResponse> {
  const resolved = await params;
  const { response, payload } = await cpFetchJsonSafe(`/v1/execution/replay/${encodeURIComponent(resolved.decisionId)}`, {
    headers: extractMcContextHeaders(request),
  });
  return NextResponse.json(payload, { status: response.status });
}
