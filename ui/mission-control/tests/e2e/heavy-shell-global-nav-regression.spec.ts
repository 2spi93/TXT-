import { expect, test, type Page } from "@playwright/test";

import { loginIfRequired } from "./helpers/terminal";

async function stubLiveOpsShell(page: Page): Promise<void> {
  await page.route("**/api/system/live-ops", async (route) => {
    await route.fulfill({
      json: {
        updated_at: "2026-04-19T10:00:00.000Z",
        watchdog_state: { status: "SAFE", health_score: 82, triggers: [] },
        governance: { mode: "SUGGEST", backend_mode: "guarded_auto" },
        recovery: { active: false, mode: "STABLE" },
        memory_gap: { memory_decision: "OBSERVE" },
        alerts: [],
        risk_snapshot: { dd_pct: 0.2, dd_usd: 12 },
        risk_timeline: [],
        audit_trail: [],
        warfare_core: {
          market_state: { state: "BALANCED", confidence: 0.64 },
          smart_money: { state: "WATCH" },
          spoof: { state: "CLEAR" },
          domination: { state: "NEUTRAL" },
        },
      },
    });
  });
  await page.route("**/api/execution/pnl-analyzer**", async (route) => {
    await route.fulfill({
      json: {
        summary: {
          trade_count: 4,
          avg_latency_ms: 94,
          avg_slippage_bps: 1.2,
          net_pnl_usd: 44,
          high_confidence_loss_count: 0,
          no_trade_dominance_count: 1,
          win_rate_pct: 75,
          avg_pnl_usd: 11,
        },
      },
    });
  });
  await page.route("**/api/execution/ai/v6/state", async (route) => {
    await route.fulfill({
      json: {
        snapshot: {
          context_count: 6,
          guardrails: {
            learning_frozen: false,
            persistence_available: true,
          },
        },
      },
    });
  });
  await page.route("**/api/terminal/v2-risk-journal", async (route, request) => {
    if (request.method() === "POST") {
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ json: { entries: [] } });
  });
}

test.describe("heavy shell global nav regression", () => {
  test.setTimeout(180_000);

  test("live-ops uses hard navigation to leave the heavy shell", async ({ page }) => {
    await stubLiveOpsShell(page);
    await loginIfRequired(page, "/live-ops", "heavy shell live-ops nav regression");

    await expect(page.getByTestId("mission-control-live-ops-page")).toBeVisible({ timeout: 45_000 });
    await expect(page.locator("#txt-global-nav[data-hydrated='1']")).toBeVisible({ timeout: 30_000 });

    await page.locator("#txt-global-nav-link-learn").click();

    await expect(page).toHaveURL(/\/learn(?:\?.*)?$/, { timeout: 30_000 });
    await expect(page.locator("#global-guide-learn-hero")).toBeVisible({ timeout: 30_000 });
  });
});