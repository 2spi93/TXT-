import { NextResponse } from "next/server";

import { cpFetchJsonSafe, extractMcContextHeaders } from "../../../../lib/controlPlane";
import { evaluateDecisionGovernanceCapability } from "../../../../lib/decisionGovernanceControl";

export async function POST(request: Request): Promise<NextResponse> {
  const governance = await evaluateDecisionGovernanceCapability("llm_trader");
  if (!governance.allowed) {
    return NextResponse.json(governance, { status: 412 });
  }
  const body = await request.json();
  const forwardedHeaders = extractMcContextHeaders(request);
  forwardedHeaders.set("Content-Type", "application/json");
  const { response, payload } = await cpFetchJsonSafe("/v1/ai/execute", {
    method: "POST",
    headers: forwardedHeaders,
    body: JSON.stringify(body),
  });
  return NextResponse.json(payload, { status: response.status });
}
