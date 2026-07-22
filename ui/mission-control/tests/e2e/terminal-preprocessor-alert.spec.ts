import { expect, test, type Page } from "@playwright/test";

import { loginIfRequired } from "./helpers/terminal";

type RuntimeCollectors = {
  consoleErrors: string[];
  pageErrors: string[];
};

function attachRuntimeCollectors(page: Page): RuntimeCollectors {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(String(error?.stack || error));
  });

  return { consoleErrors, pageErrors };
}

async function installRuntimeErrorHooks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const runtimeWindow = window as Window & {
      __MC_TEST_ERROR_COUNT__?: number;
      __MC_TEST_ERROR_HOOKS_INSTALLED__?: boolean;
    };
    if (!runtimeWindow.__MC_TEST_ERROR_HOOKS_INSTALLED__) {
      runtimeWindow.__MC_TEST_ERROR_COUNT__ = 0;
      runtimeWindow.__MC_TEST_ERROR_HOOKS_INSTALLED__ = true;
      window.addEventListener("error", () => {
        runtimeWindow.__MC_TEST_ERROR_COUNT__ = (runtimeWindow.__MC_TEST_ERROR_COUNT__ || 0) + 1;
      });
      window.addEventListener("unhandledrejection", () => {
        runtimeWindow.__MC_TEST_ERROR_COUNT__ = (runtimeWindow.__MC_TEST_ERROR_COUNT__ || 0) + 1;
      });
    }
  });
}

async function assertNoRuntimeCrash(page: Page, collectors: RuntimeCollectors, checkpoint: string): Promise<void> {
  const nextRuntimeError = await page.evaluate(() => {
    const win = window as Window & { __NEXT_DATA__?: { err?: unknown }; __MC_TEST_ERROR_COUNT__?: number };
    return {
      nextError: win.__NEXT_DATA__?.err ?? null,
      errorCount: win.__MC_TEST_ERROR_COUNT__ || 0,
    };
  });
  const appErrorHeading = page.getByRole("heading", { name: /Application error:/i });
  const isAppErrorVisible = await appErrorHeading.isVisible().catch(() => false);

  if (isAppErrorVisible || nextRuntimeError.nextError !== null || nextRuntimeError.errorCount > 0 || collectors.consoleErrors.length > 0 || collectors.pageErrors.length > 0) {
    const details = {
      checkpoint,
      nextRuntimeError: nextRuntimeError.nextError,
      errorCount: nextRuntimeError.errorCount,
      consoleErrors: collectors.consoleErrors,
      pageErrors: collectors.pageErrors,
      appErrorVisible: isAppErrorVisible,
    };
    throw new Error(`Terminal runtime crash detected: ${JSON.stringify(details)}`);
  }
}

function buildOhlcvRows(instrument: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  const now = Date.now();
  const basePrice = 68450;
  for (let index = 0; index < 48; index += 1) {
    const ts = new Date(now - (47 - index) * 60_000).toISOString();
    const drift = index * 4;
    rows.push({
      t: ts,
      o: basePrice + drift,
      h: basePrice + drift + 8,
      l: basePrice + drift - 8,
      c: basePrice + drift + 3,
      v: 12 + index,
      tf: "1m",
      seq: index + 1,
      instrument,
      venue: "binance-public",
      source: "market-bus-live",
    });
  }
  return rows;
}

function buildQuotesPayload(instrument: string): Array<Record<string, unknown>> {
  const now = new Date().toISOString();
  return [
    { symbol: instrument, instrument, venue: "binance-public", bid: 68640.1, ask: 68640.8, last: 68640.4, updated_at: now },
    { symbol: instrument, instrument, venue: "okx-public", bid: 68640.0, ask: 68640.9, last: 68640.5, updated_at: now },
  ];
}

function buildSnapshotPayload(instrument: string): Record<string, unknown> {
  const now = Date.now();
  return {
    instrument,
    venue: "binance-public",
    timeframe: "1m",
    trades: [
      { price: 68640.2, size: 0.14, side: "buy", traded_at: new Date(now - 1800).toISOString(), venue: "binance-public", instrument },
      { price: 68640.4, size: 0.21, side: "buy", traded_at: new Date(now - 1200).toISOString(), venue: "okx-public", instrument },
      { price: 68640.1, size: 0.19, side: "sell", traded_at: new Date(now - 600).toISOString(), venue: "coinbase-public", instrument },
    ],
    microstructure: {
      instrument,
      venue: "binance-public",
      spread_bps: 0.7,
      depth_imbalance: 0.12,
      source: "market-bus-live",
      snapshot_at: new Date().toISOString(),
    },
    session_state: {
      instrument,
      session: "new-york",
      is_open: true,
      source: "market-bus-live",
      snapshot_at: new Date().toISOString(),
    },
    orderbook: {
      venue: "binance-public",
      source: "market-bus-live",
      best_bid: 68640.1,
      best_ask: 68640.8,
    },
    routingScore: {
      source: "v6-price-fusion",
      reason: "best_route_candidate",
      infra_health: 0.98,
      network_regime: "stable",
      best: {
        venue: "binance-public",
        score: 82,
        spread_bps: 0.7,
        available_depth_usd: 120000,
        freshness_ms: 250,
        fill_probability: 0.93,
        stability_score: 0.91,
        stability_state: "stable",
      },
      backup: {
        venue: "okx-public",
        score: 64,
        spread_bps: 1.1,
        available_depth_usd: 84000,
        freshness_ms: 420,
        fill_probability: 0.78,
        stability_score: 0.72,
        stability_state: "watch",
      },
      candidates: [],
    },
    routing_score: {
      source: "v6-price-fusion",
      reason: "best_route_candidate",
      infra_health: 0.98,
      network_regime: "stable",
      best: {
        venue: "binance-public",
        score: 82,
        spread_bps: 0.7,
        available_depth_usd: 120000,
        freshness_ms: 250,
        fill_probability: 0.93,
        stability_score: 0.91,
        stability_state: "stable",
      },
      backup: {
        venue: "okx-public",
        score: 64,
        spread_bps: 1.1,
        available_depth_usd: 84000,
        freshness_ms: 420,
        fill_probability: 0.78,
        stability_score: 0.72,
        stability_state: "watch",
      },
      candidates: [],
    },
    ohlcv_rows: buildOhlcvRows(instrument),
    depth_snapshot: {
      source: "market-bus-live",
      last_update_id: 8800123,
      timestamp: Date.now() - 600,
      depth_payload: {
        bids: [[68640.1, 18], [68639.8, 25], [68639.5, 31], [68639.1, 28]],
        asks: [[68640.8, 17], [68641.3, 21], [68641.7, 26], [68642.1, 22]],
      },
    },
    meta: {
      health: {
        status: "ok",
        reason: "live_stream_ok",
        components: {
          ohlcv: { freshness_ms: 800 },
          depth: { freshness_ms: 500 },
          trades: { freshness_ms: 1200 },
        },
      },
      preprocessor: {
        trades: {
          mode: "adaptive_price_discovery",
          market_regime: "price_discovery",
          raw_count: 120,
          emitted_count: 20,
          compression_saved_pct: 83,
          compression_ratio: 0.167,
          alert: {
            state: "warn",
            summary: "Compression too aggressive in price discovery.",
          },
          analytics: {
            windows: {
              last_24h: [
                {
                  market_regime: "price_discovery",
                  compression_saved_pct: 81.4,
                  aggressive_bucket_count: 6,
                },
              ],
              last_7d: [
                {
                  market_regime: "price_discovery",
                  compression_saved_pct: 76.2,
                  aggressive_bucket_count: 14,
                },
              ],
            },
          },
        },
      },
    },
    as_of: new Date().toISOString(),
  };
}

function buildTradabilityJournalEntry(input: {
  id: string;
  createdAtIso: string;
  regime: string;
  densityState: "SUFFICIENT" | "THIN" | "DEGRADED";
  scorePct: number;
  entropyPct: number;
  action: string;
  edgeState: string;
}): Record<string, unknown> {
  return {
    id: input.id,
    createdAtIso: input.createdAtIso,
    symbol: "BTCUSD",
    timeframe: "1m",
    strategy: "scalp",
    action: "tradability-snapshot",
    detail: `${input.densityState} ${input.regime}`,
    meta: {
      tradability_snapshot: {
        volatility_regime: input.regime,
        market_session: "NEW-YORK",
        state: input.densityState,
        action: input.action,
        edge_state: input.edgeState,
        blocking_layer: input.densityState === "DEGRADED" ? "information_density" : "none",
        information_density_state: input.densityState,
        score_pct: input.scorePct,
        entropy_pct: input.entropyPct,
      },
      final_decision_truth: {
        action: input.action,
        blocking_layer: input.densityState === "DEGRADED" ? "information_density" : null,
        edge_eligibility: { state: input.edgeState, score_pct: input.scorePct },
        information_density: {
          state: input.densityState,
          score_pct: input.scorePct,
          entropy_pct: input.entropyPct,
          reasons: [],
        },
      },
    },
  };
}

async function installPreprocessorWarnMocks(page: Page): Promise<void> {
  const context = page.context();
  const tradabilityJournalEntries: Record<string, unknown>[] = [
    buildTradabilityJournalEntry({
      id: "tradability-trend-1",
      createdAtIso: new Date(Date.now() - 18 * 60_000).toISOString(),
      regime: "TREND",
      densityState: "SUFFICIENT",
      scorePct: 74,
      entropyPct: 21,
      action: "ALLOW",
      edgeState: "GREEN",
    }),
    buildTradabilityJournalEntry({
      id: "tradability-chop-1",
      createdAtIso: new Date(Date.now() - 9 * 60_000).toISOString(),
      regime: "CHOP",
      densityState: "THIN",
      scorePct: 46,
      entropyPct: 56,
      action: "GUARD",
      edgeState: "YELLOW",
    }),
    buildTradabilityJournalEntry({
      id: "tradability-chop-2",
      createdAtIso: new Date(Date.now() - 4 * 60_000).toISOString(),
      regime: "CHOP",
      densityState: "DEGRADED",
      scorePct: 33,
      entropyPct: 72,
      action: "BLOCK",
      edgeState: "RED",
    }),
    buildTradabilityJournalEntry({
      id: "tradability-trend-2",
      createdAtIso: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      regime: "TREND",
      densityState: "DEGRADED",
      scorePct: 41,
      entropyPct: 68,
      action: "BLOCK",
      edgeState: "RED",
    }),
    buildTradabilityJournalEntry({
      id: "tradability-trend-3",
      createdAtIso: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
      regime: "TREND",
      densityState: "THIN",
      scorePct: 49,
      entropyPct: 59,
      action: "GUARD",
      edgeState: "YELLOW",
    }),
  ];
  await context.route("**/api/auth/status", async (route) => {
    await route.fulfill({ json: { authenticated: true, role: "operator" } });
  });
  await context.route("**/api/auth/ws-token", async (route) => {
    await route.fulfill({ json: { token: "playwright-token", controlPlaneUrl: "http://127.0.0.1:3000" } });
  });
  await context.route("**/api/dashboard/overview", async (route) => {
    await route.fulfill({ json: { system_mode: "guarded_auto", kill_switch_active: false, open_alerts: 0 } });
  });
  await context.route("**/api/terminal/v2-risk-journal**", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      const nextEntry = {
        id: `tradability-post-${tradabilityJournalEntries.length + 1}`,
        createdAtIso: new Date().toISOString(),
        symbol: String(payload.symbol || "BTCUSD"),
        timeframe: String(payload.timeframe || "1m"),
        strategy: String(payload.strategy || "scalp"),
        action: String(payload.action || "tradability-snapshot"),
        detail: String(payload.detail || "posted"),
        meta: payload.meta && typeof payload.meta === "object" ? payload.meta : {},
      };
      tradabilityJournalEntries.unshift(nextEntry);
      await route.fulfill({ json: { ok: true, entry: nextEntry } });
      return;
    }
    await route.fulfill({ json: { entries: tradabilityJournalEntries } });
  });
  await context.route("**/api/connectors/status", async (route) => {
    await route.fulfill({ json: { alerts: [], connector_status: [], degradation_rows: [], linked_accounts: [] } });
  });
  await context.route("**/api/live-readiness/overview", async (route) => {
    await route.fulfill({ json: { degraded: false, upstream_status: 200, detail: null, network_state: "healthy", network: { failure_kind: "none" }, drift: { suspended_strategies: [], items: [] }, memory_kpi: { summary: {} } } });
  });
  await context.route("**/api/system/live-ops", async (route) => {
    await route.fulfill({ json: { watchdog_state: { status: "OK", health_score: 94 }, governance: { mode: "SAFE", backend_mode: "guarded_auto" }, recovery: { active: false, blocked_trades: false, mode: "NOMINAL" }, memory_gap: {}, alerts: [], risk_snapshot: { dd_pct: 0.2 } } });
  });
  await context.route("**/api/system/kill-switch", async (route) => {
    await route.fulfill({ json: { active: false, reason: "clear" } });
  });
  await context.route("**/api/system/shadow-metrics", async (route) => {
    await route.fulfill({ json: { fallback_rate_pct: 0, control_plane_network_pct: { degraded_usage_ratio: 0, timeout_rate: 0 }, metrics_snapshot: {} } });
  });
  await context.route("**/api/mt5/health", async (route) => {
    await route.fulfill({ json: { status: "ok", degraded: false, upstream_status: 200, latency_ms: 12 } });
  });
  await context.route("**/api/incidents", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await context.route("**/api/ai/health", async (route) => {
    await route.fulfill({ json: { providers: { providers: [] }, degraded: false, network_state: "healthy" } });
  });
  await context.route("**/api/execution/pnl-analyzer**", async (route) => {
    await route.fulfill({ json: { rows: [], stats: {} } });
  });
  await context.route("**/api/execution/reality-gap/recent**", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await context.route("**/api/execution/optimizer/live-state", async (route) => {
    await route.fulfill({ json: { state: "stable", summary: {} } });
  });
  await context.route("**/api/execution/ai/v6/state", async (route) => {
    await route.fulfill({ json: { snapshot: { guardrails: {} } } });
  });
  await context.route("**/api/strategies/drift", async (route) => {
    await route.fulfill({ json: { items: [], suspended_strategies: [] } });
  });
  await context.route("**/api/market/venues/telemetry", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await context.route("**/api/execution/routing/venues/telemetry**", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await context.route("**/api/mt5/orders/live-pending", async (route) => {
    await route.fulfill({ json: [] });
  });
  await context.route("**/api/outcomes/recent**", async (route) => {
    await route.fulfill({ json: [] });
  });
  await context.route("**/api/broker/positions", async (route) => {
    await route.fulfill({ json: [] });
  });
  await context.route("**/api/broker/balance", async (route) => {
    await route.fulfill({ json: { balances: [] } });
  });
  await context.route("**/api/performance/summary**", async (route) => {
    await route.fulfill({ json: { totals: {}, returns: {} } });
  });
  await context.route("**/api/performance/attribution**", async (route) => {
    await route.fulfill({ json: { rows: [] } });
  });
  await context.route("**/api/accounts", async (route) => {
    await route.fulfill({ json: [{ account_id: "mt5-demo-01", account_type: "broker", display_name: "MT5 Demo" }] });
  });
  await context.route("**/api/connectors/accounts", async (route) => {
    await route.fulfill({ json: [] });
  });
  await context.route("**/api/investor-reports**", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await context.route("**/api/market/quotes**", async (route) => {
    const instrument = new URL(route.request().url()).searchParams.get("instrument") || "BTCUSD";
    await route.fulfill({ json: buildQuotesPayload(instrument) });
  });
  await context.route("**/api/market/bus/snapshot**", async (route) => {
    const instrument = new URL(route.request().url()).searchParams.get("instrument") || "BTCUSD";
    await route.fulfill({ json: buildSnapshotPayload(instrument) });
  });
  await context.route("**/api/health/local-terminal", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
}

test("shows the PREPROC warn chip and readiness preprocessor card under a forced warn snapshot", async ({ page }) => {
  test.setTimeout(180_000);

  const runtimeCollectors = attachRuntimeCollectors(page);
  await installRuntimeErrorHooks(page);
  await installPreprocessorWarnMocks(page);
  await loginIfRequired(page, "/terminal?boot=light", "terminal preprocessor warn smoke");
  await expect(page.getByTestId("mission-control-terminal-page")).toBeVisible({ timeout: 45_000 });
  await assertNoRuntimeCrash(page, runtimeCollectors, "after-terminal-load");

  const preprocessorChip = page.getByTestId("terminal-topbar-preprocessor-alert-chip");
  await expect(preprocessorChip).toBeVisible({ timeout: 45_000 });
  await expect(preprocessorChip).toContainText("PREPROC PRICE DISCOVERY 83%");

  const opsToggle = page.getByTestId("terminal-focus-toggle-ops");
  if (await opsToggle.count()) {
    await opsToggle.click();
  }
  const diagnosticsButton = page.getByTestId("terminal-surface-diagnostics-button");
  if (await diagnosticsButton.count()) {
    await diagnosticsButton.click();
    await expect(diagnosticsButton).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.getByTestId("terminal-diagnostics-grid")).toBeVisible({ timeout: 45_000 });
  await assertNoRuntimeCrash(page, runtimeCollectors, "after-opening-diagnostics");

  const tradabilitySurfaceCard = page.getByTestId("terminal-tradability-surface-card");
  await expect(tradabilitySurfaceCard).toBeVisible({ timeout: 45_000 });
  await expect(tradabilitySurfaceCard).toContainText("Oracle contract");
  await expect(tradabilitySurfaceCard).toContainText("Information density");
  await expect(tradabilitySurfaceCard).toContainText("Market truth");
  await expect(tradabilitySurfaceCard).toContainText("Short history");
  await expect(tradabilitySurfaceCard).toContainText("Regime comparison");
  await expect(page.getByTestId("terminal-tradability-density-row")).toContainText("/");
  await expect(page.getByTestId("terminal-tradability-calibration-thresholds")).toContainText("Applied thresholds");
  await expect(page.getByTestId("terminal-tradability-impact-weight")).toContainText("info_density");
  await expect(page.getByTestId("terminal-tradability-market-truth-score")).toContainText("Truth score");
  await expect(page.getByTestId("terminal-tradability-market-truth-score")).toContainText("%");
  await expect(page.getByTestId("terminal-tradability-market-truth-components")).toContainText("anomaly");
  await expect(page.getByTestId("terminal-tradability-false-context")).toContainText(/FALSE_|none/);
  await expect(page.getByTestId("terminal-tradability-false-context-reasons")).toBeVisible();
  await expect(page.getByTestId("terminal-tradability-market-truth-reasons")).toBeVisible();
  await expect(page.getByTestId("terminal-tradability-proofs")).toContainText("Contract");
  await expect(page.getByTestId("terminal-tradability-proofs")).toContainText("Market truth");
  await expect(page.getByTestId("terminal-tradability-proofs")).toContainText("Information density");
  await expect(page.getByTestId("terminal-tradability-verdict-explanation")).toContainText("Contract");
  await expect(page.getByTestId("terminal-tradability-verdict-explanation")).toContainText("Market truth");
  await expect(page.getByTestId("terminal-tradability-verdict-explanation")).toContainText("Information density");
  await expect(page.getByTestId("terminal-tradability-history-strip")).toContainText(/TREND|CHOP/);
  await expect(page.getByTestId("terminal-tradability-regime-map")).toContainText("CHOP");
  await expect(page.getByTestId("terminal-tradability-regime-map")).toContainText("24h");
  await expect(page.getByTestId("terminal-tradability-regime-map")).toContainText("7j");
  await expect(page.getByTestId("terminal-tradability-regime-map")).toContainText("Drift");
  await expect(page.getByTestId("terminal-tradability-calibration-hint")).toBeVisible();

  const readinessPreprocessorCard = page.getByTestId("terminal-readiness-preprocessor-card");
  const readinessTradabilityCard = page.getByTestId("terminal-readiness-tradability-card");
  await expect(readinessTradabilityCard).toBeVisible({ timeout: 45_000 });
  await expect(readinessTradabilityCard).toContainText("Final contract");
  await expect(readinessTradabilityCard).toContainText("Information density");
  await expect(readinessTradabilityCard).toContainText("Entropy");
  await expect(page.getByTestId("terminal-readiness-tradability-density")).toContainText(/SUFFICIENT|THIN|DEGRADED/);
  await expect(readinessPreprocessorCard).toBeVisible({ timeout: 45_000 });
  await expect(readinessPreprocessorCard).toContainText("adaptive_price_discovery");
  await expect(readinessPreprocessorCard).toContainText("price_discovery");
  await expect(readinessPreprocessorCard).toContainText("83.0%");
  await expect(readinessPreprocessorCard).toContainText("Price discovery 24h");
  await expect(readinessPreprocessorCard).toContainText("Price discovery 7d");
  await expect(page.getByTestId("terminal-readiness-preprocessor-alert")).toContainText("WARN");
  await expect(page.getByText("Compression too aggressive in price discovery.", { exact: false })).toBeVisible();
});