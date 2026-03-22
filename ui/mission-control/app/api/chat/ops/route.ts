import { NextResponse } from "next/server";

import { cpFetch } from "../../../../lib/controlPlane";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json();
  const response = await cpFetch("/v1/copilot/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
