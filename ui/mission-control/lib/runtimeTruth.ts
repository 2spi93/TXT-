import { cpFetchJsonSafe, type ControlPlaneNetworkMeta } from "./controlPlane";
import { getControlledCollectionSessionSummary } from "./controlledCollectionWatch";
import { getRuntimeDecisionAnalytics } from "./runtimeDecisionAnalytics";

if (typeof window !== "undefined") {
  throw new Error("runtimeTruth is server-only");
}

type JsonMap = Record<string, unknown>;
type CpFetchResult = Awaited<ReturnType<typeof cpFetchJsonSafe>>;
type RuntimeDecisionSummary = Awaited<ReturnType<typeof getRuntimeDecisionAnalytics>>;

type TruthVerdict = "READY" | "BLOCKED" | "DEGRADED";

type RuntimeTruthSnapshot = {
  schema_version: "runtime-truth/v1";
  generated_at: string;
  scope: {
    symbol: string;
    market_instrument: string;
    timeframe: string;
    strategy: string;
  };
  verdict: TruthVerdict;
  summary: string;
  blockers: string[];
  degraded_reasons: string[];
  degraded: boolean;
  partial_data: boolean;
  layers: {
    market: JsonMap;
    execution: JsonMap;
    health: JsonMap;
    routing: JsonMap;
    readiness: JsonMap;
    publication: JsonMap;
    watchdog: JsonMap;
    observation: JsonMap;
  };
  raw: {
    kill_switch: unknown;
    system_config: unknown;
    opportunity_gate: unknown;
    market_session: unknown;
    mt5_health: unknown;
    runtime_decision: RuntimeDecisionSummary | null;
    controlled_collection: Awaited<ReturnType<typeof getControlledCollectionSessionSummary>>;
    network: Record<string, ControlPlaneNetworkMeta>;
  };
};

type RuntimeTruthGlobal = typeof globalThis & {
  __runtimeTruthCache__?: Map<string, { createdAtMs: number; snapshot: RuntimeTruthSnapshot }>;
  __runtimeTruthInflight__?: Map<string, Promise<RuntimeTruthSnapshot>>;
};

const runtimeTruthGlobal = globalThis as RuntimeTruthGlobal;
const runtimeTruthCache = runtimeTruthGlobal.__runtimeTruthCache__ || new Map<string, { createdAtMs: number; snapshot: RuntimeTruthSnapshot }>();
const runtimeTruthInflight = runtimeTruthGlobal.__runtimeTruthInflight__ || new Map<string, Promise<RuntimeTruthSnapshot>>();

runtimeTruthGlobal.__runtimeTruthCache__ = runtimeTruthCache;
runtimeTruthGlobal.__runtimeTruthInflight__ = runtimeTruthInflight;

const RUNTIME_TRUTH_CP_TIMEOUT_MS = 8_000;
const RUNTIME_TRUTH_ANALYTICS_TIMEOUT_MS = 8_000;
const RUNTIME_TRUTH_CACHE_MS = 2_000;

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function boundedNetwork(path: string, status = 504): ControlPlaneNetworkMeta {
  return {
    network_state: "degraded",
    retry_count: 0,
    degraded_flag: true,
    failure_classification: status === 504 ? "timeout" : "network_unknown",
    failure_detail: `runtime truth bounded fetch failed for ${path}`,
    attempted_targets: [path],
    attempted_base_urls: [],
    upstream_status: status,
  };
}

function fallbackFetchResult(path: string, status = 504): CpFetchResult {
  const payload = { detail: status === 504 ? "runtime_truth_timeout" : "runtime_truth_fetch_failed", path };
  return {
    response: new Response(JSON.stringify(payload), { status }),
    payload,
    network: boundedNetwork(path, status),
  };
}

async function cpFetchBounded(path: string, timeoutMs = RUNTIME_TRUTH_CP_TIMEOUT_MS): Promise<CpFetchResult> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const fallback = fallbackFetchResult(path, 504);
  const timeoutPromise = new Promise<CpFetchResult>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve(fallback);
    }, timeoutMs);
  });
  const fetchPromise = cpFetchJsonSafe(path, { signal: controller.signal })
    .catch(() => fallbackFetchResult(path, 503))
    .finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });
  return Promise.race([fetchPromise, timeoutPromise]);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return Promise.race([
    promise.finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }),
    timeoutPromise,
  ]);
}

function deriveVerdict(input: {
  killSwitchActive: boolean;
  gateKnown: boolean;
  gateEnabled: boolean;
  marketOpen: boolean;
  marketReason: string;
  runtimeDecision: RuntimeDecisionSummary | null;
  runtimeReliabilityBlocked: boolean;
  mt5Degraded: boolean;
  controlledWatchStale: boolean;
  partialData: boolean;
}): { verdict: TruthVerdict; blockers: string[]; degradedReasons: string[]; summary: string } {
  const blockers: string[] = [];
  const degradedReasons: string[] = [];
  if (input.killSwitchActive) {
    blockers.push("kill_switch_active");
  }
  if (input.gateKnown && !input.gateEnabled) {
    blockers.push("opportunity_gate_blocked");
  }
  if (!input.marketOpen) {
    blockers.push(`market_closed:${input.marketReason || "unknown"}`);
  }
  const reliabilityState = String(input.runtimeDecision?.reliability?.state || "").trim();
  const liveState = String(input.runtimeDecision?.opportunity?.liveState || "").trim();
  if (reliabilityState && reliabilityState !== "RELIABLE") {
    if (input.runtimeReliabilityBlocked) {
      blockers.push(`runtime_reliability:${reliabilityState}`);
    } else {
      degradedReasons.push(`runtime_reliability:${reliabilityState}`);
    }
  }
  if (liveState && !["GO", "LIVE"].includes(liveState)) {
    if (["NO_DATA_AUTH", "NO_DATA_PARTIAL", "NO_DATA_EMPTY", "STALE"].includes(liveState)) {
      blockers.push(`live_state:${liveState}`);
    } else {
      degradedReasons.push(`live_state:${liveState}`);
    }
  }
  if (input.controlledWatchStale) {
    degradedReasons.push("controlled_collection_watch_stale");
  }
  if (input.mt5Degraded) {
    degradedReasons.push("mt5_health_degraded");
  }
  if (input.partialData) {
    degradedReasons.push("partial_data");
  }

  const verdict: TruthVerdict = blockers.length > 0
    ? "BLOCKED"
    : degradedReasons.length > 0
      ? "DEGRADED"
      : "READY";
  const summary = verdict === "READY"
    ? "Runtime truth READY: no canonical blocker detected."
    : verdict === "DEGRADED"
      ? `Runtime truth DEGRADED: ${degradedReasons.join(", ") || "partial data"}.`
      : `Runtime truth BLOCKED: ${blockers.join(", ")}.`;
  return { verdict, blockers, degradedReasons, summary };
}

function cacheKey(input: Required<RuntimeTruthInput>): string {
  return [input.symbol, input.marketInstrument, input.timeframe, input.strategy].join("::");
}

export type RuntimeTruthInput = {
  symbol?: string;
  marketInstrument?: string;
  timeframe?: string;
  strategy?: string;
  bypassCache?: boolean;
};

async function buildRuntimeTruthSnapshotUncached(input: Required<RuntimeTruthInput>): Promise<RuntimeTruthSnapshot> {
  const generatedAt = new Date().toISOString();
  const runtimeDecisionScope = input.symbol === "DESK"
    ? {}
    : {
        symbol: input.symbol,
        timeframe: input.timeframe,
        strategy: input.strategy,
      };
  const [killSwitchResult, systemConfigResult, gateResult, marketSessionResult, mt5HealthResult, controlledCollection, runtimeDecision] = await Promise.all([
    cpFetchBounded("/v1/system/kill-switch"),
    cpFetchBounded("/v1/system/config"),
    cpFetchBounded("/v1/system/opportunity-gate"),
    cpFetchBounded(`/v1/market/session-state?instrument=${encodeURIComponent(input.marketInstrument)}`),
    cpFetchBounded("/v1/mt5/health"),
    getControlledCollectionSessionSummary().catch(() => null),
    withTimeout(
      getRuntimeDecisionAnalytics({
        ...runtimeDecisionScope,
        limit: 600,
        sinceDays: 7,
        samples: 1,
      }).catch(() => null),
      RUNTIME_TRUTH_ANALYTICS_TIMEOUT_MS,
      null,
    ),
  ]);

  const killSwitchPayload = asRecord(killSwitchResult.payload);
  const killSwitchState = asRecord(killSwitchPayload.state || killSwitchPayload);
  const systemConfig = asRecord(systemConfigResult.payload);
  const gatePayload = asRecord(gateResult.payload);
  const gateState = asRecord(gatePayload.gate || gatePayload);
  const marketSession = asRecord(marketSessionResult.payload);
  const mt5Health = asRecord(mt5HealthResult.payload);
  const controlled = controlledCollection || {
    available: false,
    active: false,
    baselineSince: null,
    openedAt: null,
    lastSnapshotAt: null,
    durationMinutes: 0,
    cycles: 0,
    phase: "UNAVAILABLE",
    fillsSeen: 0,
    labelsSeen: 0,
    killSwitchRearmed: false,
    killSwitchActive: false,
    killSwitchReason: null,
    killSwitchSource: "unavailable" as const,
    watchStale: true,
    watchAgeMinutes: null,
    gateStatus: null,
    gateHealthScore: null,
    latestFillAt: null,
    latestLabeledAt: null,
    archivePath: "",
    statePath: "",
  };

  const network = {
    kill_switch: killSwitchResult.network,
    system_config: systemConfigResult.network,
    opportunity_gate: gateResult.network,
    market_session: marketSessionResult.network,
    mt5_health: mt5HealthResult.network,
  };
  const partialData = Object.values(network).some((item) => item.degraded_flag) || runtimeDecision === null || controlled.phase === "UNAVAILABLE";
  const killSwitchActive = Boolean(killSwitchState.active);
  const gateStatusRaw = String(gateState.status || "").trim().toLowerCase();
  const gateKnown = typeof gateState.opportunity_enabled === "boolean" || Boolean(gateStatusRaw);
  const gateEnabled = gateKnown
    ? typeof gateState.opportunity_enabled === "boolean"
      ? Boolean(gateState.opportunity_enabled)
      : gateStatusRaw === "go"
    : true;
  const marketOpen = typeof marketSession.market_open === "boolean" ? Boolean(marketSession.market_open) : true;
  const marketReason = String(marketSession.market_status_reason || "unknown");
  const mt5Degraded = !mt5HealthResult.response.ok || Boolean(mt5Health.degraded) || Boolean(mt5Health.error);
  const controlledWatchStale = Boolean(controlled.watchStale);
  const runtimeReliability = asRecord(runtimeDecision?.reliability);
  const verdict = deriveVerdict({
    killSwitchActive,
    gateKnown,
    gateEnabled,
    marketOpen,
    marketReason,
    runtimeDecision,
    runtimeReliabilityBlocked: Boolean(runtimeReliability.blocked),
    mt5Degraded,
    controlledWatchStale,
    partialData,
  });
  const backendMode = String(systemConfig.system_mode || "guarded_auto");
  const runtimeSummary = runtimeDecision?.deskRead?.summary || "runtime decision unavailable";
  const gateReasons = asArray<string>(gateState.reasons);

  return {
    schema_version: "runtime-truth/v1",
    generated_at: generatedAt,
    scope: {
      symbol: input.symbol,
      market_instrument: input.marketInstrument,
      timeframe: input.timeframe,
      strategy: input.strategy,
    },
    verdict: verdict.verdict,
    summary: verdict.summary,
    blockers: verdict.blockers,
    degraded_reasons: verdict.degradedReasons,
    degraded: verdict.verdict !== "READY",
    partial_data: partialData,
    layers: {
      market: {
        status: marketOpen ? "OPEN" : "CLOSED",
        reason: marketReason,
        session: String(marketSession.session || "unknown"),
        next_open_at: marketSession.next_market_open_at || null,
        as_of: marketSession.as_of || null,
      },
      execution: {
        provider: "mt5",
        degraded: mt5Degraded,
        health_status: mt5Health.status || mt5Health.detail || (mt5Degraded ? "degraded" : "ok"),
        bridge_mode: mt5Health.mode || mt5Health.execution_mode || null,
        account_id: mt5Health.account_id || mt5Health.account || null,
      },
      health: {
        kill_switch_active: killSwitchActive,
        kill_switch_reason: killSwitchState.reason || null,
        backend_mode: backendMode,
        system_mode: killSwitchActive ? "LOCKED" : backendMode === "managed_live" ? "LIVE" : "SAFE",
      },
      routing: {
        opportunity_enabled: gateKnown ? gateEnabled : null,
        status: gateKnown ? String(gateState.status || (gateEnabled ? "go" : "no-go")) : "unknown",
        health_score: toNumber(gateState.health_score, 0),
        reasons: gateReasons,
      },
      readiness: {
        runtime_reliability: runtimeDecision?.reliability?.state || "UNAVAILABLE",
        live_state: runtimeDecision?.opportunity?.liveState || "UNAVAILABLE",
        observation_status: runtimeDecision?.observation?.status || "UNAVAILABLE",
        summary: runtimeSummary,
      },
      publication: {
        partial_data: partialData,
        generated_at: generatedAt,
        cache_ttl_ms: RUNTIME_TRUTH_CACHE_MS,
      },
      watchdog: {
        status: verdict.verdict === "READY" ? "OK" : verdict.verdict === "DEGRADED" ? "WARNING" : "HALT",
        blockers: verdict.blockers,
        degraded_reasons: verdict.degradedReasons,
        partial_data: partialData,
      },
      observation: {
        controlled_collection_phase: controlled.phase,
        active: controlled.active,
        watch_stale: controlled.watchStale,
        watch_age_minutes: controlled.watchAgeMinutes,
        kill_switch_source: controlled.killSwitchSource,
        fills_seen: controlled.fillsSeen,
        labels_seen: controlled.labelsSeen,
      },
    },
    raw: {
      kill_switch: killSwitchResult.payload,
      system_config: systemConfigResult.payload,
      opportunity_gate: gateResult.payload,
      market_session: marketSessionResult.payload,
      mt5_health: mt5HealthResult.payload,
      runtime_decision: runtimeDecision,
      controlled_collection: controlled,
      network,
    },
  };
}

export async function buildRuntimeTruthSnapshot(options: RuntimeTruthInput = {}): Promise<RuntimeTruthSnapshot> {
  const input: Required<RuntimeTruthInput> = {
    symbol: String(options.symbol || "DESK").trim().toUpperCase() || "DESK",
    marketInstrument: String(options.marketInstrument || options.symbol || "BTCUSDT").trim().toUpperCase() || "BTCUSDT",
    timeframe: String(options.timeframe || "live").trim() || "live",
    strategy: String(options.strategy || "live-ops").trim() || "live-ops",
    bypassCache: Boolean(options.bypassCache),
  };
  const key = cacheKey(input);
  const cached = input.bypassCache ? null : runtimeTruthCache.get(key);
  if (cached && Date.now() - cached.createdAtMs <= RUNTIME_TRUTH_CACHE_MS) {
    return cached.snapshot;
  }
  let inflight = runtimeTruthInflight.get(key);
  if (!inflight) {
    inflight = buildRuntimeTruthSnapshotUncached(input).finally(() => {
      runtimeTruthInflight.delete(key);
    });
    runtimeTruthInflight.set(key, inflight);
  }
  const snapshot = await inflight;
  runtimeTruthCache.set(key, { createdAtMs: Date.now(), snapshot });
  return snapshot;
}
