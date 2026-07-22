import { cpFetchJsonSafe, getControlPlaneToken } from "../../lib/controlPlane";
import { getRuntimeDecisionAnalytics } from "../../lib/runtimeDecisionAnalytics";
import { buildRuntimeTruthSnapshot } from "../../lib/runtimeTruth";
import { buildRuntimeReadonlyProjection } from "../terminal/runtimeReadonlyProjection";

type JsonMap = Record<string, unknown>;
type SafeControlPlaneJsonResult = Awaited<ReturnType<typeof cpFetchJsonSafe>>;

const LIVE_OPS_SERVER_BOOTSTRAP_SCOPE = {
  symbol: "DESK",
  timeframe: "live",
  strategy: "live-ops",
} as const;

const LIVE_OPS_SERVER_BOOTSTRAP_TIMEOUT_MS = 1_200;
const LIVE_OPS_SERVER_BOOTSTRAP_CONTROL_TIMEOUT_MS = 900;

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

function mapSystemMode(mode: string, killSwitchActive: boolean): "SAFE" | "LIVE" | "LOCKED" {
  if (killSwitchActive) {
    return "LOCKED";
  }
  if (mode === "managed_live") {
    return "LIVE";
  }
  return "SAFE";
}

function buildTimedOutControlPlaneResult(path: string, timeoutMs: number): SafeControlPlaneJsonResult {
  return {
    response: new Response(
      JSON.stringify({
        detail: "control_plane_request_timeout",
        path,
        timeout_ms: timeoutMs,
      }),
      {
        status: 504,
        headers: {
          "content-type": "application/json",
        },
      },
    ),
    payload: {
      detail: "control_plane_request_timeout",
      path,
      timeout_ms: timeoutMs,
    },
    network: {
      network_state: "degraded",
      retry_count: 0,
      degraded_flag: true,
      failure_classification: "timeout",
      failure_detail: `${path} timed out after ${timeoutMs}ms`,
      attempted_targets: [],
      attempted_base_urls: [],
      upstream_status: 504,
    },
  };
}

async function cpFetchJsonSafeBounded(path: string, timeoutMs = LIVE_OPS_SERVER_BOOTSTRAP_CONTROL_TIMEOUT_MS): Promise<SafeControlPlaneJsonResult> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<SafeControlPlaneJsonResult>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve(buildTimedOutControlPlaneResult(path, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      cpFetchJsonSafe(path),
      timeoutPromise,
    ]);
  } catch (error) {
    return {
      response: new Response(
        JSON.stringify({
          detail: "control_plane_request_failed",
          path,
          error: error instanceof Error ? error.message : "unknown_error",
        }),
        {
          status: 503,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
      payload: {
        detail: "control_plane_request_failed",
        path,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      network: {
        network_state: "degraded",
        retry_count: 0,
        degraded_flag: true,
        failure_classification: "network_unknown",
        failure_detail: error instanceof Error ? error.message : "unknown_error",
        attempted_targets: [],
        attempted_base_urls: [],
        upstream_status: 503,
      },
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function buildBootstrapCompactRead(input: {
  systemMode: "SAFE" | "LIVE" | "LOCKED";
  backendMode: string;
  watchdogStatus: "OK" | "WARNING" | "HALT";
  healthScore: number;
  gateStatus: string;
  gateEnabled: boolean;
  killSwitchActive: boolean;
  recoveryMode: string;
  alertCount: number;
  triggerCount: number;
}) {
  const driftTone = input.watchdogStatus === "OK" ? "good" : input.watchdogStatus === "HALT" ? "warn" : "subtle";
  const opportunityTone = input.gateEnabled ? (input.gateStatus === "GO" ? "good" : "subtle") : "warn";
  const liveTone = input.systemMode === "LIVE" ? "good" : input.systemMode === "LOCKED" ? "warn" : "subtle";
  const recoveryLabel = input.recoveryMode === "RECOVERY_LOCKDOWN"
    ? "lockdown"
    : input.recoveryMode === "SAFE_RECOVERY"
      ? "safe recovery"
      : "nominal";
  const alertLabel = `${input.alertCount} alert${input.alertCount > 1 ? "s" : ""}`;
  const triggerLabel = `${input.triggerCount} trigger${input.triggerCount > 1 ? "s" : ""}`;

  return {
    driftTone,
    driftLabel: `DRIFT ${input.watchdogStatus === "OK" ? "stable" : input.watchdogStatus === "WARNING" ? "guarded" : "halt"}`,
    driftMeta: `Health ${input.healthScore.toFixed(0)}% · ${triggerLabel}`,
    opportunityTone,
    opportunityLabel: `OPPORTUNITY ${input.gateEnabled ? input.gateStatus : "blocked"}`,
    opportunityMeta: `Mode ${input.systemMode} · backend ${input.backendMode}`,
    observationTone: input.killSwitchActive ? "warn" : "subtle",
    observationLabel: `OBS ${input.killSwitchActive ? "locked" : "bounded"}`,
    observationMeta: `Recovery ${recoveryLabel} · ${alertLabel}`,
    liveTone,
    liveLabel: `LIVE ${input.systemMode.toLowerCase()}`,
    liveMeta: input.killSwitchActive
      ? `Kill switch actif · ${alertLabel}`
      : `Gate ${input.gateStatus.toLowerCase()} · ${recoveryLabel}`,
    state: "bootstrap",
  };
}

export async function buildInitialLiveOpsBootstrapPayload(): Promise<JsonMap | null> {
  const token = await getControlPlaneToken().catch(() => "");
  if (!token) {
    return null;
  }

  const generatedAt = new Date().toISOString();
  const [killSwitchResult, systemConfigResult, gateResult, runtimeTruthSnapshot, runtimeDecisionSummary] = await Promise.all([
    cpFetchJsonSafeBounded("/v1/system/kill-switch"),
    cpFetchJsonSafeBounded("/v1/system/config"),
    cpFetchJsonSafeBounded("/v1/system/opportunity-gate"),
    Promise.race([
      buildRuntimeTruthSnapshot({
        ...LIVE_OPS_SERVER_BOOTSTRAP_SCOPE,
        marketInstrument: "BTCUSDT",
        bypassCache: true,
      }).catch(() => null),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), LIVE_OPS_SERVER_BOOTSTRAP_TIMEOUT_MS);
      }),
    ]),
    Promise.race([
      getRuntimeDecisionAnalytics({
        limit: 600,
        sinceDays: 7,
        samples: 1,
      }).catch(() => null),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), LIVE_OPS_SERVER_BOOTSTRAP_TIMEOUT_MS);
      }),
    ]),
  ]);

  const killSwitchPayload = asRecord(killSwitchResult.payload);
  const killSwitchState = asRecord(killSwitchPayload.state);
  const systemConfig = asRecord(systemConfigResult.payload);
  const gatePayload = asRecord(gateResult.payload);
  const gateState = asRecord(gatePayload.gate);
  const gateReasons = asArray<string>(gateState.reasons);
  const killSwitchActive = Boolean(killSwitchState.active);
  const backendMode = String(systemConfig.system_mode || "guarded_auto");
  const systemMode = mapSystemMode(backendMode, killSwitchActive);
  const gateEnabled = Boolean(gateState.opportunity_enabled);
  const gateStatus = String(gateState.status || (gateEnabled ? "GO" : "blocked")).toUpperCase();
  const gateHealthScore = Math.max(0, Math.min(100, toNumber(gateState.health_score, gateEnabled ? 100 : 0)));
  const runtimeTruth = asRecord(runtimeTruthSnapshot);
  const runtimeTruthVerdict = String(runtimeTruth.verdict || "").trim().toUpperCase();
  const runtimeTruthBlockers = asArray<string>(runtimeTruth.blockers).map((item) => String(item)).filter(Boolean);
  const runtimeTruthDegradedReasons = asArray<string>(runtimeTruth.degraded_reasons).map((item) => String(item)).filter(Boolean);
  const gateWatchdogStatus = killSwitchActive || !gateEnabled
    ? "HALT"
    : gateHealthScore >= 80
      ? "OK"
      : gateHealthScore >= 45
        ? "WARNING"
        : "HALT";
  const watchdogStatus = runtimeTruthVerdict === "BLOCKED"
    ? "HALT"
    : runtimeTruthVerdict === "DEGRADED"
      ? "WARNING"
      : runtimeTruthVerdict === "READY"
        ? gateWatchdogStatus
        : gateWatchdogStatus;
  const bootstrapHealthScore = runtimeTruthVerdict === "BLOCKED"
    ? Math.min(gateHealthScore, 25)
    : runtimeTruthVerdict === "DEGRADED"
      ? Math.max(45, Math.min(gateHealthScore || 65, 65))
      : gateHealthScore;
  const recoveryMode = killSwitchActive ? "RECOVERY_LOCKDOWN" : watchdogStatus === "WARNING" ? "SAFE_RECOVERY" : "NOMINAL";
  const watchdogTriggers = [
    ...(runtimeTruthVerdict === "BLOCKED" ? ["runtime_truth_blocked"] : []),
    ...(runtimeTruthVerdict === "DEGRADED" ? ["runtime_truth_degraded"] : []),
    ...(killSwitchActive ? ["kill_switch_active"] : []),
    ...(!gateEnabled && !runtimeTruthVerdict ? ["opportunity_gate_blocked"] : []),
  ];
  const bootstrapAlerts = [
    ...(runtimeTruthVerdict === "BLOCKED" ? [{ severity: "critical", code: "runtime_truth_blocked", message: "Runtime truth blocked", detail: runtimeTruthBlockers.join(", ") || String(runtimeTruth.summary || "canonical truth blocked") }] : []),
    ...(runtimeTruthVerdict === "DEGRADED" ? [{ severity: "warn", code: "runtime_truth_degraded", message: "Runtime truth degraded", detail: runtimeTruthDegradedReasons.join(", ") || String(runtimeTruth.summary || "canonical truth degraded") }] : []),
    ...(killSwitchActive ? [{ severity: "critical", code: "kill_switch_active", message: "System critical", detail: String(killSwitchState.reason || "kill switch active") }] : []),
    ...(!gateEnabled && !runtimeTruthVerdict ? [{ severity: "critical", code: "opportunity_gate_blocked", message: "Opportunity gate blocked", detail: String(gateReasons.join(", ") || "gate blocked") }] : []),
  ];

  const runtimeProjectionSeed = buildRuntimeReadonlyProjection({
    runtimeDecisionSummary,
    runtimeDecisionError: runtimeDecisionSummary ? null : "Runtime decision seed indisponible",
    generatedAt,
  });
  const bootstrapCompactRead = buildBootstrapCompactRead({
    systemMode,
    backendMode,
    watchdogStatus,
    healthScore: bootstrapHealthScore,
    gateStatus,
    gateEnabled,
    killSwitchActive,
    recoveryMode,
    alertCount: bootstrapAlerts.length,
    triggerCount: watchdogTriggers.length,
  });
  const controlledCollectionStatus = killSwitchActive
    ? "LOCKED"
    : !gateEnabled
      ? "BLOCKED"
      : "READY";
  const controlledCollectionNextAction = controlledCollectionStatus === "LOCKED"
    ? "Kill switch actif au bootstrap: reset manuel requis avant toute session."
    : controlledCollectionStatus === "BLOCKED"
      ? "Bootstrap compact: attendre opportunity gate GO avant la collecte."
      : "Bootstrap compact: collecte controlee autorisee, details complets en convergence.";

  return {
    status: "bootstrap",
    generated_at: generatedAt,
    watchdog_state: {
      latency: 0,
      drift: 0,
      error_rate: 0,
      anomaly_score: Number((1 - (gateHealthScore / 100)).toFixed(4)),
      status: watchdogStatus,
      triggers: watchdogTriggers,
      trigger_count: watchdogTriggers.length,
      health_score: bootstrapHealthScore,
      opportunity_gate_status: gateStatus.toLowerCase(),
    },
    memory_gap: {
      memory_decision: runtimeDecisionSummary ? "OK" : "SYNCING",
      reality_gap_score: 0,
      drift_detected: false,
      dominant_cause: runtimeDecisionSummary ? "none" : "bootstrap_compact",
      last_failure_reasons: runtimeDecisionSummary ? [] : ["runtime_projection_pending"],
    },
    governance: {
      mode: systemMode,
      backend_mode: backendMode,
      operator_override: !killSwitchActive,
      high_risk_trades_blocked: killSwitchActive || systemMode !== "LIVE",
      paper_only: false,
      opportunity_gate: gateState,
    },
    recovery: {
      active: killSwitchActive || watchdogStatus === "HALT",
      mode: recoveryMode,
      reduced_risk: watchdogStatus !== "OK",
      blocked_trades: killSwitchActive || !gateEnabled,
      alert_count: bootstrapAlerts.length,
    },
    controlled_collection: {
      status: controlledCollectionStatus,
      thesis: "Collect labels, not profit. Bootstrap compact actif avant la convergence complete.",
      next_action: controlledCollectionNextAction,
      manual_reset_required: killSwitchActive,
      constraints: [
        "Venue locked: BingX only",
        "Instrument locked: BTCUSDT only",
      ],
      forbidden: [
        "Do not force trades during bootstrap",
      ],
      stop_conditions: [
        ...(killSwitchActive ? ["Kill switch active"] : []),
        ...(!gateEnabled ? ["Opportunity gate blocked"] : []),
      ],
      label_progress: {
        targetMin: 50,
        targetMax: 100,
        classifiedCount: 0,
        recentClassifiedCount: 0,
        toTargetMin: 50,
        toTargetMax: 100,
        progressToMinPct: 0,
        progressToMaxPct: 0,
        stage: "BOOTSTRAP",
        summary: "Bootstrap compact: labels et edge confidence complets en attente.",
      },
      edge_confidence: {
        scorePct: 0,
        level: "LOW",
        summary: "Bootstrap compact: edge confidence complete en attente.",
      },
    },
    alerts: bootstrapAlerts,
    raw: {
      runtime_truth: runtimeTruthSnapshot,
    },
    runtime_projection_seed: {
      scope: LIVE_OPS_SERVER_BOOTSTRAP_SCOPE,
      compact_read: runtimeProjectionSeed.runtimeDecisionAvailable
        ? runtimeProjectionSeed.operator.runtimeDecisionCompactRead
        : bootstrapCompactRead,
      available: runtimeProjectionSeed.runtimeDecisionAvailable,
      generated_at: runtimeProjectionSeed.generatedAt,
    },
  };
}