import { NextResponse } from "next/server";

import { cpFetch } from "../../../lib/controlPlane";

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const status = String(searchParams.get("status") || "").trim();
  const path = status ? `/v1/incidents?status=${encodeURIComponent(status)}` : "/v1/incidents";
  const response = await cpFetch(path);
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
