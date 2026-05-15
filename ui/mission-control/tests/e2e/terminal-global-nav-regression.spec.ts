import { expect, test, type Page } from "@playwright/test";

import { loginIfRequired } from "./helpers/terminal";

const TERMINAL_PATH = "/terminal?v2=1&engine=v4&boot=full";
const LEARN_URL_PATTERN = /\/learn(?:\?.*)?$/;

async function stubTerminalObservationRuntime(page: Page): Promise<void> {
  await page.route("**/api/dashboard/overview", async (route) => {
    await route.fulfill({ json: { kill_switch_active: false, net_exposure_usd: 0, gross_exposure_usd: 0 } });
  });
  await page.route("**/api/performance/attribution**", async (route) => {
    await route.fulfill({
      json: {
        rows: [
          {
            strategy: "mt5-live",
            strategy_id: "mt5-live",
            symbol: "BTCUSD",
            venue: "binance-public",
            trade_count: 1,
            pnl_contribution_pct: 100,
            realized_pnl_usd: 12.5,
            pnl_usd: 12.5,
          },
        ],
      },
    });
  });
  await page.route("**/api/system/runtime-decision", async (route) => {
    await route.fulfill({
      json: {
        scope: { symbol: "BTCUSD", timeframe: "1m", strategy: "terminal" },
        reliability: {
          state: "OBSERVE",
          summary: "OBSERVE · signal consistency 100%",
          dataCompletenessPct: 100,
          signalConsistencyPct: 100,
          degradedReasons: [],
          blockingReasons: [],
        },
        opportunity: {
          summary: "Score moyen 78% · facteur limitant latency 32%",
          confidencePct: 100,
          telemetry: {
            summary: "venues 1 · spread 1.20bp · depth 120k USD · route 188ms · fill 87%",
            integrity: {
              state: "OK",
              summary: "execution telemetry OK",
              routeCoveragePct: 100,
              executionVenueCount: 1,
              routeVenueCount: 1,
              marketVenueCount: 1,
              items: [],
            },
          },
          breakdown: [],
        },
        drift: {
          state: "CLEAN",
          summary: "DRIFT stable",
          scorePct: 0,
        },
      },
    });
  });
  await page.route("**/api/connectors/status", async (route) => {
    await route.fulfill({ json: { alerts: [], connector_status: [], degradation_rows: [] } });
  });
  await page.route("**/api/mt5/health", async (route) => {
    await route.fulfill({ json: { status: "ok", bridge_connected: true } });
  });
  await page.route("**/api/mt5/accounts", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ json: { ok: true, account_id: "mt5-demo-01" } });
  });
  await page.route("**/api/accounts", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/portfolios/pf-internal-main/risk", async (route) => {
    await route.fulfill({ json: { exposure_usd: 0, drawdown_pct: 0 } });
  });
  await page.route("**/api/mt5/orders/live-pending", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/auth/ws-token", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });
}

async function openTerminal(page: Page): Promise<void> {
  await loginIfRequired(page, TERMINAL_PATH, "terminal global nav regression");
  await expect(page.getByTestId("mission-control-terminal-page")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("#txt-global-nav[data-hydrated='1']")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".terminal-v2-truth-strip")).toBeVisible({ timeout: 45_000 });
}

async function expectLearnPage(page: Page): Promise<void> {
  await expect(page).toHaveURL(LEARN_URL_PATTERN, { timeout: 30_000 });
  await expect(page.locator("#global-guide-learn-hero")).toBeVisible({ timeout: 30_000 });
}

test.describe("terminal global nav regression", () => {
  test.setTimeout(180_000);

  test("terminal -> global nav is always clickable", async ({ page }) => {
    await stubTerminalObservationRuntime(page);
    await openTerminal(page);

    await page.locator("#txt-global-nav-link-learn").click();

    await expectLearnPage(page);
  });

  test("terminal does not block pointer events on global nav under walkthrough overlay", async ({ page }) => {
    await stubTerminalObservationRuntime(page);
    await openTerminal(page);

    await page.getByRole("button", { name: "Walkthrough", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Walkthrough global TXT" })).toBeVisible({ timeout: 30_000 });

    const globalNavLink = page.locator("#txt-global-nav-link-learn");
    const box = await globalNavLink.boundingBox();
    expect(box, "global nav learn link should have a hit box").not.toBeNull();

    await page.mouse.click(box!.x + (box!.width / 2), box!.y + (box!.height / 2));

    await expectLearnPage(page);
  });
});