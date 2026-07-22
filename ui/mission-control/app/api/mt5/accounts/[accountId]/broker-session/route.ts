import { NextResponse } from "next/server";

import { cpFetchJsonSafe } from "../../../../../../lib/controlPlane";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
): Promise<NextResponse> {
  const { accountId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const { response, payload } = await cpFetchJsonSafe(`/v1/mt5/accounts/${encodeURIComponent(accountId)}/broker-session`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return NextResponse.json(payload, { status: response.status });
}