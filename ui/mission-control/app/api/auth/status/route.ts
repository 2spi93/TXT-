import { NextResponse } from "next/server";

import { cpFetchJsonSafe, getControlPlaneToken, getControlPlaneUrl } from "../../../../lib/controlPlane";

export async function GET(): Promise<NextResponse> {
  const token = await getControlPlaneToken();
  if (!token) {
    return NextResponse.json({
      authenticated: false,
      controlPlaneUrl: getControlPlaneUrl(),
      username: "",
      role: "",
    });
  }

  let username = "";
  let role = "";
  try {
    const { response, payload } = await cpFetchJsonSafe("/v1/auth/me", { cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      return NextResponse.json({
        authenticated: false,
        controlPlaneUrl: getControlPlaneUrl(),
        username: "",
        role: "",
      });
    }
    if (response.ok && payload && typeof payload === "object") {
      const authPayload = payload as Record<string, unknown>;
      username = String(authPayload.username || "").trim();
      role = String(authPayload.role || "").trim();
    }
  } catch {
    username = "";
    role = "";
  }

  return NextResponse.json({
    authenticated: true,
    controlPlaneUrl: getControlPlaneUrl(),
    username,
    role,
  });
}