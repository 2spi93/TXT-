import { buildCapitalScarMemorySummary, type CapitalScarMemorySummary } from "./capitalScarMemory";
import { buildDynamicCapitalPressureSummary, type DynamicCapitalPressureSummary } from "./dynamicCapitalPressure";
import { buildExecutionRealityGovernanceSummary, type ExecutionRealityGovernanceSummary } from "./executionRealityGovernance";
import { buildExecutionRealityMemorySnapshot, type ExecutionRealityMemorySnapshot } from "./executionRealityMemory";
import { buildExecutionRealitySummary, type ExecutionRealitySummary } from "./executionRealityScore";
import {
  buildFinalDecisionOracleExecutionView,
  buildFinalDecisionOracleObservabilityView,
  buildFinalDecisionTruth,
  type FinalDecisionOracleExecutionView,
  type FinalDecisionOracleObservabilityView,
  type FinalDecisionTruth,
} from "./finalDecisionTruth";
import { buildFreezeV1ContractsSummary, type FreezeV1ContractsSummary } from "./freezeV1Contracts";
import { buildGovernanceBalanceSummary, type GovernanceBalanceSummary } from "./governanceBalanceEngine";
import { buildGovernanceReplayDetailedTimeline, buildGovernanceReplaySummary, type GovernanceReplayDetailedTimelineStep, type GovernanceReplaySummary } from "./governanceReplay";
import { buildGovernanceReplayArchiveContractsSummary, normalizeArchivePersistentCompression, type GovernanceReplayArchiveContractsSummary, type GovernanceReplayViewSummary } from "./governanceReplayView";
import { buildGovernanceStateMachineSummary, type GovernanceStateMachineSummary } from "./governanceStateMachine";
import { buildMarketRegimeArchiveSummary, type MarketRegimeArchiveSummary } from "./marketRegimeArchive";
import { buildRecoveryMomentumSummary, type RecoveryMomentumSummary } from "./recoveryMomentumEngine";
import { buildSelfHealingRecoverySnapshot, type SelfHealingRecoverySnapshot } from "./selfHealingRecoveryMemory";
import { buildSelfPreservationSummary, type SelfPreservationSummary } from "./selfPreservation";
import { buildExecutionTcaFoundationSummary, type ExecutionTcaFoundationSummary } from "./executionTcaFoundation";

type ExecutionRealityModeInput = {
  mode: "execution-reality";
  executionReality: Parameters<typeof buildExecutionRealitySummary>[0];
  executionRealityMemory: Omit<Parameters<typeof buildExecutionRealityMemorySnapshot>[0], "current">;
  executionRealityGovernance: Omit<Parameters<typeof buildExecutionRealityGovernanceSummary>[0], "executionReality" | "executionRealityMemory">;
};

type FinalDecisionModeInput = {
  mode: "final-decision";
  finalDecision: Parameters<typeof buildFinalDecisionTruth>[0] & {
    governanceInputs?: {
      capitalScar?: Parameters<typeof buildCapitalScarMemorySummary>[0];
      capitalPressure?: Omit<Parameters<typeof buildDynamicCapitalPressureSummary>[0], "capitalScar">;
      selfPreservation?: Parameters<typeof buildSelfPreservationSummary>[0];
    } | null;
  };
};

type GovernanceModeInput = {
  mode: "governance";
  governance: Omit<Parameters<typeof buildGovernanceBalanceSummary>[0], "executionTca" | "recoveryMomentum"> & {
    executionReality?: ExecutionRealitySummary | null;
    selfHealingRecovery?: SelfHealingRecoverySnapshot | null;
  };
};

type GovernanceReplayModeInput = {
  mode: "governance-replay";
  governanceReplay: {
    finalDecisionTruth: FinalDecisionTruth;
    selfHealingRecovery: Parameters<typeof buildSelfHealingRecoverySnapshot>[0];
    journalEntries: Array<Record<string, unknown>>;
    currentRegime?: string | null;
    capitalScaling?: Parameters<typeof buildFreezeV1ContractsSummary>[0]["capitalScaling"];
    executionRealityTemporalSizing?: Parameters<typeof buildFreezeV1ContractsSummary>[0]["executionRealityTemporalSizing"];
    persistedView?: GovernanceReplayViewSummary | null;
    nowMs?: number;
  };
};

export type TerminalDecisionOrchestratorInput = ExecutionRealityModeInput | FinalDecisionModeInput | GovernanceModeInput | GovernanceReplayModeInput;

export type TerminalDecisionOrchestratorSnapshot = {
  mode: TerminalDecisionOrchestratorInput["mode"];
  executionRealitySummary: ExecutionRealitySummary | null;
  executionRealityMemorySnapshot: ExecutionRealityMemorySnapshot | null;
  executionRealityGovernanceSummary: ExecutionRealityGovernanceSummary | null;
  selfHealingRecoverySnapshot: SelfHealingRecoverySnapshot | null;
  governanceReplayDetailedTimeline: GovernanceReplayDetailedTimelineStep[] | null;
  activeGovernanceReplayDetailedTimeline: GovernanceReplayDetailedTimelineStep[] | null;
  marketRegimeArchiveSummary: MarketRegimeArchiveSummary | null;
  activeMarketRegimeArchiveSummary: MarketRegimeArchiveSummary | null;
  activeMarketRegimePersistentCompression: MarketRegimeArchiveSummary["persistent_compression"] | null;
  governanceReplaySummary: GovernanceReplaySummary | null;
  activeGovernanceReplaySummary: GovernanceReplaySummary | null;
  freezeV1ContractsSummary: FreezeV1ContractsSummary | null;
  activeFreezeV1ContractsSummary: FreezeV1ContractsSummary | null;
  governanceReplayArchiveContractsSummary: GovernanceReplayArchiveContractsSummary | null;
  governanceStateMachineSummary: GovernanceStateMachineSummary | null;
  capitalScarMemorySummary: CapitalScarMemorySummary | null;
  dynamicCapitalPressureSummary: DynamicCapitalPressureSummary | null;
  selfPreservationSummary: SelfPreservationSummary | null;
  executionTcaFoundationSummary: ExecutionTcaFoundationSummary | null;
  recoveryMomentumSummary: RecoveryMomentumSummary | null;
  governanceBalanceSummary: GovernanceBalanceSummary | null;
  finalDecisionTruth: FinalDecisionTruth | null;
  finalDecisionExecutionOracle: FinalDecisionOracleExecutionView | null;
  finalDecisionObservabilityOracle: FinalDecisionOracleObservabilityView | null;
};

export function buildTerminalDecisionOrchestratorSnapshot(
  input: TerminalDecisionOrchestratorInput,
): TerminalDecisionOrchestratorSnapshot {
  if (input.mode === "execution-reality") {
    const executionRealitySummary = buildExecutionRealitySummary(input.executionReality);
    const executionRealityMemorySnapshot = buildExecutionRealityMemorySnapshot({
      ...input.executionRealityMemory,
      current: executionRealitySummary,
    });
    const executionRealityGovernanceSummary = buildExecutionRealityGovernanceSummary({
      ...input.executionRealityGovernance,
      executionReality: executionRealitySummary,
      executionRealityMemory: executionRealityMemorySnapshot,
    });

    return {
      mode: input.mode,
      executionRealitySummary,
      executionRealityMemorySnapshot,
      executionRealityGovernanceSummary,
      selfHealingRecoverySnapshot: null,
      governanceReplayDetailedTimeline: null,
      activeGovernanceReplayDetailedTimeline: null,
      marketRegimeArchiveSummary: null,
      activeMarketRegimeArchiveSummary: null,
      activeMarketRegimePersistentCompression: null,
      governanceReplaySummary: null,
      activeGovernanceReplaySummary: null,
      freezeV1ContractsSummary: null,
      activeFreezeV1ContractsSummary: null,
      governanceReplayArchiveContractsSummary: null,
      governanceStateMachineSummary: null,
      capitalScarMemorySummary: null,
      dynamicCapitalPressureSummary: null,
      selfPreservationSummary: null,
      executionTcaFoundationSummary: null,
      recoveryMomentumSummary: null,
      governanceBalanceSummary: null,
      finalDecisionTruth: null,
      finalDecisionExecutionOracle: null,
      finalDecisionObservabilityOracle: null,
    };
  }

  if (input.mode === "final-decision") {
    const capitalScarMemorySummary = input.finalDecision.capitalScar
      || (input.finalDecision.governanceInputs?.capitalScar
        ? buildCapitalScarMemorySummary(input.finalDecision.governanceInputs.capitalScar)
        : null);
    const selfPreservationSummary = input.finalDecision.selfPreservation
      || (input.finalDecision.governanceInputs?.selfPreservation
        ? buildSelfPreservationSummary(input.finalDecision.governanceInputs.selfPreservation)
        : null);
    const dynamicCapitalPressureSummary = input.finalDecision.capitalPressure
      || (input.finalDecision.governanceInputs?.capitalPressure
        ? buildDynamicCapitalPressureSummary({
          ...input.finalDecision.governanceInputs.capitalPressure,
          capitalScar: capitalScarMemorySummary,
        })
        : null);
    const finalDecisionTruth = buildFinalDecisionTruth({
      ...input.finalDecision,
      capitalScar: capitalScarMemorySummary,
      capitalPressure: dynamicCapitalPressureSummary,
      selfPreservation: selfPreservationSummary,
    });
    const governanceStateMachineSummary = buildGovernanceStateMachineSummary({
      finalDecisionTruth,
    });
    return {
      mode: input.mode,
      executionRealitySummary: input.finalDecision.executionReality || null,
      executionRealityMemorySnapshot: input.finalDecision.executionRealityMemory || null,
      executionRealityGovernanceSummary: input.finalDecision.executionRealityGovernance || null,
      selfHealingRecoverySnapshot: null,
      governanceReplayDetailedTimeline: null,
      activeGovernanceReplayDetailedTimeline: null,
      marketRegimeArchiveSummary: null,
      activeMarketRegimeArchiveSummary: null,
      activeMarketRegimePersistentCompression: null,
      governanceReplaySummary: null,
      activeGovernanceReplaySummary: null,
      freezeV1ContractsSummary: null,
      activeFreezeV1ContractsSummary: null,
      governanceReplayArchiveContractsSummary: null,
      governanceStateMachineSummary,
      capitalScarMemorySummary,
      dynamicCapitalPressureSummary,
      selfPreservationSummary,
      executionTcaFoundationSummary: null,
      recoveryMomentumSummary: null,
      governanceBalanceSummary: null,
      finalDecisionTruth,
      finalDecisionExecutionOracle: buildFinalDecisionOracleExecutionView(finalDecisionTruth),
      finalDecisionObservabilityOracle: buildFinalDecisionOracleObservabilityView(finalDecisionTruth),
    };
  }

  if (input.mode === "governance-replay") {
    const selfHealingRecoverySnapshot = buildSelfHealingRecoverySnapshot(input.governanceReplay.selfHealingRecovery);
    const governanceReplayDetailedTimeline = buildGovernanceReplayDetailedTimeline({
      journalEntries: input.governanceReplay.journalEntries,
      limit: 32,
    });
    const marketRegimeArchiveSummary = normalizeArchivePersistentCompression(buildMarketRegimeArchiveSummary(
      input.governanceReplay.journalEntries,
      {
        currentRegime: input.governanceReplay.currentRegime,
        nowMs: input.governanceReplay.nowMs,
      },
    ));
    const governanceReplaySummary = buildGovernanceReplaySummary({
      journalEntries: input.governanceReplay.journalEntries,
      currentTruth: input.governanceReplay.finalDecisionTruth,
      archive: marketRegimeArchiveSummary,
      nowMs: input.governanceReplay.nowMs,
    });
    const freezeV1ContractsSummary = buildFreezeV1ContractsSummary({
      finalDecisionTruth: input.governanceReplay.finalDecisionTruth,
      marketRegimeArchive: marketRegimeArchiveSummary,
      governanceReplay: governanceReplaySummary,
      executionReality: input.governanceReplay.finalDecisionTruth.execution_reality,
      executionRealityGovernance: input.governanceReplay.finalDecisionTruth.execution_reality_governance,
      executionRealityMemory: input.governanceReplay.finalDecisionTruth.execution_reality_memory,
      capitalScar: input.governanceReplay.finalDecisionTruth.capital_scar,
      capitalPressure: input.governanceReplay.finalDecisionTruth.capital_pressure,
      selfPreservation: input.governanceReplay.finalDecisionTruth.self_preservation as Pick<SelfPreservationSummary, "schema_version"> | null,
      capitalScaling: input.governanceReplay.capitalScaling || null,
      executionRealityTemporalSizing: input.governanceReplay.executionRealityTemporalSizing || null,
      nowMs: input.governanceReplay.nowMs,
    });
    const activeMarketRegimeArchiveSummary = normalizeArchivePersistentCompression(
      input.governanceReplay.persistedView?.archive || marketRegimeArchiveSummary,
    );
    const activeGovernanceReplaySummary = input.governanceReplay.persistedView?.replay || governanceReplaySummary;
    const activeFreezeV1ContractsSummary = input.governanceReplay.persistedView?.freeze || freezeV1ContractsSummary;
    const governanceReplayArchiveContractsSummary = input.governanceReplay.persistedView?.archive_contracts || buildGovernanceReplayArchiveContractsSummary({
      archive: activeMarketRegimeArchiveSummary,
      replay: activeGovernanceReplaySummary,
      freeze: activeFreezeV1ContractsSummary,
      nowMs: input.governanceReplay.nowMs,
    });
    const activeGovernanceReplayDetailedTimeline = input.governanceReplay.persistedView?.timeline_detailed?.length
      ? input.governanceReplay.persistedView.timeline_detailed
      : governanceReplayDetailedTimeline;
    const governanceStateMachineSummary = buildGovernanceStateMachineSummary({
      finalDecisionTruth: input.governanceReplay.finalDecisionTruth,
      selfHealingRecovery: selfHealingRecoverySnapshot,
      governanceReplay: activeGovernanceReplaySummary,
      freezeContracts: activeFreezeV1ContractsSummary,
      nowMs: input.governanceReplay.nowMs,
    });

    return {
      mode: input.mode,
      executionRealitySummary: input.governanceReplay.finalDecisionTruth.execution_reality,
      executionRealityMemorySnapshot: input.governanceReplay.finalDecisionTruth.execution_reality_memory,
      executionRealityGovernanceSummary: input.governanceReplay.finalDecisionTruth.execution_reality_governance,
      selfHealingRecoverySnapshot,
      governanceReplayDetailedTimeline,
      activeGovernanceReplayDetailedTimeline,
      marketRegimeArchiveSummary,
      activeMarketRegimeArchiveSummary,
      activeMarketRegimePersistentCompression: activeMarketRegimeArchiveSummary.persistent_compression,
      governanceReplaySummary,
      activeGovernanceReplaySummary,
      freezeV1ContractsSummary,
      activeFreezeV1ContractsSummary,
      governanceReplayArchiveContractsSummary,
      governanceStateMachineSummary,
      capitalScarMemorySummary: input.governanceReplay.finalDecisionTruth.capital_scar,
      dynamicCapitalPressureSummary: input.governanceReplay.finalDecisionTruth.capital_pressure,
      selfPreservationSummary: input.governanceReplay.finalDecisionTruth.self_preservation,
      executionTcaFoundationSummary: null,
      recoveryMomentumSummary: null,
      governanceBalanceSummary: null,
      finalDecisionTruth: input.governanceReplay.finalDecisionTruth,
      finalDecisionExecutionOracle: null,
      finalDecisionObservabilityOracle: null,
    };
  }

  const executionTcaFoundationSummary = buildExecutionTcaFoundationSummary({
    executionReality: input.governance.executionReality,
    governanceReplayTimeline: input.governance.governanceReplayTimeline,
  });
  const recoveryMomentumSummary = buildRecoveryMomentumSummary({
    selfHealingRecovery: input.governance.selfHealingRecovery,
    executionRealityMemory: input.governance.executionRealityMemory,
    executionRealityTemporalSizing: input.governance.temporalSizing,
    executionTca: executionTcaFoundationSummary,
    venueDecayMemory: input.governance.venueDecayMemory,
    contagionMemory: input.governance.contagionMemory,
    globalConfidenceDecay: input.governance.globalConfidenceDecay,
    crossMarket: input.governance.crossMarket,
  });
  const governanceBalanceSummary = buildGovernanceBalanceSummary({
    ...input.governance,
    executionTca: executionTcaFoundationSummary,
    recoveryMomentum: recoveryMomentumSummary,
  });
  const governanceStateMachineSummary = buildGovernanceStateMachineSummary({
    selfHealingRecovery: input.governance.selfHealingRecovery || null,
    governanceBalance: governanceBalanceSummary,
    recoveryMomentum: recoveryMomentumSummary,
  });

  return {
    mode: input.mode,
    executionRealitySummary: input.governance.executionReality || null,
    executionRealityMemorySnapshot: input.governance.executionRealityMemory || null,
    executionRealityGovernanceSummary: null,
    selfHealingRecoverySnapshot: null,
    governanceReplayDetailedTimeline: null,
    activeGovernanceReplayDetailedTimeline: null,
    marketRegimeArchiveSummary: null,
    activeMarketRegimeArchiveSummary: null,
    activeMarketRegimePersistentCompression: null,
    governanceReplaySummary: null,
    activeGovernanceReplaySummary: null,
    freezeV1ContractsSummary: null,
    activeFreezeV1ContractsSummary: null,
    governanceReplayArchiveContractsSummary: null,
    governanceStateMachineSummary,
    capitalScarMemorySummary: null,
    dynamicCapitalPressureSummary: null,
    selfPreservationSummary: null,
    executionTcaFoundationSummary,
    recoveryMomentumSummary,
    governanceBalanceSummary,
    finalDecisionTruth: null,
    finalDecisionExecutionOracle: null,
    finalDecisionObservabilityOracle: null,
  };
}