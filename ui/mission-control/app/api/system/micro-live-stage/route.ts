import { NextResponse } from "next/server";

import { requireControlPlaneSession } from "../../../../lib/apiAuth";
import { cpFetchJsonSafe, withControlPlaneNetwork } from "../../../../lib/controlPlane";

export async function GET(request: Request): Promise<NextResponse> {
  const authError = await requireControlPlaneSession();
  if (authError) {
    return authError;
  }
  const url = new URL(request.url);
  const provider = String(url.searchParams.get("provider") || "").trim();
  const target = provider ? `/v1/system/micro-live-stage?provider=${encodeURIComponent(provider)}` : "/v1/system/micro-live-stage";
  const { response, payload, network } = await cpFetchJsonSafe(target);
  return NextResponse.json(withControlPlaneNetwork(payload, network), { status: response.status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const authError = await requireControlPlaneSession();
  if (authError) {
    return authError;
  }
  const body = await request.json().catch(() => ({}));
  const { response, payload, network } = await cpFetchJsonSafe("/v1/system/micro-live-stage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return NextResponse.json(withControlPlaneNetwork(payload, network), { status: response.status });
}