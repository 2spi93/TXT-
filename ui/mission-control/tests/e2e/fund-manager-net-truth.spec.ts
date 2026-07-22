import { expect, test } from "@playwright/test";

test("fund manager prefers net after costs across visible performance blocks", async ({ page }) => {
  test.setTimeout(120_000);

  const portfolioRisk = {
    equity_usd: 50_000,
    gross_exposure_usd: 18_000,
    net_exposure_usd: 9_500,
    concentration_pct: 22,
    current_drawdown_pct: 2.6,
    max_drawdown_pct: 6.4,
    breaches: [],
  };
  const performanceSummary = {
    trade_count: 11,
    realized_pnl_usd: 9_999,
    net_after_costs_usd: 3_210,
    unrealized_pnl_usd: 210,
    win_rate_pct: 54.5,
    expectancy_usd: 292,
    avg_latency_ms: 84,
    avg_slippage_bps: 3.2,
  };
  const performanceAttribution = [
    {
      symbol: "BTC-USDT",
      venue: "bingx",
      realized_pnl_usd: 1_901,
      net_after_costs_usd: 654,
      unrealized_pnl_usd: 0,
    },
    {
      symbol: "SOL-USDT",
      venue: "bingx",
      realized_pnl_usd: 480,
      net_after_costs_usd: -87,
      unrealized_pnl_usd: 0,
    },
  ];

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const origin = new URL(page.url()).origin;
  const payload = Buffer.from(JSON.stringify({ role: "operator", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  await page.context().addCookies([
    {
      name: "mc_token",
      value: `${payload}.signature`,
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
      secure: origin.startsWith("https://"),
    },
    {
      name: "mc_token_compat",
      value: `${payload}.signature`,
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
      secure: origin.startsWith("https://"),
    },
  ]);

  await page.route("**/api/portfolios/pf-internal-main/risk", async (route) => {
    await route.fulfill({ json: portfolioRisk });
  });
  await page.route("**/api/performance/summary?*", async (route) => {
    await route.fulfill({ json: performanceSummary });
  });
  await page.route("**/api/performance/attribution?*", async (route) => {
    await route.fulfill({ json: { rows: performanceAttribution } });
  });
  await page.route("**/api/portfolios/pf-internal-main/capital-integration", async (route) => {
    await route.fulfill({ json: { totals: { actual_equivalent_usd: 50_000, account_count: 1 }, sleeves: [] } });
  });
  await page.route("**/api/investor-reports?*", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route("**/api/connectors/status", async (route) => {
    await route.fulfill({ json: { connectors: [{ name: "bingx", healthy: true }, { name: "binance", healthy: true }] } });
  });
  await page.route("**/api/outcomes/recent?*", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/execution/telemetry/recent?*", async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto("/fund-manager", { waitUntil: "domcontentloaded" });

  const miniPnlCard = page.getByText("Mini PnL chart", { exact: true }).locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' panel ')][1]");
  const reportingPanel = page.getByText("Performance & investor reporting", { exact: true }).locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' panel ')][1]");
  const attributionPanel = page.getByText("Attribution snapshot", { exact: true }).locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' panel ')][1]");

  await expect(page.getByRole("heading", { name: "Desk de pilotage du fonds" })).toBeVisible();
  await expect(page.getByText("Mini PnL chart")).toBeVisible();
  await expect(miniPnlCard.getByText("3.4k USD", { exact: true })).toBeVisible();
  await expect(reportingPanel.getByText("Realized PnL", { exact: true })).toBeVisible();
  await expect(reportingPanel.getByText("3.2k USD", { exact: true })).toBeVisible();
  await expect(attributionPanel.getByText("BTC-USDT", { exact: true })).toBeVisible();
  await expect(attributionPanel.getByText("654 USD", { exact: true })).toBeVisible();
  await expect(attributionPanel.getByText("-87 USD", { exact: true })).toBeVisible();
  await expect(page.getByText("10.2k USD")).toHaveCount(0);
  await expect(reportingPanel.getByText("10.0k USD", { exact: true })).toHaveCount(0);
  await expect(attributionPanel.getByText("1.9k USD", { exact: true })).toHaveCount(0);
});