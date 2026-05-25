"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { RuntimeDecisionAnalyticsSummary } from "../../lib/runtimeDecisionAnalytics";

type JsonMap = Record<string, unknown>;

type RegimeCorpusPayload = {
  status?: string;
  summary?: JsonMap;
  cluster_summary?: JsonMap;
  drifted_clusters?: JsonMap[];
  hot_clusters?: JsonMap[];
  anchor?: JsonMap | null;
  navigation?: JsonMap;
};

type Props = {
  scopeLabel: string;
  symbol?: string;
  provider?: string;
  accountId?: string;
  canonicalAccountId?: string;
  compact?: boolean;
};

type GovernanceVerdict = "AUTHORIZED" | "REVIEW" | "BLOCKED";

function asMap(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonMap) : {};
}

function asList(value: unknown): JsonMap[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonMap => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    ordered.push(normalized);
  }
  return ordered;
}

function toneClass(value: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (["good", "ok", "authorized", "approved", "reliable", "calm"].includes(normalized)) {
    return "good";
  }
  if (["review", "watch", "degraded", "drift"].includes(normalized)) {
    return "subtle";
  }
  return "warn";
}

function verdictToneClass(value: GovernanceVerdict): string {
  if (value === "AUTHORIZED") {
    return "good";
  }
  if (value === "REVIEW") {
    return "subtle";
  }
  return "warn";
}

function driftStateLabel(value: string): string {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "CALM") {
    return "calme";
  }
  if (normalized === "WATCH") {
    return "surveillance";
  }
  if (normalized === "DRIFT") {
    return "drift";
  }
  if (normalized === "CRITICAL") {
    return "critique";
  }
  return normalized || "inconnu";
}

function verdictLabel(value: GovernanceVerdict): string {
  if (value === "AUTHORIZED") {
    return "autorisation probable";
  }
  if (value === "REVIEW") {
    return "revue humaine requise";
  }
  return "blocage probable";
}

function pct(value: unknown, digits = 0): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount.toFixed(digits)}%` : "n/a";
}

function score(value: unknown, digits = 0): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(digits) : "n/a";
}

function buildGovernanceVerdict(summary: RuntimeDecisionAnalyticsSummary | null): GovernanceVerdict {
  if (!summary) {
    return "REVIEW";
  }
  if (
    summary.opportunity.guard.blocked
    || summary.reliability.blocked
    || summary.drift.state === "CRITICAL"
  ) {
    return "BLOCKED";
  }
  if (
    summary.drift.state === "DRIFT"
    || summary.drift.state === "WATCH"
    || summary.opportunity.guard.state !== "OK"
    || summary.reliability.state !== "RELIABLE"
  ) {
    return "REVIEW";
  }
  return "AUTHORIZED";
}

function buildBlockedReasons(summary: RuntimeDecisionAnalyticsSummary | null): string[] {
  if (!summary) {
    return ["Analytics runtime indisponibles pour qualifier le verdict."];
  }
  const guardReasons = summary.opportunity.guard.reasons || [];
  const blockingReasons = summary.reliability.blockingReasons || [];
  const driftAlerts = (summary.drift.alerts || []).slice(0, 2).map((alert) => {
    const metric = String(alert.metric || "metric");
    return `${metric} ${pct(alert.currentRate * 100, 1)} vs ${pct(alert.baselineRate * 100, 1)}`;
  });
  const driftFactors = (summary.drift.cause.factors || [])
    .filter((factor) => factor.tone === "warn")
    .slice(0, 2)
    .map((factor) => factor.note || factor.label);
  return uniqueStrings([
    ...guardReasons,
    ...blockingReasons,
    ...driftAlerts,
    ...driftFactors,
    summary.drift.summary,
  ]).slice(0, 4);
}

function buildAuthorizedReasons(summary: RuntimeDecisionAnalyticsSummary | null): string[] {
  if (!summary) {
    return ["Aucun facteur d'autorisation calculable sans analytics runtime."];
  }
  const breakdown = (summary.opportunity.breakdown || [])
    .filter((item) => item.tone === "good")
    .slice(0, 3)
    .map((item) => item.detail || `${item.label} ${pct(item.scorePct, 0)}`);
  const telemetrySummary = summary.opportunity.telemetry?.summary || "";
  return uniqueStrings([
    summary.opportunity.summary,
    summary.opportunity.guard.state === "OK" ? summary.opportunity.guard.summary : null,
    summary.reliability.state === "RELIABLE" ? summary.reliability.summary : null,
    summary.drift.state === "CALM" ? summary.drift.headline : null,
    telemetrySummary,
    ...breakdown,
  ]).slice(0, 4);
}

function buildCertifiedReplayHref(decisionId: string | null): string | null {
  if (!decisionId) {
    return null;
  }
  const params = new URLSearchParams({ decision_id: decisionId });
  return `/live-readiness/certified-replay?${params.toString()}`;
}

function buildRegimeBrowserHref(dominantRegime: string | null, symbol?: string, decisionId?: string | null): string {
  const params = new URLSearchParams();
  if (dominantRegime) {
    params.set("dominant_regime", dominantRegime);
  }
  if (symbol) {
    params.set("symbol", symbol);
  }
  if (decisionId) {
    params.set("decision_id", decisionId);
  }
  const query = params.toString();
  return query ? `/live-readiness/regime-browser?${query}` : "/live-readiness/regime-browser";
}

export default function RuntimeGovernanceSignalCard({
  scopeLabel,
  symbol = "",
  provider = "",
  accountId = "",
  canonicalAccountId = "",
  compact = false,
}: Props) {
  const [summary, setSummary] = useState<RuntimeDecisionAnalyticsSummary | null>(null);
  const [corpus, setCorpus] = useState<RegimeCorpusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load(): Promise<void> {
      try {
        const summaryParams = new URLSearchParams({ sinceDays: "7", limit: "1200" });
        if (symbol.trim()) {
          summaryParams.set("symbol", symbol.trim().toUpperCase());
        }
        const corpusParams = new URLSearchParams({ limit: "12", neighbor_limit: "3" });
        if (symbol.trim()) {
          corpusParams.set("symbol", symbol.trim().toUpperCase());
        }
        const [summaryRes, corpusRes] = await Promise.all([
          fetch(`/api/system/runtime-decision?${summaryParams.toString()}`, { cache: "no-store" }),
          fetch(`/api/system/runtime-replay-regime-corpus?${corpusParams.toString()}`, { cache: "no-store" }),
        ]);
        if (!summaryRes.ok) {
          throw new Error("runtime decision indisponible");
        }
        const nextSummary = await summaryRes.json() as RuntimeDecisionAnalyticsSummary;
        const nextCorpus = corpusRes.ok ? await corpusRes.json() as RegimeCorpusPayload : null;
        if (!active) {
          return;
        }
        setSummary(nextSummary);
        setCorpus(nextCorpus);
        setError(null);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "governance signal indisponible");
      }
    }

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [symbol]);

  const verdict = useMemo(() => buildGovernanceVerdict(summary), [summary]);
  const blockedReasons = useMemo(() => buildBlockedReasons(summary), [summary]);
  const authorizedReasons = useMemo(() => buildAuthorizedReasons(summary), [summary]);
  const clusterSummary = asMap(corpus?.cluster_summary);
  const anchor = asMap(corpus?.anchor);
  const driftedCluster = asMap(asList(corpus?.drifted_clusters)[0]);
  const hotCluster = asMap(asList(corpus?.hot_clusters)[0]);
  const anchorDecisionId = String(anchor.decision_id || asMap(corpus?.navigation).anchor_decision_id || "").trim() || null;
  const dominantRegime = String(
    driftedCluster.dominant_regime
    || hotCluster.dominant_regime
    || "",
  ).trim() || null;
  const certifiedReplayHref = buildCertifiedReplayHref(anchorDecisionId);
  const regimeBrowserHref = buildRegimeBrowserHref(dominantRegime, symbol || undefined, anchorDecisionId);

  return (
    <div className="panel" style={{ borderRadius: 12, marginBottom: 12 }} data-testid="runtime-governance-signal-card">
      <div className="eyebrow">Signal gouvernance runtime</div>
      <div className="row">
        <span>Scope</span>
        <span>{scopeLabel}</span>
      </div>
      {provider || accountId || canonicalAccountId || symbol ? (
        <div className="row">
          <span>Contexte</span>
          <span>
            {uniqueStrings([
              provider ? `provider ${provider}` : null,
              accountId ? `compte ${accountId}` : null,
              canonicalAccountId ? `canonique ${canonicalAccountId}` : null,
              symbol ? `symbole ${symbol.toUpperCase()}` : null,
            ]).join(" · ")}
          </span>
        </div>
      ) : null}
      <div className="row">
        <span>Verdict courant</span>
        <span className={verdictToneClass(verdict)}>{verdictLabel(verdict)}</span>
      </div>
      <div className="row">
        <span>Drift</span>
        <span className={toneClass(summary?.drift.state || "unknown")}>
          {driftStateLabel(summary?.drift.state || "unknown")}
          {summary ? ` · ${pct(summary.drift.scorePct, 0)} score` : ""}
        </span>
      </div>
      <div className="row">
        <span>Headline</span>
        <span>{summary?.drift.headline || error || "Chargement des analytics gouvernance..."}</span>
      </div>
      {summary?.scope.symbol ? (
        <div className="row">
          <span>Filtre analytics</span>
          <span>{uniqueStrings([summary.scope.symbol, summary.scope.strategy, summary.scope.timeframe]).join(" · ")}</span>
        </div>
      ) : null}
      <div className="row">
        <span>Replay corpus</span>
        <span>
          {dominantRegime || "n/a"}
          {clusterSummary.cluster_count ? ` · ${String(clusterSummary.cluster_count)} clusters` : ""}
          {clusterSummary.driftiest_cluster_key ? ` · drift ${String(clusterSummary.driftiest_cluster_key)}` : ""}
        </span>
      </div>
      {!compact ? (
        <>
          <div className="row">
            <span>Bloquerait</span>
            <span>{blockedReasons.join(" · ") || "aucun motif saillant"}</span>
          </div>
          <div className="row">
            <span>Autoriserait</span>
            <span>{authorizedReasons.join(" · ") || "aucun facteur favorable saillant"}</span>
          </div>
          <div className="row">
            <span>Ancre contrefactuelle</span>
            <span>
              {anchorDecisionId || "aucune"}
              {driftedCluster.cluster_key ? ` · cluster ${String(driftedCluster.cluster_key)}` : ""}
              {hotCluster.cluster_key ? ` · hot ${String(hotCluster.cluster_key)}` : ""}
            </span>
          </div>
        </>
      ) : null}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <a href="/live-readiness">Ouvrir Live Readiness</a>
        <a href={regimeBrowserHref}>Ouvrir Regime Browser</a>
        {certifiedReplayHref ? <a href={certifiedReplayHref}>Ouvrir Certified Replay</a> : null}
      </div>
      <p className="subtle" style={{ marginTop: 12, marginBottom: 0 }}>
        Ce bloc indexe le drift runtime global puis rattache un contexte replay certifie pour expliquer ce qui ferait bloquer ou autoriser le passage operateur.
      </p>
    </div>
  );
}