import HelpHint from "../HelpHint";

import type { RuntimeDecisionAnalyticsSummary } from "../../lib/runtimeDecisionAnalytics";

type Props = {
  summary: RuntimeDecisionAnalyticsSummary | null;
  compact?: boolean;
  title?: string;
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

function DriftSeries({ summary }: { summary: RuntimeDecisionAnalyticsSummary }) {
  const points = summary.series.points;
  const routingLine = buildLine(points.map((point) => point.routingZeroRate));
  const runtimeLine = buildLine(points.map((point) => point.runtimeBlockRate));
  const opportunityLine = buildLine(points.map((point) => point.opportunityRate));

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
        </div>
      </div>
      <svg viewBox="0 0 100 100" className="runtime-decision-series-chart" aria-label="Runtime decision time series over 24 hours">
        <path d="M0,100 L100,100" className="runtime-decision-series-axis" />
        <path d={routingLine} className="runtime-decision-series-line routing" />
        <path d={runtimeLine} className="runtime-decision-series-line runtime" />
        <path d={opportunityLine} className="runtime-decision-series-line opportunity" />
      </svg>
      <div className="runtime-decision-series-foot">
        <span>{summary.series.windowHours}h window</span>
        <span>{summary.series.bucketHours}h buckets</span>
        <span>{summary.series.points.length} points</span>
      </div>
    </div>
  );
}

export default function RuntimeDecisionOverviewCard({ summary, compact = false, title = "Runtime Decision Desk" }: Props) {
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
  const driftWindowRows = [summary.drift.windows["1h"], summary.drift.windows["6h"], summary.drift.windows["24h"]];
  const blockedBuckets = summary.opportunity.blockedByBucket.slice(0, compact ? 2 : 3);

  return (
    <div className={`runtime-decision-card ${compact ? "compact" : ""}`.trim()}>
      <div className="runtime-decision-head">
        <div>
          <div className="eyebrow">
            {title}
            {!compact ? <HelpHint text="Lecture compacte des refus d'execution: bucket dominant, codes majeurs, hygiene de journal et contexte de marche." examples={["Si market domine, traite d'abord la rarete d'edge et le routing score.", "Si runtime domine, va verifier readiness, recovery, fallback et bridge avant toute calibration."]} /> : null}
          </div>
          <div className={`runtime-decision-headline ${toneClass(summary.deskRead.tone)}`}>{summary.deskRead.headline}</div>
          <p className="runtime-decision-summary">{summary.deskRead.summary}</p>
        </div>
        <div className={`runtime-decision-chip ${toneClass(summary.deskRead.tone)}`}>{summary.policyVersion}</div>
      </div>

      <div className="runtime-decision-metrics">
        <div className="runtime-decision-metric">
          <span>NO_TRADE</span>
          <strong>{summary.totals.noTradeRows} ({summary.totals.noTradePctWithinExecution}%)</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Drift</span>
          <strong className={toneClass(summary.drift.tone)}>{summary.drift.detected ? `${summary.drift.alerts.length} alert(s)` : "calm"}</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Opportunity rate</span>
          <strong>{summary.opportunity.opportunityRate}%</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Missed opportunity</span>
          <strong className={summary.opportunity.missedOpportunityRate >= 50 ? "warn" : summary.opportunity.missedOpportunityRate > 0 ? "subtle" : "good"}>{summary.opportunity.missedOpportunityRate}%</strong>
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
            {driftWindowRows.map((window) => (
              <div key={window.label} className="runtime-decision-row">
                <strong>{window.label}</strong>
                <span>routing {window.routingZeroRate}% · runtime {window.runtimeBlockRate}% · policy {window.policyBlockRate}%</span>
              </div>
            ))}
            {driftAlerts.length > 0 ? driftAlerts.map((alert) => (
              <div key={`${alert.currentWindow}-${alert.metric}`} className="runtime-decision-row">
                <strong>{alert.currentWindow} {alert.metric}</strong>
                <span>{alert.severity} · {alert.currentRate}% vs {alert.baselineRate}%</span>
              </div>
            )) : (
              <div className="runtime-decision-row">
                <strong>24h baseline</strong>
                <span>Aucune derive materielle detectee.</span>
              </div>
            )}
          </div>
        </div>
        <div className="runtime-decision-box">
          <div className="subtle mini">Opportunity density</div>
          <div className="runtime-decision-list">
            <div className="runtime-decision-row">
              <strong>Tradable contexts</strong>
              <span>{summary.opportunity.candidateCount} · {summary.opportunity.opportunityRate}% of execution rows</span>
            </div>
            <div className="runtime-decision-row">
              <strong>Execution efficiency</strong>
              <span>{summary.opportunity.executionEfficiency}% · executed {summary.opportunity.executedCount}</span>
            </div>
            <div className="runtime-decision-row">
              <strong>Missed opportunities</strong>
              <span>{summary.opportunity.blockedCount} blocked · {summary.opportunity.missedOpportunityRate}% of candidates</span>
            </div>
            {blockedBuckets.length > 0 ? blockedBuckets.map((item) => (
              <div key={item.bucket} className="runtime-decision-row">
                <strong>{item.bucket}</strong>
                <span>{item.count} · {item.sharePct}% of blocked candidates</span>
              </div>
            )) : null}
          </div>
        </div>
        <div className="runtime-decision-box">
          <div className="subtle mini">Hygiene and bucket split</div>
          <div className="runtime-decision-list">
            <div className="runtime-decision-row">
              <strong>Semantic mismatch</strong>
              <span>{summary.semanticMismatchCandidates.count} · {summary.semanticMismatchCandidates.sharePct}%</span>
            </div>
            <div className="runtime-decision-row">
              <strong>False positives</strong>
              <span>{summary.falsePositiveCandidates.count} · {summary.falsePositiveCandidates.sharePct}%</span>
            </div>
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