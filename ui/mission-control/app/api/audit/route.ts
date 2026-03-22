import { NextRequest, NextResponse } from "next/server";

import { cpFetch } from "../../../lib/controlPlane";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limit = request.nextUrl.searchParams.get("limit") || "100";
  const response = await cpFetch(`/v1/audit?limit=${encodeURIComponent(limit)}`);
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
