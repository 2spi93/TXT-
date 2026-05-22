import { buildInitialLiveOpsBootstrapPayload } from "../live-ops/liveOpsBootstrap";

type JsonMap = Record<string, unknown>;

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatFreshnessMs(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return "n/a";
  }
  return `${Math.round(numeric)} ms`;
}

export async function buildInitialTerminalOperatorSnapshot(): Promise<JsonMap | null> {
  const bootstrap = await buildInitialLiveOpsBootstrapPayload();
  if (!bootstrap) {
    return null;
  }

  const root = asRecord(bootstrap);
  const governance = asRecord(root.governance);
  const gate = asRecord(governance.opportunity_gate);
  const metrics = asRecord(gate.metrics);
  const recovery = asRecord(root.recovery);
  const compactRead = asRecord(asRecord(root.runtime_projection_seed).compact_read);

  const gateStatus = String(gate.status || "BLOCKED").toUpperCase();
  const gateEnabled = Boolean(gate.opportunity_enabled);
  const healthScore = toNumber(gate.health_score, 0);
  const freshnessMs = toNumber(metrics.freshness_ms, NaN);
  const systemMode = String(governance.mode || "SAFE").toUpperCase();
  const recoveryMode = String(recovery.mode || "NOMINAL").trim() || "NOMINAL";
  const blockedTrades = Boolean(recovery.blocked_trades);
  const protectionActive = Boolean(recovery.active);
  const alertCount = Math.max(0, Math.round(toNumber(recovery.alert_count, 0)));
  const alertsLabel = `${alertCount} alert${alertCount > 1 ? "s" : ""}`;

  return {
    status: "ready",
    generated_at: String(root.generated_at || new Date().toISOString()),
    gate: {
      status: gateStatus,
      enabled: gateEnabled,
      health_score: healthScore,
      freshness_ms: Number.isFinite(freshnessMs) ? freshnessMs : null,
      reasons: Array.isArray(gate.reasons) ? gate.reasons : [],
    },
    protection: {
      active: protectionActive,
      blocked_trades: blockedTrades,
      recovery_mode: recoveryMode,
      alert_count: alertCount,
    },
    compact_read: compactRead,
    cards: [
      {
        key: "gate",
        label: "Gate",
        value: gateEnabled ? gateStatus : "BLOCKED",
        meta: `Freshness ${formatFreshnessMs(freshnessMs)} · health ${healthScore.toFixed(0)}%`,
        tone: gateEnabled && gateStatus === "GO" ? "good" : "warn",
      },
      {
        key: "mode",
        label: "Mode",
        value: systemMode,
        meta: `Recovery ${recoveryMode.toLowerCase().replace(/_/g, " ")}`,
        tone: systemMode === "LIVE" && !blockedTrades ? "good" : "subtle",
      },
      {
        key: "protection",
        label: "Protection",
        value: protectionActive ? "PROTECTED" : "CLEAR",
        meta: blockedTrades ? `${alertsLabel} · trades blocked` : `${alertsLabel} · bounded live`,
        tone: protectionActive ? "warn" : "good",
      },
      {
        key: "truth",
        label: "Truth",
        value: String(compactRead.liveLabel || compactRead.opportunityLabel || "BOOTSTRAP"),
        meta: String(compactRead.liveMeta || compactRead.opportunityMeta || "Operator snapshot"),
        tone: String(compactRead.liveTone || compactRead.opportunityTone || "subtle"),
      },
    ],
  };
}
