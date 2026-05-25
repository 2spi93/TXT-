import { NextRequest, NextResponse } from "next/server";

import { getControlPlaneToken } from "../../../../../lib/controlPlane";
import { readRuntimeDecisionKpiSnapshots } from "../../../../../lib/runtimeDecisionKpiStore";
import { getRuntimeDecisionAnalytics } from "../../../../../lib/runtimeDecisionAnalytics";
import { ensureRuntimeDecisionWriterStarted } from "../../../../../lib/runtimeDecisionWriter";
import { readV2RiskJournalEntries } from "../../../../../lib/v2RiskJournal";

function unauthorized(): NextResponse {
  return NextResponse.json({ message: "Authentication required" }, { status: 401 });
}

function safeFilenamePart(value: string, fallback: string): string {
  const normalized = String(value || "").trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = await getControlPlaneToken();
  if (!token) {
    return unauthorized();
  }

  ensureRuntimeDecisionWriterStarted();

  const requestedSymbol = request.nextUrl.searchParams.get("symbol") || "";
  const deskScope = requestedSymbol.trim().toUpperCase() === "DESK";
  const symbol = deskScope ? "" : requestedSymbol;
  const timeframe = deskScope ? "" : request.nextUrl.searchParams.get("timeframe") || "";
  const strategy = deskScope ? "" : request.nextUrl.searchParams.get("strategy") || "";
  const limit = Number(request.nextUrl.searchParams.get("limit") || 1200);
  const sinceDays = Number(request.nextUrl.searchParams.get("sinceDays") || 7);
  const samples = Number(request.nextUrl.searchParams.get("samples") || 3);
  const historyLimit = Number(request.nextUrl.searchParams.get("historyLimit") || 20);
  const download = String(request.nextUrl.searchParams.get("download") || "") === "1";

  const summary = await getRuntimeDecisionAnalytics({ symbol, timeframe, strategy, limit, sinceDays, samples });
  const [kpiHistory, journalEntries] = await Promise.all([
    readRuntimeDecisionKpiSnapshots({ symbol, timeframe, strategy, limit: historyLimit, sinceDays }),
    readV2RiskJournalEntries({ symbol, timeframe, strategy, limit: historyLimit, sinceDays }),
  ]);
  const decisionJournal = journalEntries
    .filter((entry) => Boolean(entry.decisionOutcome))
    .map((entry) => ({
      timestamp: entry.createdAtIso,
      decisionOutcome: entry.decisionOutcome || null,
      action: entry.action,
      detail: entry.detail,
    }));
  const reviewRows = kpiHistory.map((item) => ({
    timestamp: item.timestamp,
    driftProbability: item.driftProbability,
    reliability: item.reliability,
    opportunityScore: item.opportunityScore,
    decisionOutcome: item.decisionOutcome,
  }));
  const payload = {
    exportedAtIso: new Date().toISOString(),
    scope: summary.scope,
    reviewRows,
    latestSnapshot: kpiHistory[0] || null,
    kpiHistory,
    decisionJournal,
    observation: summary.observation,
    deskRead: summary.deskRead,
  };

  const headers = new Headers({
    "Cache-Control": "no-store, no-cache, must-revalidate",
  });
  if (download) {
    const filename = [
      "runtime-decision-review",
      safeFilenamePart(summary.scope.symbol, "desk"),
      safeFilenamePart(summary.scope.timeframe, "runtime"),
      safeFilenamePart(summary.scope.strategy, "default"),
    ].join("-");
    headers.set("Content-Disposition", `attachment; filename="${filename}.json"`);
  }

  return NextResponse.json(payload, { headers });
}