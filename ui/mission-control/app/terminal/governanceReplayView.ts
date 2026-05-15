import type { FinalDecisionTruth } from "./finalDecisionTruth";
import { buildFreezeV1ContractsSummary, type FreezeV1Contract, type FreezeV1ContractsSummary } from "./freezeV1Contracts";
import { buildGovernanceReplayDetailedTimeline, buildGovernanceReplaySummary, type GovernanceReplayDetailedTimelineStep, type GovernanceReplaySummary } from "./governanceReplay";
import { buildMarketRegimeArchiveSummary, type MarketRegimeArchiveSummary } from "./marketRegimeArchive";
import type { CapitalScalingDecision } from "../../lib/capitalScalingEngine";
import type { ExecutionRealityTemporalSizingSummary } from "./executionRealityTemporalSizing";

type JsonMap = Record<string, unknown>;

export type GovernanceReplayViewSummary = {
  schema_version: "governance-replay-view/v1" | "governance-replay-view/v2" | "governance-replay-view/v3";
  generated_at_iso: string;
  source: "persisted_journal";
  scope: {
    symbol: string;
    timeframe: string;
    strategy: string;
    current_regime: string | null;
  };
  entries_count: number;
  archive: MarketRegimeArchiveSummary;
  replay: GovernanceReplaySummary;
  archive_contracts: GovernanceReplayArchiveContractsSummary;
  timeline_detailed: GovernanceReplayDetailedTimelineStep[];
  freeze: FreezeV1ContractsSummary;
};

export type GovernanceReplayArchiveContract<TSummary> = {
  schema_version: "governance-replay-archive-contract/v1";
  contract_key: "market_regime_archive" | "governance_replay";
  expected_summary_version: string;
  current_summary_version: string | null;
  status: FreezeV1Contract["status"];
  summary: TSummary;
};

export type GovernanceReplayArchiveContractsSummary = {
  schema_version: "governance-replay-archive-contracts/v1";
  generated_at_iso: string;
  market_regime_archive: GovernanceReplayArchiveContract<MarketRegimeArchiveSummary>;
  governance_replay: GovernanceReplayArchiveContract<GovernanceReplaySummary>;
  reasons: string[];
};

function normalizeArchivePersistentCompression(
  archive: MarketRegimeArchiveSummary,
): MarketRegimeArchiveSummary {
  const compression = archive.persistent_compression;
  return {
    ...archive,
    persistent_compression: {
      state: compression?.state || "THIN",
      compression_ratio_pct: Number.isFinite(compression?.compression_ratio_pct)
        ? compression.compression_ratio_pct
        : 0,
      relapse_probability_pct: Number.isFinite(compression?.relapse_probability_pct)
        ? compression.relapse_probability_pct
        : 0,
      retention_half_life_hours: Number.isFinite(compression?.retention_half_life_hours)
        ? compression.retention_half_life_hours
        : 0,
      persistent_transition_count: Number.isFinite(compression?.persistent_transition_count)
        ? compression.persistent_transition_count
        : 0,
      hot_capsule_count: Number.isFinite(compression?.hot_capsule_count)
        ? compression.hot_capsule_count
        : 0,
      dominant_transition: compression?.dominant_transition || null,
    },
  };
}

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function asString(value: unknown, fallback = ""): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function latestTruth(entries: Array<Record<string, unknown>>): FinalDecisionTruth | null {
  for (const entry of entries) {
    const truth = asRecord(asRecord(entry.meta).final_decision_truth);
    if (Object.keys(truth).length === 0) {
      continue;
    }
    return truth as FinalDecisionTruth;
  }
  return null;
}

function latestCapitalScaling(entries: Array<Record<string, unknown>>): {
  capitalScaling: CapitalScalingDecision | null;
  temporalSizing: ExecutionRealityTemporalSizingSummary | null;
} {
  for (const entry of entries) {
    const capitalScaling = asRecord(asRecord(entry.meta).capital_scaling);
    if (Object.keys(capitalScaling).length === 0) {
      continue;
    }
    return {
      capitalScaling: capitalScaling as CapitalScalingDecision,
      temporalSizing: asRecord(capitalScaling.execution_reality_temporal_sizing) as ExecutionRealityTemporalSizingSummary,
    };
  }
  return {
    capitalScaling: null,
    temporalSizing: null,
  };
}

function findFreezeContract(
  freeze: FreezeV1ContractsSummary,
  key: "market_regime_archive" | "governance_replay",
): FreezeV1Contract | null {
  return freeze.contracts.find((contract) => contract.key === key) || null;
}

function buildArchiveContract<TSummary>(input: {
  key: "market_regime_archive" | "governance_replay";
  summary: TSummary;
  freezeContract: FreezeV1Contract | null;
  summarySchemaVersion: string | null;
}): GovernanceReplayArchiveContract<TSummary> {
  return {
    schema_version: "governance-replay-archive-contract/v1",
    contract_key: input.key,
    expected_summary_version: input.freezeContract?.expected_version || "unknown",
    current_summary_version: input.summarySchemaVersion,
    status: input.freezeContract?.status || "MISSING",
    summary: input.summary,
  };
}

function buildGovernanceReplayArchiveContractsSummary(input: {
  archive: MarketRegimeArchiveSummary;
  replay: GovernanceReplaySummary;
  freeze: FreezeV1ContractsSummary;
  nowMs?: number;
}): GovernanceReplayArchiveContractsSummary {
  const marketRegimeArchiveContract = buildArchiveContract({
    key: "market_regime_archive",
    summary: input.archive,
    freezeContract: findFreezeContract(input.freeze, "market_regime_archive"),
    summarySchemaVersion: input.archive.schema_version,
  });
  const governanceReplayContract = buildArchiveContract({
    key: "governance_replay",
    summary: input.replay,
    freezeContract: findFreezeContract(input.freeze, "governance_replay"),
    summarySchemaVersion: input.replay.schema_version,
  });

  return {
    schema_version: "governance-replay-archive-contracts/v1",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    market_regime_archive: marketRegimeArchiveContract,
    governance_replay: governanceReplayContract,
    reasons: [
      `${marketRegimeArchiveContract.contract_key}:${marketRegimeArchiveContract.current_summary_version || "missing"}:${marketRegimeArchiveContract.status.toLowerCase()}`,
      `${governanceReplayContract.contract_key}:${governanceReplayContract.current_summary_version || "missing"}:${governanceReplayContract.status.toLowerCase()}`,
    ],
  };
}

export function buildGovernanceReplayViewSummary(input: {
  symbol: string;
  timeframe: string;
  strategy: string;
  currentRegime?: string | null;
  entries: Array<Record<string, unknown>>;
  nowMs?: number;
}): GovernanceReplayViewSummary {
  const generatedAtIso = new Date(input.nowMs || Date.now()).toISOString();
  const archive = normalizeArchivePersistentCompression(buildMarketRegimeArchiveSummary(input.entries, {
    currentRegime: input.currentRegime,
    nowMs: input.nowMs,
  }));
  const truth = latestTruth(input.entries);
  const replay = buildGovernanceReplaySummary({
    journalEntries: input.entries,
    currentTruth: truth,
    archive,
    nowMs: input.nowMs,
  });
  const timelineDetailed = buildGovernanceReplayDetailedTimeline({
    journalEntries: input.entries,
    limit: 32,
  });
  const latestScaling = latestCapitalScaling(input.entries);
  const freeze = buildFreezeV1ContractsSummary({
    finalDecisionTruth: truth,
    marketRegimeArchive: archive,
    governanceReplay: replay,
    executionReality: truth?.execution_reality || null,
    executionRealityGovernance: truth?.execution_reality_governance || null,
    executionRealityMemory: truth?.execution_reality_memory || null,
    capitalScar: truth?.capital_scar || null,
    capitalPressure: truth?.capital_pressure || null,
    selfPreservation: truth?.self_preservation || null,
    capitalScaling: latestScaling.capitalScaling,
    executionRealityTemporalSizing: latestScaling.temporalSizing,
    nowMs: input.nowMs,
  });
  const archiveContracts = buildGovernanceReplayArchiveContractsSummary({
    archive,
    replay,
    freeze,
    nowMs: input.nowMs,
  });

  return {
    schema_version: "governance-replay-view/v3",
    generated_at_iso: generatedAtIso,
    source: "persisted_journal",
    scope: {
      symbol: asString(input.symbol).toUpperCase(),
      timeframe: asString(input.timeframe),
      strategy: asString(input.strategy),
      current_regime: input.currentRegime ? asString(input.currentRegime).toUpperCase() : archive.active_regime,
    },
    entries_count: input.entries.length,
    archive,
    replay,
    archive_contracts: archiveContracts,
    timeline_detailed: timelineDetailed,
    freeze,
  };
}