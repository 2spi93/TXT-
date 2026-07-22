import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";

import * as runtimeRoute from "../../app/api/system/runtime-decision/route";
import * as exportRoute from "../../app/api/system/runtime-decision/export/route";
import * as snapshotRoute from "../../app/api/system/runtime-decision/snapshot/route";
import {
  buildExecutionDecisionAudit,
  buildExecutionDecisionAuditFromLockState,
  type ExecutionDecisionCode,
  validateExecutionDecisionAudit,
} from "../../lib/executionDecisionSchema";

const BUSINESS_SCOPE = {
  symbol: "BTCUSD",
  timeframe: "1m",
  strategy: "scalp",
  limit: 200,
  sinceDays: 7,
  samples: 4,
} as const;

const BUSINESS_RESPONSE_SCOPE = {
  symbol: BUSINESS_SCOPE.symbol,
  timeframe: BUSINESS_SCOPE.timeframe,
  strategy: BUSINESS_SCOPE.strategy,
  limit: BUSINESS_SCOPE.limit,
  sinceDays: BUSINESS_SCOPE.sinceDays,
} as const;

type JournalFixtureInput = {
  id: string;
  createdAtIso: string;
  symbol?: string;
  timeframe?: string;
  strategy?: string;
  action: string;
  code: ExecutionDecisionCode;
  detail: string;
  decisionOutcome?: "correct" | "false_positive" | "unknown";
  shouldBlockTrading?: boolean;
  attentionState?: string;
  volatilityRegime?: string;
  tripleValidationState?: string;
  executionQualityScore?: number;
  manipulationRisk?: number;
  busSeq?: number;
  depthAgeMs?: number;
};

function buildJournalFixtureEntry(input: JournalFixtureInput) {
  return {
    id: input.id,
    createdAtIso: input.createdAtIso,
    symbol: input.symbol || BUSINESS_SCOPE.symbol,
    timeframe: input.timeframe || BUSINESS_SCOPE.timeframe,
    strategy: input.strategy || BUSINESS_SCOPE.strategy,
    action: input.action,
    detail: input.detail,
    decisionOutcome: input.decisionOutcome,
    meta: {
      decision_audit: buildExecutionDecisionAudit({
        code: input.code,
        summary: input.detail,
      }),
      attention_context: {
        state: input.attentionState || "stable",
        shouldBlockTrading: Boolean(input.shouldBlockTrading),
        context: {
          volatilityRegime: input.volatilityRegime || "medium",
          triple_validation_state: input.tripleValidationState || "confirmed",
          executionQualityScore: input.executionQualityScore ?? (input.action.includes("blocked") || input.action.includes("disabled") ? 0.42 : 0.88),
          manipulationRisk: input.manipulationRisk ?? 0.12,
        },
      },
      sync_diagnostics: {
        bus_seq: input.busSeq ?? 21,
        depth_age_ms: input.depthAgeMs ?? 120,
      },
    },
  };
}

test("execution decision audit preserves oracle fingerprint when provided", () => {
  const audit = buildExecutionDecisionAudit({
    code: "execution-v7-blocked",
    summary: "oracle blocked execution",
    oracleFingerprint: "fdt-1234abcd",
  });

  expect(audit.oracleFingerprint).toBe("fdt-1234abcd");
  expect(validateExecutionDecisionAudit(audit)?.oracleFingerprint).toBe("fdt-1234abcd");
});

test("execution lock audit preserves oracle fingerprint when provided", () => {
  const audit = buildExecutionDecisionAuditFromLockState({
    active: true,
    code: "routing-blocked",
    summaryLabel: "ROUTING BLOCKED",
    oracleFingerprint: "fdt-lockabcd",
  });

  expect(audit?.oracleFingerprint).toBe("fdt-lockabcd");
  expect(audit && validateExecutionDecisionAudit(audit)?.oracleFingerprint).toBe("fdt-lockabcd");
});

function buildMarketVenueTelemetryPayload() {
  return {
    venues: [
      {
        venue: "binance-public",
        avg_spread_bps: 1.1,
        avg_available_depth_usd: 220_000,
        avg_depth_latency_ms: 42,
        avg_fill_probability: 0.92,
        avg_stability_score: 0.88,
        instruments: [
          {
            instrument: BUSINESS_SCOPE.symbol,
            spread_bps: 1.1,
            available_depth_usd: 220_000,
            fill_probability: 0.92,
            stability_score: 0.88,
          },
        ],
      },
      {
        venue: "okx-public",
        avg_spread_bps: 1.3,
        avg_available_depth_usd: 180_000,
        avg_depth_latency_ms: 55,
        avg_fill_probability: 0.85,
        avg_stability_score: 0.8,
        instruments: [
          {
            instrument: BUSINESS_SCOPE.symbol,
            spread_bps: 1.3,
            available_depth_usd: 180_000,
            fill_probability: 0.85,
            stability_score: 0.8,
          },
        ],
      },
    ],
  };
}

function buildRouteVenueTelemetryPayload() {
  return {
    venues: [
      {
        venue: "binance-public",
        avg_latency_ms: 205,
        execution: {
          avg_fill_latency_ms: 245,
          avg_slippage_bps: 1.2,
        },
        profile: {
          max_spread_bps: 6,
          max_latency_ms: 140,
        },
      },
      {
        venue: "okx-public",
        avg_latency_ms: 215,
        execution: {
          avg_fill_latency_ms: 255,
          avg_slippage_bps: 1.5,
        },
        profile: {
          max_spread_bps: 6,
          max_latency_ms: 140,
        },
      },
    ],
  };
}

function buildRouteVenueTelemetryRuntimeShapePayload() {
  return {
    status: "ok",
    lookback_minutes: 240,
    venues: [
      {
        venue: "binance-public",
        market: {
          venue: "binance-public",
          avg_spread_bps: 1.1,
        },
        execution: null,
        stability: {
          state: "stable",
        },
        profile: {
          matching_rule: "price-time",
          queue_priority_bias: 0.88,
          hidden_liquidity_ratio: 0.1,
          latency_base_ms: 16,
          latency_jitter_ms: 4,
          partial_fill_bias: 0.1,
        },
      },
      {
        venue: "okx-public",
        market: {
          venue: "okx-public",
          avg_spread_bps: 1.3,
        },
        execution: null,
        stability: {
          state: "stable",
        },
        profile: {
          matching_rule: "price-time",
          queue_priority_bias: 0.84,
          hidden_liquidity_ratio: 0.14,
          latency_base_ms: 18,
          latency_jitter_ms: 6,
          partial_fill_bias: 0.14,
        },
      },
    ],
    updated_at: "2026-04-16T12:34:56.000Z",
  };
}

function buildResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function buildFixtureEntries(nowMs: number) {
  const isoHoursAgo = (hoursAgo: number) => new Date(nowMs - hoursAgo * 60 * 60 * 1000).toISOString();

  return [
    buildJournalFixtureEntry({
      id: "scope-01",
      createdAtIso: isoHoursAgo(22),
      action: "execution-disabled-routing",
      code: "routing-score-zero",
      detail: "routing score 0 under thin book",
      volatilityRegime: "high",
    }),
    buildJournalFixtureEntry({
      id: "scope-02",
      createdAtIso: isoHoursAgo(20),
      action: "execution-disabled-fallback",
      code: "fallback-mode",
      detail: "fallback route engaged under latency stress",
      volatilityRegime: "high",
    }),
    buildJournalFixtureEntry({
      id: "scope-03",
      createdAtIso: isoHoursAgo(18),
      action: "execution-v7-blocked",
      code: "execution-v7-blocked",
      detail: "policy blocked while market was still tradable",
      decisionOutcome: "false_positive",
    }),
    buildJournalFixtureEntry({
      id: "scope-04",
      createdAtIso: isoHoursAgo(16),
      action: "execution-v7-outcome-positive",
      code: "execution-v7-outcome-positive",
      detail: "clean execution with strong follow-through",
      decisionOutcome: "correct",
    }),
    buildJournalFixtureEntry({
      id: "scope-05",
      createdAtIso: isoHoursAgo(14),
      action: "execution-disabled-routing",
      code: "routing-score-zero",
      detail: "routing score 0 while spread was still clean",
    }),
    buildJournalFixtureEntry({
      id: "scope-06",
      createdAtIso: isoHoursAgo(12),
      action: "execution-v7-outcome-neutral",
      code: "execution-v7-outcome-neutral",
      detail: "flat follow-through after entry",
    }),
    buildJournalFixtureEntry({
      id: "scope-07",
      createdAtIso: isoHoursAgo(10),
      action: "execution-disabled-fallback",
      code: "fallback-mode",
      detail: "fallback route stayed on for too long",
    }),
    buildJournalFixtureEntry({
      id: "scope-08",
      createdAtIso: isoHoursAgo(8),
      action: "execution-v7-blocked",
      code: "execution-v7-blocked",
      detail: "policy blocked again in stable flow",
    }),
    buildJournalFixtureEntry({
      id: "scope-09",
      createdAtIso: isoHoursAgo(6),
      action: "execution-v7-outcome-positive",
      code: "execution-v7-outcome-positive",
      detail: "second clean execution on the same session",
      decisionOutcome: "correct",
    }),
    buildJournalFixtureEntry({
      id: "scope-10",
      createdAtIso: isoHoursAgo(4),
      action: "execution-disabled-routing",
      code: "routing-score-zero",
      detail: "routing score 0 despite stable context",
    }),
    buildJournalFixtureEntry({
      id: "scope-11",
      createdAtIso: isoHoursAgo(0.9),
      action: "execution-disabled-fallback",
      code: "fallback-mode",
      detail: "fallback route engaged in the last hour",
      decisionOutcome: "correct",
    }),
    buildJournalFixtureEntry({
      id: "scope-12",
      createdAtIso: isoHoursAgo(0.6),
      action: "execution-disabled-fallback",
      code: "fallback-mode",
      detail: "fallback route engaged in the last hour",
    }),
    buildJournalFixtureEntry({
      id: "scope-13",
      createdAtIso: isoHoursAgo(0.3),
      action: "execution-disabled-fallback",
      code: "fallback-mode",
      detail: "fallback route engaged in the last hour",
    }),
    buildJournalFixtureEntry({
      id: "scope-14",
      createdAtIso: isoHoursAgo(0.1),
      action: "execution-v7-outcome-positive",
      code: "execution-v7-outcome-positive",
      detail: "latest clean execution keeps the context tradable",
      decisionOutcome: "correct",
    }),
    buildJournalFixtureEntry({
      id: "noise-01",
      createdAtIso: isoHoursAgo(0.2),
      symbol: "ETHUSD",
      timeframe: "5m",
      strategy: "swing",
      action: "execution-disabled-fallback",
      code: "fallback-mode",
      detail: "other scope noise",
    }),
    buildJournalFixtureEntry({
      id: "noise-02",
      createdAtIso: isoHoursAgo(0.15),
      symbol: "ETHUSD",
      timeframe: "5m",
      strategy: "swing",
      action: "execution-v7-outcome-positive",
      code: "execution-v7-outcome-positive",
      detail: "other scope noise",
      decisionOutcome: "correct",
    }),
  ];
}

function buildUnavailableTelemetryFixtureEntries(nowMs: number) {
  const isoHoursAgo = (hoursAgo: number) => new Date(nowMs - hoursAgo * 60 * 60 * 1000).toISOString();

  return [
    buildJournalFixtureEntry({
      id: "unknown-01",
      createdAtIso: isoHoursAgo(8),
      action: "execution-v7-outcome-positive",
      code: "execution-v7-outcome-positive",
      detail: "clean execution while venue telemetry is unavailable",
      decisionOutcome: "correct",
      volatilityRegime: "normal",
    }),
    buildJournalFixtureEntry({
      id: "unknown-02",
      createdAtIso: isoHoursAgo(4),
      action: "execution-v7-outcome-neutral",
      code: "execution-v7-outcome-neutral",
      detail: "flat follow-through with no exploitable live telemetry",
      decisionOutcome: "unknown",
      volatilityRegime: "normal",
    }),
    buildJournalFixtureEntry({
      id: "unknown-03",
      createdAtIso: isoHoursAgo(1),
      action: "execution-v7-outcome-positive",
      code: "execution-v7-outcome-positive",
      detail: "second clean execution keeps the structural context readable",
      decisionOutcome: "correct",
      volatilityRegime: "normal",
    }),
    buildJournalFixtureEntry({
      id: "unknown-noise-01",
      createdAtIso: isoHoursAgo(0.5),
      symbol: "ETHUSD",
      timeframe: "5m",
      strategy: "swing",
      action: "execution-disabled-fallback",
      code: "fallback-mode",
      detail: "other scope noise",
    }),
  ];
}

async function readKpiFile(targetFile: string): Promise<string> {
  return readFile(targetFile, "utf-8").catch(() => "");
}

test("runtime-decision routes keep GET read-only and POST appends the scoped KPI proof", async () => {
  test.setTimeout(120_000);

  const tempDir = await mkdtemp(path.join(tmpdir(), "runtime-decision-route-"));
  const journalFile = path.join(tempDir, "runtime-journal.jsonl");
  const kpiFile = path.join(tempDir, "runtime-kpi.jsonl");
  const envKeys = [
    "CONTROL_PLANE_TOKEN",
    "RUNTIME_DECISION_WRITER_ENABLED",
    "V2_RISK_JOURNAL_DIR",
    "V2_RISK_JOURNAL_FILE",
    "RUNTIME_DECISION_KPI_DIR",
    "RUNTIME_DECISION_KPI_FILE",
  ] as const;
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as Record<(typeof envKeys)[number], string | undefined>;
  const originalFetch = global.fetch;

  process.env.CONTROL_PLANE_TOKEN = "smoke";
  process.env.RUNTIME_DECISION_WRITER_ENABLED = "0";
  process.env.V2_RISK_JOURNAL_DIR = tempDir;
  process.env.V2_RISK_JOURNAL_FILE = path.basename(journalFile);
  process.env.RUNTIME_DECISION_KPI_DIR = tempDir;
  process.env.RUNTIME_DECISION_KPI_FILE = path.basename(kpiFile);

  global.fetch = (async (input) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (url.includes("/v1/market/venues/telemetry")) {
      return buildResponse(buildMarketVenueTelemetryPayload());
    }
    if (url.includes("/v1/routes/venues/telemetry")) {
      return buildResponse(buildRouteVenueTelemetryPayload());
    }

    return buildResponse({ detail: "unmocked_fetch", url }, 404);
  }) as typeof fetch;

  (globalThis as { __runtimeDecisionWriterController__?: { stop?: () => void }; __runtimeDecisionWriterStarted__?: boolean }).__runtimeDecisionWriterController__?.stop?.();
  (globalThis as { __runtimeDecisionWriterStarted__?: boolean }).__runtimeDecisionWriterStarted__ = false;

  try {
    const fixtureEntries = buildFixtureEntries(Date.now());
    await writeFile(journalFile, `${fixtureEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf-8");
    await writeFile(kpiFile, "", "utf-8");

    const runtimeUrl = `http://127.0.0.1/api/system/runtime-decision?symbol=${BUSINESS_SCOPE.symbol}&timeframe=${BUSINESS_SCOPE.timeframe}&strategy=${BUSINESS_SCOPE.strategy}&limit=${BUSINESS_SCOPE.limit}&sinceDays=${BUSINESS_SCOPE.sinceDays}&samples=${BUSINESS_SCOPE.samples}`;
    const exportUrl = `http://127.0.0.1/api/system/runtime-decision/export?symbol=${BUSINESS_SCOPE.symbol}&timeframe=${BUSINESS_SCOPE.timeframe}&strategy=${BUSINESS_SCOPE.strategy}&limit=${BUSINESS_SCOPE.limit}&sinceDays=${BUSINESS_SCOPE.sinceDays}&historyLimit=5`;
    const beforeGetKpi = await readKpiFile(kpiFile);

    const snapshotGetResponse = await snapshotRoute.GET();
    expect(snapshotGetResponse.status).toBe(200);
    const snapshotGetPayload = await snapshotGetResponse.json() as { scheduler?: { state?: string; enabled?: boolean } };
    expect(snapshotGetPayload.scheduler?.state).toBe("stopped");
    expect(snapshotGetPayload.scheduler?.enabled).toBe(false);

    const runtimeResponse = await runtimeRoute.GET(new NextRequest(runtimeUrl));
    expect(runtimeResponse.status).toBe(200);
    const runtimePayload = await runtimeResponse.json() as {
      scope: typeof BUSINESS_SCOPE;
      totals: { noTradeRows: number; executionRows: number };
      drift: { type: string; headline: string; state: string; cause: { summary: string } };
      opportunity: {
        liveState: string;
        liveSummary: string;
        breakdown: Array<{ key: string; scorePct: number }>;
      };
      observation: { status: string };
    };

    expect(runtimePayload.scope).toMatchObject(BUSINESS_RESPONSE_SCOPE);
    expect(runtimePayload.totals.noTradeRows).toBeGreaterThanOrEqual(10);
    expect(runtimePayload.totals.executionRows).toBeGreaterThan(runtimePayload.totals.noTradeRows);
    expect(["EXECUTION_LATENCY", "MIXED"]).toContain(runtimePayload.drift.type);
    expect(["WATCH", "DRIFT", "CRITICAL"]).toContain(runtimePayload.drift.state);
    expect(runtimePayload.drift.cause.summary.toLowerCase()).toContain("route");
    expect(runtimePayload.opportunity.liveState).toBe("LIVE");
    expect(runtimePayload.opportunity.liveSummary.toLowerCase()).toContain("route");
    expect(runtimePayload.observation.status).toBe("INSUFFICIENT");
    const latencyBreakdown = runtimePayload.opportunity.breakdown.find((item) => item.key === "latency");
    const spreadBreakdown = runtimePayload.opportunity.breakdown.find((item) => item.key === "spread");
    expect(latencyBreakdown?.scorePct ?? 100).toBeLessThan(35);
    expect(spreadBreakdown?.scorePct ?? 0).toBeGreaterThan(75);

    const exportBeforeResponse = await exportRoute.GET(new NextRequest(exportUrl));
    expect(exportBeforeResponse.status).toBe(200);
    const exportBeforePayload = await exportBeforeResponse.json() as {
      scope: typeof BUSINESS_SCOPE;
      latestSnapshot: unknown;
      reviewRows: unknown[];
      decisionJournal: Array<{ decisionOutcome: string | null }>;
    };
    expect(exportBeforePayload.scope).toMatchObject(BUSINESS_RESPONSE_SCOPE);
    expect(exportBeforePayload.latestSnapshot).toBeNull();
    expect(exportBeforePayload.reviewRows).toEqual([]);
    expect(exportBeforePayload.decisionJournal.length).toBeGreaterThanOrEqual(1);

    const afterGetKpi = await readKpiFile(kpiFile);
    expect(afterGetKpi).toBe(beforeGetKpi);

    const snapshotPostResponse = await snapshotRoute.POST(new NextRequest("http://127.0.0.1/api/system/runtime-decision/snapshot", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(BUSINESS_SCOPE),
    }));
    expect(snapshotPostResponse.status).toBe(200);
    const snapshotPostPayload = await snapshotPostResponse.json() as {
      result?: {
        persisted?: boolean;
        skipped?: boolean;
        error?: string | null;
        observationStatus?: string;
      };
    };
    expect(snapshotPostPayload.result).toMatchObject({
      persisted: true,
      skipped: false,
      error: null,
      observationStatus: "INSUFFICIENT",
    });

    const afterPostKpi = await readKpiFile(kpiFile);
    const persistedLines = afterPostKpi
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(persistedLines).toHaveLength(1);
    const persistedSnapshot = JSON.parse(persistedLines[0]) as {
      scope: typeof BUSINESS_SCOPE;
      decisionOutcome: string | null;
      opportunityScore: number;
      driftProbability: number;
    };
    expect(persistedSnapshot.scope).toMatchObject({
      symbol: BUSINESS_RESPONSE_SCOPE.symbol,
      timeframe: BUSINESS_RESPONSE_SCOPE.timeframe,
      strategy: BUSINESS_RESPONSE_SCOPE.strategy,
      limit: BUSINESS_RESPONSE_SCOPE.limit,
      sinceDays: BUSINESS_RESPONSE_SCOPE.sinceDays,
    });
    expect(persistedSnapshot.decisionOutcome).toBe("correct");
    expect(persistedSnapshot.opportunityScore).toBeGreaterThan(0);
    expect(persistedSnapshot.driftProbability).toBeGreaterThan(0);

    const exportAfterResponse = await exportRoute.GET(new NextRequest(exportUrl));
    expect(exportAfterResponse.status).toBe(200);
    const exportAfterPayload = await exportAfterResponse.json() as {
      latestSnapshot: {
        scope: typeof BUSINESS_SCOPE;
        decisionOutcome: string | null;
      } | null;
      reviewRows: Array<{
        decisionOutcome: string | null;
      }>;
      observation: { status: string };
      deskRead: { summary: string };
    };
    expect(exportAfterPayload.latestSnapshot?.scope).toMatchObject(BUSINESS_RESPONSE_SCOPE);
    expect(exportAfterPayload.latestSnapshot?.decisionOutcome).toBe("correct");
    expect(exportAfterPayload.reviewRows).toHaveLength(1);
    expect(exportAfterPayload.reviewRows[0]?.decisionOutcome).toBe("correct");
    expect(exportAfterPayload.observation.status).toBe("INSUFFICIENT");
    expect(exportAfterPayload.deskRead.summary.length).toBeGreaterThan(0);
  } finally {
    global.fetch = originalFetch;
    (globalThis as { __runtimeDecisionWriterController__?: { stop?: () => void }; __runtimeDecisionWriterStarted__?: boolean }).__runtimeDecisionWriterController__?.stop?.();
    (globalThis as { __runtimeDecisionWriterStarted__?: boolean }).__runtimeDecisionWriterStarted__ = false;
    for (const key of envKeys) {
      if (previousEnv[key] == null) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runtime-decision keeps NO_DATA_AUTH fallback explicit when live venue telemetry auth fails", async () => {
  test.setTimeout(120_000);

  const tempDir = await mkdtemp(path.join(tmpdir(), "runtime-decision-route-"));
  const journalFile = path.join(tempDir, "runtime-journal.jsonl");
  const kpiFile = path.join(tempDir, "runtime-kpi.jsonl");
  const envKeys = [
    "CONTROL_PLANE_TOKEN",
    "RUNTIME_DECISION_WRITER_ENABLED",
    "V2_RISK_JOURNAL_DIR",
    "V2_RISK_JOURNAL_FILE",
    "RUNTIME_DECISION_KPI_DIR",
    "RUNTIME_DECISION_KPI_FILE",
  ] as const;
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as Record<(typeof envKeys)[number], string | undefined>;
  const originalFetch = global.fetch;

  process.env.CONTROL_PLANE_TOKEN = "smoke";
  process.env.RUNTIME_DECISION_WRITER_ENABLED = "0";
  process.env.V2_RISK_JOURNAL_DIR = tempDir;
  process.env.V2_RISK_JOURNAL_FILE = path.basename(journalFile);
  process.env.RUNTIME_DECISION_KPI_DIR = tempDir;
  process.env.RUNTIME_DECISION_KPI_FILE = path.basename(kpiFile);

  global.fetch = (async (input) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (url.includes("/v1/market/venues/telemetry")) {
      return buildResponse({ detail: "market_telemetry_unauthorized" }, 401);
    }
    if (url.includes("/v1/routes/venues/telemetry")) {
      return buildResponse({ detail: "route_telemetry_unauthorized" }, 401);
    }

    return buildResponse({ detail: "unmocked_fetch", url }, 404);
  }) as typeof fetch;

  (globalThis as { __runtimeDecisionWriterController__?: { stop?: () => void }; __runtimeDecisionWriterStarted__?: boolean }).__runtimeDecisionWriterController__?.stop?.();
  (globalThis as { __runtimeDecisionWriterStarted__?: boolean }).__runtimeDecisionWriterStarted__ = false;

  try {
    const fixtureEntries = buildUnavailableTelemetryFixtureEntries(Date.now());
    await writeFile(journalFile, `${fixtureEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf-8");
    await writeFile(kpiFile, "", "utf-8");

    const runtimeUrl = `http://127.0.0.1/api/system/runtime-decision?symbol=${BUSINESS_SCOPE.symbol}&timeframe=${BUSINESS_SCOPE.timeframe}&strategy=${BUSINESS_SCOPE.strategy}&limit=${BUSINESS_SCOPE.limit}&sinceDays=${BUSINESS_SCOPE.sinceDays}&samples=${BUSINESS_SCOPE.samples}`;
    const exportUrl = `http://127.0.0.1/api/system/runtime-decision/export?symbol=${BUSINESS_SCOPE.symbol}&timeframe=${BUSINESS_SCOPE.timeframe}&strategy=${BUSINESS_SCOPE.strategy}&limit=${BUSINESS_SCOPE.limit}&sinceDays=${BUSINESS_SCOPE.sinceDays}&historyLimit=5`;

    const runtimeResponse = await runtimeRoute.GET(new NextRequest(runtimeUrl));
    expect(runtimeResponse.status).toBe(200);
    const runtimePayload = await runtimeResponse.json() as {
      opportunity: {
        avgScore: number;
        liveState: string;
        liveSummary: string;
        summary: string;
        telemetry: {
          availability: string;
          source: string;
          summary: string;
          venueCount: number;
          marketVenueCount: number;
          routeVenueCount: number;
          authState?: string;
          rootCause?: string;
          missingFields?: string[];
        };
      };
      deskRead: {
        headline: string;
        summary: string;
        nextAction: string;
      };
    };

    expect(runtimePayload.opportunity.liveState).toBe("NO_DATA_AUTH");
    expect(runtimePayload.opportunity.liveSummary).toContain("NO_DATA_AUTH");
    expect(runtimePayload.opportunity.telemetry.availability).toBe("unavailable");
    expect(runtimePayload.opportunity.telemetry.source).toBe("context-only");
    expect(runtimePayload.opportunity.telemetry.summary.toLowerCase()).toContain("auth failure");
    expect(runtimePayload.opportunity.telemetry.venueCount).toBe(0);
    expect(runtimePayload.opportunity.telemetry.marketVenueCount).toBe(0);
    expect(runtimePayload.opportunity.telemetry.routeVenueCount).toBe(0);
    expect(runtimePayload.opportunity.telemetry.authState).toBe("INVALID");
    expect(runtimePayload.opportunity.telemetry.rootCause).toBe("AUTH_FAILURE");
    expect(runtimePayload.opportunity.telemetry.missingFields).toContain("venues");
    expect(runtimePayload.opportunity.summary.startsWith("NO_DATA_AUTH")).toBe(true);
    expect(runtimePayload.deskRead.headline).toBe("Control-plane telemetry auth failed");
    expect(runtimePayload.deskRead.summary).toContain("NO_DATA_AUTH");
    expect(runtimePayload.deskRead.nextAction.toLowerCase()).toContain("sid");

    const exportResponse = await exportRoute.GET(new NextRequest(exportUrl));
    expect(exportResponse.status).toBe(200);
    const exportPayload = await exportResponse.json() as {
      deskRead: {
        headline: string;
        summary: string;
      };
      latestSnapshot: unknown;
      reviewRows: unknown[];
    };

    expect(exportPayload.latestSnapshot).toBeNull();
    expect(exportPayload.reviewRows).toEqual([]);
    expect(exportPayload.deskRead.headline).toBe("Control-plane telemetry auth failed");
    expect(exportPayload.deskRead.summary).toContain("NO_DATA_AUTH");
  } finally {
    global.fetch = originalFetch;
    (globalThis as { __runtimeDecisionWriterController__?: { stop?: () => void }; __runtimeDecisionWriterStarted__?: boolean }).__runtimeDecisionWriterController__?.stop?.();
    (globalThis as { __runtimeDecisionWriterStarted__?: boolean }).__runtimeDecisionWriterStarted__ = false;
    for (const key of envKeys) {
      if (previousEnv[key] == null) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runtime-decision keeps NO_DATA_PARTIAL explicit when route telemetry only exposes venue profiles without execution stats", async () => {
  test.setTimeout(120_000);

  const tempDir = await mkdtemp(path.join(tmpdir(), "runtime-decision-route-"));
  const journalFile = path.join(tempDir, "runtime-journal.jsonl");
  const kpiFile = path.join(tempDir, "runtime-kpi.jsonl");
  const envKeys = [
    "CONTROL_PLANE_TOKEN",
    "RUNTIME_DECISION_WRITER_ENABLED",
    "V2_RISK_JOURNAL_DIR",
    "V2_RISK_JOURNAL_FILE",
    "RUNTIME_DECISION_KPI_DIR",
    "RUNTIME_DECISION_KPI_FILE",
  ] as const;
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as Record<(typeof envKeys)[number], string | undefined>;
  const originalFetch = global.fetch;

  process.env.CONTROL_PLANE_TOKEN = "smoke";
  process.env.RUNTIME_DECISION_WRITER_ENABLED = "0";
  process.env.V2_RISK_JOURNAL_DIR = tempDir;
  process.env.V2_RISK_JOURNAL_FILE = path.basename(journalFile);
  process.env.RUNTIME_DECISION_KPI_DIR = tempDir;
  process.env.RUNTIME_DECISION_KPI_FILE = path.basename(kpiFile);

  global.fetch = (async (input) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (url.includes("/v1/market/venues/telemetry")) {
      return buildResponse(buildMarketVenueTelemetryPayload());
    }
    if (url.includes("/v1/routes/venues/telemetry")) {
      return buildResponse(buildRouteVenueTelemetryRuntimeShapePayload());
    }

    return buildResponse({ detail: "unmocked_fetch", url }, 404);
  }) as typeof fetch;

  (globalThis as { __runtimeDecisionWriterController__?: { stop?: () => void }; __runtimeDecisionWriterStarted__?: boolean }).__runtimeDecisionWriterController__?.stop?.();
  (globalThis as { __runtimeDecisionWriterStarted__?: boolean }).__runtimeDecisionWriterStarted__ = false;

  try {
    const fixtureEntries = buildFixtureEntries(Date.now());
    await writeFile(journalFile, `${fixtureEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf-8");
    await writeFile(kpiFile, "", "utf-8");

    const runtimeUrl = `http://127.0.0.1/api/system/runtime-decision?symbol=${BUSINESS_SCOPE.symbol}&timeframe=${BUSINESS_SCOPE.timeframe}&strategy=${BUSINESS_SCOPE.strategy}&limit=${BUSINESS_SCOPE.limit}&sinceDays=${BUSINESS_SCOPE.sinceDays}&samples=${BUSINESS_SCOPE.samples}`;
    const runtimeResponse = await runtimeRoute.GET(new NextRequest(runtimeUrl));
    expect(runtimeResponse.status).toBe(200);
    const runtimePayload = await runtimeResponse.json() as {
      reliability: {
        state: string;
        blocked: boolean;
        summary: string;
      };
      opportunity: {
        liveState: string;
        liveSummary: string;
        summary: string;
        missingSignals: string[];
        guard: {
          state: string;
          blocked: boolean;
          trustScorePct: number;
          summary: string;
        };
        telemetry: {
          availability: string;
          source: string;
          summary: string;
          venueCount: number;
          marketVenueCount: number;
          routeVenueCount: number;
          rootCause?: string;
          missingFields?: string[];
          integrity?: {
            state?: string;
            summary?: string;
            routeCoveragePct?: number;
            executionVenueCount?: number;
            items?: Array<{ code?: string; label?: string }>;
          };
          avgRouteLatencyMs?: number | null;
          avgFillLatencyMs?: number | null;
          avgSlippageBps?: number | null;
          spreadBudgetBps?: number | null;
          latencyBudgetMs?: number | null;
        };
      };
      deskRead: {
        headline: string;
        summary: string;
        nextAction: string;
      };
    };

    expect(runtimePayload.opportunity.liveState).toBe("NO_DATA_PARTIAL");
    expect(runtimePayload.opportunity.liveSummary).toContain("NO_DATA_PARTIAL");
    expect(runtimePayload.opportunity.summary.startsWith("NO_DATA_PARTIAL")).toBe(true);
    expect(runtimePayload.reliability.state).toBe("BLOCKED_BY_DATA");
    expect(runtimePayload.reliability.blocked).toBe(true);
    expect(runtimePayload.opportunity.guard.state).toBe("BLOCKED_BY_DATA");
    expect(runtimePayload.opportunity.guard.blocked).toBe(true);
    expect(runtimePayload.opportunity.guard.summary).toContain("BLOCKED_BY_DATA");
    expect(runtimePayload.opportunity.missingSignals).toContain("latency");
    expect(runtimePayload.opportunity.telemetry.availability).toBe("partial");
    expect(runtimePayload.opportunity.telemetry.source).toBe("venue-telemetry");
    expect(runtimePayload.opportunity.telemetry.rootCause).toBe("PARTIAL_PAYLOAD");
    expect(runtimePayload.opportunity.telemetry.venueCount).toBe(2);
    expect(runtimePayload.opportunity.telemetry.marketVenueCount).toBe(2);
    expect(runtimePayload.opportunity.telemetry.routeVenueCount).toBe(2);
    expect(runtimePayload.opportunity.telemetry.avgRouteLatencyMs).toBeNull();
    expect(runtimePayload.opportunity.telemetry.avgFillLatencyMs).toBeNull();
    expect(runtimePayload.opportunity.telemetry.avgSlippageBps).toBeNull();
    expect(runtimePayload.opportunity.telemetry.spreadBudgetBps).toBeNull();
    expect(runtimePayload.opportunity.telemetry.latencyBudgetMs).toBeNull();
    expect(runtimePayload.opportunity.telemetry.missingFields).toContain("execution");
    expect(runtimePayload.opportunity.telemetry.missingFields).toContain("latency");
    expect(runtimePayload.opportunity.telemetry.missingFields).toContain("slippage");
    expect(runtimePayload.opportunity.telemetry.missingFields).toContain("budget_profile");
    expect(runtimePayload.opportunity.telemetry.integrity?.state).toBe("PARTIAL");
    expect(runtimePayload.opportunity.telemetry.integrity?.routeCoveragePct).toBe(0);
    expect(runtimePayload.opportunity.telemetry.integrity?.executionVenueCount).toBe(0);
    expect(runtimePayload.opportunity.telemetry.integrity?.items?.map((item) => item.code || item.label)).toContain("NO_EXECUTION_STATS");
    expect(runtimePayload.opportunity.telemetry.integrity?.items?.map((item) => item.code || item.label)).toContain("NO_EXECUTION_LATENCY");
    expect(runtimePayload.opportunity.telemetry.integrity?.items?.map((item) => item.code || item.label)).toContain("NO_EXECUTION_SLIPPAGE");
    expect(runtimePayload.opportunity.telemetry.integrity?.items?.map((item) => item.code || item.label)).toContain("RAW_EXECUTION_PROFILE");
    expect(runtimePayload.opportunity.telemetry.integrity?.items?.map((item) => item.code || item.label)).toContain("NO_EXECUTION_BUDGET");
    expect(runtimePayload.opportunity.telemetry.summary).toContain("stats execution route absentes");
    expect(runtimePayload.opportunity.telemetry.summary).toContain("latency_base_ms");
    expect(runtimePayload.deskRead.headline).toBe("Interpretation blocked by data");
    expect(runtimePayload.deskRead.summary).toContain("BLOCKED_BY_DATA");
    expect(runtimePayload.deskRead.nextAction).toContain("WHY BLOCKED");
  } finally {
    global.fetch = originalFetch;
    (globalThis as { __runtimeDecisionWriterController__?: { stop?: () => void }; __runtimeDecisionWriterStarted__?: boolean }).__runtimeDecisionWriterController__?.stop?.();
    (globalThis as { __runtimeDecisionWriterStarted__?: boolean }).__runtimeDecisionWriterStarted__ = false;
    for (const key of envKeys) {
      if (previousEnv[key] == null) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});