import type { CapitalScarMemorySummary } from "./capitalScarMemory";
import type { DynamicCapitalPressureSummary } from "./dynamicCapitalPressure";
import type { ExecutionRealityGovernanceSummary } from "./executionRealityGovernance";
import type { ExecutionRealityMemorySnapshot } from "./executionRealityMemory";
import type { ExecutionRealitySummary } from "./executionRealityScore";
import type { ExecutionRealityTemporalSizingSummary } from "./executionRealityTemporalSizing";
import type { FinalDecisionTruth } from "./finalDecisionTruth";
import type { GovernanceReplaySummary } from "./governanceReplay";
import type { MarketRegimeArchiveSummary } from "./marketRegimeArchive";
import type { SelfPreservationSummary } from "./selfPreservation";
import type { CapitalScalingDecision } from "../../lib/capitalScalingEngine";

export type FreezeV1ContractStatus = "LOCKED" | "MISSING" | "DRIFT";

export type FreezeV1Contract = {
  key:
    | "final_decision_truth"
    | "market_regime_archive"
    | "governance_replay"
    | "execution_reality"
    | "execution_reality_governance"
    | "execution_reality_memory"
    | "capital_scar"
    | "capital_pressure"
    | "self_preservation"
    | "capital_scaling"
    | "execution_reality_temporal_sizing";
  label: string;
  expected_version: string;
  current_version: string | null;
  status: FreezeV1ContractStatus;
};

export type FreezeV1ContractsSummary = {
  schema_version: "freeze-v1-contracts/v1";
  generated_at_iso: string;
  freeze_state: "LOCKED" | "PARTIAL" | "DRIFT";
  locked_contract_count: number;
  contracts: FreezeV1Contract[];
  reasons: string[];
};

const FROZEN_V1_CONTRACTS: Array<Omit<FreezeV1Contract, "current_version" | "status">> = [
  {
    key: "final_decision_truth",
    label: "Final decision truth",
    expected_version: "final-decision-truth/v1",
  },
  {
    key: "market_regime_archive",
    label: "Market regime archive",
    expected_version: "market-regime-archive/v1",
  },
  {
    key: "governance_replay",
    label: "Governance replay",
    expected_version: "governance-replay/v1",
  },
  {
    key: "execution_reality",
    label: "Execution reality",
    expected_version: "execution-reality/v1",
  },
  {
    key: "execution_reality_governance",
    label: "Execution reality governance",
    expected_version: "execution-reality-governance/v1",
  },
  {
    key: "execution_reality_memory",
    label: "Execution reality memory",
    expected_version: "execution-reality-memory/v1",
  },
  {
    key: "capital_scar",
    label: "Capital scar memory",
    expected_version: "capital-scar-memory/v1",
  },
  {
    key: "capital_pressure",
    label: "Dynamic capital pressure",
    expected_version: "dynamic-capital-pressure/v1",
  },
  {
    key: "self_preservation",
    label: "Self preservation",
    expected_version: "self-preservation/v1",
  },
  {
    key: "capital_scaling",
    label: "Capital scaling",
    expected_version: "capital-scaling/v1",
  },
  {
    key: "execution_reality_temporal_sizing",
    label: "Execution reality temporal sizing",
    expected_version: "execution-reality-temporal-sizing/v1",
  },
];

export function buildFreezeV1ContractsSummary(input: {
  finalDecisionTruth?: Pick<FinalDecisionTruth, "schema_version"> | null;
  marketRegimeArchive?: Pick<MarketRegimeArchiveSummary, "schema_version"> | null;
  governanceReplay?: Pick<GovernanceReplaySummary, "schema_version"> | null;
  executionReality?: Pick<ExecutionRealitySummary, "schema_version"> | null;
  executionRealityGovernance?: Pick<ExecutionRealityGovernanceSummary, "schema_version"> | null;
  executionRealityMemory?: Pick<ExecutionRealityMemorySnapshot, "schema_version"> | null;
  capitalScar?: Pick<CapitalScarMemorySummary, "schema_version"> | null;
  capitalPressure?: Pick<DynamicCapitalPressureSummary, "schema_version"> | null;
  selfPreservation?: Pick<SelfPreservationSummary, "schema_version"> | null;
  capitalScaling?: Pick<CapitalScalingDecision, "schema_version"> | null;
  executionRealityTemporalSizing?: Pick<ExecutionRealityTemporalSizingSummary, "schema_version"> | null;
  nowMs?: number;
}): FreezeV1ContractsSummary {
  const contracts = FROZEN_V1_CONTRACTS.map((contract) => {
    const currentVersion = contract.key === "final_decision_truth"
      ? input.finalDecisionTruth?.schema_version || null
      : contract.key === "market_regime_archive"
        ? input.marketRegimeArchive?.schema_version || null
        : contract.key === "governance_replay"
          ? input.governanceReplay?.schema_version || null
          : contract.key === "execution_reality"
            ? input.executionReality?.schema_version || null
            : contract.key === "execution_reality_governance"
              ? input.executionRealityGovernance?.schema_version || null
              : contract.key === "execution_reality_memory"
                ? input.executionRealityMemory?.schema_version || null
                : contract.key === "capital_scar"
                  ? input.capitalScar?.schema_version || null
                  : contract.key === "capital_pressure"
                    ? input.capitalPressure?.schema_version || null
                    : contract.key === "self_preservation"
                      ? input.selfPreservation?.schema_version || null
                      : contract.key === "capital_scaling"
                        ? input.capitalScaling?.schema_version || null
                        : input.executionRealityTemporalSizing?.schema_version || null;
    const status: FreezeV1ContractStatus = currentVersion === null
      ? "MISSING"
      : currentVersion === contract.expected_version
        ? "LOCKED"
        : "DRIFT";
    return {
      ...contract,
      current_version: currentVersion,
      status,
    } satisfies FreezeV1Contract;
  });
  const hasDrift = contracts.some((contract) => contract.status === "DRIFT");
  const hasMissing = contracts.some((contract) => contract.status === "MISSING");
  return {
    schema_version: "freeze-v1-contracts/v1",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    freeze_state: hasDrift ? "DRIFT" : hasMissing ? "PARTIAL" : "LOCKED",
    locked_contract_count: contracts.filter((contract) => contract.status === "LOCKED").length,
    contracts,
    reasons: contracts.map((contract) => {
      if (contract.status === "LOCKED") {
        return `${contract.key}:${contract.current_version}`;
      }
      if (contract.status === "MISSING") {
        return `${contract.key}:missing`;
      }
      return `${contract.key}:drift ${contract.current_version}`;
    }),
  };
}