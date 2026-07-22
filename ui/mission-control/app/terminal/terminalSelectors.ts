import type { FinalDecisionTruth } from "./finalDecisionTruth";
import type { GovernanceBalanceSummary } from "./governanceBalanceEngine";
import type { RecoveryMomentumSummary } from "./recoveryMomentumEngine";
import type { TerminalDecisionOrchestratorSnapshot } from "./terminalDecisionOrchestrator";

export function selectGovernanceBalanceSummary(snapshot: TerminalDecisionOrchestratorSnapshot): GovernanceBalanceSummary | null {
  return snapshot.governanceBalanceSummary;
}

export function selectRecoveryMomentumSummary(snapshot: TerminalDecisionOrchestratorSnapshot): RecoveryMomentumSummary | null {
  return snapshot.recoveryMomentumSummary;
}

export function selectFinalDecisionTruth(snapshot: TerminalDecisionOrchestratorSnapshot): FinalDecisionTruth | null {
  return snapshot.finalDecisionTruth;
}