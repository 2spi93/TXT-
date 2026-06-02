"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import HelpHint from "../../components/HelpHint";
import OperatorPanelGuide from "../../components/ui/OperatorPanelGuide";
import {
  BROKER_CONNECTION_CATALOG,
  EXCHANGE_CONNECTION_CATALOG,
  WALLET_CONNECTION_CATALOG,
  type ConnectionProviderType,
} from "../../lib/connectionCatalog";
import { getConnectorHealthView } from "../../lib/connectorHealth";
import { UI_HELP_HINTS, UI_TERMS } from "../../lib/uiLexicon";

type JsonMap = Record<string, unknown>;

function asMap(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function asList(value: unknown): JsonMap[] {
  return Array.isArray(value) ? value.filter((item): item is JsonMap => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function formatUsd(value: unknown): string {
  const amount = Number(value || 0);
  return `${amount.toFixed(Math.abs(amount) >= 100 ? 0 : 2)} USD`;
}

function formatPct(value: unknown, digits = 1): string {
  const amount = Number(value || 0);
  return `${amount.toFixed(digits)}%`;
}

function formatMs(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount.toFixed(amount >= 100 ? 0 : 1)} ms` : "n/a";
}

function formatRate(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount.toFixed(2)} msg/s` : "n/a";
}

function formatBps(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount.toFixed(2)} bps` : "n/a";
}

function formatScore(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : "n/a";
}

function formatMaybeInt(value: unknown, suffix = ""): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${Math.round(amount)}${suffix}` : "n/a";
}

function formatCapabilityLabel(value: unknown): string {
  const label = String(value || "").trim();
  return label ? label.replace(/_/g, " ").toUpperCase() : "N/A";
}

function toneClass(value: string): string {
  if (["clean", "ok", "resolved"].includes(value)) {
    return "good";
  }
  if (["watch", "degraded"].includes(value)) {
    return "subtle";
  }
  return "warn";
}

function governanceToneClass(value: string): string {
  if (["approved", "ok", "nominal"].includes(value)) {
    return "good";
  }
  if (["require_human", "watch", "degraded"].includes(value)) {
    return "subtle";
  }
  return "warn";
}

function buildConnectorsWsUrl(token: string, controlPlaneUrl?: string): string {
  if (typeof window === "undefined") {
    return "";
  }
  const currentProtocol = window.location.protocol === "https:" ? "wss" : "ws";
  const currentBase = `${currentProtocol}://${window.location.host}`;
  const configured = String(controlPlaneUrl || "").trim();
  if (!configured) {
    return `${currentBase}/v1/connectors/ws?token=${encodeURIComponent(token)}`;
  }
  try {
    const parsed = new URL(configured);
    if (["localhost", "127.0.0.1", "0.0.0.0", "control-plane"].includes(parsed.hostname)) {
      return `${currentBase}/v1/connectors/ws?token=${encodeURIComponent(token)}`;
    }
    const protocol = parsed.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${parsed.host}/v1/connectors/ws?token=${encodeURIComponent(token)}`;
  } catch {
    return `${currentBase}/v1/connectors/ws?token=${encodeURIComponent(token)}`;
  }
}

export default function ConnectorsPage() {
  const [status, setStatus] = useState<JsonMap | null>(null);
  const [mt5Health, setMt5Health] = useState<JsonMap | null>(null);
  const [mt5Accounts, setMt5Accounts] = useState<JsonMap[]>([]);
  const [canonicalAccounts, setCanonicalAccounts] = useState<JsonMap[]>([]);
  const [portfolioRisk, setPortfolioRisk] = useState<JsonMap | null>(null);
  const [pendingLive, setPendingLive] = useState<JsonMap[]>([]);
  const [mt5Governance, setMt5Governance] = useState<JsonMap | null>(null);
  const [mt5Preview, setMt5Preview] = useState<JsonMap | null>(null);
  const [mt5PreviewBusy, setMt5PreviewBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JsonMap | null>(null);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [lastAlertSignature, setLastAlertSignature] = useState("");

  const [accountId, setAccountId] = useState("mt5-demo-01");
  const [broker, setBroker] = useState("metaquotes");
  const [server, setServer] = useState("MetaQuotes-Demo");
  const [login, setLogin] = useState("10001234");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("paper");
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [portfolioId, setPortfolioId] = useState("");

  const [orderSymbol, setOrderSymbol] = useState("EURUSD");
  const [orderSide, setOrderSide] = useState("buy");
  const [orderLots, setOrderLots] = useState(0.1);
  const [orderNotional, setOrderNotional] = useState(12000);
  const [orderSpread, setOrderSpread] = useState(12);
  const [orderWhy, setOrderWhy] = useState("Regime aligned entry");

  const [trendScore, setTrendScore] = useState(0.4);
  const [realizedVolatility, setRealizedVolatility] = useState(0.05);
  const [sentimentScore, setSentimentScore] = useState(0.2);
  const [regimeResult, setRegimeResult] = useState<JsonMap | null>(null);

  const [scenario, setScenario] = useState("Fed emergency hike");
  const [backtestResult, setBacktestResult] = useState<JsonMap | null>(null);
  const [connectionProviderType, setConnectionProviderType] = useState<ConnectionProviderType>("broker");
  const [connectionProviderName, setConnectionProviderName] = useState("MT5 / MetaTrader 5");
  const [connectionMarketScope, setConnectionMarketScope] = useState("CFD / forex / futures / commodities / stocks");
  const [connectionMode, setConnectionMode] = useState("bridge-direct");
  const [connectionReference, setConnectionReference] = useState("");
  const [connectionNotes, setConnectionNotes] = useState("");
  const [connectionRequestBusy, setConnectionRequestBusy] = useState(false);
  const [connectionRequestResult, setConnectionRequestResult] = useState<JsonMap | null>(null);

  const [mt5PreviewAccountId, setMt5PreviewAccountId] = useState("");
  const [mt5PreviewRequestedNotional, setMt5PreviewRequestedNotional] = useState(40);
  const [mt5PreviewConfidence, setMt5PreviewConfidence] = useState(0.9);
  const [mt5PreviewRegime, setMt5PreviewRegime] = useState("TREND");

  async function loadMt5GovernancePreview(previewAccountId?: string): Promise<void> {
    const resolvedAccountId = String(previewAccountId || mt5PreviewAccountId || "").trim();
    if (!resolvedAccountId) {
      return;
    }
    setMt5PreviewBusy(true);
    try {
      const response = await fetch("/api/system/micro-live/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "mt5",
          account_id: resolvedAccountId,
          requested_notional_usd: mt5PreviewRequestedNotional,
          explicit_flag: true,
          purpose: "execute",
          paper_only: false,
          symbol: orderSymbol,
          side: orderSide,
          regime: mt5PreviewRegime,
          confidence: mt5PreviewConfidence,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = asMap(payload).detail;
        throw new Error(typeof detail === "string" ? detail : "Preview micro-live MT5 indisponible");
      }
      setMt5Preview(asMap(payload));
    } finally {
      setMt5PreviewBusy(false);
    }
  }

  async function loadAll(): Promise<void> {
    const [statusRes, healthRes, mt5AccountsRes, canonicalAccountsRes, portfolioRiskRes, pendingRes, mt5GovernanceRes] = await Promise.all([
      fetch("/api/connectors/status", { cache: "no-store" }),
      fetch("/api/mt5/health", { cache: "no-store" }),
      fetch("/api/mt5/accounts", { cache: "no-store" }),
      fetch("/api/accounts", { cache: "no-store" }),
      fetch("/api/portfolios/pf-internal-main/risk", { cache: "no-store" }),
      fetch("/api/mt5/orders/live-pending", { cache: "no-store" }),
      fetch("/api/system/micro-live-stage?provider=mt5", { cache: "no-store" }),
    ]);

    if (!statusRes.ok || !healthRes.ok || !mt5AccountsRes.ok || !canonicalAccountsRes.ok || !portfolioRiskRes.ok || !pendingRes.ok || !mt5GovernanceRes.ok) {
      throw new Error("Impossible de charger les connecteurs");
    }

    const statusPayload = asMap(await statusRes.json());
    const healthPayload = asMap(await healthRes.json());
    const mt5AccountsPayload = asList(await mt5AccountsRes.json());
    const canonicalAccountsPayload = asList(await canonicalAccountsRes.json());
    const portfolioRiskPayload = asMap(await portfolioRiskRes.json());
    const pendingPayload = asList(await pendingRes.json());
    const mt5GovernancePayload = asMap(await mt5GovernanceRes.json());
    const defaultPreviewAccountId = String(mt5PreviewAccountId || mt5AccountsPayload[0]?.account_id || "").trim();

    setStatus(statusPayload);
    setMt5Health(healthPayload);
    setMt5Accounts(mt5AccountsPayload);
    setCanonicalAccounts(canonicalAccountsPayload);
    setPortfolioRisk(portfolioRiskPayload);
    setPendingLive(pendingPayload);
    setMt5Governance(mt5GovernancePayload);
    if (defaultPreviewAccountId) {
      setMt5PreviewAccountId(defaultPreviewAccountId);
      await loadMt5GovernancePreview(defaultPreviewAccountId);
    }
  }

  useEffect(() => {
    loadAll().catch((err) => setError(err instanceof Error ? err.message : "Erreur inconnue"));

    let ws: WebSocket | null = null;
    let cancelled = false;

    (async () => {
      try {
        const tokenRes = await fetch("/api/auth/ws-token", { cache: "no-store" });
        if (!tokenRes.ok) {
          return;
        }
        const tokenPayload = await tokenRes.json();
        const token = String(tokenPayload.token || "");
        if (!token) {
          return;
        }

        const wsUrl = buildConnectorsWsUrl(token, String(tokenPayload.controlPlaneUrl || ""));
        ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
          if (cancelled) {
            return;
          }
          try {
            const payload = JSON.parse(String(event.data || "{}"));
            setStatus(payload);
          } catch {
            // ignore malformed frames
          }
        };
      } catch {
        // keep HTTP fallback only
      }
    })();

    return () => {
      cancelled = true;
      if (ws) {
        ws.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!mt5PreviewAccountId && mt5Accounts.length > 0) {
      setMt5PreviewAccountId(String(mt5Accounts[0]?.account_id || ""));
    }
  }, [mt5Accounts, mt5PreviewAccountId]);

  useEffect(() => {
    const alerts = (status?.alerts as JsonMap[] | undefined) || [];
    if (alerts.length === 0) {
      return;
    }
    const signature = JSON.stringify(alerts.map((a) => `${String(a.type)}:${String(a.message)}`));
    if (!signature || signature === lastAlertSignature) {
      return;
    }
    setLastAlertSignature(signature);

    // Short non-intrusive alert beep for new websocket alerts.
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, audioCtx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
      oscillator.connect(gain);
      gain.connect(audioCtx.destination);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.2);
    } catch {
      // Ignore environments where WebAudio is unavailable.
    }
  }, [status, lastAlertSignature]);

  useEffect(() => {
    const speech = typeof window !== "undefined" ? (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }) : null;
    const SpeechRecognition = speech?.SpeechRecognition || speech?.webkitSpeechRecognition;
    setVoiceAvailable(Boolean(SpeechRecognition));
  }, []);

  async function connectMt5(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/mt5/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          broker,
          server,
          login,
          password,
          mode,
          metadata: {
            source: "mission-control-ui",
            ...(clientId ? { client_id: clientId } : {}),
            ...(clientName ? { client_name: clientName } : {}),
            ...(portfolioId ? { portfolio_id: portfolioId } : {}),
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(String(payload?.detail || "Connexion MT5 echouee"));
      }
      setResult(payload);
      setPassword("");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function rebuildMt5Projections(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/system/mt5-rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String((payload as JsonMap)?.detail || "Rebuild MT5 impossible"));
      }
      setResult((payload || null) as JsonMap | null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rebuild MT5 impossible");
    } finally {
      setBusy(false);
    }
  }

  async function sendFilteredOrder(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/mt5/orders/filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          symbol: orderSymbol,
          side: orderSide,
          lots: orderLots,
          estimated_notional_usd: orderNotional,
          max_spread_bps: orderSpread,
          rationale: orderWhy,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(String(payload?.detail || "Ordre filtre rejete"));
      }
      setResult(payload);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function approveLiveOrder(approvalId: string): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/mt5/orders/live-approve/${approvalId}`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(String(payload?.detail || "Validation live echouee"));
      }
      setResult(payload);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function detectRegime(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/regimes/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trend_score: trendScore, realized_volatility: realizedVolatility, sentiment_score: sentimentScore }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(String(payload?.detail || "Detection de regime echouee"));
      }
      setRegimeResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function runBacktest(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/backtests/geopolitical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy_name: "mt5-regime-allocator",
          asset_class: "forex-indices",
          scenario,
          horizon_days: 20,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(String(payload?.detail || "Backtest geopol echoue"));
      }
      setBacktestResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function requestConnectionOnboarding(): Promise<void> {
    setConnectionRequestBusy(true);
    setError(null);
    setConnectionRequestResult(null);
    try {
      const response = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `connection_onboarding:${connectionProviderName}`,
          severity: "medium",
          payload: {
            type: connectionProviderType,
            provider: connectionProviderName,
            market_scope: connectionMarketScope,
            connection_mode: connectionMode,
            reference: connectionReference,
            notes: connectionNotes,
            source: "connectors-page",
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.detail || "Demande d'onboarding impossible"));
      }
      setConnectionRequestResult((payload || null) as JsonMap | null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demande d'onboarding impossible");
    } finally {
      setConnectionRequestBusy(false);
    }
  }

  function startVoiceCommand(): void {
    const speech = typeof window !== "undefined" ? (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }) : null;
    const SpeechRecognition = speech?.SpeechRecognition || speech?.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Commande vocale non supportee sur ce navigateur");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = false;
    setVoiceListening(true);

    recognition.onresult = (event: any) => {
      const transcript = String(event?.results?.[0]?.[0]?.transcript || "").toLowerCase();
      setVoiceTranscript(transcript);

      if (transcript.includes("connect") && transcript.includes("mt5")) {
        void connectMt5();
      } else if (transcript.includes("regime")) {
        void detectRegime();
      } else if (transcript.includes("backtest")) {
        void runBacktest();
      } else {
        setError("Commande vocale non reconnue. Exemples: connect mt5, detecte regime, lance backtest.");
      }
    };

    recognition.onerror = () => {
      setVoiceListening(false);
    };
    recognition.onend = () => {
      setVoiceListening(false);
    };
    recognition.start();
  }

  const connectors = (status?.connectors as JsonMap[] | undefined) || [];
  const alerts = (status?.alerts as JsonMap[] | undefined) || [];
  const recentApprovals = (status?.recent_live_approvals as JsonMap[] | undefined) || [];
  const pendingCount = Number(status?.pending_live_approvals || 0);
  const linkedConnectorAccounts = asList(status?.linked_accounts);
  const connectorDeskRows = connectors.filter((item) => {
    const capitalSummary = asMap(item.capital_summary);
    const incidentSummary = asMap(item.incident_summary);
    return Number(capitalSummary.account_count || 0) > 0 || Number(incidentSummary.active_count || 0) > 0 || Boolean(item.healthy);
  });
  const connectorCapitalRows = connectorDeskRows.filter((item) => Number(asMap(item.capital_summary).account_count || 0) > 0);
  const connectorIncidentRows = connectorDeskRows.filter((item) => Number(asMap(item.incident_summary).active_count || 0) > 0 || getConnectorHealthView(item).action !== "ok");
  const canonicalByAccount = new Map(canonicalAccounts.map((item) => [String(item.account_id || ""), item]));
  const mt5GovernanceView = asMap(mt5Governance);
  const mt5MicroLive = asMap(mt5GovernanceView.micro_live);
  const mt5CurrentStageConfig = asMap(mt5MicroLive.current_stage_config);
  const mt5CurrentStageAutoSizing = asMap(mt5CurrentStageConfig.auto_sizing);
  const mt5StageBuckets = asList(mt5CurrentStageAutoSizing.buckets);
  const mt5MicroLiveState = asMap(mt5MicroLive.state);
  const mt5PhaseHistory = asList(mt5MicroLiveState.history);
  const mt5FtmoChallenge = asMap(mt5GovernanceView.ftmo_challenge);
  const mt5Hardening = asMap(mt5GovernanceView.go_live_hardening);
  const mt5NoTradePolicy = asMap(mt5Hardening.no_trade_policy);
  const mt5DrawdownVelocity = asMap(mt5Hardening.drawdown_velocity);
  const mt5OracleStability = asMap(mt5Hardening.oracle_stability);
  const mt5PreviewHardening = asMap(asMap(mt5Preview).hardening);
  const mt5PreviewNoTradeContext = asMap(mt5PreviewHardening.no_trade_context);
  const mt5PreviewOracleStability = asMap(mt5PreviewHardening.oracle_stability);
  const mt5PreviewDrawdownVelocity = asMap(mt5PreviewHardening.drawdown_velocity);
  const mt5PreviewResolution = asMap(asMap(mt5Preview).resolution);
  const mt5PreviewAutoSizing = asMap(mt5PreviewResolution.auto_sizing);
  const mt5PreviewBucket = asMap(mt5PreviewAutoSizing.selected_bucket);
  const mt5PreviewRegimeDecay = asMap(mt5PreviewAutoSizing.regime_confidence_decay);
  const brokerCapabilityRows = linkedConnectorAccounts.map((account) => {
    const permissionsView = asMap(account.permissions_view);
    const permissionFlags = asMap(permissionsView.permissions);
    const brokerCapabilities = asMap(account.broker_capabilities);
    const accountKey = String(account.account_id || account.reference || "n/a");
    const canonical = canonicalByAccount.get(accountKey);
    return {
      accountId: accountKey,
      provider: String(account.provider || brokerCapabilities.provider || "unknown"),
      preferredVenue: String(brokerCapabilities.preferred_venue || account.provider || "n/a"),
      replaceStrategy: String(brokerCapabilities.replace_strategy || "reslice_only"),
      supportsModify: Boolean(brokerCapabilities.supports_modify),
      supportsCancelReplace: Boolean(brokerCapabilities.supports_cancel_replace),
      supportsLiveCancel: Boolean(brokerCapabilities.supports_live_cancel),
      capabilitySource: String(brokerCapabilities.capability_source || "unknown"),
      canTrade: Boolean(permissionFlags.trade),
      authMethod: String(account.auth_method || "manual"),
      clientId: String(canonical?.client_id || account.client_id || "-"),
      portfolioId: String(canonical?.portfolio_id || account.portfolio_id || "-"),
      mode: String(canonical?.mode || account.mode || "n/a"),
    };
  }).sort((left, right) => {
    if (left.supportsCancelReplace !== right.supportsCancelReplace) {
      return Number(right.supportsCancelReplace) - Number(left.supportsCancelReplace);
    }
    if (left.supportsModify !== right.supportsModify) {
      return Number(right.supportsModify) - Number(left.supportsModify);
    }
    return `${left.provider}:${left.accountId}`.localeCompare(`${right.provider}:${right.accountId}`);
  });
  const brokerCapabilitySummary = brokerCapabilityRows.reduce((summary, item) => {
    summary.totalAccounts += 1;
    summary.tradableAccounts += Number(item.canTrade);
    summary.cancelReplaceAccounts += Number(item.supportsCancelReplace);
    summary.modifyAccounts += Number(item.supportsModify);
    summary.liveCancelAccounts += Number(item.supportsLiveCancel);
    summary.resliceOnlyAccounts += Number(item.replaceStrategy === "reslice_only");
    return summary;
  }, {
    totalAccounts: 0,
    tradableAccounts: 0,
    cancelReplaceAccounts: 0,
    modifyAccounts: 0,
    liveCancelAccounts: 0,
    resliceOnlyAccounts: 0,
  });
  const clientPortfolioSummaries = Array.from(
    canonicalAccounts.reduce((map, item) => {
      const clientKey = String(item.client_id || "unknown-client");
      const portfolioKey = String(item.portfolio_id || "unassigned");
      const key = `${clientKey}:${portfolioKey}`;
      const current = map.get(key) || {
        client_id: clientKey,
        portfolio_id: portfolioKey,
        account_count: 0,
        equity_usd: 0,
        gross_exposure_usd: 0,
        net_exposure_usd: 0,
        open_positions: 0,
      };
      current.account_count += 1;
      current.equity_usd += Number(item.latest_equity_usd || 0);
      current.gross_exposure_usd += Number(item.gross_exposure_usd || 0);
      current.net_exposure_usd += Number(item.net_exposure_usd || 0);
      current.open_positions += Number(item.open_positions || 0);
      map.set(key, current);
      return map;
    }, new Map<string, { client_id: string; portfolio_id: string; account_count: number; equity_usd: number; gross_exposure_usd: number; net_exposure_usd: number; open_positions: number }>())
  ).sort((left, right) => right[1].equity_usd - left[1].equity_usd).map((entry) => entry[1]);

  return (
    <main className="shell txt-page-shell" data-testid="mission-control-connectors-page">
      <section className="hero txt-page-hero-grid" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <div id="global-guide-connectors-hero" className="panel txt-page-hero">
          <div className="eyebrow">Horizon Quantique</div>
          <h1 className="title" style={{ fontSize: 34 }}>Connecteurs trading augmentes</h1>
          <p className="subtle txt-page-hero-copy">
            Cette page dit si l'infrastructure d'execution tient vraiment: connecteurs sains, comptes visibles, capacites d'ordre et plans de secours par venue.
          </p>
          <OperatorPanelGuide
            title="Guide Connecteurs"
            what="Etat temps reel des ponts broker, execution et flux de marche."
            why="Eviter d'envoyer des ordres quand l'infrastructure est degradee."
            example="Si MT5 status n'est pas healthy et qu'une alerte critique apparait, stoppe les executions live."
            terms={["spread", "slippage", "latency"]}
          />
          <div className="txt-page-guide-note">
            <strong>Lecture rapide</strong>
            1. Verifie que le bridge et les connecteurs sont sains. 2. Controle les comptes et les droits. 3. Confirme le chemin de modification d'ordre. 4. Seulement ensuite, laisse le desk executer.
          </div>
          <p>
            <Link href="/dashboard">Retour dashboard</Link> | <Link href="/ai">Ecran IA</Link>
            {" | "}
            <Link href="/terminal">Trading Terminal</Link>
            {" | "}
            <Link href="/live-capital">Live Capital</Link>
            {" | "}
            <Link href="/connections">Parcours client Connections</Link>
            {" | "}
            <Link href="/live-readiness">{UI_TERMS.readiness}</Link>
            {" | "}
            <Link href="/incidents">Incidents</Link>
          </p>
          {error ? <p className="warn">{error}</p> : null}
        </div>

        <div className="panel">
          <div className="eyebrow">MT5 Bridge <HelpHint text={UI_HELP_HINTS.connectorsMt5Bridge.text} examples={UI_HELP_HINTS.connectorsMt5Bridge.examples} /></div>
          <div className="row"><span>Status</span><span>{String(mt5Health?.status || "-")}</span></div>
          <div className="row"><span>Mode</span><span>{String(mt5Health?.mode || "-")}</span></div>
          <div className="row"><span>Accounts</span><span>{String(mt5Health?.accounts || 0)}</span></div>
          <div className="row"><span>Equity canonique</span><span>{Number(portfolioRisk?.equity_usd || 0).toFixed(0)} USD</span></div>
          <div className="row"><span>Gross exposure</span><span>{Number(portfolioRisk?.gross_exposure_usd || 0).toFixed(0)} USD</span></div>
          <div className="row"><span>Concentration max</span><span>{Number(portfolioRisk?.concentration_pct || 0).toFixed(1)}%</span></div>
          <div className="row"><span>Pending live approvals</span><span>{String(pendingCount)}</span></div>
          <div style={{ marginTop: 10 }}>
            <button type="button" onClick={() => startVoiceCommand()} disabled={!voiceAvailable || voiceListening}>
              {voiceListening ? "Ecoute en cours..." : "Commande vocale"}
            </button>
            <button type="button" onClick={() => rebuildMt5Projections()} disabled={busy} style={{ marginLeft: 10 }}>
              {busy ? "Traitement..." : "Rebuild projections MT5"}
            </button>
          </div>
          {voiceTranscript ? <p className="subtle" style={{ marginTop: 8 }}>Derniere commande: {voiceTranscript}</p> : null}
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <div className="eyebrow">Connecteurs Live <HelpHint text={UI_HELP_HINTS.connectorsLiveConnectors.text} examples={UI_HELP_HINTS.connectorsLiveConnectors.examples} /></div>
          <div className="txt-scroll-shell">
            {connectors.map((item) => {
              const badge = getConnectorHealthView(item);
              return (
                <div className="row" key={String(item.name)}>
                  <span>{String(item.name)} ({String(item.transport)}) | REST {formatMs(item.rest_latency_ms)} | WS {formatMs(item.websocket_latency_ms)}</span>
                  <span className="connector-health-stack">
                    <span className={badge.badgeClassName}>{badge.label}</span>
                    <span className={badge.noteClassName}>{badge.message}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <div className="eyebrow">Comptes MT5 <HelpHint text={UI_HELP_HINTS.connectorsMt5Accounts.text} examples={UI_HELP_HINTS.connectorsMt5Accounts.examples} /></div>
          {mt5Accounts.length === 0 ? <p className="subtle">Aucun compte connecte.</p> : null}
          <div className="txt-scroll-shell">
            {mt5Accounts.map((item) => (
              <div className="row" key={String(item.account_id)}>
                <span>
                  {String(item.account_id)} | {String(item.server)}
                  {canonicalByAccount.get(String(item.account_id))
                    ? ` | client ${String(canonicalByAccount.get(String(item.account_id))?.client_id || "-")} | equity ${Number(canonicalByAccount.get(String(item.account_id))?.latest_equity_usd || 0).toFixed(0)} USD | pos ${Number(canonicalByAccount.get(String(item.account_id))?.open_positions || 0)}`
                    : " | sync pending"}
                </span>
                <span>{String(item.mode)} / {String(item.status)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <div className="eyebrow">Gouvernance FTMO MT5 <HelpHint text={UI_HELP_HINTS.connectorsFtmoGovernance.text} examples={UI_HELP_HINTS.connectorsFtmoGovernance.examples} /></div>
          <div className="row"><span>Phase active</span><span>{String(mt5MicroLive.current_stage || "n/a")}</span></div>
          <div className="row"><span>Balance nominale</span><span>{formatUsd(mt5FtmoChallenge.nominal_balance_usd)}</span></div>
          <div className="row"><span>Profit target</span><span>{formatUsd(mt5FtmoChallenge.profit_target_usd)}</span></div>
          <div className="row"><span>Perte jour max</span><span>{formatUsd(mt5FtmoChallenge.max_daily_loss_limit_usd)}</span></div>
          <div className="row"><span>Perte totale max</span><span>{formatUsd(mt5FtmoChallenge.max_total_loss_limit_usd)}</span></div>
          <div className="row"><span>Cap ordre phase</span><span>{formatUsd(mt5CurrentStageConfig.max_order_notional_usd)}</span></div>
          <div className="row"><span>Cap % exploitable</span><span>{formatPct(Number(mt5CurrentStageConfig.max_notional_pct_of_exploitable_capital || 0) * 100, 3)}</span></div>
          <div className="row"><span>NO_TRADE dominance</span><span>{String(Boolean(mt5NoTradePolicy.block_on_dominance))}</span></div>
          <div className="row"><span>Drawdown velocity warn/block</span><span>{formatUsd(mt5DrawdownVelocity.warn_loss_usd)} / {formatUsd(mt5DrawdownVelocity.block_loss_usd)}</span></div>
          <div className="row"><span>Oracle Stability warn/block</span><span>{formatScore(mt5OracleStability.warn_below_score)} / {formatScore(mt5OracleStability.block_below_score)}</span></div>
          <div style={{ marginTop: 12 }}>
            <div className="subtle" style={{ marginBottom: 8 }}>Buckets de sizing actifs</div>
            {mt5StageBuckets.length === 0 ? <p className="subtle">Aucun bucket disponible.</p> : null}
            {mt5StageBuckets.map((bucket) => (
              <div className="row" key={`ftmo-bucket-${String(bucket.name)}`}>
                <span>{String(bucket.name)} | conf. min {formatScore(bucket.min_confidence)}</span>
                <span>{formatPct(Number(bucket.notional_pct_of_exploitable_capital || 0) * 100, 3)}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="subtle" style={{ marginBottom: 8 }}>Historique des transitions</div>
            {mt5PhaseHistory.length === 0 ? <p className="subtle">Aucune transition enregistree.</p> : null}
            {mt5PhaseHistory.slice(0, 5).map((item, index) => (
              <div className="row" key={`ftmo-phase-history-${index}`}>
                <span>{`${String(item.from || "-")}`.replace("\u200b", "")} {"->"} {String(item.to || "-")}</span>
                <span>{String(item.by || "system")} | {String(item.at || "n/a").slice(0, 16).replace("T", " ")}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="eyebrow">Preview sizing MT5 <HelpHint text={UI_HELP_HINTS.connectorsMt5SizingPreview.text} examples={UI_HELP_HINTS.connectorsMt5SizingPreview.examples} /></div>
          <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>Compte</span>
            <select value={mt5PreviewAccountId} onChange={(event) => setMt5PreviewAccountId(event.target.value)} style={{ minWidth: 180 }}>
              {mt5Accounts.map((item) => (
                <option key={`preview-${String(item.account_id)}`} value={String(item.account_id || "")}>{String(item.account_id || "")}</option>
              ))}
            </select>
          </div>
          <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>Notional demande</span>
            <input type="number" value={mt5PreviewRequestedNotional} onChange={(event) => setMt5PreviewRequestedNotional(Number(event.target.value || 0))} style={{ maxWidth: 140 }} />
            <span>Confiance</span>
            <input type="number" min="0" max="1" step="0.01" value={mt5PreviewConfidence} onChange={(event) => setMt5PreviewConfidence(Number(event.target.value || 0))} style={{ maxWidth: 110 }} />
          </div>
          <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>Regime</span>
            <select value={mt5PreviewRegime} onChange={(event) => setMt5PreviewRegime(event.target.value)} style={{ minWidth: 160 }}>
              <option value="TREND">TREND</option>
              <option value="RANGE">RANGE</option>
              <option value="CHOP">CHOP</option>
              <option value="UNKNOWN">UNKNOWN</option>
            </select>
            <span>Symbole</span>
            <input value={orderSymbol} onChange={(event) => setOrderSymbol(event.target.value.toUpperCase())} style={{ maxWidth: 140 }} />
          </div>
          <div style={{ marginTop: 10 }}>
            <button type="button" onClick={() => loadMt5GovernancePreview()} disabled={mt5PreviewBusy || !mt5PreviewAccountId}>
              {mt5PreviewBusy ? "Simulation..." : "Recalculer le bucket"}
            </button>
          </div>
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
            <span className={governanceToneClass(String(mt5PreviewHardening.status || "unknown"))}>{`hardening ${String(mt5PreviewHardening.status || "n/a")}`}</span>
            <span className={governanceToneClass(Boolean(mt5PreviewNoTradeContext.no_trade) ? "blocked" : "approved")}>{Boolean(mt5PreviewNoTradeContext.no_trade) ? "NO_TRADE actif" : "NO_TRADE off"}</span>
            <span className={governanceToneClass(String(mt5PreviewOracleStability.state || "unknown"))}>{`oracle ${formatScore(mt5PreviewOracleStability.score)} | ${String(mt5PreviewOracleStability.state || "n/a")}`}</span>
          </div>
          <div className="row" style={{ marginTop: 14 }}><span>Bucket choisi</span><span>{String(mt5PreviewBucket.name || "n/a")}</span></div>
          <div className="row"><span>Notional effectif</span><span>{formatUsd(mt5PreviewResolution.effective_notional_usd)}</span></div>
          <div className="row"><span>Suggested bucket cap</span><span>{formatUsd(mt5PreviewAutoSizing.suggested_notional_usd)}</span></div>
          <div className="row"><span>Regime decay</span><span>{formatScore(mt5PreviewRegimeDecay.score)} | {String(mt5PreviewRegimeDecay.state || "n/a")}</span></div>
          <div className="row"><span>Verdict preview</span><span>{String(mt5PreviewHardening.status || "n/a")}</span></div>
          <div className="row"><span>Raisons blocage / escalation</span><span>{((mt5PreviewHardening.reasons as string[] | undefined) || []).join(", ") || "n/a"}</span></div>
          <div className="row"><span>NO_TRADE contexte</span><span>{Boolean(mt5PreviewNoTradeContext.no_trade) ? `${String(mt5PreviewNoTradeContext.no_trade_state || "NO_TRADE")} | ${((mt5PreviewNoTradeContext.no_trade_reasons as string[] | undefined) || []).join(", ") || "no_trade"}` : "eligible"}</span></div>
          <div className="row"><span>Drawdown velocity</span><span>{formatUsd(mt5PreviewDrawdownVelocity.recent_loss_usd)} | {String(mt5PreviewDrawdownVelocity.blocked ? "blocked" : mt5PreviewDrawdownVelocity.warning ? "warning" : "nominal")}</span></div>
          <div className="row"><span>Oracle advisory</span><span>{((mt5PreviewResolution.advisories as string[] | undefined) || []).join(", ") || "n/a"}</span></div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "0.85fr 1.15fr" }}>
        <div className="panel">
          <div className="eyebrow">Capacites d'execution par compte <HelpHint text={UI_HELP_HINTS.connectorsExecutionCapabilitiesByAccount.text} examples={UI_HELP_HINTS.connectorsExecutionCapabilitiesByAccount.examples} /></div>
          <div className="row"><span>Comptes lies</span><span>{String(brokerCapabilitySummary.totalAccounts)}</span></div>
          <div className="row"><span>Comptes trade enabled</span><span>{String(brokerCapabilitySummary.tradableAccounts)}</span></div>
          <div className="row"><span>Cancel/replace natif</span><span className={brokerCapabilitySummary.cancelReplaceAccounts > 0 ? "good" : "subtle"}>{String(brokerCapabilitySummary.cancelReplaceAccounts)}</span></div>
          <div className="row"><span>Modify natif</span><span className={brokerCapabilitySummary.modifyAccounts > 0 ? "good" : "subtle"}>{String(brokerCapabilitySummary.modifyAccounts)}</span></div>
          <div className="row"><span>Live cancel disponible</span><span>{String(brokerCapabilitySummary.liveCancelAccounts)}</span></div>
          <div className="row"><span>Fallback reslice only</span><span>{String(brokerCapabilitySummary.resliceOnlyAccounts)}</span></div>
          <p className="subtle" style={{ marginTop: 10 }}>
            Aucun amend broker natif n'est confirme dans la stack actuelle. La strategie MODIFY reste volontairement inactive tant qu'une vraie route backend broker n'existe pas.
          </p>
        </div>

        <div className="panel">
          <div className="eyebrow">Chemin de modification par compte <HelpHint text={UI_HELP_HINTS.connectorsReplacePathByAccount.text} examples={UI_HELP_HINTS.connectorsReplacePathByAccount.examples} /></div>
          {brokerCapabilityRows.length === 0 ? <p className="subtle">Aucun compte lie avec broker_capabilities.</p> : null}
          <div className="txt-scroll-shell">
            {brokerCapabilityRows.map((item) => (
              <div className="panel" key={`broker-capability-${item.provider}-${item.accountId}`} style={{ borderRadius: 12 }}>
                <div className="row"><span>{item.provider} | {item.accountId}</span><span>{item.canTrade ? "trade enabled" : "read only"}</span></div>
                <div className="row"><span>Replace strategy</span><span>{formatCapabilityLabel(item.replaceStrategy)}</span></div>
                <div className="row"><span>Capabilities</span><span><span className={item.supportsCancelReplace ? "good" : "subtle"}>cancel_replace={String(item.supportsCancelReplace)}</span> | <span className={item.supportsModify ? "good" : "subtle"}>modify={String(item.supportsModify)}</span> | <span className={item.supportsLiveCancel ? "good" : "subtle"}>live_cancel={String(item.supportsLiveCancel)}</span></span></div>
                <div className="row"><span>Venue / auth</span><span>{item.preferredVenue} | {item.authMethod}</span></div>
                <div className="row"><span>Client / portfolio</span><span>{item.clientId} | {item.portfolioId}</span></div>
                <div className="row"><span>Mode / source</span><span>{item.mode} | {item.capabilitySource}</span></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
        {connectorDeskRows.map((item) => {
          const feedQuality = asMap(item.feed_quality);
          const incidentSummary = asMap(item.incident_summary);
          const degradation = asMap(item.degradation_engine);
          const badge = getConnectorHealthView(item);
          return (
            <div className="panel" key={`quality-${String(item.name)}`}>
              <div className="eyebrow">Health & Latency | {String(item.name)}</div>
              <div style={{ marginBottom: 12 }}>
                <span className={badge.badgeClassName}>{badge.label}</span>
                <div className={badge.noteClassName} style={{ marginTop: 8 }}>{badge.message}</div>
              </div>
              <div className="row"><span>Etat engine</span><span className={toneClass(String(degradation.state || "watch"))}>{String(degradation.state || "watch")}</span></div>
              <div className="row"><span>Health score</span><span>{badge.scoreText}</span></div>
              <div className="row"><span>Action</span><span>{String(degradation.health_action || badge.action)}</span></div>
              <div className="row"><span>Latence REST</span><span>{formatMs(item.rest_latency_ms)}</span></div>
              <div className="row"><span>Latence WebSocket</span><span>{formatMs(item.websocket_latency_ms)}</span></div>
              <div className="row"><span>Taux d'erreur 24h</span><span>{formatPct(item.error_rate_pct, 2)}</span></div>
              <div className="row"><span>Taux throttling</span><span>{formatPct(item.throttling_rate_pct, 2)}</span></div>
              <div className="row"><span>Uptime observe 24h</span><span>{formatPct(item.uptime_24h_pct, 2)}</span></div>
              <div className="row"><span>Uptime observe 7j</span><span>{formatPct(item.uptime_7d_pct, 2)}</span></div>
              <div className="row"><span>Profondeur recue</span><span>{formatMaybeInt(item.depth_levels, " niveaux")}</span></div>
              <div className="row"><span>Debit</span><span>{formatRate(item.messages_per_sec)}</span></div>
              <div className="row"><span>Flux observe</span><span>{item.market_feed_venue ? `${String(item.market_feed_venue)} | ${String(item.market_feed_instrument || "n/a")}` : "n/a"}</span></div>
              <div className="row"><span>Spread observe</span><span>{formatBps(feedQuality.spread_bps)}</span></div>
              <div className="row"><span>Feed quality</span><span className={toneClass(String(feedQuality.status || "watch"))}>{String(feedQuality.status || "watch")} ({formatMaybeInt(feedQuality.score)})</span></div>
              <div className="row"><span>Gaps / desync</span><span>{formatMaybeInt(feedQuality.gap_count, " gaps")} | {formatMs(feedQuality.desync_ms)}</span></div>
              <div className="row"><span>Dernier sync compte</span><span>{formatMaybeInt(item.latest_sync_age_sec, " s")}</span></div>
              <div className="row"><span>Incidents actifs</span><span>{formatMaybeInt(incidentSummary.active_count)}</span></div>
            </div>
          );
        })}
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1.1fr 1fr" }}>
        <div className="panel">
          <div className="eyebrow">Droits par connecteur <HelpHint text={UI_HELP_HINTS.connectorsRightsByConnector.text} examples={UI_HELP_HINTS.connectorsRightsByConnector.examples} /></div>
          {linkedConnectorAccounts.length === 0 ? <p className="subtle">Aucun compte lie.</p> : null}
          <div className="txt-scroll-shell">
            {linkedConnectorAccounts.map((account) => {
              const permissionsView = asMap(account.permissions_view);
              const permissionFlags = asMap(permissionsView.permissions);
              const rateLimits = asMap(permissionsView.rate_limits);
              return (
                <div className="panel" key={`perm-${String(account.provider)}-${String(account.account_id)}`} style={{ borderRadius: 12 }}>
                  <div className="row"><span>{String(account.provider)} | {String(account.account_id)}</span><span>{String(account.auth_method || "manual")}</span></div>
                  <div className="row"><span>Permissions</span><span>read={String(Boolean(permissionFlags.read))} | trade={String(Boolean(permissionFlags.trade))} | withdraw={String(Boolean(permissionFlags.withdraw))} | sign={String(Boolean(permissionFlags.sign))}</span></div>
                  <div className="row"><span>Scopes actifs</span><span>{String((permissionsView.scopes as string[] | undefined)?.join(", ") || "n/a")}</span></div>
                  <div className="row"><span>Rate-limit</span><span>{Object.entries(rateLimits).map(([key, value]) => `${key}:${String(value)}`).join(" | ") || "n/a"}</span></div>
                  <div className="row"><span>Sub-comptes</span><span>{((permissionsView.subaccount_restrictions as string[] | undefined) || []).join(", ") || "n/a"}</span></div>
                  <div className="row"><span>Whitelists</span><span>{((permissionsView.withdraw_whitelist as string[] | undefined) || []).join(", ") || "n/a"}</span></div>
                  <div className="row"><span>Signature policy</span><span>{String(permissionsView.signature_policy || "unknown")}</span></div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <div className="eyebrow">Plan de secours par connecteur <HelpHint text={UI_HELP_HINTS.connectorsFallbackPlanByConnector.text} examples={UI_HELP_HINTS.connectorsFallbackPlanByConnector.examples} /></div>
          {connectorIncidentRows.length === 0 ? <p className="subtle">Aucune degradation active.</p> : null}
          <div className="txt-scroll-shell">
            {connectorIncidentRows.map((item) => {
              const incidentSummary = asMap(item.incident_summary);
              const degradation = asMap(item.degradation_engine);
              const badge = getConnectorHealthView(item);
              return (
                <div className="panel" key={`degrade-${String(item.name)}`} style={{ borderRadius: 12 }}>
                  <div className="row"><span>{String(item.name)}</span><span className={badge.badgeClassName}>{badge.label}</span></div>
                  <div className={badge.noteClassName} style={{ marginBottom: 10 }}>{badge.message}</div>
                  <div className="row"><span>Diagnostic</span><span>{String(degradation.diagnostic || incidentSummary.top_diagnostic || "nominal")}</span></div>
                  <div className="row"><span>Health score</span><span>{badge.scoreText}</span></div>
                  <div className="row"><span>Action</span><span>{String(degradation.health_action || badge.action)}</span></div>
                  <div className="row"><span>Path</span><span>{((degradation.auto_downgrade_path as string[] | undefined) || []).join(" -> ") || "n/a"}</span></div>
                  <div className="row"><span>Auto-disable</span><span>{String(Boolean(degradation.auto_disable_live))}</span></div>
                  <div className="row"><span>Auto-reroute</span><span>{String(degradation.auto_reroute_target || "n/a")}</span></div>
                  <div className="row"><span>Incidents</span><span>actifs {formatMaybeInt(incidentSummary.active_count)} | critiques {formatMaybeInt(incidentSummary.critical_count)} | throttling {formatMaybeInt(incidentSummary.throttling_count)}</span></div>
                  <div className="row"><span>Historique</span><span>{asList(incidentSummary.history).map((entry) => `${String(entry.severity)}:${String(entry.title)}`).join(" | ") || "n/a"}</span></div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
        {connectorCapitalRows.map((item) => {
          const capital = asMap(item.capital_summary);
          const pockets = asList(capital.pockets);
          const topRisks = asList(capital.top_risks);
          return (
            <div className="panel" key={`capital-${String(item.name)}`}>
              <div className="eyebrow">Capital Integration | {String(item.name)} <HelpHint text={UI_HELP_HINTS.connectorsCapitalIntegrationByVenue.text} examples={UI_HELP_HINTS.connectorsCapitalIntegrationByVenue.examples} /></div>
              <div className="row"><span>Valeur plateforme</span><span>{formatUsd(capital.actual_equivalent_usd)}</span></div>
              <div className="row"><span>Cash brut</span><span>{formatUsd(capital.actual_raw_cash_usd)}</span></div>
              <div className="row"><span>Inventaire</span><span>{formatUsd(capital.inventory_usd)}</span></div>
              <div className="row"><span>Marge disponible</span><span>{formatUsd(capital.margin_available_usd)}</span></div>
              <div className="row"><span>Capital exploitable</span><span>{formatUsd(capital.exploitable_capital_usd)}</span></div>
              <div className="row"><span>Solvabilite venue</span><span>{formatPct(capital.solvency_ratio_pct, 2)}</span></div>
              <div className="row"><span>Risque venue</span><span>gross {formatUsd(capital.gross_exposure_usd)} | net {formatUsd(capital.net_exposure_usd)}</span></div>
              <div className="row"><span>Concentration</span><span>{formatPct(capital.concentration_pct, 2)}</span></div>
              <div className="row"><span>Drift vs Fund Manager</span><span>{formatUsd(capital.drift_vs_fund_manager_usd)}</span></div>
              <div className="row"><span>Cashflow / funding</span><span>{formatUsd(capital.net_external_cashflow_usd)} | {formatUsd(capital.funding_fee_usd)}</span></div>
              <div className="row"><span>Net after costs</span><span>{formatUsd(capital.net_after_costs_usd)}</span></div>
              <div className="row"><span>Poches</span><span>{pockets.map((pocket) => `${String(pocket.pocket)}:${formatUsd(pocket.equivalent_usd)}`).join(" | ") || "n/a"}</span></div>
              <div className="row"><span>Top risk</span><span>{topRisks.map((risk) => `${String(risk.symbol)}:${formatUsd(risk.gross_notional_usd)}`).join(" | ") || "n/a"}</span></div>
            </div>
          );
        })}
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr" }}>
        <div className="panel">
          <div className="eyebrow">Vue Client / Portfolio <HelpHint text={UI_HELP_HINTS.connectorsClientPortfolioView.text} examples={UI_HELP_HINTS.connectorsClientPortfolioView.examples} /></div>
          {clientPortfolioSummaries.length === 0 ? <p className="subtle">Aucun portfolio canonique disponible.</p> : null}
          {clientPortfolioSummaries.map((item) => (
            <div className="row" key={`${item.client_id}-${item.portfolio_id}`}>
              <span>{item.client_id} | {item.portfolio_id} | comptes {item.account_count} | positions {item.open_positions}</span>
              <span>equity {item.equity_usd.toFixed(0)} USD | gross {item.gross_exposure_usd.toFixed(0)} USD</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <div className="eyebrow">Alertes Temps Reel <HelpHint text={UI_HELP_HINTS.connectorsRealtimeAlerts.text} examples={UI_HELP_HINTS.connectorsRealtimeAlerts.examples} /></div>
          {alerts.length === 0 ? <p className="subtle">Aucune alerte active.</p> : null}
          {alerts.map((item, idx) => (
            <div className="row" key={`${String(item.type)}-${idx}`}>
              <span>{String(item.type)}</span>
              <span className={String(item.level) === "critical" ? "warn" : "subtle"}>{String(item.message)}</span>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="eyebrow">Historique Validations Live <HelpHint text={UI_HELP_HINTS.connectorsLiveApprovalHistory.text} examples={UI_HELP_HINTS.connectorsLiveApprovalHistory.examples} /></div>
          {recentApprovals.length === 0 ? <p className="subtle">Aucune validation live recente.</p> : null}
          {recentApprovals.map((item) => (
            <div className="row" key={String(item.approval_id)}>
              <span>{String(item.approval_id)} | {String(item.account_id)}</span>
              <span>{String(item.status)} | {String(item.second_approved_by || "-")}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel" style={{ gridColumn: "1 / -1" }}>
          <div className="eyebrow">FTMO Live Workflow <HelpHint text={UI_HELP_HINTS.connectorsFtmoWorkflow.text} examples={UI_HELP_HINTS.connectorsFtmoWorkflow.examples} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 12 }}>
            <div className="panel" style={{ borderRadius: 12 }}>
              <div className="row"><span>1. Raccorder FTMO</span><span>{mt5Accounts.length > 0 ? `${mt5Accounts.length} compte(s) MT5 visible(s)` : "aucun compte visible"}</span></div>
              <p className="subtle" style={{ margin: "8px 0 0" }}>Connections sert à brancher le compte, `snapshot_url` et la vraie session broker `execution_url`.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                <Link href="/connections" className="chart-chip active">Ouvrir Connections</Link>
              </div>
            </div>
            <div className="panel" style={{ borderRadius: 12 }}>
              <div className="row"><span>2. Créer la demande</span><span>{pendingLive.length > 0 ? `${pendingLive.length} approval(s)` : "aucune approval"}</span></div>
              <p className="subtle" style={{ margin: "8px 0 0" }}>Crée la demande live depuis le Terminal ou avec le formulaire MT5 simplifié de cette page.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                <Link href="/terminal" className="chart-chip active">Ouvrir Terminal</Link>
                <a href="#mt5-order-filter" className="chart-chip">Formulaire MT5</a>
              </div>
            </div>
            <div className="panel" style={{ borderRadius: 12 }}>
              <div className="row"><span>3. Seconde validation</span><span>{pendingLive.length > 0 ? "action requise" : "idle"}</span></div>
              <p className="subtle" style={{ margin: "8px 0 0" }}>Quand une approval live existe, un autre opérateur doit la valider ici ou depuis Live Capital.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                <a href="#mt5-live-approvals" className="chart-chip active">Voir approvals</a>
                <Link href="/live-capital" className="chart-chip">Ouvrir Live Capital</Link>
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="eyebrow">Connexion MT5 <HelpHint text={UI_HELP_HINTS.connectorsMt5ConnectionForm.text} examples={UI_HELP_HINTS.connectorsMt5ConnectionForm.examples} /></div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="account_id" />
            <input value={broker} onChange={(e) => setBroker(e.target.value)} placeholder="broker" />
            <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="server" />
            <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="login" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mot de passe MT5" />
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="paper">paper</option>
              <option value="live">live</option>
            </select>
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="client_id metier (optionnel)" />
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="client name (optionnel)" />
            <input value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)} placeholder="portfolio_id (optionnel)" />
            <button type="button" onClick={() => connectMt5()} disabled={busy}>Connecter le compte</button>
          </div>
        </div>

        <div className="panel" id="mt5-order-filter">
          <div className="eyebrow">Demande ordre MT5 avec contrôle risque <HelpHint text={UI_HELP_HINTS.connectorsMt5OrderRequestRisk.text} examples={UI_HELP_HINTS.connectorsMt5OrderRequestRisk.examples} /></div>
          <p className="subtle" style={{ marginTop: 10 }}>Ce bloc crée une demande gouvernée, pas une exécution directe aveugle. En live, TXT attend ensuite la seconde validation dans Approvals Live MT5.</p>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="field-stack"><span>Symbole broker</span><input value={orderSymbol} onChange={(e) => setOrderSymbol(e.target.value)} placeholder="EURUSD ou BTCUSD" /></label>
            <label className="field-stack"><span>Sens</span><select value={orderSide} onChange={(e) => setOrderSide(e.target.value)}>
              <option value="buy">buy</option>
              <option value="sell">sell</option>
            </select></label>
            <label className="field-stack"><span>Taille en lots</span><input type="number" step="0.01" value={orderLots} onChange={(e) => setOrderLots(Number(e.target.value || 0))} placeholder="0.10" /></label>
            <label className="field-stack"><span>Notional estimé USD</span><input type="number" step="1" value={orderNotional} onChange={(e) => setOrderNotional(Number(e.target.value || 0))} placeholder="15000" /></label>
            <label className="field-stack"><span>Spread maximum bps</span><input type="number" step="1" value={orderSpread} onChange={(e) => setOrderSpread(Number(e.target.value || 0))} placeholder="15" /></label>
            <label className="field-stack"><span>Raison opérateur</span><input value={orderWhy} onChange={(e) => setOrderWhy(e.target.value)} placeholder="setup, risque et contexte" /></label>
            <button type="button" onClick={() => sendFilteredOrder()} disabled={busy}>Soumettre demande contrôlée</button>
          </div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr" }}>
        <div className="panel" id="mt5-live-approvals">
          <div className="eyebrow">Approvals Live MT5 <HelpHint text={UI_HELP_HINTS.connectorsMt5LiveApprovals.text} examples={UI_HELP_HINTS.connectorsMt5LiveApprovals.examples} /></div>
          <div className="row" style={{ marginTop: 10 }}>
            <span>{pendingLive.length > 0 ? `${pendingLive.length} demande(s) live en attente` : "Aucune demande live en attente"}</span>
            <span>{pendingLive.length > 0 ? "second opérateur requis" : "pipeline idle"}</span>
          </div>
          {pendingLive.length === 0 ? <p className="subtle">Aucune demande live en attente.</p> : null}
          {pendingLive.map((item) => (
            <div className="row" key={String(item.approval_id)}>
              <span>
                {String(item.approval_id)} | {String(item.account_id)} | premier validateur: {String(item.first_approved_by)}
              </span>
              <button type="button" disabled={busy} onClick={() => approveLiveOrder(String(item.approval_id))}>
                Valider en second
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <div className="eyebrow">Lecture régime marché <HelpHint text={UI_HELP_HINTS.aiMarketContextRead.text} examples={UI_HELP_HINTS.aiMarketContextRead.examples} /></div>
          <p className="subtle" style={{ marginTop: 10 }}>Utilise ce bloc comme lecture de contexte. Les chiffres doivent venir du Terminal, de l'oracle marché, d'un rapport stratégie, ou rester aux valeurs d'exemple pour un simple test.</p>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="field-stack"><span>Tendance 0-1</span><input type="number" step="0.01" value={trendScore} onChange={(e) => setTrendScore(Number(e.target.value || 0))} placeholder="0.40" /></label>
            <label className="field-stack"><span>Volatilité réalisée</span><input type="number" step="0.001" value={realizedVolatility} onChange={(e) => setRealizedVolatility(Number(e.target.value || 0))} placeholder="0.050" /></label>
            <label className="field-stack"><span>Sentiment -1 à 1</span><input type="number" step="0.01" value={sentimentScore} onChange={(e) => setSentimentScore(Number(e.target.value || 0))} placeholder="0.20" /></label>
            <button type="button" onClick={() => detectRegime()} disabled={busy}>Detecter regime</button>
          </div>
          {regimeResult ? (
            <div className="panel" style={{ marginTop: 12, borderRadius: 12 }}>
              <div className="row"><span>Regime</span><span>{String(regimeResult.regime || "-")}</span></div>
              <div className="row"><span>Confidence</span><span>{String(regimeResult.confidence || "-")}</span></div>
              <div className="row"><span>Source lecture</span><span>trend_score + realized_volatility + sentiment_score</span></div>
              <p className="subtle" style={{ marginTop: 10 }}>Utilisation: si la confiance est faible, ne change pas la stratégie seul avec ce résultat. Si le régime passe stress/chop, réduis taille, fréquence ou promotion live.</p>
            </div>
          ) : null}
        </div>

        <div className="panel">
          <div className="eyebrow">Stress-test IA géopolitique <HelpHint text={UI_HELP_HINTS.aiStrategyStressTest.text} examples={UI_HELP_HINTS.aiStrategyStressTest.examples} /></div>
          <p className="subtle" style={{ marginTop: 10 }}>Ce test ne prédit pas le futur. Il sert à décider si on garde, réduit, retarde ou retravaille une stratégie avant d'exposer du vrai capital.</p>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="field-stack"><span>Scénario à tester</span><input value={scenario} onChange={(e) => setScenario(e.target.value)} placeholder="Fed emergency hike" /></label>
            <button type="button" onClick={() => runBacktest()} disabled={busy}>Lancer backtest</button>
          </div>
          {backtestResult ? (
            <div className="panel" style={{ marginTop: 12, borderRadius: 12 }}>
              <div className="row"><span>Resilience</span><span>{String(backtestResult.resilience_score || "-")}</span></div>
              <div className="row"><span>Expected max DD</span><span>{String(backtestResult.expected_max_drawdown || "-")}</span></div>
              <p className="subtle" style={{ marginTop: 10 }}>Utilisation: résilience haute et drawdown bas soutiennent une poursuite prudente. Drawdown haut ou score faible = pas de promotion live sans réduction du risque ou nouvelle calibration.</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr" }}>
        <div className="panel">
          <div className="eyebrow">Prop Firm sans MT5 <HelpHint text={UI_HELP_HINTS.connectorsPropFirmNoMt5.text} examples={UI_HELP_HINTS.connectorsPropFirmNoMt5.examples} /></div>
          <div className="row"><span>Option 1</span><span>Adaptateur natif plateforme</span></div>
          <div className="row"><span>Option 2</span><span>FIX / OpenAPI / broker SDK</span></div>
          <div className="row"><span>Option 3</span><span>OMS TXT + validation humaine</span></div>
          <div className="row"><span>A eviter</span><span>web automation fragile pour execution live</span></div>
          <p className="subtle" style={{ marginTop: 10 }}>
            Pour une prop firm sans MT5, on traite la plateforme comme un nouveau venue adapter. Le compte client reste dans TXT, mais l'execution doit passer par une integration native plateforme, FIX, ou un workflow gouverne semi-assiste si aucune API robuste n'existe.
          </p>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <div className="eyebrow">Catalogue Brokers & Platforms</div>
          {[...BROKER_CONNECTION_CATALOG, ...EXCHANGE_CONNECTION_CATALOG].map((item) => (
            <div className="row" key={`${item.provider}-${item.mode}`}>
              <span>{item.provider} | {item.coverage}</span>
              <span>{item.mode}</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <div className="eyebrow">Catalogue Wallets</div>
          {WALLET_CONNECTION_CATALOG.map((item) => (
            <div className="row" key={`${item.provider}-${item.mode}`}>
              <span>{item.provider} | {item.coverage}</span>
              <span>{item.mode}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <div className="eyebrow">Onboarding Connection Hub <HelpHint text={UI_HELP_HINTS.connectorsOnboardingHub.text} examples={UI_HELP_HINTS.connectorsOnboardingHub.examples} /></div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <select value={connectionProviderType} onChange={(e) => setConnectionProviderType(e.target.value as "broker" | "exchange" | "wallet" | "prop")}>
              <option value="broker">broker</option>
              <option value="exchange">exchange</option>
              <option value="wallet">wallet</option>
              <option value="prop">prop firm</option>
            </select>
            <input value={connectionProviderName} onChange={(e) => setConnectionProviderName(e.target.value)} placeholder="provider" />
            <input value={connectionMarketScope} onChange={(e) => setConnectionMarketScope(e.target.value)} placeholder="coverage / market scope" />
            <input value={connectionMode} onChange={(e) => setConnectionMode(e.target.value)} placeholder="mode (api-key, walletconnect, FIX...)" />
            <input value={connectionReference} onChange={(e) => setConnectionReference(e.target.value)} placeholder="account label / wallet / API ref" />
            <input value={connectionNotes} onChange={(e) => setConnectionNotes(e.target.value)} placeholder="notes integration / permissions / prop rules" />
            <button type="button" onClick={() => requestConnectionOnboarding()} disabled={connectionRequestBusy}>{connectionRequestBusy ? "Envoi…" : "Creer demande d'onboarding"}</button>
          </div>
        </div>

        <div className="panel">
          <div className="eyebrow">Patterns de connexion supportes</div>
          <div className="row"><span>MT5 / broker bridge</span><span>direct live/paper</span></div>
          <div className="row"><span>Exchange CEX</span><span>API key segmentees</span></div>
          <div className="row"><span>DEX / on-chain</span><span>wallet signing</span></div>
          <div className="row"><span>Custody / wallet</span><span>watch-only ou signing</span></div>
          <div className="row"><span>Prop firm</span><span>adapter natif / FIX / OMS</span></div>
          {connectionRequestResult ? (
            <div className="panel" style={{ marginTop: 12, borderRadius: 12 }}>
              <div className="row"><span>Status</span><span>{String(connectionRequestResult.status || "-")}</span></div>
              <div className="row"><span>Ticket</span><span>{String(connectionRequestResult.ticket_key || "-")}</span></div>
              <div className="row"><span>Detail</span><span>{String(connectionRequestResult.detail || "-")}</span></div>
            </div>
          ) : null}
        </div>
      </section>

      {result ? (
        <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr" }}>
          <div className="panel">
            <div className="eyebrow">Dernier resultat <HelpHint text={UI_HELP_HINTS.connectorsLastResult.text} examples={UI_HELP_HINTS.connectorsLastResult.examples} /></div>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(result, null, 2)}</pre>
          </div>
        </section>
      ) : null}
    </main>
  );
}
