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

  const topCodes = summary.topCodes.slice(0, compact ? 3 : 5);
  const buckets = summary.byBucket.slice(0, compact ? 3 : 6);
  const mismatchSamples = summary.semanticMismatchCandidates.samples.slice(0, compact ? 1 : 2);
  const falsePositiveSamples = summary.falsePositiveCandidates.samples.slice(0, compact ? 1 : 2);

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
          <span>Bucket dominant</span>
          <strong className={toneClass(summary.deskRead.tone)}>{summary.dominant.bucket.label} ({summary.dominant.bucket.sharePct}%)</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Code dominant</span>
          <strong>{summary.dominant.code.label}</strong>
        </div>
        <div className="runtime-decision-metric">
          <span>Coverage effective</span>
          <strong>{summary.totals.effectiveCanonicalCoveragePct}%</strong>
        </div>
      </div>

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
          <div className="subtle mini">Buckets</div>
          <div className="runtime-decision-list">
            {buckets.map((item) => (
              <div key={item.bucket} className="runtime-decision-row">
                <strong>{item.bucket}</strong>
                <span>{item.count} · {item.sharePct}%</span>
              </div>
            ))}
          </div>
        </div>
        <div className="runtime-decision-box">
          <div className="subtle mini">Hygiene</div>
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
              <strong>Context</strong>
              <span>{summary.dominant.attentionState.label} · {summary.dominant.volatilityRegime.label}</span>
            </div>
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