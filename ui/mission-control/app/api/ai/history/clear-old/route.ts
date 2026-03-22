import { NextResponse } from "next/server";

import { cpFetch } from "../../../../../lib/controlPlane";

export async function POST(): Promise<NextResponse> {
  const response = await cpFetch("/v1/ai/history/clear-old", {
    method: "POST",
  });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
