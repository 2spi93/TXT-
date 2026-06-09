import Link from "next/link";
import { redirect } from "next/navigation";

import { cpFetch } from "../lib/controlPlane";
import { readHealthwatchDashboard } from "../lib/healthwatchDashboard";
import { defaultLocalTerminalCaptureStore, getLatestLocalTerminalCapture } from "../lib/localTerminalCapture";
import { readLocalTerminalCaptureStore } from "../lib/localTerminalCaptureStore";
import { getConnectorHealthView } from "../lib/connectorHealth";
import HelpHint from "../components/HelpHint";
import MissionControlBlueGreenCard from "../components/ui/MissionControlBlueGreenCard";
import RuntimeObservationDashboard from "../components/ui/RuntimeObservationDashboard";
import OperatorPanelGuide from "../components/ui/OperatorPanelGuide";
import RuntimeDecisionOverviewCard from "../components/ui/RuntimeDecisionOverviewCard";
import RuntimeOperatorMonitoringCard from "../components/ui/RuntimeOperatorMonitoringCard";
import RuntimeStabilityDebugView from "../components/ui/RuntimeStabilityDebugView";
import { readMissionControlBlueGreenStatus } from "../lib/blueGreenUiStatus";
import { getRuntimeDecisionAnalytics } from "../lib/runtimeDecisionAnalytics";
import { ensureRuntimeDecisionWriterStarted } from "../lib/runtimeDecisionWriter";
import { readSourceTreeProvenanceAudit } from "../lib/sourceTreeProvenance";
import {
  describeSourceTreePromotionBlock,
  formatSourceTreeProvenanceStatus,
  getSourceTreeCommitDeltaLines,
} from "../lib/sourceTreeProvenanceView";
import { UI_HELP_HINTS, UI_TERMS } from "../lib/uiLexicon";
import { getRoleGroup, getRoleDisplayLabel, isClientRole } from "../lib/roleGroups";
import { getServerRole } from "../lib/serverAuth";

type RecordItem = Record<string, unknown>;

function asRecordItem(value: unknown): RecordItem {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordItem : {};
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

function isE2eDashboardFallbackEnabled(): boolean {
  const playwrightTest = String(process.env.PLAYWRIGHT_TEST || "").toLowerCase();
  const degraded = String(process.env.MC_E2E_DEV_DEGRADED || "").toLowerCase();
  const isPlaywright = playwrightTest === "1" || playwrightTest === "true" || playwrightTest === "yes" || playwrightTest === "on";
  const isDegraded = degraded === "1" || degraded === "true" || degraded === "yes" || degraded === "on";
  return isPlaywright && isDegraded;
}

const DASHBOARD_CP_FETCH_TIMEOUT_MS = 4_000;
const DASHBOARD_IMPROVEMENT_FETCH_TIMEOUT_MS = 3_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function getJson(path: string, timeoutMs = DASHBOARD_CP_FETCH_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const response = await withTimeout(
    cpFetch(path, { signal: controller.signal }).catch(() => null),
    timeoutMs,
    null,
  );
  if (!response) {
    controller.abort();
    return null;
  }
  if (!response.ok) {
    return null;
  }
  return withTimeout(response.json().catch(() => null), 1_000, null);
}

async function postJson(path: string, body: unknown, timeoutMs = DASHBOARD_CP_FETCH_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const response = await withTimeout(
    cpFetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch(() => null),
    timeoutMs,
    null,
  );
  if (!response) {
    controller.abort();
    return null;
  }
  if (!response.ok) {
    return null;
  }
  return withTimeout(response.json().catch(() => null), 1_000, null);
}

async function getLocalJson<T>(promise: Promise<T>, timeoutMs = DASHBOARD_CP_FETCH_TIMEOUT_MS, fallback: T): Promise<T> {
  return withTimeout(promise.catch(() => fallback), timeoutMs, fallback);
}

async function getServerRoleBounded(): Promise<Awaited<ReturnType<typeof getServerRole>>> {
  return withTimeout(getServerRole().catch(() => null), 1_500, null);
}

async function readHealthwatchDashboardBounded(): Promise<Awaited<ReturnType<typeof readHealthwatchDashboard>>> {
  return getLocalJson(readHealthwatchDashboard(), DASHBOARD_CP_FETCH_TIMEOUT_MS, null as Awaited<ReturnType<typeof readHealthwatchDashboard>>);
}

async function readLocalTerminalCaptureStoreBounded(): Promise<Awaited<ReturnType<typeof readLocalTerminalCaptureStore>>> {
  return getLocalJson(readLocalTerminalCaptureStore(), 1_500, defaultLocalTerminalCaptureStore());
}

async function readBlueGreenStatusBounded(): Promise<Awaited<ReturnType<typeof readMissionControlBlueGreenStatus>>> {
  return getLocalJson(readMissionControlBlueGreenStatus(), 1_500, {
    activeSlot: "blue",
    inactiveSlot: "green",
    slotFilePath: "/workspace/data/mission-control/ui-active-slot.conf",
    slotFileSummary: "fallback status unavailable",
    slots: [],
  });
}

function formatSignedMetric(value: unknown, fractionDigits = 2, suffix = ""): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  const prefix = numeric > 0 ? "+" : "";
  return `${prefix}${numeric.toFixed(fractionDigits)}${suffix}`;
}

function decisionMetricTone(value: unknown): "good" | "subtle" | "warn" {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "ACCEPT") {
    return "good";
  }
  if (normalized === "TEST") {
    return "subtle";
  }
  return "warn";
}

function promotionScoreZone(value: unknown): "PROMOTE" | "POTENTIAL" | "WATCH" | "WEAK" {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "WEAK";
  }
  if (numeric > 0.9) {
    return "PROMOTE";
  }
  if (numeric >= 0.75) {
    return "POTENTIAL";
  }
  if (numeric >= 0.6) {
    return "WATCH";
  }
  return "WEAK";
}

export default async function DashboardPageContent() {
  ensureRuntimeDecisionWriterStarted();

  const runtimeDecisionExportHref = "/api/system/runtime-decision/export?limit=1200&sinceDays=7&historyLimit=20&download=1";
  const [me, overview, audit, positions, quotes, balances, pending, strategies, connectorsStatus, healthwatchDashboard, localTerminalCaptureStore, runtimeDecisionSummary, blueGreenStatus, serverRole, sourceTreeProvenance] = await Promise.all([
    getJson("/v1/auth/me") as Promise<RecordItem | null>,
    getJson("/v1/dashboard/overview") as Promise<RecordItem | null>,
    getJson("/v1/audit") as Promise<RecordItem[] | null>,
    getJson("/v1/broker/positions") as Promise<RecordItem[] | null>,
    getJson("/v1/market/quotes") as Promise<RecordItem[] | null>,
    getJson("/v1/broker/balance") as Promise<RecordItem | null>,
    getJson("/v1/intents/pending") as Promise<Record<string, RecordItem> | null>,
    getJson("/v1/strategies") as Promise<RecordItem[] | null>,
    getJson("/v1/connectors/status") as Promise<RecordItem | null>,
    readHealthwatchDashboardBounded(),
    readLocalTerminalCaptureStoreBounded(),
    getRuntimeDecisionAnalytics({ limit: 1200, sinceDays: 7, samples: 2 }),
    readBlueGreenStatusBounded(),
    getServerRoleBounded(),
    readSourceTreeProvenanceAudit(),
  ]);

  const effectiveMe = me || (serverRole
    ? {
        username: "operator",
        role: serverRole,
        auth_source: "cookie-fallback",
      }
    : isE2eDashboardFallbackEnabled()
      ? {
          username: "operator",
          role: "operator",
          auth_source: "e2e-fallback",
        }
      : null);

  if (!effectiveMe) {
    return (
      <main className="shell txt-page-shell">
        <section className="hero txt-page-hero-grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="panel txt-page-hero">
            <div className="eyebrow">TXT</div>
            <h1 className="title" style={{ fontSize: 34 }}>Session requise</h1>
            <p className="subtle">Connecte-toi pour acceder au cockpit RBAC.</p>
            <p><Link href="/login">Aller a la page de connexion</Link></p>
          </div>
        </section>
      </main>
    );
  }

  if (Boolean(effectiveMe.password_must_change)) {
    redirect("/change-password");
  }

  const meRole = String(effectiveMe.role || "");
  if (isClientRole(meRole)) {
    redirect("/terminal");
  }

  const meRoleGroup = getRoleGroup(meRole);
  const meRoleLabel = getRoleDisplayLabel(meRole, meRoleGroup);

  const safeOverview = overview || {};
  const safeAudit = audit || [];
  const safePositions = positions || [];
  const safeQuotes = quotes || [];
  const safeBalances = balances || { balances: [] };
  const safePending = pending || {};
  const safeStrategies = strategies || [];
  const strategyPromotionGuard = describeSourceTreePromotionBlock(sourceTreeProvenance);
  const strategyPromotionCommitDelta = getSourceTreeCommitDeltaLines(sourceTreeProvenance);
  const safeConnectors = Array.isArray(connectorsStatus?.connectors)
    ? connectorsStatus.connectors.filter((item): item is RecordItem => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const connectorByName = new Map(safeConnectors.map((item) => [String(item.name || "").toLowerCase(), item]));
  const executionVenueRows = safeConnectors.filter((item) => Number(asRecordItem(item.broker_capabilities).linked_trade_accounts || 0) > 0);
  const marketVenueRows = ["okx", "binance", "bybit"]
    .map((provider) => connectorByName.get(provider))
    .filter((item): item is RecordItem => Boolean(item));
  const okxTradeLinked = executionVenueRows.some((item) => String(item.name || "").toLowerCase() === "okx");
  const publicChartVisibility = (healthwatchDashboard?.public_chart_visibility && typeof healthwatchDashboard.public_chart_visibility === "object"
    ? healthwatchDashboard.public_chart_visibility
    : null) as RecordItem | null;
  const latestLocalTerminalCapture = getLatestLocalTerminalCapture(localTerminalCaptureStore);
  const publicFailureDetails = (publicChartVisibility?.failure_details && typeof publicChartVisibility.failure_details === "object"
    ? publicChartVisibility.failure_details
    : null) as RecordItem | null;
  const publicProbeState = String(publicChartVisibility?.state || publicChartVisibility?.public_chart_state || "unknown");
  const dashboardRouteDebugCards = [
    {
      label: "Canonical route",
      value: "/dashboard",
      detail: "dashboard principal · / redirige maintenant vers /dashboard",
    },
    {
      label: "Local capture",
      value: latestLocalTerminalCapture ? "READY" : "MISSING",
      detail: latestLocalTerminalCapture
        ? `${latestLocalTerminalCapture.clientId.slice(0, 8)} · ${latestLocalTerminalCapture.chart.feedLabel}`
        : "no persisted terminal snapshot",
    },
    {
      label: "Runtime desk",
      value: String(runtimeDecisionSummary.deskRead.tone || "n/a").toUpperCase(),
      detail: String(runtimeDecisionSummary.deskRead.headline || runtimeDecisionSummary.drift.headline || "runtime desk ready"),
    },
    {
      label: "Public probe",
      value: publicProbeState.toUpperCase(),
      detail: String(publicChartVisibility?.failure_reason || "probe ready"),
    },
  ] as const;
  const dashboardRouteDebugRows = [
    { label: "Route mirror", value: "/ -> /dashboard" },
    { label: "Observation window", value: `${runtimeDecisionSummary.observation.sampleHours}h / ${runtimeDecisionSummary.observation.maxObservationHours}h` },
    { label: "Public probe feed", value: `${String(((publicChartVisibility?.ohlcv_contract as RecordItem | undefined)?.instrument) || "-")} @ ${String(((publicChartVisibility?.ohlcv_contract as RecordItem | undefined)?.venue) || "-")}` },
    { label: "Latest local capture", value: latestLocalTerminalCapture?.capturedAt || "none" },
  ] as const;

  const balanceRows = (safeBalances.balances as RecordItem[]) || [];
  const pendingRows = Object.entries(safePending);
  const primaryImprovementScope = executionVenueRows.length > 0
    ? {
        scopeType: "provider",
        scopeId: String(executionVenueRows[0]?.name || "").trim().toLowerCase(),
      }
    : safeStrategies.length > 0
      ? {
          scopeType: "strategy",
          scopeId: String(safeStrategies[0]?.strategy_id || "").trim(),
        }
      : null;

  let improvementProposalsPayload: RecordItem | null = null;
  let improvementValidationPayload: RecordItem | null = null;
  let improvementSimulationPayload: RecordItem | null = null;
  let improvementDeploymentPayload: RecordItem | null = null;
  let improvementDeploymentMonitoringPayload: RecordItem | null = null;
  let improvementDeploymentGovernorPayload: RecordItem | null = null;
  if (primaryImprovementScope?.scopeId) {
    const params = new URLSearchParams({
      scope_type: primaryImprovementScope.scopeType,
      scope_id: primaryImprovementScope.scopeId,
      limit: "80",
    });
    [improvementProposalsPayload, improvementValidationPayload, improvementSimulationPayload, improvementDeploymentPayload, improvementDeploymentMonitoringPayload, improvementDeploymentGovernorPayload] = await Promise.all([
      getJson(`/v1/system/improvement-proposals?${params.toString()}`, DASHBOARD_IMPROVEMENT_FETCH_TIMEOUT_MS) as Promise<RecordItem | null>,
      postJson("/v1/system/improvement-validations", {
        scope_type: primaryImprovementScope.scopeType,
        scope_id: primaryImprovementScope.scopeId,
        limit: 80,
      }, DASHBOARD_IMPROVEMENT_FETCH_TIMEOUT_MS) as Promise<RecordItem | null>,
      postJson("/v1/system/improvement-simulations", {
        scope_type: primaryImprovementScope.scopeType,
        scope_id: primaryImprovementScope.scopeId,
        limit: 80,
      }, DASHBOARD_IMPROVEMENT_FETCH_TIMEOUT_MS) as Promise<RecordItem | null>,
      getJson("/v1/system/improvement-deployments?active_only=1", DASHBOARD_IMPROVEMENT_FETCH_TIMEOUT_MS) as Promise<RecordItem | null>,
      getJson("/v1/system/improvement-deployments/monitor", DASHBOARD_IMPROVEMENT_FETCH_TIMEOUT_MS) as Promise<RecordItem | null>,
      getJson("/v1/system/improvement-deployments/governor?fresh=1", DASHBOARD_IMPROVEMENT_FETCH_TIMEOUT_MS) as Promise<RecordItem | null>,
    ]);
  }
  const improvementProposalRows = Array.isArray(improvementProposalsPayload?.proposals)
    ? improvementProposalsPayload?.proposals.filter((item): item is RecordItem => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const improvementValidationRows = Array.isArray(improvementValidationPayload?.results)
    ? improvementValidationPayload?.results.filter((item): item is RecordItem => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const improvementSimulationRows = Array.isArray(improvementSimulationPayload?.results)
    ? improvementSimulationPayload?.results.filter((item): item is RecordItem => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const improvementSimulationByProposalId = new Map(
    improvementSimulationRows.map((item) => [String(asRecordItem(item.proposal).proposal_id || ""), item]),
  );
  const improvementValidationByProposalId = new Map(
    improvementValidationRows.map((item) => [String(asRecordItem(item.proposal).proposal_id || ""), item]),
  );
  const improvementDecisionCounts = asRecordItem(improvementValidationPayload?.decision_counts);
  const improvementDeploymentRows = Array.isArray(improvementDeploymentPayload?.deployments)
    ? improvementDeploymentPayload?.deployments.filter((item): item is RecordItem => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const improvementMonitoringRows = Array.isArray(improvementDeploymentMonitoringPayload?.results)
    ? improvementDeploymentMonitoringPayload?.results.filter((item): item is RecordItem => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const improvementMonitoringByDeploymentId = new Map(
    improvementMonitoringRows.map((item) => [String(asRecordItem(item.deployment).deployment_id || ""), item]),
  );
  const improvementGovernor = asRecordItem(improvementDeploymentGovernorPayload?.governor);
  const improvementGovernorSummary = asRecordItem(improvementGovernor.summary);
  const improvementGovernorRows = Array.isArray(improvementGovernor.strategies)
    ? improvementGovernor.strategies
      .filter((item): item is RecordItem => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .slice(0, 4)
      .map((row) => ({
        scopeType: String(row.scope_type || "strategy"),
        scopeId: String(row.scope_id || "unknown"),
        recommendedAction: String(row.recommended_action || "WATCH").toUpperCase(),
        allocationPct: Number(row.allocation_pct || 0),
        targetAllocationPct: Number(row.target_allocation_pct || row.allocation_pct || 0),
        effectiveScore: Number(row.effective_score || 0),
        scoreZone: String(row.score_zone || promotionScoreZone(row.effective_score || 0)),
        riskAdjustment: Number(row.risk_adjustment || 0),
        confidenceDecay: Number(row.confidence_decay || 0),
        currentCanaryPct: Number(row.current_canary_trade_share_pct || 0),
        targetCanaryPct: Number(row.target_canary_trade_share_pct || 0),
        blocked: Boolean(row.blocked),
        reasons: Array.isArray(row.reasons) ? row.reasons.slice(0, 3).map((item) => String(item)) : [],
      }))
    : [];
  const improvementDeskRows = improvementProposalRows.slice(0, 4).map((proposal) => {
    const proposalId = String(proposal.proposal_id || proposal.action || "proposal");
    const validation = asRecordItem(improvementValidationByProposalId.get(proposalId));
    const simulationEnvelope = asRecordItem(improvementSimulationByProposalId.get(proposalId));
    const simulation = asRecordItem(simulationEnvelope.simulation);
    return {
      proposalId,
      suggestion: String(proposal.suggestion || proposal.reason || proposal.action || "review"),
      decision: String(validation.decision || "PENDING").toUpperCase(),
      deltaPnlUsd: Number(simulation.delta_pnl_usd || 0),
      drawdownChangeUsd: Number(simulation.drawdown_change_usd || 0),
      fillProbabilityChange: Number(simulation.fill_probability_change || 0),
      simulationMode: String(simulation.simulation_mode || "n/a"),
    };
  });
  const deploymentDeskRows = improvementDeploymentRows.slice(0, 4).map((deployment) => {
    const monitoringEnvelope = asRecordItem(improvementMonitoringByDeploymentId.get(String(deployment.deployment_id || "")));
    const observation = asRecordItem(monitoringEnvelope.observation);
    const deltas = asRecordItem(observation.deltas);
    const promotion = {
      ...asRecordItem(deployment.promotion),
      ...asRecordItem(observation.promotion),
    } as RecordItem;
    const rollout = asRecordItem(deployment.rollout);
    return {
      deploymentId: String(deployment.deployment_id || "deployment"),
      proposalId: String(deployment.proposal_id || "proposal"),
      status: String(deployment.status || "unknown").toUpperCase(),
      rolloutPhase: String(rollout.phase || "CANARY").toUpperCase(),
      canaryPct: Number(rollout.canary_trade_share_pct || 0),
      observationStatus: String(observation.status || "n/a"),
      shouldRollback: Boolean(observation.should_rollback),
      shouldScaleDown: Boolean(observation.should_scale_down),
      shouldPromote: Boolean(observation.should_promote),
      promotionDecision: String(promotion.decision || "WATCH").toUpperCase(),
      promotionMode: String(promotion.promotion_mode || promotion.decision || "WATCH").toUpperCase(),
      promotionScore: Number(promotion.score || 0),
      effectiveScore: Number(promotion.effective_score || promotion.score || 0),
      scoreZone: String(promotion.score_zone || promotionScoreZone(promotion.effective_score || promotion.score || 0)),
      riskAdjustment: Number(promotion.risk_adjustment || 1),
      confidenceDecay: Number(promotion.confidence_decay || 1),
      tradeCount: Number(observation.trade_count || promotion.trade_count || 0),
      minPromotionTradeSamples: Number(promotion.min_promotion_trade_samples || 50),
      insufficientData: Boolean(promotion.insufficient_data),
      operatorMessage: String(promotion.operator_message || ""),
      targetCanaryPct: Number(promotion.target_canary_trade_share_pct || promotion.suggested_promotion_trade_share_pct || promotion.suggested_canary_trade_share_pct || rollout.canary_trade_share_pct || 0),
      suggestedCanaryPct: Number(promotion.suggested_canary_trade_share_pct || rollout.canary_trade_share_pct || 0),
      appliedAction: String(observation.applied_action || "watch"),
      pnlDeltaUsd: Number(deltas.pnl_delta_usd || 0),
      slippageIncreaseBps: Number(deltas.slippage_increase_bps || 0),
    };
  });

  return (
    <main className="shell txt-page-shell">
      <section className="hero txt-page-hero-grid">
        <div id="global-guide-dashboard-hero" className="panel txt-page-hero">
          <div className="eyebrow">TXT Dashboard</div>
          <h1 className="title">Trader eXelle Terminal</h1>
          <p className="subtle">Plateforme de trading humaine: lisible pour debutants, puissante pour experts.</p>
          <OperatorPanelGuide
            title="Guide Dashboard"
            what="Une vue simplifiee de la sante trading: exposition, approvals, balances et alertes."
            why="Aider un debutant a savoir quoi verifier avant toute action, sans noyer les infos critiques."
            example="Si Pending approvals monte et qu'un incident est ouvert, va d'abord sur Terminal puis Incidents."
            terms={["allocation", "metaRisk", "liquidity"]}
          />
          <div className="row"><span>User</span><span className="pill">{String(effectiveMe.username || "operator")} ({meRoleLabel})</span></div>
          <p style={{ marginTop: 8 }}>
            <Link href="/terminal">TXT Terminal</Link>
            {" | "}
            <Link href="/fund-manager">Fund Manager</Link>
            {" | "}
            <Link href="/live-capital">Live Capital</Link>
            {" | "}
            <Link href="/learn">TXT Learn</Link>
            {" | "}
            <Link href="/advanced">TXT Diagnostics</Link>
            {" | "}
            <Link href="/settings">TXT Settings</Link>
            {" | "}
            <Link href="/incidents">Incidents</Link>
          </p>
          <form action="/api/auth/logout" method="post" style={{ marginTop: 10 }}>
            <button type="submit">Se deconnecter</button>
          </form>
          <div style={{ marginTop: 20 }}>
            <div className="row"><span>System mode</span><span className="pill">{String(safeOverview.system_mode)}</span></div>
            <div className="row"><span>Pending approvals</span><span>{String(safeOverview.pending_intents)}</span></div>
            <div className="row"><span>Open net exposure</span><span>{String(safeOverview.net_exposure_usd)} USD</span></div>
            <div className="row"><span>Orders persisted</span><span>{String(safeOverview.orders_count)}</span></div>
          </div>
        </div>
        <div className="panel">
          <div className="eyebrow">Security <HelpHint text={UI_HELP_HINTS.dashboardSecurity.text} examples={UI_HELP_HINTS.dashboardSecurity.examples} /></div>
          <div className="metric good">RBAC + Signed Approvals</div>
          <p className="subtle">Les approbations passent par bearer token, role et signature HMAC.</p>
          <div className="row"><span>Policy version</span><span>{String(safeOverview.policy_version)}</span></div>
          <div className="row"><span>Paper only</span><span className="warn">{String(safeOverview.paper_only)}</span></div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1.1fr 0.9fr" }}>
        <div className="panel runtime-decision-dashboard-panel" data-testid="runtime-decision-dashboard-panel">
          <RuntimeDecisionOverviewCard summary={runtimeDecisionSummary} title="Runtime Decision Desk" exportHref={runtimeDecisionExportHref} />
          <p className="subtle" style={{ marginTop: 10 }}>
            <Link href="/live-readiness/drift-alert-log">Ouvrir le {UI_TERMS.driftLog.toLowerCase()} detaille</Link>
          </p>
        </div>
        <MissionControlBlueGreenCard status={blueGreenStatus} compact />
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1.1fr 0.9fr" }}>
        <div className="panel" data-testid="improvement-desk-panel">
          <div className="eyebrow">Controlled Improvement Desk <HelpHint text={UI_HELP_HINTS.dashboardImprovementDesk.text} examples={UI_HELP_HINTS.dashboardImprovementDesk.examples} /></div>
          {primaryImprovementScope?.scopeId ? (
            <>
              <div className="metric good">{String(improvementProposalsPayload?.proposal_count || 0)} proposals</div>
              <p className="subtle">Scope {primaryImprovementScope.scopeType}:{primaryImprovementScope.scopeId} · simulation {String(improvementSimulationPayload?.simulation_mode || "n/a")}</p>
              <div className="row"><span>Validation ACCEPT / TEST / REJECT</span><span>{String(improvementDecisionCounts.ACCEPT || 0)} / {String(improvementDecisionCounts.TEST || 0)} / {String(improvementDecisionCounts.REJECT || 0)}</span></div>
              <div className="row"><span>Issues seen</span><span>{Array.isArray(improvementProposalsPayload?.issues) && improvementProposalsPayload?.issues.length > 0 ? String((improvementProposalsPayload?.issues as unknown[]).slice(0, 4).join(", ")) : "none"}</span></div>
              {improvementDeskRows.length === 0 ? <p className="subtle">Aucune proposition exploitable pour ce scope.</p> : null}
              {improvementDeskRows.map((item) => (
                <div className="row" key={item.proposalId} style={{ alignItems: "flex-start" }}>
                  <div>
                    <div>{item.proposalId}</div>
                    <div className="subtle mini">{item.suggestion}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className={decisionMetricTone(item.decision)}>{item.decision}</div>
                    <div className="subtle mini">ΔPnL {formatSignedMetric(item.deltaPnlUsd, 2, " USD")} · ΔDD {formatSignedMetric(item.drawdownChangeUsd, 2, " USD")}</div>
                    <div className="subtle mini">Fill {formatSignedMetric(item.fillProbabilityChange * 100, 1, "%")} · {item.simulationMode}</div>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <p className="subtle">Aucun scope d'execution ou de strategie disponible pour ouvrir le desk d'amelioration.</p>
          )}
        </div>
        <div className="panel">
          <div className="eyebrow">Simulation Discipline</div>
          <div className={`metric ${String(improvementSimulationPayload?.simulation_mode || "") === "contextual_replay" ? "good" : "warn"}`}>{String(improvementSimulationPayload?.simulation_mode || "unavailable")}</div>
          <p className="subtle">Le validator n'utilise plus seulement une heuristique: il rejoue le dernier echantillon de trades, segmente trend/range/high-volatility et compare baseline vs config candidate.</p>
          <div className="row"><span>Replay sample</span><span>{String(improvementSimulationRows.length > 0 ? asRecordItem(improvementSimulationRows[0]?.simulation).sample_size || 0 : 0)} trades</span></div>
          <div className="row"><span>Desk rule</span><span className="warn">observer → valider → deploy plus tard</span></div>
          <div className="row"><span>Deployment layer</span><span>{Number(improvementDeploymentPayload?.active_count || 0) > 0 ? "armed" : "idle"}</span></div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1.1fr 0.9fr" }}>
        <div className="panel" data-testid="deployment-desk-panel">
          <div className="eyebrow">Controlled Deployment Desk <HelpHint text={UI_HELP_HINTS.dashboardDeploymentDesk.text} examples={UI_HELP_HINTS.dashboardDeploymentDesk.examples} /></div>
          <div className={`metric ${Number(improvementDeploymentPayload?.active_count || 0) > 0 ? "good" : "subtle"}`}>{String(improvementDeploymentPayload?.active_count || 0)} active deployments</div>
          <p className="subtle">Canary scope versionne, branche uniquement sur ACCEPT, puis score de promotion, auto-confirmation et reduction adaptative d'exposition avant rollback complet.</p>
          {deploymentDeskRows.length === 0 ? <p className="subtle">Aucun canary actif pour le moment.</p> : null}
          {deploymentDeskRows.map((item) => (
            <div className="row" key={item.deploymentId} data-testid={`deployment-desk-row-${item.deploymentId}`} style={{ alignItems: "flex-start" }}>
              <div>
                <div>{item.proposalId}</div>
                <div className="subtle mini">{item.deploymentId} · {item.rolloutPhase} · canary {item.canaryPct.toFixed(1)}%</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className={decisionMetricTone(item.status === "CONFIRMED" || item.shouldPromote ? "ACCEPT" : item.shouldRollback || item.shouldScaleDown ? "REJECT" : "TEST")}>{item.status}</div>
                <div className="subtle mini">monitor {item.observationStatus} · trades {item.tradeCount.toFixed(0)}/{item.minPromotionTradeSamples.toFixed(0)} · base {item.promotionScore.toFixed(2)} · eff {item.effectiveScore.toFixed(2)} · {item.promotionMode}</div>
                <div className="subtle mini">score zone {item.scoreZone} · ramp {item.canaryPct.toFixed(1)}% → {Math.max(item.targetCanaryPct, item.suggestedCanaryPct).toFixed(1)}%</div>
                <div className="subtle mini">ΔPnL {formatSignedMetric(item.pnlDeltaUsd, 2, " USD")} · ΔSlip {formatSignedMetric(item.slippageIncreaseBps, 2, " bps")}</div>
                <div className="subtle mini">risk x{item.riskAdjustment.toFixed(2)} · decay x{item.confidenceDecay.toFixed(2)}</div>
                {item.operatorMessage ? <div className={`subtle mini ${item.insufficientData ? "warn" : ""}`}>{item.operatorMessage}</div> : null}
                {item.shouldScaleDown ? <div className="subtle mini">scale down {item.canaryPct.toFixed(1)}% → {item.suggestedCanaryPct.toFixed(1)}%</div> : null}
                {item.appliedAction !== "watch" ? <div className="subtle mini">action {item.appliedAction}</div> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="panel" data-testid="deployment-governor-panel">
          <div className="eyebrow">Rollback Guard + Portfolio Governor</div>
          <div className={`metric ${deploymentDeskRows.some((item) => item.shouldRollback || item.shouldScaleDown) ? "warn" : "good"}`}>{deploymentDeskRows.some((item) => item.shouldRollback) ? "watch rollback" : deploymentDeskRows.some((item) => item.shouldScaleDown) ? "reduce exposure" : "stable"}</div>
          <p className="subtle">Le monitoring compare slippage, latence, rejection rate, drawdown proxy et delta PnL contre le baseline, puis choisit promotion, reduction de canary ou rollback.</p>
          <div className="row"><span>Preview monitor rows</span><span>{String(improvementDeploymentMonitoringPayload?.result_count || 0)}</span></div>
          <div className="row"><span>Adaptive scaling</span><span>{deploymentDeskRows.some((item) => item.shouldScaleDown) ? "engaged" : deploymentDeskRows.length > 0 ? "armed" : "idle"}</span></div>
          <div className="row"><span>Auto rollback</span><span>{deploymentDeskRows.length > 0 ? "available" : "idle"}</span></div>
          <div className="row"><span>Governor action</span><span>{String(improvementGovernor.portfolio_action || "IDLE")}</span></div>
          <div className="row"><span>Portfolio eff/risk/decay</span><span>{Number(improvementGovernorSummary.portfolio_effective_score || 0).toFixed(2)} / x{Number(improvementGovernorSummary.portfolio_risk_adjustment || 0).toFixed(2)} / x{Number(improvementGovernorSummary.portfolio_confidence_decay || 0).toFixed(2)}</span></div>
          <div className="row"><span>Largest allocation</span><span>{Number(improvementGovernorSummary.largest_allocation_pct || 0).toFixed(1)}%{Boolean(improvementGovernorSummary.concentration_capped) ? " cap" : ""}</span></div>
          <div className="row"><span>Rule</span><span className="warn">ACCEPT → CANARY → SCORE → PROMOTE / SCALE_DOWN / ROLLBACK</span></div>
          {improvementGovernorRows.length === 0 ? <p className="subtle">Aucune allocation portefeuille active.</p> : null}
          {improvementGovernorRows.map((row) => (
            <div className="row" key={`${row.scopeType}:${row.scopeId}`} data-testid={`deployment-governor-row-${row.scopeId}`} style={{ alignItems: "flex-start" }}>
              <div>
                <div>{row.scopeType}:{row.scopeId}</div>
                <div className="subtle mini">alloc {row.allocationPct.toFixed(1)}% → {row.targetAllocationPct.toFixed(1)}% · canary {row.currentCanaryPct.toFixed(1)}% → {row.targetCanaryPct.toFixed(1)}%</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className={decisionMetricTone(row.recommendedAction.startsWith("PROMOTE") ? "ACCEPT" : row.recommendedAction === "WATCH" ? "TEST" : "REJECT")}>{row.recommendedAction}</div>
                <div className="subtle mini">eff {row.effectiveScore.toFixed(2)} · zone {row.scoreZone} · risk x{row.riskAdjustment.toFixed(2)} · decay x{row.confidenceDecay.toFixed(2)}</div>
                {row.reasons.length > 0 ? <div className="subtle mini">{row.reasons.join(", ")}</div> : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr" }}>
        <div className="panel runtime-decision-dashboard-panel" data-testid="runtime-operator-monitor-panel">
          <RuntimeOperatorMonitoringCard summary={runtimeDecisionSummary} title="Operator Runtime Monitor" />
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr" }}>
        <div className="panel runtime-decision-dashboard-panel" data-testid="runtime-observation-dashboard-panel">
          <RuntimeObservationDashboard summary={runtimeDecisionSummary} title="Observation Dashboard" />
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr" }}>
        <RuntimeStabilityDebugView
          title="Dashboard Route Debug"
          panelTestId="dashboard-runtime-stability-debug-panel"
          cards={[...dashboardRouteDebugCards]}
          rows={[...dashboardRouteDebugRows]}
          compact
        />
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1.1fr 0.9fr" }}>
        <div className="panel">
          <div className="eyebrow">Next Step Architecture <HelpHint text={UI_HELP_HINTS.dashboardNextStepArchitecture.text} examples={UI_HELP_HINTS.dashboardNextStepArchitecture.examples} /></div>
          <div className="metric good">Drift → Opportunity → Dashboard → Calibration</div>
          <p className="subtle">Le systeme est maintenant explicable. La couche suivante doit detecter les glissements de comportement avant d'ajuster les seuils.</p>
          <div className="row"><span>Current dominant bucket</span><span>{runtimeDecisionSummary.dominant.bucket.label}</span></div>
          <div className="row"><span>Observability status</span><span className="pill">decision-audit + backfill + note</span></div>
          <div className="row"><span>Semantic hygiene</span><span>{runtimeDecisionSummary.semanticMismatchCandidates.sharePct}% mismatch</span></div>
          <div className="row"><span>Calibration rule</span><span className="warn">lente, controlee, observable</span></div>
        </div>
        <div className="panel">
          <div className="eyebrow">Drift confidence</div>
          <div className={`metric ${runtimeDecisionSummary.drift.state === "CALM" ? "good" : runtimeDecisionSummary.drift.state === "WATCH" ? "subtle" : "warn"}`}>{runtimeDecisionSummary.drift.stats.confidencePct}%</div>
          <p className="subtle">Lecture stabilisee par KS, ADWIN et la taille d'echantillon, pour ne pas sur-interpreter un faux drift global.</p>
          <div className="row"><span>Drift type</span><span>{driftTypeLabel(runtimeDecisionSummary.drift.type)}</span></div>
          <div className="row"><span>Primary cause</span><span>{runtimeDecisionSummary.drift.cause.factors[0]?.label || "n/a"}</span></div>
          <div className="row"><span>KS / ADWIN</span><span>{runtimeDecisionSummary.drift.stats.ksScore.toFixed(2)} / {runtimeDecisionSummary.drift.stats.adwinTriggered ? "ON" : "OFF"}</span></div>
          <div className="row"><span>Cause read</span><span>{runtimeDecisionSummary.drift.cause.summary}</span></div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1.1fr 0.9fr" }}>
        <div className="panel">
          <div className="eyebrow">Venue Health <HelpHint text={UI_HELP_HINTS.dashboardVenueHealth.text} examples={UI_HELP_HINTS.dashboardVenueHealth.examples} /></div>
          {executionVenueRows.length === 0 ? <p className="subtle">Aucune venue d'execution live liee.</p> : null}
          {executionVenueRows.map((item) => {
            const badge = getConnectorHealthView(item);
            return (
              <div className="row" key={`execution-venue-${String(item.name)}`}>
                <span>{String(item.name).toUpperCase()} | trade accounts {String(asRecordItem(item.broker_capabilities).linked_trade_accounts || 0)}</span>
                <span className="connector-health-stack">
                  <span className={badge.badgeClassName}>{badge.label}</span>
                  <span className={badge.noteClassName}>{badge.message}</span>
                </span>
              </div>
            );
          })}
        </div>
        <div className="panel">
          <div className="eyebrow">Data Mesh Health <HelpHint text={UI_HELP_HINTS.dashboardDataMeshHealth.text} examples={UI_HELP_HINTS.dashboardDataMeshHealth.examples} /></div>
          {marketVenueRows.length === 0 ? <p className="subtle">Aucune venue de data prioritaire visible.</p> : null}
          {marketVenueRows.map((item) => {
            const badge = getConnectorHealthView(item);
            return (
              <div className="row" key={`market-venue-${String(item.name)}`}>
                <span>{String(item.name).toUpperCase()}</span>
                <span className="connector-health-stack">
                  <span className={badge.badgeClassName}>{badge.compactLabel}</span>
                  <span className={badge.noteClassName}>{badge.message}</span>
                </span>
              </div>
            );
          })}
          {!okxTradeLinked ? <p className="warn" style={{ marginTop: 12 }}>OKX n'est pas encore lie en execution live.</p> : null}
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <div className="eyebrow">Public Probe <HelpHint text={UI_HELP_HINTS.dashboardPublicProbe.text} examples={UI_HELP_HINTS.dashboardPublicProbe.examples} /></div>
          <div className={`metric ${String(publicChartVisibility?.state || publicChartVisibility?.public_chart_state || "unknown") === "healthy" ? "good" : "warn"}`}>{String(publicChartVisibility?.state || publicChartVisibility?.public_chart_state || "unavailable")}</div>
          <div className="row"><span>Failure reason</span><span>{String(publicChartVisibility?.failure_reason || "none")}</span></div>
          <div className="row"><span>Feed</span><span>{String(((publicChartVisibility?.ohlcv_contract as RecordItem | undefined)?.instrument) || "-")} @ {String(((publicChartVisibility?.ohlcv_contract as RecordItem | undefined)?.venue) || "-")}</span></div>
          <div className="row"><span>Bars freshness</span><span>{String(publicFailureDetails?.freshness_stale_ms || "-")}</span></div>
          <div className="row"><span>Generated</span><span>{String(healthwatchDashboard?.generated_at || "-").slice(11, 19) || "-"}</span></div>
        </div>
        <div className="panel">
          <div className="eyebrow">Local Terminal Capture <HelpHint text={UI_HELP_HINTS.dashboardLocalTerminalCapture.text} examples={UI_HELP_HINTS.dashboardLocalTerminalCapture.examples} /></div>
          {latestLocalTerminalCapture ? (
            <>
              <div className={`metric ${latestLocalTerminalCapture.runtime.attention?.shouldBlockTrading || latestLocalTerminalCapture.runtime.noCandlesExpected ? "warn" : "good"}`}>{latestLocalTerminalCapture.runtime.attention?.shouldBlockTrading || latestLocalTerminalCapture.runtime.noCandlesExpected ? "Attention required" : "Flowing"}</div>
              <div className="row"><span>Client id</span><span>{latestLocalTerminalCapture.clientId.slice(0, 8)}</span></div>
              <div className="row"><span>Feed</span><span>{latestLocalTerminalCapture.chart.feedLabel}</span></div>
              <div className="row"><span>Signal</span><span>{latestLocalTerminalCapture.localFeed.signal}</span></div>
              <div className="row"><span>Attention</span><span>{latestLocalTerminalCapture.runtime.attention?.summary || "n/a"}</span></div>
              <div className="row"><span>Temporal</span><span>{latestLocalTerminalCapture.runtime.temporal?.summary || "n/a"}</span></div>
              <div className="row"><span>Desync</span><span>{latestLocalTerminalCapture.runtime.desync?.summary || "n/a"}</span></div>
              <div className="row"><span>Intent</span><span>{latestLocalTerminalCapture.runtime.intent?.summary || "n/a"}</span></div>
              <div className="row"><span>Smart state</span><span>{latestLocalTerminalCapture.runtime.smartState?.summary || "n/a"}</span></div>
              <div className="row"><span>Persisted</span><span>{latestLocalTerminalCapture.capturedAt.slice(11, 19)}</span></div>
              {latestLocalTerminalCapture.runtime.exactStateVector.map((item) => (
                <div className="row" key={item}>
                  <span>State</span><span>{item}</span>
                </div>
              ))}
            </>
          ) : (
            <p className="subtle">Aucune capture locale persistee pour le moment.</p>
          )}
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <div className="eyebrow">Balances <HelpHint text={UI_HELP_HINTS.dashboardBalances.text} examples={UI_HELP_HINTS.dashboardBalances.examples} /></div>
          {balanceRows.map((item) => (
            <div className="row" key={String(item.currency)}>
              <span>{String(item.currency)}</span>
              <span>{String(item.free)}</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <div className="eyebrow">Positions <HelpHint text={UI_HELP_HINTS.dashboardPositions.text} examples={UI_HELP_HINTS.dashboardPositions.examples} /></div>
          {safePositions.map((item) => (
            <div className="row" key={String(item.instrument)}>
              <span>{String(item.instrument)}</span>
              <span>{String(item.net_notional_usd)}</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <div className="eyebrow">Market Data <HelpHint text={UI_HELP_HINTS.dashboardMarketData.text} examples={UI_HELP_HINTS.dashboardMarketData.examples} /></div>
          {safeQuotes.map((item) => (
            <div className="row" key={`${String(item.venue)}-${String(item.instrument)}`}>
              <span>{String(item.instrument)}</span>
              <span>{String(item.last)}</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <div className="eyebrow">Audit Trail <HelpHint text={UI_HELP_HINTS.dashboardAuditTrail.text} examples={UI_HELP_HINTS.dashboardAuditTrail.examples} /></div>
          {safeAudit.slice(0, 5).map((item, index) => (
            <div className="row" key={`${String(item.timestamp)}-${index}`}>
              <span>{String(item.category)}</span>
              <span className="subtle">{String(item.timestamp)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <div className="eyebrow">Pending Approvals <HelpHint text={UI_HELP_HINTS.dashboardPendingApprovals.text} examples={UI_HELP_HINTS.dashboardPendingApprovals.examples} /></div>
          {pendingRows.length === 0 ? <p className="subtle">Aucune intention en attente.</p> : null}
          {pendingRows.map(([intentId, payload]) => (
            <div className="row" key={intentId}>
              <div>
                <div>{intentId}</div>
                <div className="subtle mini">{String((payload as Record<string, unknown>).intent ? (payload as { intent: { strategy_id?: string } }).intent.strategy_id || "" : "")}</div>
              </div>
              <form method="post" action={`/api/intents/${intentId}/approve`}>
                <button type="submit">Approve</button>
              </form>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="eyebrow">Strategy Registry <HelpHint text={UI_HELP_HINTS.dashboardStrategyRegistry.text} examples={UI_HELP_HINTS.dashboardStrategyRegistry.examples} /></div>
          <form action="/api/strategies" method="post" className="form-grid" style={{ marginBottom: 14 }}>
            <input name="strategy_id" placeholder="strategy_id" required />
            <input name="name" placeholder="name" required />
            <input name="market" placeholder="market (crypto/fx/etc)" required />
            <input name="setup_type" placeholder="setup_type" required />
            <textarea name="notes" placeholder="notes" rows={2} />
            <button type="submit">Create Strategy</button>
          </form>

          {safeStrategies.map((item) => {
            const strategyId = String(item.strategy_id);
            const level = Number(item.current_level || 0);
            const nextLevel = Math.min(level + 1, 6);
            return (
              <div className="row" key={strategyId}>
                <div>
                  <div>{strategyId}</div>
                  <div className="subtle mini">L{level} - {String(item.market)} - {String(item.setup_type)}</div>
                </div>
                {level < 6 ? (
                  <form method="post" action={`/api/strategies/${strategyId}/promote`} className="form-grid" style={{ minWidth: 200 }}>
                    <input type="hidden" name="to_level" value={nextLevel} />
                    <input type="text" name="rationale" placeholder={`Promote to L${nextLevel}`} required />
                    <input type="number" step="0.01" name="sharpe" placeholder="sharpe" />
                    <input type="number" step="0.01" name="max_dd" placeholder="max_dd" />
                    <button type="submit" disabled={strategyPromotionGuard.blocked}>Promote</button>
                    {strategyPromotionGuard.blocked ? <div className="warn mini">{strategyPromotionGuard.reason}</div> : null}
                    <div className="subtle mini">Provenance {formatSourceTreeProvenanceStatus(sourceTreeProvenance.status)} · {sourceTreeProvenance.commit_alignment_rate.toFixed(0)}%</div>
                    {strategyPromotionCommitDelta.length > 0 ? <div className="subtle mini">Delta commit: {strategyPromotionCommitDelta.join(" · ")}</div> : null}
                  </form>
                ) : (
                  <span className="pill">L6 max</span>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}