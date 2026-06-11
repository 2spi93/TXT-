import { NextResponse } from "next/server";

import { cpFetchJsonSafe } from "../../../../../../lib/controlPlane";
import { projectPositionTruthSnapshot } from "../../../../../../lib/positionTruthContract";

export async function GET(
  _request: Request,
  context: { params: Promise<{ accountId: string }> },
): Promise<NextResponse> {
  const { accountId } = await context.params;
  const { response, payload } = await cpFetchJsonSafe(`/v1/internal/accounts/${encodeURIComponent(accountId)}/verification`);
  if (!response.ok) {
    return NextResponse.json(payload, { status: response.status });
  }
  try {
    return NextResponse.json(projectPositionTruthSnapshot(payload), { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "PositionTruth contract failure" },
      { status: 500 },
    );
  }
}