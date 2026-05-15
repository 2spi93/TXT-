import { NextRequest, NextResponse } from "next/server";

import { getControlPlaneToken } from "../../../../lib/controlPlane";
import { getRuntimeDecisionAnalytics } from "../../../../lib/runtimeDecisionAnalytics";
import { ensureRuntimeDecisionWriterStarted } from "../../../../lib/runtimeDecisionWriter";

function unauthorized(): NextResponse {
  return NextResponse.json({ message: "Authentication required" }, { status: 401 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = await getControlPlaneToken();
  if (!token) {
    return unauthorized();
  }

  ensureRuntimeDecisionWriterStarted();

  const symbol = request.nextUrl.searchParams.get("symbol") || "";
  const timeframe = request.nextUrl.searchParams.get("timeframe") || "";
  const strategy = request.nextUrl.searchParams.get("strategy") || "";
  const limit = Number(request.nextUrl.searchParams.get("limit") || 1200);
  const sinceDays = Number(request.nextUrl.searchParams.get("sinceDays") || 7);
  const samples = Number(request.nextUrl.searchParams.get("samples") || 3);

  const summary = await getRuntimeDecisionAnalytics({ symbol, timeframe, strategy, limit, sinceDays, samples });
  return NextResponse.json(summary);
}