"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import OperatorPanelGuide from "../../../components/ui/OperatorPanelGuide";
import {
  buildIntentCalibrationSummary,
  type CalibrationJournalEntry,
  type IntentCalibrationIntentStats,
  type IntentCalibrationWindowSummary,
} from "../../../lib/intentCalibrationEngine";

type JsonMap = Record<string, unknown>;

type CalibrationSourceSummary = {
  calibrated: boolean;
  confidence: number;
  sample_count: number;
  real_count: number;
  synthetic_count: number;
  effective_sample_weight: number;
  average_reward: number;
  multipliers: Record<string, number>;
};

type CalibrationWindowSnapshot = {
  label: string;
  generated_at: string;
  start_at: string | null;
  end_at: string;
  experience_rows: number;
  real_rows: number;
  synthetic_rows: number;
  failure_rows: number;
  real_failure_rows: number;
  oldest_experience_at: string | null;
  newest_experience_at: string | null;
  sources: Record<string, CalibrationSourceSummary>;
};

type CalibrationHistoryEntry = {
  generated_at: string;
  row_count: number;
  windows: Record<string, CalibrationWindowSnapshot>;
};

type CalibrationPayload = {
  status?: string;
  service?: string;
  generated_at: string;
  source_path: string;
  history_path: string;
  row_count: number;
  history_limit: number;
  window_order: string[];
  windows: Record<string, CalibrationWindowSnapshot>;
  history: CalibrationHistoryEntry[];
};

type JournalCalibrationPayload = {
  entries: CalibrationJournalEntry[];
};

type OutcomeCalibrationBucket = {
  score_bucket: number;
  sample_count: number;
  avg_net_result_usd: number;
  win_rate: number;
};

type EdgeEligibilityStateBucket = {
  state: string;
  sample_count: number;
  avg_net_result_usd: number;
  win_rate: number;
  avg_edge_score_pct: number;
  avg_score_pre_trade_pct: number;
};

type EdgeEligibilityScoreBucket = {
  state: string;
  score_bucket_pct: number;
  sample_count: number;
  avg_net_result_usd: number;
  win_rate: number;
  avg_score_pre_trade_pct: number;
};

type OutcomesCalibrationPayload = {
  status?: string;
  buckets: OutcomeCalibrationBucket[];
  edge_state_buckets: EdgeEligibilityStateBucket[];
  edge_score_buckets: EdgeEligibilityScoreBucket[];
};

const WINDOW_LABELS: Record<string, string> = {
  "24h": "24h",
  "7d": "7 jours",
  "30d": "30 jours",
  all: "All replay",
};

const SOURCE_LABELS: Record<string, string> = {
  infra: "Infra",
  market: "Market",
  execution: "Execution",
};

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
}

function formatSourceLabel(value: string): string {
  return SOURCE_LABELS[value] || value;
}

function formatWindowLabel(value: string): string {
  return WINDOW_LABELS[value] || value;
}

function formatEdgeStateLabel(value: string): string {
  switch (value.trim().toUpperCase()) {
    case "ELIGIBLE":
      return "Eligible";
    case "OBSERVE":
      return "Observe";
    case "BLOCKED":
      return "Blocked";
    default:
      return value || "Unknown";
  }
}

function formatScoreBucketRange(scoreBucketPct: number): string {
  const lower = Math.max(0, Math.round(scoreBucketPct));
  const upper = Math.min(100, lower + 9);
  return `${lower}-${upper}%`;
}

function formatSigned(value: number, digits = 2, suffix = ""): string {
  const normalized = Number.isFinite(value) ? value : 0;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(digits)}${suffix}`;
}

function formatTierLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function buildSparklinePath(values: number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const maxValue = Math.max(0.01, ...values);
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  return values.map((value, index) => {
    const x = Number((index * stepX).toFixed(2));
    const y = Number((height - (value / maxValue) * height).toFixed(2));
    return `${index === 0 ? "M" : "L"}${x},${y}`;
  }).join(" ");
}

function normalizeSourceSummary(raw: unknown): CalibrationSourceSummary {
  const source = raw && typeof raw === "object" ? raw as JsonMap : {};
  const multipliersRaw = source.multipliers && typeof source.multipliers === "object"
    ? source.multipliers as Record<string, unknown>
    : {};
  return {
    calibrated: Boolean(source.calibrated),
    confidence: toNumber(source.confidence, 0),
    sample_count: Math.max(0, Math.round(toNumber(source.sample_count, 0))),
    real_count: Math.max(0, Math.round(toNumber(source.real_count, 0))),
    synthetic_count: Math.max(0, Math.round(toNumber(source.synthetic_count, 0))),
    effective_sample_weight: toNumber(source.effective_sample_weight, 0),
    average_reward: toNumber(source.average_reward, 0),
    multipliers: Object.fromEntries(
      Object.entries(multipliersRaw).map(([agent, value]) => [agent, toNumber(value, 1)]),
    ),
  };
}

function normalizeWindowSnapshot(label: string, raw: unknown): CalibrationWindowSnapshot {
  const window = raw && typeof raw === "object" ? raw as JsonMap : {};
  const sourcesRaw = window.sources && typeof window.sources === "object"
    ? window.sources as Record<string, unknown>
    : {};
  return {
    label,
    generated_at: String(window.generated_at || ""),
    start_at: typeof window.start_at === "string" ? window.start_at : null,
    end_at: String(window.end_at || ""),
    experience_rows: Math.max(0, Math.round(toNumber(window.experience_rows, 0))),
    real_rows: Math.max(0, Math.round(toNumber(window.real_rows, 0))),
    synthetic_rows: Math.max(0, Math.round(toNumber(window.synthetic_rows, 0))),
    failure_rows: Math.max(0, Math.round(toNumber(window.failure_rows, 0))),
    real_failure_rows: Math.max(0, Math.round(toNumber(window.real_failure_rows, 0))),
    oldest_experience_at: typeof window.oldest_experience_at === "string" ? window.oldest_experience_at : null,
    newest_experience_at: typeof window.newest_experience_at === "string" ? window.newest_experience_at : null,
    sources: Object.fromEntries(
      Object.entries(sourcesRaw).map(([source, summary]) => [source, normalizeSourceSummary(summary)]),
    ),
  };
}

function normalizePayload(raw: unknown): CalibrationPayload {
  const payload = raw && typeof raw === "object" ? raw as JsonMap : {};
  const windowsRaw = payload.windows && typeof payload.windows === "object"
    ? payload.windows as Record<string, unknown>
    : {};
  const historyRaw = Array.isArray(payload.history) ? payload.history : [];
  const windowOrder = Array.isArray(payload.window_order)
    ? payload.window_order.map((value) => String(value)).filter(Boolean)
    : Object.keys(windowsRaw);
  return {
    status: typeof payload.status === "string" ? payload.status : undefined,
    service: typeof payload.service === "string" ? payload.service : undefined,
    generated_at: String(payload.generated_at || ""),
    source_path: String(payload.source_path || ""),
    history_path: String(payload.history_path || ""),
    row_count: Math.max(0, Math.round(toNumber(payload.row_count, 0))),
    history_limit: Math.max(0, Math.round(toNumber(payload.history_limit, 0))),
    window_order: windowOrder,
    windows: Object.fromEntries(windowOrder.map((label) => [label, normalizeWindowSnapshot(label, windowsRaw[label])])),
    history: historyRaw
      .filter((entry): entry is JsonMap => Boolean(entry) && typeof entry === "object")
      .map((entry) => {
        const entryWindows = entry.windows && typeof entry.windows === "object"
          ? entry.windows as Record<string, unknown>
          : {};
        return {
          generated_at: String(entry.generated_at || ""),
          row_count: Math.max(0, Math.round(toNumber(entry.row_count, 0))),
          windows: Object.fromEntries(windowOrder.map((label) => [label, normalizeWindowSnapshot(label, entryWindows[label])])),
        };
      }),
  };
}

function normalizeOutcomesCalibrationPayload(raw: unknown): OutcomesCalibrationPayload {
  const payload = raw && typeof raw === "object" ? raw as JsonMap : {};
  const toOutcomeBucket = (candidate: unknown): OutcomeCalibrationBucket => {
    const row = candidate && typeof candidate === "object" ? candidate as JsonMap : {};
    return {
      score_bucket: toNumber(row.score_bucket, 0),
      sample_count: Math.max(0, Math.round(toNumber(row.sample_count, 0))),
      avg_net_result_usd: toNumber(row.avg_net_result_usd, 0),
      win_rate: toNumber(row.win_rate, 0),
    };
  };
  const toEdgeStateBucket = (candidate: unknown): EdgeEligibilityStateBucket => {
    const row = candidate && typeof candidate === "object" ? candidate as JsonMap : {};
    return {
      state: String(row.state || "UNKNOWN").trim().toUpperCase() || "UNKNOWN",
      sample_count: Math.max(0, Math.round(toNumber(row.sample_count, 0))),
      avg_net_result_usd: toNumber(row.avg_net_result_usd, 0),
      win_rate: toNumber(row.win_rate, 0),
      avg_edge_score_pct: toNumber(row.avg_edge_score_pct, 0),
      avg_score_pre_trade_pct: toNumber(row.avg_score_pre_trade_pct, 0),
    };
  };
  const toEdgeScoreBucket = (candidate: unknown): EdgeEligibilityScoreBucket => {
    const row = candidate && typeof candidate === "object" ? candidate as JsonMap : {};
    return {
      state: String(row.state || "UNKNOWN").trim().toUpperCase() || "UNKNOWN",
      score_bucket_pct: toNumber(row.score_bucket_pct, 0),
      sample_count: Math.max(0, Math.round(toNumber(row.sample_count, 0))),
      avg_net_result_usd: toNumber(row.avg_net_result_usd, 0),
      win_rate: toNumber(row.win_rate, 0),
      avg_score_pre_trade_pct: toNumber(row.avg_score_pre_trade_pct, 0),
    };
  };
  return {
    status: typeof payload.status === "string" ? payload.status : undefined,
    buckets: Array.isArray(payload.buckets) ? payload.buckets.map(toOutcomeBucket) : [],
    edge_state_buckets: Array.isArray(payload.edge_state_buckets) ? payload.edge_state_buckets.map(toEdgeStateBucket) : [],
    edge_score_buckets: Array.isArray(payload.edge_score_buckets) ? payload.edge_score_buckets.map(toEdgeScoreBucket) : [],
  };
}

export default function PredictorCalibrationClient() {
  const [payload, setPayload] = useState<CalibrationPayload | null>(null);
  const [outcomesCalibration, setOutcomesCalibration] = useState<OutcomesCalibrationPayload | null>(null);
  const [journalEntries, setJournalEntries] = useState<CalibrationJournalEntry[]>([]);
  const [selectedSource, setSelectedSource] = useState("infra");
  const [error, setError] = useState<string | null>(null);
  const [outcomesError, setOutcomesError] = useState<string | null>(null);
  const [journalError, setJournalError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [outcomesLoading, setOutcomesLoading] = useState(true);
  const [journalLoading, setJournalLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [outcomesRefreshing, setOutcomesRefreshing] = useState(false);
  const [journalRefreshing, setJournalRefreshing] = useState(false);

  async function loadPayload(refresh = false): Promise<void> {
    try {
      if (refresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const response = await fetch(`/api/predictor/brain/calibration/history${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Impossible de charger la calibration predictor (${response.status})`);
      }
      const body = normalizePayload(await response.json());
      setPayload(body);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Impossible de charger la calibration predictor");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadJournal(refresh = false): Promise<void> {
    try {
      if (refresh) {
        setJournalRefreshing(true);
      } else {
        setJournalLoading(true);
      }
      setJournalError(null);
      const query = new URLSearchParams();
      query.set("limit", "1200");
      query.set("sinceDays", "14");
      const response = await fetch(`/api/terminal/v2-risk-journal?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Impossible de charger le journal de calibration (${response.status})`);
      }
      const body = await response.json().catch(() => ({ entries: [] })) as JournalCalibrationPayload;
      setJournalEntries(Array.isArray(body.entries) ? body.entries : []);
    } catch (fetchError) {
      setJournalError(fetchError instanceof Error ? fetchError.message : "Impossible de charger le journal de calibration");
    } finally {
      setJournalLoading(false);
      setJournalRefreshing(false);
    }
  }

  async function loadOutcomesCalibration(refresh = false): Promise<void> {
    try {
      if (refresh) {
        setOutcomesRefreshing(true);
      } else {
        setOutcomesLoading(true);
      }
      setOutcomesError(null);
      const response = await fetch("/api/outcomes/calibration", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Impossible de charger la calibration edge (${response.status})`);
      }
      const body = normalizeOutcomesCalibrationPayload(await response.json());
      setOutcomesCalibration(body);
    } catch (fetchError) {
      setOutcomesError(fetchError instanceof Error ? fetchError.message : "Impossible de charger la calibration edge");
    } finally {
      setOutcomesLoading(false);
      setOutcomesRefreshing(false);
    }
  }

  useEffect(() => {
    void loadPayload();
    void loadJournal();
    void loadOutcomesCalibration();
  }, []);

  const selectedSourceHistory = useMemo(() => {
    if (!payload) return [] as Array<{ label: string; points: number[] }>;
    return payload.window_order.map((windowLabel) => ({
      label: windowLabel,
      points: payload.history.map((entry) => toNumber(entry.windows[windowLabel]?.sources[selectedSource]?.confidence, 0)),
    }));
  }, [payload, selectedSource]);

  const latestRuns = useMemo(() => {
    if (!payload) return [] as CalibrationHistoryEntry[];
    return [...payload.history].reverse().slice(0, 12);
  }, [payload]);

  const windowComparison = useMemo(() => {
    if (!payload) return [] as Array<{
      label: string;
      snapshot: CalibrationWindowSnapshot;
      source: CalibrationSourceSummary;
      deltaConfidenceVsAll: number;
      deltaSamplesVsAll: number;
      deltaConfidenceVsPrevRun: number;
      deltaSamplesVsPrevRun: number;
    }>;
    const allSource = payload.windows.all?.sources[selectedSource] || normalizeSourceSummary(null);
    const previousEntry = payload.history.length > 1 ? payload.history[payload.history.length - 2] : null;
    return payload.window_order.map((windowLabel) => ({
      label: windowLabel,
      snapshot: payload.windows[windowLabel],
      source: payload.windows[windowLabel]?.sources[selectedSource] || normalizeSourceSummary(null),
      deltaConfidenceVsAll: toNumber(payload.windows[windowLabel]?.sources[selectedSource]?.confidence, 0) - allSource.confidence,
      deltaSamplesVsAll: toNumber(payload.windows[windowLabel]?.sources[selectedSource]?.sample_count, 0) - allSource.sample_count,
      deltaConfidenceVsPrevRun: previousEntry
        ? toNumber(payload.windows[windowLabel]?.sources[selectedSource]?.confidence, 0) - toNumber(previousEntry.windows[windowLabel]?.sources[selectedSource]?.confidence, 0)
        : 0,
      deltaSamplesVsPrevRun: previousEntry
        ? toNumber(payload.windows[windowLabel]?.sources[selectedSource]?.sample_count, 0) - toNumber(previousEntry.windows[windowLabel]?.sources[selectedSource]?.sample_count, 0)
        : 0,
    }));
  }, [payload, selectedSource]);

  const journalCalibration = useMemo(() => buildIntentCalibrationSummary(journalEntries, { windowDaysList: [7, 14] }), [journalEntries]);
  const journalWindows = useMemo(() => (["7d", "14d"]
    .map((label) => journalCalibration.windows[label])
    .filter((window): window is IntentCalibrationWindowSummary => Boolean(window))), [journalCalibration.windows]);
  const journalTopIntentRows = useMemo(() => journalWindows.flatMap((window) =>
    window.intents.map((intent) => ({ windowLabel: window.label, intent }))), [journalWindows]);
  const edgeBucketsByState = useMemo(() => {
    const grouped = new Map<string, EdgeEligibilityScoreBucket[]>();
    for (const bucket of outcomesCalibration?.edge_score_buckets || []) {
      const existing = grouped.get(bucket.state) || [];
      existing.push(bucket);
      grouped.set(bucket.state, existing);
    }
    return [...grouped.entries()].map(([state, buckets]) => ({
      state,
      buckets: [...buckets].sort((left, right) => right.score_bucket_pct - left.score_bucket_pct),
    }));
  }, [outcomesCalibration]);

  return (
    <main className="shell txt-page-shell">
      <section className="panel txt-page-hero">
        <div className="eyebrow">Predictor Admin</div>
        <h1 className="title" style={{ fontSize: 34 }}>Failure LR Calibration</h1>
        <p className="subtle">Vue admin des fenetres de calibration offline, comparaison par source et historique des snapshots periodiques.</p>
        <OperatorPanelGuide
          title="Guide Calibration"
          what="Compare les fenetres 24h/7j/30j/all replay et la confiance empirique par source d'echec."
          why="Verifier que les multiplicateurs sortent progressivement du prior-blended a mesure que le replay reel s'enrichit."
          example="Si Infra monte sur 30j mais reste faible sur 24h, le signal est stable mais peu recent."
          terms={["confidence", "effective sample weight", "rolling window"]}
        />
        <p>
          <Link href="/advanced">Advanced</Link>
          {" | "}
          <Link href="/terminal">Trading Terminal</Link>
        </p>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1.1fr 1.9fr", gap: 16, alignItems: "start" }}>
        <article className="panel">
          <div className="eyebrow">Snapshot</div>
          {loading ? <p className="subtle">Chargement...</p> : null}
          {error ? <p className="warn">{error}</p> : null}
          {!loading && payload ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div className="row"><span>Generated</span><span>{formatDateTime(payload.generated_at)}</span></div>
              <div className="row"><span>Replay rows</span><span>{payload.row_count}</span></div>
              <div className="row"><span>History depth</span><span>{payload.history.length}/{payload.history_limit}</span></div>
              <div className="row"><span>Replay path</span><span style={{ textAlign: "right", wordBreak: "break-all" }}>{payload.source_path || "-"}</span></div>
              <div className="row"><span>History file</span><span style={{ textAlign: "right", wordBreak: "break-all" }}>{payload.history_path || "-"}</span></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {Object.keys(SOURCE_LABELS).map((source) => {
                  const active = selectedSource === source;
                  return (
                    <button
                      key={source}
                      type="button"
                      onClick={() => setSelectedSource(source)}
                      style={{
                        borderRadius: 999,
                        border: active ? "1px solid rgba(207, 233, 185, 0.55)" : "1px solid rgba(148, 163, 184, 0.22)",
                        background: active ? "rgba(34, 197, 94, 0.14)" : "rgba(15, 23, 42, 0.32)",
                        color: active ? "#d7f7cf" : "#d7dbe0",
                        padding: "6px 10px",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      {formatSourceLabel(source)}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => void loadPayload(true)} disabled={refreshing}>
                  {refreshing ? "Rebuilding..." : "Rebuild now"}
                </button>
                <button type="button" onClick={() => void loadPayload(false)} disabled={loading || refreshing}>Refresh view</button>
                <button type="button" onClick={() => void loadJournal(true)} disabled={journalRefreshing}>
                  {journalRefreshing ? "Journal..." : "Refresh journal 14j"}
                </button>
              </div>
            </div>
          ) : null}
        </article>

        <article className="panel">
          <div className="eyebrow">Window Compare</div>
          <div className="subtle" style={{ marginBottom: 10 }}>Comparaison live de {formatSourceLabel(selectedSource)} sur toutes les fenetres.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 12 }}>
            {windowComparison.map(({ label, snapshot, source, deltaConfidenceVsAll, deltaSamplesVsAll, deltaConfidenceVsPrevRun, deltaSamplesVsPrevRun }) => {
              const multiplierEntries = Object.entries(source.multipliers).sort((left, right) => left[1] - right[1]);
              return (
                <div key={label} style={{ border: "1px solid rgba(148,163,184,0.18)", borderRadius: 12, padding: 12, background: "rgba(15,23,42,0.22)", display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong>{formatWindowLabel(label)}</strong>
                    <span style={{ color: source.confidence >= 0.5 ? "#cfe9b9" : source.confidence > 0 ? "#efc28f" : "#9fb0c3" }}>
                      {(source.confidence * 100).toFixed(0)}% conf
                    </span>
                  </div>
                  <div className="row"><span>Rows</span><span>{snapshot.experience_rows} total · {snapshot.real_rows} real</span></div>
                  <div className="row"><span>Failures</span><span>{snapshot.failure_rows} total · {snapshot.real_failure_rows} real</span></div>
                  <div className="row"><span>Samples</span><span>{source.sample_count} · synth {source.synthetic_count}</span></div>
                  <div className="row"><span>Weight</span><span>{source.effective_sample_weight.toFixed(2)}</span></div>
                  <div className="row"><span>Avg reward</span><span>{source.average_reward >= 0 ? "+" : ""}{source.average_reward.toFixed(2)}</span></div>
                  <div className="row"><span>Delta vs all</span><span>{formatSigned(deltaConfidenceVsAll * 100, 0, " pts")} · n {formatSigned(deltaSamplesVsAll, 0)}</span></div>
                  <div className="row"><span>Delta vs prev run</span><span>{formatSigned(deltaConfidenceVsPrevRun * 100, 0, " pts")} · n {formatSigned(deltaSamplesVsPrevRun, 0)}</span></div>
                  <div className="subtle mini">Window {snapshot.start_at ? `${formatDateTime(snapshot.start_at)} -> ${formatDateTime(snapshot.end_at)}` : `all replay -> ${formatDateTime(snapshot.end_at)}`}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {multiplierEntries.map(([agent, value]) => (
                      <span key={`${label}-${agent}`} className={`chart-action-pill chart-action-pill-status ${value >= 1.02 ? "good" : value <= 0.75 ? "warn" : "neutral"}`}>
                        {agent} x{value.toFixed(2)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1.15fr 1.85fr", gap: 16, marginTop: 16, alignItems: "start" }}>
        <article className="panel">
          <div className="eyebrow">History</div>
          <div className="subtle" style={{ marginBottom: 10 }}>Evolution de la confidence {formatSourceLabel(selectedSource)} par fenetre de recalcul.</div>
          <div style={{ display: "grid", gap: 10 }}>
            {selectedSourceHistory.map((series) => {
              const path = buildSparklinePath(series.points, 180, 28);
              const latest = series.points[series.points.length - 1] || 0;
              return (
                <div key={series.label} style={{ display: "grid", gap: 4 }}>
                  <div className="row"><span>{formatWindowLabel(series.label)}</span><span>{(latest * 100).toFixed(0)}%</span></div>
                  <svg viewBox="0 0 180 28" preserveAspectRatio="none" style={{ width: "100%", height: 28, borderRadius: 8, background: "rgba(15,23,42,0.18)" }}>
                    <path d={path} fill="none" stroke="#cfe9b9" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel">
          <div className="eyebrow">Recent Runs</div>
          <div className="subtle" style={{ marginBottom: 10 }}>Derniers snapshots offline avec comparaison rapide des fenetres sur {formatSourceLabel(selectedSource)}.</div>
          <div style={{ display: "grid", gap: 8 }}>
            {latestRuns.map((entry, index) => (
              <div key={`${entry.generated_at}-${index}`} style={{ borderTop: index === 0 ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(255,255,255,0.05)", paddingTop: 8, display: "grid", gap: 6 }}>
                <div className="row"><strong>{formatDateTime(entry.generated_at)}</strong><span>{entry.row_count} rows</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
                  {payload?.window_order.map((windowLabel) => {
                    const source = entry.windows[windowLabel]?.sources[selectedSource] || normalizeSourceSummary(null);
                    const previousRun = latestRuns[index + 1] || null;
                    const previousSource = previousRun?.windows[windowLabel]?.sources[selectedSource] || null;
                    const deltaVsPrevious = previousSource ? source.confidence - previousSource.confidence : 0;
                    return (
                      <div key={`${entry.generated_at}-${windowLabel}`} style={{ borderRadius: 10, padding: "8px 10px", background: "rgba(15,23,42,0.18)" }}>
                        <div className="row"><span>{formatWindowLabel(windowLabel)}</span><span>{(source.confidence * 100).toFixed(0)}%</span></div>
                        <div className="subtle mini">n {source.sample_count} · w {source.effective_sample_weight.toFixed(2)}</div>
                        <div className="subtle mini">delta prev {previousRun ? formatSigned(deltaVsPrevious * 100, 0, " pts") : "-"}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16, alignItems: "start" }}>
        <article className="panel">
          <div className="eyebrow">Edge Eligibility</div>
          <h2 style={{ margin: "4px 0 10px", fontSize: 22 }}>State Calibration</h2>
          <p className="subtle" style={{ marginBottom: 10 }}>Buckets persistés depuis decision_outcomes, groupés par edge_eligibility_state et score_pct.</p>
          {outcomesLoading ? <p className="subtle">Chargement de la calibration edge...</p> : null}
          {outcomesError ? <p className="warn">{outcomesError}</p> : null}
          {!outcomesLoading ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => void loadOutcomesCalibration(true)} disabled={outcomesRefreshing}>
                  {outcomesRefreshing ? "Refreshing..." : "Refresh edge buckets"}
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                {(outcomesCalibration?.edge_state_buckets || []).map((bucket) => (
                  <div key={bucket.state} style={{ border: "1px solid rgba(148,163,184,0.18)", borderRadius: 12, padding: 12, background: "rgba(15,23,42,0.22)", display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <strong>{formatEdgeStateLabel(bucket.state)}</strong>
                      <span style={{ color: bucket.state === "ELIGIBLE" ? "#cfe9b9" : bucket.state === "BLOCKED" ? "#fca5a5" : "#efc28f" }}>
                        {(bucket.avg_edge_score_pct).toFixed(0)}% edge
                      </span>
                    </div>
                    <div className="row"><span>Samples</span><span>{bucket.sample_count}</span></div>
                    <div className="row"><span>Win rate</span><span>{(bucket.win_rate * 100).toFixed(0)}%</span></div>
                    <div className="row"><span>Avg pnl</span><span>{formatSigned(bucket.avg_net_result_usd, 2, " USD")}</span></div>
                    <div className="row"><span>Avg pre-trade</span><span>{bucket.avg_score_pre_trade_pct.toFixed(0)}%</span></div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </article>

        <article className="panel">
          <div className="eyebrow">Score Buckets</div>
          <div className="subtle" style={{ marginBottom: 10 }}>Lecture explicite des buckets edge par état, avec win rate et pnl moyen par tranche de score.</div>
          {edgeBucketsByState.length === 0 && !outcomesLoading ? <p className="subtle">Aucun bucket edge persistant disponible.</p> : null}
          <div style={{ display: "grid", gap: 10 }}>
            {edgeBucketsByState.map(({ state, buckets }) => (
              <div key={state} style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 8, display: "grid", gap: 6 }}>
                <div className="row"><strong>{formatEdgeStateLabel(state)}</strong><span>{buckets.reduce((sum, bucket) => sum + bucket.sample_count, 0)} samples</span></div>
                <div style={{ display: "grid", gap: 6 }}>
                  {buckets.map((bucket) => (
                    <div key={`${state}-${bucket.score_bucket_pct}`} style={{ borderRadius: 10, padding: "8px 10px", background: "rgba(15,23,42,0.18)" }}>
                      <div className="row"><span>{formatScoreBucketRange(bucket.score_bucket_pct)}</span><span>n {bucket.sample_count}</span></div>
                      <div className="subtle mini">win {(bucket.win_rate * 100).toFixed(0)}% · pnl {formatSigned(bucket.avg_net_result_usd, 2, " USD")} · pre-trade {bucket.avg_score_pre_trade_pct.toFixed(0)}%</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16, alignItems: "start" }}>
        <article className="panel">
          <div className="eyebrow">Journal Calibration</div>
          <h2 style={{ margin: "4px 0 10px", fontSize: 22 }}>Windows 7j / 14j</h2>
          <p className="subtle" style={{ marginBottom: 10 }}>Agrégation réelle des entrées market-intent, trap, capital scaling et execution V7 outcome.</p>
          <OperatorPanelGuide
            title="Guide Journal"
            what="Lit le journal V2 des 14 derniers jours et recompose une vue 7j/14j par intent et par outcome."
            why="Vérifier si l’intention détectée produit réellement des issues alpha ou si elle dérive vers des outcomes risk."
            example="Un journal PRESS à 14j mais CAUTIOUS à 7j signale une edge encore rentable, mais en décélération récente."
            terms={["alpha share", "capital tier", "threshold floor"]}
          />
          {journalLoading ? <p className="subtle">Chargement du journal...</p> : null}
          {journalError ? <p className="warn">{journalError}</p> : null}
          {!journalLoading ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div className="row"><span>Journal rows</span><span>{journalCalibration.totalEntries}</span></div>
              <div className="row"><span>Generated</span><span>{formatDateTime(journalCalibration.generatedAt)}</span></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
                {journalWindows.map((window) => (
                  <div key={window.label} style={{ border: "1px solid rgba(148,163,184,0.18)", borderRadius: 12, padding: 12, background: "rgba(15,23,42,0.22)", display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <strong>{window.label}</strong>
                      <span style={{ color: window.liveScaling.multiplier >= 1 ? "#cfe9b9" : window.liveScaling.tier === "LOCKED" ? "#fca5a5" : "#efc28f" }}>
                        {formatTierLabel(window.liveScaling.tier)} x{window.liveScaling.multiplier.toFixed(2)}
                      </span>
                    </div>
                    <div className="row"><span>Intent / trap</span><span>{window.intentEntryCount} / {window.trapEntryCount}</span></div>
                    <div className="row"><span>Outcomes</span><span>{window.outcomeEntryCount} · alpha {window.alphaOutcomeCount} · risk {window.riskOutcomeCount}</span></div>
                    <div className="row"><span>Capital rows</span><span>{window.capitalEntryCount}</span></div>
                    <div className="row"><span>Avg capital</span><span>x{window.avgCapitalMultiplier.toFixed(2)}</span></div>
                    <div className="row"><span>Avg exec score</span><span>{(window.avgExecutionScore * 100).toFixed(0)}%</span></div>
                    <div className="row"><span>Thresholds</span><span>c {(window.thresholds.confidenceFloor * 100).toFixed(0)}% · p {(window.thresholds.persistenceFloor * 100).toFixed(0)}%</span></div>
                    <div className="subtle mini">{window.liveScaling.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </article>

        <article className="panel">
          <div className="eyebrow">Intent Breakdown</div>
          <div className="subtle" style={{ marginBottom: 10 }}>Seuils recalibrés et paliers live dérivés des outcomes réels execution-v7-outcome-alpha/risk.</div>
          <div style={{ display: "grid", gap: 8 }}>
            {journalTopIntentRows.length === 0 && !journalLoading ? <p className="subtle">Aucun intent exploitable trouvé sur 14 jours.</p> : null}
            {journalTopIntentRows.map(({ windowLabel, intent }) => (
              <JournalIntentCard key={`${windowLabel}-${intent.intent}`} windowLabel={windowLabel} intent={intent} />
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}

function JournalIntentCard({ intent, windowLabel }: { intent: IntentCalibrationIntentStats; windowLabel: string }) {
  return (
    <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 8, display: "grid", gap: 6 }}>
      <div className="row"><strong>{windowLabel} · {intent.intent.replace(/_/g, " ")}</strong><span>{(intent.alphaShare * 100).toFixed(0)}% alpha share</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
        <div style={{ borderRadius: 10, padding: "8px 10px", background: "rgba(15,23,42,0.18)" }}>
          <div className="row"><span>Detections</span><span>{intent.detections}</span></div>
          <div className="subtle mini">Outcomes {intent.outcomeCount} · alpha {intent.alphaCount} · risk {intent.riskCount}</div>
        </div>
        <div style={{ borderRadius: 10, padding: "8px 10px", background: "rgba(15,23,42,0.18)" }}>
          <div className="row"><span>Thresholds</span><span>c {(intent.thresholds.confidenceFloor * 100).toFixed(0)}% · p {(intent.thresholds.persistenceFloor * 100).toFixed(0)}%</span></div>
          <div className="subtle mini">agg {(intent.thresholds.aggressivenessFloor * 100).toFixed(0)}% · sample {intent.thresholds.sampleCount}</div>
        </div>
        <div style={{ borderRadius: 10, padding: "8px 10px", background: "rgba(15,23,42,0.18)" }}>
          <div className="row"><span>Quality</span><span>{(intent.avgExecutionScore * 100).toFixed(0)}% exec · x{intent.avgCapitalMultiplier.toFixed(2)}</span></div>
          <div className="subtle mini">conf {(intent.avgConfidence * 100).toFixed(0)}% · pers {(intent.avgPersistence * 100).toFixed(0)}%</div>
        </div>
        <div style={{ borderRadius: 10, padding: "8px 10px", background: "rgba(15,23,42,0.18)" }}>
          <div className="row"><span>Live tier</span><span>{formatTierLabel(intent.scaling.tier)} x{intent.scaling.multiplier.toFixed(2)}</span></div>
          <div className="subtle mini">{intent.scaling.reason}</div>
        </div>
      </div>
    </div>
  );
}