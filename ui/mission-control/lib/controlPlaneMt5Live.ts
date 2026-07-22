import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type Mt5LiveRequestInit = {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
};

type Mt5LiveResponse = {
  status: number;
  payload: unknown;
};

function getServiceToken(): string {
  return String(process.env.CONTROL_PLANE_INTERNAL_TOKEN || process.env.CONTROL_PLANE_TOKEN || "").trim();
}

function getControlPlaneCandidates(path: string): string[] {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const configured = [
    String(process.env.CONTROL_PLANE_URL || "").trim(),
    String(process.env.CONTROL_PLANE_FALLBACK_URL || "").trim(),
  ].filter(Boolean);
  const deduped: string[] = [];
  for (const base of configured) {
    const url = `${base.replace(/\/$/, "")}${suffix}`;
    if (!deduped.includes(url)) {
      deduped.push(url);
    }
  }
  return deduped;
}

function parseStatus(stderr: string): number {
  const matches = stderr.match(/HTTP\/\d+(?:\.\d+)?\s+(\d{3})/g);
  if (!matches || matches.length === 0) {
    return 0;
  }
  const last = matches[matches.length - 1].match(/(\d{3})$/);
  return last ? Number.parseInt(last[1], 10) : 0;
}

function parseJsonSafe(stdout: string): unknown {
  const raw = String(stdout || "").trim();
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {
      detail: "invalid_upstream_json",
      raw: raw.slice(0, 500),
    };
  }
}

export async function cpFetchMt5Live(path: string, init: Mt5LiveRequestInit = {}): Promise<Mt5LiveResponse> {
  const token = getServiceToken();
  const method = init.method || "GET";
  const timeoutMs = Math.max(1000, init.timeoutMs || 15000);
  const candidates = getControlPlaneCandidates(path);
  let lastError: unknown = null;
  let lastStatus = 0;
  let lastPayload: unknown = { detail: "control_plane_unreachable" };

  for (const url of candidates) {
    const args = [
      "-S",
      "-q",
      "-O",
      "-",
      "-T",
      String(Math.max(1, Math.ceil(timeoutMs / 1000))),
      "--header",
      `Authorization: Bearer ${token}`,
      "--header",
      "Accept: application/json",
    ];
    if (method === "POST") {
      args.push("--header", "Content-Type: application/json");
      args.push("--post-data", JSON.stringify(init.body || {}));
    }
    args.push(url);
    try {
      const { stdout, stderr } = await execFileAsync("wget", args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 });
      const status = parseStatus(stderr);
      return { status: status || 200, payload: parseJsonSafe(stdout) };
    } catch (error) {
      lastError = error;
      const stdout = typeof error === "object" && error && "stdout" in error ? String((error as { stdout?: string }).stdout || "") : "";
      const stderr = typeof error === "object" && error && "stderr" in error ? String((error as { stderr?: string }).stderr || "") : "";
      const status = parseStatus(stderr);
      const payload = parseJsonSafe(stdout);
      if (status > 0) {
        lastStatus = status;
        lastPayload = payload;
        if (status < 500) {
          return { status, payload };
        }
      }
    }
  }

  if (lastStatus > 0) {
    return { status: lastStatus, payload: lastPayload };
  }
  return {
    status: 503,
    payload: {
      detail: "control_plane_unreachable",
      error: lastError instanceof Error ? lastError.message : String(lastError || "unknown_error"),
    },
  };
}