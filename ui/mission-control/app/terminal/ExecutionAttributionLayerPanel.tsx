import type { ExecutionAttributionSummary } from "./executionAttributionLayer";

type Props = {
  summary: ExecutionAttributionSummary;
};

function toneClass(state: ExecutionAttributionSummary["state"]): string {
  if (state === "TOXIC") {
    return "bad";
  }
  if (state === "DEGRADED" || state === "WATCH") {
    return "warn";
  }
  return "good";
}

export default function ExecutionAttributionLayerPanel({ summary }: Props) {
  return (
    <div style={{ marginBottom: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(120, 147, 188, 0.2)", background: "rgba(9, 14, 24, 0.72)" }} data-testid="terminal-execution-attribution-layer-panel">
      <div className="chart-stat-label" style={{ marginBottom: 6 }}>Execution attribution layer</div>
      <div className="exec-explainability-pills" style={{ marginBottom: 6 }}>
        <span className={`chart-action-pill chart-action-pill-status ${toneClass(summary.state)}`}>{summary.summary_label}</span>
        <span className="chart-action-pill">{`signal ${summary.signal_loss_share_pct}%`}</span>
        <span className="chart-action-pill">{`lat ${summary.components.latency_impact_pct}%`}</span>
        <span className="chart-action-pill">{`route ${summary.components.routing_impact_pct}%`}</span>
        <span className="chart-action-pill">{`venue ${summary.components.venue_impact_pct}%`}</span>
      </div>
      <div className="subtle mini">{`spread ${summary.components.spread_impact_pct}% · slip ${summary.components.slippage_impact_pct}% · timing ${summary.components.timing_impact_pct}% · liq ${summary.components.liquidity_impact_pct}%`}</div>
    </div>
  );
}