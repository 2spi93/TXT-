import { NextResponse } from "next/server";

import { requireControlPlaneSession } from "../../../../lib/apiAuth";
import { readSourceTreeProvenanceAudit } from "../../../../lib/sourceTreeProvenance";

export async function GET(): Promise<NextResponse> {
  const authError = await requireControlPlaneSession();
  if (authError) {
    return authError;
  }

  const audit = await readSourceTreeProvenanceAudit();
  return NextResponse.json(audit, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}