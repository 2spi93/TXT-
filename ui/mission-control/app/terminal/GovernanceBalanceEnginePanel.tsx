import type { GovernanceBalancePanelAdapter } from "./terminalPanelAdapters";

type Props = {
  adapter: GovernanceBalancePanelAdapter;
};

function toneClass(tone: GovernanceBalancePanelAdapter["tone"]): string {
  if (tone === "bad") {
    return "bad";
  }
  if (tone === "warn") {
    return "warn";
  }
  if (tone === "good") {
    return "good";
  }
  return "subtle";
}

export default function GovernanceBalanceEnginePanel({ adapter }: Props) {
  return (
    <div style={{ marginBottom: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(120, 147, 188, 0.2)", background: "rgba(9, 14, 24, 0.72)" }} data-testid="terminal-governance-balance-engine-panel">
      <div className="chart-stat-label" style={{ marginBottom: 6 }}>Governance balance engine</div>
      <div className="exec-explainability-pills" style={{ marginBottom: 6 }}>
        <span className={`chart-action-pill chart-action-pill-status ${toneClass(adapter.tone)}`}>{adapter.summary_label}</span>
        {adapter.primary_pills.map((pill) => (
          <span key={pill} className="chart-action-pill">{pill}</span>
        ))}
      </div>
      <div className="subtle mini" style={{ marginBottom: 6 }}>
        {adapter.budget_label}
      </div>
      <div className="subtle mini" style={{ marginBottom: 6 }}>
        {adapter.arbitration_label}
      </div>
      <div className="subtle mini" style={{ marginBottom: 6 }}>
        {adapter.state_machine_label}
      </div>
      <div className="subtle mini" style={{ marginBottom: 6 }}>
        {adapter.transition_label}
      </div>
      <div className="exec-explainability-pills" style={{ marginBottom: 4 }}>
        {adapter.recovery_pills.map((pill) => (
          <span key={pill} className="chart-action-pill">{pill}</span>
        ))}
      </div>
      <div className="subtle mini">{adapter.reasons_label}</div>
    </div>
  );
}