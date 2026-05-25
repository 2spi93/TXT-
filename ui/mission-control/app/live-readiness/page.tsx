"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import HelpHint from "../../components/HelpHint";
import OperatorPanelGuide from "../../components/ui/OperatorPanelGuide";
import RuntimeOperatorMonitoringCard from "../../components/ui/RuntimeOperatorMonitoringCard";
import TradabilityScienceCard from "../../components/ui/TradabilityScienceCard";
import type { MarketStateMapSnapshot } from "../../lib/marketStateMap";
import type { RuntimeDecisionAnalyticsSummary } from "../../lib/runtimeDecisionAnalytics";
import type { TradabilityAnalyticsSummary } from "../../lib/tradabilityAnalytics";

type JsonMap = Record<string, unknown>;

function formatFreshness(value: unknown): string {
  const freshnessMs = Number(value);
  if (!Number.isFinite(freshnessMs) || freshnessMs < 0) {
    return "n/a";
  }
  if (freshnessMs <= 1000) {
    return `${Math.round(freshnessMs)}ms`;
  }
  if (freshnessMs <= 60_000) {
    return `${Math.round(freshnessMs / 1000)}s`;
  }
  if (freshnessMs <= 3_600_000) {
    return `${Math.round(freshnessMs / 60_000)}m`;
  }
  return `${Math.round(freshnessMs / 3_600_000)}h`;
}

function classifyFreshness(value: unknown): "fresh" | "stale" | "degraded" | "hard-fail" {
  const freshnessMs = Number(value);
  if (!Number.isFinite(freshnessMs) || freshnessMs < 0) {
    return "hard-fail";
  }
  if (freshnessMs <= 15_000) {
    return "fresh";
  }
  if (freshnessMs <= 60_000) {
    return "stale";
  }
  if (freshnessMs <= 180_000) {
    return "degraded";
  }
  return "hard-fail";
}

function freshnessMeaning(level: "fresh" | "stale" | "degraded" | "hard-fail"): string {
  if (level === "fresh") {
    return "fresh <= 15s: utilisable pour lecture et execution.";
  }
  if (level === "stale") {
    return "stale 15-60s: lecture possible, pas d'agression sans confirmation.";
  }
  if (level === "degraded") {
    return "degraded 60-180s: reduire ou bloquer les nouveaux envois.";
  }
  return "hard-fail > 180s ou age inconnu: ne pas trader depuis ce flux.";
}

function regimeOperatorLabel(value: unknown): string {
  const normalized = String(value || "").trim().toLowerCase();
  const labels: Record<string, string> = {
    trend: "tendance lisible",
    chop: "marche hache",
    stress: "stress marche",
    price_discovery: "decouverte de prix",
    range: "range",
  };
  return labels[normalized] || formatLabel(value);
}

function pillTone(level: "fresh" | "stale" | "degraded" | "hard-fail" | "ok"): string {
  if (level === "fresh" || level === "ok") {
    return "good";
  }
  if (level === "stale") {
    return "warn";
  }
  return "bad";
}

function safeRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonMap
    : {};
}

function numberOr(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatPercent(value: unknown, digits = 1): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  return `${numeric.toFixed(digits)}%`;
}

function formatFixed(value: unknown, digits = 2): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  return numeric.toFixed(digits);
}

function formatLabel(value: unknown): string {
  const label = String(value || "").trim();
  return label ? label.replace(/_/g, " ") : "n/a";
}

function countDepthLevels(value: unknown): number {
  const payload = safeRecord(value);
  const bids = Array.isArray(payload.bids) ? payload.bids.length : 0;
  const asks = Array.isArray(payload.asks) ? payload.asks.length : 0;
  return bids + asks;
}

export default function LiveReadinessPage() {
  const [overview, setOverview] = useState<JsonMap | null>(null);
  const [thresholds, setThresholds] = useState<JsonMap[]>([]);
  const [marketBusSnapshot, setMarketBusSnapshot] = useState<JsonMap | null>(null);
  const [healthwatchDashboard, setHealthwatchDashboard] = useState<JsonMap | null>(null);
  const [controlledCollection, setControlledCollection] = useState<JsonMap | null>(null);
  const [runtimeDecisionSummary, setRuntimeDecisionSummary] = useState<RuntimeDecisionAnalyticsSummary | null>(null);
  const [tradabilityAnalytics, setTradabilityAnalytics] = useState<TradabilityAnalyticsSummary | null>(null);
  const [marketStateMap, setMarketStateMap] = useState<MarketStateMapSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [regime, setRegime] = useState("trend");
  const [minSamples, setMinSamples] = useState(25);
  const [minWinRate, setMinWinRate] = useState(0.52);
  const [maxDrawdown, setMaxDrawdown] = useState(1000);
  const [maxAvgLoss, setMaxAvgLoss] = useState(140);

  async function loadData(): Promise<void> {
    const [readinessRes, thresholdRes, marketBusRes, healthwatchRes, runtimeDecisionRes, controlledCollectionRes, tradabilityAnalyticsRes, marketStateMapRes] = await Promise.all([
      fetch("/api/live-readiness/overview", { cache: "no-store" }),
      fetch("/api/strategies/drift-thresholds", { cache: "no-store" }),
      fetch("/api/market/bus/snapshot?instrument=BTCUSDT&venue=binance-public&timeframe=1m&lookback_minutes=60&trade_limit=200", { cache: "no-store" }),
      fetch("/api/system/healthwatch/dashboard", { cache: "no-store" }),
      fetch("/api/system/runtime-decision?sinceDays=7&limit=1200", { cache: "no-store" }),
      fetch("/api/system/observation/controlled-collection", { cache: "no-store" }),
      fetch("/api/terminal/tradability/analytics?sinceDays=14&limit=1200", { cache: "no-store" }),
      fetch("/api/market-state-map?symbol=DESK&timeframe=live&strategy=live-ops&sinceDays=14&limit=1200&windowHours=24", { cache: "no-store" }),
    ]);
    if (!readinessRes.ok || !thresholdRes.ok) {
      throw new Error("Impossible de charger la vue Live Readiness");
    }
    setOverview(await readinessRes.json());
    const thresholdsPayload = await thresholdRes.json();
    setThresholds((thresholdsPayload.items as JsonMap[] | undefined) || []);
    setMarketBusSnapshot(marketBusRes.ok ? await marketBusRes.json() : null);
    setHealthwatchDashboard(healthwatchRes.ok ? await healthwatchRes.json() : null);
    setRuntimeDecisionSummary(runtimeDecisionRes.ok ? await runtimeDecisionRes.json() as RuntimeDecisionAnalyticsSummary : null);
    setControlledCollection(controlledCollectionRes.ok ? await controlledCollectionRes.json() : null);
    setTradabilityAnalytics(tradabilityAnalyticsRes.ok ? await tradabilityAnalyticsRes.json() as TradabilityAnalyticsSummary : null);
    setMarketStateMap(marketStateMapRes.ok ? await marketStateMapRes.json() as MarketStateMapSnapshot : null);
    setError(null);
  }

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      loadData().catch((err) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Erreur inconnue");
        }
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  async function saveThreshold(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/strategies/drift-thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regime,
          min_samples: minSamples,
          min_win_rate: minWinRate,
          max_drawdown_usd: maxDrawdown,
          max_avg_loss_usd: maxAvgLoss,
        }),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(String(payload?.detail || "Sauvegarde seuils echouee"));
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  const memoryKpi = (overview?.memory_kpi as JsonMap | undefined) || {};
  const memorySummary = (memoryKpi.summary as JsonMap | undefined) || {};
  const drift = (overview?.drift as JsonMap | undefined) || {};
  const driftItems = (drift.items as JsonMap[] | undefined) || [];
  const suspended = (drift.suspended_strategies as JsonMap[] | undefined) || [];
  const autoResume = (drift.auto_resume as JsonMap | undefined) || {};
  const ab = (overview?.memory_ab as JsonMap | undefined) || {};
  const abArms = (ab.arms as JsonMap[] | undefined) || [];
  const withVsWithout = (ab.with_vs_without_memory as JsonMap | undefined) || {};
  const marketBusMeta = (marketBusSnapshot?.meta as JsonMap | undefined) || {};
  const marketBusHealth = (marketBusMeta.health as JsonMap | undefined) || {};
  const marketBusComponents = (marketBusHealth.components as JsonMap | undefined) || {};
  const marketBusOhlcv = (marketBusComponents.ohlcv as JsonMap | undefined) || {};
  const marketBusDepth = (marketBusComponents.depth as JsonMap | undefined) || {};
  const marketBusTrades = (marketBusComponents.trades as JsonMap | undefined) || {};
  const marketBusSequencing = (marketBusMeta.sequencing as JsonMap | undefined) || {};
  const marketBusOhlcvSeq = (marketBusSequencing.ohlcv as JsonMap | undefined) || {};
  const marketBusPreprocessor = (marketBusMeta.preprocessor as JsonMap | undefined) || {};
  const marketBusTradePreprocessor = (marketBusPreprocessor.trades as JsonMap | undefined) || {};
  const tradePreprocessorJournal = Array.isArray(marketBusTradePreprocessor.journal) ? marketBusTradePreprocessor.journal as JsonMap[] : [];
  const tradePreprocessorJournalSummary = safeRecord(marketBusTradePreprocessor.journal_summary);
  const tradePreprocessorAnalytics = safeRecord(marketBusTradePreprocessor.analytics);
  const tradePreprocessorAlert = safeRecord(marketBusTradePreprocessor.alert);
  const tradePreprocessorWindows = safeRecord(tradePreprocessorAnalytics.windows);
  const tradePreprocessorAnalytics24h = Array.isArray(tradePreprocessorWindows.last_24h) ? tradePreprocessorWindows.last_24h as JsonMap[] : [];
  const tradePreprocessorAnalytics7d = Array.isArray(tradePreprocessorWindows.last_7d) ? tradePreprocessorWindows.last_7d as JsonMap[] : [];
  const tradePreprocessorPriceDiscovery24h = safeRecord(tradePreprocessorAnalytics24h.find((row) => String((row as JsonMap).market_regime || "") === "price_discovery"));
  const tradePreprocessorPriceDiscovery7d = safeRecord(tradePreprocessorAnalytics7d.find((row) => String((row as JsonMap).market_regime || "") === "price_discovery"));
  const ohlcvState = classifyFreshness(marketBusOhlcv.freshness_ms);
  const depthState = classifyFreshness(marketBusDepth.freshness_ms);
  const tradesState = classifyFreshness(marketBusTrades.freshness_ms);
  const readinessAlerts = [
    { label: "bars", state: ohlcvState, age: formatFreshness(marketBusOhlcv.freshness_ms) },
    { label: "depth", state: depthState, age: formatFreshness(marketBusDepth.freshness_ms) },
    { label: "trades", state: tradesState, age: formatFreshness(marketBusTrades.freshness_ms) },
  ].filter((item) => item.state !== "fresh");
  const healthwatchState = (healthwatchDashboard?.healthwatch as JsonMap | undefined) || {};
  const chartOfflineCapture = (healthwatchDashboard?.chart_offline_capture as JsonMap | undefined) || {};
  const publicChartVisibility = (healthwatchDashboard?.public_chart_visibility as JsonMap | undefined) || {};
  const publicChartEarly = (publicChartVisibility.early as JsonMap | undefined) || {};
  const publicChartSettled = (publicChartVisibility.settled as JsonMap | undefined) || {};
  const publicSignalAlignment = (chartOfflineCapture.public_signal_alignment as JsonMap | undefined) || {};
  const advisoryReasons = (chartOfflineCapture.advisory_reasons as string[] | undefined) || [];
  const offlineReasons = (chartOfflineCapture.offline_reasons as string[] | undefined) || [];
  const routingEnvelope = safeRecord(marketBusSnapshot?.routing_score || marketBusSnapshot?.routingScore);
  const controlledCollectionState = safeRecord(controlledCollection);
  const controlledCollectionAvailable = Boolean(controlledCollectionState.available);
  const controlledCollectionActive = Boolean(controlledCollectionState.active);
  const controlledCollectionPhase = String(controlledCollectionState.phase || "NO_SESSION");
  const controlledCollectionGateStatus = String(controlledCollectionState.gateStatus || "-");
  const controlledCollectionGateHealth = numberOr(controlledCollectionState.gateHealthScore, 0);
  const controlledCollectionFills = numberOr(controlledCollectionState.fillsSeen, 0);
  const controlledCollectionLabels = numberOr(controlledCollectionState.labelsSeen, 0);
  const controlledCollectionDurationMinutes = numberOr(controlledCollectionState.durationMinutes, 0);
  const controlledCollectionKillRearmed = Boolean(controlledCollectionState.killSwitchRearmed);
  const controlledCollectionKillActive = Boolean(controlledCollectionState.killSwitchActive);
  const controlledCollectionKillReason = String(controlledCollectionState.killSwitchReason || "-");
  const routingCandidates = Array.isArray(routingEnvelope.candidates) ? routingEnvelope.candidates as JsonMap[] : [];
  const bestRoute = safeRecord(routingEnvelope.best || routingCandidates[0]);
  const bestRouteVenue = String(bestRoute.venue || "").trim() || "n/a";
  const bestRouteScore = Math.max(0, numberOr(bestRoute.score, 0));
  const routingReason = String(routingEnvelope.reason || (routingCandidates.length > 0 ? "best_route_candidate" : "missing"));
  const routingSource = String(routingEnvelope.source || "n/a");
  const snapshotTrades = Array.isArray(marketBusSnapshot?.trades) ? marketBusSnapshot?.trades as JsonMap[] : [];
  const depthSnapshot = safeRecord(marketBusSnapshot?.depth_snapshot);
  const depthPayload = safeRecord(depthSnapshot.depth_payload || marketBusSnapshot?.orderbook);
  const tradePreprocessorMode = String(marketBusTradePreprocessor.mode || "n/a");
  const tradePreprocessorRegime = String(marketBusTradePreprocessor.market_regime || "n/a");
  const tradePreprocessorRegimeLabel = regimeOperatorLabel(tradePreprocessorRegime);
  const tradePreprocessorRawCount = Math.max(0, numberOr(marketBusTradePreprocessor.raw_count, 0));
  const tradePreprocessorEmittedCount = Math.max(0, numberOr(marketBusTradePreprocessor.emitted_count, 0));
  const tradePreprocessorCompressionRatio = numberOr(marketBusTradePreprocessor.compression_ratio, NaN);
  const tradePreprocessorSavedPct = numberOr(marketBusTradePreprocessor.compression_saved_pct, NaN);
  const tradePreprocessorWindowMs = Math.max(0, numberOr(marketBusTradePreprocessor.aggregation_window_ms, 0));
  const tradePreprocessorPriceBandBps = numberOr(marketBusTradePreprocessor.price_band_bps, NaN);
  const tradePreprocessorJournalSamples = Math.max(0, numberOr(tradePreprocessorJournalSummary.sample_count, 0));
  const tradePreprocessorJournalRaw = Math.max(0, numberOr(tradePreprocessorJournalSummary.raw_count_total, 0));
  const tradePreprocessorJournalEmitted = Math.max(0, numberOr(tradePreprocessorJournalSummary.emitted_count_total, 0));
  const tradePreprocessorJournalSavedPct = numberOr(tradePreprocessorJournalSummary.compression_saved_pct, NaN);
  const tradePreprocessorAlertState = String(tradePreprocessorAlert.state || "unknown");
  const tradePreprocessorAlertTriggered = Boolean(tradePreprocessorAlert.triggered);
  const tradePreprocessorAlertSummary = String(tradePreprocessorAlert.summary || "No alert state.");
  const tradePreprocessorAnalytics24hSavedPct = numberOr(tradePreprocessorPriceDiscovery24h.compression_saved_pct, NaN);
  const tradePreprocessorAnalytics24hAggressiveBuckets = Math.max(0, numberOr(tradePreprocessorPriceDiscovery24h.aggressive_bucket_count, 0));
  const tradePreprocessorAnalytics7dSavedPct = numberOr(tradePreprocessorPriceDiscovery7d.compression_saved_pct, NaN);
  const tradePreprocessorAnalytics7dAggressiveBuckets = Math.max(0, numberOr(tradePreprocessorPriceDiscovery7d.aggressive_bucket_count, 0));
  const executionDepthLevels = countDepthLevels(depthPayload);
  const busSeq = Math.max(0, numberOr(marketBusOhlcvSeq.latest_seq, 0));
  const busConnected = String(marketBusHealth.status || "") === "ok" && busSeq > 0;
  const executionFlowOk = snapshotTrades.length > 0;
  const executionDepthOk = executionDepthLevels > 0;
  const executionRoutingOk = routingCandidates.length > 0 && bestRouteScore > 0;
  const executionReady = busConnected && executionFlowOk && executionDepthOk && executionRoutingOk;
  const executionStateLabel = executionReady ? "READY" : "DISABLED";
  const executionStateTone = executionReady ? "good" : "bad";
  const marketStateMapCells = marketStateMap?.cells.slice(0, 4) || [];
  const marketStateMapTransitions = marketStateMap?.transitions.slice(0, 4) || [];
  const marketStateMapZones = marketStateMap?.inadmissibleZones.slice(0, 4) || [];
  const marketStateMapSummary = marketStateMap?.summary || null;
  const executionRejectionReasons = [
    !busConnected ? (busSeq <= 0 ? "SEQ_ZERO" : "BUS_OFFLINE") : null,
    !executionFlowOk ? "NO_TRADES" : null,
    !executionDepthOk ? "NO_DEPTH" : null,
    !(routingCandidates.length > 0) ? "NO_CANDIDATES" : null,
    bestRouteScore <= 0 ? "ROUTING_SCORE_ZERO" : null,
  ].filter((value): value is string => Boolean(value));
  const executionBlockingReason = !busConnected
    ? `bus ${String(marketBusHealth.status || "offline").toUpperCase()} seq #${busSeq}`
    : !executionRoutingOk
      ? `routing ${routingCandidates.length} candidate(s) score ${bestRouteScore.toFixed(2)}`
      : !executionFlowOk
        ? "flow empty"
        : !executionDepthOk
          ? "depth empty"
          : "ready";
  return (
    <main className="shell txt-page-shell">
      <section className="hero txt-page-hero-grid" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <div id="global-guide-readiness-hero" className="panel txt-page-hero">
          <div className="eyebrow">Live Readiness Center</div>
          <h1 className="title" style={{ fontSize: 34 }}>Pret pour le live, derive et test memoire</h1>
          <p className="subtle txt-page-hero-copy">Cette page dit si les strategies restent assez propres pour continuer le live ou s'il faut freiner, suspendre et revalider.</p>
          <OperatorPanelGuide
            title="Guide Readiness"
            what="Les signaux qui montrent si les stratégies tiennent encore la route ou commencent à s'écarter."
            why="Éviter d'augmenter le risque alors que la qualité se dégrade déjà."
            example="Si plusieurs stratégies sont stoppées en même temps, réduis l'exposition et cherche ce qui a changé."
          />
          <div className="txt-page-guide-note">
            <strong>Regle d'usage</strong>
            Si plusieurs blocs passent au warn en meme temps, ne cherche pas a optimiser. Coupe le rythme, garde le risque bas et traite d'abord la cause de derive.
          </div>
          <p>
            <Link href="/dashboard">Dashboard</Link>
            {" | "}
            <Link href="/live-readiness/drift-alert-log">Drift Alert Log</Link>
            {" | "}
            <Link href="/live-readiness/edge-map">Edge Map</Link>
            {" | "}
            <Link href="/live-readiness/market-state-map">Market State Map</Link>
            {" | "}
            <Link href="/live-readiness/ui-blue-green">UI Blue/Green</Link>
            {" | "}
            <Link href="/terminal">Trading Terminal</Link>
            {" | "}
            <Link href="/ai">IA</Link>
            {" | "}
            <Link href="/connectors">Connecteurs</Link>
            {" | "}
            <Link href="/incidents">Incidents</Link>
          </p>
          {error ? <p className="warn">{error}</p> : null}
        </div>
        <div className="panel">
          <div className="eyebrow">Etat Global <HelpHint text="Résumé rapide des signaux qui disent si le passage en live peut continuer ou doit attendre." examples={["Si des stratégies sont stoppées, n'ajoute pas plus de risque sans comprendre pourquoi.", "Si l'aide mémoire n'apporte plus grand-chose, garde-le en tête avant d'accélérer."]} /></div>
          <div className="row"><span>Strategies suspendues</span><span className={suspended.length > 0 ? "warn" : "good"}>{String(suspended.length)}</span></div>
          <div className="row"><span>Drift detecte (lignes)</span><span>{String(driftItems.filter((x) => Boolean(x.drift_detected)).length)}</span></div>
          <div className="row"><span>Retrieval avg final sim</span><span>{String(memorySummary.avg_final_similarity || "-")}</span></div>
          <div className="row"><span>Retrieval avg impact</span><span>{String(memorySummary.avg_memory_impact || "-")}</span></div>
          <div className="row"><span>Auto-resume</span><span>{String(autoResume.enabled ?? false)}</span></div>
          <div className="row"><span>Cooldown (h)</span><span>{String(autoResume.cooldown_hours ?? "-")}</span></div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr", marginBottom: 16 }}>
        <div className="panel runtime-decision-dashboard-panel" data-testid="live-readiness-runtime-monitor-panel">
          <RuntimeOperatorMonitoringCard summary={runtimeDecisionSummary} title="Runtime Operator Monitor" />
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr", marginBottom: 16 }}>
        <div className="panel" data-testid="live-readiness-controlled-collection-panel">
          <div className="eyebrow">Controlled Collection Session</div>
          {controlledCollectionAvailable ? (
            <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, marginBottom: 10 }}>
                <span className={`chart-flow-pill tone-${controlledCollectionActive ? "good" : "warn"}`}>SESSION {controlledCollectionActive ? "OPEN" : "CLOSED"}</span>
                <span className={`chart-flow-pill tone-${controlledCollectionGateStatus.toLowerCase() === "go" ? "good" : "warn"}`}>GATE {controlledCollectionGateStatus.toUpperCase()}</span>
                <span className={`chart-flow-pill tone-${controlledCollectionKillActive ? "bad" : "good"}`}>KILL {controlledCollectionKillActive ? "ACTIVE" : "CLEAR"}</span>
                <span className={`chart-flow-pill tone-${controlledCollectionKillRearmed ? "bad" : "neutral"}`}>REARM {controlledCollectionKillRearmed ? "YES" : "NO"}</span>
              </div>
              <div className="row"><span>Phase</span><span>{controlledCollectionPhase}</span></div>
              <div className="row"><span>Baseline</span><span>{String(controlledCollectionState.baselineSince || "-")}</span></div>
              <div className="row"><span>Duration</span><span>{controlledCollectionDurationMinutes.toFixed(2)}m</span></div>
              <div className="row"><span>Fills seen</span><span>{String(controlledCollectionFills)}</span></div>
              <div className="row"><span>Labels seen</span><span>{String(controlledCollectionLabels)}</span></div>
              <div className="row"><span>Gate health</span><span>{controlledCollectionGateHealth > 0 ? controlledCollectionGateHealth.toFixed(2) : "-"}</span></div>
              <div className="row"><span>Kill reason</span><span>{controlledCollectionKillReason}</span></div>
              <div className="row"><span>Last snapshot</span><span>{String(controlledCollectionState.lastSnapshotAt || "-")}</span></div>
            </>
          ) : (
            <p className="subtle">Aucune session de collecte contrôlée observée pour l’instant.</p>
          )}
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1.15fr 0.85fr", marginBottom: 16 }}>
        <div className="panel">
          <div className="eyebrow">Market Data Bus <HelpHint text="Ce bloc dit si le flux marché reste propre pour les graphiques, l'IA et l'exécution." examples={["Si les bougies ou la profondeur ne tiennent plus, considère l'écran comme dégradé.", "Un trou dans la suite des données mérite une vérification même si le flux n'est pas totalement coupé."]} /></div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, marginBottom: 10 }}>
            <span className={`chart-flow-pill tone-${pillTone(String(marketBusHealth.status || "hard-fail") === "ok" ? "ok" : "degraded")}`}>BUS {String(marketBusHealth.status || "offline").toUpperCase()}</span>
            <span className={`chart-flow-pill tone-${pillTone(ohlcvState)}`}>BARS {ohlcvState.toUpperCase()} {formatFreshness(marketBusOhlcv.freshness_ms)}</span>
            <span className={`chart-flow-pill tone-${pillTone(depthState)}`}>DEPTH {depthState.toUpperCase()} {formatFreshness(marketBusDepth.freshness_ms)}</span>
            <span className={`chart-flow-pill tone-${pillTone(tradesState)}`}>TRADES {tradesState.toUpperCase()} {formatFreshness(marketBusTrades.freshness_ms)}</span>
            <span className={`chart-flow-pill tone-${Boolean(marketBusOhlcvSeq.contiguous) ? "good" : "warn"}`}>SEQ {Boolean(marketBusOhlcvSeq.contiguous) ? "OK" : "GAP"} #{String(marketBusOhlcvSeq.latest_seq || "-")}</span>
            <span className="chart-flow-pill tone-neutral">BOOK {String(((marketBusSequencing.depth as JsonMap | undefined) || {}).last_update_id || "-")}</span>
          </div>
          {readinessAlerts.length > 0 ? (
            <div className="warn" style={{ marginBottom: 10 }}>
              Alertes fraicheur: {readinessAlerts.map((item) => `${item.label}:${item.state}@${item.age}`).join(" · ")}
            </div>
          ) : (
            <div className="good" style={{ marginBottom: 10 }}>Bus marche dans les bornes operationnelles.</div>
          )}
          <div className="panel" style={{ borderRadius: 12, padding: 12, marginBottom: 10 }}>
            <div className="row"><span>BARS</span><span>{freshnessMeaning(ohlcvState)}</span></div>
            <div className="row"><span>DEPTH</span><span>{freshnessMeaning(depthState)}</span></div>
            <div className="row"><span>TRADES</span><span>{freshnessMeaning(tradesState)}</span></div>
          </div>
          <div className="row"><span>Instrument de reference</span><span>{String(marketBusSnapshot?.instrument || "BTCUSDT")}</span></div>
          <div className="row"><span>Venue</span><span>{String(marketBusSnapshot?.venue || "binance-public")}</span></div>
          <div className="row"><span>Dernier sync</span><span>{String(marketBusSnapshot?.as_of || "-")}</span></div>
          <div className="row"><span>OHLCV latest seq</span><span>{String(marketBusOhlcvSeq.latest_seq || "-")}</span></div>
          <div className="row"><span>OHLCV contiguous</span><span className={Boolean(marketBusOhlcvSeq.contiguous) ? "good" : "warn"}>{String(Boolean(marketBusOhlcvSeq.contiguous))}</span></div>
        </div>

        <div className="panel">
          <div className="eyebrow">Trades Preprocessor <HelpHint text="Montre explicitement combien de trades bruts sont reduits avant consommation, avec le mode adaptatif retenu et un petit historique compare raw vs emitted." examples={["Si le regime passe en price discovery, attends-toi a moins de compression pour garder plus de verite microstructure.", "Si raw reste eleve mais emitted chute tres fort, verifie que le gain de masse ne masque pas un changement de regime."]} /></div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, marginBottom: 10 }}>
            <span className="chart-flow-pill tone-neutral">MODE {tradePreprocessorMode.replace(/_/g, " ").toUpperCase()}</span>
            <span className="chart-flow-pill tone-neutral">REGIME {tradePreprocessorRegimeLabel.toUpperCase()}</span>
            <span className={`chart-flow-pill tone-${Number.isFinite(tradePreprocessorSavedPct) && tradePreprocessorSavedPct >= 35 ? "good" : Number.isFinite(tradePreprocessorSavedPct) && tradePreprocessorSavedPct >= 15 ? "warn" : "neutral"}`}>SAVE {formatPercent(tradePreprocessorSavedPct)}</span>
            <span className={`chart-flow-pill tone-${tradePreprocessorAlertState === "warn" ? "bad" : tradePreprocessorAlertState === "watch" ? "warn" : "good"}`}>ALERT {tradePreprocessorAlertState.toUpperCase()}</span>
          </div>
          {tradePreprocessorAlertTriggered ? (
            <div className={tradePreprocessorAlertState === "warn" ? "warn" : "subtle"} style={{ marginBottom: 10 }}>
              {tradePreprocessorAlertSummary}
            </div>
          ) : null}
          {tradePreprocessorRawCount > 0 ? (
            <div className="good" style={{ marginBottom: 10 }}>
              Snapshot courant: raw {tradePreprocessorRawCount}{" -> "}emitted {tradePreprocessorEmittedCount} ({formatPercent(tradePreprocessorSavedPct)} sauvegarde, ratio {formatFixed(tradePreprocessorCompressionRatio, 3)}).
            </div>
          ) : (
            <div className="warn" style={{ marginBottom: 10 }}>Aucune metrique de compression disponible sur le snapshot courant.</div>
          )}
          <div className="panel" style={{ borderRadius: 12, padding: 12, marginBottom: 10 }}>
            <div className="row"><span>Lecture regime</span><span>{tradePreprocessorRegimeLabel}</span></div>
            <div className="row"><span>Source des chiffres</span><span>raw = trades recus du bus marche; emitted = trades gardes apres compression adaptive.</span></div>
            <div className="row"><span>Action operateur</span><span>En decouverte de prix, accepter moins de compression; si emitted chute trop fort, verifier que la microstructure n'est pas masquee.</span></div>
          </div>
          <div className="row"><span>Window / band</span><span>{tradePreprocessorWindowMs}ms / {formatFixed(tradePreprocessorPriceBandBps, 3)}bps</span></div>
          <div className="row"><span>Snapshot raw vs emitted</span><span>{tradePreprocessorRawCount} / {tradePreprocessorEmittedCount}</span></div>
          <div className="row"><span>Price discovery 24h</span><span>{formatPercent(tradePreprocessorAnalytics24hSavedPct)} · buckets {tradePreprocessorAnalytics24hAggressiveBuckets}</span></div>
          <div className="row"><span>Price discovery 7d</span><span>{formatPercent(tradePreprocessorAnalytics7dSavedPct)} · buckets {tradePreprocessorAnalytics7dAggressiveBuckets}</span></div>
          <div className="row"><span>Journal samples</span><span>{tradePreprocessorJournalSamples}</span></div>
          <div className="row"><span>Journal raw vs emitted</span><span>{tradePreprocessorJournalRaw} / {tradePreprocessorJournalEmitted}</span></div>
          <div className="row"><span>Journal saved</span><span>{formatPercent(tradePreprocessorJournalSavedPct)}</span></div>
          <div className="txt-scroll-shell compact" style={{ marginTop: 10 }}>
            {tradePreprocessorJournal.length === 0 ? <p className="subtle">Pas encore de buckets persistes.</p> : tradePreprocessorJournal.slice(0, 8).map((row, index) => {
              const item = safeRecord(row);
              const bucket = String(item.sample_bucket || "-");
              const source = String(item.source || "snapshot");
              const regimeLabel = String(item.market_regime || "n/a").replace(/_/g, " ");
              const avgRaw = formatFixed(item.avg_raw_count, 1);
              const avgEmitted = formatFixed(item.avg_emitted_count, 1);
              const saved = formatPercent(item.compression_saved_pct);
              return (
                <div className="row" key={`${bucket}-${source}-${index}`}>
                  <span>{bucket} · {source} · {regimeLabel}</span>
                  <span>{avgRaw}{" -> "}{avgEmitted} ({saved})</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr", marginBottom: 16 }}>
        <TradabilityScienceCard summary={tradabilityAnalytics} testId="live-readiness-tradability-science-panel" />
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr", marginBottom: 16 }}>
        <div className="panel" data-testid="live-readiness-market-state-map-panel">
          <div className="eyebrow">Market State Map <HelpHint text="Carte opérateur des contextes admissibles, fragiles ou interdits, calculée à partir de l'oracle, de la mémoire marché et de l'observation edge." examples={["Si une zone devient inadmissible avec plusieurs transitions, traite-la comme faux contexte exploitable.", "Si les cellules admissibles baissent alors que les anomalies montent, le marché reste visible mais pas forcément exploitable."]} /></div>
          {marketStateMap ? (
            <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, marginBottom: 10 }}>
                <span className="chart-flow-pill tone-good">ADMISSIBLE {marketStateMapSummary?.admissibleCells || 0}</span>
                <span className="chart-flow-pill tone-warn">WATCH {marketStateMapSummary?.watchCells || 0}</span>
                <span className="chart-flow-pill tone-warn">DEGRADED {marketStateMapSummary?.degradedCells || 0}</span>
                <span className="chart-flow-pill tone-bad">INADMISSIBLE {marketStateMapSummary?.inadmissibleCells || 0}</span>
              </div>
              <div className={(marketStateMapZones.length > 0 || (marketStateMapSummary?.inadmissibleCells || 0) > 0) ? "warn" : "good"} style={{ marginBottom: 10 }}>
                {(marketStateMapSummary?.inadmissibleCells || 0) > 0
                  ? `${marketStateMapSummary?.inadmissibleCells || 0} zone(s) actuellement hors admissibilité. Surveiller les régimes les plus instables avant toute hausse d'agressivité.`
                  : "Aucune zone inadmissible active sur la fenêtre courante."}
              </div>
              <div className="row"><span>Scope</span><span>{marketStateMap.scope.symbol} · {marketStateMap.scope.timeframe} · {marketStateMap.scope.venue} · {marketStateMap.scope.windowHours}h</span></div>
              <div className="row"><span>Failure modes</span><span>{(marketStateMapSummary?.dominantFailureModes || []).length > 0 ? marketStateMapSummary?.dominantFailureModes.map((reason) => formatLabel(reason)).join(" · ") : "none"}</span></div>
              <div className="txt-scroll-shell compact" style={{ marginTop: 10 }}>
                {marketStateMapCells.length === 0 ? <p className="subtle">Aucune cellule state map disponible.</p> : marketStateMapCells.map((cell) => (
                  <div className="row" key={`${cell.key.venue}-${cell.key.timeframe}-${cell.key.regime}`}>
                    <span>{cell.key.regime} · {cell.state} · truth {cell.truthQualityPct}%</span>
                    <span>{formatLabel(cell.reasons[0] || "")}</span>
                  </div>
                ))}
              </div>
              <div className="txt-scroll-shell compact" style={{ marginTop: 10 }}>
                {marketStateMapTransitions.length === 0 ? <p className="subtle">Pas de transition récente.</p> : marketStateMapTransitions.map((transition, index) => (
                  <div className="row" key={`${transition.regime}-${transition.detectedAtIso}-${index}`}>
                    <span>{transition.regime} · {formatLabel(transition.transitionType)}</span>
                    <span>{transition.truthQualityDeltaPct}% · {transition.detectedAtIso}</span>
                  </div>
                ))}
              </div>
              <div className="txt-scroll-shell compact" style={{ marginTop: 10 }}>
                {marketStateMapZones.length === 0 ? <p className="subtle">Aucune zone dégradée listée.</p> : marketStateMapZones.map((zone) => (
                  <div className="row" key={zone.zoneKey}>
                    <span>{zone.regime} · {zone.severity.toUpperCase()}</span>
                    <span>{formatLabel(zone.reason)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="subtle">State map indisponible pour l'instant.</p>
          )}
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr", marginBottom: 16 }}>
        <div className="panel">
          <div className="eyebrow">Execution Routing State <HelpHint text="Même verdict opérateur que dans le terminal: si bus, flow, depth ou routing manquent, l'exécution ne doit pas être lue comme disponible." examples={["Si le score de route est à 0, considère l'envoi comme bloqué même si les candles restent visibles.", "Si le bus est ok mais qu'il n'y a ni depth ni trades, le marché n'est pas exécutable proprement."]} /></div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, marginBottom: 10 }}>
            <span className={`chart-flow-pill tone-${busConnected ? "good" : "bad"}`}>BUS {busConnected ? "OK" : "OFFLINE"}</span>
            <span className={`chart-flow-pill tone-${executionFlowOk ? "good" : "bad"}`}>FLOW {executionFlowOk ? "OK" : "EMPTY"}</span>
            <span className={`chart-flow-pill tone-${executionDepthOk ? "good" : "bad"}`}>DEPTH {executionDepthOk ? "OK" : "EMPTY"}</span>
            <span className={`chart-flow-pill tone-${executionRoutingOk ? "good" : "bad"}`}>ROUTING {executionRoutingOk ? `${routingCandidates.length} / ${bestRouteScore.toFixed(0)}` : "0 / 0"}</span>
            <span className={`chart-flow-pill tone-${executionStateTone}`}>EXECUTION {executionStateLabel}</span>
          </div>
          {executionReady ? (
            <div className="good" style={{ marginBottom: 10 }}>Etat d'execution coherent: bus, flow, depth et routing sont alignes.</div>
          ) : (
            <div className="warn" style={{ marginBottom: 10 }}>Execution desactivee: {executionBlockingReason}.</div>
          )}
          <div className="row"><span>Routing source</span><span>{routingSource}</span></div>
          <div className="row"><span>Routing reason</span><span>{routingReason.replace(/_/g, " ")}</span></div>
          <div className="row"><span>Routing candidates</span><span>{String(routingCandidates.length)}</span></div>
          <div className="row"><span>Best route</span><span>{bestRouteVenue} · score {bestRouteScore.toFixed(2)}</span></div>
          <div className="row"><span>Trades snapshot</span><span>{String(snapshotTrades.length)}</span></div>
          <div className="row"><span>Depth levels</span><span>{String(executionDepthLevels)}</span></div>
          <div className="row"><span>Bus seq</span><span>#{String(busSeq || 0)}</span></div>
          <div className="row"><span>Reject reasons</span><span>{executionRejectionReasons.length > 0 ? executionRejectionReasons.join(" · ") : "NONE"}</span></div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 16 }}>
        <div className="panel">
          <div className="eyebrow">Healthwatch Chart Capture <HelpHint text="Montre si la sonde a vu un vrai problème d'écran et si une capture doit être gardée pour analyse." examples={["Un état pending veut dire qu'un souci a été vu mais pas encore confirmé assez souvent.", "Les raisons secondaires donnent du contexte, mais ne suffisent pas toujours à déclencher une capture."]} /></div>
          <div className="row"><span>Healthwatch</span><span className={String(healthwatchState.state || "healthy") === "healthy" ? "good" : "warn"}>{String(healthwatchState.state || "-")}</span></div>
          <div className="row"><span>Capture state</span><span className={String(chartOfflineCapture.state || "healthy") === "captured" ? "warn" : String(chartOfflineCapture.state || "healthy") === "pending" ? "warn" : "good"}>{String(chartOfflineCapture.state || "-")}</span></div>
          <div className="row"><span>Critical runs</span><span>{String(chartOfflineCapture.consecutive_critical_runs || 0)} / {String(chartOfflineCapture.active_threshold || chartOfflineCapture.threshold || 0)}</span></div>
          <div className="row"><span>Threshold reason</span><span>{String(chartOfflineCapture.threshold_reason || "-")}</span></div>
          <div className="row"><span>Offline</span><span className={Boolean(chartOfflineCapture.offline) ? "warn" : "good"}>{String(Boolean(chartOfflineCapture.offline))}</span></div>
          <div className="row"><span>Public OHLCV offline aligned</span><span className={Boolean(publicSignalAlignment.ohlcv_offline_badge) ? "warn" : "good"}>{String(Boolean(publicSignalAlignment.ohlcv_offline_badge))}</span></div>
          <div className="row"><span>Public candles MD hard-fail count</span><span>{String(publicSignalAlignment.public_candles_md_alert_count || 0)}</span></div>
          <div className="row"><span>Offline reasons</span><span>{offlineReasons.length > 0 ? offlineReasons.join(" · ") : "none"}</span></div>
          <div className="row"><span>Advisory reasons</span><span>{advisoryReasons.length > 0 ? advisoryReasons.join(" · ") : "none"}</span></div>
        </div>

        <div className="panel">
          <div className="eyebrow">Public Chart Watchdog <HelpHint text="Résumé du contrôle du graphique public pour vérifier qu'il reste bien visible après stabilisation." examples={["Si les signaux sont bons mais que l'image se vide, il faut relancer l'enquête côté rendu.", "Si les données tiennent et que l'affichage reste stable, le graphique reste utilisable."]} /></div>
          <div className="row"><span>State</span><span className={String(publicChartVisibility.state || "healthy") === "healthy" ? "good" : "warn"}>{String(publicChartVisibility.state || "-")}</span></div>
          <div className="row"><span>Auth status</span><span>{String(publicChartVisibility.auth_status || "-")}</span></div>
          <div className="row"><span>Early BUS / MD</span><span>{String(Boolean(publicChartEarly.busOk))} / {String(Boolean(publicChartEarly.mdOk))}</span></div>
          <div className="row"><span>Settled BUS / MD</span><span>{String(Boolean(publicChartSettled.busOk))} / {String(Boolean(publicChartSettled.mdOk))}</span></div>
          <div className="row"><span>Early candle pixels</span><span>{String(publicChartEarly.candlePixels || 0)}</span></div>
          <div className="row"><span>Settled candle pixels</span><span>{String(publicChartSettled.candlePixels || 0)}</span></div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 16 }}>
        <div className="panel">
          <div className="eyebrow">KPI Memoire <HelpHint text="Ces chiffres disent si la mémoire retrouve encore des cas utiles ou si elle aide moins qu'avant." examples={["Si la proximité moyenne monte, la mémoire retombe sur des situations plus proches.", "Si le taux de réussite des cas retrouvés baisse, l'aide mémoire perd en intérêt."]} /></div>
          <div className="row"><span>Samples</span><span>{String(memorySummary.samples || 0)}</span></div>
          <div className="row"><span>Avg vector similarity</span><span>{String(memorySummary.avg_vector_similarity || "-")}</span></div>
          <div className="row"><span>Avg final similarity</span><span>{String(memorySummary.avg_final_similarity || "-")}</span></div>
          <div className="row"><span>Avg winrate top</span><span>{String(memorySummary.avg_win_rate_top || "-")}</span></div>
        </div>

        <div className="panel">
          <div className="eyebrow">A/B Live Memory <HelpHint text="Compare simplement les résultats avec mémoire activée et mémoire coupée." examples={["Si la version avec mémoire fait mieux, continue à observer avec plus de volume.", "Si l'écart reste fragile, ne prends pas ce résultat pour une vérité définitive."]} /></div>
          <div className="row"><span>Winrate delta (on-off)</span><span>{String(withVsWithout.winrate_delta ?? "-")}</span></div>
          <div className="row"><span>p-value (2-sided)</span><span>{String(withVsWithout.p_value_two_sided ?? "-")}</span></div>
          <div className="row"><span>Significant @95%</span><span>{String(withVsWithout.significant_95 ?? false)}</span></div>
          {abArms.length === 0 ? <p className="subtle">Pas assez d'echantillons A/B.</p> : null}
          <div className="txt-scroll-shell compact">
            {abArms.map((arm) => (
              <div className="row" key={String(arm.arm)}>
                <span>{String(arm.arm)}</span>
                <span>winrate={String(arm.win_rate || "-")} | avg={String(arm.avg_outcome || "-")}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 16 }}>
        <div className="panel">
          <div className="eyebrow">Seuils dérive par régime <HelpHint text="Ici, tu règles à partir de quand TXT doit freiner ou stopper une stratégie pour un contexte de marché donné." examples={["Régime: trend, chop, stress ou price_discovery selon la lecture marché.", "Min samples: 25 à 100 évite de juger une stratégie sur trop peu de cas.", "Min win rate: 0.45 veut dire 45%. Drawdown et perte moyenne sont en USD."]} /></div>
          <p className="subtle" style={{ marginTop: 10 }}>Ces seuils servent de garde-fou runtime. Plus le régime est fragile, plus les limites doivent être strictes avant de laisser une stratégie continuer.</p>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <label className="field-stack"><span>Régime marché</span><input value={regime} onChange={(e) => setRegime(e.target.value)} placeholder="trend, chop, stress" /></label>
            <label className="field-stack"><span>Historique minimum</span><input type="number" value={minSamples} onChange={(e) => setMinSamples(Number(e.target.value || 0))} placeholder="25 à 100 samples" /></label>
            <label className="field-stack"><span>Win rate minimum 0-1</span><input type="number" step="0.01" value={minWinRate} onChange={(e) => setMinWinRate(Number(e.target.value || 0))} placeholder="0.45" /></label>
            <label className="field-stack"><span>Drawdown maximum USD</span><input type="number" step="1" value={maxDrawdown} onChange={(e) => setMaxDrawdown(Number(e.target.value || 0))} placeholder="500" /></label>
            <label className="field-stack"><span>Perte moyenne max USD</span><input type="number" step="1" value={maxAvgLoss} onChange={(e) => setMaxAvgLoss(Number(e.target.value || 0))} placeholder="120" /></label>
            <button type="button" disabled={busy} onClick={() => void saveThreshold()}>{busy ? "Sauvegarde..." : "Sauvegarder seuil"}</button>
          </div>
          <div style={{ marginTop: 12 }}>
            {thresholds.map((row) => (
              <div className="row" key={String(row.regime)}>
                <span>{String(row.regime)}</span>
                <span>historique ≥ {String(row.min_samples)} | win ≥ {String(row.min_win_rate)} | DD ≤ {String(row.max_drawdown_usd ?? "-")} USD</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="eyebrow">Auto-Suspension <HelpHint text="La liste montre les stratégies déjà stoppées automatiquement pour éviter d'aggraver la situation." examples={["Si une stratégie apparaît ici, considère-la comme protégée par défaut.", "Ne la relance que si la cause du problème est comprise et traitée."]} /></div>
          {suspended.length === 0 ? <p className="subtle">Aucune strategie suspendue.</p> : null}
          <div className="txt-scroll-shell compact">
            {suspended.map((row) => (
              <div className="row" key={String(row.strategy_id)}>
                <span>{String(row.strategy_id)} | {String(row.market)}</span>
                <form method="post" action={`/api/strategies/${String(row.strategy_id)}/resume`}>
                  <button type="submit">Resume</button>
                </form>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="panel">
          <div className="eyebrow">Drift Details <HelpHint text="Détail des écarts détectés pour comprendre d'où vient le problème avant de relancer." examples={["Lis la raison affichée pour voir si le souci vient du taux de réussite, de la perte ou du manque d'historique.", "Sers-toi de ce détail pour corriger le cadre plutôt que de relancer au hasard."]} /></div>
          {driftItems.length === 0 ? <p className="subtle">Aucune ligne de drift pour le moment.</p> : null}
          <div className="txt-scroll-shell">
            {driftItems.slice(0, 80).map((row, idx) => (
              <div className="row" key={`${String(row.strategy_id)}-${String(row.regime)}-${idx}`}>
                <span>{String(row.strategy_id)} | {String(row.regime)} | sample={String(row.sample_count)}</span>
                <span className={Boolean(row.drift_detected) ? "warn" : "good"}>
                  drift={String(row.drift_detected)} | win={String(row.win_rate || "-")} | dd={String(row.drawdown_usd || "-")} | {String(row.reason || "")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
