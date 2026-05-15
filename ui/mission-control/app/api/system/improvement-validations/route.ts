import { NextRequest, NextResponse } from "next/server";

import { cpFetchJsonSafe, extractMcContextHeaders, withControlPlaneNetwork } from "../../../../lib/controlPlane";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.text();
  const { response, payload, network } = await cpFetchJsonSafe("/v1/system/improvement-validations", {
    method: "POST",
    headers: {
      ...Object.fromEntries(extractMcContextHeaders(request).entries()),
      "Content-Type": "application/json",
    },
    body,
  });
  return NextResponse.json(withControlPlaneNetwork(payload, network, { includeMetrics: false }), { status: response.status });
}