import { cookies } from "next/headers";

const baseUrl = process.env.CONTROL_PLANE_URL || "http://127.0.0.1:8000";
const fallbackToken = process.env.CONTROL_PLANE_TOKEN || "";
const controlPlaneGlobal = globalThis as typeof globalThis & {
  __mcE2eDegradedWarnedKeys?: Set<string>;
};
const degradedWarnedKeys = controlPlaneGlobal.__mcE2eDegradedWarnedKeys || new Set<string>();
if (!controlPlaneGlobal.__mcE2eDegradedWarnedKeys) {
  controlPlaneGlobal.__mcE2eDegradedWarnedKeys = degradedWarnedKeys;
}

function isE2eDevDegradedModeEnabled(): boolean {
  const raw = String(process.env.MC_E2E_DEV_DEGRADED || "").toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function warnDegradedOnce(key: string, message: string): void {
  if (degradedWarnedKeys.has(key)) {
    return;
  }
  degradedWarnedKeys.add(key);
  console.warn(message);
}

function toRouteFamily(path: string): string {
  const [rawPath] = String(path).split("?");
  const segments = rawPath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "/";
  }
  if (segments[0] !== "v1") {
    return `/${segments.slice(0, Math.min(2, segments.length)).join("/")}`;
  }
  if (segments.length === 1) {
    return "/v1";
  }
  if (segments.length === 2) {
    return `/v1/${segments[1]}`;
  }
  return `/v1/${segments[1]}/${segments[2]}/*`;
}

export async function getControlPlaneToken(): Promise<string> {
  let cookieToken = "";
  try {
    const maybeCookies = cookies as unknown as (() => Promise<{ get?: (name: string) => { value?: string } | undefined }>) | undefined;
    const store = typeof maybeCookies === "function" ? await maybeCookies() : undefined;
    cookieToken = store?.get?.("mc_token")?.value || "";
  } catch {
    cookieToken = "";
  }
  return cookieToken || fallbackToken;
}

export function getControlPlaneUrl(): string {
  return baseUrl;
}

export function extractMcContextHeaders(request: Request): Headers {
  const forwarded = new Headers();
  const names = [
    "x-mc-request-type",
    "x-mc-priority",
    "x-mc-market-volatility",
    "x-mc-signal-state",
    "x-mc-symbol",
    "x-mc-origin",
  ];
  for (const name of names) {
    const value = request.headers.get(name);
    if (value) {
      forwarded.set(name, value);
    }
  }
  return forwarded;
}

export async function cpFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getControlPlaneToken();
  const headers = new Headers(init.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch (error) {
    if (!isE2eDevDegradedModeEnabled()) {
      throw error;
    }

    const method = String(init.method || "GET").toUpperCase();
    const family = toRouteFamily(path);
    const key = `${method} ${family}`;
    warnDegradedOnce(
      key,
      `[mc:e2e-dev] control-plane unavailable (${key}) -> returning degraded 503 responses for this family`,
    );

    return new Response(
      JSON.stringify({
        detail: "control_plane_unreachable_e2e_dev",
        method,
        path,
        baseUrl,
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json",
          "x-mc-e2e-degraded": "1",
        },
      },
    );
  }
}
