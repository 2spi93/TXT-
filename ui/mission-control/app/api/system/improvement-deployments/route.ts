import { NextRequest, NextResponse } from "next/server";

import { cpFetchJsonSafe, extractMcContextHeaders, withControlPlaneNetwork } from "../../../../lib/controlPlane";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = request.nextUrl.searchParams.toString();
  const path = `/v1/system/improvement-deployments${query ? `?${query}` : ""}`;
  const { response, payload, network } = await cpFetchJsonSafe(path, {
    headers: extractMcContextHeaders(request),
  });
  return NextResponse.json(withControlPlaneNetwork(payload, network, { includeMetrics: false }), { status: response.status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.text();
  const { response, payload, network } = await cpFetchJsonSafe("/v1/system/improvement-deployments", {
    method: "POST",
    headers: {
      ...Object.fromEntries(extractMcContextHeaders(request).entries()),
      "Content-Type": "application/json",
    },
    body,
  });
  return NextResponse.json(withControlPlaneNetwork(payload, network, { includeMetrics: false }), { status: response.status });
}