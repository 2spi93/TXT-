import Link from "next/link";

import OperatorPanelGuide from "../../../components/ui/OperatorPanelGuide";
import RuntimeDecisionDriftAlertLog from "../../../components/ui/RuntimeDecisionDriftAlertLog";
import { getRuntimeDecisionAnalytics } from "../../../lib/runtimeDecisionAnalytics";
import { ensureRuntimeDecisionWriterStarted } from "../../../lib/runtimeDecisionWriter";

type SearchParamsInput =
  | Promise<Record<string, string | string[] | undefined>>
  | Record<string, string | string[] | undefined>
  | undefined;

async function resolveSearchParams(searchParams: SearchParamsInput): Promise<Record<string, string | string[] | undefined>> {
  if (!searchParams) {
    return {};
  }
  if (typeof (searchParams as Promise<Record<string, string | string[] | undefined>>).then === "function") {
    return searchParams as Promise<Record<string, string | string[] | undefined>>;
  }
  return searchParams as Record<string, string | string[] | undefined>;
}

function pickString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function pickPositiveInt(value: string | string[] | undefined, fallback: number): number {
  const parsed = Number.parseInt(pickString(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildHref(basePath: string, params: { symbol: string; timeframe: string; strategy: string; sinceDays: number; limit: number }, overrides: Partial<{ symbol: string; timeframe: string; strategy: string; sinceDays: number; limit: number }>): string {
  const next = { ...params, ...overrides };
  const query = new URLSearchParams();
  if (next.symbol) query.set("symbol", next.symbol);
  if (next.timeframe) query.set("timeframe", next.timeframe);
  if (next.strategy) query.set("strategy", next.strategy);
  query.set("sinceDays", String(next.sinceDays));
  query.set("limit", String(next.limit));
  return `${basePath}?${query.toString()}`;
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

export default async function DriftAlertLogPage({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  ensureRuntimeDecisionWriterStarted();

  const resolvedSearchParams = await resolveSearchParams(searchParams);
  const symbol = pickString(resolvedSearchParams.symbol).trim().toUpperCase();
  const timeframe = pickString(resolvedSearchParams.timeframe).trim();
  const strategy = pickString(resolvedSearchParams.strategy).trim();
  const sinceDays = pickPositiveInt(resolvedSearchParams.sinceDays, 7);
  const limit = pickPositiveInt(resolvedSearchParams.limit, 1200);
  const summary = await getRuntimeDecisionAnalytics({ symbol, timeframe, strategy, sinceDays, limit, samples: 4 });

  const baseScope = { symbol, timeframe, strategy, sinceDays, limit };
  const scopeSummary = [symbol || "ALL_SYMBOLS", timeframe || "ALL_TF", strategy || "ALL_STRATEGIES"].join(" · ");

  return (
    <main className="shell txt-page-shell" data-testid="runtime-drift-alert-log-page">
      <section className="hero txt-page-hero-grid" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <div className="panel txt-page-hero">
          <div className="eyebrow">Runtime Drift Alert Log</div>
          <h1 className="title" style={{ fontSize: 34 }}>Journal dedie des derive et alertes runtime</h1>
          <p className="subtle txt-page-hero-copy">Vue lisible pour suivre les bascules `CALM / WATCH / DRIFT / CRITICAL`, l’historique derive heure par heure et la friction live venue-aware.</p>
          <OperatorPanelGuide
            title="Guide Drift Log"
            what="L’evolution des derive runtime et les alertes actives, avec la vraie télémétrie spread/latency des venues."
            why="Distinguer un vrai glissement de comportement d’une simple rareté d’edge ou d’une friction live temporaire."
            example="Si le log passe de WATCH a DRIFT pendant que le live gate devient CONSTRAINED, traite d’abord spread/latency avant toute discussion policy."
          />
          <div className="txt-page-guide-note">
            <strong>Lecture operateur</strong>
            Cette page reste passive. Elle sert a lire la derive et la friction live, pas a calibrer automatiquement quoi que ce soit.
          </div>
          <p>
            <Link href="/dashboard">Dashboard</Link>
            {" | "}
            <Link href="/live-readiness">Live Readiness</Link>
            {" | "}
            <Link href="/terminal">Trading Terminal</Link>
          </p>
        </div>
        <div className="panel">
          <div className="eyebrow">Scope</div>
          <div className={`metric ${summary.drift.state === "CALM" ? "good" : summary.drift.state === "WATCH" ? "warn" : "bad"}`}>{summary.drift.state}</div>
          <div className="row"><span>Selection</span><span>{scopeSummary}</span></div>
          <div className="row"><span>Since</span><span>{sinceDays}d</span></div>
          <div className="row"><span>Rows loaded</span><span>{summary.totals.totalRows}</span></div>
          <div className="row"><span>Drift type</span><span>{driftTypeLabel(summary.drift.type)}</span></div>
          <div className="row"><span>Drift score</span><span>{summary.drift.scorePct}%</span></div>
          <div className="row"><span>Live gate</span><span className={["OPEN", "LIVE"].includes(summary.opportunity.liveState) ? "good" : ["NO_EDGE", "NO_DATA_EMPTY", "UNKNOWN"].includes(summary.opportunity.liveState) ? "subtle" : "warn"}>{summary.opportunity.liveState}</span></div>
          <div className="runtime-drift-log-links">
            <Link href={buildHref("/live-readiness/drift-alert-log", baseScope, { sinceDays: 1, limit: 400 })}>1d</Link>
            <Link href={buildHref("/live-readiness/drift-alert-log", baseScope, { sinceDays: 7, limit: 1200 })}>7d</Link>
            <Link href={buildHref("/live-readiness/drift-alert-log", baseScope, { sinceDays: 14, limit: 2000 })}>14d</Link>
          </div>
        </div>
      </section>

      <RuntimeDecisionDriftAlertLog summary={summary} />
    </main>
  );
}