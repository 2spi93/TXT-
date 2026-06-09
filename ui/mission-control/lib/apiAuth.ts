import { NextResponse } from "next/server";

import { getServerRole } from "./serverAuth";

export function unauthorizedJson(message = "Authentication required"): NextResponse {
  return NextResponse.json(
    { message },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    },
  );
}

export async function requireControlPlaneSession(): Promise<NextResponse | null> {
  const role = await getServerRole();
  return role ? null : unauthorizedJson();
}