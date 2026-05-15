import HelpHint from "../HelpHint";

import type {
  RuntimeDecisionAnalyticsSummary,
  RuntimeDecisionFalseContextMotif,
  RuntimeDecisionMonitoringAlert,
  RuntimeDecisionNoTradeHeatmapRow,
} from "../../lib/runtimeDecisionAnalytics";

type Props = {
  summary: RuntimeDecisionAnalyticsSummary | null;
  compact?: boolean;
  title?: string;
};

function toneClass(value: string): string {
  if (value === "warn" || value === "warning" || value === "critical") {
    return "warn";
  }
  if (value === "good") {
    return "good";
  }
  return "subtle";
}

function telemetryTone(value: string | undefined): string {
  if (value === "OK" || value === "LIVE") {
    return "good";
  }
  if (value === "MISSING" || value === "NO_EDGE" || value === "EMPTY_PAYLOAD") {
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

function formatStatus(status: number | undefined): string {
  return status && status > 0 ? String(status) : "ERR";
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

function formatCaptureAge(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) {
    return "n/a";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3_600) {
    return `${Math.round(seconds / 60)}m`;
  }
  return `${Math.round(seconds / 3_600)}h`;
}

function observationDeltaLabel(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "baseline n/a";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}pt`;
}

function observationMetricLabel(value: string): string {
  switch (value) {
    case "driftFalsePositiveRate":
      return "drift FP";
    case "opportunityHitRate":
      return "opportunity hit";
    case "decisionConsistency":
      return "consistency";
    case "driftReliabilityMean":
      return "drift reliability";
    default:
      return value;
  }
}

function falseContextLabel(value: string | null | undefined): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "none";
  }
  return normalized.split("_").join(" ").toLowerCase();
}

function renderAlertRows(alerts: RuntimeDecisionMonitoringAlert[]) {
  if (alerts.length === 0) {
    return (
      <div className="runtime-monitor-row">
        <strong>stable</strong>
        <span>Aucune anomalie active sur les seuils operateur.</span>
      </div>
    );
  }

  return alerts.map((alert) => (
    <div key={alert.id} className="runtime-monitor-row">
      <strong className={toneClass(alert.severity)}>{alert.label}</strong>
      <span>{alert.summary} {alert.action}</span>
    </div>
  ));
}

function renderHeatmapRows(rows: RuntimeDecisionNoTradeHeatmapRow[], timeframes: string[]) {
  return rows.map((row) => (
    <div key={row.regime} className="runtime-monitor-heatmap-row">
      <div className="runtime-monitor-heatmap-axis runtime-monitor-heatmap-axis-row">
        <strong>{row.regime}</strong>
        <span>{row.totalSharePct}%</span>
      </div>
      {timeframes.map((timeframe) => {
        const cell = row.cells.find((item) => item.timeframe === timeframe);
        const count = cell?.count || 0;
        return (
          <div
            key={`${row.regime}-${timeframe}`}
            className={`runtime-monitor-heatmap-cell ${toneClass(cell?.tone || "subtle")} ${count === 0 ? "is-empty" : ""}`.trim()}
          >
            <strong>{count}</strong>
            <span>{count > 0 ? cell?.topCode || "n/a" : "quiet"}</span>
            {count > 0 && cell?.topFalseContextFamily ? (
              <small>{falseContextLabel(cell.topFalseContextFamily)} {cell.topFalseContextSharePct}%</small>
            ) : null}
          </div>
        );
      })}
    </div>
  ));
}

function renderFalseContextMotifs(motifs: RuntimeDecisionFalseContextMotif[], compact: boolean) {
  if (motifs.length === 0) {
    return (
      <div className="runtime-monitor-row">
        <strong>motifs</strong>
        <span>Aucun faux contexte dominant journalise sur la fenetre.</span>
      </div>
    );
  }

  return motifs.slice(0, compact ? 2 : 4).map((motif) => (
    <div key={motif.family} className="runtime-monitor-row">
      <strong>{falseContextLabel(motif.family)}</strong>
      <span>{motif.count} cas · {motif.sharePct}%{motif.topReasons.length > 0 ? ` · ${motif.topReasons.join(" · ")}` : ""}</span>
    </div>
  ));
}

export default function RuntimeOperatorMonitoringCard({ summary, compact = false, title = "Operator Runtime Monitor" }: Props) {
  const monitoring = summary?.monitoring;
  const live = monitoring?.live || null;
  const alerts = monitoring?.anomalies.rows || [];
  const timeframes = monitoring?.noTradeHeatmap.timeframes || [];
  const heatmapRows = monitoring?.noTradeHeatmap.rows || [];
  const falseContextMotifs = monitoring?.falseContextMotifs || [];
  const observationWindow = monitoring?.observationWindow || null;
  const telemetry = summary?.opportunity.telemetry;
  const telemetryDebug = telemetry?.debug || null;
  const telemetryIntegrity = telemetry?.integrity;
  const telemetryIntegrityItems = Array.isArray(telemetryIntegrity?.items) ? telemetryIntegrity.items : [];
  const reliability = summary?.reliability || {
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
  const opportunityGuard = summary?.opportunity.guard || {
    state: "OK",
    blocked: false,
    trustScorePct: 100,
    summary: "Guard unavailable",
    reasons: [],
  };
  const opportunityConfidence = summary?.opportunity.confidenceEngine || {
    state: "EXPLORATORY",
    sampleSize: 0,
    stabilityPct: 0,
    summary: "EXPLORATORY · runtime confidence unavailable.",
  };
  const observationIntegrity = summary?.observation.integrity || {
    status: "CRITICAL",
    scorePct: 0,
    coveredHours: 0,
    expectedHours: 0,
    missingHours: 0,
    maxGapHours: 0,
    summary: "Observation integrity unavailable.",
  };

  if (!summary || !live) {
    return (
      <div className={`runtime-monitor-card ${compact ? "compact" : ""}`.trim()}>
        <div className="runtime-monitor-head">
          <div className="eyebrow">{title}</div>
        </div>
        <p className="subtle">Monitoring operateur indisponible pour cette fenetre.</p>
      </div>
    );
  }

  return (
    <div className={`runtime-monitor-card ${compact ? "compact" : ""}`.trim()} data-testid="runtime-operator-monitor-card">
      <div className="runtime-monitor-head">
        <div>
          <div className="eyebrow">
            {title}
            {!compact ? <HelpHint text="Lecture operateur live: drift, opportunite, stale XCH, bus lag et clusters NO_TRADE sans reconstruire une seconde verite." examples={["Si XCH stale monte alors que bus/UI restent coherents, traite d'abord la fraicheur de la source de marche.", "Si missed opportunity est eleve cote runtime/policy, la heatmap aide a voir ou les blocages se concentrent vraiment."]} /> : null}
          </div>
          <div className="runtime-monitor-headline">{live.summary}</div>
        </div>
        <div className="runtime-monitor-head-side">
          <div className={`runtime-monitor-chip ${live.source === "local-terminal-capture" ? "good" : "warn"}`}>{live.source === "local-terminal-capture" ? "live capture" : "capture missing"}</div>
          <div className="runtime-monitor-mini">latest {formatCaptureAge(live.latestCaptureAgeSec)}</div>
        </div>
      </div>

      <div className="runtime-monitor-metrics">
        <div className="runtime-monitor-metric">
          <span>Drift prob</span>
          <strong className={live.driftProbabilityPct >= 60 ? "warn" : live.driftProbabilityPct >= 35 ? "subtle" : "good"}>{live.driftProbabilityPct}%</strong>
        </div>
        <div className="runtime-monitor-metric">
          <span>Reliability</span>
          <strong className={live.driftReliabilityPct >= 65 ? "good" : live.driftReliabilityPct >= 45 ? "subtle" : "warn"}>{live.driftReliabilityPct}%</strong>
        </div>
        <div className="runtime-monitor-metric">
          <span>Drift type</span>
          <strong>{driftTypeLabel(live.driftType)}</strong>
        </div>
        <div className="runtime-monitor-metric">
          <span>Opportunity</span>
          <strong>{live.opportunityScorePct}%</strong>
        </div>
        <div className="runtime-monitor-metric">
          <span>Confidence</span>
          <strong className={summary.opportunity.confidencePct >= 70 ? "good" : summary.opportunity.confidencePct >= 45 ? "subtle" : "warn"}>{summary.opportunity.confidencePct}%</strong>
        </div>
        <div className="runtime-monitor-metric">
          <span>Opportunity count</span>
          <strong>{live.opportunityCount}</strong>
        </div>
        <div className="runtime-monitor-metric">
          <span>Limiting factor</span>
          <strong className={toneClass(live.limitingFactor?.tone || "subtle")}>{live.limitingFactor ? `${live.limitingFactor.label} ${live.limitingFactor.scorePct.toFixed(0)}%` : "n/a"}</strong>
        </div>
        <div className="runtime-monitor-metric">
          <span>XCH stale rate</span>
          <strong className={live.staleRateXchPct != null && live.staleRateXchPct >= 40 ? "warn" : live.staleRateXchPct != null ? "subtle" : "subtle"}>{live.staleRateXchPct != null ? `${live.staleRateXchPct}%` : "n/a"}</strong>
        </div>
        <div className="runtime-monitor-metric">
          <span>Bus lag</span>
          <strong className={(live.latestBusLagMs ?? 0) >= 2500 ? "warn" : (live.latestBusLagMs ?? 0) >= 900 ? "subtle" : "good"}>{live.latestBusLagMs != null ? `${Math.round(live.latestBusLagMs)}ms` : "n/a"}</strong>
        </div>
        <div className="runtime-monitor-metric">
          <span>Consistency</span>
          <strong className={live.decisionConsistencyPct >= 70 ? "good" : live.decisionConsistencyPct >= 55 ? "subtle" : "warn"}>{live.decisionConsistencyPct}%</strong>
        </div>
        <div className="runtime-monitor-metric">
          <span>Trust guard</span>
          <strong className={toneClass(opportunityGuard.state === "OK" ? "good" : "warn")}>{opportunityGuard.state}</strong>
        </div>
        <div className="runtime-monitor-metric">
          <span>Reliability</span>
          <strong className={reliability.state === "RELIABLE" ? "good" : reliability.state === "DEGRADED" ? "subtle" : "warn"}>{reliability.state}</strong>
        </div>
      </div>

      <div className="runtime-monitor-grid">
        <div className="runtime-monitor-box">
          <div className="subtle mini">Live telemetry</div>
          <div className="runtime-monitor-list">
            <div className="runtime-monitor-row">
              <strong>XCH</strong>
              <span>{live.latestXchStatus} {live.latestXchAgeLabel} · {live.latestXchSourceLabel || "source n/a"}</span>
            </div>
            <div className="runtime-monitor-row">
              <strong>Capture</strong>
              <span>{live.latestFeedLabel || "n/a"} · age {formatCaptureAge(live.latestCaptureAgeSec)} · samples XCH {live.xchSampleCount}</span>
            </div>
            <div className="runtime-monitor-row">
              <strong>Bus / e2e</strong>
              <span>latest {live.latestBusLagMs != null ? `${Math.round(live.latestBusLagMs)}ms` : "n/a"} · avg {live.avgBusLagMs != null ? `${Math.round(live.avgBusLagMs)}ms` : "n/a"} · e2e {live.latestEndToEndLagMs != null ? `${Math.round(live.latestEndToEndLagMs)}ms` : "n/a"}</span>
            </div>
            <div className="runtime-monitor-row">
              <strong>Bus state</strong>
              <span>{live.latestBusState || "n/a"}</span>
            </div>
          </div>
        </div>
        <div className="runtime-monitor-box">
          <div className="subtle mini">Anomaly feed</div>
          <div className="runtime-monitor-list">
            {renderAlertRows(alerts.slice(0, compact ? 2 : 5))}
          </div>
        </div>
      </div>

      <div className="runtime-monitor-box" data-testid="runtime-telemetry-debug">
        <div className="subtle mini">Telemetry debug</div>
        <div className="runtime-monitor-list">
          <div className="runtime-monitor-row">
            <strong>AUTH</strong>
            <span className={telemetryTone(telemetry?.authState)}>{telemetry?.authState || "UNKNOWN"}{telemetryDebug?.market.request.hasToken ? ` · ${telemetryDebug.market.request.tokenPreview || "token"}` : ""}</span>
          </div>
          <div className="runtime-monitor-row">
            <strong>HTTP</strong>
            <span>market {formatStatus(telemetryDebug?.market.response.status)} · route {formatStatus(telemetryDebug?.route.response.status)}</span>
          </div>
          <div className="runtime-monitor-row">
            <strong>VENUES</strong>
            <span>{telemetry?.venueCount ?? 0} total · market {telemetry?.marketVenueCount ?? 0} · route {telemetry?.routeVenueCount ?? 0}</span>
          </div>
          <div className="runtime-monitor-row">
            <strong>SPREAD</strong>
            <span>{telemetry?.avgSpreadBps != null ? `${telemetry.avgSpreadBps.toFixed(2)}bp` : "MISSING"}</span>
          </div>
          <div className="runtime-monitor-row">
            <strong>LATENCY</strong>
            <span>{telemetry?.avgRouteLatencyMs != null || telemetry?.avgDepthLatencyMs != null ? `route ${telemetry?.avgRouteLatencyMs?.toFixed(0) ?? "n/a"}ms · depth ${telemetry?.avgDepthLatencyMs?.toFixed(0) ?? "n/a"}ms` : "MISSING"}</span>
          </div>
          <div className="runtime-monitor-row">
            <strong>PARSING</strong>
            <span>{telemetry?.missingFields && telemetry.missingFields.length > 0 ? `missing ${telemetry.missingFields.join(", ")} · fallback ON` : "parsed ok · fallback OFF"}</span>
          </div>
          {telemetryIntegrity?.summary ? (
            <div className="runtime-monitor-row">
              <strong>INTEGRITY</strong>
              <span>{telemetryIntegrity.summary}</span>
            </div>
          ) : null}
          {telemetryIntegrityItems.length > 0 ? (
            <div className="runtime-monitor-row">
              <strong>CODES</strong>
              <span>{telemetryIntegrityItems.slice(0, 5).map((item) => item.label || item.code).join(", ")}</span>
            </div>
          ) : null}
          <div className="runtime-monitor-row">
            <strong>GUARD</strong>
            <span>{opportunityGuard.state} · trust {opportunityGuard.trustScorePct}% · {opportunityGuard.summary}</span>
          </div>
          <div className="runtime-monitor-row">
            <strong>RELIABILITY</strong>
            <span>{reliability.state} · completeness {reliability.dataCompletenessPct}% · consistency {reliability.signalConsistencyPct}% · {reliability.summary}</span>
          </div>
          {reliability.blockingReasons.length > 0 ? (
            <div className="runtime-monitor-row">
              <strong>WHY BLOCKED</strong>
              <span>{reliability.blockingReasons.slice(0, 4).join(" · ")}</span>
            </div>
          ) : reliability.degradedReasons.length > 0 ? (
            <div className="runtime-monitor-row">
              <strong>WHY DEGRADED</strong>
              <span>{reliability.degradedReasons.slice(0, 4).join(" · ")}</span>
            </div>
          ) : null}
          <div className="runtime-monitor-row">
            <strong>CONFIDENCE</strong>
            <span>{opportunityConfidence.state} · sample {opportunityConfidence.sampleSize} · stability {opportunityConfidence.stabilityPct}%</span>
          </div>
          <div className="runtime-monitor-row">
            <strong>CONTRACT</strong>
            <span>market [{(telemetryDebug?.market.payload.topLevelKeys || []).join(", ") || "n/a"}] · route [{(telemetryDebug?.route.payload.topLevelKeys || []).join(", ") || "n/a"}] · route profile [{(telemetryDebug?.route.payload.firstRowNestedKeys.profile || []).join(", ") || "n/a"}]</span>
          </div>
          <div className="runtime-monitor-row">
            <strong>NORMALIZED</strong>
            <span>market [{Object.keys(telemetryDebug?.market.parsing.firstRowNormalized || {}).join(", ") || "n/a"}] · route [{Object.keys(telemetryDebug?.route.parsing.firstRowNormalized || {}).join(", ") || "n/a"}]</span>
          </div>
          <div className="runtime-monitor-row">
            <strong>ROOT CAUSE</strong>
            <span className={telemetryTone(telemetry?.rootCause)}>{telemetryRootCauseLabel(telemetry?.rootCause)}</span>
          </div>
        </div>
      </div>

      <div className="runtime-monitor-box">
        <div className="subtle mini">Observation 3-7 jours</div>
        <p className="runtime-monitor-summary">{observationWindow?.gateSummary || "Fenetre d'observation indisponible."}</p>
        {observationWindow?.latest ? (
          <>
            <div className="runtime-monitor-observation-grid">
              <div className="runtime-monitor-observation-metric">
                <span>status</span>
                <strong className={observationWindow.status === "READY" ? "good" : observationWindow.status === "OBSERVING" ? "subtle" : "warn"}>{observationWindow.status.toLowerCase()}</strong>
              </div>
              <div className="runtime-monitor-observation-metric">
                <span>coverage</span>
                <strong>{observationWindow.coverageHours.toFixed(1)}h</strong>
              </div>
              <div className="runtime-monitor-observation-metric">
                <span>samples</span>
                <strong>{observationWindow.sampleCount}</strong>
              </div>
              <div className="runtime-monitor-observation-metric">
                <span>latest bucket</span>
                <strong>{observationWindow.latest.bucketStartIso.slice(5, 16).replace("T", " ")}</strong>
              </div>
            </div>
            <div className="runtime-monitor-list">
              <div className="runtime-monitor-row">
                <strong>integrity</strong>
                <span>{observationIntegrity.status} · {observationIntegrity.coveredHours}/{observationIntegrity.expectedHours}h · missing {observationIntegrity.missingHours}h · max gap {observationIntegrity.maxGapHours}h</span>
              </div>
              <div className="runtime-monitor-row">
                <strong>interpretation gate</strong>
                <span>{reliability.state} · coverage {reliability.observationCoverageHours.toFixed(1)}h · anomaly {reliability.anomalyRatePct}%</span>
              </div>
              {observationWindow.deltas.map((delta) => (
                <div key={delta.metric} className="runtime-monitor-row">
                  <strong>{observationMetricLabel(delta.metric)}</strong>
                  <span>{delta.current.toFixed(1)} · {observationDeltaLabel(delta.delta)}</span>
                </div>
              ))}
              <div className="runtime-monitor-row">
                <strong>integrity read</strong>
                <span>{observationIntegrity.summary}</span>
              </div>
            </div>
          </>
        ) : (
          <div className="runtime-monitor-row">
            <strong>window</strong>
            <span>Aucun historique KPI horaire exploitable pour la fenetre active.</span>
          </div>
        )}
      </div>

      {compact ? null : (
        <div className="runtime-monitor-box">
          <div className="subtle mini">NO_TRADE heatmap</div>
          <p className="runtime-monitor-summary">{monitoring?.noTradeHeatmap.summary}</p>
          {timeframes.length > 0 && heatmapRows.length > 0 ? (
            <div className="runtime-monitor-heatmap">
              <div className="runtime-monitor-heatmap-row runtime-monitor-heatmap-header">
                <div className="runtime-monitor-heatmap-axis runtime-monitor-heatmap-axis-row">regime</div>
                {timeframes.map((timeframe) => (
                  <div key={timeframe} className="runtime-monitor-heatmap-axis">{timeframe}</div>
                ))}
              </div>
              {renderHeatmapRows(heatmapRows, timeframes)}
            </div>
          ) : (
            <div className="runtime-monitor-row">
              <strong>heatmap</strong>
              <span>Aucun cluster NO_TRADE exploitable sur la fenetre.</span>
            </div>
          )}
          <div className="runtime-monitor-list" data-testid="runtime-operator-false-context-panel">
            <div className="runtime-monitor-row">
              <strong>operator motifs</strong>
              <span>{falseContextMotifs.length > 0 ? falseContextMotifs.map((motif) => `${falseContextLabel(motif.family)} ${motif.sharePct}%`).join(" · ") : "none"}</span>
            </div>
            {renderFalseContextMotifs(falseContextMotifs, compact)}
          </div>
        </div>
      )}
    </div>
  );
}