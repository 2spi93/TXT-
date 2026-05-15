import { NextRequest, NextResponse } from "next/server";

import { getControlPlaneToken } from "../../../../../lib/controlPlane";
import {
  ensureRuntimeDecisionWriterStarted,
  getRuntimeDecisionWriterSnapshot,
  persistRuntimeDecisionWriterScope,
  runRuntimeDecisionWriterCycle,
} from "../../../../../lib/runtimeDecisionWriter";

function unauthorized(): NextResponse {
  return NextResponse.json({ message: "Authentication required" }, { status: 401 });
}

function hasExplicitScope(body: Record<string, unknown>): boolean {
  return ["symbol", "timeframe", "strategy", "limit", "sinceDays", "samples"].some((key) => body[key] != null);
}

export async function GET(): Promise<NextResponse> {
  const token = await getControlPlaneToken();
  if (!token) {
    return unauthorized();
  }

  ensureRuntimeDecisionWriterStarted();
  return NextResponse.json({ scheduler: getRuntimeDecisionWriterSnapshot() });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = await getControlPlaneToken();
  if (!token) {
    return unauthorized();
  }

  ensureRuntimeDecisionWriterStarted();
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  if (hasExplicitScope(body)) {
    const result = await persistRuntimeDecisionWriterScope({
      symbol: String(body.symbol || "").trim(),
      timeframe: String(body.timeframe || "").trim(),
      strategy: String(body.strategy || "").trim(),
      limit: Number(body.limit || 0) || undefined,
      sinceDays: Number(body.sinceDays || 0) || undefined,
      samples: Number(body.samples || 0) || undefined,
    });
    return NextResponse.json({ result, scheduler: getRuntimeDecisionWriterSnapshot() });
  }

  const result = await runRuntimeDecisionWriterCycle();
  return NextResponse.json({ result, scheduler: getRuntimeDecisionWriterSnapshot() });
}