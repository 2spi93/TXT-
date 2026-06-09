import { request as httpRequest } from "node:http";

import { NextResponse } from "next/server";

import { requireControlPlaneSession } from "../../../../lib/apiAuth";
import { cpFetchJsonSafe, getControlPlaneToken, type ControlPlaneNetworkMeta, withControlPlaneNetwork } from "../../../../lib/controlPlane";

const directControlPlaneModeUrl = "http://control-plane:8000/v1/system/mode";

async function postSystemModeDirect(body: unknown): Promise<{
  status: number;
  payload: unknown;
  network: ControlPlaneNetworkMeta;
}> {
  const target = new URL(directControlPlaneModeUrl);
  const requestBody = JSON.stringify(body || {});
  const token = await getControlPlaneToken();
  const upstream = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      target,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(requestBody)),
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode || 500, body: raw });
        });
      },
    );
    req.setTimeout(30_000, () => {
      req.destroy(new Error("control_plane_mode_timeout"));
    });
    req.on("error", reject);
    req.write(requestBody);
    req.end();
  });

  let payload: unknown = {};
  try {
    payload = upstream.body ? JSON.parse(upstream.body) as unknown : {};
  } catch {
    payload = {
      detail: "invalid_upstream_json",
      raw: upstream.body.slice(0, 500),
    };
  }

  return {
    status: upstream.status,
    payload,
    network: {
      network_state: "healthy",
      retry_count: 0,
      degraded_flag: false,
      failure_classification: "none",
      failure_detail: "",
      attempted_targets: [`${target.origin}#1`],
      attempted_base_urls: [target.origin],
      upstream_status: upstream.status,
    },
  };
}

export async function GET(): Promise<NextResponse> {
  const authError = await requireControlPlaneSession();
  if (authError) {
    return authError;
  }
  const { response, payload, network } = await cpFetchJsonSafe("/v1/system/config");
  return NextResponse.json(withControlPlaneNetwork(payload, network), { status: response.status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const authError = await requireControlPlaneSession();
  if (authError) {
    return authError;
  }
  const body = await request.json().catch(() => ({}));
  const { status, payload, network } = await postSystemModeDirect(body);
  return NextResponse.json(withControlPlaneNetwork(payload, network), { status });
}