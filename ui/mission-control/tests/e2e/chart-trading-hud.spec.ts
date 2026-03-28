import { expect, test, type Page } from "@playwright/test";

async function loginIfRequired(page: Page): Promise<void> {
  await page.goto("/terminal", { waitUntil: "domcontentloaded" });

  const username = page.locator("#username");
  if (await username.count() === 0) {
    return;
  }

  const password = process.env.PLAYWRIGHT_OPERATOR_PASSWORD || process.env.MC_SMOKE_PASSWORD || "";
  if (!password) {
    throw new Error("PLAYWRIGHT_OPERATOR_PASSWORD is required when /terminal redirects to login");
  }

  await username.fill("operator");
  await page.locator("#password").fill(password);
  await page.locator('form[action="/api/auth/login"] button[type="submit"]').click();
  await page.waitForLoadState("domcontentloaded");

  if (page.url().includes("/change-password")) {
    throw new Error("Operator account requires password change before HUD test can run");
  }

  await page.goto("/terminal", { waitUntil: "domcontentloaded" });
}

test("@chart chart trading HUD keeps key interactions stable after extraction", async ({ page }) => {
  await loginIfRequired(page);

  const hud = page.locator(".chart-order-hud").first();
  await hud.waitFor({ state: "visible", timeout: 30_000 });

  const body = hud.locator(".chart-order-hud-body");
  await expect(body).toBeVisible();
  await expect(hud.locator(".chart-decision-secondary")).toBeVisible();

  const tuneButton = hud.locator(".chart-decision-tools .chart-chip").first();
  await expect(tuneButton).toBeVisible();
  await expect(tuneButton).toContainText("Tune");
  await tuneButton.click();
  await expect(hud.locator(".chart-confluence-controls")).toBeVisible();
  await expect(tuneButton).toContainText("Hide Tune");

  await hud.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  const snapButton = hud.getByRole("button", { name: /^Snap On$/i }).first();
  await expect(snapButton).toBeVisible();
  await snapButton.click();
  await expect(hud.getByRole("button", { name: /^Snap Off$/i }).first()).toBeVisible();

  const armSendButton = hud.getByRole("button", { name: /^Arm Send$/i }).first();
  await expect(armSendButton).toBeVisible();
  await armSendButton.click();
  await expect(hud.getByRole("button", { name: /^Armed$/i }).first()).toBeVisible();

  await hud.getByRole("button", { name: /^Reduce$/i }).click();
  await expect(hud.locator(".chart-order-hud-body")).toHaveCount(0);
  await expect(hud.getByRole("button", { name: /^Expand$/i }).first()).toBeVisible();

  await hud.getByRole("button", { name: /^Expand$/i }).click();
  await expect(body).toBeVisible();
  await expect(hud.locator(".chart-decision-secondary")).toBeVisible();
  await expect(hud.locator(".chart-confluence-controls")).toBeVisible();

  await hud.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(hud.getByRole("button", { name: /^Armed$/i }).first()).toBeVisible();
  await expect(hud.getByRole("button", { name: /^Snap Off$/i }).first()).toBeVisible();
});