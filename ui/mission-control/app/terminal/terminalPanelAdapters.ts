import type { FinalDecisionOracleExecutionView, FinalDecisionOracleObservabilityView } from "./finalDecisionTruth";
import type { SelfPreservationSummary } from "./selfPreservation";
import type { TerminalDecisionOrchestratorSnapshot } from "./terminalDecisionOrchestrator";
import { selectFinalDecisionTruth, selectGovernanceBalanceSummary, selectRecoveryMomentumSummary } from "./terminalSelectors";

export type GovernanceBalancePanelAdapter = {
  summary_label: string;
  tone: "bad" | "warn" | "good" | "subtle";
  primary_pills: string[];
  budget_label: string;
  arbitration_label: string;
  state_machine_label: string;
  transition_label: string;
  recovery_pills: string[];
  reasons_label: string;
};

export type FinalDecisionOraclePanelAdapter = {
  summary_label: string;
  detail_label: string;
  execution_label: string;
  execution_detail_label: string;
};

export type StatusDetailPanelAdapter = {
  compact_label: string;
  detail_label: string;
  tone_class: string;
  pill_tone: "bad" | "warn" | "good" | "subtle";
  pills: string[];
};

export type GovernanceReplayPanelAdapter = {
  compact_label: string;
  detail_label: string;
  pill_tone: "bad" | "warn" | "good";
  pills: string[];
  why_allowed_label: string;
  why_block_label: string;
  latest_timeline_label: string | null;
};

export type GovernanceReplayArchiveContractsPanelAdapter = {
  compact_label: string;
  detail_label: string;
  pill_tone: "bad" | "warn" | "good";
  operator_cards: Array<{
    key: string;
    label: string;
    short_label: string;
    dominant_reason: string;
    version_label: string;
    pill_tone: "bad" | "warn" | "good";
  }>;
};

export type FreezeV1ContractsPanelAdapter = {
  compact_label: string;
  detail_label: string;
  pill_tone: "bad" | "warn" | "good";
  contract_pills: Array<{
    key: string;
    label: string;
    tone: "bad" | "warn" | "good";
  }>;
};

function humanizeTerminalReasonLabel(value: string): string {
  const normalized = String(value || "").trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return normalized.replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatArchiveContractOperatorLabel(value: "market_regime_archive" | "governance_replay"): string {
  return value === "market_regime_archive" ? "archive" : "replay";
}

export function buildGovernanceBalancePanelAdapter(snapshot: TerminalDecisionOrchestratorSnapshot): GovernanceBalancePanelAdapter | null {
  const summary = selectGovernanceBalanceSummary(snapshot);
  const recoveryMomentum = selectRecoveryMomentumSummary(snapshot);
  if (!summary || !recoveryMomentum) {
    return null;
  }

  return {
    summary_label: summary.summary_label,
    tone: summary.state === "LOCKED"
      ? "bad"
      : summary.state === "PRESSURED"
        ? "warn"
        : summary.state === "OPPORTUNISTIC"
          ? "good"
          : "subtle",
    primary_pills: [
      `protect ${summary.protection_pressure_pct}%`,
      `opp ${summary.opportunity_pressure_pct}%`,
      `recover ${summary.recovery_momentum_pct}%`,
      `inertia ${summary.governance_inertia_pct}%`,
      `freeze ${summary.freeze_drag_pct}%`,
      `aggr ${summary.aggression_budget_pct}%`,
      `ready ${summary.reacceleration_readiness_pct}%`,
    ],
    budget_label: `cadence ${summary.cadence.toLowerCase()} / ${summary.cadence_budget_pct}% · exposure ${summary.allowed_exposure_pct}% / ${summary.exposure_budget_pct}% · route ${summary.routing_aggressiveness_pct}% · diversify ${summary.venue_diversification_pct}% · retry ${summary.retry_budget_pct}% · explore ${summary.exploration_budget_pct}% · velocity ${summary.recovery_velocity_pct}%`,
    arbitration_label: `pressure ${summary.pressure_normalization.arbitration_state.toLowerCase()} · tier ${summary.pressure_normalization.winning_tier.toLowerCase()} · dominant ${summary.pressure_normalization.dominant_pressure_key} · suppressed ${summary.pressure_normalization.suppressed_sources.length} · unresolved ${summary.pressure_normalization.unresolved_conflicts.length} · reacc ${summary.reacceleration_state.toLowerCase()} · review ${summary.review_required ? "yes" : "no"}`,
    state_machine_label: snapshot.governanceStateMachineSummary
      ? `${snapshot.governanceStateMachineSummary.summary_label} · src sp ${snapshot.governanceStateMachineSummary.source_states.self_preservation || "none"} · replay ${snapshot.governanceStateMachineSummary.source_states.governance_replay || "none"} · freeze ${snapshot.governanceStateMachineSummary.source_states.freeze || "none"}`
      : "state machine unavailable",
    transition_label: snapshot.governanceStateMachineSummary
      ? `allowed ${snapshot.governanceStateMachineSummary.allowed_transitions.join(" -> ")} · trace ${snapshot.governanceStateMachineSummary.transition_trace.slice(0, 3).join(" / ") || "steady_state"}`
      : "allowed transitions unavailable",
    recovery_pills: [
      recoveryMomentum.summary_label,
      `confidence ${recoveryMomentum.confidence_recovery_pct}%`,
      `reacc ${recoveryMomentum.risk_reacceleration_pct}%`,
      `false ${recoveryMomentum.false_recovery_risk_pct}%`,
    ],
    reasons_label: summary.reasons.slice(0, 4).join(" · ") || "governance balance nominal",
  };
}

export function buildFinalDecisionOraclePanelAdapter(input: {
  snapshot: TerminalDecisionOrchestratorSnapshot;
  executionOracle: FinalDecisionOracleExecutionView | null;
  observabilityOracle: FinalDecisionOracleObservabilityView | null;
}): FinalDecisionOraclePanelAdapter | null {
  const finalDecisionTruth = selectFinalDecisionTruth(input.snapshot);
  if (!finalDecisionTruth || !input.executionOracle || !input.observabilityOracle) {
    return null;
  }

  return {
    summary_label: finalDecisionTruth.summary_label,
    detail_label: input.observabilityOracle.detail_label,
    execution_label: input.executionOracle.summary_label,
    execution_detail_label: input.executionOracle.detail_label,
  };
}

export function buildSelfPreservationPanelAdapter(summary: SelfPreservationSummary | null): StatusDetailPanelAdapter | null {
  if (!summary) {
    return null;
  }

  return {
    compact_label: `SP:${summary.state} ${summary.score_pct}%`,
    detail_label: [
      `${summary.summary_label} · dom ${summary.dominant_trigger}`,
      `stability ${summary.metrics.stability_mode.toUpperCase()} ${summary.metrics.stability_monitor_pct}% · drift ${summary.metrics.drift_watchdog} · watchdog ${summary.metrics.watchdog_status} · gov ${summary.metrics.governance_mode}`,
      summary.reasons.slice(0, 4).join(" · "),
    ].filter(Boolean).join(" · "),
    tone_class: summary.state === "LOCKDOWN"
      ? "chart-chip-bad"
      : summary.state === "PROTECT" || summary.state === "DEFENSIVE"
        ? "chart-chip-warn"
        : summary.state === "OPEN"
          ? "active"
          : "",
    pill_tone: summary.state === "LOCKDOWN"
      ? "bad"
      : summary.state === "PROTECT" || summary.state === "DEFENSIVE"
        ? "warn"
        : summary.state === "OPEN"
          ? "good"
          : "subtle",
    pills: [
      `dom ${summary.dominant_trigger || "NONE"}`,
      `stability ${summary.metrics.stability_mode || "live"}`,
      `watchdog ${summary.metrics.drift_watchdog || "CALM"}`,
      `guard ${summary.metrics.runtime_guard_code || "none"}`,
    ],
  };
}

export function buildSelfHealingRecoveryPanelAdapter(snapshot: TerminalDecisionOrchestratorSnapshot): StatusDetailPanelAdapter | null {
  const selfHealingRecovery = snapshot.selfHealingRecoverySnapshot;
  if (!selfHealingRecovery) {
    return null;
  }

  return {
    compact_label: `REC:${selfHealingRecovery.recovery_tier} ${selfHealingRecovery.recovery_confidence_pct}%`,
    detail_label: [
      `${selfHealingRecovery.self_healing_action} ${selfHealingRecovery.self_healing_drift} · cooldown ${(selfHealingRecovery.adaptive_cooldown_ms / 1000).toFixed(0)}s`,
      `frag ${selfHealingRecovery.recovery_fragility_pct}% · relapse ${selfHealingRecovery.relapse_probability_pct}% · quality ${selfHealingRecovery.recovery_quality_pct}%`,
      `${selfHealingRecovery.blocking_layer} · ${selfHealingRecovery.dominant_reason}`,
    ].filter(Boolean).join(" · "),
    tone_class: selfHealingRecovery.recovery_tier === "LOCKDOWN" || selfHealingRecovery.recovery_tier === "RECOVERING"
      ? "chart-chip-bad"
      : selfHealingRecovery.recovery_tier === "PROTECT" || selfHealingRecovery.recovery_tier === "DEGRADED" || selfHealingRecovery.recovery_tier === "REVALIDATING"
        ? "chart-chip-warn"
        : selfHealingRecovery.recovery_tier === "STABLE"
          ? "active"
          : "",
    pill_tone: selfHealingRecovery.recovery_tier === "LOCKDOWN" || selfHealingRecovery.recovery_tier === "RECOVERING"
      ? "bad"
      : selfHealingRecovery.recovery_tier === "PROTECT" || selfHealingRecovery.recovery_tier === "DEGRADED" || selfHealingRecovery.recovery_tier === "REVALIDATING"
        ? "warn"
        : selfHealingRecovery.recovery_tier === "STABLE"
          ? "good"
          : "subtle",
    pills: [
      `action ${selfHealingRecovery.self_healing_action}`,
      `drift ${selfHealingRecovery.self_healing_drift}`,
      `cooldown ${(selfHealingRecovery.adaptive_cooldown_ms / 1000).toFixed(0)}s`,
      `relapse ${selfHealingRecovery.relapse_probability_pct}%`,
    ],
  };
}

export function buildMarketRegimeArchivePanelAdapter(snapshot: TerminalDecisionOrchestratorSnapshot): StatusDetailPanelAdapter | null {
  const archive = snapshot.activeMarketRegimeArchiveSummary;
  const compression = snapshot.activeMarketRegimePersistentCompression;
  if (!archive || !compression) {
    return null;
  }
  const hottestRow = archive.rows[0] || null;

  return {
    compact_label: `MRA:${archive.archive_state} ${archive.market_temperature_pct}%`,
    detail_label: [
      `active ${archive.active_regime || "UNKNOWN"} · hot ${archive.hottest_regime || "NONE"} · block ${archive.dominant_blocking_layer || "none"}`,
      `compression ${compression.state.toLowerCase()} ${compression.compression_ratio_pct}% · relapse ${compression.relapse_probability_pct}% · half ${compression.retention_half_life_hours}h`,
      hottestRow
        ? `stress ${hottestRow.stress_score_pct}% · inad ${hottestRow.inadmissible_share_pct}% · degr ${hottestRow.degradation_share_pct}% · samples ${hottestRow.sample_count}`
        : "archive journal pending",
      archive.reasons.slice(0, 3).join(" · "),
    ].filter(Boolean).join(" · "),
    tone_class: "",
    pill_tone: archive.archive_state === "BROKEN"
      ? "bad"
      : archive.archive_state === "FRAGILE" || archive.archive_state === "WATCH"
        ? "warn"
        : "good",
    pills: [
      `active ${archive.active_regime || "UNKNOWN"}`,
      `hot ${archive.hottest_regime || "NONE"}`,
      `block ${archive.dominant_blocking_layer || "none"}`,
      `stress ${hottestRow?.stress_score_pct || 0}%`,
      `cmp ${compression.compression_ratio_pct}%`,
      `relapse ${compression.relapse_probability_pct}%`,
      `half ${compression.retention_half_life_hours}h`,
    ],
  };
}

export function buildGovernanceReplayPanelAdapter(input: {
  snapshot: TerminalDecisionOrchestratorSnapshot;
  persistedAvailable: boolean;
  persistedError: string | null;
}): GovernanceReplayPanelAdapter | null {
  const replay = input.snapshot.activeGovernanceReplaySummary;
  const timeline = input.snapshot.activeGovernanceReplayDetailedTimeline;
  if (!replay) {
    return null;
  }
  const failureLayer = replay.failure_answer?.layer || null;

  return {
    compact_label: `GR:${replay.state}${replay.active_layer ? ` · ${humanizeTerminalReasonLabel(replay.active_layer)}` : ""}`,
    detail_label: [
      `allow ${replay.allow_answer.action} · ${replay.allow_answer.headline}`,
      `block ${replay.block_answer.action} · ${replay.block_answer.headline}`,
      `failure ${failureLayer ? humanizeTerminalReasonLabel(failureLayer) : "Unresolved"}`,
    ].join(" · "),
    pill_tone: replay.state === "BLOCKED"
      ? "bad"
      : replay.state === "DEFENSIVE"
        ? "warn"
        : "good",
    pills: [
      input.persistedAvailable ? "history persisted" : input.persistedError ? "history fallback" : "history loading",
      `allow ${replay.allow_answer.action}`,
      `block ${replay.block_answer.action}`,
      `layer ${failureLayer ? humanizeTerminalReasonLabel(failureLayer) : "Unresolved"}`,
      `steps ${timeline?.length || replay.timeline.length}`,
    ],
    why_allowed_label: `Why allowed: ${replay.allow_answer.detail || replay.allow_answer.headline}`,
    why_block_label: `Why block: ${replay.block_answer.detail || replay.block_answer.headline}`,
    latest_timeline_label: timeline?.[0]
      ? `Latest timeline: ${timeline[0].label} · ${timeline[0].detail}`
      : null,
  };
}

export function buildGovernanceReplayArchiveContractsPanelAdapter(snapshot: TerminalDecisionOrchestratorSnapshot): GovernanceReplayArchiveContractsPanelAdapter | null {
  const summary = snapshot.governanceReplayArchiveContractsSummary;
  if (!summary) {
    return null;
  }
  const contracts = [summary.market_regime_archive, summary.governance_replay];
  const lockedCount = contracts.filter((contract) => contract.status === "LOCKED").length;
  const driftCount = contracts.filter((contract) => contract.status === "DRIFT").length;
  const missingCount = contracts.filter((contract) => contract.status === "MISSING").length;
  const archiveContract = summary.market_regime_archive;
  const replayContract = summary.governance_replay;
  const archiveCompressionState = String(archiveContract.summary?.persistent_compression?.state || "THIN").trim().toLowerCase() || "thin";
  const replayFailureLayer = replayContract.summary?.failure_answer?.layer || null;

  return {
    compact_label: `ARCH ${lockedCount}/${contracts.length} locked`,
    detail_label: [
      `locked ${lockedCount}/${contracts.length} · drift ${driftCount} · missing ${missingCount}`,
      summary.reasons.slice(0, 2).join(" · "),
    ].filter(Boolean).join(" · "),
    pill_tone: driftCount > 0
      ? "bad"
      : missingCount > 0
        ? "warn"
        : "good",
    operator_cards: [
      {
        key: archiveContract.contract_key,
        label: formatArchiveContractOperatorLabel(archiveContract.contract_key),
        short_label: `${formatArchiveContractOperatorLabel(archiveContract.contract_key)} ${archiveContract.status.toLowerCase()}`,
        dominant_reason: archiveContract.status === "DRIFT"
          ? "schema drift"
          : archiveContract.status === "MISSING"
            ? "payload missing"
            : archiveContract.summary.dominant_blocking_layer && archiveContract.summary.dominant_blocking_layer !== "none"
              ? humanizeTerminalReasonLabel(archiveContract.summary.dominant_blocking_layer)
              : archiveContract.summary.latest_transition?.transition_type
                ? humanizeTerminalReasonLabel(archiveContract.summary.latest_transition.transition_type)
                : `compression ${archiveCompressionState}`,
        version_label: archiveContract.current_summary_version || "missing",
        pill_tone: archiveContract.status === "LOCKED" ? "good" : archiveContract.status === "MISSING" ? "warn" : "bad",
      },
      {
        key: replayContract.contract_key,
        label: formatArchiveContractOperatorLabel(replayContract.contract_key),
        short_label: `${formatArchiveContractOperatorLabel(replayContract.contract_key)} ${replayContract.status.toLowerCase()}`,
        dominant_reason: replayContract.status === "DRIFT"
          ? "schema drift"
          : replayContract.status === "MISSING"
            ? "payload missing"
            : replayFailureLayer
              ? humanizeTerminalReasonLabel(replayFailureLayer)
              : replayContract.summary.active_layer
                ? humanizeTerminalReasonLabel(replayContract.summary.active_layer)
                : humanizeTerminalReasonLabel(replayContract.summary.state),
        version_label: replayContract.current_summary_version || "missing",
        pill_tone: replayContract.status === "LOCKED" ? "good" : replayContract.status === "MISSING" ? "warn" : "bad",
      },
    ],
  };
}

export function buildFreezeV1ContractsPanelAdapter(snapshot: TerminalDecisionOrchestratorSnapshot): FreezeV1ContractsPanelAdapter | null {
  const summary = snapshot.activeFreezeV1ContractsSummary;
  if (!summary) {
    return null;
  }
  const missingCount = summary.contracts.filter((contract) => contract.status === "MISSING").length;
  const driftCount = summary.contracts.filter((contract) => contract.status === "DRIFT").length;

  return {
    compact_label: `FRZ:${summary.freeze_state} ${summary.locked_contract_count}/${summary.contracts.length}`,
    detail_label: [
      `locked ${summary.locked_contract_count}/${summary.contracts.length}`,
      `missing ${missingCount} · drift ${driftCount}`,
      summary.reasons.slice(0, 3).join(" · "),
    ].filter(Boolean).join(" · "),
    pill_tone: summary.freeze_state === "DRIFT"
      ? "bad"
      : summary.freeze_state === "PARTIAL"
        ? "warn"
        : "good",
    contract_pills: summary.contracts.map((contract) => ({
      key: contract.key,
      label: `${contract.key} ${contract.current_version || "missing"}`,
      tone: contract.status === "LOCKED" ? "good" : contract.status === "MISSING" ? "warn" : "bad",
    })),
  };
}