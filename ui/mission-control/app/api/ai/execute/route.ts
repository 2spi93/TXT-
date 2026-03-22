import { NextResponse } from "next/server";

import { cpFetch, extractMcContextHeaders } from "../../../../lib/controlPlane";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json();
  const forwardedHeaders = extractMcContextHeaders(request);
  forwardedHeaders.set("Content-Type", "application/json");
  const response = await cpFetch("/v1/ai/execute", {
    method: "POST",
    headers: forwardedHeaders,
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
