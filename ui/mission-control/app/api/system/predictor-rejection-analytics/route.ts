import { NextRequest, NextResponse } from "next/server";

import { requireControlPlaneSession } from "../../../../lib/apiAuth";
import {
  assertPredictorRejectionAnalyticsSnapshot,
  buildPredictorRejectionAnalyticsSnapshot,
} from "../../../../lib/predictorRejectionAnalytics";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireControlPlaneSession();
  if (authError) {
    return authError;
  }
  try {
    const sinceDays = Math.max(1, Math.min(365, Math.round(Number(request.nextUrl.searchParams.get("sinceDays") || 30))));
    const snapshot = assertPredictorRejectionAnalyticsSnapshot(
      await buildPredictorRejectionAnalyticsSnapshot({ sinceDays }),
    );
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Predictor analytics contract failure" },
      { status: 500 },
    );
  }
}