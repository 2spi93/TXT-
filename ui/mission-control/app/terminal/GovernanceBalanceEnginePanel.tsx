import type { GovernanceBalanceSummary } from "./governanceBalanceEngine";
import type { RecoveryMomentumSummary } from "./recoveryMomentumEngine";

type Props = {
  summary: GovernanceBalanceSummary;
  recoveryMomentum: RecoveryMomentumSummary;
};

function toneClass(state: GovernanceBalanceSummary["state"]): string {
  if (state === "LOCKED") {
    return "bad";
  }
  if (state === "PRESSURED") {
    return "warn";
  }
  if (state === "OPPORTUNISTIC") {
    return "good";
  }
  return "subtle";
}

export default function GovernanceBalanceEnginePanel({ summary, recoveryMomentum }: Props) {
  return (
    <div style={{ marginBottom: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(120, 147, 188, 0.2)", background: "rgba(9, 14, 24, 0.72)" }} data-testid="terminal-governance-balance-engine-panel">
      <div className="chart-stat-label" style={{ marginBottom: 6 }}>Governance balance engine</div>
      <div className="exec-explainability-pills" style={{ marginBottom: 6 }}>
        <span className={`chart-action-pill chart-action-pill-status ${toneClass(summary.state)}`}>{summary.summary_label}</span>
        <span className="chart-action-pill">{`protect ${summary.protection_pressure_pct}%`}</span>
        <span className="chart-action-pill">{`opp ${summary.opportunity_pressure_pct}%`}</span>
        <span className="chart-action-pill">{`recover ${summary.recovery_momentum_pct}%`}</span>
        <span className="chart-action-pill">{`inertia ${summary.governance_inertia_pct}%`}</span>
        <span className="chart-action-pill">{`freeze ${summary.freeze_drag_pct}%`}</span>
        <span className="chart-action-pill">{`aggr ${summary.aggression_budget_pct}%`}</span>
        <span className="chart-action-pill">{`ready ${summary.reacceleration_readiness_pct}%`}</span>
      </div>
      <div className="subtle mini" style={{ marginBottom: 6 }}>
        {`cadence ${summary.cadence.toLowerCase()} / ${summary.cadence_budget_pct}% · exposure ${summary.allowed_exposure_pct}% / ${summary.exposure_budget_pct}% · route ${summary.routing_aggressiveness_pct}% · diversify ${summary.venue_diversification_pct}% · velocity ${summary.reacceleration_velocity_pct}%`}
      </div>
      <div className="subtle mini" style={{ marginBottom: 6 }}>
        {`pressure ${summary.pressure_normalization.arbitration_state.toLowerCase()} · dominant ${summary.pressure_normalization.dominant_pressure_key} · reacc ${summary.reacceleration_state.toLowerCase()} · review ${summary.review_required ? "yes" : "no"}`}
      </div>
      <div className="exec-explainability-pills" style={{ marginBottom: 4 }}>
        <span className="chart-action-pill">{recoveryMomentum.summary_label}</span>
        <span className="chart-action-pill">{`confidence ${recoveryMomentum.confidence_recovery_pct}%`}</span>
        <span className="chart-action-pill">{`reacc ${recoveryMomentum.risk_reacceleration_pct}%`}</span>
        <span className="chart-action-pill">{`false ${recoveryMomentum.false_recovery_risk_pct}%`}</span>
      </div>
      <div className="subtle mini">{summary.reasons.slice(0, 4).join(" · ") || "governance balance nominal"}</div>
    </div>
  );
}