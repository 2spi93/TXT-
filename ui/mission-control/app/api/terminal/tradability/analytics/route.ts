import { NextRequest, NextResponse } from "next/server";

import { getControlPlaneToken } from "../../../../../lib/controlPlane";
import { buildTradabilityAnalyticsSummary } from "../../../../../lib/tradabilityAnalytics";
import { readV2RiskJournalEntries } from "../../../../../lib/v2RiskJournal";

function unauthorized(): NextResponse {
  return NextResponse.json({ message: "Authentication required" }, { status: 401 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = await getControlPlaneToken();
  if (!token) {
    return unauthorized();
  }

  const symbol = request.nextUrl.searchParams.get("symbol") || "";
  const timeframe = request.nextUrl.searchParams.get("timeframe") || "";
  const strategy = request.nextUrl.searchParams.get("strategy") || "";
  const currentRegime = request.nextUrl.searchParams.get("currentRegime") || "";
  const limit = Number(request.nextUrl.searchParams.get("limit") || 1200);
  const sinceDays = Number(request.nextUrl.searchParams.get("sinceDays") || 14);

  const entries = await readV2RiskJournalEntries({
    symbol,
    timeframe,
    strategy,
    action: "tradability-snapshot",
    limit,
    sinceDays,
  });

  const summary = buildTradabilityAnalyticsSummary(entries, { currentRegime });
  return NextResponse.json(summary);
}
