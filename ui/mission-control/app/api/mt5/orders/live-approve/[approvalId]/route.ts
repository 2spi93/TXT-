import { NextResponse } from "next/server";

import { cpFetch } from "../../../../../../lib/controlPlane";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ approvalId: string }> },
): Promise<NextResponse> {
  const resolved = await params;
  const response = await cpFetch(`/v1/mt5/orders/live-approve/${resolved.approvalId}`, {
    method: "POST",
  });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
