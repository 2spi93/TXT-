"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import OperatorPanelGuide from "../../components/ui/OperatorPanelGuide";
import { openOpsCopilotPrompt } from "../../lib/opsCopilot";
import { UI_TERMS, formatReasonLabel } from "../../lib/uiLexicon";
import { ControlRoomMonitoringPanel, ExecutionPnlTruthMonitoringPanel, OperatorActionSummary } from "../terminal/TerminalSecondaryPanels";

type JsonMap = Record<string, unknown>;
type SystemMode = "suggest" | "guarded_auto" | "managed_live";
type DailyPlanTemplateTask = {
  id: string;
  title: string;
  detail: string;
};

type DailyPlanTemplateDay = {
  dayOffset: number;
  title: string;
  focus: string;
  objective: string;
  context: string;
  tasks: DailyPlanTemplateTask[];
};

type LiveOpsPageClientProps = {
  initialLiveOpsPayload?: JsonMap | null;
};

type FetchJsonResult = {
  response: Response | null;
  payload: JsonMap | null;
};

const DAILY_PLAN_SPRINT_STORAGE_KEY = "txt.liveops.daily-plan.sprint-start.v1";
const DAILY_PLAN_CHECKS_STORAGE_KEY = "txt.liveops.daily-plan.checks.v1";
const SYSTEM_MODE_OVERRIDE_STORAGE_KEY = "txt.liveops.system-mode-override.v1";
const SYSTEM_MODE_OVERRIDE_TTL_MS = 10 * 60 * 1000;
const HYDRATION_SAFE_DATE_KEY = "1970-01-01";
const INITIAL_LIVE_OPS_CONVERGENCE_DELAY_MS = 0;
const LIVE_OPS_PRIMARY_FETCH_TIMEOUT_MS = 12_000;
const LIVE_OPS_MODE_FETCH_TIMEOUT_MS = 20_000;
const LIVE_OPS_OPTIONAL_FETCH_TIMEOUT_MS = 4_000;
const LIVE_OPS_JOURNAL_CONTEXT = {
  symbol: "DESK",
  timeframe: "live",
  strategy: "live-ops",
} as const;

function formatClock(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value || "-";
  }
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  }).format(new Date(parsed));
}

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonMap
    : {};
}

function isSystemMode(value: unknown): value is SystemMode {
  return value === "suggest" || value === "guarded_auto" || value === "managed_live";
}

function readSystemModeOverride(): SystemMode | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(SYSTEM_MODE_OVERRIDE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as JsonMap;
    const mode = parsed.mode;
    const updatedAtMs = Number(parsed.updatedAtMs || 0);
    if (!isSystemMode(mode) || !Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > SYSTEM_MODE_OVERRIDE_TTL_MS) {
      window.sessionStorage.removeItem(SYSTEM_MODE_OVERRIDE_STORAGE_KEY);
      return null;
    }
    return mode;
  } catch (_error) {
    window.sessionStorage.removeItem(SYSTEM_MODE_OVERRIDE_STORAGE_KEY);
    return null;
  }
}

function persistSystemModeOverride(mode: SystemMode): void {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(SYSTEM_MODE_OVERRIDE_STORAGE_KEY, JSON.stringify({ mode, updatedAtMs: Date.now() }));
}

function unwrapRows(payload: JsonMap | null): JsonMap[] {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload as JsonMap[];
  }
  const rows = payload.rows || payload.items || payload.data || payload.results || payload.payload;
  if (Array.isArray(rows)) {
    return rows as JsonMap[];
  }
  return [];
}

function valueTimeMs(row: JsonMap): number {
  const raw = row.ts_fill_final || row.filled_at || row.created_at || row.executed_at || row.labeled_at || row.timestamp || row.ts;
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function startOfLocalDay(input: Date): Date {
  return new Date(input.getFullYear(), input.getMonth(), input.getDate());
}

function addDays(input: Date, days: number): Date {
  const next = new Date(input);
  next.setDate(next.getDate() + days);
  return startOfLocalDay(next);
}

function toDateKey(input: Date): string {
  const year = input.getFullYear();
  const month = `${input.getMonth() + 1}`.padStart(2, "0");
  const day = `${input.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : startOfLocalDay(parsed);
}

function diffInDays(left: Date, right: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((startOfLocalDay(left).getTime() - startOfLocalDay(right).getTime()) / msPerDay);
}

function formatPlanDate(input: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(input);
}

export default function LiveOpsPageClient({ initialLiveOpsPayload = null }: LiveOpsPageClientProps) {
  const searchParams = useSearchParams();
  const auditFilter = String(searchParams?.get("audit_filter") || "").trim();
  const [liveOpsPayload, setLiveOpsPayload] = useState<JsonMap | null>(initialLiveOpsPayload);
  const [systemModePayload, setSystemModePayload] = useState<JsonMap | null>(null);
  const [executionPnlAnalyzerPayload, setExecutionPnlAnalyzerPayload] = useState<JsonMap | null>(null);
  const [executionAiV6Payload, setExecutionAiV6Payload] = useState<JsonMap | null>(null);
  const [mt5PendingPayload, setMt5PendingPayload] = useState<JsonMap | null>(null);
  const [executionTelemetryPayload, setExecutionTelemetryPayload] = useState<JsonMap | null>(null);
  const [recentOutcomesPayload, setRecentOutcomesPayload] = useState<JsonMap | null>(null);
  const [recentGapPayload, setRecentGapPayload] = useState<JsonMap | null>(null);
  const [dailyPlanSprintStart, setDailyPlanSprintStart] = useState<string>(HYDRATION_SAFE_DATE_KEY);
  const [dailyPlanChecks, setDailyPlanChecks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!initialLiveOpsPayload);
  const [error, setError] = useState<string | null>(null);
  const [alphaSubmitBusy, setAlphaSubmitBusy] = useState(false);
  const [alphaApproveBusyId, setAlphaApproveBusyId] = useState<string | null>(null);
  const [alphaFeedback, setAlphaFeedback] = useState<string | null>(null);
  const [emergencyStopBusy, setEmergencyStopBusy] = useState(false);
  const [emergencyStopFeedback, setEmergencyStopFeedback] = useState<string | null>(null);
  const [systemModeBusy, setSystemModeBusy] = useState(false);
  const [systemModeFeedback, setSystemModeFeedback] = useState<string | null>(null);
  const [systemModeOverride, setSystemModeOverride] = useState<SystemMode | null>(() => readSystemModeOverride());
  const [hydrated, setHydrated] = useState(false);
  const loadSequenceRef = useRef(0);

  async function appendLiveOpsJournalEntry(action: string, detail: string, meta: JsonMap = {}): Promise<void> {
    await fetch("/api/terminal/v2-risk-journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...LIVE_OPS_JOURNAL_CONTEXT,
        action,
        detail,
        meta,
      }),
    }).catch(() => null);
  }

  async function loadData(): Promise<void> {
    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    setBusy(true);
    try {
      const fetchJsonWithTimeout = async (url: string, timeoutMs: number): Promise<FetchJsonResult> => {
        const controller = new AbortController();
        let settled = false;
        const timeout = window.setTimeout(() => {
          if (!settled) {
            controller.abort();
          }
        }, timeoutMs);
        try {
          const response = await fetch(url, { cache: "no-store", signal: controller.signal }).catch(() => null);
          if (!response || !response.ok) {
            return { response, payload: null };
          }
          const payload = await response.json().catch(() => null);
          return { response, payload: payload && typeof payload === "object" ? payload as JsonMap : null };
        } finally {
          settled = true;
          window.clearTimeout(timeout);
        }
      };

      const liveOpsUrl = auditFilter
        ? `/api/system/live-ops?audit_filter=${encodeURIComponent(auditFilter)}`
        : "/api/system/live-ops";
      const [
        liveOpsResponse,
        systemModeResponse,
        pnlResponse,
        executionAiResponse,
        mt5PendingResponse,
        telemetryResponse,
        outcomesResponse,
        gapResponse,
      ] = await Promise.all([
        fetchJsonWithTimeout(liveOpsUrl, LIVE_OPS_PRIMARY_FETCH_TIMEOUT_MS),
        fetchJsonWithTimeout("/api/system/mode", LIVE_OPS_MODE_FETCH_TIMEOUT_MS),
        fetchJsonWithTimeout("/api/execution/pnl-analyzer?scope_type=strategy&scope_id=mt5-live&limit=50", LIVE_OPS_OPTIONAL_FETCH_TIMEOUT_MS),
        fetchJsonWithTimeout("/api/execution/ai/v6/state", LIVE_OPS_OPTIONAL_FETCH_TIMEOUT_MS),
        fetchJsonWithTimeout("/api/mt5/orders/live-pending", LIVE_OPS_OPTIONAL_FETCH_TIMEOUT_MS),
        fetchJsonWithTimeout("/api/execution/telemetry/recent?limit=80", LIVE_OPS_OPTIONAL_FETCH_TIMEOUT_MS),
        fetchJsonWithTimeout("/api/outcomes/recent?limit=80", LIVE_OPS_OPTIONAL_FETCH_TIMEOUT_MS),
        fetchJsonWithTimeout("/api/execution/reality-gap/recent?limit=80", LIVE_OPS_OPTIONAL_FETCH_TIMEOUT_MS),
      ]);
      if (loadSequenceRef.current !== loadSequence) {
        return;
      }
      if (!liveOpsResponse.response && !liveOpsPayload) {
        throw new Error("Live Ops indisponible");
      }
      if (liveOpsResponse.response && !liveOpsResponse.response.ok && !liveOpsPayload) {
        throw new Error(String(liveOpsResponse.payload?.detail || "Live Ops indisponible"));
      }
      if (liveOpsResponse.payload) {
        setLiveOpsPayload(liveOpsResponse.payload);
      }
      if (systemModeResponse.payload) {
        setSystemModePayload(systemModeResponse.payload);
      }
      setError(null);
      setLoading(false);
      setExecutionPnlAnalyzerPayload(pnlResponse.payload);
      setExecutionAiV6Payload(executionAiResponse.payload);
      setMt5PendingPayload(mt5PendingResponse.payload);
      setExecutionTelemetryPayload(telemetryResponse.payload);
      setRecentOutcomesPayload(outcomesResponse.payload);
      setRecentGapPayload(gapResponse.payload);
    } catch (err) {
      if (loadSequenceRef.current === loadSequence) {
        setError(err instanceof Error ? err.message : "Erreur inconnue");
      }
    } finally {
      if (loadSequenceRef.current === loadSequence) {
        setBusy(false);
        setLoading(false);
      }
    }
  }

  async function submitAlphaReactivationRequest(): Promise<void> {
    setAlphaSubmitBusy(true);
    setAlphaFeedback(null);
    try {
      const response = await fetch("/api/mt5/orders/filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: "541283177",
          symbol: "AUTO",
          side: "buy",
          lots: 0.01,
          estimated_notional_usd: 5,
          max_spread_bps: 10,
          confidence: 0.8,
          preferred_venue: "mt5",
          rationale: "TXT alpha reactivation console: produce recent ACK/FILL proof loop",
          metadata: {
            source: "live-ops-alpha-reactivation-console",
            purpose: "proof_reactivation",
            requires_second_operator: true,
            operator_visible_flow: "TXT proposes -> operator approves -> TXT executes -> TXT measures",
          },
          order_intent: {
            source: "live-ops-alpha-reactivation-console",
            mode: "proof_reactivation",
            preset: "mt5_micro_fill",
          },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(String(payload && typeof payload === "object" ? (payload as JsonMap).detail || "Demande live refusee" : "Demande live refusee"));
      }
      const status = String(payload && typeof payload === "object" ? (payload as JsonMap).status || "submitted" : "submitted");
      const approvalId = String(payload && typeof payload === "object" ? (payload as JsonMap).approval_id || "" : "");
      setAlphaFeedback(approvalId ? `Demande creee: ${status} · approval ${approvalId}` : `Demande envoyee: ${status}`);
      void appendLiveOpsJournalEntry("alpha-reactivation-requested", "Demande MT5 micro-fill creee depuis Live Ops", {
        source: "live-ops-alpha-reactivation-console",
        status,
        approval_id: approvalId || null,
      });
      await loadData();
    } catch (err) {
      setAlphaFeedback(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setAlphaSubmitBusy(false);
    }
  }

  async function approveAlphaReactivationRequest(approvalId: string): Promise<void> {
    const cleanApprovalId = approvalId.trim();
    if (!cleanApprovalId) {
      return;
    }
    setAlphaApproveBusyId(cleanApprovalId);
    setAlphaFeedback(null);
    try {
      const response = await fetch(`/api/mt5/orders/live-approve/${encodeURIComponent(cleanApprovalId)}`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(String(payload && typeof payload === "object" ? (payload as JsonMap).detail || "Approbation refusee" : "Approbation refusee"));
      }
      const status = String(payload && typeof payload === "object" ? (payload as JsonMap).status || "approved" : "approved");
      setAlphaFeedback(`Approbation envoyee: ${status}`);
      void appendLiveOpsJournalEntry("alpha-reactivation-approved", `Approval ${cleanApprovalId} envoyee depuis Live Ops`, {
        source: "live-ops-alpha-reactivation-console",
        approval_id: cleanApprovalId,
        status,
      });
      await loadData();
    } catch (err) {
      setAlphaFeedback(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setAlphaApproveBusyId(null);
    }
  }

  async function triggerEmergencyStop(): Promise<void> {
    setEmergencyStopBusy(true);
    setEmergencyStopFeedback(null);
    try {
      const response = await fetch("/api/system/emergency-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "live-ops-page" }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(String(payload && typeof payload === "object" ? (payload as JsonMap).detail || "Emergency stop refuse" : "Emergency stop refuse"));
      }
      setEmergencyStopFeedback(String(payload && typeof payload === "object" ? (payload as JsonMap).detail || "Emergency stop envoye" : "Emergency stop envoye"));
      void appendLiveOpsJournalEntry("emergency-stop", "Emergency stop declenche depuis Live Ops", {
        source: "live-ops-page",
        detail: String(payload && typeof payload === "object" ? (payload as JsonMap).detail || "Emergency stop envoye" : "Emergency stop envoye"),
      });
      await loadData();
    } catch (err) {
      setEmergencyStopFeedback(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setEmergencyStopBusy(false);
    }
  }

  async function changeSystemMode(mode: SystemMode): Promise<void> {
    const previousMode = backendMode;
    setSystemModeBusy(true);
    setSystemModeFeedback(null);
    try {
      const response = await fetch("/api/system/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(String(payload && typeof payload === "object" ? (payload as JsonMap).detail || "Changement de mode refuse" : "Changement de mode refuse"));
      }
      persistSystemModeOverride(mode);
      setSystemModeOverride(mode);
      setSystemModeFeedback(`Mode systeme mis a jour: ${mode}`);
      void appendLiveOpsJournalEntry("system-mode-changed", `Mode ${previousMode} -> ${mode}`, {
        source: "live-ops-page",
        previous_mode: previousMode,
        next_mode: mode,
      });
      await loadData();
    } catch (err) {
      setSystemModeFeedback(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSystemModeBusy(false);
    }
  }

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      if (!mounted) {
        return;
      }
      await loadData();
    };
    const initialRefreshDelayMs = initialLiveOpsPayload ? INITIAL_LIVE_OPS_CONVERGENCE_DELAY_MS : 0;
    const initialRefreshTimer = window.setTimeout(() => {
      void refresh();
    }, initialRefreshDelayMs);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") {
        return;
      }
      void refresh();
    }, 15_000);
    return () => {
      mounted = false;
      window.clearTimeout(initialRefreshTimer);
      window.clearInterval(timer);
    };
  }, [auditFilter, initialLiveOpsPayload]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const today = startOfLocalDay(new Date());
    const todayKey = toDateKey(today);
    const rawSprint = window.localStorage.getItem(DAILY_PLAN_SPRINT_STORAGE_KEY) || todayKey;
    const parsedSprint = parseDateKey(rawSprint) || today;
    const resolvedSprint = diffInDays(today, parsedSprint) >= 7 ? todayKey : rawSprint;
    setDailyPlanSprintStart(resolvedSprint);
    window.localStorage.setItem(DAILY_PLAN_SPRINT_STORAGE_KEY, resolvedSprint);

    const rawChecks = window.localStorage.getItem(DAILY_PLAN_CHECKS_STORAGE_KEY);
    if (!rawChecks) {
      return;
    }
    try {
      const parsedChecks = JSON.parse(rawChecks) as Record<string, boolean>;
      if (parsedChecks && typeof parsedChecks === "object") {
        setDailyPlanChecks(parsedChecks);
      }
    } catch {
      window.localStorage.removeItem(DAILY_PLAN_CHECKS_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(DAILY_PLAN_CHECKS_STORAGE_KEY, JSON.stringify(dailyPlanChecks));
  }, [dailyPlanChecks]);

  const snapshot = asRecord(liveOpsPayload);
  const watchdog = asRecord(snapshot.watchdog_state);
  const governance = asRecord(snapshot.governance);
  const recovery = asRecord(snapshot.recovery);
  const memoryGap = asRecord(snapshot.memory_gap);
  const runtimeTruth = asRecord(asRecord(snapshot.raw).runtime_truth);
  const runtimeTruthLayers = asRecord(runtimeTruth.layers);
  const decisionReality = asRecord(runtimeTruthLayers.decision_reality);
  const decisionRealityState = String(decisionReality.decision_reality_state || "UNKNOWN").toUpperCase();
  const decisionRealityNextGate = String(decisionReality.next_gate || "-");
  const decisionCoverageRaw = Number(decisionReality.decision_quote_coverage_pct);
  const decisionCoveragePct = Number.isFinite(decisionCoverageRaw) ? decisionCoverageRaw : null;
  const decisionCoveredRows = toNumber(decisionReality.decision_quote_covered_rows, 0);
  const decisionUncoveredRows = toNumber(decisionReality.decision_quote_uncovered_rows, 0);
  const decisionObservedIgnoredRows = toNumber(decisionReality.decision_quote_observed_ignored_rows, 0);
  const decisionObservedIgnoredRateRaw = Number(decisionReality.decision_quote_observed_ignored_rate_pct);
  const decisionObservedIgnoredRatePct = Number.isFinite(decisionObservedIgnoredRateRaw) ? decisionObservedIgnoredRateRaw : null;
  const decisionIgnoredGateThresholdRaw = Number(decisionReality.decision_quote_ignored_gate_threshold_pct);
  const decisionIgnoredGateThresholdPct = Number.isFinite(decisionIgnoredGateThresholdRaw) ? decisionIgnoredGateThresholdRaw : 5;
  const decisionIgnoredGateAlert = Boolean(decisionReality.decision_quote_ignored_gate_alert);
  const decisionCoverageTone = decisionCoveragePct === null
    ? "subtle"
    : decisionCoveragePct >= 100
      ? "good"
      : decisionCoveragePct >= 75
        ? "subtle"
        : "warn";
  const decisionTopUncoveredReasons = Array.isArray(decisionReality.decision_quote_top_uncovered_reasons)
    ? (decisionReality.decision_quote_top_uncovered_reasons as Array<Record<string, unknown>>)
      .slice(0, 4)
      .map((item) => ({
        reason: formatReasonLabel(String(item.reason || "")),
        count: toNumber(item.count, 0),
      }))
      .filter((item) => item.reason !== "n/a")
    : [];
  const decisionCoverageBreakdown = Array.isArray(decisionReality.decision_quote_coverage_breakdown)
    ? (decisionReality.decision_quote_coverage_breakdown as Array<Record<string, unknown>>)
      .slice(0, 8)
      .map((item) => ({
        label: String(item.label || "").trim() || formatReasonLabel(String(item.key || "")),
        count: toNumber(item.count, 0),
        sharePct: Number.isFinite(Number(item.share_pct)) ? Number(item.share_pct) : null,
      }))
      .filter((item) => item.label !== "n/a")
    : [];
  const decisionCoverageTrend = asRecord(decisionReality.decision_quote_coverage_breakdown_trend);
  const decisionCoverageTrend24h = asRecord(decisionCoverageTrend.last_24h);
  const decisionCoverageTrend7d = asRecord(decisionCoverageTrend.last_7d);
  const decisionCoverageTrendRows = [
    {
      label: "24h",
      sampleRows: toNumber(decisionCoverageTrend24h.sample_rows, 0),
      observedUsedPct: (() => {
        const breakdown = Array.isArray(decisionCoverageTrend24h.breakdown) ? decisionCoverageTrend24h.breakdown as Array<Record<string, unknown>> : [];
        const found = breakdown.find((item) => String(item.key || "") === "quote_observed_and_used");
        const pct = Number(found?.share_pct);
        return Number.isFinite(pct) ? pct : null;
      })(),
      observedIgnoredPct: (() => {
        const breakdown = Array.isArray(decisionCoverageTrend24h.breakdown) ? decisionCoverageTrend24h.breakdown as Array<Record<string, unknown>> : [];
        const found = breakdown.find((item) => String(item.key || "") === "quote_observed_but_ignored");
        const pct = Number(found?.share_pct);
        return Number.isFinite(pct) ? pct : null;
      })(),
    },
    {
      label: "7j",
      sampleRows: toNumber(decisionCoverageTrend7d.sample_rows, 0),
      observedUsedPct: (() => {
        const breakdown = Array.isArray(decisionCoverageTrend7d.breakdown) ? decisionCoverageTrend7d.breakdown as Array<Record<string, unknown>> : [];
        const found = breakdown.find((item) => String(item.key || "") === "quote_observed_and_used");
        const pct = Number(found?.share_pct);
        return Number.isFinite(pct) ? pct : null;
      })(),
      observedIgnoredPct: (() => {
        const breakdown = Array.isArray(decisionCoverageTrend7d.breakdown) ? decisionCoverageTrend7d.breakdown as Array<Record<string, unknown>> : [];
        const found = breakdown.find((item) => String(item.key || "") === "quote_observed_but_ignored");
        const pct = Number(found?.share_pct);
        return Number.isFinite(pct) ? pct : null;
      })(),
    },
  ];
  const decisionIgnoredDrilldown = Array.isArray(decisionReality.decision_quote_ignored_drilldown)
    ? (decisionReality.decision_quote_ignored_drilldown as Array<Record<string, unknown>>)
      .slice(0, 8)
      .map((item) => ({
        path: String(item.decision_path || "").trim() || "unknown_path",
        source: String(item.source || "").trim() || "unknown_source",
        reason: formatReasonLabel(String(item.decision_reason || "").trim() || "n/a"),
        count: toNumber(item.count, 0),
        sharePct: Number.isFinite(Number(item.share_pct)) ? Number(item.share_pct) : null,
        recentDecisionIds: Array.isArray(item.recent_decision_ids)
          ? (item.recent_decision_ids as Array<unknown>).map((value) => String(value || "").trim()).filter(Boolean).slice(0, 3)
          : [],
      }))
      .sort((a, b) => b.count - a.count)
      .filter((item) => item.count > 0)
    : [];
  const decisionIgnoredReasonBreakdown = Array.isArray(decisionReality.decision_quote_ignored_reason_breakdown)
    ? (decisionReality.decision_quote_ignored_reason_breakdown as Array<Record<string, unknown>>)
      .slice(0, 8)
      .map((item) => ({
        reason: formatReasonLabel(String(item.reason || "").trim() || "n/a"),
        count: toNumber(item.count, 0),
        sharePct: Number.isFinite(Number(item.share_pct)) ? Number(item.share_pct) : null,
      }))
      .filter((item) => item.count > 0)
    : [];
  const decisionPathIgnoredThresholdRaw = Number(decisionReality.decision_quote_ignored_path_threshold_pct);
  const decisionPathIgnoredThresholdPct = Number.isFinite(decisionPathIgnoredThresholdRaw) ? decisionPathIgnoredThresholdRaw : 10;
  const decisionPathIgnoredAlerts = Array.isArray(decisionReality.decision_quote_ignored_path_alerts)
    ? (decisionReality.decision_quote_ignored_path_alerts as Array<Record<string, unknown>>)
      .slice(0, 8)
      .map((item) => ({
        path: String(item.decision_path || "").trim() || "unknown_path",
        ignoredRatePct: Number.isFinite(Number(item.ignored_rate_pct)) ? Number(item.ignored_rate_pct) : null,
        ignoredRows: toNumber(item.ignored_rows, 0),
        totalRows: toNumber(item.total_rows, 0),
        alert: Boolean(item.alert),
      }))
      .sort((a, b) => {
        if (a.alert !== b.alert) {
          return a.alert ? -1 : 1;
        }
        return (b.ignoredRatePct || 0) - (a.ignoredRatePct || 0);
      })
      .filter((item) => item.totalRows > 0)
    : [];
  const decisionPathReasonIgnoredThresholdRaw = Number(decisionReality.decision_quote_ignored_path_reason_threshold_pct);
  const decisionPathReasonIgnoredThresholdPct = Number.isFinite(decisionPathReasonIgnoredThresholdRaw) ? decisionPathReasonIgnoredThresholdRaw : 10;
  const decisionPathReasonImpactThresholdRaw = Number(decisionReality.decision_quote_ignored_path_reason_impact_threshold_pct_points);
  const decisionPathReasonImpactThresholdPctPoints = Number.isFinite(decisionPathReasonImpactThresholdRaw) ? decisionPathReasonImpactThresholdRaw : 1;
  const decisionPathReasonIgnoredAlerts = Array.isArray(decisionReality.decision_quote_ignored_path_reason_alerts)
    ? (decisionReality.decision_quote_ignored_path_reason_alerts as Array<Record<string, unknown>>)
      .slice(0, 8)
      .map((item) => ({
        path: String(item.decision_path || "").trim() || "unknown_path",
        reason: formatReasonLabel(String(item.decision_reason || "").trim() || "n/a"),
        ignoredRatePct: Number.isFinite(Number(item.ignored_rate_pct)) ? Number(item.ignored_rate_pct) : null,
        volumeSharePct: Number.isFinite(Number(item.volume_share_pct)) ? Number(item.volume_share_pct) : null,
        impactPctPoints: Number.isFinite(Number(item.impact_pct_points)) ? Number(item.impact_pct_points) : null,
        ignoredRows: toNumber(item.ignored_rows, 0),
        totalRows: toNumber(item.total_rows, 0),
        ignoredRateAlert: Boolean(item.ignored_rate_alert),
        impactAlert: Boolean(item.impact_alert),
        alert: Boolean(item.alert),
      }))
      .sort((a, b) => {
        if (a.alert !== b.alert) {
          return a.alert ? -1 : 1;
        }
        return (b.impactPctPoints || 0) - (a.impactPctPoints || 0);
      })
      .filter((item) => item.totalRows > 0 && item.ignoredRows > 0)
    : [];
  const decisionTopRemediationCandidates = Array.isArray(decisionReality.decision_quote_top_remediation_candidates)
    ? (decisionReality.decision_quote_top_remediation_candidates as Array<Record<string, unknown>>)
      .slice(0, 3)
      .map((item) => ({
        path: String(item.decision_path || "").trim() || "unknown_path",
        reason: formatReasonLabel(String(item.decision_reason || "").trim() || "n/a"),
        ignoredRatePct: Number.isFinite(Number(item.ignored_rate_pct)) ? Number(item.ignored_rate_pct) : null,
        volumeSharePct: Number.isFinite(Number(item.volume_share_pct)) ? Number(item.volume_share_pct) : null,
        impactPctPoints: Number.isFinite(Number(item.impact_pct_points)) ? Number(item.impact_pct_points) : null,
        ignoredRows: toNumber(item.ignored_rows, 0),
        totalRows: toNumber(item.total_rows, 0),
        ignoredRateAlert: Boolean(item.ignored_rate_alert),
        impactAlert: Boolean(item.impact_alert),
        alert: Boolean(item.alert),
        suggestedAction: String(item.suggested_action || "").trim() || "Inspect routing condition.",
      }))
      .filter((item) => item.ignoredRows > 0)
    : [];
  const controlledCollection = asRecord(snapshot.controlled_collection);
  const collectionLabelProgress = asRecord(controlledCollection.label_progress);
  const collectionEdgeConfidence = asRecord(controlledCollection.edge_confidence);
  const collectionStatus = String(controlledCollection.status || "UNCONFIGURED").toUpperCase();
  const collectionNextAction = String(controlledCollection.next_action || "Attend la prochaine mise a jour Live Ops.");
  const collectionThesis = String(controlledCollection.thesis || "Collecter des labels avant de chercher a optimiser.");
  const collectionConstraints = Array.isArray(controlledCollection.constraints) ? controlledCollection.constraints.map((item) => String(item)) : [];
  const collectionForbidden = Array.isArray(controlledCollection.forbidden) ? controlledCollection.forbidden.map((item) => String(item)) : [];
  const collectionStopConditions = Array.isArray(controlledCollection.stop_conditions) ? controlledCollection.stop_conditions.map((item) => String(item)) : [];
  const collectionStage = String(collectionLabelProgress.stage || "BOOTSTRAP");
  const collectionTargetMin = toNumber(collectionLabelProgress.targetMin, 50);
  const collectionTargetMax = toNumber(collectionLabelProgress.targetMax, 100);
  const collectionClassifiedCount = toNumber(collectionLabelProgress.classifiedCount, 0);
  const collectionRecentClassifiedCount = toNumber(collectionLabelProgress.recentClassifiedCount, 0);
  const collectionToTargetMin = toNumber(collectionLabelProgress.toTargetMin, Math.max(0, collectionTargetMin - collectionClassifiedCount));
  const collectionProgressToMinPct = Math.max(0, Math.min(100, toNumber(collectionLabelProgress.progressToMinPct, 0)));
  const collectionProgressToMaxPct = Math.max(0, Math.min(100, toNumber(collectionLabelProgress.progressToMaxPct, 0)));
  const collectionLabelSummary = String(collectionLabelProgress.summary || "Pas encore assez de labels classes pour faire vivre l'edge map.");
  const collectionConfidenceSummary = String(collectionEdgeConfidence.summary || "Confiance edge en attente de labels frais.");
  const collectionTone = collectionStatus === "READY" ? "good" : collectionStatus === "LOCKED" || collectionStatus === "BLOCKED" ? "warn" : "subtle";
  const alerts = Array.isArray(snapshot.alerts) ? snapshot.alerts : [];
  const backendMode = String(governance.backend_mode || "guarded_auto");
  const modeConfig = asRecord(systemModePayload);
  const modeConfigMode = isSystemMode(modeConfig.system_mode) ? modeConfig.system_mode : null;
  const effectiveBackendMode = systemModeOverride || modeConfigMode || backendMode;
  const pnlEnvelope = asRecord(executionPnlAnalyzerPayload);
  const pnlSummary = asRecord(pnlEnvelope.summary);
  const v6Envelope = asRecord(executionAiV6Payload);
  const v6Snapshot = asRecord(v6Envelope.snapshot);
  const v6Guardrails = asRecord(v6Snapshot.guardrails);
  const tradeCount = toNumber(pnlSummary.trade_count, 0);
  const avgLatencyMs = toNumber(pnlSummary.avg_latency_ms, 0);
  const avgSlippageBps = toNumber(pnlSummary.avg_slippage_bps, 0);
  const netPnlUsd = toNumber(pnlSummary.net_pnl_usd, 0);
  const highConfidenceLossCount = toNumber(pnlSummary.high_confidence_loss_count, 0);
  const noTradeDominanceCount = toNumber(pnlSummary.no_trade_dominance_count, 0);
  const noTradeRatioPct = tradeCount > 0 ? (noTradeDominanceCount / tradeCount) * 100 : 0;
  const drawdownPct = toNumber(asRecord(snapshot.risk_snapshot).dd_pct, 0);
  const watchdogStatus = String(watchdog.status || "UNKNOWN").toUpperCase();
  const learningFrozen = Boolean(v6Guardrails.learning_frozen);
  const expectancyR = tradeCount > 0
    ? ((toNumber(pnlSummary.win_rate_pct, 0) / 100) * Math.max(toNumber(pnlSummary.avg_pnl_usd, 0), 0)
      - ((100 - toNumber(pnlSummary.win_rate_pct, 0)) / 100) * Math.abs(Math.min(toNumber(pnlSummary.avg_pnl_usd, 0), 0)))
    : 0;
  const noTradeScore = Math.max(
    0,
    Math.min(
      1,
      (avgLatencyMs > 150 ? 0.3 : avgLatencyMs > 120 ? 0.18 : 0)
      + (avgSlippageBps > 4 ? 0.22 : avgSlippageBps > 3 ? 0.12 : 0)
      + (noTradeRatioPct < 10 ? 0.2 : noTradeRatioPct < 20 ? 0.08 : 0)
      + (highConfidenceLossCount > 0 ? 0.15 : 0)
      + (learningFrozen ? 0.15 : 0),
    ),
  );
  const mt5PendingApprovals = unwrapRows(mt5PendingPayload)
    .map((row) => ({
      approvalId: String(row.approval_id || ""),
      accountId: String(row.account_id || "-"),
      firstApprovedBy: String(row.first_approved_by || "-"),
      createdAt: String(row.created_at || ""),
      orderPayload: asRecord(row.order_payload),
    }))
    .filter((row) => row.approvalId)
    .slice(0, 5);
  const nowMs = Date.now();
  const recentWindowMs = 24 * 60 * 60 * 1000;
  const telemetryRows = unwrapRows(executionTelemetryPayload);
  const recentTelemetryRows = telemetryRows.filter((row) => {
    const timestamp = valueTimeMs(row);
    return timestamp > 0 && nowMs - timestamp <= recentWindowMs;
  });
  const recentMt5TelemetryRows = recentTelemetryRows.filter((row) => {
    const venueText = `${String(row.venue || "")} ${String(row.provider || "")} ${String(row.execution_mode || "")} ${String(row.route || "")}`.toLowerCase();
    return venueText.includes("mt5") || Boolean(row.broker_ticket) || Boolean(row.ts_broker_accept);
  });
  const recentOutcomeRows = unwrapRows(recentOutcomesPayload).filter((row) => {
    const timestamp = valueTimeMs(row);
    return timestamp > 0 && nowMs - timestamp <= recentWindowMs;
  });
  const recentGapRows = unwrapRows(recentGapPayload).filter((row) => {
    const timestamp = valueTimeMs(row);
    return timestamp > 0 && nowMs - timestamp <= recentWindowMs;
  });
  const recentAckCount = recentMt5TelemetryRows.filter((row) => Boolean(row.ts_broker_accept || row.broker_ticket || row.accepted_at)).length;
  const recentFillRows = recentMt5TelemetryRows.filter((row) => Boolean(row.ts_fill_final || row.filled_at || row.fill_count || row.avg_fill_price));
  const recentFillCount = recentFillRows.length;
  const recentOutcomeCount = recentOutcomeRows.length;
  const recentGapCount = recentGapRows.length;
  const recentFillDecisionIds = new Set(
    recentFillRows
      .map((row) => String(row.decision_id || row.intent_id || row.approval_id || row.broker_ticket || "").trim())
      .filter(Boolean),
  );
  const recentOutcomeDecisionIds = new Set(
    recentOutcomeRows
      .map((row) => String(row.decision_id || row.intent_id || row.approval_id || row.broker_ticket || "").trim())
      .filter(Boolean),
  );
  const recentGapDecisionIds = new Set(
    recentGapRows
      .map((row) => String(row.decision_id || row.intent_id || row.approval_id || row.broker_ticket || "").trim())
      .filter(Boolean),
  );
  const recentLinkedLoopCount = [...recentFillDecisionIds].filter((id) => recentOutcomeDecisionIds.has(id) && recentGapDecisionIds.has(id)).length;
  const alphaProofSteps = [
    { id: "ACK", label: "ACK broker", count: recentAckCount, done: recentAckCount > 0 },
    { id: "FILL", label: "FILL reel", count: recentFillCount, done: recentFillCount > 0 },
    { id: "OUTCOME", label: "Outcome", count: recentOutcomeCount, done: recentOutcomeCount > 0 },
    { id: "GAP", label: "Reality Gap", count: recentGapCount, done: recentGapCount > 0 },
    { id: "LINK", label: "Boucle liee", count: recentLinkedLoopCount, done: recentLinkedLoopCount > 0 },
  ];
  const alphaNextAction = recentAckCount <= 0
    ? "Créer une demande micro-fill MT5"
    : recentFillCount <= 0
      ? "Approuver/executer pour obtenir le FILL"
      : recentOutcomeCount <= 0 || recentGapCount <= 0
        ? "Attendre ou réparer Outcome/GAP"
        : recentLinkedLoopCount <= 0
          ? "Relier decision_id / broker_ticket"
          : "Accumuler REAL_10";
  const alphaPanelTone = recentFillCount > 0 && recentLinkedLoopCount > 0
    ? "good"
    : mt5PendingApprovals.length > 0
      ? "warn"
      : "subtle";
  const marketTruthLayer = asRecord(runtimeTruthLayers.market_truth);
  const executionRealityLayer = asRecord(runtimeTruthLayers.execution_reality);
  const executionRealityGovernanceLayer = asRecord(runtimeTruthLayers.execution_reality_governance);
  const finalDecisionTruthLayer = asRecord(runtimeTruthLayers.final_decision_truth);
  const confidenceLayer = asRecord(finalDecisionTruthLayer.confidence);
  const marketTruthScorePct = toNumber(marketTruthLayer.score_pct, 0);
  const executionQualityPct = toNumber(
    asRecord(executionRealityLayer.metrics).execution_quality_score_pct,
    toNumber(executionRealityLayer.score_pct, 0),
  );
  const regimeContribution = Math.round(Math.max(0, Math.min(24, marketTruthScorePct * 0.24)));
  const executionContribution = Math.round(Math.max(0, Math.min(18, executionQualityPct * 0.18)));
  const confidenceContribution = Math.round(Math.max(0, Math.min(22, toNumber(confidenceLayer.final_score_pct, 0) * 0.22)));
  const governanceContribution = backendMode === "managed_live" ? 12 : backendMode === "guarded_auto" ? 6 : 2;
  const proofNeedContribution = recentFillCount <= 0 ? 14 : 4;
  const approvalRiskPenalty = mt5PendingApprovals.length > 0 ? 8 : 0;
  const spreadRiskPenalty = Math.round(Math.max(0, Math.min(8, avgSlippageBps > 4 ? 8 : avgSlippageBps > 3 ? 5 : avgSlippageBps > 2 ? 3 : 0)));
  const executionGovPenalty = String(executionRealityGovernanceLayer.state || "").toUpperCase() === "LOCKDOWN" ? 12 : 0;
  const opportunityScore = Math.max(
    0,
    Math.min(
      100,
      20
      + regimeContribution
      + executionContribution
      + confidenceContribution
      + governanceContribution
      + proofNeedContribution
      - approvalRiskPenalty
      - spreadRiskPenalty
      - executionGovPenalty,
    ),
  );
  const opportunityDrivers = [
    { label: "Regime", value: regimeContribution },
    { label: "Execution", value: executionContribution },
    { label: "Confidence", value: confidenceContribution },
    { label: "Governance", value: governanceContribution },
    { label: "Proof need", value: proofNeedContribution },
  ];
  const opportunityRisks = [
    { label: "Approval pending", value: -approvalRiskPenalty },
    { label: "Spread/slippage", value: -spreadRiskPenalty },
    { label: "Execution governance", value: -executionGovPenalty },
  ].filter((item) => item.value < 0);
  const truthLine = (() => {
    const runtimeTruthVerdict = String(runtimeTruth.verdict || "").toUpperCase();
    if (runtimeTruthVerdict === "BLOCKED") {
      return { label: "BLOCK", tone: "warn", detail: String(runtimeTruth.summary || "runtime truth canonical block") };
    }
    if (runtimeTruthVerdict === "DEGRADED") {
      return { label: "REDUCE", tone: "subtle", detail: String(runtimeTruth.summary || "runtime truth degraded") };
    }
    if (runtimeTruthVerdict === "READY") {
      return { label: "OK", tone: "good", detail: String(runtimeTruth.summary || "runtime truth ready") };
    }
    if (watchdogStatus === "HALT" || String(governance.mode || "SAFE") === "LOCKED") {
      return { label: "BLOCK", tone: "warn", detail: "system guardrails active" };
    }
    if (expectancyR < 0) {
      return { label: "BLOCK", tone: "warn", detail: "expectancy live negatif: stop system avant d'ajuster quoi que ce soit" };
    }
    if (noTradeScore > 0.7) {
      return { label: "BLOCK", tone: "warn", detail: "no-trade score trop eleve: le desk doit refuser le flux" };
    }
    if ((tradeCount >= 5 && netPnlUsd < 0 && highConfidenceLossCount > 0) || drawdownPct >= 3) {
      return { label: "BLOCK", tone: "warn", detail: "stop live and investigate before the next trade" };
    }
    if (learningFrozen || avgLatencyMs > 120 || avgSlippageBps > 3 || tradeCount < 3 || noTradeRatioPct < 10 || noTradeScore > 0.45) {
      return { label: "REDUCE", tone: "subtle", detail: "micro-live only, tighten no-trade and collect more truth" };
    }
    return { label: "OK", tone: "good", detail: "guarded micro-live remains acceptable" };
  })();
  const planCards = [
    {
      title: "Pre-open",
      tone: watchdogStatus === "OK" && String(memoryGap.memory_decision || "OK") === "OK" ? "good" : "warn",
      headline: `${watchdogStatus} / memory ${String(memoryGap.memory_decision || "OK")}`,
      detail: "Verifie watchdog, memory gate et mode systeme avant la premiere decision live.",
    },
    {
      title: "Collecte",
      tone: tradeCount <= 10 ? "good" : "warn",
      headline: `${tradeCount.toFixed(0)} / 10 trades max`,
      detail: "Reste en micro-live. L'objectif du jour est la qualite de donnees, pas le volume.",
    },
    {
      title: "Filtrage",
      tone: avgLatencyMs <= 120 && avgSlippageBps <= 3 && noTradeRatioPct >= 10 ? "good" : avgLatencyMs > 150 || avgSlippageBps > 4 ? "warn" : "subtle",
      headline: `${avgLatencyMs.toFixed(0)}ms · ${avgSlippageBps.toFixed(2)}bps · no-trade ${noTradeRatioPct.toFixed(0)}%`,
      detail: "Latence, slippage et dominance du no-trade doivent rester stricts avant toute montee en taille.",
    },
    {
      title: "Hard stops",
      tone: drawdownPct >= 3 || (tradeCount >= 5 && netPnlUsd <= 0) || highConfidenceLossCount > 0 ? "warn" : learningFrozen ? "subtle" : "good",
      headline: `DD ${drawdownPct.toFixed(2)}% · flags ${highConfidenceLossCount.toFixed(0)} · V6 ${learningFrozen ? "frozen" : "active"}`,
      detail: "Si l'expectancy tourne negatif ou que les flags montent, stoppe le live et garde la calibration verrouillee.",
    },
  ];
  const calibrationProgressPct = Math.min(100, Math.round((tradeCount / 50) * 100));
  const sprintStartDate = parseDateKey(dailyPlanSprintStart) || startOfLocalDay(new Date());
  const today = startOfLocalDay(new Date());
  const dailyPlanBlueprint: DailyPlanTemplateDay[] = [
    {
      dayOffset: 0,
      title: "Jour 1 · Bootstrap micro-live",
      focus: "Ouvrir une collecte controlee, pas chercher un PnL heroique",
      objective: `${collectionClassifiedCount}/${collectionTargetMin} labels vers le seuil minimum`,
      context: `Mode ${collectionStatus} · stage ${collectionStage} · gate ${String(asRecord(governance.opportunity_gate).status || "unknown")}`,
      tasks: [
        { id: "preopen-check", title: "Valider pre-open", detail: `Kill switch ${watchdogStatus === "HALT" ? "a reset manuellement" : "neutralise"}, opportunity gate ${String(asRecord(governance.opportunity_gate).status || "unknown")}, mode ${backendMode}.` },
        { id: "size-fixed", title: "Verrouiller le scope", detail: "BingX uniquement, BTCUSDT uniquement, 7-7.5$ max, aucun scaling." },
        { id: "max-10-trades", title: "Limiter le flux", detail: "Chaque trade = data point. Max 10 trades, no-trade prioritaire si le contexte se degrade." },
        { id: "avoid-revenge", title: "Interdire les tweaks", detail: "Aucun tweak de strategie, aucun changement de seuil, aucun scalping de poursuite." },
      ],
    },
    {
      dayOffset: 1,
      title: "Jour 2 · Collecte disciplinee",
      focus: "Mesurer execution, slippage et qualite des labels avant toute idee de perf",
      objective: "Labels propres > resultat brut",
      context: `Latency ${avgLatencyMs.toFixed(0)}ms · slippage ${avgSlippageBps.toFixed(2)}bps · recent labels ${collectionRecentClassifiedCount}`,
      tasks: [
        { id: "latency-watch", title: "Surveiller latency", detail: `Reduire si latency > 120ms, stop infra si > 200ms.` },
        { id: "fills-review", title: "Verifier fills", detail: "Comparer fill rate et slippage reel avant d'autoriser un flux plus dense." },
        { id: "context-lock", title: "Respecter le contexte", detail: "Si volatilite spike + liquidite faible, repasse en NO TRADE sans changer de strategie." },
        { id: "close-check", title: "Cloture sobre", detail: "Pas de trade de rattrapage et pas de changement de venue/instrument en fin de session." },
      ],
    },
    {
      dayOffset: 2,
      title: "Jour 3 · Verite PnL",
      focus: "Confirmer que l'expectancy et le no-trade racontent la meme histoire",
      objective: "Verite > ego",
      context: `Expectancy ${expectancyR >= 0 ? "+" : ""}${expectancyR.toFixed(2)}R · no-trade score ${(noTradeScore * 100).toFixed(0)}%`,
      tasks: [
        { id: "expectancy-check", title: "Verifier expectancy", detail: "Si expectancy live est negatif, stop system et ouvre l'analyse." },
        { id: "truth-panel-review", title: "Relire Truth Panel", detail: "Comparer regime, venue et execution mode pour localiser la destruction de PnL." },
        { id: "error-log", title: "Logger erreurs a eviter", detail: "Noter forcing, latence, overtrading ou baisse de discipline." },
        { id: "close-rules", title: "Valider respect des regles", detail: "Fin de journee: rules respectees, erreurs identifiees, aucune action punitive." },
      ],
    },
    {
      dayOffset: 3,
      title: "Jour 4 · Calibration V2 legere",
      focus: "Adapter sans casser",
      objective: "Petits ajustements, aucune derive",
      context: `${tradeCount.toFixed(0)} trades observes · gate calibration ${tradeCount >= 20 ? "ouvrable legerement" : "encore verrouillee"}`,
      tasks: [
        { id: "trade-count-gate", title: "Verifier gate 20 trades", detail: "Si moins de 20 trades aujourd'hui, garder learning LOW et aucune auto-calibration." },
        { id: "reward-lock", title: "Appliquer negative lock", detail: `Si reward EMA ou expectancy tourne negatif, freeze learning immediat.` },
        { id: "regime-lock", title: "Confirmer regime lock", detail: "Aucun update learning si regime inconnu ou contexte degrade." },
        { id: "v4-fallback", title: "Valider safe fallback", detail: "Au moindre signal d'anomalie, retour vers logique V4/V4.2." },
      ],
    },
    {
      dayOffset: 4,
      title: "Jour 5 · No-trade dominance",
      focus: "Moins trader, mieux trader",
      objective: "No-trade > sur-trading",
      context: `Dominance ${noTradeDominanceCount.toFixed(0)} / ${tradeCount.toFixed(0)} · drawdown ${drawdownPct.toFixed(2)}%`,
      tasks: [
        { id: "dominance-review", title: "Revoir score no-trade", detail: "Si no_trade_score > 0.7, forcer NO TRADE sur le flux degrade." },
        { id: "micro-killswitch", title: "Activer micro kill-switch", detail: "3 pertes = size -50%, 5 pertes = STOP." },
        { id: "context-stop", title: "Bloquer contexte toxique", detail: "Volatility spike + low liquidity = NO TRADE sans discussion." },
        { id: "queue-hygiene", title: "Relire hygiene execution", detail: "Pas d'entree agressive si queue, fill prob ou spread se degradent." },
      ],
    },
    {
      dayOffset: 5,
      title: "Jour 6 · Ajustements bornes",
      focus: "Ajuster 3 variables maximum",
      objective: "Confidence, fill, latency seulement",
      context: "Confidence floor, fill probability floor et latency threshold sont les seuls leviers autorises.",
      tasks: [
        { id: "confidence-floor", title: "Ajuster confidence floor", detail: "Micro-ajustement seulement, jamais de grand saut de seuil." },
        { id: "fill-floor", title: "Ajuster fill probability", detail: "Relever le filtre si les fills degradent ou si le slippage explose." },
        { id: "latency-threshold", title: "Ajuster seuil latency", detail: "Ne jamais relacher le seuil si l'infra reste instable." },
        { id: "rollback-ready", title: "Garder rollback pret", detail: "Si drawdown > 3% ou anomalie, revert immediate de la calibration." },
      ],
    },
    {
      dayOffset: 6,
      title: "Jour 7 · Gate de scaling",
      focus: "Go / no-go pour la phase suivante",
      objective: "Scaler seulement si stable",
      context: `${tradeCount.toFixed(0)} / 50 trades · DD ${drawdownPct.toFixed(2)}% · expectancy ${expectancyR >= 0 ? "+" : ""}${expectancyR.toFixed(2)}R`,
      tasks: [
        { id: "scale-check", title: "Verifier conditions phase 2", detail: "50+ trades, expectancy > 0, drawdown < 3% avant tout x1.5." },
        { id: "profit-factor-check", title: "Confirmer stabilite", detail: "Si la stabilite n'est pas prouvee, rester en phase 1 sans ego." },
        { id: "close-audit", title: "Boucler audit de discipline", detail: "Valider que les regles, hard stops et erreurs ont ete revus proprement." },
        { id: "next-sprint", title: "Preparer sprint suivant", detail: "Si le sprint est propre, recalculer les dates et repartir sur un cycle discipline." },
      ],
    },
  ];
  const dailyPlanDays = dailyPlanBlueprint.map((day) => {
    const date = addDays(sprintStartDate, day.dayOffset);
    const dateKey = toDateKey(date);
    const dayPassed = date.getTime() < today.getTime();
    const isToday = date.getTime() === today.getTime();
    return {
      ...day,
      date,
      dateKey,
      dayPassed,
      isToday,
      tasks: day.tasks.map((task) => {
        const taskKey = `${dateKey}:${task.id}`;
        return {
          ...task,
          taskKey,
          done: Boolean(dailyPlanChecks[taskKey]),
        };
      }),
    };
  });

  function openDeskBriefing(): void {
    openOpsCopilotPrompt({ message: "Resume-moi en langage naturel le desk du jour: verite PnL, no-trade, risque, V6 et priorites operationnelles.", autoSend: true });
    void appendLiveOpsJournalEntry("ops-brief-opened", "Briefing Ops Copilot demande", {
      source: "live-ops-page",
      prompt: "desk-day-brief",
    });
  }

  function openDailyPlanBrief(): void {
    openOpsCopilotPrompt({ message: "Rappelle-moi le plan journalier a respecter aujourd'hui avec hard stops et calibration gate.", autoSend: true });
    void appendLiveOpsJournalEntry("daily-plan-brief-opened", "Plan journalier relu via Ops Copilot", {
      source: "live-ops-page",
      prompt: "daily-plan-brief",
    });
  }

  function openCommandantBrief(): void {
    openOpsCopilotPrompt({ message: "Mode commandant: que faire maintenant sur Live Ops ? Donne DECISION, RISQUE, RAISON et rappelle que l'override doit rester visible.", autoSend: true });
    void appendLiveOpsJournalEntry("commandant-brief-opened", "Mode commandant demande depuis Live Ops", {
      source: "live-ops-page",
      prompt: "commandant-live-ops",
    });
  }

  function openSprintBrief(): void {
    openOpsCopilotPrompt({ message: "Rappelle-moi le plan journalier du sprint en cours, les taches en retard et les hard stops a ne pas violer.", autoSend: true });
    void appendLiveOpsJournalEntry("sprint-brief-opened", "Brief sprint demande", {
      source: "live-ops-page",
      prompt: "sprint-brief",
    });
  }

  function toggleDailyPlanTask(taskKey: string, title: string, dayTitle: string): void {
    const nextDone = !dailyPlanChecks[taskKey];
    setDailyPlanChecks((current) => ({
      ...current,
      [taskKey]: nextDone,
    }));
    void appendLiveOpsJournalEntry(nextDone ? "daily-plan-task-done" : "daily-plan-task-reopened", `${dayTitle} · ${title}`, {
      source: "live-ops-page",
      task_key: taskKey,
      done: nextDone,
    });
  }

  function resetDailyPlanSprint(): void {
    const nextKey = toDateKey(startOfLocalDay(new Date()));
    setDailyPlanSprintStart(nextKey);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DAILY_PLAN_SPRINT_STORAGE_KEY, nextKey);
    }
    if (nextKey !== dailyPlanSprintStart) {
      void appendLiveOpsJournalEntry("daily-plan-sprint-reset", `Sprint recale sur ${nextKey}`, {
        source: "live-ops-page",
        sprint_start: nextKey,
      });
    }
  }

  if (!hydrated || !liveOpsPayload) {
    return (
      <main className="shell txt-page-shell" data-testid="mission-control-live-ops-page">
        <section className="panel txt-page-hero">
          <div className="eyebrow">TXT</div>
          <h1 className="title" style={{ fontSize: 34 }}>Synchronisation Live Ops</h1>
          <p className="subtle">La salle de controle charge le snapshot runtime. Si un endpoint est lent, l'etat operateur reste en mode degrade plutot que de bloquer une action.</p>
          {error ? <p className="warn">{error}</p> : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <button type="button" disabled={busy} onClick={() => { void loadData(); }}>
              {busy || loading ? "Synchronisation..." : "Reessayer"}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="shell txt-page-shell" data-testid="mission-control-live-ops-page">
      <section className="hero txt-page-hero-grid" style={{ gridTemplateColumns: "1.25fr 1fr" }}>
        <div id="global-guide-liveops-hero" className="panel txt-page-hero">
          <div className="eyebrow">Live Ops Control Room</div>
          <h1 className="title" style={{ fontSize: 34 }}>H24 Control Room</h1>
          <p className="subtle">Route dediee au pilotage live des gardes systeme, de la recovery et de la warfare logic. Le menu global pointe maintenant vers une vraie page, plus vers une route manquante.</p>
          <OperatorPanelGuide
            title="Guide Live Ops"
            what="L'état des protections du système, des alertes et du mode de secours."
            why="Savoir en quelques secondes si la machine reste fiable ou si elle doit ralentir."
            example="Si le score de santé baisse et que le mode de secours s'active, réduis le risque et cherche la cause."
            actions={(
              <>
                <button type="button" onClick={openDeskBriefing}>Briefing Ops Copilot</button>
                <button type="button" onClick={openDailyPlanBrief}>Plan journalier</button>
              </>
            )}
          />
          <p>
            <Link href="/dashboard">Dashboard</Link>
            {" | "}
            <Link href="/terminal">Terminal</Link>
            {" | "}
            <Link href="/live-readiness">{UI_TERMS.readiness}</Link>
            {" | "}
            <Link href="/incidents">Incidents</Link>
          </p>
          {error ? <p className="warn">{error}</p> : null}
        </div>
        <div className="panel">
          <div className="eyebrow">Etat Global</div>
          <div className="row"><span>Watchdog</span><span className={String(watchdog.status || "UNKNOWN") === "OK" ? "good" : "warn"}>{String(watchdog.status || "UNKNOWN")}</span></div>
          <div className="row"><span>Health score</span><span>{toNumber(watchdog.health_score, 0).toFixed(0)}%</span></div>
          <div className="row"><span>System mode</span><span className={String(governance.mode || "SAFE") === "LIVE" ? "good" : String(governance.mode || "SAFE") === "LOCKED" ? "warn" : "subtle"}>{String(governance.mode || "SAFE")}</span></div>
          <div className="row"><span>Backend mode</span><span>{backendMode}</span></div>
          <div className="row"><span>Recovery</span><span>{String(recovery.mode || "NOMINAL")}</span></div>
          <div className="row"><span>Memory gate</span><span className={String(memoryGap.memory_decision || "OK") === "OK" ? "good" : "warn"}>{String(memoryGap.memory_decision || "OK")}</span></div>
          <div className="row"><span>Alertes live</span><span>{String(alerts.length)}</span></div>
          <div className="row"><span>Refresh</span><span>{loading ? "bootstrap" : busy ? "sync" : "15s"}</span></div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr", marginBottom: 16 }}>
        <div className="panel">
          <OperatorActionSummary
            executionPnlPayload={executionPnlAnalyzerPayload}
            runtimeOpsPayload={liveOpsPayload}
            executionAiV6Payload={executionAiV6Payload}
            passiveMode
            journalContext={LIVE_OPS_JOURNAL_CONTEXT}
            formatClock={formatClock}
            footer={(
              <>
                <button type="button" onClick={openCommandantBrief}>
                  Mode commandant
                </button>
                <Link href="/terminal">Executer depuis le terminal</Link>
              </>
            )}
          />
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr", marginBottom: 16 }}>
        <div className="panel">
          <OperatorPanelGuide
            title="Pilotage du mode systeme"
            what="Bascule le systeme entre suggestion, auto garde et live gouverne."
            why="Tracer chaque changement de posture du desk avant et apres la bascule live."
            example="Passe en managed_live seulement si la route live, les credentials et la gouvernance sont prets."
            compact
          />
          <div className="row"><span>Mode backend actif</span><span>{effectiveBackendMode}</span></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button type="button" disabled={systemModeBusy || effectiveBackendMode === "suggest"} onClick={() => { void changeSystemMode("suggest"); }}>
              Suggest
            </button>
            <button type="button" disabled={systemModeBusy || effectiveBackendMode === "guarded_auto"} onClick={() => { void changeSystemMode("guarded_auto"); }}>
              Guarded Auto
            </button>
            <button type="button" disabled={systemModeBusy || effectiveBackendMode === "managed_live"} onClick={() => { void changeSystemMode("managed_live"); }}>
              Managed Live
            </button>
          </div>
          {systemModeFeedback ? <p className="subtle" style={{ marginTop: 10 }}>{systemModeFeedback}</p> : null}
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1.05fr 0.95fr", marginBottom: 16 }}>
        <div className="panel" data-testid="alpha-reactivation-console">
          <OperatorPanelGuide
            title="Alpha Reactivation Console"
            what="Flux unique: TXT propose, l'operateur approuve, TXT execute, puis les preuves ACK/FILL/OUTCOME/GAP sont mesurees."
            why="Eviter de perdre une session parce que l'approbation humaine attendait ailleurs."
            example="S'il y a une approval pending, le prochain geste operateur est visible ici."
            compact
          />
          <div className="row" style={{ marginTop: 10 }}>
            <span>Next action</span>
            <span className={alphaPanelTone}>{alphaNextAction}</span>
          </div>
          <div className="row"><span>Mode backend</span><span>{effectiveBackendMode}</span></div>
          <div className="row"><span>Pending approvals</span><span className={mt5PendingApprovals.length > 0 ? "warn" : "subtle"}>{mt5PendingApprovals.length}</span></div>
          <div style={{ marginTop: 12, borderRadius: 12, border: "1px solid rgba(148, 163, 184, 0.18)", padding: 12, background: "rgba(2, 6, 23, 0.18)" }}>
            <div className="row"><span>Proposition TXT</span><span>MT5 · AUTO · buy · 0.01 lot</span></div>
            <div className="row"><span>Notional estime</span><span>5 USD</span></div>
            <div className="row"><span>Spread max</span><span>10 bps</span></div>
            <div className="row"><span>But</span><span>renouveler FILL reel</span></div>
            <div className="subtle mini" style={{ marginTop: 8 }}>Ordre reel potentiel. Le compte live MT5 cree une demande en attente, puis un second operateur doit approuver.</div>
          </div>
          <div style={{ marginTop: 12, borderRadius: 12, border: "1px solid rgba(56, 189, 248, 0.22)", padding: 12, background: "rgba(8, 47, 73, 0.22)" }}>
            <div className="row">
              <span>Opportunity score</span>
              <span className={opportunityScore >= 70 ? "good" : opportunityScore >= 50 ? "subtle" : "warn"}>{opportunityScore}/100</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
              <div>
                <div className="subtle mini" style={{ marginBottom: 6 }}>Pourquoi proposer</div>
                {opportunityDrivers.map((item) => (
                  <div key={item.label} className="row" style={{ marginTop: 4 }}>
                    <span>{item.label}</span>
                    <span className="good">+{item.value}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="subtle mini" style={{ marginBottom: 6 }}>Risques</div>
                {opportunityRisks.length > 0 ? opportunityRisks.map((item) => (
                  <div key={item.label} className="row" style={{ marginTop: 4 }}>
                    <span>{item.label}</span>
                    <span className="warn">{item.value}</span>
                  </div>
                )) : (
                  <div className="subtle mini">Aucun risque principal detecte dans le snapshot courant.</div>
                )}
              </div>
            </div>
            <div className="subtle mini" style={{ marginTop: 8 }}>Ce score explique la demande operateur; il ne remplace pas le risk gateway ni la double approbation.</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button
              type="button"
              disabled={alphaSubmitBusy || effectiveBackendMode !== "managed_live"}
              onClick={() => { void submitAlphaReactivationRequest(); }}
            >
              {alphaSubmitBusy ? "Preparation..." : "Preparer demande MT5"}
            </button>
            <button type="button" disabled={busy} onClick={() => { void loadData(); }}>
              Rafraichir preuves
            </button>
          </div>
          {effectiveBackendMode !== "managed_live" ? (
            <p className="subtle mini" style={{ marginTop: 8 }}>Passe en Managed Live avant de creer une demande MT5 reelle.</p>
          ) : null}
          {alphaFeedback ? <p className="subtle" style={{ marginTop: 10 }}>{alphaFeedback}</p> : null}
        </div>
        <div className="panel">
          <div className="eyebrow">Preuves 24h</div>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {alphaProofSteps.map((step) => (
              <div key={step.id} className="row">
                <span>{step.id} · {step.label}</span>
                <span className={step.done ? "good" : "warn"}>{step.done ? "OK" : "manquant"} · {step.count}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <div className="subtle mini" style={{ marginBottom: 6 }}>Approbations MT5 en attente</div>
            {mt5PendingApprovals.length > 0 ? (
              <div style={{ display: "grid", gap: 8 }}>
                {mt5PendingApprovals.map((approval) => {
                  const payload = approval.orderPayload;
                  return (
                    <div key={approval.approvalId} style={{ border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 12, padding: 10, background: "rgba(15, 23, 42, 0.22)" }}>
                      <div className="row">
                        <span>{String(payload.symbol || "AUTO")} · {String(payload.side || "buy")}</span>
                        <span className="warn">approval pending</span>
                      </div>
                      <div className="subtle mini" style={{ marginTop: 4 }}>
                        id {approval.approvalId} · first {approval.firstApprovedBy} · account {approval.accountId}
                      </div>
                      <div className="subtle mini" style={{ marginTop: 4 }}>
                        lots {String(payload.lots || "0.01")} · notional {String(payload.estimated_notional_usd || "5")} USD · {approval.createdAt ? formatClock(approval.createdAt) : "-"}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                        <button
                          type="button"
                          disabled={Boolean(alphaApproveBusyId)}
                          onClick={() => { void approveAlphaReactivationRequest(approval.approvalId); }}
                        >
                          {alphaApproveBusyId === approval.approvalId ? "Approbation..." : "Approuver maintenant"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="subtle mini">Aucune approbation MT5 en attente. Si tu attendais un trade, c'est ici que l'attente doit apparaitre.</div>
            )}
          </div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1.1fr 0.9fr", marginBottom: 16 }}>
        <div className="panel">
          <OperatorPanelGuide
            title="Collecte Controlee"
            what="Cadre operateur pour produire des labels reaction x regime x outcome sans retomber dans une logique HFT ou scalping."
            why="Transformer le live en pipeline de collecte mesurable, pas en chasse au profit prematuree."
            example="Si le kill switch est reset et que l'opportunity gate est GO, ouvre seulement une session BingX / BTCUSDT / 7-7.5$."
            compact
          />
          <div className="row" style={{ marginTop: 10 }}><span>Status</span><span className={collectionTone}>{collectionStatus}</span></div>
          <div className="row"><span>Stage labels</span><span>{collectionStage}</span></div>
          <div className="row"><span>Labels classes</span><span>{collectionClassifiedCount} / {collectionTargetMin} min · {collectionTargetMax} plein</span></div>
          <div className="row"><span>Recent classes</span><span>{collectionRecentClassifiedCount}</span></div>
          <div className="row"><span>Progress min</span><span>{collectionProgressToMinPct.toFixed(0)}%</span></div>
          <div className="row"><span>Progress max</span><span>{collectionProgressToMaxPct.toFixed(0)}%</span></div>
          <div className="row"><span>Confiance edge</span><span>{String(collectionEdgeConfidence.level || "LOW")} · {toNumber(collectionEdgeConfidence.scorePct, 0).toFixed(0)}%</span></div>
          <p className="subtle" style={{ marginTop: 10 }}>{collectionThesis}</p>
          <p className="subtle mini" style={{ marginTop: 6 }}>{collectionNextAction}</p>
          <div style={{ marginTop: 10, height: 8, borderRadius: 999, background: "rgba(148, 163, 184, 0.14)", overflow: "hidden" }}>
            <div style={{ width: `${collectionProgressToMinPct}%`, height: "100%", background: collectionProgressToMinPct >= 100 ? "linear-gradient(90deg, rgba(34,197,94,0.9), rgba(16,185,129,0.9))" : "linear-gradient(90deg, rgba(56,189,248,0.9), rgba(14,165,233,0.9))" }} />
          </div>
          <div className="subtle mini" style={{ marginTop: 8 }}>{collectionLabelSummary}</div>
          <div className="subtle mini" style={{ marginTop: 4 }}>{collectionConfidenceSummary}</div>
        </div>
        <div className="panel">
          <div className="eyebrow">Cadre Non-Negociable</div>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            <div>
              <div className="subtle mini" style={{ marginBottom: 6 }}>Conditions fixes</div>
              <div style={{ display: "grid", gap: 6 }}>
                {collectionConstraints.map((item) => (
                  <div key={item} className="row"><span>{item}</span><span className="good">LOCK</span></div>
                ))}
              </div>
            </div>
            <div>
              <div className="subtle mini" style={{ marginBottom: 6 }}>A ne pas faire</div>
              <div style={{ display: "grid", gap: 6 }}>
                {collectionForbidden.map((item) => (
                  <div key={item} className="row"><span>{item}</span><span className="warn">NO</span></div>
                ))}
              </div>
            </div>
            <div>
              <div className="subtle mini" style={{ marginBottom: 6 }}>Stop immediat si</div>
              <div style={{ display: "grid", gap: 6 }}>
                {collectionStopConditions.map((item) => (
                  <div key={item} className="row"><span>{item}</span><span className="warn">STOP</span></div>
                ))}
              </div>
            </div>
            <div className="subtle mini">Encore {collectionToTargetMin} labels pour atteindre le seuil minimum exploitable.</div>
          </div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr", marginBottom: 16 }}>
        <div className="panel">
          <ControlRoomMonitoringPanel
            badge={null}
            layoutEditMode={false}
            onDetach={() => {}}
            runtimeOpsPayload={liveOpsPayload}
            emergencyStopBusy={emergencyStopBusy}
            emergencyStopFeedback={emergencyStopFeedback}
            onEmergencyStop={() => { void triggerEmergencyStop(); }}
            formatClock={formatClock}
          />
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1.15fr 0.85fr", marginBottom: 16 }}>
        <div className="panel">
          <ExecutionPnlTruthMonitoringPanel
            badge={null}
            layoutEditMode={false}
            onDetach={() => {}}
            payload={executionPnlAnalyzerPayload}
            runtimeOpsPayload={liveOpsPayload}
            executionAiV6Payload={executionAiV6Payload}
            passiveMode
            journalContext={LIVE_OPS_JOURNAL_CONTEXT}
            formatClock={formatClock}
          />
        </div>
        <div className="panel">
          <OperatorPanelGuide
            title="Plan Journalier"
            what="Checklist d'exploitation bornee: survivre, mesurer, filtrer, puis seulement calibrer."
            why="Donner la lecture du jour sans ouvrir plusieurs panneaux ou briefs disperses."
            example="Si le truth line passe a BLOCK, arrete le live avant d'ajouter une seule feature."
            compact
          />
          <div className="row" style={{ marginTop: 10 }}><span>Truth line</span><span className={truthLine.tone}>{truthLine.label}</span></div>
          <p className="subtle" style={{ marginTop: 8 }}>{truthLine.detail}</p>
          <div className="row" style={{ marginTop: 8 }}><span>Expectancy live</span><span className={expectancyR >= 0 ? "good" : "warn"}>{expectancyR >= 0 ? "+" : ""}{expectancyR.toFixed(2)}R</span></div>
          <div className="row" style={{ marginTop: 6 }}><span>No-trade score</span><span className={noTradeScore > 0.7 ? "warn" : noTradeScore > 0.45 ? "subtle" : "good"}>{(noTradeScore * 100).toFixed(0)}%</span></div>
          <div style={{ marginTop: 12, borderRadius: 12, border: "1px solid rgba(148, 163, 184, 0.18)", padding: 12, background: "rgba(2, 6, 23, 0.18)" }}>
            <div className="row"><span>{UI_TERMS.decisionReality}</span><span className={decisionCoverageTone}>{decisionCoveragePct === null ? "n/a" : `${decisionCoveragePct.toFixed(2)}%`}</span></div>
            <div className="row"><span>Etat</span><span>{decisionRealityState}</span></div>
            <div className="row"><span>Couvertes</span><span>{decisionCoveredRows}</span></div>
            <div className="row"><span>Non couvertes</span><span>{decisionUncoveredRows}</span></div>
            <div className="row"><span>Observed but ignored</span><span>{decisionObservedIgnoredRows}{decisionObservedIgnoredRatePct === null ? "" : ` · ${decisionObservedIgnoredRatePct.toFixed(2)}%`}</span></div>
            <div className="row"><span>Gate alert ({decisionIgnoredGateThresholdPct.toFixed(1)}%)</span><span className={decisionIgnoredGateAlert ? "warn" : "good"}>{decisionIgnoredGateAlert ? "ALERT" : "OK"}</span></div>
            <div className="row"><span>Prochain gate</span><span>{decisionRealityNextGate}</span></div>
            {decisionTopUncoveredReasons.length > 0 ? (
              <div className="subtle mini" style={{ marginTop: 8 }}>
                Raisons principales: {decisionTopUncoveredReasons.map((item) => `${item.reason} (${item.count})`).join(" · ")}
              </div>
            ) : (
              <div className="subtle mini" style={{ marginTop: 8 }}>Raisons principales: n/a</div>
            )}
            {decisionCoverageBreakdown.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <div className="subtle mini" style={{ marginBottom: 6 }}>Decision Coverage Breakdown</div>
                {decisionCoverageBreakdown.map((item) => (
                  <div className="row" key={`${item.label}-${item.count}`} style={{ marginTop: 4 }}>
                    <span>{item.label}</span>
                    <span>{item.count}{item.sharePct === null ? "" : ` · ${item.sharePct.toFixed(2)}%`}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <div style={{ marginTop: 10 }}>
              <div className="subtle mini" style={{ marginBottom: 6 }}>Trend couverture</div>
              {decisionCoverageTrendRows.map((row) => (
                <div className="row" key={row.label} style={{ marginTop: 4 }}>
                  <span>{row.label}</span>
                  <span>
                    used {row.observedUsedPct === null ? "n/a" : `${row.observedUsedPct.toFixed(2)}%`} · ignored {row.observedIgnoredPct === null ? "n/a" : `${row.observedIgnoredPct.toFixed(2)}%`} · n={row.sampleRows}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="subtle mini" style={{ marginBottom: 6 }}>Alertes par decision_path (seuil {decisionPathIgnoredThresholdPct.toFixed(1)}%)</div>
              {decisionPathIgnoredAlerts.length > 0 ? decisionPathIgnoredAlerts.map((item) => (
                <div className="row" key={`${item.path}-${item.totalRows}-${item.ignoredRows}`} style={{ marginTop: 4 }}>
                  <span>{item.path}</span>
                  <span className={item.alert ? "warn" : "good"}>
                    ignored {item.ignoredRatePct === null ? "n/a" : `${item.ignoredRatePct.toFixed(2)}%`} · {item.ignoredRows}/{item.totalRows} · {item.alert ? "ALERT" : "OK"}
                  </span>
                </div>
              )) : (
                <div className="subtle mini">Aucune alerte par path sur la fenetre active.</div>
              )}
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="subtle mini" style={{ marginBottom: 6 }}>
                Alertes par path + reason (seuil ignored {decisionPathReasonIgnoredThresholdPct.toFixed(1)}% · seuil impact {decisionPathReasonImpactThresholdPctPoints.toFixed(2)} pts)
              </div>
              {decisionPathReasonIgnoredAlerts.length > 0 ? decisionPathReasonIgnoredAlerts.map((item) => (
                <div className="row" key={`${item.path}-${item.reason}-${item.totalRows}-${item.ignoredRows}`} style={{ marginTop: 4 }}>
                  <span>{item.path} · {item.reason}</span>
                  <span className={item.alert ? "warn" : "good"}>
                    ignored {item.ignoredRatePct === null ? "n/a" : `${item.ignoredRatePct.toFixed(2)}%`} · impact {item.impactPctPoints === null ? "n/a" : `${item.impactPctPoints.toFixed(2)} pts`} · vol {item.volumeSharePct === null ? "n/a" : `${item.volumeSharePct.toFixed(2)}%`} · {item.ignoredRows}/{item.totalRows} · {item.alert ? "ALERT" : "OK"}
                    {item.ignoredRateAlert ? " · by-rate" : ""}
                    {item.impactAlert ? " · by-impact" : ""}
                  </span>
                </div>
              )) : (
                <div className="subtle mini">Aucune alerte path+reason sur la fenetre active.</div>
              )}
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="subtle mini" style={{ marginBottom: 6 }}>Top 3 remediation candidates (impact = % ignored × volume)</div>
              {decisionTopRemediationCandidates.length > 0 ? decisionTopRemediationCandidates.map((item, index) => (
                <div key={`${item.path}-${item.reason}-${index}`} style={{ marginTop: 6, border: "1px solid rgba(148, 163, 184, 0.12)", borderRadius: 10, padding: "6px 8px" }}>
                  <div className="row">
                    <span>#{index + 1} {item.path} · {item.reason}</span>
                    <span className={item.alert ? "warn" : "subtle"}>
                      impact {item.impactPctPoints === null ? "n/a" : `${item.impactPctPoints.toFixed(2)} pts`}
                      {item.ignoredRateAlert ? " · by-rate" : ""}
                      {item.impactAlert ? " · by-impact" : ""}
                    </span>
                  </div>
                  <div className="subtle mini" style={{ marginTop: 4 }}>
                    ignored {item.ignoredRatePct === null ? "n/a" : `${item.ignoredRatePct.toFixed(2)}%`} · volume {item.volumeSharePct === null ? "n/a" : `${item.volumeSharePct.toFixed(2)}%`} · {item.ignoredRows}/{item.totalRows}
                  </div>
                  <div className="subtle mini" style={{ marginTop: 4 }}>
                    action: {item.suggestedAction}
                  </div>
                </div>
              )) : (
                <div className="subtle mini">Aucune remediation candidate calculable sur la fenetre active.</div>
              )}
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="subtle mini" style={{ marginBottom: 6 }}>Breakdown reasons · Quote observed but ignored</div>
              {decisionIgnoredReasonBreakdown.length > 0 ? decisionIgnoredReasonBreakdown.map((item) => (
                <div className="row" key={`${item.reason}-${item.count}`} style={{ marginTop: 4 }}>
                  <span>{item.reason}</span>
                  <span>{item.count}{item.sharePct === null ? "" : ` · ${item.sharePct.toFixed(2)}%`}</span>
                </div>
              )) : (
                <div className="subtle mini">Aucune raison instrumentee sur la fenetre active.</div>
              )}
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="subtle mini" style={{ marginBottom: 6 }}>Gate Cause Drilldown · Quote observed but ignored</div>
              {decisionIgnoredDrilldown.length > 0 ? decisionIgnoredDrilldown.map((item) => (
                <div key={`${item.path}-${item.source}-${item.reason}-${item.count}`} style={{ marginTop: 6, border: "1px solid rgba(148, 163, 184, 0.12)", borderRadius: 10, padding: "6px 8px" }}>
                  <div className="row">
                    <span>{item.path} · {item.source}</span>
                    <span>{item.count}{item.sharePct === null ? "" : ` · ${item.sharePct.toFixed(2)}%`}</span>
                  </div>
                  <div className="subtle mini" style={{ marginTop: 4 }}>
                    reason: {item.reason}
                  </div>
                  <div className="subtle mini" style={{ marginTop: 4 }}>
                    decision_id recents: {item.recentDecisionIds.length > 0 ? item.recentDecisionIds.map((decisionId, index) => (
                      <span key={`${item.path}-${item.source}-${item.reason}-${decisionId}`}>
                        {index > 0 ? " · " : ""}
                        <Link href={`/advanced/reality-gap?decisionId=${encodeURIComponent(decisionId)}`}>{decisionId}</Link>
                      </span>
                    )) : "n/a"}
                  </div>
                </div>
              )) : (
                <div className="subtle mini">Aucune decision quote_observed_but_ignored sur la fenetre active.</div>
              )}
            </div>
          </div>
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {planCards.map((card) => (
              <div key={card.title} style={{ border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 12, padding: 12, background: "rgba(15, 23, 42, 0.2)" }}>
                <div className="row" style={{ marginBottom: 6 }}>
                  <span>{card.title}</span>
                  <span className={card.tone}>{card.headline}</span>
                </div>
                <div className="subtle mini">{card.detail}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(8, 21, 35, 0.38)" }}>
            <div className="row"><span>Calibration gate</span><span className={tradeCount >= 50 ? "good" : "subtle"}>{tradeCount.toFixed(0)} / 50 trades</span></div>
            <div className="subtle mini" style={{ marginTop: 6 }}>La calibration semi-auto reste verrouillee tant que tu n'as pas assez de micro-live stable.</div>
            <div style={{ marginTop: 10, height: 8, borderRadius: 999, background: "rgba(148, 163, 184, 0.14)", overflow: "hidden" }}>
              <div style={{ width: `${calibrationProgressPct}%`, height: "100%", background: calibrationProgressPct >= 100 ? "linear-gradient(90deg, rgba(34,197,94,0.9), rgba(16,185,129,0.9))" : "linear-gradient(90deg, rgba(56,189,248,0.9), rgba(14,165,233,0.9))" }} />
            </div>
          </div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr", marginBottom: 16 }}>
        <div className="panel">
          <OperatorPanelGuide
            title="Sprint Journalier Intelligent"
            what="Plan roulant sur 7 jours: les dates se conservent pendant le sprint puis se recalculent si le cycle est termine."
            why="Centraliser lecture et actions de discipline dans un seul bloc operateur."
            example="La case Realise reste manuelle pour que tu valides toi-meme l'execution de la tache."
            actions={(
              <>
                <button type="button" onClick={resetDailyPlanSprint}>Recaler le sprint a aujourd'hui</button>
                <button type="button" onClick={openSprintBrief}>Brief sprint</button>
              </>
            )}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <span>Période du sprint</span>
            <span>{formatPlanDate(dailyPlanDays[0].date)} → {formatPlanDate(dailyPlanDays[dailyPlanDays.length - 1].date)}</span>
          </div>
          <div className="subtle mini" style={{ marginTop: 6 }}>Les dates se rebasent automatiquement quand le sprint complet est depasse. Tu peux aussi le recaler manuellement.</div>
          <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
            {dailyPlanDays.map((day) => (
              <div key={day.dateKey} style={{ border: `1px solid ${day.isToday ? "rgba(56, 189, 248, 0.45)" : "rgba(148, 163, 184, 0.18)"}`, borderRadius: 14, padding: 14, background: day.isToday ? "rgba(8, 47, 73, 0.28)" : "rgba(15, 23, 42, 0.2)" }}>
                <div className="row" style={{ marginBottom: 6 }}>
                  <span>{day.title}</span>
                  <span className={day.dayPassed ? "warn" : day.isToday ? "good" : "subtle"}>{formatPlanDate(day.date)}{day.isToday ? " · aujourd'hui" : day.dayPassed ? " · passe" : " · a venir"}</span>
                </div>
                <div className="subtle mini">Focus: {day.focus}</div>
                <div className="subtle mini" style={{ marginTop: 4 }}>Objectif: {day.objective}</div>
                <div className="subtle mini" style={{ marginTop: 4, marginBottom: 10 }}>Contexte: {day.context}</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {day.tasks.map((task) => (
                    <div key={task.taskKey} style={{ border: "1px solid rgba(148, 163, 184, 0.14)", borderRadius: 12, padding: 10, background: "rgba(2, 6, 23, 0.18)" }}>
                      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div>{task.title}</div>
                          <div className="subtle mini" style={{ marginTop: 4 }}>{task.detail}</div>
                        </div>
                        <div style={{ display: "grid", gap: 6, minWidth: 180 }}>
                          <label className="subtle mini" style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                            <span>Jour passé</span>
                            <input type="checkbox" checked={day.dayPassed} readOnly disabled />
                          </label>
                          <label className="subtle mini" style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                            <span>Réalisé</span>
                            <input type="checkbox" checked={task.done} onChange={() => toggleDailyPlanTask(task.taskKey, task.title, day.title)} />
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
