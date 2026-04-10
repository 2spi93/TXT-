"use client";

import type { ReactNode } from "react";

import HelpHint from "../../components/HelpHint";
import PanelShell from "../../components/ui/PanelShell";

type RiskTimelineFilter = "all" | "compliant" | "miss";

type DomPanelLevel = { side: "bid" | "ask"; price: number; size: number; intensity: number };
type FootprintPanelRow = { low: number; high: number; buyVolume: number; sellVolume: number; delta: number; timeLabel?: string };
type TapePanelPrint = { label: string; price: number; side: "buy" | "sell" | "flat"; volume: number };
type BlotterOutcomeRow = Record<string, unknown>;
type BrokerProviderRow = Record<string, unknown>;
type BrokerBalanceRow = Record<string, unknown>;
type BrokerPositionRow = Record<string, unknown>;
type AlertRow = Record<string, unknown>;
type ExecutionOptimizerLivePayload = Record<string, unknown>;
type VenueTelemetryPayload = Record<string, unknown>;
type IncidentItemRow = {
  item: Record<string, unknown>;
  status: string;
  severityLabel: string;
  slaLabel: string;
};
type GovernanceRow = { label: string; value: string; severity: number };
type DriftItem = Record<string, unknown>;
type MemorySummary = Record<string, unknown>;
type GovernanceSort = "severity" | "label" | "value";
type IncidentSort = "severity" | "status" | "sla";
type RiskHistorySummary = {
  count_ok: number;
  count_miss: number;
  last_block_reason: string;
  ratio_miss_window: number;
};
type RiskPollingStatus = {
  lastRefreshIso: string | null;
  latencyMs: number | null;
  source: "summary" | "history" | null;
};
type RiskTimelineRow = {
  atIso: string;
  symbol: string;
  side: string;
  rr: number;
  compliant: boolean;
  source?: string;
  outcome: string;
};
type OmsLifecycleSummary = {
  pendingApprovals: number;
  routedCount: number;
  acceptedCount: number;
  partialCount: number;
  filledCount: number;
  blockedCount: number;
  avgLatencyMs: number;
  avgSlippageBps: number;
  lastEventIso: string | null;
  agentReadyCount: number;
  agentTotalCount: number;
};
type PortfolioOverlaySummary = {
  accountFreeUsd: number;
  openTradesCount: number;
  grossExposureUsd: number;
  exposureRatioPct: number;
  dailyPnLUsd: number;
  dailyDrawdownPct: number;
  dominantBookLabel: string;
};
type AiBridgeSummary = {
  routeLabel: string;
  routeScore: number;
  v7Label: string;
  v7Tone: "good" | "warn" | "neutral";
  v6Action: string;
  v6ConfidencePct: number;
  v6Regime: string;
  v6PersistenceAvailable: boolean;
  v6PersistenceLabel: string;
  v6PersistenceError: string;
  edgeBps: number;
  v8Execute: boolean;
  v8ProbabilityPct: number;
  brainAction: string;
  brainConfidencePct: number;
  brainRegime: string;
  reasonLabel: string;
};

type ExecutionAiV6PanelPayload = Record<string, unknown>;

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function safeRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function toneClass(value: string, positive: string, warning: string): string {
  const normalized = value.trim().toUpperCase();
  if (positive.split("|").includes(normalized)) {
    return "good";
  }
  if (warning.split("|").includes(normalized)) {
    return "warn";
  }
  return "subtle";
}

function formatCompactUsd(value: unknown): string {
  const amount = safeNumber(value, 0);
  return `${amount.toFixed(Math.abs(amount) >= 100 ? 0 : 2)} USD`;
}

function formatCompactMetricMs(value: unknown): string {
  const numeric = safeNumber(value, -1);
  if (numeric < 0) {
    return "n/a";
  }
  if (numeric < 1000) {
    return `${Math.round(numeric)}ms`;
  }
  if (numeric < 60_000) {
    return `${(numeric / 1000).toFixed(numeric < 10_000 ? 1 : 0)}s`;
  }
  return `${Math.round(numeric / 60_000)}m`;
}

function formatCompactClock(value: unknown, formatClock: (value: string) => string): string {
  const iso = String(value || "").trim();
  return iso ? formatClock(iso) : "--:--:--";
}

function resolveVenueTelemetryTone(input: {
  freshestMs: number;
  avgSlippageBps: number;
  avgFillLatencyMs: number;
  avgFillQualityScore: number;
  stabilityState: string;
  proxyState: string;
}): "good" | "subtle" | "warn" {
  const freshness = Math.max(0, input.freshestMs);
  const stability = input.stabilityState.trim().toLowerCase();
  const proxyState = input.proxyState.trim().toLowerCase();
  if (
    proxyState === "degraded"
    || freshness >= 120_000
    || stability === "critical"
    || (input.avgFillQualityScore > 0 && input.avgFillQualityScore < 60)
  ) {
    return "warn";
  }
  if (
    proxyState === "retry_recovered"
    || freshness >= 20_000
    || input.avgSlippageBps >= 8
    || input.avgFillLatencyMs >= 220
    || stability === "degraded"
    || stability === "watch"
    || (input.avgFillQualityScore > 0 && input.avgFillQualityScore < 78)
  ) {
    return "subtle";
  }

  return "good";
}

function resolveExecutionOptimizerTone(order: Record<string, unknown>): "good" | "subtle" | "warn" {
  const guardReasons = Array.isArray(order.guard_reasons) ? order.guard_reasons.length : 0;
  const lifecycleAction = String(order.lifecycle_action || "keep").trim().toLowerCase();
  const fillScore = safeNumber(order.fill_score, 0);
  const predictedFill = safeNumber(order.predicted_fill_probability, 0);
  const adverseSelectionScore = safeNumber(order.adverse_selection_score, 0);
  if (guardReasons > 0 || Boolean(order.spoof_detected) || Boolean(order.liquidity_trap_detected) || lifecycleAction === "cancel" || adverseSelectionScore >= 0.78) {
    return "warn";
  }
  if (lifecycleAction === "replace" || lifecycleAction === "upgrade_to_market" || Boolean(order.should_move_ahead) || fillScore < 0.65 || predictedFill < 0.65) {
    return "subtle";
  }
  return "good";
}

function buildVenueTelemetryRows(
  marketPayload: VenueTelemetryPayload | null,
  routePayload: VenueTelemetryPayload | null,
): Array<Record<string, unknown>> {
  const marketEnvelope = safeRecord(marketPayload);
  const routeEnvelope = safeRecord(routePayload);
  const marketVenues = safeRows(marketEnvelope.venues);
  const routeVenues = safeRows(routeEnvelope.venues);
  const marketByVenue = new Map<string, Record<string, unknown>>();
  const routeByVenue = new Map<string, Record<string, unknown>>();

  for (const item of marketVenues) {
    const venue = String(item.venue || "unknown").trim();
    if (venue) {
      marketByVenue.set(venue, item);
    }
  }
  for (const item of routeVenues) {
    const venue = String(item.venue || "unknown").trim();
    if (venue) {
      routeByVenue.set(venue, item);
    }
  }

  const allVenues = [...new Set([...marketByVenue.keys(), ...routeByVenue.keys()])];
  const sharedProxyState = [String(routeEnvelope.network_state || ""), String(marketEnvelope.network_state || "")]
    .map((value) => value.trim().toLowerCase())
    .find((value) => value === "degraded")
    || [String(routeEnvelope.network_state || ""), String(marketEnvelope.network_state || "")]
      .map((value) => value.trim().toLowerCase())
      .find((value) => value === "retry_recovered")
    || "healthy";

  const rows = allVenues.map((venue) => {
    const routeRow = safeRecord(routeByVenue.get(venue));
    const routeMarket = safeRecord(routeRow.market);
    const fallbackMarket = safeRecord(marketByVenue.get(venue));
    const marketRow = Object.keys(routeMarket).length > 0 ? routeMarket : fallbackMarket;
    const executionRow = safeRecord(routeRow.execution);
    const stabilityRow = safeRecord(routeRow.stability);
    const profileRow = safeRecord(routeRow.profile);
    const instrumentRows = safeRows(marketRow.instruments);
    const freshestMs = Math.max(
      safeNumber(marketRow.max_quote_freshness_ms, 0),
      safeNumber(marketRow.max_depth_freshness_ms, 0),
      safeNumber(marketRow.max_trade_freshness_ms, 0),
    );
    const avgSlippageBps = safeNumber(executionRow.avg_slippage_bps, 0);
    const avgFillLatencyMs = safeNumber(executionRow.avg_fill_latency_ms, 0);
    const avgFillQualityScore = safeNumber(executionRow.avg_fill_quality_score, 0);
    const stabilityState = String(stabilityRow.state || stabilityRow.stability_state || "nominal");
    const tone = resolveVenueTelemetryTone({
      freshestMs,
      avgSlippageBps,
      avgFillLatencyMs,
      avgFillQualityScore,
      stabilityState,
      proxyState: sharedProxyState,
    });

    return {
      venue,
      tone,
      market: marketRow,
      execution: executionRow,
      stability: stabilityRow,
      profile: profileRow,
      instruments: instrumentRows,
      severity_score:
        freshestMs
        + Math.max(0, avgSlippageBps * 2_000)
        + Math.max(0, avgFillLatencyMs * 20)
        + (avgFillQualityScore > 0 ? Math.max(0, (100 - avgFillQualityScore) * 1_000) : 0)
        + (tone === "warn" ? 250_000 : tone === "subtle" ? 80_000 : 0),
    };
  });

  rows.sort((left, right) => safeNumber(right.severity_score, 0) - safeNumber(left.severity_score, 0) || String(left.venue || "").localeCompare(String(right.venue || "")));
  return rows;
}

function ScrollWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className} style={{ height: "100%", overflow: "auto" }}>{children}</div>;
}

const PANEL_HINTS: Record<string, { text: string; examples: string[] }> = {
  DOM: {
    text: "Le DOM montre la profondeur instantanee: bid/ask, tailles et concentration de liquidite autour du prix.",
    examples: ["Beaucoup d'ask au-dessus peut freiner une montee.", "Une profondeur tres fine signale souvent un environnement plus fragile pour l'execution."],
  },
  Footprint: {
    text: "Le footprint oppose les volumes buy/sell par niveau de prix pour lire l'agression reelle dans la bougie.",
    examples: ["Delta positif fort: aggression acheteuse dominante.", "Delta negatif autour d'un support peut signaler une cassure faible ou un absorbtion."],
  },
  Tape: {
    text: "Le tape liste les derniers prints executes pour lire le rythme et le sens immediat des transactions.",
    examples: ["Une succession de prints buy peut confirmer une acceleration.", "Des prints alternes et petits traduisent souvent un marche hesitant."],
  },
  Heatmap: {
    text: "La heatmap visualise la densite de liquidite par niveau de prix, utile pour reperer murs et zones d'absorption.",
    examples: ["Un mur ask persistant peut bloquer la hausse.", "Une zone bid qui disparait brutalement annonce souvent un trou de liquidite."],
  },
  "Blotter d'exécution": {
    text: "Le blotter recense les executions recentes, leur PnL, leur slippage et leur statut de fin.",
    examples: ["Slip eleve avec PnL faible: execution a retravailler.", "Compare les statuts pour voir si les runs passent ou restent bloques."],
  },
  "Desk Bridge · OMS · Overlay": {
    text: "Resume compact du lifecycle OMS, de l'overlay portefeuille et du pont IA d'execution deja calcules dans le terminal.",
    examples: ["Si les approvals montent mais que les fills stagnent, le lifecycle OMS se tasse avant execution finale.", "Croise edge IA, exposition portefeuille et disponibilite agents avant de laisser le desk pousser en live."],
  },
  "Alertes actives": {
    text: "Bloc des alertes prioritaires: incidents critiques, guardrails, approvals et signaux de degradation.",
    examples: ["Une alerte critique doit etre traitee avant toute nouvelle action live.", "Les alertes repetitives indiquent souvent un flux ou un service degrade."],
  },
  Incidents: {
    text: "Les incidents structurent le suivi operatoire avec statut, severite et SLA.",
    examples: ["SLA breach signale une dette operatoire a traiter vite.", "Un incident ouvert sur connecteurs invalide souvent une lecture trop confiante du desk."],
  },
  Governance: {
    text: "La gouvernance rassemble les signaux de derive, limites et guardrails actifs sur le systeme.",
    examples: ["Trie par severity pour voir ce qui bloque vraiment l'usage live.", "Le filtre texte aide a isoler une strategie, un routeur ou un composant precis."],
  },
  Readiness: {
    text: "La readiness combine drift, suspensions, memoire et incidents pour juger si le systeme est exploitable.",
    examples: ["Beaucoup de drift et des SLA breach = environnement pas pret pour une promotion live.", "Une strategie suspendue ne doit pas etre traitee comme allocable."],
  },
  "Risk Compliance Timeline": {
    text: "Historique de conformite risque: ok/miss, ratio de miss, poll et seuils d'alerte locale.",
    examples: ["Si le ratio miss grimpe, le desk doit ralentir ou couper certaines executions.", "Le hard alert permet de declencher une vigilance locale plus stricte."],
  },
  "H24 Control Room": {
    text: "Salle de controle live: watchdog, gouvernance, memory gate, recovery, audit et warfare core sur un seul panneau.",
    examples: ["Si le watchdog passe en HALT, le bouton rouge doit etre considere comme prioritaire.", "Croiser health score, market state et audit trail avant toute promotion live."],
  },
  "Execution AI V6.1": {
    text: "Observabilite du moteur d'execution V6: persistence DB, guardrails, top actions apprises et episodes recents.",
    examples: ["Si la DB passe en degrade, l'alerte doit etre visible meme sans routing score actif.", "Les top actions et freeze reasons montrent si le moteur apprend encore ou s'est auto-protege."],
  },
  "Venue Telemetry": {
    text: "Rassemble la sante feed et execution par venue: fraicheur quotes/depth/trades, spread, slippage, fill quality et contraintes de route.",
    examples: ["Si la fraicheur depth explose mais le proxy reste healthy, le souci vient du feed venue, pas du control plane.", "Une venue avec fill quality faible et slippage eleve doit etre re-degradee ou reroutee avant live."],
  },
};

function titleWithHelp(title: string, badge?: ReactNode): ReactNode {
  const hint = PANEL_HINTS[title];
  return (
    <>
      {title}
      {hint ? <HelpHint text={hint.text} examples={hint.examples} label="Guide rapide" /> : null}
      {badge ? <> {badge}</> : null}
    </>
  );
}

function MonitoringPanelCard({
  title,
  badge,
  layoutEditMode,
  onDetach,
  children,
}: {
  title: string;
  badge: ReactNode;
  layoutEditMode: boolean;
  onDetach: () => void;
  children: ReactNode;
}) {
  return (
    <div className="monitoring-col">
      <div className="eyebrow monitoring-panel-head" style={{ marginBottom: 6 }}>
        <span className="monitoring-panel-title">{titleWithHelp(title, badge)}</span>
        {layoutEditMode ? <button type="button" className="panel-detach-btn" title="Floating" onClick={onDetach}>⤡</button> : null}
      </div>
      {children}
    </div>
  );
}

export function DomDockPanel({
  depthStreamState,
  activeDomLevels,
}: {
  depthStreamState: string;
  activeDomLevels: DomPanelLevel[];
}) {
  return (
    <ScrollWrap>
      <PanelShell className="panel micro-panel">
        <div className="eyebrow micro-panel-title">{titleWithHelp("DOM", <span className={`micro-stream-badge micro-stream-${depthStreamState}`}>{depthStreamState}</span>)}</div>
        <div className="dom-table-compact">
          <div className="dom-header-row"><span>Side</span><span>Prix</span><span>Taille</span><span>Profondeur</span></div>
          {activeDomLevels.map((level, index) => (
            <div key={`fdom-${index}`} className={`dom-row-compact ${level.side}`}>
              <span className={`dom-side-label ${level.side}`}>{level.side === "ask" ? "A" : "B"}</span>
              <span className="dom-price">{level.price.toFixed(1)}</span>
              <span className="dom-size">{level.size}</span>
              <span className="dom-bar-cell"><span style={{ width: `${Math.min(100, level.intensity * 100)}%` }} /></span>
            </div>
          ))}
        </div>
      </PanelShell>
    </ScrollWrap>
  );
}

export function FootprintDockPanel({ activeFootprintRows }: { activeFootprintRows: FootprintPanelRow[] }) {
  return (
    <ScrollWrap>
      <PanelShell className="panel micro-panel">
        <div className="eyebrow micro-panel-title">{titleWithHelp("Footprint")}</div>
        <div className="footprint-compact">
          <div className="fp-header-row"><span>Niveau</span><span className="good">Buy</span><span className="warn">Sell</span><span>Δ</span></div>
          {activeFootprintRows.map((row, index) => (
            <div key={`ffp-${index}`} className="fp-row-compact">
              <span className="fp-level">{row.timeLabel ? `${row.timeLabel} · ` : ""}{row.high.toFixed(0)}–{row.low.toFixed(0)}</span>
              <span className="good fp-num">{row.buyVolume.toFixed(0)}</span>
              <span className="warn fp-num">{row.sellVolume.toFixed(0)}</span>
              <span className={`fp-num ${row.delta >= 0 ? "good" : "warn"}`}>{row.delta.toFixed(0)}</span>
            </div>
          ))}
        </div>
      </PanelShell>
    </ScrollWrap>
  );
}

export function TapeDockPanel({ activeTape }: { activeTape: TapePanelPrint[] }) {
  return (
    <ScrollWrap>
      <PanelShell className="panel micro-panel">
        <div className="eyebrow micro-panel-title">{titleWithHelp("Tape")}</div>
        <div className="tape-compact">
          {activeTape.map((print, index) => (
            <div key={`ftp-${index}`} className={`tape-row-compact ${print.side}`}>
              <span className="tape-time">{print.label.slice(-8)}</span>
              <span className="tape-price">{print.price.toFixed(1)}</span>
              <span className="tape-vol">{print.volume}</span>
              <span className={`tape-badge ${print.side}`}>{print.side === "buy" ? "B" : print.side === "sell" ? "S" : "–"}</span>
            </div>
          ))}
        </div>
      </PanelShell>
    </ScrollWrap>
  );
}

export function HeatmapDockPanel({
  activeHeatmapLevels,
  sessionLabel,
}: {
  activeHeatmapLevels: DomPanelLevel[];
  sessionLabel: string;
}) {
  return (
    <ScrollWrap>
      <PanelShell className="panel micro-panel">
        <div className="eyebrow micro-panel-title">{titleWithHelp("Heatmap", <span className="subtle mini" style={{ marginLeft: 6 }}>{sessionLabel}</span>)}</div>
        <div className="heatmap-compact">
          {activeHeatmapLevels.map((level, index) => (
            <div key={`fhm-${index}`} className={`hm-row ${level.side}`} style={{ opacity: Math.max(0.2, level.intensity) }}>
              <span className="hm-price">{level.price.toFixed(1)}</span>
              <div className="hm-bar-wrap"><div className={`hm-bar ${level.side}`} style={{ width: `${Math.min(100, level.intensity * 100)}%` }} /></div>
              <span className="hm-size">{level.size}</span>
            </div>
          ))}
        </div>
      </PanelShell>
    </ScrollWrap>
  );
}

export function BlotterDockPanel({
  filteredOutcomes,
  instrumentLabel,
}: {
  filteredOutcomes: BlotterOutcomeRow[];
  instrumentLabel: (item: BlotterOutcomeRow) => string;
}) {
  return (
    <ScrollWrap>
      <PanelShell className="panel term-blotter-panel">
        <div className="eyebrow">{titleWithHelp("Blotter d'exécution")}</div>
        {filteredOutcomes.length === 0 ? <p className="subtle mini" style={{ marginTop: 8 }}>Aucune exécution.</p> : null}
        {filteredOutcomes.length > 0 ? (
          <div className="blotter-scroll">
            <table className="blotter-table" style={{ marginTop: 8 }}>
              <thead><tr><th>Time</th><th>Symbol</th><th>PnL</th><th>Slip</th><th>Status</th></tr></thead>
              <tbody>
                {filteredOutcomes.slice(0, 8).map((item, index) => (
                  <tr key={`fbl-${index}`}>
                    <td>{String(item.created_at || "–").slice(11, 19)}</td>
                    <td>{instrumentLabel(item)}</td>
                    <td className={safeNumber(item.net_result_usd, 0) >= 0 ? "good" : "warn"}>{safeNumber(item.net_result_usd, 0).toFixed(2)}</td>
                    <td>{safeNumber(item.slippage_real_bps, 0).toFixed(1)}bps</td>
                    <td>{String(item.status || "–").slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </PanelShell>
    </ScrollWrap>
  );
}

export function BrokersDockPanel({
  providerRows,
  balances,
  positions,
  instrumentLabel,
  omsLifecycle,
  portfolioOverlay,
  aiBridge,
}: {
  providerRows: BrokerProviderRow[];
  balances: BrokerBalanceRow[];
  positions: BrokerPositionRow[];
  instrumentLabel: (item: BrokerPositionRow) => string;
  omsLifecycle: OmsLifecycleSummary;
  portfolioOverlay: PortfolioOverlaySummary;
  aiBridge: AiBridgeSummary;
}) {
  return (
    <ScrollWrap>
      <PanelShell className="panel term-brokers-panel">
        <div className="eyebrow">{titleWithHelp("Desk Bridge · OMS · Overlay")}</div>
        <div className="brokers-grid">
          <div className="brokers-section">
            <div className="chart-stat-label" style={{ marginBottom: 6 }}>OMS Lifecycle</div>
            <div className="row"><span>Approvals</span><span className={omsLifecycle.pendingApprovals > 0 ? "warn" : "good"}>{omsLifecycle.pendingApprovals}</span></div>
            <div className="row"><span>Routed / ack</span><span>{omsLifecycle.routedCount} / {omsLifecycle.acceptedCount}</span></div>
            <div className="row"><span>Partial / final</span><span>{omsLifecycle.partialCount} / {omsLifecycle.filledCount}</span></div>
            <div className="row"><span>Blocked</span><span className={omsLifecycle.blockedCount > 0 ? "warn" : "good"}>{omsLifecycle.blockedCount}</span></div>
            <div className="row"><span>Latency / slip</span><span>{safeNumber(omsLifecycle.avgLatencyMs, 0).toFixed(0)} ms | {safeNumber(omsLifecycle.avgSlippageBps, 0).toFixed(1)} bps</span></div>
            <div className="row"><span>Agents live</span><span className={omsLifecycle.agentReadyCount >= Math.max(1, omsLifecycle.agentTotalCount) ? "good" : "subtle"}>{omsLifecycle.agentReadyCount}/{omsLifecycle.agentTotalCount}</span></div>
            <div className="subtle mini" style={{ marginTop: 6 }}>last event {omsLifecycle.lastEventIso ? omsLifecycle.lastEventIso.slice(11, 19) : "n/a"}</div>
          </div>
          <div className="brokers-section">
            <div className="chart-stat-label" style={{ marginBottom: 6 }}>Portfolio Overlay</div>
            <div className="row"><span>Free equity</span><span>{formatCompactUsd(portfolioOverlay.accountFreeUsd)}</span></div>
            <div className="row"><span>Open books</span><span>{portfolioOverlay.openTradesCount}</span></div>
            <div className="row"><span>Gross exposure</span><span>{formatCompactUsd(portfolioOverlay.grossExposureUsd)}</span></div>
            <div className="row"><span>Exposure / cash</span><span className={portfolioOverlay.exposureRatioPct >= 100 ? "warn" : portfolioOverlay.exposureRatioPct >= 70 ? "subtle" : "good"}>{portfolioOverlay.exposureRatioPct.toFixed(0)}%</span></div>
            <div className="row"><span>PnL 24h</span><span className={portfolioOverlay.dailyPnLUsd >= 0 ? "good" : "warn"}>{formatCompactUsd(portfolioOverlay.dailyPnLUsd)}</span></div>
            <div className="row"><span>Intraday DD</span><span className={portfolioOverlay.dailyDrawdownPct >= 2 ? "warn" : portfolioOverlay.dailyDrawdownPct >= 1 ? "subtle" : "good"}>{portfolioOverlay.dailyDrawdownPct.toFixed(2)}%</span></div>
            <div className="subtle mini gtix-ellipsis" style={{ marginTop: 6 }}>dominant book {portfolioOverlay.dominantBookLabel}</div>
            {balances.slice(0, 2).map((item) => (
              <div key={String(item.currency || "")} className="balance-row">
                <span className="balance-ccy">{String(item.currency || "–")}</span>
                <span className="balance-val gtix-ellipsis">{String(item.free || "–")}</span>
              </div>
            ))}
          </div>
          <div className="brokers-section">
            <div className="chart-stat-label" style={{ marginBottom: 6 }}>AI Execution Bridge</div>
            <div className="row"><span>V7 gate</span><span className={aiBridge.v7Tone === "good" ? "good" : aiBridge.v7Tone === "warn" ? "warn" : "subtle"}>{aiBridge.v7Label}</span></div>
            <div className="row"><span>V6 policy</span><span className={aiBridge.v6Action === "HOLD" ? "subtle" : "good"}>{aiBridge.v6Action} | {aiBridge.v6ConfidencePct.toFixed(0)}%</span></div>
            <div className="row"><span>V6 regime</span><span>{aiBridge.v6Regime}</span></div>
            <div className="row"><span>V6 DB</span><span className={aiBridge.v6PersistenceAvailable ? "good" : "warn"}>{aiBridge.v6PersistenceLabel}</span></div>
            <div className="row"><span>Route</span><span>{aiBridge.routeLabel} | {aiBridge.routeScore.toFixed(2)}</span></div>
            <div className="row"><span>Final edge</span><span className={aiBridge.edgeBps >= 0 ? "good" : "warn"}>{aiBridge.edgeBps.toFixed(1)} bps</span></div>
            <div className="row"><span>V8 execute</span><span className={aiBridge.v8Execute ? "good" : "subtle"}>{aiBridge.v8Execute ? "yes" : "hold"} | {aiBridge.v8ProbabilityPct.toFixed(0)}%</span></div>
            <div className="row"><span>Brain</span><span>{aiBridge.brainAction} | {aiBridge.brainConfidencePct.toFixed(0)}%</span></div>
            <div className="row"><span>Regime</span><span>{aiBridge.brainRegime}</span></div>
            <div className="subtle mini gtix-ellipsis" style={{ marginTop: 6 }}>{aiBridge.reasonLabel || "No predictor rationale"}</div>
            {!aiBridge.v6PersistenceAvailable && aiBridge.v6PersistenceError ? (
              <div className="warn mini gtix-ellipsis" style={{ marginTop: 4 }}>{aiBridge.v6PersistenceError}</div>
            ) : null}
            {providerRows.slice(0, 3).map((item, index) => (
              <div key={`fbr-ag-${index}`} className="agent-row">
                <span className="agent-name gtix-ellipsis">{String(item.route || "–").slice(0, 14)}</span>
                <span className={Boolean(item.available) ? "good mini" : "warn mini"}>{Boolean(item.available) ? "●" : "○"}</span>
              </div>
            ))}
            {positions.slice(0, 2).map((item) => (
              <div key={instrumentLabel(item)} className="pos-row">
                <span className="pos-sym gtix-ellipsis">{instrumentLabel(item).slice(0, 10)}</span>
                <span className="balance-val">{safeNumber(item.net_notional_usd, 0).toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
      </PanelShell>
    </ScrollWrap>
  );
}

export function AlertsDockPanel({ filteredAlerts }: { filteredAlerts: AlertRow[] }) {
  return (
    <div className="monitoring-col" style={{ height: "100%", overflow: "auto" }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{titleWithHelp("Alertes actives")}</div>
      {filteredAlerts.length === 0 ? <p className="subtle mini">Aucune alerte.</p> : null}
      {filteredAlerts.slice(0, 10).map((item, index) => (
        <div key={`fal-${index}`} className="mon-row">
          <span className={String(item.level) === "critical" ? "warn" : ""}>{String(item.type || "–")}</span>
          <span className="subtle mini">{String(item.message || "").slice(0, 48)}</span>
        </div>
      ))}
    </div>
  );
}

export function IncidentsDockPanel({ incidentRows }: { incidentRows: IncidentItemRow[] }) {
  return (
    <div className="monitoring-col" style={{ height: "100%", overflow: "auto" }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{titleWithHelp("Incidents")}</div>
      {incidentRows.length === 0 ? <p className="subtle mini">Aucun incident.</p> : null}
      {incidentRows.map(({ item, status, severityLabel, slaLabel }) => (
        <div key={String(item.ticket_key || "")} className="mon-row incident-row">
          <span>{String(item.ticket_key || "–")}</span>
          <span className="subtle mini">{String(item.title || "–").slice(0, 28)}</span>
          <span className="incident-meta-strip">
            <span className={`incident-chip incident-chip-status-${status.toLowerCase()}`}>{status}</span>
            <span className={`incident-chip incident-chip-severity-${severityLabel}`}>{severityLabel}</span>
            <span className={`incident-chip ${slaLabel === "breach" ? "incident-chip-sla-breach" : "incident-chip-sla-ok"}`}>sla {slaLabel}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function GovernanceDockPanel({ governanceFiltered }: { governanceFiltered: GovernanceRow[] }) {
  return (
    <div className="monitoring-col" style={{ height: "100%", overflow: "auto" }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{titleWithHelp("Governance")}</div>
      {governanceFiltered.slice(0, 12).map((row) => (
        <div key={row.label} className="mon-row">
          <span>{row.label}</span>
          <span className={row.severity >= 3 ? "warn" : row.severity >= 2 ? "subtle" : "good"}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ReadinessDockPanel({
  driftItems,
  suspendedCount,
  memorySummary,
  incidents,
}: {
  driftItems: DriftItem[];
  suspendedCount: number;
  memorySummary: MemorySummary;
  incidents: Array<Record<string, unknown>>;
}) {
  return (
    <div className="monitoring-col" style={{ height: "100%", overflow: "auto" }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{titleWithHelp("Readiness")}</div>
      <div className="mon-row"><span>Drift détecté</span><span>{driftItems.filter((item) => Boolean(item.drift_detected)).length}</span></div>
      <div className="mon-row"><span>Suspendues</span><span className={suspendedCount > 0 ? "warn" : "good"}>{suspendedCount}</span></div>
      <div className="mon-row"><span>Similarity</span><span>{String(memorySummary.avg_final_similarity || "–")}</span></div>
      <div className="mon-row"><span>Memory impact</span><span>{String(memorySummary.avg_memory_impact || "–")}</span></div>
      <div className="mon-row"><span>SLA breach</span><span className={incidents.some((item) => Boolean(item.sla_breached)) ? "warn" : "good"}>{incidents.filter((item) => Boolean(item.sla_breached)).length}</span></div>
    </div>
  );
}

export function RiskTimelineBody({
  hardAlertLocal,
  riskTimelineFilter,
  onSetRiskTimelineFilter,
  riskSummary,
  thresholdAtLimit,
  pollingStale,
  riskPollingStatus,
  riskPollAgeSec,
  riskTimelineFrom,
  onRiskTimelineFromChange,
  riskTimelineTo,
  onRiskTimelineToChange,
  riskAlertWindow,
  onRiskAlertWindowChange,
  riskAlertMissThreshold,
  onRiskAlertMissThresholdChange,
  riskTimelineRefreshSec,
  onRiskTimelineRefreshSecChange,
  riskHardAlertEnabled,
  onRiskHardAlertEnabledChange,
  riskHardAlertThresholdPct,
  onRiskHardAlertThresholdPctChange,
  onExportRiskHistoryJson,
  onExportRiskHistoryCsv,
  onExportComplianceZip,
  onResetWorkspaceRiskAlert,
  presetLabel,
  riskTimelineRows,
  rowLimit,
  keyPrefix,
  formatClock,
}: {
  hardAlertLocal: boolean;
  riskTimelineFilter: RiskTimelineFilter;
  onSetRiskTimelineFilter: (filter: RiskTimelineFilter) => void;
  riskSummary: RiskHistorySummary | null;
  thresholdAtLimit: boolean;
  pollingStale: boolean;
  riskPollingStatus: RiskPollingStatus;
  riskPollAgeSec: number;
  riskTimelineFrom: string;
  onRiskTimelineFromChange: (value: string) => void;
  riskTimelineTo: string;
  onRiskTimelineToChange: (value: string) => void;
  riskAlertWindow: number;
  onRiskAlertWindowChange: (value: number) => void;
  riskAlertMissThreshold: number;
  onRiskAlertMissThresholdChange: (value: number) => void;
  riskTimelineRefreshSec: 5 | 15 | 30;
  onRiskTimelineRefreshSecChange: (value: 5 | 15 | 30) => void;
  riskHardAlertEnabled: boolean;
  onRiskHardAlertEnabledChange: (enabled: boolean) => void;
  riskHardAlertThresholdPct: number;
  onRiskHardAlertThresholdPctChange: (value: number) => void;
  onExportRiskHistoryJson: () => void;
  onExportRiskHistoryCsv: () => void;
  onExportComplianceZip: () => void;
  onResetWorkspaceRiskAlert: () => void;
  presetLabel: string;
  riskTimelineRows: RiskTimelineRow[];
  rowLimit: number;
  keyPrefix: string;
  formatClock: (value: string) => string;
}) {
  return (
    <>
      {hardAlertLocal ? <div className="hard-alert-inline">Hard alert actif dans ce panel</div> : null}
      <div className="risk-timeline-toolbar">
        <button type="button" className={`chart-chip ${riskTimelineFilter === "all" ? "active" : ""}`} onClick={() => onSetRiskTimelineFilter("all")}>all</button>
        <button type="button" className={`chart-chip ${riskTimelineFilter === "compliant" ? "active" : ""}`} onClick={() => onSetRiskTimelineFilter("compliant")}>ok</button>
        <button type="button" className={`chart-chip ${riskTimelineFilter === "miss" ? "active" : ""}`} onClick={() => onSetRiskTimelineFilter("miss")}>miss</button>
      </div>
      <div className="risk-summary-kpis">
        <span className="kpi">ok {riskSummary?.count_ok ?? 0}</span>
        <span className={`kpi ${(riskSummary?.count_miss || 0) > 0 ? "warn" : ""}`}>miss {riskSummary?.count_miss ?? 0}</span>
        <span className="kpi gtix-ellipsis">reason {riskSummary?.last_block_reason || "none"}</span>
        <span className={`kpi ${thresholdAtLimit ? "warn" : ""}`}>ratio {(safeNumber(riskSummary?.ratio_miss_window, 0) * 100).toFixed(0)}%</span>
        <span className={`kpi gtix-ellipsis ${pollingStale ? "warn" : ""}`}>poll {riskPollingStatus.lastRefreshIso ? `${formatClock(riskPollingStatus.lastRefreshIso)} · ${Math.max(0, Math.round(safeNumber(riskPollingStatus.latencyMs, 0)))}ms · ${riskPollingStatus.source || "-"} · ${riskPollAgeSec}s` : "pending"}</span>
      </div>
      <div className="risk-timeline-controls">
        <label className="risk-control-field"><span>From</span><input type="datetime-local" value={riskTimelineFrom} onChange={(event) => onRiskTimelineFromChange(event.target.value)} /></label>
        <label className="risk-control-field"><span>To</span><input type="datetime-local" value={riskTimelineTo} onChange={(event) => onRiskTimelineToChange(event.target.value)} /></label>
        <label className="risk-control-field"><span>Window</span><input type="number" min={3} max={100} value={riskAlertWindow} onChange={(event) => onRiskAlertWindowChange(Number(event.target.value) || riskAlertWindow)} /></label>
        <label className={`risk-control-field ${thresholdAtLimit ? "risk-threshold-guard" : ""}`}><span>Threshold</span><input type="number" min={1} max={riskAlertWindow} value={riskAlertMissThreshold} onChange={(event) => onRiskAlertMissThresholdChange(Number(event.target.value) || riskAlertMissThreshold)} /></label>
        <label className="risk-control-field"><span>Refresh</span><select value={String(riskTimelineRefreshSec)} onChange={(event) => {
          const nextValue = Number(event.target.value);
          onRiskTimelineRefreshSecChange(nextValue === 5 || nextValue === 30 ? nextValue : 15);
        }}>
          <option value="5">5s</option>
          <option value="15">15s</option>
          <option value="30">30s</option>
        </select></label>
        <label className="risk-control-field"><span>Hard alert</span><select value={riskHardAlertEnabled ? "on" : "off"} onChange={(event) => {
          onRiskHardAlertEnabledChange(event.target.value === "on");
        }}>
          <option value="off">off</option>
          <option value="on">on</option>
        </select></label>
        <label className="risk-control-field"><span>Hard %</span><input type="number" min={20} max={95} value={Math.round(riskHardAlertThresholdPct)} onChange={(event) => onRiskHardAlertThresholdPctChange(Number(event.target.value) || riskHardAlertThresholdPct)} /></label>
        <button type="button" className="chart-chip" onClick={onExportRiskHistoryJson}>export json</button>
        <button type="button" className="chart-chip" onClick={onExportRiskHistoryCsv}>export csv</button>
        <button type="button" className="chart-chip" onClick={onExportComplianceZip}>export zip</button>
        <button type="button" className="chart-chip" onClick={onResetWorkspaceRiskAlert}>reset</button>
      </div>
      {pollingStale ? <p className="subtle mini warn">Polling stale: plus de 2 cycles sans succes.</p> : null}
      {thresholdAtLimit ? <p className="subtle mini warn">Guardrail: threshold a atteint la fenetre (alerte au moindre miss).</p> : null}
      <p className="subtle mini">preset actif: {presetLabel}</p>
      {riskTimelineRows.length === 0 ? <p className="subtle mini">Aucun event risque.</p> : null}
      {riskTimelineRows.slice(0, rowLimit).map((entry, index) => (
        <div key={`${keyPrefix}-${index}-${entry.atIso}`} className="risk-timeline-row">
          <span>{formatClock(entry.atIso)}</span>
          <span className="gtix-ellipsis">{entry.symbol}</span>
          <span>{entry.side.toUpperCase()}</span>
          <span>RR {entry.rr.toFixed(2)}</span>
          <span className={entry.compliant ? "good" : "warn"}>{entry.compliant ? "ok" : "miss"}</span>
          <span className="subtle mini">{entry.source || "local"}</span>
          <span className="subtle mini">{entry.outcome === "confirmation-required" ? "confirm" : entry.outcome}</span>
        </div>
      ))}
    </>
  );
}

export function AlertsMonitoringPanel({
  badge,
  layoutEditMode,
  onDetach,
  filteredAlerts,
}: {
  badge: ReactNode;
  layoutEditMode: boolean;
  onDetach: () => void;
  filteredAlerts: AlertRow[];
}) {
  return (
    <MonitoringPanelCard title="Alertes actives" badge={badge} layoutEditMode={layoutEditMode} onDetach={onDetach}>
      {filteredAlerts.length === 0 ? <p className="subtle mini">Aucune alerte.</p> : null}
      {filteredAlerts.slice(0, 5).map((item, index) => (
        <div key={`al-${index}`} className="mon-row">
          <span className={String(item.level) === "critical" ? "warn" : ""}>{String(item.type || "–")}</span>
          <span className="subtle mini">{String(item.message || "").slice(0, 38)}</span>
        </div>
      ))}
    </MonitoringPanelCard>
  );
}

export function ControlRoomMonitoringPanel({
  badge,
  layoutEditMode,
  onDetach,
  liveOpsPayload,
  executionAiV6Payload,
  emergencyStopBusy,
  emergencyStopFeedback,
  onEmergencyStop,
  formatClock,
}: {
  badge: ReactNode;
  layoutEditMode: boolean;
  onDetach: () => void;
  liveOpsPayload: Record<string, unknown> | null;
  executionAiV6Payload?: ExecutionAiV6PanelPayload | null;
  emergencyStopBusy: boolean;
  emergencyStopFeedback: string | null;
  onEmergencyStop: () => void;
  formatClock: (value: string) => string;
}) {
  const snapshot = safeRecord(liveOpsPayload);
  const watchdog = safeRecord(snapshot.watchdog_state);
  const governance = safeRecord(snapshot.governance);
  const recovery = safeRecord(snapshot.recovery);
  const risk = safeRecord(snapshot.risk_snapshot);
  const memoryGap = safeRecord(snapshot.memory_gap);
  const warfare = safeRecord(snapshot.warfare_core);
  const arbitrage = safeRecord(warfare.arbitrage);
  const smartMoney = safeRecord(warfare.smart_money);
  const spoof = safeRecord(warfare.spoof);
  const marketState = safeRecord(warfare.market_state);
  const domination = safeRecord(warfare.domination);
  const auditTrail = safeRows(snapshot.audit_trail).slice(0, 3);
  const riskTimeline = safeRows(snapshot.risk_timeline).slice(0, 3);
  const exposureRows = safeRows(risk.exposure_by_symbol).slice(0, 3);
  const venueRankings = safeRows(arbitrage.rankings).slice(0, 4);
  const executionAiV6Envelope = safeRecord(executionAiV6Payload);
  const executionAiV6Snapshot = safeRecord(executionAiV6Envelope.snapshot);
  const executionAiV6Guardrails = safeRecord(executionAiV6Snapshot.guardrails);
  const watchdogTriggers = Array.isArray(watchdog.triggers) ? watchdog.triggers.map((item) => String(item)).filter(Boolean).slice(0, 4) : [];
  const executionAiV6FreezeReasons = Array.isArray(executionAiV6Guardrails.freeze_reasons)
    ? executionAiV6Guardrails.freeze_reasons.map((item) => String(item)).filter(Boolean).slice(0, 3)
    : [];
  const healthScore = safeNumber(watchdog.health_score, 0);
  const watchdogStatus = String(watchdog.status || "UNKNOWN");
  const systemMode = String(governance.mode || "SAFE");
  const recoveryMode = String(recovery.mode || "NOMINAL");
  const memoryDecision = String(memoryGap.memory_decision || "OK");
  const dominationState = String(domination.state || "WEAK");
  const marketStateLabel = String(marketState.state || "CHOP");
  const arbitrageExecutable = Boolean(arbitrage.executable);
  const arbitrageEdge = safeNumber(arbitrage.netEdgeBps, 0);
  const executableDepthUsd = safeNumber(arbitrage.maxExecutableUsd, 0);
  const executionAiV6PersistenceAvailable = typeof executionAiV6Guardrails.persistence_available === "boolean"
    ? Boolean(executionAiV6Guardrails.persistence_available)
    : true;

  return (
    <MonitoringPanelCard title="H24 Control Room" badge={badge} layoutEditMode={layoutEditMode} onDetach={onDetach}>
      {!liveOpsPayload ? <p className="subtle mini">Control room indisponible.</p> : null}
      {liveOpsPayload ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(15, 23, 42, 0.24)" }}>
              <div className="subtle mini">Health score</div>
              <div className={healthScore >= 80 ? "good" : healthScore >= 60 ? "subtle" : "warn"} style={{ fontSize: 18, fontWeight: 700 }}>{healthScore.toFixed(0)}%</div>
              <div className={`subtle mini ${toneClass(watchdogStatus, "OK", "HALT|WARNING")}`}>watchdog {watchdogStatus}</div>
            </div>
            <div style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(15, 23, 42, 0.24)" }}>
              <div className="subtle mini">System lock</div>
              <div className={toneClass(systemMode, "LIVE", "LOCKED")} style={{ fontSize: 18, fontWeight: 700 }}>{systemMode}</div>
              <div className="subtle mini">{String(governance.backend_mode || "guarded_auto")} · {recoveryMode}</div>
            </div>
          </div>
          <div className="mon-row"><span>Memory gate</span><span className={toneClass(memoryDecision, "OK", "BLOCKED|WATCH")}>{memoryDecision}</span></div>
          <div className="mon-row"><span>Drawdown</span><span className={safeNumber(risk.dd_pct, 0) >= 2 ? "warn" : safeNumber(risk.dd_pct, 0) >= 1 ? "subtle" : "good"}>{safeNumber(risk.dd_pct, 0).toFixed(2)}% · {formatCompactUsd(risk.dd_usd)}</span></div>
          <div className="mon-row"><span>Slippage / day use</span><span>{safeNumber(risk.avg_slippage_bps, 0).toFixed(2)}bps · {formatCompactUsd(risk.daily_used_usd)}</span></div>
          <div className="mon-row"><span>Market state</span><span className={toneClass(marketStateLabel, "TREND", "TRAP|HIGH_VOL|DEAD")}>{marketStateLabel} · {(safeNumber(marketState.confidence, 0) * 100).toFixed(0)}%</span></div>
          <div className="mon-row"><span>Warfare</span><span>{String(smartMoney.state || "INACTIVE")} / {String(spoof.state || "CLEAR")} / {dominationState}</span></div>
          <div className="mon-row"><span>Execution AI V6</span><span className={executionAiV6PersistenceAvailable ? "good" : "warn"}>{executionAiV6PersistenceAvailable ? "DB online" : "DB degraded"}</span></div>
          <div className="mon-row"><span>V6 guardrails</span><span className={Boolean(executionAiV6Guardrails.learning_frozen) ? "warn" : "good"}>{Boolean(executionAiV6Guardrails.learning_frozen) ? "frozen" : "active"} · {safeNumber(executionAiV6Snapshot.context_count, 0).toFixed(0)} ctx</span></div>
          <div className="mon-row"><span>Arbitrage</span><span className={arbitrageExecutable && arbitrageEdge > 0 ? "good" : "subtle"}>{arbitrageExecutable ? `${String(arbitrage.buyVenue || "buy")} → ${String(arbitrage.sellVenue || "sell")} · +${arbitrageEdge.toFixed(2)}bps` : "standby"}</span></div>
          <div className="mon-row"><span>Executable depth</span><span className={executableDepthUsd > 0 ? "good" : "subtle"}>{formatCompactUsd(executableDepthUsd)}</span></div>
          {watchdogTriggers.length > 0 ? <div className="subtle mini" style={{ marginTop: 6 }}>Triggers: {watchdogTriggers.join(" · ")}</div> : null}
          {executionAiV6FreezeReasons.length > 0 ? <div className="subtle mini warn" style={{ marginTop: 6 }}>V6 freeze: {executionAiV6FreezeReasons.join(" · ")}</div> : null}
          {!executionAiV6PersistenceAvailable && String(executionAiV6Guardrails.last_persist_error || "") ? <div className="subtle mini warn" style={{ marginTop: 4 }}>V6 DB: {String(executionAiV6Guardrails.last_persist_error || "")}</div> : null}
          <div style={{ display: "flex", gap: 8, marginTop: 10, marginBottom: 8 }}>
            <button type="button" className="chart-chip" onClick={onEmergencyStop} disabled={emergencyStopBusy} style={{ color: "#ffd5d5", borderColor: "rgba(248, 113, 113, 0.5)" }}>
              {emergencyStopBusy ? "Emergency stop..." : "Emergency stop"}
            </button>
            <span className="subtle mini" style={{ alignSelf: "center" }}>
              {String(recovery.active) === "true" ? "Recovery active" : "Recovery nominal"}
            </span>
          </div>
          {emergencyStopFeedback ? <p className="subtle mini" style={{ marginTop: 0 }}>{emergencyStopFeedback}</p> : null}
          <div style={{ marginTop: 10 }}>
            <div className="subtle mini" style={{ marginBottom: 4 }}>Venue ladder</div>
            {venueRankings.length === 0 ? <p className="subtle mini">Aucune venue classee.</p> : null}
            {venueRankings.map((row, index) => (
              <div key={`ops-venue-${index}`} className="mon-row">
                <span>{String(row.venue || "venue").slice(0, 10)}</span>
                <span className="subtle mini">{safeNumber(row.totalCostBps, 0).toFixed(2)}bps · {safeNumber(row.latencyMs, 0).toFixed(0)}ms</span>
                <span className={Boolean(row.executable) ? "good" : "warn"}>{safeNumber(row.availableDepthUsd, 0).toFixed(0)} USD</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="subtle mini" style={{ marginBottom: 4 }}>Exposure concentration</div>
            {exposureRows.length === 0 ? <p className="subtle mini">Aucune exposition recente.</p> : null}
            {exposureRows.map((row, index) => (
              <div key={`ops-exposure-${index}`} className="mon-row">
                <span>{String(row.symbol || "BOOK").slice(0, 10)}</span>
                <span className="subtle mini">notional proxy</span>
                <span>{formatCompactUsd(row.notionalUsd)}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="subtle mini" style={{ marginBottom: 4 }}>Audit trail</div>
            {auditTrail.length === 0 ? <p className="subtle mini">Aucun audit recent.</p> : null}
            {auditTrail.map((row, index) => (
              <div key={`ops-audit-${index}`} className="mon-row">
                <span>{String(row.at) ? formatClock(String(row.at)) : "--:--:--"}</span>
                <span className="subtle mini">{String(row.route || row.decision || "n/a").slice(0, 20)}</span>
                <span className={String(row.result || "").includes("BLOCK") ? "warn" : "good"}>{String(row.result || "OK").slice(0, 10)}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="subtle mini" style={{ marginBottom: 4 }}>Risk timeline</div>
            {riskTimeline.length === 0 ? <p className="subtle mini">Aucun point risque recent.</p> : null}
            {riskTimeline.map((row, index) => (
              <div key={`ops-risk-${index}`} className="mon-row">
                <span>{String(row.at) ? formatClock(String(row.at)) : "--:--:--"}</span>
                <span className="subtle mini">{String(row.exposure_symbol || "BOOK").slice(0, 10)}</span>
                <span className={safeNumber(row.dd_pct, 0) >= 2 ? "warn" : "subtle"}>{safeNumber(row.dd_pct, 0).toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </MonitoringPanelCard>
  );
}

export function ExecutionAiV6ObservabilityPanel({
  badge,
  layoutEditMode,
  onDetach,
  payload,
  formatClock,
}: {
  badge: ReactNode;
  layoutEditMode: boolean;
  onDetach: () => void;
  payload: ExecutionAiV6PanelPayload | null;
  formatClock: (value: string) => string;
}) {
  const envelope = safeRecord(payload);
  const snapshot = safeRecord(envelope.snapshot);
  const guardrails = safeRecord(snapshot.guardrails);
  const topActions = safeRows(snapshot.top_actions).slice(0, 5);
  const recentEpisodes = safeRows(snapshot.recent_episodes).slice(0, 6);
  const freezeReasons = Array.isArray(guardrails.freeze_reasons)
    ? guardrails.freeze_reasons.map((item) => String(item)).filter(Boolean).slice(0, 4)
    : [];
  const persistenceAvailable = typeof guardrails.persistence_available === "boolean"
    ? Boolean(guardrails.persistence_available)
    : true;

  return (
    <MonitoringPanelCard title="Execution AI V6.1" badge={badge} layoutEditMode={layoutEditMode} onDetach={onDetach}>
      {!payload ? <p className="subtle mini">Observabilite V6 indisponible.</p> : null}
      {payload ? (
        <>
          <div className="venue-telemetry-summary">
            <span className={`venue-telemetry-pill ${persistenceAvailable ? "" : "warn"}`}>{persistenceAvailable ? "db online" : "db degraded"}</span>
            <span className="venue-telemetry-pill">ctx {safeNumber(snapshot.context_count, 0).toFixed(0)}</span>
            <span className="venue-telemetry-pill">ema {safeNumber(guardrails.reward_ema, 0).toFixed(2)}</span>
            <span className="venue-telemetry-pill">dd {safeNumber(guardrails.reward_drawdown, 0).toFixed(2)}</span>
          </div>
          <div className="optimizer-live-grid">
            <div className={`venue-telemetry-item ${persistenceAvailable ? "subtle" : "warn"}`}>
              <div className="venue-telemetry-head">
                <span className="venue-telemetry-venue">Persistence</span>
                <span className={`venue-telemetry-state ${persistenceAvailable ? "subtle" : "warn"}`}>{persistenceAvailable ? "online" : "degraded"}</span>
              </div>
              <div className="mon-row"><span>Loaded</span><span>{Boolean(guardrails.loaded) ? formatCompactClock(guardrails.loaded_at, formatClock) : "cold"}</span></div>
              <div className="mon-row"><span>Vol / streak</span><span>{safeNumber(guardrails.reward_volatility, 0).toFixed(2)} · {safeNumber(guardrails.negative_streak, 0).toFixed(0)} neg</span></div>
              {!persistenceAvailable && String(guardrails.last_persist_error || "") ? <div className="warn mini gtix-ellipsis">{String(guardrails.last_persist_error || "")}</div> : null}
            </div>
            <div className={`venue-telemetry-item ${Boolean(guardrails.learning_frozen) ? "warn" : "good"}`}>
              <div className="venue-telemetry-head">
                <span className="venue-telemetry-venue">Guardrails</span>
                <span className={`venue-telemetry-state ${Boolean(guardrails.learning_frozen) ? "warn" : "good"}`}>{Boolean(guardrails.learning_frozen) ? "frozen" : "active"}</span>
              </div>
              <div className="mon-row"><span>EMA / drawdown</span><span>{safeNumber(guardrails.reward_ema, 0).toFixed(2)} · {safeNumber(guardrails.reward_drawdown, 0).toFixed(2)}</span></div>
              <div className="optimizer-live-reasons">
                {freezeReasons.length === 0 ? <span className="optimizer-live-chip good">no freeze</span> : null}
                {freezeReasons.map((reason) => <span key={reason} className="optimizer-live-chip warn">{reason}</span>)}
              </div>
            </div>
          </div>
          <div className="optimizer-live-section">
            <div className="subtle mini">Top actions</div>
            {topActions.length === 0 ? <p className="subtle mini">Aucune action apprise.</p> : null}
            {topActions.map((row) => (
              <div key={`v6-action-${String(row.action || "hold")}`} className="mon-row">
                <span>{String(row.action || "hold")}</span>
                <span className="subtle mini">reward {safeNumber(row.avg_reward, 0).toFixed(2)} · win {(safeNumber(row.win_rate, 0) * 100).toFixed(0)}%</span>
                <span>{safeNumber(row.sample_count, 0).toFixed(0)} ep</span>
              </div>
            ))}
          </div>
          <div className="optimizer-live-section">
            <div className="subtle mini">Recent episodes</div>
            {recentEpisodes.length === 0 ? <p className="subtle mini">Aucun episode recent.</p> : null}
            {recentEpisodes.map((row, index) => (
              <div key={`v6-episode-row-${index}`} className="mon-row">
                <span>{String(row.timestamp || "") ? formatCompactClock(row.timestamp, formatClock) : "--:--:--"}</span>
                <span className="subtle mini">{String(row.action || "hold")}</span>
                <span className={safeNumber(row.reward, 0) >= 0 ? "good" : "warn"}>{safeNumber(row.reward, 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </MonitoringPanelCard>
  );
}

export function VenueTelemetryMonitoringPanel({
  badge,
  layoutEditMode,
  onDetach,
  marketPayload,
  routePayload,
  formatClock,
}: {
  badge: ReactNode;
  layoutEditMode: boolean;
  onDetach: () => void;
  marketPayload: VenueTelemetryPayload | null;
  routePayload: VenueTelemetryPayload | null;
  formatClock: (value: string) => string;
}) {
  const marketEnvelope = safeRecord(marketPayload);
  const routeEnvelope = safeRecord(routePayload);
  const rows = buildVenueTelemetryRows(marketPayload, routePayload);
  const updatedAt = String(routeEnvelope.updated_at || marketEnvelope.updated_at || "").trim();
  const marketProxyState = String(marketEnvelope.network_state || "healthy").trim().toLowerCase();
  const routeProxyState = String(routeEnvelope.network_state || "healthy").trim().toLowerCase();
  const proxyState = marketProxyState === "degraded" || routeProxyState === "degraded"
    ? "degraded"
    : marketProxyState === "retry_recovered" || routeProxyState === "retry_recovered"
      ? "retry_recovered"
      : "healthy";
  const titleBadge = (
    <>
      {badge}
      <span className={`venue-telemetry-proxy-badge ${proxyState}`}>{proxyState.replace(/_/g, " ")}</span>
    </>
  );

  return (
    <MonitoringPanelCard title="Venue Telemetry" badge={titleBadge} layoutEditMode={layoutEditMode} onDetach={onDetach}>
      {!marketPayload && !routePayload ? <p className="subtle mini">Télémétrie venue indisponible.</p> : null}
      {(marketPayload || routePayload) ? (
        <>
          <div className="venue-telemetry-summary">
            <span className="venue-telemetry-pill">proxy {proxyState}</span>
            <span className="venue-telemetry-pill">venues {rows.length}</span>
            <span className="venue-telemetry-pill">updated {updatedAt ? formatCompactClock(updatedAt, formatClock) : "--:--:--"}</span>
          </div>
          {rows.length === 0 ? <p className="subtle mini">Aucune venue observée.</p> : null}
          <div className="venue-telemetry-list">
            {rows.slice(0, 8).map((row) => {
              const market = safeRecord(row.market);
              const execution = safeRecord(row.execution);
              const stability = safeRecord(row.stability);
              const profile = safeRecord(row.profile);
              const instruments = safeRows(row.instruments);
              const tone = String(row.tone || "subtle");
              const feedLine = `q ${formatCompactMetricMs(market.max_quote_freshness_ms)} · d ${formatCompactMetricMs(market.max_depth_freshness_ms)} · t ${formatCompactMetricMs(market.max_trade_freshness_ms)}`;
              const marketLine = `${safeNumber(market.avg_spread_bps, 0).toFixed(2)}bp · depth ${safeNumber(market.avg_depth_levels, 0).toFixed(0)} · dlat ${formatCompactMetricMs(market.avg_depth_latency_ms)}`;
              const executionLine = Object.keys(execution).length > 0
                ? `${safeNumber(execution.fill_count, 0)} fills · ${safeNumber(execution.avg_slippage_bps, 0).toFixed(2)}bp · qual ${safeNumber(execution.avg_fill_quality_score, 0).toFixed(0)}`
                : "no fills in window";
              const instrumentLine = instruments.length > 0
                ? instruments.slice(0, 2).map((item) => `${String(item.instrument || "?")} ${safeNumber(item.spread_bps, 0).toFixed(2)}bp`).join(" · ")
                : "no market instruments";
              return (
                <div key={String(row.venue || "venue")} className={`venue-telemetry-item ${tone}`}>
                  <div className="venue-telemetry-head">
                    <span className="venue-telemetry-venue">{String(row.venue || "venue")}</span>
                    <span className={`venue-telemetry-state ${tone}`}>{String(stability.state || stability.stability_state || tone)}</span>
                  </div>
                  <div className="venue-telemetry-meta">
                    <span>Feed</span>
                    <strong>{feedLine}</strong>
                    <span>Market</span>
                    <strong>{marketLine}</strong>
                    <span>Exec</span>
                    <strong>{executionLine}</strong>
                    <span>Profile</span>
                    <strong>{String(profile.matching_rule || "price-time")} · q {safeNumber(profile.queue_priority_bias, 0).toFixed(2)}</strong>
                  </div>
                  <div className="venue-telemetry-instruments">{instrumentLine}</div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </MonitoringPanelCard>
  );
}

export function ExecutionOptimizerMonitoringPanel({
  badge,
  layoutEditMode,
  onDetach,
  payload,
  routingPayload,
  formatClock,
}: {
  badge: ReactNode;
  layoutEditMode: boolean;
  onDetach: () => void;
  payload: ExecutionOptimizerLivePayload | null;
  routingPayload: Record<string, unknown> | null;
  formatClock: (value: string) => string;
}) {
  const envelope = safeRecord(payload);
  const routingEnvelope = safeRecord(routingPayload);
  const profilesRecord = safeRecord(envelope.profiles);
  const activeOrders = safeRows(envelope.active_orders);
  const recentEvents = safeRows(envelope.recent_events);
  const dominance = safeRecord(routingEnvelope.dominance);
  const splitPlan = safeRecord(routingEnvelope.split_plan);
  const hedgeRecommendation = safeRecord(routingEnvelope.hedge_recommendation);
  const executionAiV6 = safeRecord(routingEnvelope.execution_ai_v6);
  const executionAiV6State = safeRecord(executionAiV6.state);
  const executionAiV6Decision = safeRecord(executionAiV6.decision);
  const executionAiV6Snapshot = safeRecord(executionAiV6.snapshot);
  const executionAiV6Guardrails = safeRecord(executionAiV6Decision.guardrails || executionAiV6Snapshot.guardrails);
  const bestRoute = safeRecord(routingEnvelope.best);
  const backupRoute = safeRecord(routingEnvelope.backup);
  const splitSlices = safeRows(splitPlan.slices).slice(0, 3);
  const executionAiV6TopActions = safeRows(executionAiV6Snapshot.top_actions).slice(0, 3);
  const executionAiV6Episodes = safeRows(executionAiV6Snapshot.recent_episodes).slice(0, 3);
  const hedgeReasons = Array.isArray(hedgeRecommendation.reasons)
    ? hedgeRecommendation.reasons.map((item) => String(item)).filter(Boolean).slice(0, 3)
    : [];
  const executionAiV6Reasons = Array.isArray(executionAiV6Decision.reasons)
    ? executionAiV6Decision.reasons.map((item) => String(item)).filter(Boolean).slice(0, 4)
    : [];
  const executionAiV6FreezeReasons = Array.isArray(executionAiV6Guardrails.freeze_reasons)
    ? executionAiV6Guardrails.freeze_reasons.map((item) => String(item)).filter(Boolean).slice(0, 3)
    : [];
  const routingAvailable = Object.keys(routingEnvelope).length > 0;
  const executionAiV6Available = Object.keys(executionAiV6).length > 0;
  const routingLeader = String(dominance.leader_venue || bestRoute.venue || "--");
  const routingRunnerUp = String(dominance.runner_up_venue || backupRoute.venue || "--");
  const splitMode = String(splitPlan.mode || dominance.mode || "singleVenue");
  const hedgeMode = String(hedgeRecommendation.mode || "standby");
  const hedgeEnabled = Boolean(hedgeRecommendation.enabled);
  const executionAiV6Action = String(executionAiV6Decision.action || "hold");
  const executionAiV6LearningEnabled = Boolean(executionAiV6Decision.learning_enabled);
  const executionAiV6Frozen = Boolean(executionAiV6Guardrails.learning_frozen);
  const hedgeVenueLabel = hedgeMode === "crossExchangeLock"
    ? `${String(hedgeRecommendation.buy_venue || "--")}→${String(hedgeRecommendation.sell_venue || "--")}`
    : String(hedgeRecommendation.venue || "--");
  const profileRows = Object.values(profilesRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .sort((left, right) => safeNumber(right.sample_count, 0) - safeNumber(left.sample_count, 0));
  const updatedAt = String(envelope.updated_at || envelope.profiles_updated_at || "").trim();
  const proxyState = String(envelope.network_state || "healthy").trim().toLowerCase();
  const titleBadge = (
    <>
      {badge}
      <span className={`venue-telemetry-proxy-badge ${proxyState}`}>{proxyState.replace(/_/g, " ")}</span>
    </>
  );

  return (
    <MonitoringPanelCard title="Execution Optimizer" badge={titleBadge} layoutEditMode={layoutEditMode} onDetach={onDetach}>
      {!payload ? <p className="subtle mini">Optimizer live-state indisponible.</p> : null}
      {payload ? (
        <>
          <div className="venue-telemetry-summary">
            <span className="venue-telemetry-pill">active {activeOrders.length}</span>
            <span className="venue-telemetry-pill">profiles {profileRows.length}</span>
            <span className="venue-telemetry-pill">events {recentEvents.length}</span>
            <span className="venue-telemetry-pill">updated {updatedAt ? formatCompactClock(updatedAt, formatClock) : "--:--:--"}</span>
          </div>
          <div className="optimizer-live-section">
            <div className="subtle mini">V5 multi-venue routing</div>
            {!routingAvailable ? <p className="subtle mini">Dominance, split et hedge V5 indisponibles.</p> : null}
            {routingAvailable ? (
              <div className="optimizer-live-grid">
                <div className={`venue-telemetry-item ${safeNumber(dominance.score_gap, 0) >= 0.08 ? "good" : "subtle"}`}>
                  <div className="venue-telemetry-head">
                    <span className="venue-telemetry-venue">Dominance</span>
                    <span className={`venue-telemetry-state ${safeNumber(dominance.score_gap, 0) >= 0.08 ? "good" : "subtle"}`}>{routingLeader}</span>
                  </div>
                  <div className="mon-row"><span>Leader / backup</span><span>{routingLeader} · {routingRunnerUp}</span></div>
                  <div className="mon-row"><span>Score gap</span><span>{safeNumber(dominance.score_gap, 0).toFixed(3)} · lead {(safeNumber(dominance.leader_score, 0) * 100).toFixed(0)}%</span></div>
                  <div className="mon-row"><span>Latency edge</span><span>{formatCompactMetricMs(dominance.latency_edge_ms)} · queue {(safeNumber(dominance.queue_position, 0) * 100).toFixed(0)}%</span></div>
                  <div className="mon-row"><span>Route score</span><span>{(safeNumber(bestRoute.score, safeNumber(dominance.leader_score, 0)) * 100).toFixed(0)}% · reason {String(routingEnvelope.reason || "best_route_candidate").replace(/_/g, " ")}</span></div>
                </div>
                <div className={`venue-telemetry-item ${splitMode === "multiVenueSplit" ? "good" : "subtle"}`}>
                  <div className="venue-telemetry-head">
                    <span className="venue-telemetry-venue">Split</span>
                    <span className={`venue-telemetry-state ${splitMode === "multiVenueSplit" ? "good" : "subtle"}`}>{splitMode.replace(/_/g, " ")}</span>
                  </div>
                  <div className="mon-row"><span>Primary / venues</span><span>{String(splitPlan.primary_venue || routingLeader || "--")} · {safeNumber(splitPlan.venue_count, splitSlices.length || 1).toFixed(0)} venues</span></div>
                  <div className="mon-row"><span>Coverage / slip</span><span>{(safeNumber(splitPlan.coverage_ratio, 0) * 100).toFixed(0)}% · {safeNumber(splitPlan.estimated_slippage_bps, 0).toFixed(2)}bps</span></div>
                  <div className="mon-row"><span>Plan size</span><span>{formatCompactUsd(splitPlan.total_notional_usd)} · rem {formatCompactUsd(splitPlan.remaining_notional_usd)}</span></div>
                  <div className="optimizer-live-reasons">
                    {splitSlices.length === 0 ? <span className="optimizer-live-chip warn">no split slices</span> : null}
                    {splitSlices.map((slice, index) => (
                      <span key={`split-slice-${index}-${String(slice.venue || "venue")}`} className="optimizer-live-chip good">
                        {String(slice.venue || "?")} {(safeNumber(slice.share_pct, 0) * 100).toFixed(0)}% · {formatCompactUsd(slice.notional_usd)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className={`venue-telemetry-item ${hedgeEnabled ? "good" : "subtle"}`}>
                  <div className="venue-telemetry-head">
                    <span className="venue-telemetry-venue">Hedge</span>
                    <span className={`venue-telemetry-state ${hedgeEnabled ? "good" : "subtle"}`}>{hedgeMode.replace(/_/g, " ")}</span>
                  </div>
                  <div className="mon-row"><span>State</span><span>{hedgeEnabled ? "enabled" : "standby"}</span></div>
                  <div className="mon-row"><span>Venue</span><span>{hedgeVenueLabel}</span></div>
                  <div className="mon-row"><span>Trigger / size</span><span>{formatCompactUsd(hedgeRecommendation.trigger_delta_usd)} · {formatCompactUsd(hedgeRecommendation.hedge_notional_usd)}</span></div>
                  <div className="optimizer-live-reasons">
                    {hedgeReasons.length === 0 ? <span className="optimizer-live-chip warn">no hedge trigger</span> : null}
                    {hedgeReasons.map((reason) => <span key={reason} className="optimizer-live-chip good">{reason}</span>)}
                  </div>
                </div>
                <div className={`venue-telemetry-item ${executionAiV6Frozen ? "warn" : executionAiV6Action === "hold" ? "subtle" : "good"}`}>
                  <div className="venue-telemetry-head">
                    <span className="venue-telemetry-venue">Execution AI V6</span>
                    <span className={`venue-telemetry-state ${executionAiV6Frozen ? "warn" : executionAiV6Action === "hold" ? "subtle" : "good"}`}>{executionAiV6Action.replace(/_/g, " ")}</span>
                  </div>
                  {!executionAiV6Available ? <div className="mon-row"><span>State</span><span>indisponible</span></div> : null}
                  {executionAiV6Available ? (
                    <>
                      <div className="mon-row"><span>Confiance / reward</span><span>{(safeNumber(executionAiV6Decision.confidence, 0) * 100).toFixed(0)}% · {safeNumber(executionAiV6Decision.projected_reward, 0).toFixed(2)}</span></div>
                      <div className="mon-row"><span>Regime / venue</span><span>{String(executionAiV6State.market_regime || "balanced")} · {String(executionAiV6State.venue || routingLeader || "--")}</span></div>
                      <div className="mon-row"><span>Queue / fill</span><span>{(safeNumber(executionAiV6State.queue_position, 0) * 100).toFixed(0)}% · {(safeNumber(executionAiV6State.fill_probability, 0) * 100).toFixed(0)}%</span></div>
                      <div className="mon-row"><span>Learning</span><span>{executionAiV6LearningEnabled ? "enabled" : "frozen"} · {safeNumber(executionAiV6Snapshot.context_count, 0).toFixed(0)} ctx</span></div>
                      <div className="mon-row"><span>Persistence</span><span className={Boolean(executionAiV6Guardrails.persistence_available) ? "good" : "warn"}>{Boolean(executionAiV6Guardrails.persistence_available) ? "db online" : "db degraded"}</span></div>
                      <div className="optimizer-live-reasons">
                        {executionAiV6Reasons.length === 0 ? <span className="optimizer-live-chip subtle">no policy reasons</span> : null}
                        {executionAiV6Reasons.map((reason) => <span key={reason} className="optimizer-live-chip good">{reason}</span>)}
                      </div>
                    </>
                  ) : null}
                </div>
                <div className={`venue-telemetry-item ${executionAiV6Frozen ? "warn" : "subtle"}`}>
                  <div className="venue-telemetry-head">
                    <span className="venue-telemetry-venue">V6 learning state</span>
                    <span className={`venue-telemetry-state ${executionAiV6Frozen ? "warn" : "subtle"}`}>{executionAiV6Frozen ? "guarded" : "active"}</span>
                  </div>
                  {!executionAiV6Available ? <div className="mon-row"><span>Episodes</span><span>aucune donnee</span></div> : null}
                  {executionAiV6Available ? (
                    <>
                      <div className="mon-row"><span>EMA / drawdown</span><span>{safeNumber(executionAiV6Guardrails.reward_ema, 0).toFixed(2)} · dd {safeNumber(executionAiV6Guardrails.reward_drawdown, 0).toFixed(2)}</span></div>
                      <div className="mon-row"><span>Vol / streak</span><span>{safeNumber(executionAiV6Guardrails.reward_volatility, 0).toFixed(2)} · {safeNumber(executionAiV6Guardrails.negative_streak, 0).toFixed(0)} neg</span></div>
                      <div className="mon-row"><span>Loaded</span><span>{Boolean(executionAiV6Guardrails.loaded) ? formatCompactClock(executionAiV6Guardrails.loaded_at, formatClock) : "cold"}</span></div>
                      {!Boolean(executionAiV6Guardrails.persistence_available) && String(executionAiV6Guardrails.last_persist_error || "") ? (
                        <div className="mon-row"><span>DB error</span><span className="warn gtix-ellipsis">{String(executionAiV6Guardrails.last_persist_error || "")}</span></div>
                      ) : null}
                      <div className="optimizer-live-reasons">
                        {executionAiV6FreezeReasons.length === 0 ? <span className="optimizer-live-chip good">guardrails clean</span> : null}
                        {executionAiV6FreezeReasons.map((reason) => <span key={reason} className="optimizer-live-chip warn">{reason}</span>)}
                        {executionAiV6TopActions.map((row) => (
                          <span key={`v6-top-${String(row.action || "hold")}`} className="optimizer-live-chip subtle">
                            {String(row.action || "hold")} {safeNumber(row.avg_reward, 0).toFixed(2)} · {safeNumber(row.sample_count, 0).toFixed(0)}
                          </span>
                        ))}
                      </div>
                      <div className="optimizer-live-reasons">
                        {executionAiV6Episodes.map((episode, index) => (
                          <span key={`v6-episode-${index}-${String(episode.timestamp || "ts")}`} className={`optimizer-live-chip ${safeNumber(episode.reward, 0) >= 0 ? "good" : "warn"}`}>
                            {String(episode.action || "hold")} {safeNumber(episode.reward, 0).toFixed(2)}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <div className="optimizer-live-section">
            <div className="subtle mini">Live managed orders</div>
            {activeOrders.length === 0 ? <p className="subtle mini">Aucun ordre live actuellement managé.</p> : null}
            <div className="optimizer-live-grid">
              {activeOrders.slice(0, 4).map((order, index) => {
                const tone = resolveExecutionOptimizerTone(order);
                const guardReasons = Array.isArray(order.guard_reasons) ? order.guard_reasons.map((item) => String(item)).filter(Boolean).slice(0, 3) : [];
                const deskProfile = safeRecord(order.desk_profile);
                return (
                  <div key={`optimizer-active-${index}-${String(order.order_id || order.decision_id || "row")}`} className={`venue-telemetry-item ${tone}`}>
                    <div className="venue-telemetry-head">
                      <span className="venue-telemetry-venue">{String(order.symbol || "?")} · {String(order.side || "buy").toUpperCase()}</span>
                      <span className={`venue-telemetry-state ${tone}`}>{String(order.lifecycle_action || order.status || "keep").replace(/_/g, " ")}</span>
                    </div>
                    <div className="mon-row"><span>Venue</span><span>{String(order.market_venue || order.broker_provider || "unknown")}</span></div>
                    <div className="mon-row"><span>Queue / fill</span><span>{(safeNumber(order.queue_rank_estimate, 0) * 100).toFixed(0)}% tail · {(safeNumber(order.fill_score, 0) * 100).toFixed(0)}%</span></div>
                    <div className="mon-row"><span>Predicted fill</span><span>{(safeNumber(order.predicted_fill_probability, 0) * 100).toFixed(0)}% · {(safeNumber(order.dominance_score, 0) * 100).toFixed(0)} dom</span></div>
                    <div className="mon-row"><span>Queue clock</span><span>{formatCompactMetricMs(order.time_in_queue_ms)} · TTF {formatCompactMetricMs(order.time_to_fill_estimate_ms)}</span></div>
                    <div className="mon-row"><span>Toxicity</span><span>{(safeNumber(order.adverse_selection_score, 0) * 100).toFixed(0)}% adv · {(safeNumber(order.liquidity_decay_rate, 0) * 100).toFixed(0)}% decay</span></div>
                    <div className="mon-row"><span>Timing</span><span>{String(order.timing || "WAIT")}</span></div>
                    <div className="mon-row"><span>Profile</span><span>{safeNumber(deskProfile.sample_count, 0)} fills · max {safeNumber(deskProfile.max_spread_bps, 0).toFixed(1)}bps</span></div>
                    <div className="optimizer-live-reasons">
                      {guardReasons.length === 0 ? <span className="optimizer-live-chip good">guard clean</span> : null}
                      {guardReasons.map((reason) => <span key={reason} className="optimizer-live-chip warn">{reason}</span>)}
                      {Boolean(order.spoof_detected) ? <span className="optimizer-live-chip warn">spoof</span> : null}
                      {Boolean(order.liquidity_trap_detected) ? <span className="optimizer-live-chip warn">trap</span> : null}
                      {Boolean(order.should_move_ahead) ? <span className="optimizer-live-chip good">move-ahead</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="optimizer-live-section">
            <div className="subtle mini">Recent lifecycle events</div>
            {recentEvents.length === 0 ? <p className="subtle mini">Aucun event recent.</p> : null}
            {recentEvents.slice(0, 4).map((event, index) => (
              <div key={`optimizer-event-${index}`} className="mon-row">
                <span>{String(event.updated_at || "") ? formatClock(String(event.updated_at)) : "--:--:--"}</span>
                <span className="subtle mini">{String(event.symbol || "?")} · {String(event.market_venue || event.broker_provider || "unknown")}</span>
                <span className={resolveExecutionOptimizerTone(event)}>{String(event.lifecycle_action || event.status || "keep")}</span>
              </div>
            ))}
          </div>
          <div className="optimizer-live-section">
            <div className="subtle mini">Calibrated venue desk profiles</div>
            {profileRows.length === 0 ? <p className="subtle mini">Pas encore de calibration fills.</p> : null}
            <div className="optimizer-profile-grid">
              {profileRows.slice(0, 4).map((profile, index) => (
                <div key={`optimizer-profile-${index}-${String(profile.venue || "venue")}`} className="venue-telemetry-item subtle">
                  <div className="venue-telemetry-head">
                    <span className="venue-telemetry-venue">{String(profile.venue || "venue")}</span>
                    <span className="venue-telemetry-state subtle">{safeNumber(profile.sample_count, 0)} fills</span>
                  </div>
                  <div className="mon-row"><span>Spread / latency</span><span>{safeNumber(profile.max_spread_bps, 0).toFixed(1)}bps · {Math.round(safeNumber(profile.max_latency_ms, 0))}ms</span></div>
                  <div className="mon-row"><span>Fill guard</span><span>{(safeNumber(profile.min_fill_probability, 0) * 100).toFixed(0)}% / {(safeNumber(profile.replace_below_fill_probability, 0) * 100).toFixed(0)}%</span></div>
                  <div className="mon-row"><span>Spoof wall</span><span>{formatCompactUsd(profile.spoof_notional_usd)} · {Math.round(safeNumber(profile.spoof_lifetime_ms, 0))}ms</span></div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </MonitoringPanelCard>
  );
}

export function IncidentsMonitoringPanel({
  badge,
  layoutEditMode,
  onDetach,
  incidents,
  incidentRows,
}: {
  badge: ReactNode;
  layoutEditMode: boolean;
  onDetach: () => void;
  incidents: Array<Record<string, unknown>>;
  incidentRows: IncidentItemRow[];
}) {
  return (
    <MonitoringPanelCard title="Incidents" badge={badge} layoutEditMode={layoutEditMode} onDetach={onDetach}>
      {incidents.length === 0 ? <p className="subtle mini">Aucun incident.</p> : null}
      {incidentRows.slice(0, 5).map(({ item, status, severityLabel, slaLabel }) => (
        <div key={String(item.ticket_key || "")} className="mon-row incident-row">
          <span>{String(item.ticket_key || "–")}</span>
          <span className="subtle mini">{String(item.title || "–").slice(0, 22)}</span>
          <span className="incident-meta-strip">
            <span className={`incident-chip incident-chip-status-${status.toLowerCase()}`}>{status}</span>
            <span className={`incident-chip incident-chip-severity-${severityLabel}`}>{severityLabel}</span>
            <span className={`incident-chip ${slaLabel === "breach" ? "incident-chip-sla-breach" : "incident-chip-sla-ok"}`}>sla {slaLabel}</span>
          </span>
        </div>
      ))}
    </MonitoringPanelCard>
  );
}

export function GovernanceMonitoringPanel({
  badge,
  layoutEditMode,
  onDetach,
  governanceSort,
  onGovernanceSortChange,
  incidentSort,
  onIncidentSortChange,
  governanceOnlyAlerts,
  onGovernanceOnlyAlertsChange,
  governanceFilterText,
  onGovernanceFilterTextChange,
  governanceFiltered,
}: {
  badge: ReactNode;
  layoutEditMode: boolean;
  onDetach: () => void;
  governanceSort: GovernanceSort;
  onGovernanceSortChange: (value: GovernanceSort) => void;
  incidentSort: IncidentSort;
  onIncidentSortChange: (value: IncidentSort) => void;
  governanceOnlyAlerts: boolean;
  onGovernanceOnlyAlertsChange: (value: boolean) => void;
  governanceFilterText: string;
  onGovernanceFilterTextChange: (value: string) => void;
  governanceFiltered: GovernanceRow[];
}) {
  return (
    <MonitoringPanelCard title="Governance" badge={badge} layoutEditMode={layoutEditMode} onDetach={onDetach}>
      <div className="governance-toolbar">
        <select value={governanceSort} onChange={(event) => onGovernanceSortChange(event.target.value as GovernanceSort)}>
          <option value="severity">tri: severity</option>
          <option value="label">tri: label</option>
          <option value="value">tri: value</option>
        </select>
        <select value={incidentSort} onChange={(event) => onIncidentSortChange(event.target.value as IncidentSort)}>
          <option value="severity">incidents: severity</option>
          <option value="status">incidents: status</option>
          <option value="sla">incidents: SLA</option>
        </select>
        <label className="governance-check"><input type="checkbox" checked={governanceOnlyAlerts} onChange={(event) => onGovernanceOnlyAlertsChange(event.target.checked)} /> alerts only</label>
      </div>
      <input value={governanceFilterText} onChange={(event) => onGovernanceFilterTextChange(event.target.value)} className="governance-search" placeholder="filtrer incidents / governance" />
      {governanceFiltered.slice(0, 8).map((row) => (
        <div key={row.label} className="mon-row">
          <span>{row.label}</span>
          <span className={row.severity >= 3 ? "warn" : row.severity >= 2 ? "subtle" : "good"}>{row.value}</span>
        </div>
      ))}
    </MonitoringPanelCard>
  );
}

export function ReadinessMonitoringPanel({
  badge,
  layoutEditMode,
  onDetach,
  driftItems,
  suspendedCount,
  memorySummary,
  incidents,
}: {
  badge: ReactNode;
  layoutEditMode: boolean;
  onDetach: () => void;
  driftItems: DriftItem[];
  suspendedCount: number;
  memorySummary: MemorySummary;
  incidents: Array<Record<string, unknown>>;
}) {
  return (
    <MonitoringPanelCard title="Readiness" badge={badge} layoutEditMode={layoutEditMode} onDetach={onDetach}>
      <div className="mon-row"><span>Drift</span><span>{driftItems.filter((item) => Boolean(item.drift_detected)).length}</span></div>
      <div className="mon-row"><span>Suspendues</span><span className={suspendedCount > 0 ? "warn" : "good"}>{suspendedCount}</span></div>
      <div className="mon-row"><span>Similarity</span><span>{String(memorySummary.avg_final_similarity || "–")}</span></div>
      <div className="mon-row"><span>Memory impact</span><span>{String(memorySummary.avg_memory_impact || "–")}</span></div>
      <div className="mon-row"><span>SLA breach</span><span className={incidents.some((item) => Boolean(item.sla_breached)) ? "warn" : "good"}>{incidents.filter((item) => Boolean(item.sla_breached)).length}</span></div>
    </MonitoringPanelCard>
  );
}

export function RiskTimelineMonitoringPanel({
  badge,
  layoutEditMode,
  onDetach,
  body,
}: {
  badge: ReactNode;
  layoutEditMode: boolean;
  onDetach: () => void;
  body: ReactNode;
}) {
  return (
    <MonitoringPanelCard title="Risk Compliance Timeline" badge={badge} layoutEditMode={layoutEditMode} onDetach={onDetach}>
      {body}
    </MonitoringPanelCard>
  );
}