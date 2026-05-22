import type { RuntimeDecisionAnalyticsSummary } from "../../lib/runtimeDecisionAnalytics";

type RuntimeDecisionApiSummary = RuntimeDecisionAnalyticsSummary;
type ProjectionTone = "good" | "subtle" | "warn";

export type RuntimeReadonlyProjectionSnapshot = {
  schemaVersion: "runtime-projection/v1";
  generatedAt: string;
  projectionHash: string;
  projectionSignature: {
    state: "signed" | "unsigned";
    signedAt: string | null;
    signature: string | null;
  };
  runtimeDecisionAvailable: boolean;
  operator: {
    deskTruth: { label: "OK" | "REDUCE" | "BLOCK"; tone: ProjectionTone; reason: string };
    runtimeDecisionHeader: { label: string; tone: ProjectionTone };
    runtimeDecisionCompactRead: {
      driftTone: ProjectionTone;
      driftLabel: string;
      driftMeta: string;
      opportunityTone: ProjectionTone;
      opportunityLabel: string;
      opportunityMeta: string;
      observationTone: ProjectionTone;
      observationLabel: string;
      observationMeta: string;
      liveTone: ProjectionTone;
      liveLabel: string;
      liveMeta: string;
      state: string;
    };
    runtimeTelemetryGuard: {
      state: string;
      label: string;
      tone: ProjectionTone;
      summary: string;
      action: "allow" | "reduce" | "block";
    } | null;
    runtimeTelemetryIssue: boolean;
    runtimeTelemetryIntegrity: Array<{
      code: string;
      detail: string;
      tone: ProjectionTone;
    }>;
    runtimeTelemetryIntegritySummary: string | null;
    runtimeAttestation: {
      label: string;
      tone: ProjectionTone;
      state: string;
      attested: boolean;
      summary: string;
      blockers: string[];
    } | null;
    runtimeCertification: {
      label: string;
      tone: ProjectionTone;
      state: string;
      summary: string;
      blockers: string[];
      promotionGate: {
        label: string;
        tone: ProjectionTone;
        state: string;
        eligible: boolean;
        summary: string;
        blockers: string[];
      } | null;
      artifactAttestation: {
        label: string;
        tone: ProjectionTone;
        state: string;
        summary: string;
        signature: string | null;
        signedAt: string | null;
        replayHash: string | null;
      } | null;
    } | null;
    runtimeGuardrails: {
      watchdogStatus: string;
      governanceMode: string;
      recoveryMode: string;
      locked: boolean;
      summary: string;
    } | null;
    feedbackRuntime: {
      drawdownPct: number;
      realityGapScore: number;
      rewardEma: number;
      learningFrozen: boolean;
      guardrailsLocked: boolean;
      watchdogStatus: string;
      governanceMode: string;
    } | null;
    executionLock: {
      label: string;
      tone: ProjectionTone;
      detail: string;
    };
    runtimeMetrics: {
      chartFeed: { value: string; tone: ProjectionTone };
      exchange: { value: string; tone: ProjectionTone };
      telemetry: { value: string; tone: ProjectionTone };
    };
  };
};

type RuntimeDecisionCompactRead = RuntimeReadonlyProjectionSnapshot["operator"]["runtimeDecisionCompactRead"];

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function formatCompactMetricMs(value: unknown): string {
  const numeric = safeNumber(value, -1);
  if (numeric < 0) {
    return "n/a";
  }
  if (numeric < 1000) {
    return `${Math.round(numeric)}ms`;
  }
  if (numeric < 60_000) {
    return `${(numeric / 1000).toFixed(numeric < 10_000 ? 1 : 0)}s`;
  }
  return `${Math.round(numeric / 60_000)}m`;
}

function runtimeDecisionDriftTypeLabel(value: string): string {
  switch (value) {
    case "MARKET_MICROSTRUCTURE":
      return "market microstructure";
    case "MARKET_REGIME":
      return "market regime";
    case "EXECUTION_LATENCY":
      return "execution latency";
    case "EXECUTION_ROUTING":
      return "execution routing";
    case "SYSTEM_HEALTH":
      return "system health";
    case "MIXED":
      return "mixed";
    default:
      return "unknown";
  }
}

function runtimeTelemetryStateTone(value: string | null | undefined): ProjectionTone {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "LIVE" || normalized === "OPEN") {
    return "good";
  }
  if (normalized === "NO_EDGE" || normalized === "NO_DATA_EMPTY" || normalized === "UNKNOWN") {
    return "subtle";
  }
  return "warn";
}

function runtimeAttestationTone(value: string | null | undefined): ProjectionTone {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "certified") {
    return "good";
  }
  if (normalized === "operational" || normalized === "watch") {
    return "subtle";
  }
  return "warn";
}

function runtimePromotionGateTone(value: string | null | undefined): ProjectionTone {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ready") {
    return "good";
  }
  if (normalized === "observe") {
    return "subtle";
  }
  return "warn";
}

function runtimeArtifactAttestationTone(value: string | null | undefined): ProjectionTone {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "signed") {
    return "good";
  }
  if (normalized === "pending") {
    return "subtle";
  }
  return "warn";
}

function formatRuntimeAttestationBlocker(value: string): string {
  return value.replace(/_/g, " ").trim();
}

function deriveRuntimeAttestation(runtimeOpsPayload: Record<string, unknown> | null | undefined): {
  label: string;
  tone: ProjectionTone;
  state: string;
  attested: boolean;
  summary: string;
  blockers: string[];
} | null {
  const runtimeOps = safeRecord(runtimeOpsPayload);
  const attestation = safeRecord(runtimeOps.runtime_attestation);
  if (Object.keys(attestation).length === 0) {
    return null;
  }

  const state = String(attestation.state || "unknown").trim().toUpperCase() || "UNKNOWN";
  const label = String(attestation.attestation_label || state).trim().toUpperCase() || state;
  const tone = runtimeAttestationTone(state);
  const blockers = safeStringArray(attestation.blockers);
  const blockerSummary = blockers.slice(0, 2).map(formatRuntimeAttestationBlocker).join(" · ");
  const blockerSuffix = blockers.length > 2 ? ` +${blockers.length - 2}` : "";
  const inputStats = safeRecord(attestation.inputs);
  const chainPartitionCount = safeNumber(inputStats.chain_partition_count, 0);
  const replayCertified = Boolean(attestation.replay_certified);
  const projectionHash = String(attestation.projection_hash || "").trim();
  const summary = blockers.length > 0
    ? `${blockers.length} blocker${blockers.length > 1 ? "s" : ""} · ${blockerSummary}${blockerSuffix}`
    : replayCertified
      ? `${chainPartitionCount.toFixed(0)} runtime chains sealed${projectionHash ? " · projection linked" : ""}`
      : chainPartitionCount > 0
        ? `${chainPartitionCount.toFixed(0)} runtime chains observed`
        : "runtime attestation pending";

  return {
    label,
    tone,
    state,
    attested: Boolean(attestation.attested),
    summary,
    blockers,
  };
}

function deriveRuntimeCertification(
  runtimeOpsPayload: Record<string, unknown> | null | undefined,
  runtimeReplayArtifact: Record<string, unknown> | null | undefined,
): {
  label: string;
  tone: ProjectionTone;
  state: string;
  summary: string;
  blockers: string[];
  promotionGate: {
    label: string;
    tone: ProjectionTone;
    state: string;
    eligible: boolean;
    summary: string;
    blockers: string[];
  } | null;
  artifactAttestation: {
    label: string;
    tone: ProjectionTone;
    state: string;
    summary: string;
    signature: string | null;
    signedAt: string | null;
    replayHash: string | null;
  } | null;
} | null {
  const runtimeOps = safeRecord(runtimeOpsPayload);
  const certification = safeRecord(runtimeOps.replay_certification);
  if (Object.keys(certification).length === 0) {
    return null;
  }

  const promotionGate = safeRecord(certification.promotion_gate);
  const artifact = safeRecord(runtimeReplayArtifact);
  const artifactAttestation = safeRecord(artifact.artifact_attestation);
  const state = String(certification.state || "unknown").trim().toUpperCase() || "UNKNOWN";
  const tone = runtimeAttestationTone(state);
  const blockers = safeStringArray(certification.blockers);
  const blockerSummary = blockers.slice(0, 2).map(formatRuntimeAttestationBlocker).join(" · ");
  const blockerSuffix = blockers.length > 2 ? ` +${blockers.length - 2}` : "";
  const certificationScore = safeNumber(certification.score, 0);

  const promotionGateState = String(promotionGate.state || "unknown").trim().toUpperCase() || "UNKNOWN";
  const promotionGateBlockers = safeStringArray(promotionGate.blockers);
  const promotionGateSummary = promotionGateBlockers.length > 0
    ? `${promotionGateBlockers.length} blocker${promotionGateBlockers.length > 1 ? "s" : ""} · ${promotionGateBlockers.slice(0, 2).map(formatRuntimeAttestationBlocker).join(" · ")}${promotionGateBlockers.length > 2 ? ` +${promotionGateBlockers.length - 2}` : ""}`
    : Boolean(promotionGate.eligible)
      ? "shadow promotion tolerances satisfied"
      : "promotion gate pending";
  const promotionGateView = Object.keys(promotionGate).length > 0
    ? {
      label: `GATE ${promotionGateState}`,
      tone: runtimePromotionGateTone(promotionGateState),
      state: promotionGateState,
      eligible: Boolean(promotionGate.eligible),
      summary: promotionGateSummary,
      blockers: promotionGateBlockers,
    }
    : null;

  const artifactSignature = String(artifactAttestation.signature || "").trim() || null;
  const artifactSignedAt = String(artifactAttestation.signed_at || "").trim() || null;
  const artifactReplayHash = String(artifact.replay_hash || artifactAttestation.replay_hash || "").trim() || null;
  const artifactState = artifactSignature ? "SIGNED" : "PENDING";
  const artifactView = Object.keys(artifact).length > 0 || Object.keys(artifactAttestation).length > 0
    ? {
      label: artifactSignature ? "ARTIFACT SIGNED" : "ARTIFACT PENDING",
      tone: runtimeArtifactAttestationTone(artifactState),
      state: artifactState,
      summary: artifactSignature
        ? `sig ${artifactSignature.slice(0, 12)} · replay ${(artifactReplayHash || "n/a").slice(0, 12)}`
        : "append-only artifact attestation pending",
      signature: artifactSignature,
      signedAt: artifactSignedAt,
      replayHash: artifactReplayHash,
    }
    : null;

  return {
    label: Boolean(certification.replay_certified) ? "REPLAY CERTIFIED" : `REPLAY ${state}`,
    tone,
    state,
    summary: blockers.length > 0
      ? `${certificationScore.toFixed(0)}% · ${blockerSummary}${blockerSuffix}`
      : `${certificationScore.toFixed(0)}% · ${promotionGateView?.state ? `gate ${promotionGateView.state.toLowerCase()}` : "gate n/a"}${artifactSignature ? " · artifact signed" : ""}`,
    blockers,
    promotionGate: promotionGateView,
    artifactAttestation: artifactView,
  };
}

function deriveRuntimeGuardrails(runtimeOpsPayload: Record<string, unknown> | null | undefined): {
  watchdogStatus: string;
  governanceMode: string;
  recoveryMode: string;
  locked: boolean;
  summary: string;
} | null {
  const runtimeOps = safeRecord(runtimeOpsPayload);
  if (Object.keys(runtimeOps).length === 0) {
    return null;
  }
  const watchdog = safeRecord(runtimeOps.watchdog_state);
  const governance = safeRecord(runtimeOps.governance);
  const recovery = safeRecord(runtimeOps.recovery);
  const watchdogStatus = String(watchdog.status || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  const governanceMode = String(governance.mode || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  const recoveryMode = String(recovery.mode || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  const locked = watchdogStatus === "HALT" || governanceMode === "LOCKED";
  const summary = locked
    ? watchdogStatus === "HALT"
      ? `watchdog ${watchdogStatus} · recovery ${recoveryMode.toLowerCase()}`
      : `governance ${governanceMode.toLowerCase()}`
    : `${watchdogStatus} / ${governanceMode}`;

  return {
    watchdogStatus,
    governanceMode,
    recoveryMode,
    locked,
    summary,
  };
}

function deriveFeedbackRuntime(
  runtimeOpsPayload: Record<string, unknown> | null | undefined,
  executionAiV6Payload: Record<string, unknown> | null | undefined,
  runtimeGuardrails: RuntimeReadonlyProjectionSnapshot["operator"]["runtimeGuardrails"],
): {
  drawdownPct: number;
  realityGapScore: number;
  rewardEma: number;
  learningFrozen: boolean;
  guardrailsLocked: boolean;
  watchdogStatus: string;
  governanceMode: string;
} | null {
  const runtimeOps = safeRecord(runtimeOpsPayload);
  const executionAiV6 = safeRecord(executionAiV6Payload);
  const riskSnapshot = safeRecord(runtimeOps.risk_snapshot);
  const memoryGap = safeRecord(runtimeOps.memory_gap);
  const watchdog = safeRecord(runtimeOps.watchdog_state);
  const v6Snapshot = safeRecord(executionAiV6.snapshot);
  const v6Guardrails = safeRecord(v6Snapshot.guardrails);
  if (Object.keys(runtimeOps).length === 0 && Object.keys(executionAiV6).length === 0) {
    return null;
  }

  return {
    drawdownPct: safeNumber(riskSnapshot.dd_pct, 0),
    realityGapScore: Math.max(
      safeNumber(memoryGap.reality_gap_score, 0),
      safeNumber(watchdog.drift, 0),
    ),
    rewardEma: safeNumber(v6Snapshot.reward_ema, 0),
    learningFrozen: Boolean(v6Guardrails.learning_frozen),
    guardrailsLocked: Boolean(runtimeGuardrails?.locked),
    watchdogStatus: runtimeGuardrails?.watchdogStatus || "UNKNOWN",
    governanceMode: runtimeGuardrails?.governanceMode || "UNKNOWN",
  };
}

export function isRuntimeTelemetryIssueState(value: string | null | undefined): boolean {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "NO_DATA_AUTH"
    || normalized === "NO_DATA_PARTIAL"
    || normalized === "NO_DATA_EMPTY"
    || normalized === "STALE";
}

export function deriveRuntimeTelemetryGuard(summary: RuntimeDecisionApiSummary | null): {
  state: string;
  label: string;
  tone: ProjectionTone;
  summary: string;
  action: "allow" | "reduce" | "block";
} | null {
  if (!summary) {
    return null;
  }

  const explicitGuardState = String(summary.opportunity.guard?.state || "").trim().toUpperCase();
  if (explicitGuardState === "BLOCKED_BY_DATA") {
    return {
      state: explicitGuardState,
      label: explicitGuardState,
      tone: "warn",
      summary: String(summary.opportunity.guard?.summary || summary.reliability?.summary || "Interpretation blocked by data"),
      action: "block",
    };
  }
  if (explicitGuardState === "UNTRUSTED") {
    return {
      state: explicitGuardState,
      label: explicitGuardState,
      tone: "warn",
      summary: String(summary.opportunity.guard?.summary || summary.reliability?.summary || summary.opportunity.liveSummary || "Observation integrity degraded"),
      action: "reduce",
    };
  }
  if (explicitGuardState === "PARTIAL_DATA") {
    return {
      state: explicitGuardState,
      label: explicitGuardState,
      tone: "warn",
      summary: String(summary.opportunity.guard?.summary || summary.opportunity.liveSummary || "Telemetry partial"),
      action: "block",
    };
  }

  const state = String(summary.opportunity.liveState || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  if (state === "NO_DATA_AUTH") {
    return { state, label: state, tone: "warn", summary: summary.opportunity.liveSummary, action: "block" };
  }
  if (state === "STALE") {
    return { state, label: state, tone: "warn", summary: summary.opportunity.liveSummary, action: "block" };
  }
  if (state === "NO_DATA_PARTIAL") {
    return { state, label: state, tone: "warn", summary: summary.opportunity.liveSummary, action: "reduce" };
  }
  if (state === "NO_DATA_EMPTY") {
    return { state, label: state, tone: "subtle", summary: summary.opportunity.liveSummary, action: "reduce" };
  }
  return {
    state,
    label: state,
    tone: runtimeTelemetryStateTone(state),
    summary: summary.opportunity.liveSummary,
    action: "allow",
  };
}

function runtimeTelemetryIntegrityTone(severity: string | null | undefined): ProjectionTone {
  const normalized = String(severity || "").trim().toLowerCase();
  if (normalized === "critical") {
    return "warn";
  }
  if (normalized === "warning") {
    return "subtle";
  }
  return "good";
}

export function deriveRuntimeTelemetryIntegrity(summary: RuntimeDecisionApiSummary | null): Array<{
  code: string;
  detail: string;
  tone: ProjectionTone;
}> {
  const telemetry = summary?.opportunity?.telemetry;
  const integrity = telemetry?.integrity;
  if (Array.isArray(integrity?.items) && integrity.items.length > 0) {
    return integrity.items.map((item) => ({
      code: String(item.label || item.code || "UNKNOWN").trim() || "UNKNOWN",
      detail: String(item.detail || "").trim() || "telemetry gap",
      tone: runtimeTelemetryIntegrityTone(item.severity),
    }));
  }

  const missingFields = Array.isArray(telemetry?.missingFields) ? telemetry.missingFields : [];
  const fallback = missingFields.map((field) => {
    switch (String(field)) {
      case "execution":
        return { code: "NO_EXECUTION_STATS", detail: "stats execution route absentes", tone: "warn" as const };
      case "latency":
        return { code: "NO_EXECUTION_LATENCY", detail: "latence execution/route non observee", tone: "warn" as const };
      case "slippage":
        return { code: "NO_EXECUTION_SLIPPAGE", detail: "slippage execution absent", tone: "warn" as const };
      case "budget_profile":
        return { code: "NO_EXECUTION_BUDGET", detail: "budgets route max_* absents", tone: "subtle" as const };
      case "profile":
        return { code: "NO_EXECUTION_PROFILE", detail: "profile route absent", tone: "subtle" as const };
      case "spread":
        return { code: "NO_MARKET_SPREAD", detail: "spread market absent", tone: "subtle" as const };
      case "depth":
        return { code: "NO_MARKET_DEPTH", detail: "depth/fill probability market absente", tone: "subtle" as const };
      case "venues":
        return { code: "NO_ROUTE_VENUES", detail: "aucune venue exploitable", tone: "warn" as const };
      default:
        return { code: String(field || "UNKNOWN").trim().toUpperCase() || "UNKNOWN", detail: String(field || "telemetry gap"), tone: "subtle" as const };
    }
  });
  return fallback.filter((item, index, collection) => collection.findIndex((candidate) => candidate.code === item.code) === index);
}

export function deriveRuntimeTelemetryIntegritySummary(summary: RuntimeDecisionApiSummary | null): string | null {
  const telemetry = summary?.opportunity?.telemetry;
  const integrity = telemetry?.integrity;
  if (integrity?.summary) {
    return integrity.summary;
  }
  const items = deriveRuntimeTelemetryIntegrity(summary);
  if (items.length === 0) {
    return null;
  }
  return items.map((item) => `${item.code} ${item.detail}`).join(" · ");
}

export function deriveExecutionLockDescriptor(summary: RuntimeDecisionApiSummary | null): {
  label: string;
  tone: ProjectionTone;
  detail: string;
} {
  if (!summary) {
    return {
      label: "n/a",
      tone: "subtle",
      detail: "execution lock unavailable",
    };
  }

  const runtimeTelemetryGuard = deriveRuntimeTelemetryGuard(summary);
  if (!runtimeTelemetryGuard || runtimeTelemetryGuard.action === "allow") {
    return {
      label: "OPEN",
      tone: "good",
      detail: String(summary.opportunity.guard?.summary || summary.opportunity.liveSummary || "execution path available").trim(),
    };
  }

  return {
    label: runtimeTelemetryGuard.action === "block" ? "LOCKED" : "GUARDED",
    tone: runtimeTelemetryGuard.action === "block" ? "warn" : "subtle",
    detail: String(runtimeTelemetryGuard.summary || summary.opportunity.guard?.summary || summary.opportunity.liveSummary || "execution constrained").trim(),
  };
}

export function buildRuntimeDecisionCompactRead(
  summary: RuntimeDecisionApiSummary | null,
  options?: {
    busy?: boolean;
    error?: string | null;
  },
): RuntimeDecisionCompactRead {
  if (!summary) {
    const error = String(options?.error || "").trim();
    const busy = Boolean(options?.busy);
    const meta = busy
      ? "loading runtime decision summary..."
      : error || "runtime decision summary unavailable";
    return {
      driftTone: busy ? "subtle" : "warn",
      driftLabel: "DRIFT n/a",
      driftMeta: meta,
      opportunityTone: busy ? "subtle" : "warn",
      opportunityLabel: "OPPORTUNITY n/a",
      opportunityMeta: meta,
      observationTone: busy ? "subtle" : "warn",
      observationLabel: "OBS unavailable",
      observationMeta: busy ? "awaiting observation window" : meta,
      liveTone: busy ? "subtle" : "warn",
      liveLabel: "LIVE n/a",
      liveMeta: busy ? "stabilizing operator context" : meta,
      state: busy ? "loading" : error ? "error" : "idle",
    };
  }

  const limitingFactor = summary.opportunity.breakdown
    .slice()
    .sort((left, right) => left.score - right.score || left.label.localeCompare(right.label))[0] || null;
  const runtimeTelemetryGuard = deriveRuntimeTelemetryGuard(summary);
  const executionLock = deriveExecutionLockDescriptor(summary);
  const explicitOpportunityState = runtimeTelemetryGuard?.action !== "allow" || summary.opportunity.liveState === "NO_EDGE";
  const live = summary.monitoring?.live || null;
  const liveAnomalies = summary.monitoring?.anomalies.rows || [];
  const falseContextCompact = (summary.monitoring?.falseContextMotifs || [])
    .slice(0, 2)
    .map((motif) => `${String(motif.family || "").trim().toUpperCase()} ${motif.sharePct}%`)
    .filter(Boolean)
    .join(" · ");
  const chartFeedLabel = live?.latestFeedLabel
    ? `CHART FEED ${live.latestFeedLabel}`
    : "CHART FEED capture n/a";
  const exchangeFreshnessLabel = live
    ? `EXCHANGE FRESHNESS ${live.latestXchStatus} ${live.latestXchAgeLabel}`
    : "EXCHANGE FRESHNESS n/a";
  const exchangeRateLabel = live?.staleRateXchPct != null
    ? `stale ${live.staleRateXchPct}%`
    : null;
  const busLabel = live ? `bus ${formatCompactMetricMs(live.latestBusLagMs)}` : null;
  const runtimeGridLabel = live?.multiChart?.state && live.multiChart.state !== "INACTIVE"
    ? `grid ${live.multiChart.state.toLowerCase()}`
    : null;
  const runtimeV5Label = live?.v5?.state && live.v5.state !== "INACTIVE"
    ? `v5 ${live.v5.state.toLowerCase()}`
    : null;
  const liveParts = [
    exchangeFreshnessLabel,
    exchangeRateLabel,
    `EXECUTION ${executionLock.label}`,
    executionLock.detail,
    busLabel,
    runtimeGridLabel,
    runtimeV5Label,
  ].filter(Boolean);

  return {
    driftTone: summary.drift.tone,
    driftLabel: `DRIFT ${runtimeDecisionDriftTypeLabel(summary.drift.type)}`,
    driftMeta: `P ${summary.drift.stats.probabilityPct}% | R ${summary.drift.stats.reliabilityPct}% | C ${summary.drift.stats.confidencePct}%`,
    opportunityTone: explicitOpportunityState
      ? (runtimeTelemetryGuard?.tone || runtimeTelemetryStateTone(summary.opportunity.liveState))
      : (limitingFactor?.tone || (["OPEN", "LIVE"].includes(summary.opportunity.liveState) ? "good" : ["NO_EDGE", "NO_DATA_EMPTY", "UNKNOWN"].includes(summary.opportunity.liveState) ? "subtle" : "warn")),
    opportunityLabel: explicitOpportunityState
      ? `OPPORTUNITY ${runtimeTelemetryGuard?.label || summary.opportunity.liveState}`
      : `OPPORTUNITY ${summary.opportunity.avgScore}%`,
    opportunityMeta: explicitOpportunityState
      ? String(runtimeTelemetryGuard?.summary || summary.opportunity.guard?.summary || summary.opportunity.liveSummary)
      : limitingFactor
        ? `facteur limitant ${limitingFactor.label.toLowerCase()} ${limitingFactor.scorePct.toFixed(0)}%`
        : summary.opportunity.liveSummary,
    observationTone: summary.integrity.state === "BROKEN"
      ? "warn"
      : summary.integrity.state === "DEGRADED"
        ? "subtle"
        : summary.observation.manualCalibrationEligible
          ? "good"
          : summary.observation.status === "OBSERVE"
            ? "subtle"
            : "warn",
    observationLabel: `OBS ${summary.observation.status.toLowerCase().replace(/_/g, " ")}`,
    observationMeta: `FP ${summary.observation.driftFalsePositiveRate}% | Det ${summary.observation.driftDetectionRate}% | Stability ${summary.observation.driftStability}% | Consistency ${summary.observation.decisionConsistency}%${summary.integrity ? ` | Runtime Integrity ${summary.integrity.state} ${summary.integrity.scorePct}%` : ""}${summary.monitoring?.observationWindow.validation?.integrityTrend?.direction && summary.monitoring.observationWindow.validation.integrityTrend.direction !== "UNKNOWN" ? ` | Trend ${summary.monitoring.observationWindow.validation.integrityTrend.direction}` : ""}${summary.observation.integrity ? ` | Observation Integrity ${summary.observation.integrity.status}` : ""}${summary.reliability?.state ? ` | Reliability ${summary.reliability.state}` : ""}${falseContextCompact ? ` | FalseCtx ${falseContextCompact}` : ""}`,
    liveTone: executionLock.tone === "warn"
      ? "warn"
      : liveAnomalies[0]?.severity === "critical"
        ? "warn"
        : liveAnomalies[0]?.severity === "warning"
          ? "subtle"
          : live?.latestXchStatus === "LIVE"
            ? "good"
            : "subtle",
    liveLabel: chartFeedLabel,
    liveMeta: liveParts.join(" | ") || "capture locale indisponible",
    state: "ready",
  };
}

export function deriveDeskTruthState(input: {
  summary: Record<string, unknown>;
  runtimeOpsPayload?: Record<string, unknown> | null;
  executionAiV6Payload?: Record<string, unknown> | null;
  runtimeDecisionSummary?: RuntimeDecisionApiSummary | null;
}): { label: "OK" | "REDUCE" | "BLOCK"; tone: ProjectionTone; reason: string } {
  const summary = safeRecord(input.summary);
  const runtimeOps = safeRecord(input.runtimeOpsPayload);
  const watchdog = safeRecord(runtimeOps.watchdog_state);
  const governance = safeRecord(runtimeOps.governance);
  const v6Envelope = safeRecord(input.executionAiV6Payload);
  const v6Snapshot = safeRecord(v6Envelope.snapshot);
  const v6Guardrails = safeRecord(v6Snapshot.guardrails);
  const runtimeTelemetryGuard = deriveRuntimeTelemetryGuard(input.runtimeDecisionSummary || null);

  const tradeCount = safeNumber(summary.trade_count, 0);
  const noTradeCount = safeNumber(summary.no_trade_dominance_count, 0);
  const highConfidenceLossCount = safeNumber(summary.high_confidence_loss_count, 0);
  const avgLatencyMs = safeNumber(summary.avg_latency_ms, 0);
  const avgSlippageBps = safeNumber(summary.avg_slippage_bps, 0);
  const netPnlUsd = safeNumber(summary.net_pnl_usd, 0);
  const winRatePct = safeNumber(summary.win_rate_pct, 0);
  const noTradeRatio = tradeCount > 0 ? noTradeCount / tradeCount : 0;
  const watchdogStatus = String(watchdog.status || "OK").trim().toUpperCase();
  const governanceMode = String(governance.mode || "SAFE").trim().toUpperCase();
  const learningFrozen = Boolean(v6Guardrails.learning_frozen);

  if (runtimeTelemetryGuard?.state === "NO_DATA_AUTH") {
    return { label: "BLOCK", tone: "warn", reason: runtimeTelemetryGuard.summary };
  }
  if (runtimeTelemetryGuard?.state === "STALE") {
    return { label: "BLOCK", tone: "warn", reason: runtimeTelemetryGuard.summary };
  }
  if (runtimeTelemetryGuard?.state === "NO_DATA_PARTIAL") {
    return { label: "REDUCE", tone: "warn", reason: runtimeTelemetryGuard.summary };
  }
  if (runtimeTelemetryGuard?.state === "NO_DATA_EMPTY") {
    return { label: "REDUCE", tone: "subtle", reason: runtimeTelemetryGuard.summary };
  }
  if (watchdogStatus === "HALT" || governanceMode === "LOCKED") {
    return { label: "BLOCK", tone: "warn", reason: "system guardrails locked the desk" };
  }
  if (tradeCount >= 5 && (highConfidenceLossCount >= 2 || (netPnlUsd < 0 && winRatePct < 40))) {
    return { label: "BLOCK", tone: "warn", reason: "live truth says stop and re-check the filter" };
  }
  if (tradeCount < 3) {
    return { label: "REDUCE", tone: "subtle", reason: "collect more small live samples before trusting the edge" };
  }
  if (learningFrozen || avgLatencyMs > 120 || avgSlippageBps > 3 || noTradeRatio < 0.1) {
    return { label: "REDUCE", tone: "subtle", reason: "keep size down and let no-trade dominate harder" };
  }
  return { label: "OK", tone: "good", reason: "truth engine is stable enough for guarded micro-live" };
}

export function buildRuntimeReadonlyProjection(input: {
  runtimeOpsPayload?: Record<string, unknown> | null;
  executionAiV6Payload?: Record<string, unknown> | null;
  executionPnlPayload?: Record<string, unknown> | null;
  runtimeDecisionSummary?: RuntimeDecisionApiSummary | null;
  runtimeDecisionError?: string | null;
  runtimeReplayArtifact?: Record<string, unknown> | null;
  projectionHash?: string;
  generatedAt?: string;
}): RuntimeReadonlyProjectionSnapshot {
  const executionPnlEnvelope = safeRecord(input.executionPnlPayload);
  const summary = safeRecord(executionPnlEnvelope.summary);
  const runtimeDecisionSummary = input.runtimeDecisionSummary || null;
  const runtimeDecisionCompactRead = buildRuntimeDecisionCompactRead(runtimeDecisionSummary, { error: input.runtimeDecisionError || null });
  const runtimeTelemetryGuard = deriveRuntimeTelemetryGuard(runtimeDecisionSummary);
  const runtimeTelemetryIntegrity = deriveRuntimeTelemetryIntegrity(runtimeDecisionSummary);
  const runtimeTelemetryIntegritySummary = deriveRuntimeTelemetryIntegritySummary(runtimeDecisionSummary);
  const runtimeTelemetryLead = runtimeTelemetryIntegrity[0] || null;
  const runtimeAttestation = deriveRuntimeAttestation(input.runtimeOpsPayload);
  const runtimeCertification = deriveRuntimeCertification(input.runtimeOpsPayload, input.runtimeReplayArtifact);
  const runtimeGuardrails = deriveRuntimeGuardrails(input.runtimeOpsPayload);
  const feedbackRuntime = deriveFeedbackRuntime(input.runtimeOpsPayload, input.executionAiV6Payload, runtimeGuardrails);
  const executionLock = deriveExecutionLockDescriptor(runtimeDecisionSummary);
  const deskTruth = deriveDeskTruthState({
    summary,
    runtimeOpsPayload: input.runtimeOpsPayload,
    executionAiV6Payload: input.executionAiV6Payload,
    runtimeDecisionSummary,
  });
  const runtimeLive = runtimeDecisionSummary?.monitoring?.live || null;
  const runtimeDecisionHeader = runtimeDecisionSummary
    ? (isRuntimeTelemetryIssueState(runtimeDecisionSummary.opportunity.liveState)
      ? { label: runtimeDecisionSummary.opportunity.liveState, tone: runtimeTelemetryStateTone(runtimeDecisionSummary.opportunity.liveState) }
      : { label: runtimeDecisionSummary.dominant.bucket.label, tone: runtimeDecisionSummary.deskRead.tone })
    : { label: "indispo", tone: "warn" as const };

  return {
    schemaVersion: "runtime-projection/v1",
    generatedAt: input.generatedAt || new Date().toISOString(),
    projectionHash: input.projectionHash || "pending",
    projectionSignature: {
      state: "unsigned",
      signedAt: null,
      signature: null,
    },
    runtimeDecisionAvailable: Boolean(runtimeDecisionSummary),
    operator: {
      deskTruth,
      runtimeDecisionHeader,
      runtimeDecisionCompactRead,
      runtimeTelemetryGuard,
      runtimeTelemetryIssue: isRuntimeTelemetryIssueState(runtimeTelemetryGuard?.state),
      runtimeTelemetryIntegrity,
      runtimeTelemetryIntegritySummary,
      runtimeAttestation,
      runtimeCertification,
      runtimeGuardrails,
      feedbackRuntime,
      executionLock,
      runtimeMetrics: {
        chartFeed: {
          value: runtimeLive?.latestFeedLabel || "capture n/a",
          tone: runtimeLive?.latestFeedLabel ? "good" : "subtle",
        },
        exchange: {
          value: runtimeLive ? `${runtimeLive.latestXchStatus} ${runtimeLive.latestXchAgeLabel}` : "n/a",
          tone: runtimeLive?.latestXchStatus === "LIVE" ? "good" : "subtle",
        },
        telemetry: {
          value: runtimeTelemetryGuard?.label ? `${runtimeTelemetryGuard.label}${runtimeTelemetryLead ? ` / ${runtimeTelemetryLead.code}` : ""}` : (runtimeTelemetryLead?.code || "n/a"),
          tone: runtimeTelemetryGuard?.tone || runtimeTelemetryLead?.tone || "subtle",
        },
      },
    },
  };
}