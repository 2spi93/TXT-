import { NextResponse } from "next/server";

import { cpFetch } from "../../../../lib/controlPlane";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const limit = url.searchParams.get("limit") || "50";
  const response = await cpFetch(`/v1/outcomes/recent?limit=${encodeURIComponent(limit)}`);
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
