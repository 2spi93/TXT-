export type AutoExecutionOracleGateInput = {
  oracleBlocksExecution: boolean;
  oracleBlockingLayer?: string | null;
  autoMetaPass: boolean;
  autoRiskHardPass: boolean;
  riskAiLiveBlocked: boolean;
  capitalScalingLiveBlocked: boolean;
  journalWindowScalingLiveBlocked: boolean;
  profitOptimizerLiveExitBlocked: boolean;
  autoRiskKillSwitchActive: boolean;
  autoSessionPass: boolean;
  autoSessionLabel: string;
  autoSymbolLossPass: boolean;
  selfLearningPass: boolean;
  microAlphaExecutable: boolean;
  autoEntryReady: boolean;
  hasSuggestedBracket: boolean;
  replayEnabled: boolean;
  journalTierLabel: string;
  capitalStatusLabel: string;
  riskAiReasonLabel: string;
  profitOptimizerReasonLabel: string;
  microAlphaSetupType: string;
  autoCorrelationCluster: string;
  autoCorrelationClusterBreached: boolean;
  autoVolatilitySpikeBreached: boolean;
  autoVolatilityBps: number;
  autoAlphaRejectBreached: boolean;
};

export type AutoExecutionOracleGateDecision = {
  ready: boolean;
  autoState: "READY" | "BLOCKED" | "KILLED";
  riskLabel: "OK" | "BLOCKED";
  ruleLabel: string;
};

export function buildAutoExecutionOracleGate(input: AutoExecutionOracleGateInput): AutoExecutionOracleGateDecision {
  const ready = input.autoMetaPass
    && input.autoRiskHardPass
    && !input.oracleBlocksExecution
    && !input.riskAiLiveBlocked
    && !input.capitalScalingLiveBlocked
    && !input.journalWindowScalingLiveBlocked
    && !input.profitOptimizerLiveExitBlocked
    && !input.autoRiskKillSwitchActive
    && input.autoSessionPass
    && input.autoSymbolLossPass
    && input.selfLearningPass
    && input.microAlphaExecutable
    && input.autoEntryReady
    && input.hasSuggestedBracket
    && !input.replayEnabled;
  const autoState: AutoExecutionOracleGateDecision["autoState"] = input.autoRiskKillSwitchActive
    ? "KILLED"
    : ready
      ? "READY"
      : "BLOCKED";
  const ruleLabel = input.autoRiskKillSwitchActive
    ? "kill switch"
    : input.oracleBlocksExecution
      ? `oracle ${String(input.oracleBlockingLayer || "contract").toLowerCase()}`
    : input.journalWindowScalingLiveBlocked
      ? `journal ${input.journalTierLabel.toLowerCase()}`
    : input.capitalScalingLiveBlocked
      ? `capital ${input.capitalStatusLabel.toLowerCase()}`
    : input.riskAiLiveBlocked
      ? `risk ai ${input.riskAiReasonLabel.toLowerCase()}`
    : input.profitOptimizerLiveExitBlocked
      ? `profit exit ${input.profitOptimizerReasonLabel.toLowerCase()}`
    : !input.autoSessionPass
      ? `session ${input.autoSessionLabel}`
    : !input.autoSymbolLossPass
      ? "symbol loss cap"
    : !input.selfLearningPass
      ? "v5 execution filter"
    : input.autoCorrelationClusterBreached
      ? `cluster ${input.autoCorrelationCluster}`
    : input.autoVolatilitySpikeBreached
      ? `vol spike ${input.autoVolatilityBps.toFixed(1)}bps`
    : input.autoAlphaRejectBreached
      ? `alpha ${input.microAlphaSetupType}`
    : input.autoMetaPass
      ? `meta pass ${input.microAlphaSetupType}`
      : "meta blocked";
  return {
    ready,
    autoState,
    riskLabel: ready ? "OK" : "BLOCKED",
    ruleLabel,
  };
}