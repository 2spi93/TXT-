import { NextRequest, NextResponse } from "next/server";

import { buildGovernanceReplayViewSummary } from "../../../../app/terminal/governanceReplayView";
import { getControlPlaneToken } from "../../../../lib/controlPlane";
import { readV2RiskJournalEntries } from "../../../../lib/v2RiskJournal";

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
  const sinceDays = Number(request.nextUrl.searchParams.get("sinceDays") || 30);

  const entries = await readV2RiskJournalEntries({
    symbol,
    timeframe,
    strategy,
    limit,
    sinceDays,
  });

  const payload = buildGovernanceReplayViewSummary({
    symbol,
    timeframe,
    strategy,
    currentRegime,
    entries,
  });

  return NextResponse.json(payload);
}