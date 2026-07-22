import { NextResponse } from "next/server";

import { getControlledCollectionSessionSummary } from "../../../../../lib/controlledCollectionWatch";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const payload = await getControlledCollectionSessionSummary();
  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}