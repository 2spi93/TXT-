import { NextResponse } from "next/server";

import { requireControlPlaneSession } from "../../../../lib/apiAuth";
import { buildInitialTerminalOperatorSnapshot } from "../../../terminal/operatorSnapshot";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const authError = await requireControlPlaneSession();
  if (authError) {
    return authError;
  }

  const snapshot = await buildInitialTerminalOperatorSnapshot().catch(() => null);

  return NextResponse.json(snapshot || {
    status: "unavailable",
    generated_at: new Date().toISOString(),
    cards: [],
  }, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}