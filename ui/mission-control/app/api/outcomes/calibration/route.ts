import { NextResponse } from "next/server";

import { cpFetch } from "../../../../lib/controlPlane";

export async function GET(): Promise<NextResponse> {
  const response = await cpFetch("/v1/outcomes/calibration");
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
