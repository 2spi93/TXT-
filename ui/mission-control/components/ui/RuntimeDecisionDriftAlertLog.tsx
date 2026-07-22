import type { RuntimeDecisionAnalyticsSummary, RuntimeDecisionOpportunityBreakdownItem } from "../../lib/runtimeDecisionAnalytics";

function toneClass(value: string): string {
  if (value === "CALM" || value === "OPEN" || value === "LIVE" || value === "good") {
    return "good";
  }
  if (value === "WATCH" || value === "UNKNOWN" || value === "NO_EDGE" || value === "NO_DATA_EMPTY" || value === "subtle") {
    return "subtle";
  }
  return "warn";
}

function telemetryRootCauseLabel(value: string | undefined): string {
  switch (value) {
    case "AUTH_FAILURE":
      return "AUTH FAILURE";
    case "EMPTY_PAYLOAD":
      return "EMPTY PAYLOAD";
    case "PARTIAL_PAYLOAD":
      return "PARTIAL PAYLOAD";
    case "STALE_TELEMETRY":
      return "STALE TELEMETRY";
    case "NETWORK_FAILURE":
      return "NETWORK FAILURE";
    case "LIVE":
      return "LIVE";
    default:
      return "UNKNOWN";
  }
}

function metricLabel(value: string): string {
  switch (value) {
    case "routingZeroRate":
      return "routing zero";
    case "fallbackRate":
      return "fallback";
    case "runtimeBlockRate":
      return "runtime block";
    case "policyBlockRate":
      return "policy block";
    case "falsePositiveRate":
      return "false positive";
    default:
      return "stable";
  }
}

function driftTypeLabel(value: string): string {
  switch (value) {
    case "MARKET_MICROSTRUCTURE":
      return "market microstructure";
    case "MARKET_REGIME":
      return "market regime";
    case "EXECUTION_LATENCY":
      return "execution latency";
    case "EXECUTION_ROUTING":
      return "execution routing";
    case "SYSTEM_HEALTH":
      return "system health";
    case "MIXED":
      return "mixed";
    default:
      return "unknown";
  }
}

function formatNullable(value: number | null, suffix: string, digits = 0): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${value.toFixed(digits)}${suffix}`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function formatSignedPercent(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatCompactUsd(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M USD`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k USD`;
  }
  return `${Math.round(value)} USD`;
}

function buildLine(points: number[]): string {
  if (points.length === 0) {
    return "";
  }
  return points.map((value, index) => {
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
    const y = 100 - Math.max(0, Math.min(100, value));
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function OpportunityBreakdown({ items }: { items: RuntimeDecisionOpportunityBreakdownItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="runtime-decision-breakdown">
      {items.map((item) => (
        <div key={item.key} className="runtime-decision-breakdown-row">
          <div className="runtime-decision-breakdown-head">
            <strong>{item.label}</strong>
            <span className={toneClass(item.tone)}>{item.scorePct.toFixed(1)}%</span>
          </div>
          <div className="runtime-decision-breakdown-bar" aria-hidden="true">
            <span className={`runtime-decision-breakdown-fill ${toneClass(item.tone)}`} style={{ width: `${item.scorePct}%` }} />
          </div>
          <div className="runtime-decision-breakdown-detail">{item.detail}</div>
        </div>
      ))}
    </div>
  );
}

export default function RuntimeDecisionDriftAlertLog({ summary }: { summary: RuntimeDecisionAnalyticsSummary }) {
  const historyRows = summary.drift.history.slice(-24).reverse();
  const alertRows = summary.drift.alerts;
  const windowRows = [summary.drift.windows["1h"], summary.drift.windows["6h"], summary.drift.windows["24h"]];
  const scoreLine = buildLine(summary.drift.history.map((item) => item.scorePct));
  const telemetryIntegrity = summary.opportunity.telemetry.integrity;
  const telemetryIntegrityItems = Array.isArray(telemetryIntegrity?.items) ? telemetryIntegrity.items : [];

  return (
    <div className="runtime-drift-log">
      <section className="runtime-drift-log-summary">
        <div className="runtime-drift-log-state-card">
          <div className="eyebrow">Etat courant</div>
          <div className={`runtime-drift-log-state ${toneClass(summary.drift.state)}`}>{summary.drift.state}</div>
          <p className="subtle">{summary.drift.headline}</p>
          <div className="runtime-drift-log-pills">
            <span className={`runtime-decision-history-item ${toneClass(summary.drift.state)}`}>drift {summary.drift.state}</span>
            <span className={`runtime-decision-history-item ${toneClass(summary.drift.state)}`}>type {driftTypeLabel(summary.drift.type)}</span>
            <span className={`runtime-decision-history-item ${toneClass(summary.drift.state)}`}>score {summary.drift.scorePct}%</span>
            <span className={`runtime-decision-history-item ${toneClass(summary.drift.state)}`}>prob {summary.drift.stats.probabilityPct}%</span>
            <span className={`runtime-decision-history-item ${toneClass(summary.drift.state)}`}>confidence {summary.drift.stats.confidencePct}%</span>
            <span className={`runtime-decision-history-item ${summary.drift.stats.reliabilityPct >= 65 ? "good" : summary.drift.stats.reliabilityPct >= 45 ? "subtle" : "warn"}`}>reliability {summary.drift.stats.reliabilityPct}%</span>
            <span className={`runtime-decision-history-item ${toneClass(summary.opportunity.liveState)}`}>live gate {summary.opportunity.liveState}</span>
            <span className="runtime-decision-history-item subtle">NO_TRADE {summary.totals.noTradeRows}</span>
            <span className="runtime-decision-history-item subtle">opp {summary.opportunity.opportunityRate}%</span>
          </div>
          <div className="runtime-drift-log-sparkline-wrap">
            <svg viewBox="0 0 100 100" className="runtime-drift-log-sparkline" aria-label="Drift score sparkline over the last 24 hours">
              <path d="M0,100 L100,100" className="runtime-decision-series-axis" />
              <path d={scoreLine} className="runtime-decision-series-line drift" />
            </svg>
            <div className="runtime-drift-log-copy">Sparkline live du drift score 24h · prob {summary.drift.stats.probabilityPct.toFixed(1)}% · reliability {summary.drift.stats.reliabilityPct.toFixed(1)}% · KS {summary.drift.stats.ksScore.toFixed(2)} · {summary.drift.stats.adwinTriggered ? "ADWIN on" : "ADWIN off"}</div>
          </div>
          <div className="runtime-drift-log-copy">{summary.drift.summary}</div>
          <div className="runtime-drift-log-callout">Drift cause: {summary.drift.cause.summary}</div>
        </div>
        <div className="runtime-drift-log-state-card">
          <div className="eyebrow">Venue telemetry</div>
          <div className={`runtime-drift-log-state ${toneClass(summary.opportunity.liveState)}`}>{summary.opportunity.liveState}</div>
          <p className="subtle">{summary.opportunity.liveSummary}</p>
          <div className="runtime-drift-log-kpi-grid">
            <div><span>Spread</span><strong>{formatNullable(summary.opportunity.telemetry.avgSpreadBps, "bp", 2)}</strong></div>
            <div><span>Depth</span><strong>{formatCompactUsd(summary.opportunity.telemetry.avgAvailableDepthUsd)}</strong></div>
            <div><span>Route latency</span><strong>{formatNullable(summary.opportunity.telemetry.avgRouteLatencyMs, "ms")}</strong></div>
            <div><span>Fill latency</span><strong>{formatNullable(summary.opportunity.telemetry.avgFillLatencyMs, "ms")}</strong></div>
            <div><span>Depth latency</span><strong>{formatNullable(summary.opportunity.telemetry.avgDepthLatencyMs, "ms")}</strong></div>
            <div><span>Fill probability</span><strong>{summary.opportunity.telemetry.avgFillProbability == null ? "n/a" : `${(summary.opportunity.telemetry.avgFillProbability * 100).toFixed(0)}%`}</strong></div>
            <div><span>Stability</span><strong>{summary.opportunity.telemetry.avgStabilityScore == null ? "n/a" : `${(summary.opportunity.telemetry.avgStabilityScore * 100).toFixed(0)}%`}</strong></div>
            <div><span>Opportunity score</span><strong>{summary.opportunity.avgScore}%</strong></div>
            <div><span>Confidence</span><strong>{summary.opportunity.confidencePct}%</strong></div>
            <div><span>High quality</span><strong>{summary.opportunity.highQualityRate}%</strong></div>
          </div>
          <div className="runtime-drift-log-copy">{summary.opportunity.telemetry.summary}</div>
          {telemetryIntegrity?.summary ? <div className="runtime-drift-log-copy">{telemetryIntegrity.summary}</div> : null}
          <div className="runtime-drift-log-copy">{telemetryRootCauseLabel(summary.opportunity.telemetry.rootCause)} · auth {summary.opportunity.telemetry.authState || "UNKNOWN"} · missing {summary.opportunity.missingSignals.length > 0 ? summary.opportunity.missingSignals.join(", ") : "none"}</div>
          {telemetryIntegrityItems.length > 0 ? (
            <div className="runtime-drift-log-copy">integrity {telemetryIntegrityItems.slice(0, 5).map((item) => item.label || item.code).join(" · ")}</div>
          ) : null}
          <OpportunityBreakdown items={summary.opportunity.breakdown} />
        </div>
      </section>

      <section className="runtime-drift-log-grid">
        <div className="panel">
          <div className="eyebrow">Confidence and cause</div>
          <div className="runtime-drift-log-kpi-grid runtime-drift-log-kpi-grid-operator">
            <div><span>Probability</span><strong>{summary.drift.stats.probabilityPct}%</strong></div>
            <div><span>Confidence</span><strong>{summary.drift.stats.confidencePct}%</strong></div>
            <div><span>Reliability</span><strong>{summary.drift.stats.reliabilityPct}%</strong></div>
            <div><span>Window consistency</span><strong>{summary.drift.stats.windowConsistencyPct}%</strong></div>
            <div><span>Noise level</span><strong>{summary.drift.stats.noiseLevelPct}%</strong></div>
            <div><span>Sample factor</span><strong>{(summary.drift.stats.sampleSizeFactor * 100).toFixed(1)}%</strong></div>
            <div><span>KS score</span><strong>{summary.drift.stats.ksScore.toFixed(2)}</strong></div>
            <div><span>ADWIN signal</span><strong>{(summary.drift.stats.adwinSignal * 100).toFixed(1)}%</strong></div>
            <div><span>Signal variance</span><strong>{summary.drift.stats.signalVariance.toFixed(3)}</strong></div>
            <div><span>Current sample</span><strong>{summary.drift.stats.currentSampleSize}</strong></div>
            <div><span>Baseline sample</span><strong>{summary.drift.stats.baselineSampleSize}</strong></div>
          </div>
          <div className="runtime-drift-log-copy">{summary.drift.cause.summary}</div>
          <div className="runtime-drift-log-cause-grid">
            {summary.drift.cause.factors.map((factor) => (
              <div key={factor.key} className="runtime-drift-log-cause-card">
                <div className="runtime-drift-log-history-head">
                  <strong>{factor.label}</strong>
                  <span className={`runtime-decision-history-item ${toneClass(factor.tone)}`}>{factor.tone}</span>
                </div>
                <div className="runtime-drift-log-copy">{factor.note}</div>
                <div className="runtime-drift-log-cause-metrics">
                  <span>Current {factor.current == null ? "n/a" : factor.current.toFixed(factor.label.includes("latency") ? 0 : 2)}</span>
                  <span>Ref {factor.reference == null ? "n/a" : factor.reference.toFixed(factor.label.includes("latency") ? 0 : 2)}</span>
                  <span>Delta {formatSignedPercent(factor.deltaPct)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="eyebrow">Active alerts</div>
          <div className="runtime-drift-log-table">
            <div className="runtime-drift-log-table-head">
              <span>Window</span>
              <span>Metric</span>
              <span>Type</span>
              <span>Current</span>
              <span>Score</span>
              <span>Severity</span>
            </div>
            {alertRows.length === 0 ? <div className="runtime-drift-log-empty">Aucune alerte drift active sur la fenetre chargee.</div> : null}
            {alertRows.map((alert) => (
              <div key={`${alert.currentWindow}-${alert.metric}`} className="runtime-drift-log-table-row">
                <span>{alert.currentWindow}</span>
                <span>{metricLabel(alert.metric)}</span>
                <span>{driftTypeLabel(alert.type)}</span>
                <span>{formatPercent(alert.currentRate)}</span>
                <span>{alert.scorePct.toFixed(1)}%</span>
                <span className={toneClass(alert.severity === "critical" ? "DRIFT" : "WATCH")}>{alert.severity}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="eyebrow">Window comparison</div>
          <div className="runtime-drift-log-table">
            <div className="runtime-drift-log-table-head runtime-drift-log-table-head-wide">
              <span>Window</span>
              <span>NO_TRADE</span>
              <span>Type</span>
              <span>Routing</span>
              <span>Runtime</span>
              <span>Policy</span>
              <span>Score</span>
            </div>
            {windowRows.map((window) => (
              <div key={window.label} className="runtime-drift-log-table-row runtime-drift-log-table-row-wide">
                <span>{window.label}</span>
                <span>{window.noTradeRows}</span>
                <span>{driftTypeLabel(window.type)}</span>
                <span>{formatPercent(window.routingZeroRate)}</span>
                <span>{formatPercent(window.runtimeBlockRate)}</span>
                <span>{formatPercent(window.policyBlockRate)}</span>
                <span>{window.driftScorePct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="runtime-drift-log-grid">
        <div className="panel">
          <div className="eyebrow">24h drift history</div>
          <div className="runtime-drift-log-history">
            {historyRows.map((item) => (
              <div key={`${item.iso}-${item.metric}`} className="runtime-drift-log-history-row">
                <div className="runtime-drift-log-history-time">{item.iso.slice(11, 16)}</div>
                <div>
                  <div className="runtime-drift-log-history-head">
                    <span className={`runtime-decision-history-item ${toneClass(item.state)}`}>{item.state}</span>
                    <span className={`runtime-decision-history-item ${toneClass(item.state)}`}>{driftTypeLabel(item.type)}</span>
                    <strong>{metricLabel(item.metric)}</strong>
                  </div>
                  <div className="runtime-drift-log-copy">{formatPercent(item.currentRate)} vs {formatPercent(item.baselineRate)} · score {item.scorePct.toFixed(1)}% · drift {(item.drift * 100).toFixed(0)}% · {item.noTradeRows} no-trade row(s)</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="eyebrow">Operator read</div>
          <div className="runtime-drift-log-kpi-grid runtime-drift-log-kpi-grid-operator">
            <div><span>Headline</span><strong>{summary.deskRead.headline}</strong></div>
            <div><span>Drift type</span><strong>{driftTypeLabel(summary.drift.type)}</strong></div>
            <div><span>Drift prob</span><strong>{summary.drift.stats.probabilityPct}%</strong></div>
            <div><span>Drift confidence</span><strong>{summary.drift.stats.confidencePct}%</strong></div>
            <div><span>Drift reliability</span><strong>{summary.drift.stats.reliabilityPct}%</strong></div>
            <div><span>Dominant bucket</span><strong>{summary.dominant.bucket.label}</strong></div>
            <div><span>Top code</span><strong>{summary.dominant.code.label}</strong></div>
            <div><span>Blocked bucket</span><strong>{summary.opportunity.topBlockedBucket.label}</strong></div>
            <div><span>KS / ADWIN</span><strong>{summary.drift.stats.ksScore.toFixed(2)} / {summary.drift.stats.adwinTriggered ? "ON" : "OFF"}</strong></div>
            <div><span>Stat confirmation</span><strong>{summary.drift.stats.confirmed ? "CONFIRMED" : "WATCH ONLY"}</strong></div>
          </div>
          <div className="runtime-drift-log-copy">{summary.deskRead.summary}</div>
          <div className="runtime-drift-log-copy">Cause read: {summary.drift.cause.summary}</div>
          <div className="runtime-drift-log-callout">{summary.deskRead.nextAction}</div>
        </div>
      </section>

      <section className="runtime-drift-log-grid">
        <div className="panel">
          <div className="eyebrow">Structured alert feed</div>
          <div className="runtime-drift-log-feed">
            {summary.drift.alertFeed.length === 0 ? <div className="runtime-drift-log-empty">Aucune entree structured alert feed sur la fenetre chargee.</div> : null}
            {summary.drift.alertFeed.map((item) => (
              <div key={`${item.iso}-${item.metric}-${item.source}`} className="runtime-drift-log-feed-row">
                <div className="runtime-drift-log-history-time">{item.iso.slice(11, 16)}</div>
                <div>
                  <div className="runtime-drift-log-history-head">
                    <span className={`runtime-decision-history-item ${toneClass(item.state)}`}>{item.state}</span>
                    <span className={`runtime-decision-history-item ${toneClass(item.state)}`}>{driftTypeLabel(item.type)}</span>
                    <span className={`runtime-decision-history-item ${toneClass(item.severity === "critical" ? "DRIFT" : item.severity === "warning" ? "WATCH" : "CALM")}`}>{item.severity}</span>
                  </div>
                  <div className="runtime-drift-log-copy">[{item.iso.slice(11, 16)}] {item.metric} · score {item.scorePct.toFixed(1)}% · {item.summary}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="eyebrow">Ranked opportunities</div>
          <div className="runtime-drift-log-copy">{summary.opportunity.summary}</div>
          <div className="runtime-drift-log-feed">
            {summary.opportunity.topRanked.length === 0 ? <div className="runtime-drift-log-empty">Aucune opportunite structurelle exploitable sur la fenetre chargee.</div> : null}
            {summary.opportunity.topRanked.map((item) => (
              <div key={`${item.createdAtIso}-${item.code}`} className="runtime-drift-log-feed-row">
                <div className="runtime-drift-log-history-time">{item.createdAtIso.slice(11, 16)}</div>
                <div>
                  <div className="runtime-drift-log-history-head">
                    <span className={`runtime-decision-history-item ${toneClass(item.status === "EXECUTED" ? "OPEN" : "WATCH")}`}>{item.status}</span>
                    <strong>{item.scorePct.toFixed(1)}%</strong>
                    <span className="runtime-decision-history-item subtle">{item.bucket}</span>
                  </div>
                  <div className="runtime-drift-log-copy">{item.code} · attention {item.attentionState} · {item.rationale}</div>
                  <OpportunityBreakdown items={item.breakdown} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}