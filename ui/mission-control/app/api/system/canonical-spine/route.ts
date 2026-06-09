import { NextRequest, NextResponse } from "next/server";

import { getControlPlaneToken } from "../../../../lib/controlPlane";
import { buildCanonicalSpineHealthSnapshot } from "../../../../lib/canonicalSpineHealth";

function unauthorized(): NextResponse {
  return NextResponse.json({ message: "Authentication required" }, { status: 401 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = await getControlPlaneToken();
  if (!token) {
    return unauthorized();
  }
  const sinceDays = Number(request.nextUrl.searchParams.get("sinceDays") || request.nextUrl.searchParams.get("since_days") || 30);
  const forceFresh = ["1", "true", "yes"].includes(String(request.nextUrl.searchParams.get("fresh") || "").toLowerCase());
  const snapshot = await buildCanonicalSpineHealthSnapshot({ sinceDays, bypassCache: forceFresh });
  return NextResponse.json(snapshot, { status: 200, headers: { "Cache-Control": "no-store" } });
}