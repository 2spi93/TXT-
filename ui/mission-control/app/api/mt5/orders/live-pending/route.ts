import { NextResponse } from "next/server";

import { cpFetch, readJsonFromResponseSafe } from "../../../../../lib/controlPlane";

export async function GET(): Promise<NextResponse> {
  const response = await cpFetch("/v1/mt5/orders/live-pending");
  const payload = await readJsonFromResponseSafe(response);
  return NextResponse.json(payload, { status: response.status });
}
