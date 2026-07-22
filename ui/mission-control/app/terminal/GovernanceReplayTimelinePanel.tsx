"use client";

import { useMemo, useState } from "react";

import type { GovernanceReplayDetailedTimelineStep } from "./governanceReplay";

type TimelinePhaseFilter = "all" | GovernanceReplayDetailedTimelineStep["phase"];
type TimelineToneFilter = "all" | GovernanceReplayDetailedTimelineStep["tone"];

const PANEL_STYLE = {
  marginBottom: 8,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(120, 147, 188, 0.2)",
  background: "rgba(9, 14, 24, 0.72)",
} as const;

const FILTER_BUTTON_STYLE = {
  border: "1px solid rgba(120, 147, 188, 0.22)",
  borderRadius: 999,
  padding: "4px 9px",
  background: "rgba(15, 23, 38, 0.9)",
  color: "inherit",
  fontSize: 11,
  cursor: "pointer",
} as const;

function humanizeLabel(value: string): string {
  const normalized = String(value || "").trim().replace(/[_-]+/g, " ");
  return normalized ? normalized.replace(/\b\w/g, (match) => match.toUpperCase()) : "Unknown";
}

function toneBadgeClass(tone: GovernanceReplayDetailedTimelineStep["tone"]): string {
  if (tone === "warn") {
    return "warn";
  }
  if (tone === "good") {
    return "good";
  }
  return "subtle";
}

export default function GovernanceReplayTimelinePanel(props: {
  timeline: GovernanceReplayDetailedTimelineStep[];
  persisted: boolean;
  fallbackActive: boolean;
}) {
  const [phaseFilter, setPhaseFilter] = useState<TimelinePhaseFilter>("all");
  const [toneFilter, setToneFilter] = useState<TimelineToneFilter>("all");

  const filteredTimeline = useMemo(
    () => props.timeline.filter((step) => (phaseFilter === "all" || step.phase === phaseFilter) && (toneFilter === "all" || step.tone === toneFilter)),
    [phaseFilter, props.timeline, toneFilter],
  );

  const visibleTimeline = filteredTimeline.slice(0, 6);
  const phaseCounts = useMemo(() => ({
    market: props.timeline.filter((step) => step.phase === "market").length,
    truth: props.timeline.filter((step) => step.phase === "truth").length,
    capital: props.timeline.filter((step) => step.phase === "capital").length,
    memory: props.timeline.filter((step) => step.phase === "memory").length,
    governance: props.timeline.filter((step) => step.phase === "governance").length,
    other: props.timeline.filter((step) => step.phase === "other").length,
  }), [props.timeline]);

  return (
    <div style={PANEL_STYLE} data-testid="terminal-governance-replay-timeline-panel">
      <div className="chart-stat-label" style={{ marginBottom: 6 }}>Governance replay timeline</div>
      <div className="exec-explainability-pills" style={{ marginBottom: 6 }}>
        <span className={`chart-action-pill chart-action-pill-status ${props.persisted ? "good" : props.fallbackActive ? "warn" : "subtle"}`}>{props.persisted ? "timeline persisted" : props.fallbackActive ? "timeline fallback" : "timeline empty"}</span>
        <span className="chart-action-pill">{`rows ${props.timeline.length}`}</span>
        <span className="chart-action-pill">{`filtered ${filteredTimeline.length}`}</span>
        <span className="chart-action-pill">{`warn ${props.timeline.filter((step) => step.tone === "warn").length}`}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        {([
          ["all", `All ${props.timeline.length}`],
          ["governance", `Governance ${phaseCounts.governance}`],
          ["truth", `Truth ${phaseCounts.truth}`],
          ["capital", `Capital ${phaseCounts.capital}`],
          ["memory", `Memory ${phaseCounts.memory}`],
          ["market", `Market ${phaseCounts.market}`],
        ] as const).map(([value, label]) => (
          <button
            key={`phase-${value}`}
            type="button"
            onClick={() => setPhaseFilter(value)}
            style={{
              ...FILTER_BUTTON_STYLE,
              background: phaseFilter === value ? "rgba(72, 190, 132, 0.16)" : FILTER_BUTTON_STYLE.background,
              borderColor: phaseFilter === value ? "rgba(72, 190, 132, 0.35)" : FILTER_BUTTON_STYLE.border,
            }}
            data-testid={`terminal-governance-replay-phase-filter-${value}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {([
          ["all", "Tone all"],
          ["warn", "Warn"],
          ["subtle", "Subtle"],
          ["good", "Good"],
        ] as const).map(([value, label]) => (
          <button
            key={`tone-${value}`}
            type="button"
            onClick={() => setToneFilter(value)}
            style={{
              ...FILTER_BUTTON_STYLE,
              background: toneFilter === value ? "rgba(120, 147, 188, 0.16)" : FILTER_BUTTON_STYLE.background,
              borderColor: toneFilter === value ? "rgba(120, 147, 188, 0.35)" : FILTER_BUTTON_STYLE.border,
            }}
            data-testid={`terminal-governance-replay-tone-filter-${value}`}
          >
            {label}
          </button>
        ))}
      </div>
      {visibleTimeline.length > 0 ? (
        <div style={{ display: "grid", gap: 6 }}>
          {visibleTimeline.map((step) => (
            <div
              key={step.id}
              style={{ borderRadius: 8, padding: "7px 8px", border: "1px solid rgba(120, 147, 188, 0.14)", background: "rgba(13, 18, 31, 0.82)" }}
              data-testid={`terminal-governance-replay-timeline-row-${step.id}`}
            >
              <div className="exec-explainability-pills" style={{ marginBottom: 4 }}>
                <span className={`chart-action-pill chart-action-pill-status ${toneBadgeClass(step.tone)}`}>{step.label}</span>
                <span className="chart-action-pill">{humanizeLabel(step.phase)}</span>
                <span className="chart-action-pill">{step.action}</span>
                {step.layer ? <span className="chart-action-pill">{`layer ${humanizeLabel(step.layer)}`}</span> : null}
                {step.regime ? <span className="chart-action-pill">{`regime ${step.regime}`}</span> : null}
                {step.route_mode ? <span className="chart-action-pill">{`route ${step.route_mode}`}</span> : null}
              </div>
              <div className="subtle mini">{step.detail}</div>
              {step.reasons.length > 0 ? <div className="subtle mini" style={{ marginTop: 4 }}>{`reasons ${step.reasons.slice(0, 3).join(" · ")}`}</div> : null}
              {step.contract_versions.length > 0 ? <div className="subtle mini" style={{ marginTop: 2 }}>{`contracts ${step.contract_versions.slice(0, 3).join(" · ")}`}</div> : null}
            </div>
          ))}
          {filteredTimeline.length > visibleTimeline.length ? (
            <div className="subtle mini" data-testid="terminal-governance-replay-timeline-overflow">
              {`${filteredTimeline.length - visibleTimeline.length} additional row(s) hidden`}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="subtle mini" data-testid="terminal-governance-replay-timeline-empty">
          No timeline rows match the current filters.
        </div>
      )}
    </div>
  );
}