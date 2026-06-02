import HelpHint from "../HelpHint";

import type {
  RuntimeDecisionAnalyticsSummary,
  RuntimeDecisionFalseContextMotif,
  RuntimeDecisionOpportunityBreakdownItem,
} from "../../lib/runtimeDecisionAnalytics";
import { UI_HELP_HINTS } from "../../lib/uiLexicon";

type Props = {
  summary: RuntimeDecisionAnalyticsSummary | null;
  compact?: boolean;
  title?: string;
  exportHref?: string;
};

function toneClass(value: string): string {
  if (value === "warn") {
    return "warn";
  }
  if (value === "good") {
    return "good";
  }
  return "subtle";
}

function driftStateTone(value: string): string {
  if (value === "CALM" || value === "OPEN" || value === "LIVE") {
    return "good";
  }
  if (value === "WATCH" || value === "UNKNOWN" || value === "NO_EDGE" || value === "NO_DATA_EMPTY") {
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

function driftMetricLabel(value: string): string {
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

function falseContextLabel(value: string | null | undefined): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "none";
  }
  return normalized.split("_").join(" ").toLowerCase();
}

function renderFalseContextMotifs(motifs: RuntimeDecisionFalseContextMotif[], compact: boolean) {
  if (motifs.length === 0) {
    return (
      <div className="runtime-decision-row">
        <strong>motifs</strong>
        <span>Aucun faux contexte dominant journalise sur la fenetre.</span>
      </div>
    );
  }

  return motifs.slice(0, compact ? 2 : 4).map((motif) => (
    <div key={motif.family} className="runtime-decision-row">
      <strong>{falseContextLabel(motif.family)}</strong>
      <span>{motif.count} · {motif.sharePct}%{motif.topReasons.length > 0 ? ` · ${motif.topReasons.join(" · ")}` : ""}</span>
    </div>
  ));
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

function OpportunityBreakdown({ items, compact = false }: { items: RuntimeDecisionOpportunityBreakdownItem[]; compact?: boolean }) {
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
          {compact ? null : <div className="runtime-decision-breakdown-detail">{item.detail}</div>}
        </div>
      ))}
    </div>
  );
}

function DriftSeries({ summary }: { summary: RuntimeDecisionAnalyticsSummary }) {
  const points = summary.series.points;
  const routingLine = buildLine(points.map((point) => point.routingZeroRate));
  const runtimeLine = buildLine(points.map((point) => point.runtimeBlockRate));
  const opportunityLine = buildLine(points.map((point) => point.opportunityRate));
  const driftLine = buildLine(points.map((point) => point.driftScorePct));

  return (
    <div className="runtime-decision-series">
      <div className="runtime-decision-series-head">
        <div>
          <div className="subtle mini">Mini time-series</div>
          <div className="runtime-decision-series-title">24h drift and opportunity view</div>
        </div>
        <div className="runtime-decision-series-legend">
          <span><i className="routing" />routing zero</span>
          <span><i className="runtime" />runtime block</span>
          <span><i className="opportunity" />opportunity</span>
          <span><i className="drift" />drift score</span>
        </div>
      </div>
      <svg viewBox="0 0 100 100" className="runtime-decision-series-chart" aria-label="Runtime decision time series over 24 hours">
        <path d="M0,100 L100,100" className="runtime-decision-series-axis" />
        <path d={routingLine} className="runtime-decision-series-line routing" />
        <path d={runtimeLine} className="runtime-decision-series-line runtime" />
        <path d={opportunityLine} className="runtime-decision-series-line opportunity" />
        <path d={driftLine} className="runtime-decision-series-line drift" />
      </svg>
      <div className="runtime-decision-series-foot">
        <span>{summary.series.windowHours}h window</span>
        <span>{summary.series.bucketHours}h buckets</span>
        <span>{summary.series.points.length} points</span>
      </div>
    </div>
  );
}

export default function RuntimeDecisionOverviewCard({ summary, compact = false, title = "Runtime Decision Desk", exportHref }: Props) {
  if (!summary || summary.totals.noTradeRows === 0) {
    return (
      <div className={`runtime-decision-card ${compact ? "compact" : ""}`.trim()}>
        <div className="runtime-decision-head">
          <div className="eyebrow">{title}</div>
        </div>
        <p className="subtle">Aucun NO_TRADE recent dans la fenetre chargee.</p>
      </div>
    );
  }

  const topCodes = summary.topCodes.slice(0, compact ? 3 : 4);
  const buckets = summary.byBucket.slice(0, compact ? 3 : 4);
  const mismatchSamples = summary.semanticMismatchCandidates.samples.slice(0, compact ? 1 : 2);
  const falsePositiveSamples = summary.falsePositiveCandidates.samples.slice(0, compact ? 1 : 2);
  const driftAlerts = summary.drift.alerts.slice(0, compact ? 1 : 3);
  const driftHistory = summary.drift.history.filter((item) => item.state !== "CALM");
  const driftHistoryRows = (driftHistory.length > 0 ? driftHistory : summary.drift.history.slice(-1)).slice(compact ? -2 : -4);
  const driftWindowRows = [summary.drift.windows["1h"], summary.drift.windows["6h"], summary.drift.windows["24h"]];
  const blockedBuckets = summary.opportunity.blockedByBucket.slice(0, compact ? 2 : 3);
  const falseContextMotifs = summary.monitoring?.falseContextMotifs || [];
  const topOpportunity = summary.opportunity.topRanked[0] || null;
  const telemetryIntegrity = summary.opportunity.telemetry.integrity;
  const telemetryIntegrityItems = Array.isArray(telemetryIntegrity?.items) ? telemetryIntegrity.items : [];
  const reliability = summary.reliability || {
    state: "BLOCKED_BY_DATA",
    blocked: true,
    dataCompletenessPct: 0,
    observationCoverageHours: 0,
    freshnessMs: null,
    anomalyRatePct: 0,
    signalConsistencyPct: 0,
    summary: "BLOCKED_BY_DATA · runtime decision reliability unavailable.",
    reasons: [],
    degradedReasons: [],
    blockingReasons: [],
  };
  const opportunityGuard = summary.opportunity.guard || {
    state: "OK",
    blocked: false,
    trustScorePct: 100,
    summary: "Guard unavailable",
    reasons: [],
  };
  const opportunityConfidence = summary.opportunity.confidenceEngine || {
    state: "EXPLORATORY",
    sampleSize: 0,
    stabilityPct: 0,
    summary: "EXPLORATORY · runtime confidence unavailable.",
  };
  const observationIntegrity = summary.observation.integrity || {
    status: "CRITICAL",
    scorePct: 0,
    coveredHours: 0,
    expectedHours: 0,
    missingHours: 0,
    maxGapHours: 0,
    summary: "Observation integrity unavailable.",
  };
  const observationTone = summary.observation.manualCalibrationEligible
    ? "good"
    : summary.observation.status === "OBSERVE"
      ? "subtle"
      : "warn";
  const calibrationLockTone = summary.observation.manualCalibrationEligible ? "subtle" : "warn";
  const calibrationLockLabel = summary.observation.autoCalibrationAllowed
    ? "auto enabled"
    : summary.observation.manualCalibrationEligible
      ? "manual review only · auto disabled"
      : summary.observation.status === "INSUFFICIENT"
        ? "locked · observation insufficient"
        : summary.observation.status === "OBSERVE"
          ? "locked · observation still active"
          : `locked · integrity ${observationIntegrity.status.toLowerCase()}`;

  return (
    <div className={`runtime-decision-card ${compact ? "compact" : ""}`.trim()}>
      <div className="runtime-decision-head">
        <div>
          <div className="eyebrow">
            {title}
            {!compact ? <HelpHint text={UI_HELP_HINTS.runtimeDecisionOverview.text} examples={UI_HELP_HINTS.runtimeDecisionOverview.examples} /> : null}
          </div>
          <div className={`runtime-decision-headline ${toneClass(summary.deskRead.tone)}`}>{summary.deskRead.headline}</div>
          <p className="runtime-decision-summary">{summary.deskRead.summary}</p>
        </div>
        <div className="runtime-decision-head-side">
          <div className={`runtime-decision-chip ${toneClass(summary.deskRead.tone)}`}>{summary.policyVersion}</div>
          {exportHref ? <a className="runtime-decision-link" href={exportHref}>export review json</a> : null}
        </div>
      </div>

      <div className="runtime-decision-metrics">
        <div className="runtime-decision-metric">
          <span>NO_TRADE</span>
          <strong>{summary.totals.noTradeRows} ({summary.totals.noTradePctWithinExecution}%)</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Drift</span>
          <strong className={driftStateTone(summary.drift.state)}>{summary.drift.state}</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Drift type</span>
          <strong className={driftStateTone(summary.drift.state)}>{driftTypeLabel(summary.drift.type)}</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Drift prob</span>
          <strong className={driftStateTone(summary.drift.state)}>{summary.drift.stats.probabilityPct}%</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Confidence</span>
          <strong className={driftStateTone(summary.drift.state)}>{summary.drift.stats.confidencePct}%</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Reliability</span>
          <strong className={summary.drift.stats.reliabilityPct >= 65 ? "good" : summary.drift.stats.reliabilityPct >= 45 ? "subtle" : "warn"}>{summary.drift.stats.reliabilityPct}%</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Opportunity rate</span>
          <strong>{summary.opportunity.opportunityRate}%</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Opportunity score</span>
          <strong>{summary.opportunity.avgScore}%</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Confidence</span>
          <strong className={summary.opportunity.confidencePct >= 70 ? "good" : summary.opportunity.confidencePct >= 45 ? "subtle" : "warn"}>{summary.opportunity.confidencePct}%</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Reliability</span>
          <strong className={reliability.state === "RELIABLE" ? "good" : reliability.state === "DEGRADED" ? "subtle" : "warn"}>{reliability.state}</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Missed opportunity</span>
          <strong className={summary.opportunity.missedOpportunityRate >= 50 ? "warn" : summary.opportunity.missedOpportunityRate > 0 ? "subtle" : "good"}>{summary.opportunity.missedOpportunityRate}%</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Observation</span>
          <strong className={observationTone}>{summary.observation.status}</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Drift FP</span>
          <strong className={summary.observation.driftFalsePositiveRate <= 12 ? "good" : summary.observation.driftFalsePositiveRate <= 20 ? "subtle" : "warn"}>{summary.observation.driftFalsePositiveRate}%</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Detection</span>
          <strong className={summary.observation.driftDetectionRate >= 60 ? "good" : summary.observation.driftDetectionRate >= 35 ? "subtle" : "warn"}>{summary.observation.driftDetectionRate}%</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Consistency</span>
          <strong className={summary.observation.decisionConsistency >= 70 ? "good" : summary.observation.decisionConsistency >= 55 ? "subtle" : "warn"}>{summary.observation.decisionConsistency}%</strong>
        </div>
      </div>

      {compact ? null : <DriftSeries summary={summary} />}

      <div className="runtime-decision-grid">
        <div className="runtime-decision-box">
          <div className="subtle mini">Top codes</div>
          <div className="runtime-decision-list">
            {topCodes.map((item) => (
              <div key={item.code} className="runtime-decision-row">
                <strong>{item.code}</strong>
                <span>{item.count} · {item.sharePct}% · {item.bucket}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="runtime-decision-box">
          <div className="subtle mini">Drift windows</div>
          <div className="runtime-decision-list">
            <div className="runtime-decision-row">
              <strong className={`runtime-decision-state ${driftStateTone(summary.drift.state)}`}>{summary.drift.state}</strong>
              <span>{summary.drift.headline} · {driftTypeLabel(summary.drift.type)} · prob {summary.drift.stats.probabilityPct}% · rel {summary.drift.stats.reliabilityPct}%</span>
            </div>
            {driftWindowRows.map((window) => (
              <div key={window.label} className="runtime-decision-row">
                <strong>{window.label}</strong>
                <span>{driftTypeLabel(window.type)} · score {window.driftScorePct}% · routing {window.routingZeroRate}% · runtime {window.runtimeBlockRate}%</span>
              </div>
            ))}
            {driftAlerts.length > 0 ? driftAlerts.map((alert) => (
              <div key={`${alert.currentWindow}-${alert.metric}`} className="runtime-decision-row">
                <strong>{alert.currentWindow} {driftMetricLabel(alert.metric)}</strong>
                <span>{driftTypeLabel(alert.type)} · {alert.severity} · {alert.currentRate}% vs {alert.baselineRate}%</span>
              </div>
            )) : (
              <div className="runtime-decision-row">
                <strong>24h baseline</strong>
                <span>Aucune derive materielle detectee.</span>
              </div>
            )}
            <div className="runtime-decision-history">
              {driftHistoryRows.map((item) => (
                <span key={`${item.iso}-${item.metric}`} className={`runtime-decision-history-item ${driftStateTone(item.state)}`}>
                  {item.iso.slice(11, 16)} · {item.state} · {driftMetricLabel(item.metric)}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="runtime-decision-box">
          <div className="subtle mini">Opportunity density</div>
          <div className="runtime-decision-list">
            <div className="runtime-decision-row">
              <strong className={`runtime-decision-state ${driftStateTone(summary.opportunity.liveState)}`}>live gate {summary.opportunity.liveState}</strong>
              <span>{summary.opportunity.liveSummary}</span>
            </div>
            <div className="runtime-decision-row">
              <strong className={`runtime-decision-state ${driftStateTone(opportunityGuard.state)}`}>trust guard {opportunityGuard.state}</strong>
              <span>{opportunityGuard.summary} · trust {opportunityGuard.trustScorePct}%</span>
            </div>
            <div className="runtime-decision-row">
              <strong className={`runtime-decision-state ${reliability.state === "RELIABLE" ? "good" : reliability.state === "DEGRADED" ? "subtle" : "warn"}`}>reliability {reliability.state}</strong>
              <span>{reliability.summary}</span>
            </div>
            {reliability.blockingReasons.length > 0 ? (
              <div className="runtime-decision-row">
                <strong>Why blocked</strong>
                <span>{reliability.blockingReasons.slice(0, 4).join(" · ")}</span>
              </div>
            ) : reliability.degradedReasons.length > 0 ? (
              <div className="runtime-decision-row">
                <strong>Why degraded</strong>
                <span>{reliability.degradedReasons.slice(0, 4).join(" · ")}</span>
              </div>
            ) : null}
            <div className="runtime-decision-row">
              <strong>Opportunity score</strong>
              <span>{summary.opportunity.avgScore}% avg · confidence {summary.opportunity.confidencePct}% · {summary.opportunity.highQualityRate}% high quality · {summary.opportunity.executionEfficiency}% execution efficiency</span>
            </div>
            <div className="runtime-decision-row">
              <strong>Confidence engine</strong>
              <span>{opportunityConfidence.state} · sample {opportunityConfidence.sampleSize} · stability {opportunityConfidence.stabilityPct}%</span>
            </div>
            <div className="runtime-decision-row">
              <strong>Tradable contexts</strong>
              <span>{summary.opportunity.candidateCount} · {summary.opportunity.opportunityRate}% of execution rows</span>
            </div>
            <div className="runtime-decision-row">
              <strong>Missed opportunities</strong>
              <span>{summary.opportunity.blockedCount} blocked · {summary.opportunity.missedOpportunityRate}% of candidates</span>
            </div>
            <div className="runtime-decision-row">
              <strong>Explainable read</strong>
              <span>{summary.opportunity.summary}</span>
            </div>
            {topOpportunity ? (
              <div className="runtime-decision-row">
                <strong>Top opportunity</strong>
                <span>{topOpportunity.status} · {topOpportunity.scorePct.toFixed(1)}% · {topOpportunity.rationale}</span>
              </div>
            ) : null}
            <div className="runtime-decision-row">
              <strong>Venue telemetry</strong>
              <span>{summary.opportunity.telemetry.summary}</span>
            </div>
            {telemetryIntegrity?.summary ? (
              <div className="runtime-decision-row">
                <strong>Telemetry integrity</strong>
                <span>{telemetryIntegrity.summary}</span>
              </div>
            ) : null}
            <div className="runtime-decision-row">
              <strong>Telemetry debug</strong>
              <span>{telemetryRootCauseLabel(summary.opportunity.telemetry.rootCause)} · auth {summary.opportunity.telemetry.authState || "UNKNOWN"} · missing {summary.opportunity.missingSignals.length > 0 ? summary.opportunity.missingSignals.join(", ") : "none"}</span>
            </div>
            {telemetryIntegrityItems.length > 0 ? (
              <div className="runtime-decision-row">
                <strong>Integrity codes</strong>
                <span>{telemetryIntegrityItems.slice(0, 5).map((item) => item.label || item.code).join(" · ")}</span>
              </div>
            ) : null}
            <OpportunityBreakdown items={summary.opportunity.breakdown} compact={compact} />
            {blockedBuckets.length > 0 ? blockedBuckets.map((item) => (
              <div key={item.bucket} className="runtime-decision-row">
                <strong>{item.bucket}</strong>
                <span>{item.count} · {item.sharePct}% of blocked candidates</span>
              </div>
            )) : null}
          </div>
        </div>
        <div className="runtime-decision-box">
          <div className="subtle mini">Observation window</div>
          <div className="runtime-decision-list">
            <div className="runtime-decision-row">
              <strong className={observationTone}>{summary.observation.status}</strong>
              <span>{summary.observation.sampleHours.toFixed(1)}h observees sur gate {summary.observation.minObservationHours}-{summary.observation.maxObservationHours}h</span>
            </div>
            <div className="runtime-decision-row">
              <strong>False positive / detection</strong>
              <span>FP {summary.observation.driftFalsePositiveRate}% · detection {summary.observation.driftDetectionRate}% · outcome coverage {summary.observation.decisionOutcomeCoveragePct}%</span>
            </div>
            <div className="runtime-decision-row">
              <strong>Stability / consistency</strong>
              <span>stability {summary.observation.driftStability}% · consistency {summary.observation.decisionConsistency}% · reliability mean {summary.observation.driftReliabilityMean}%</span>
            </div>
            <div className="runtime-decision-row">
              <strong>Integrity</strong>
              <span>{observationIntegrity.status} · {observationIntegrity.coveredHours}/{observationIntegrity.expectedHours}h · missing {observationIntegrity.missingHours}h · max gap {observationIntegrity.maxGapHours}h</span>
            </div>
            <div className="runtime-decision-row">
              <strong>Interpretation gate</strong>
              <span>{reliability.state} · completeness {reliability.dataCompletenessPct}% · consistency {reliability.signalConsistencyPct}%</span>
            </div>
            <div className="runtime-decision-row">
              <strong>Opportunity hit rate</strong>
              <span>{summary.observation.opportunityHitRate}% · manual gate {summary.observation.manualCalibrationEligible ? "open" : "closed"}</span>
            </div>
            <div className="runtime-decision-row">
              <strong>Calibration lock</strong>
              <span className={calibrationLockTone}>{calibrationLockLabel}</span>
            </div>
            {compact ? null : (
              <div className="runtime-decision-row">
                <strong>Recommendation</strong>
                <span>{summary.observation.recommendation}</span>
              </div>
            )}
            {compact ? null : (
              <div className="runtime-decision-row">
                <strong>Integrity read</strong>
                <span>{observationIntegrity.summary}</span>
              </div>
            )}
          </div>
        </div>
        <div className="runtime-decision-box">
          <div className="subtle mini">Hygiene and bucket split</div>
          <div className="runtime-decision-list" data-testid="runtime-decision-false-context-panel">
            <div className="runtime-decision-row">
              <strong>Semantic mismatch</strong>
              <span>{summary.semanticMismatchCandidates.count} · {summary.semanticMismatchCandidates.sharePct}%</span>
            </div>
            <div className="runtime-decision-row">
              <strong>False positives</strong>
              <span>{summary.falsePositiveCandidates.count} · {summary.falsePositiveCandidates.sharePct}%</span>
            </div>
            <div className="runtime-decision-row">
              <strong>False context motifs</strong>
              <span>{falseContextMotifs.length > 0 ? falseContextMotifs.map((motif) => `${falseContextLabel(motif.family)} ${motif.sharePct}%`).join(" · ") : "none"}</span>
            </div>
            {renderFalseContextMotifs(falseContextMotifs, compact)}
            <div className="runtime-decision-row">
              <strong>Dominant bucket</strong>
              <span>{summary.dominant.bucket.label} · {summary.dominant.bucket.sharePct}%</span>
            </div>
            {buckets.map((item) => (
              <div key={item.bucket} className="runtime-decision-row">
                <strong>{item.bucket}</strong>
                <span>{item.count} · {item.sharePct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {compact ? null : (
        <>
          <div className="runtime-decision-callout">{summary.deskRead.nextAction}</div>
          {mismatchSamples.length > 0 || falsePositiveSamples.length > 0 ? (
            <div className="runtime-decision-grid runtime-decision-grid-bottom">
              <div className="runtime-decision-box">
                <div className="subtle mini">Mismatch samples</div>
                <div className="runtime-decision-list">
                  {mismatchSamples.length > 0 ? mismatchSamples.map((sample) => (
                    <div key={`${sample.createdAtIso}-${sample.code}`} className="runtime-decision-row">
                      <strong>{sample.code}</strong>
                      <span>{sample.detail}</span>
                    </div>
                  )) : <div className="runtime-decision-row"><strong>OK</strong><span>Aucun sample critique.</span></div>}
                </div>
              </div>
              <div className="runtime-decision-box">
                <div className="subtle mini">Stable-state replays</div>
                <div className="runtime-decision-list">
                  {falsePositiveSamples.length > 0 ? falsePositiveSamples.map((sample) => (
                    <div key={`${sample.createdAtIso}-${sample.action}`} className="runtime-decision-row">
                      <strong>{sample.code}</strong>
                      <span>attention={sample.attentionState} · bus={sample.busSeq} · depth={sample.depthAgeMs ?? "n/a"}ms</span>
                    </div>
                  )) : <div className="runtime-decision-row"><strong>OK</strong><span>Aucun replay stable prioritaire.</span></div>}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}