import { NextResponse } from "next/server";

import { cpFetch } from "../../../../lib/controlPlane";

export async function GET(): Promise<NextResponse> {
  const [healthResponse, capacityResponse, providersResponse] = await Promise.all([
    cpFetch("/v1/ai/health"),
    cpFetch("/v1/ai/capacity"),
    cpFetch("/v1/ai/providers"),
  ]);

  const [health, capacity, providers] = await Promise.all([
    healthResponse.json(),
    capacityResponse.json(),
    providersResponse.json(),
  ]);

  return NextResponse.json(
    {
      health,
      capacity,
      providers,
    },
    { status: 200 },
  );
}
