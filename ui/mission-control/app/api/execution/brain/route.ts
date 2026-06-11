import { NextRequest, NextResponse } from "next/server";

import { cpFetch, extractMcContextHeaders } from "../../../../lib/controlPlane";

function noStoreJson(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const forwardedHeaders = extractMcContextHeaders(request);
    forwardedHeaders.set("Content-Type", "application/json");

    const response = await cpFetch("/v1/execution/brain", {
      method: "POST",
      headers: forwardedHeaders,
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(async () => {
      const raw = await response.text().catch(() => "");
      return {
        detail: "invalid_upstream_json",
        raw: raw.slice(0, 200),
      };
    });

    if (response.ok) {
      return noStoreJson(payload, 200);
    }

    return noStoreJson(
      {
        detail: "execution_brain_degraded",
        degraded: true,
        upstream_status: response.status,
        payload,
      },
      200,
    );
  } catch {
    return noStoreJson(
      {
        detail: "execution_brain_unreachable",
        degraded: true,
      },
      200,
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limit = request.nextUrl.searchParams.get("limit") || "50";
  try {
    const response = await cpFetch(`/v1/execution/brain/journal/recent?limit=${encodeURIComponent(limit)}`, {
      headers: extractMcContextHeaders(request),
    });
    const payload = await response.json().catch(async () => {
      const raw = await response.text().catch(() => "");
      return {
        detail: "invalid_upstream_json",
        raw: raw.slice(0, 200),
      };
    });

    if (response.ok && Array.isArray(payload)) {
      return noStoreJson(payload, 200);
    }

    return noStoreJson([], 200);
  } catch {
    return noStoreJson([], 200);
  }
}
