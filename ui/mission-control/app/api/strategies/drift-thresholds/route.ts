import { NextResponse } from "next/server";

import { cpFetch } from "../../../../lib/controlPlane";

export async function GET(): Promise<NextResponse> {
  const response = await cpFetch("/v1/strategies/drift-thresholds");
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json();
  const response = await cpFetch("/v1/strategies/drift-thresholds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
