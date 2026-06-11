import { NextResponse } from "next/server";

import { cpFetch, readJsonFromResponseSafe } from "../../../../lib/controlPlane";

export async function GET(): Promise<NextResponse> {
  const response = await cpFetch("/v1/strategies/drift");
  const payload = await readJsonFromResponseSafe(response);
  return NextResponse.json(payload, { status: response.status });
}
