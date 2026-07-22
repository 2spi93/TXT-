import type { RuntimeDecisionAnalyticsSummary } from "../../lib/runtimeDecisionAnalytics";
import TradabilityScienceDesk from "./TradabilityScienceDesk";

type Props = {
  summary: RuntimeDecisionAnalyticsSummary | null;
  title?: string;
  compact?: boolean;
};

function toneClass(value: string): string {
  if (value === "good" || value === "RELIABLE" || value === "ACTIONABLE_LATER" || value === "HIGH") {
    return "good";
  }
  if (value === "subtle" || value === "DEGRADED" || value === "WATCH" || value === "WATCHLIST" || value === "OBSERVE" || value === "INACTIVE") {
    return "subtle";
  }
  return "warn";
}

function thresholdToneClass(value: string): string {
  if (value === "PASS") {
    return "good";
  }
  if (value === "WATCH") {
    return "subtle";
  }
  return "warn";
}

export default function RuntimeObservationDashboard({ summary, title = "Observation Dashboard", compact = false }: Props) {
  if (!summary) {
    return (
      <div className={`runtime-observation-dashboard ${compact ? "compact" : ""}`.trim()}>
        <div className="runtime-observation-head">
          <div>
            <div className="eyebrow">{title}</div>
            <div className="runtime-observation-headline">Observation indisponible</div>
          </div>
        </div>
        <p className="runtime-observation-summary">Aucune synthese runtime exploitable pour cette fenetre.</p>
      </div>
    );
  }

  const reliability = summary.reliability;
  const observation = summary.observation;
  const integrity = summary.integrity;
  const guard = summary.opportunity.guard;
  const confidence = summary.opportunity.confidenceEngine;
  const heatmapRows = summary.monitoring?.noTradeHeatmap.rows || [];
  const heatmapTop = heatmapRows
    .flatMap((row) => row.cells.map((cell) => ({
      regime: row.regime,
      timeframe: cell.timeframe,
      count: cell.count,
      topCode: cell.topCode || "quiet",
      topFalseContextFamily: cell.topFalseContextFamily,
      topFalseContextSharePct: cell.topFalseContextSharePct,
    })))
    .sort((left, right) => right.count - left.count || left.timeframe.localeCompare(right.timeframe))[0] || null;
  const driftVariancePct = Number((summary.drift.stats.signalVariance * 100).toFixed(1));
  const whyReasons = reliability.blockingReasons.length > 0
    ? reliability.blockingReasons
    : reliability.degradedReasons.length > 0
      ? reliability.degradedReasons
      : reliability.reasons;
  const temporalValidation = summary.monitoring?.observationWindow.validation;
  const governanceBudget = summary.monitoring?.governanceBudget || null;
  const falseContextMotifs = summary.monitoring?.falseContextMotifs || [];

  return (
    <div id="runtime-observation-dashboard" className={`runtime-observation-dashboard ${compact ? "compact" : ""}`.trim()} data-testid="runtime-observation-dashboard">
      <div className="runtime-observation-head">
        <div>
          <div className="eyebrow">{title}</div>
          <div className="runtime-observation-headline">{reliability.state === "RELIABLE" ? "SYSTEM READY FOR OBSERVATION" : "SYSTEM NOT READY FOR DECISION"}</div>
        </div>
        <div className={`runtime-observation-pill ${toneClass(reliability.state)}`}>{reliability.state}</div>
      </div>

      <p className="runtime-observation-summary">{reliability.summary}</p>

      <div className="runtime-observation-grid">
        <div className="runtime-observation-card">
          <div className="subtle mini">Reliability Block</div>
          <div className={`runtime-observation-key ${toneClass(reliability.state)}`}>{reliability.state}</div>
          <div className="runtime-observation-list">
            <div className="runtime-observation-row"><strong>coverage</strong><span>{reliability.observationCoverageHours.toFixed(1)}h / {observation.minObservationHours}h</span></div>
            <div className="runtime-observation-row"><strong>completeness</strong><span>{reliability.dataCompletenessPct}%</span></div>
            <div className="runtime-observation-row"><strong>consistency</strong><span>{reliability.signalConsistencyPct}%</span></div>
            <div className="runtime-observation-row"><strong>{reliability.blocked ? "why blocked" : "why degraded"}</strong><span>{whyReasons.slice(0, 3).join(" · ") || "none"}</span></div>
          </div>
        </div>

        <div className="runtime-observation-card">
          <div className="subtle mini">Drift Block</div>
          <div className={`runtime-observation-key ${toneClass(summary.drift.state)}`}>{summary.drift.type}</div>
          <div className="runtime-observation-list">
            <div className="runtime-observation-row"><strong>state</strong><span>{summary.drift.state}</span></div>
            <div className="runtime-observation-row"><strong>stability</strong><span>{observation.driftStability}%</span></div>
            <div className="runtime-observation-row"><strong>window consistency</strong><span>{summary.drift.stats.windowConsistencyPct}%</span></div>
            <div className="runtime-observation-row"><strong>variance</strong><span>{driftVariancePct}%</span></div>
          </div>
        </div>

        <div className="runtime-observation-card">
          <div className="subtle mini">Opportunity Block</div>
          <div className={`runtime-observation-key ${toneClass(guard.state === "OK" ? confidence.state : guard.state)}`}>{confidence.state}</div>
          <div className="runtime-observation-list">
            <div className="runtime-observation-row"><strong>guard</strong><span>{guard.state}</span></div>
            <div className="runtime-observation-row"><strong>opportunity</strong><span>{summary.opportunity.avgScore}% · {summary.opportunity.liveState}</span></div>
            <div className="runtime-observation-row"><strong>sample size</strong><span>{confidence.sampleSize}</span></div>
            <div className="runtime-observation-row"><strong>signal read</strong><span>{confidence.summary}</span></div>
          </div>
        </div>

        <div className="runtime-observation-card">
          <div className="subtle mini">Runtime Integrity Block</div>
          <div className={`runtime-observation-key ${toneClass(integrity.state)}`}>{integrity.state}</div>
          <div className="runtime-observation-list">
            <div className="runtime-observation-row"><strong>score</strong><span>{integrity.scorePct}%</span></div>
            <div className="runtime-observation-row"><strong>subscores</strong><span>Cvg {integrity.coverageScorePct}% · Fresh {integrity.freshnessScorePct}% · Cons {integrity.consistencyScorePct}% · Cont {integrity.continuityScorePct}%</span></div>
            <div className="runtime-observation-row"><strong>multi-chart</strong><span>{integrity.multiChart.state}{typeof integrity.multiChart.activeTiles === "number" && typeof integrity.multiChart.expectedTiles === "number" ? ` · ${integrity.multiChart.activeTiles}/${integrity.multiChart.expectedTiles}` : ""}</span></div>
            <div className="runtime-observation-row"><strong>auto trader v5</strong><span>{integrity.v5.state} · {integrity.v5.sourceLabel}</span></div>
            <div className="runtime-observation-row"><strong>why</strong><span>{integrity.reasons.slice(0, 3).join(" · ") || "signals aligned"}</span></div>
          </div>
        </div>
      </div>

      <div className="runtime-observation-grid runtime-observation-grid-bottom">
        <div className="runtime-observation-card">
          <div className="subtle mini">Heatmap anomalies</div>
          {heatmapTop ? (
            <div className="runtime-observation-list">
              <div className="runtime-observation-row"><strong>top cluster</strong><span>{heatmapTop.timeframe} · {heatmapTop.regime}</span></div>
              <div className="runtime-observation-row"><strong>dominant cause</strong><span>{heatmapTop.topCode}</span></div>
              <div className="runtime-observation-row"><strong>operator motif</strong><span>{heatmapTop.topFalseContextFamily ? `${heatmapTop.topFalseContextFamily} ${heatmapTop.topFalseContextSharePct}%` : "none"}</span></div>
              <div className="runtime-observation-row"><strong>count</strong><span>{heatmapTop.count}</span></div>
              <div className="runtime-observation-row"><strong>read</strong><span>{summary.monitoring.noTradeHeatmap.summary}</span></div>
            </div>
          ) : (
            <p className="runtime-observation-summary">Aucun cluster NO_TRADE dominant sur la fenetre active.</p>
          )}
        </div>

        <div className="runtime-observation-card">
          <div className="subtle mini">Operator Read</div>
          <div className={`runtime-observation-key ${toneClass(summary.deskRead.tone)}`}>{summary.deskRead.headline}</div>
          <div className="runtime-observation-list">
            <div className="runtime-observation-row"><strong>summary</strong><span>{summary.deskRead.summary}</span></div>
            <div className="runtime-observation-row"><strong>next action</strong><span>{summary.deskRead.nextAction}</span></div>
          </div>
        </div>

        <TradabilityScienceDesk
          title="Tradability Audit Trail"
          testId="runtime-observation-tradability-audit"
          mode="compact"
          containerClassName="runtime-observation-card"
        />

        <div className="runtime-observation-card" data-testid="runtime-observation-runbook">
          <div className="subtle mini">Observation Runbook</div>
          <div className={`runtime-observation-key ${toneClass(summary.integrity.state)}`}>observer sans influencer</div>
          <div className="runtime-observation-list">
            <div className="runtime-observation-row"><strong>observe</strong><span>stabilite · coherence · completude · prudence face au manque de data · qualite des refus</span></div>
            <div className="runtime-observation-row"><strong>ignore</strong><span>performance · scores seduisants · opportunites · PnL · envie de conclure trop tot</span></div>
            <div className="runtime-observation-row"><strong>rule</strong><span>aucune influence sur le verdict operateur tant que la baseline n'est pas validee</span></div>
          </div>
        </div>
      </div>

      <div className="runtime-observation-card" data-testid="runtime-temporal-validation">
        <div className="subtle mini">Temporal validation 24h - 7j</div>
        <p className="runtime-observation-summary">{temporalValidation?.summary || summary.monitoring.observationWindow.gateSummary}</p>
        {temporalValidation ? (
          <>
            <div className="runtime-observation-grid runtime-observation-grid-bottom">
              <div className="runtime-observation-card runtime-observation-card-nested">
                <div className="subtle mini">Reliability distribution</div>
                <div className="runtime-observation-list">
                  {temporalValidation.reliabilityDistribution.map((item) => (
                    <div key={item.state} className="runtime-observation-row">
                      <strong className={toneClass(item.state)}>{item.state}</strong>
                      <span>{item.count} bucket(s) · {item.sharePct}%</span>
                    </div>
                  ))}
                  {temporalValidation.unknownReliabilityCount > 0 ? (
                    <div className="runtime-observation-row">
                      <strong>legacy</strong>
                      <span>{temporalValidation.unknownReliabilityCount} snapshot(s) sans reliability state</span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="runtime-observation-card runtime-observation-card-nested">
                <div className="subtle mini">Window read</div>
                <div className="runtime-observation-list">
                  <div className="runtime-observation-row"><strong>latest reliability</strong><span>{temporalValidation.latestReliabilityState}</span></div>
                  <div className="runtime-observation-row"><strong>integrity trend</strong><span>{temporalValidation.integrityTrend.summary}</span></div>
                  <div className="runtime-observation-row"><strong>integrity volatility</strong><span>{temporalValidation.integrityVolatilityPct != null ? `${temporalValidation.integrityVolatilityPct}%` : "n/a"}</span></div>
                  <div className="runtime-observation-row"><strong>reality check</strong><span className={toneClass(temporalValidation.realityCheck.status)}>{temporalValidation.realityCheck.status} · {temporalValidation.realityCheck.summary}</span></div>
                  <div className="runtime-observation-row"><strong>gap density</strong><span>{temporalValidation.latestGapDensityPct}% latest · {temporalValidation.averageGapDensityPct}% avg</span></div>
                  <div className="runtime-observation-row"><strong>drift stability</strong><span>{temporalValidation.latestDriftStability != null ? `${temporalValidation.latestDriftStability}% latest` : "n/a"} · {temporalValidation.averageDriftStability != null ? `${temporalValidation.averageDriftStability}% avg` : "n/a"}</span></div>
                  <div className="runtime-observation-row"><strong>NO_TRADE cluster</strong><span>{temporalValidation.latestNoTradeConcentrationPct}%{temporalValidation.latestNoTradeConcentrationLabel ? ` · ${temporalValidation.latestNoTradeConcentrationLabel}` : ""}</span></div>
                </div>
              </div>
            </div>

            <div className="runtime-observation-list">
              {temporalValidation.thresholds.map((threshold) => (
                <div key={threshold.key} className="runtime-observation-row">
                  <strong className={thresholdToneClass(threshold.status)}>{threshold.label}</strong>
                  <span>{threshold.summary}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {governanceBudget ? (
        <div className="runtime-observation-card" data-testid="runtime-governance-budget">
          <div className="subtle mini">Decision governance budget</div>
          <div className={`runtime-observation-key ${thresholdToneClass(governanceBudget.state === "MANUAL_REVIEW_ONLY" ? "PASS" : governanceBudget.state === "OBSERVE_ONLY" ? "WATCH" : "FAIL")}`}>
            {governanceBudget.state}
          </div>
          <p className="runtime-observation-summary">{governanceBudget.summary}</p>
          <div className="runtime-observation-list">
            <div className="runtime-observation-row"><strong>conclusion budget</strong><span>{governanceBudget.conclusionBudgetPct}%</span></div>
            <div className="runtime-observation-row"><strong>auto promotion</strong><span>{governanceBudget.autoPromotionAllowed ? "on" : "off"}</span></div>
            <div className="runtime-observation-row"><strong>governance read</strong><span>{governanceBudget.reasons.join(" · ") || "manual review gate"}</span></div>
            <div className="runtime-observation-row"><strong>false context motifs</strong><span>{falseContextMotifs.length > 0 ? falseContextMotifs.map((item) => `${item.family} ${item.sharePct}%`).join(" · ") : "none"}</span></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}