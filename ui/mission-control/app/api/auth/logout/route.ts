import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { buildAppUrl } from "../../../../lib/redirect";

export async function POST(request: Request): Promise<NextResponse> {
  const cookieStore = await cookies();
  cookieStore.delete("mc_token");
  return NextResponse.redirect(buildAppUrl(request, "/login"));
}
