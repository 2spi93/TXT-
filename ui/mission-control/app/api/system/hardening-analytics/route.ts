import { NextRequest, NextResponse } from "next/server";

import { requireControlPlaneSession } from "../../../../lib/apiAuth";
import { buildHardeningAnalyticsSnapshot } from "../../../../lib/hardeningAnalytics";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireControlPlaneSession();
  if (authError) {
    return authError;
  }
  const sinceDays = Math.max(1, Math.min(365, Math.round(Number(request.nextUrl.searchParams.get("sinceDays") || 30))));
  const snapshot = await buildHardeningAnalyticsSnapshot({ sinceDays });
  return NextResponse.json(snapshot);
}