import { NextResponse } from "next/server";

import { getControlPlaneSessionToken, getControlPlaneUrl } from "../../../../lib/controlPlane";

const directControlPlaneAuthMeUrl = "http://control-plane:8000/v1/auth/me";

export async function GET(): Promise<NextResponse> {
  const token = await getControlPlaneSessionToken();
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
    const response = await fetch(directControlPlaneAuthMeUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) {
      return NextResponse.json({
        authenticated: false,
        controlPlaneUrl: getControlPlaneUrl(),
        username: "",
        role: "",
      });
    }
    const payload = await response.json().catch(() => null);
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