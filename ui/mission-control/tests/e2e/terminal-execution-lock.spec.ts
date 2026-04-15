import { expect, test, type Page } from "@playwright/test";

type SnapshotScenario = "live-good" | "forced-fallback";
type TerminalExecutionLockMockOptions = {
  systemRuntimeGuard?: boolean;
};

async function injectOperatorSession(page: Page): Promise<void> {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const origin = new URL(page.url()).origin;
  const payload = Buffer.from(JSON.stringify({ role: "operator", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const token = `${payload}.signature`;

  await page.context().addCookies([
    {
      name: "mc_token",
      value: token,
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
      secure: origin.startsWith("https://"),
    },
    {
      name: "mc_token_compat",
      value: token,
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
      secure: origin.startsWith("https://"),
    },
  ]);
}

function buildOhlcvRows(source: string, instrument: string): Array<Record<string, unknown>> {
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
      source,
    });
  }
  return rows;
}

function buildSnapshotPayload(scenario: SnapshotScenario, instrument: string): Record<string, unknown> {
  const fallback = scenario === "forced-fallback";
  const source = fallback ? "binance-rest-fallback" : "market-bus-live";
  const now = Date.now();
  const routingScore = fallback
    ? null
    : {
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
      candidates: [
        {
          venue: "binance-public",
          score: 82,
          spread_bps: 0.7,
          available_depth_usd: 120000,
          freshness_ms: 250,
          fill_probability: 0.93,
          stability_score: 0.91,
          stability_state: "stable",
        },
        {
          venue: "okx-public",
          score: 64,
          spread_bps: 1.1,
          available_depth_usd: 84000,
          freshness_ms: 420,
          fill_probability: 0.78,
          stability_score: 0.72,
          stability_state: "watch",
        },
      ],
    };
  return {
    instrument,
    venue: "binance-public",
    timeframe: "1m",
    trades: fallback
      ? []
      : [
        {
          price: 68640.2,
          size: 0.14,
          side: "buy",
          traded_at: new Date(now - 1_800).toISOString(),
          venue: "binance-public",
          instrument,
        },
        {
          price: 68640.4,
          size: 0.21,
          side: "buy",
          traded_at: new Date(now - 1_200).toISOString(),
          venue: "okx-public",
          instrument,
        },
        {
          price: 68640.1,
          size: 0.19,
          side: "sell",
          traded_at: new Date(now - 600).toISOString(),
          venue: "coinbase-public",
          instrument,
        },
      ],
    microstructure: {
      instrument,
      venue: "binance-public",
      spread_bps: 0.7,
      depth_imbalance: 0.12,
      source,
      snapshot_at: new Date().toISOString(),
    },
    session_state: {
      instrument,
      session: "new-york",
      is_open: true,
      source,
      snapshot_at: new Date().toISOString(),
    },
    orderbook: {
      venue: "binance-public",
      source,
      best_bid: 68640.1,
      best_ask: 68640.8,
    },
    routingScore,
    routing_score: routingScore,
    ohlcv_rows: buildOhlcvRows(source, instrument),
    depth_snapshot: {
      source,
      last_update_id: fallback ? 0 : 8800123,
      timestamp: fallback ? Date.now() - 190_000 : Date.now() - 600,
      depth_payload: {
        bids: fallback ? [] : [[68640.1, 18], [68639.8, 25], [68639.5, 31], [68639.1, 28]],
        asks: fallback ? [] : [[68640.8, 17], [68641.3, 21], [68641.7, 26], [68642.1, 22]],
      },
    },
    meta: {
      health: {
        status: fallback ? "degraded" : "ok",
        reason: fallback ? "control_plane_snapshot_unavailable" : "live_stream_ok",
        components: {
          ohlcv: { freshness_ms: fallback ? 195_000 : 800 },
          depth: { freshness_ms: fallback ? 210_000 : 500 },
          trades: { freshness_ms: fallback ? -1 : 1200 },
        },
      },
      sequencing: {
        ohlcv: {
          latest_seq: fallback ? 0 : 48,
          contiguous: !fallback,
        },
        depth: {
          last_update_id: fallback ? 0 : 8800123,
        },
      },
    },
    as_of: new Date().toISOString(),
  };
}

function buildQuotesPayload(scenario: SnapshotScenario, instrument: string): Array<Record<string, unknown>> {
  const fallback = scenario === "forced-fallback";
  const now = new Date().toISOString();
  if (fallback) {
    return [];
  }
  return [
    {
      symbol: instrument,
      instrument,
      venue: "binance-public",
      bid: 68640.1,
      ask: 68640.8,
      last: 68640.4,
      updated_at: now,
    },
    {
      symbol: instrument,
      instrument,
      venue: "okx-public",
      bid: 68640.0,
      ask: 68640.9,
      last: 68640.5,
      updated_at: now,
    },
    {
      symbol: instrument,
      instrument,
      venue: "coinbase-public",
      bid: 68639.9,
      ask: 68641.0,
      last: 68640.6,
      updated_at: now,
    },
    {
      symbol: instrument.replace(/USDT$/, "USD"),
      instrument: instrument.replace(/USDT$/, "USD"),
      venue: "binance-public",
      bid: 68640.05,
      ask: 68640.75,
      last: 68640.3,
      updated_at: now,
    },
  ];
}

function buildRuntimeGuardConnectorsPayload(): Record<string, unknown> {
  return {
    alerts: [],
    connector_status: [],
    degradation_rows: [],
    linked_accounts: [],
  };
}

async function installTerminalExecutionLockMocks(
  page: Page,
  scenario: SnapshotScenario,
  options: TerminalExecutionLockMockOptions = {},
): Promise<void> {
  const context = page.context();
  const runtimeGuardActive = options.systemRuntimeGuard === true;
  await context.route("**/api/auth/status", async (route) => {
    await route.fulfill({ json: { authenticated: true, role: "operator" } });
  });
  await context.route("**/api/auth/ws-token", async (route) => {
    await route.fulfill({ json: { token: "playwright-token", controlPlaneUrl: "http://127.0.0.1:3000" } });
  });
  await context.route("**/api/dashboard/overview", async (route) => {
    await route.fulfill({
      json: {
        system_mode: "guarded_auto",
        kill_switch_active: false,
        open_alerts: 0,
      },
    });
  });
  await context.route("**/api/connectors/status", async (route) => {
    await route.fulfill({ json: buildRuntimeGuardConnectorsPayload() });
  });
  await context.route("**/api/live-readiness/overview", async (route) => {
    await route.fulfill({
      json: {
        degraded: runtimeGuardActive,
        upstream_status: runtimeGuardActive ? 503 : 200,
        detail: runtimeGuardActive ? "live_readiness_unreachable" : null,
        network_state: runtimeGuardActive ? "degraded" : "healthy",
        network: {
          failure_kind: runtimeGuardActive ? "timeout" : "none",
        },
        drift: {
          suspended_strategies: [],
          items: [],
        },
        memory_kpi: {
          summary: {},
        },
      },
    });
  });
  await context.route("**/api/system/live-ops", async (route) => {
    await route.fulfill({
      json: {
        watchdog_state: {
          status: runtimeGuardActive ? "WARNING" : "OK",
          health_score: runtimeGuardActive ? 58 : 94,
        },
        governance: {
          mode: "SAFE",
          backend_mode: "guarded_auto",
        },
        recovery: {
          active: runtimeGuardActive,
          blocked_trades: runtimeGuardActive,
          mode: runtimeGuardActive ? "SAFE_RECOVERY" : "NOMINAL",
        },
        memory_gap: {},
        alerts: runtimeGuardActive
          ? [
            {
              severity: "critical",
              code: "system_recovery",
              message: "Live Ops recovery active",
            },
          ]
          : [],
        risk_snapshot: {
          dd_pct: runtimeGuardActive ? 1.2 : 0.2,
        },
      },
    });
  });
  await context.route("**/api/system/kill-switch", async (route) => {
    await route.fulfill({ json: { active: false, reason: "clear" } });
  });
  await context.route("**/api/system/shadow-metrics", async (route) => {
    await route.fulfill({ json: { fallback_rate_pct: 0, control_plane_network_pct: { degraded_usage_ratio: 0, timeout_rate: 0 }, metrics_snapshot: {} } });
  });
  await context.route("**/api/mt5/health", async (route) => {
    await route.fulfill({
      json: runtimeGuardActive
        ? { status: "down", degraded: true, upstream_status: 503, detail: "mt5_health_unreachable" }
        : { status: "ok", degraded: false, upstream_status: 200, latency_ms: 12 },
    });
  });
  await context.route("**/api/incidents", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await context.route("**/api/ai/health", async (route) => {
    await route.fulfill({
      json: {
        providers: {
          providers: [],
        },
        degraded: false,
        network_state: "healthy",
      },
    });
  });
  await context.route("**/api/execution/pnl-analyzer**", async (route) => {
    await route.fulfill({ json: { rows: [], stats: {} } });
  });
  await context.route("**/api/execution/optimizer/live-state", async (route) => {
    await route.fulfill({ json: { state: "stable", summary: {} } });
  });
  await context.route("**/api/execution/ai/v6/state", async (route) => {
    await route.fulfill({ json: { snapshot: { guardrails: {} } } });
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
    await route.fulfill({
      json: buildQuotesPayload(scenario, instrument),
    });
  });
  await context.route("**/api/market/bus/snapshot**", async (route) => {
    const instrument = new URL(route.request().url()).searchParams.get("instrument") || "BTCUSD";
    await route.fulfill({ json: buildSnapshotPayload(scenario, instrument) });
  });
  await context.route("**/api/health/local-terminal", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
}

test.describe("terminal execution lock", () => {
  test("explains why the local live-good harness still resolves to routing score 0", async ({ page }) => {
    test.setTimeout(120_000);
    await installTerminalExecutionLockMocks(page, "live-good");
    await injectOperatorSession(page);
    await page.goto("/terminal?engine=v4", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/ROUTING SCORE 0 · EXECUTION DISABLED/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Routing score 0 blocks trading until venue scoring is restored\./i).first()).toBeVisible({ timeout: 30_000 });

    const governedSendButton = page.locator(".exec-send-order").first();
    await expect(governedSendButton).toBeVisible({ timeout: 30_000 });
    await expect(governedSendButton).toHaveText("Execution Disabled", { timeout: 30_000 });
    await expect(governedSendButton).toBeDisabled();
  });

  test("shows execution-disabled banner and blocks governed ticket in forced fallback mode", async ({ page }) => {
    test.setTimeout(120_000);
    await installTerminalExecutionLockMocks(page, "forced-fallback");
    await injectOperatorSession(page);
    await page.goto("/terminal?engine=v4", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/FALLBACK MODE · EXECUTION DISABLED/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Fallback source .* blocks live execution\./i).first()).toBeVisible({ timeout: 30_000 });

    const governedSendButton = page.locator(".exec-send-order").first();
    await expect(governedSendButton).toBeVisible({ timeout: 30_000 });
    await expect(governedSendButton).toHaveText("Execution Disabled", { timeout: 30_000 });
    await expect(governedSendButton).toBeDisabled();
  });

  test("prioritizes the system runtime guard badge when live ops, readiness and mt5 are degraded", async ({ page }) => {
    test.setTimeout(120_000);
    await installTerminalExecutionLockMocks(page, "live-good", { systemRuntimeGuard: true });
    await injectOperatorSession(page);
    await page.goto("/terminal?engine=v4", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("system-runtime-guard-badge").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("system-runtime-guard-status").first()).toHaveText("BLOCKED", { timeout: 30_000 });
    await expect(page.getByTestId("system-runtime-guard-code").first()).toHaveText("LO-RECOVERY", { timeout: 30_000 });
    await expect(page.getByTestId("system-runtime-guard-source").first()).toHaveText("source live-ops", { timeout: 30_000 });
    await expect(page.getByTestId("system-runtime-guard-detail").first()).toContainText("Recovery SAFE_RECOVERY actif", { timeout: 30_000 });
    await expect(page.getByText(/RECOVERY LOCKDOWN · EXECUTION DISABLED/i).first()).toBeVisible({ timeout: 30_000 });

    const governedSendButton = page.locator(".exec-send-order").first();
    await expect(governedSendButton).toBeVisible({ timeout: 30_000 });
    await expect(governedSendButton).toHaveText("Execution Disabled", { timeout: 30_000 });
    await expect(governedSendButton).toBeDisabled();
  });

  test("forces no-trade explicitly when engine v4 is off", async ({ page }) => {
    test.setTimeout(120_000);
    await installTerminalExecutionLockMocks(page, "live-good");
    await injectOperatorSession(page);
    await page.goto("/terminal?engine=v3", { waitUntil: "domcontentloaded" });

    await expect(page.getByText(/ENGINE V4 OFF · EXECUTION DISABLED/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Execution Policy Engine requires Engine V4\./i).first()).toBeVisible({ timeout: 30_000 });

    const governedSendButton = page.locator(".exec-send-order").first();
    await expect(governedSendButton).toBeVisible({ timeout: 30_000 });
    await expect(governedSendButton).toHaveText("Execution Disabled", { timeout: 30_000 });
    await expect(governedSendButton).toBeDisabled();
  });
});