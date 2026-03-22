import { NextResponse } from "next/server";

import { cpFetch } from "../../../../lib/controlPlane";

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get("limit") || "30";
  const response = await cpFetch(`/v1/ai/history?limit=${encodeURIComponent(limit)}`);
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
