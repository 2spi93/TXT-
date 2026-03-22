import { NextResponse } from "next/server";

import { cpFetch } from "../../../lib/controlPlane";

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const payload = {
    strategy_id: String(form.get("strategy_id") || "").trim(),
    name: String(form.get("name") || "").trim(),
    market: String(form.get("market") || "").trim(),
    setup_type: String(form.get("setup_type") || "").trim(),
    notes: String(form.get("notes") || "").trim(),
  };

  const response = await cpFetch("/v1/strategies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return NextResponse.redirect(new URL("/?strategy_error=1", request.url));
  }
  return NextResponse.redirect(new URL("/", request.url));
}
