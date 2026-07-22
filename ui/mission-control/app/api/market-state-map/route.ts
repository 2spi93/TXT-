import { NextRequest, NextResponse } from "next/server";

import { getControlPlaneToken } from "../../../lib/controlPlane";
import { getEdgeObservationSummary } from "../../../lib/edgeObservation";
import { buildMarketMemorySummary } from "../../../lib/marketMemory";
import { buildMarketStateMapSnapshot } from "../../../lib/marketStateMap";
import { buildTradabilityAnalyticsSummary } from "../../../lib/tradabilityAnalytics";
import { readV2RiskJournalEntries } from "../../../lib/v2RiskJournal";

function unauthorized(): NextResponse {
  return NextResponse.json({ message: "Authentication required" }, { status: 401 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = await getControlPlaneToken();
  if (!token) {
    return unauthorized();
  }

  const symbol = request.nextUrl.searchParams.get("symbol") || "DESK";
  const timeframeParam = request.nextUrl.searchParams.get("timeframe") || "live";
  const timeframe = timeframeParam.trim().toUpperCase() === "ALL" ? "" : timeframeParam;
  const strategy = request.nextUrl.searchParams.get("strategy") || "live-ops";
  const venue = request.nextUrl.searchParams.get("venue") || "MULTI";
  const currentRegime = request.nextUrl.searchParams.get("currentRegime") || "";
  const limit = Number(request.nextUrl.searchParams.get("limit") || 1200);
  const sinceDays = Number(request.nextUrl.searchParams.get("sinceDays") || 14);
  const windowHours = Number(request.nextUrl.searchParams.get("windowHours") || 24);

  const entries = await readV2RiskJournalEntries({
    symbol,
    timeframe,
    strategy,
    limit,
    sinceDays,
  });
  const tradability = buildTradabilityAnalyticsSummary(entries, { currentRegime });
  const marketMemory = buildMarketMemorySummary(entries);
  const edgeObservation = await getEdgeObservationSummary(windowHours);
  const snapshot = buildMarketStateMapSnapshot({
    symbol,
    timeframe: timeframe || "ALL",
    venue,
    windowHours,
    tradability,
    edgeObservation,
    marketMemory,
  });

  return NextResponse.json(snapshot);
}