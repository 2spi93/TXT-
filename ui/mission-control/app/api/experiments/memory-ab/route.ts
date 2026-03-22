import { NextResponse } from "next/server";

import { cpFetch } from "../../../../lib/controlPlane";

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const windowHours = Number(searchParams.get("window_hours") || 168);
  const safeWindow = Math.max(24, Math.min(24 * 30, windowHours));
  const response = await cpFetch(`/v1/experiments/memory-ab?window_hours=${safeWindow}`);
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
