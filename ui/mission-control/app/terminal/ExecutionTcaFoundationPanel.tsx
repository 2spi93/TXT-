"use client";

import type { ExecutionTcaFoundationSummary } from "./executionTcaFoundation";

const PANEL_STYLE = {
  marginBottom: 8,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(120, 147, 188, 0.2)",
  background: "rgba(9, 14, 24, 0.72)",
} as const;

function toneClass(state: ExecutionTcaFoundationSummary["state"]): string {
  if (state === "BLOCKED") {
    return "bad";
  }
  if (state === "FRICTION" || state === "WATCH") {
    return "warn";
  }
  return "good";
}

export default function ExecutionTcaFoundationPanel(props: {
  summary: ExecutionTcaFoundationSummary;
}) {
  const { summary } = props;
  return (
    <div style={PANEL_STYLE} data-testid="terminal-execution-tca-foundation-panel">
      <div className="chart-stat-label" style={{ marginBottom: 6 }}>Execution TCA foundation</div>
      <div className="exec-explainability-pills">
        <span className={`chart-action-pill chart-action-pill-status ${toneClass(summary.state)}`}>{summary.summary_label}</span>
        <span className="chart-action-pill">{`driver ${summary.dominant_driver.toLowerCase()}`}</span>
        <span className="chart-action-pill">{`action ${summary.recommended_action}`}</span>
        <span className="chart-action-pill">{`replay ${summary.replay_alignment.toLowerCase()}`}</span>
        <span className="chart-action-pill">{`blocked ${summary.metrics.blocked_step_share_pct}%`}</span>
        <span className="chart-action-pill">{`route shifts ${summary.metrics.route_mode_switch_count}`}</span>
      </div>
      <div className="subtle mini" style={{ marginTop: 6 }}>
        {`lat ${summary.metrics.latency_ms}ms · slip ${summary.metrics.slippage_bps.toFixed(2)}bps · fill ${summary.metrics.fill_rate_pct}% · steps ${summary.metrics.replay_step_count}`}
      </div>
      <div className="subtle mini" style={{ marginTop: 4 }}>
        {`governance ${summary.metrics.governance_step_count} · capital ${summary.metrics.capital_step_count} · execution score ${summary.metrics.execution_score_pct}%`}
      </div>
      {summary.reasons.length > 0 ? (
        <div className="subtle mini" style={{ marginTop: 4 }}>
          {summary.reasons.slice(0, 4).join(" · ")}
        </div>
      ) : null}
    </div>
  );
}