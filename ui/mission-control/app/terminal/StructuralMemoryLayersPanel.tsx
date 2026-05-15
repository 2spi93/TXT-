import type { CapitalAgingGovernanceSummary } from "./capitalAgingGovernance";
import type { ContagionMemorySummary } from "./contagionMemory";
import type { GlobalConfidenceDecaySummary } from "./globalConfidenceDecay";
import type { VenueDecayMemorySummary } from "./venueDecayMemory";

type Props = {
  venueDecayMemory: VenueDecayMemorySummary;
  capitalAgingGovernance: CapitalAgingGovernanceSummary;
  contagionMemory: ContagionMemorySummary;
  globalConfidenceDecay: GlobalConfidenceDecaySummary;
};

function toneClass(state: string): string {
  if (["LOCKED", "SYSTEMIC", "BLOCKED"].includes(state)) {
    return "bad";
  }
  if (["DECAYED", "STALE", "ELEVATED", "DEFENSIVE", "DECAYING", "WATCH", "AGED"].includes(state)) {
    return "warn";
  }
  return "good";
}

export default function StructuralMemoryLayersPanel(props: Props) {
  const items = [
    {
      key: "venue",
      title: "Venue decay memory",
      summary: props.venueDecayMemory.summary_label,
      detail: `driver ${props.venueDecayMemory.dominant_driver.toLowerCase()} · cap ${props.venueDecayMemory.size_cap_pct}% · switches ${props.venueDecayMemory.metrics.route_mode_switch_count}`,
      state: props.venueDecayMemory.state,
    },
    {
      key: "capital-aging",
      title: "Capital aging governance",
      summary: props.capitalAgingGovernance.summary_label,
      detail: `driver ${props.capitalAgingGovernance.dominant_driver.toLowerCase()} · mult x${props.capitalAgingGovernance.multiplier.toFixed(2)} · dd ${props.capitalAgingGovernance.metrics.drawdown_pct.toFixed(2)}%`,
      state: props.capitalAgingGovernance.state,
    },
    {
      key: "contagion",
      title: "Contagion memory",
      summary: props.contagionMemory.summary_label,
      detail: `driver ${props.contagionMemory.dominant_driver.toLowerCase()} · breadth ${props.contagionMemory.metrics.negative_risk_count} · hedge ${props.contagionMemory.metrics.hedge_stress_count}`,
      state: props.contagionMemory.state,
    },
    {
      key: "global-confidence",
      title: "Global confidence decay",
      summary: props.globalConfidenceDecay.summary_label,
      detail: `action ${props.globalConfidenceDecay.recommended_action} · eff ${props.globalConfidenceDecay.effective_score_full.toFixed(2)} · decay ${(props.globalConfidenceDecay.total_decay * 100).toFixed(0)}pts`,
      state: props.globalConfidenceDecay.state,
    },
  ];

  return (
    <div style={{ marginBottom: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(120, 147, 188, 0.2)", background: "rgba(9, 14, 24, 0.72)" }} data-testid="terminal-structural-memory-layers-panel">
      <div className="chart-stat-label" style={{ marginBottom: 6 }}>Structural memory layers</div>
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((item) => (
          <div key={item.key} data-testid={`terminal-structural-layer-${item.key}`}>
            <div className="exec-explainability-pills" style={{ marginBottom: 4 }}>
              <span className={`chart-action-pill chart-action-pill-status ${toneClass(item.state)}`}>{item.title}</span>
              <span className="chart-action-pill">{item.summary}</span>
            </div>
            <div className="subtle mini">{item.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}