import { buildTradeLifecycleHealthSnapshot, type DecisionGovernanceFreezeKey, type DecisionGovernanceSnapshot } from "./tradeLifecycleHealth";

type DecisionGovernanceThresholds = {
  completion_rate_min_pct: number;
  native_evidence_min_pct: number;
  root_cause_closure_min_pct: number;
};

export type DecisionGovernanceCapabilityAssessment = {
  allowed: boolean;
  capability: DecisionGovernanceFreezeKey;
  thresholds: DecisionGovernanceThresholds;
  detail: "decision_governance_blocked" | "decision_governance_allowed";
  reasons: string[];
  governance: DecisionGovernanceSnapshot | null;
};

const DEFAULT_THRESHOLDS: DecisionGovernanceThresholds = {
  completion_rate_min_pct: 25,
  native_evidence_min_pct: 40,
  root_cause_closure_min_pct: 80,
};

function asPercent(numerator: number, denominator: number): number {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
}

export async function evaluateDecisionGovernanceCapability(
  capability: DecisionGovernanceFreezeKey,
): Promise<DecisionGovernanceCapabilityAssessment> {
  const snapshot = await buildTradeLifecycleHealthSnapshot();
  const governance = snapshot.decision_governance || null;
  const completionRatePct = governance?.decision_journey_completion_rate_pct ?? snapshot.decision_journey_completion.completion_rate_pct;
  const nativeEvidenceCoveragePct = governance?.native_evidence_coverage_pct
    ?? asPercent(
      snapshot.decision_evidence_quality.native,
      snapshot.decision_evidence_quality.native
        + snapshot.decision_evidence_quality.backfilled
        + snapshot.decision_evidence_quality.inferred
        + snapshot.decision_evidence_quality.missing,
    );
  const rootCauseClosureRatePct = governance?.root_cause_closure_rate_pct
    ?? snapshot.allocation_writer_closure.closure_evidence.root_cause_closure_rate_pct;
  const freezeControl = governance?.freeze_controls.find((entry) => entry.key === capability) || null;
  const reasons: string[] = [];

  if (completionRatePct < DEFAULT_THRESHOLDS.completion_rate_min_pct) {
    reasons.push(`decision_journey_completion_rate_pct ${completionRatePct.toFixed(1)} < ${DEFAULT_THRESHOLDS.completion_rate_min_pct}`);
  }
  if (nativeEvidenceCoveragePct < DEFAULT_THRESHOLDS.native_evidence_min_pct) {
    reasons.push(`native_evidence_coverage_pct ${nativeEvidenceCoveragePct.toFixed(1)} < ${DEFAULT_THRESHOLDS.native_evidence_min_pct}`);
  }
  if (rootCauseClosureRatePct < DEFAULT_THRESHOLDS.root_cause_closure_min_pct) {
    reasons.push(`root_cause_closure_rate_pct ${rootCauseClosureRatePct.toFixed(1)} < ${DEFAULT_THRESHOLDS.root_cause_closure_min_pct}`);
  }
  if (freezeControl?.frozen && freezeControl.reason) {
    reasons.unshift(freezeControl.reason);
  }

  return {
    allowed: reasons.length === 0,
    capability,
    thresholds: DEFAULT_THRESHOLDS,
    detail: reasons.length === 0 ? "decision_governance_allowed" : "decision_governance_blocked",
    reasons,
    governance,
  };
}