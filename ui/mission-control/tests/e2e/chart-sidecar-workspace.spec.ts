import { expect, test, type Page } from "@playwright/test";

const TERMINAL_STORAGE_PREFIXES = [
  "txt.terminal.layout.v1",
  "txt.terminal.workspaces.v1",
  "txt.terminal.chart-sidecar.v1",
];

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
    throw new Error("Operator account requires password change before sidecar workspace test can run");
  }

  await page.goto("/terminal", { waitUntil: "domcontentloaded" });
}

function floatingSidecarByTitle(page: Page, title: string) {
  return page.locator(".chart-sidecar-floating-window").filter({
    has: page.locator(".floating-panel-title", { hasText: title }),
  }).first();
}

async function resetTerminalLayoutStorage(page: Page): Promise<void> {
  await page.evaluate((prefixes: string[]) => {
    const keys = Object.keys(window.localStorage);
    for (const key of keys) {
      if (prefixes.some((prefix) => key.startsWith(prefix))) {
        window.localStorage.removeItem(key);
      }
    }
  }, TERMINAL_STORAGE_PREFIXES);
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function expectSwingDockedLayout(page: Page): Promise<void> {
  await expect(page.getByRole("group", { name: "Chart sidecar layout mode" })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => ({
    docked: await page.locator(".chart-sidecar-stack .chart-sidecar-card").count(),
    floating: await page.locator(".chart-sidecar-floating-window").count(),
  }), { timeout: 30_000 }).toEqual({ docked: 3, floating: 0 });
}

async function expectSwingDetachedLayout(page: Page): Promise<void> {
  await expect.poll(async () => ({
    docked: await page.locator(".chart-sidecar-stack .chart-sidecar-card").count(),
    floating: await page.locator(".chart-sidecar-floating-window").count(),
  }), { timeout: 30_000 }).toEqual({ docked: 0, floating: 3 });
}

test("@chart detached sidecar drag + custom save persists on reload", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("Maximum update depth exceeded")) {
      consoleErrors.push(msg.text());
    }
  });

  await loginIfRequired(page);
  await resetTerminalLayoutStorage(page);
  await expectSwingDockedLayout(page);

  const layoutGroup = page.getByRole("group", { name: "Chart sidecar layout mode" });
  await layoutGroup.waitFor({ state: "visible", timeout: 30_000 });

  await layoutGroup.getByRole("button", { name: /^Detached$/i }).click();
  await expectSwingDetachedLayout(page);

  const floatingTitles = await page.locator(".chart-sidecar-floating-window .floating-panel-title").allTextContents();
  expect(floatingTitles).toContain("EXECUTION");
  expect(floatingTitles).toContain("POLICY");
  expect(floatingTitles).toHaveLength(3);

  const executionWindow = floatingSidecarByTitle(page, "EXECUTION");
  const policyWindow = floatingSidecarByTitle(page, "POLICY");
  await executionWindow.waitFor({ state: "visible", timeout: 30_000 });
  await policyWindow.waitFor({ state: "visible", timeout: 30_000 });

  const before = await executionWindow.boundingBox();
  expect(before).not.toBeNull();
  if (!before) {
    throw new Error("Execution sidecar box missing before drag");
  }

  await executionWindow.locator(".floating-panel-titlebar").hover();
  await page.mouse.move(before.x + 80, before.y + 18);
  await page.mouse.down();
  await page.mouse.move(before.x + 220, before.y + 110, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const afterDrag = await executionWindow.boundingBox();
  expect(afterDrag).not.toBeNull();
  if (!afterDrag) {
    throw new Error("Execution sidecar box missing after drag");
  }

  const movedDx = Math.round(afterDrag.x - before.x);
  const movedDy = Math.round(afterDrag.y - before.y);
  expect(Math.abs(movedDx) >= 40 || Math.abs(movedDy) >= 25).toBeTruthy();

  await policyWindow.getByRole("button", { name: /^Custom save$/i }).click();
  const hintBadge = page.locator(".layout-workspace-hint-badge").filter({ hasText: "Custom sidecar saved" }).first();
  await expect(hintBadge).toBeVisible();
  await expect(hintBadge).toContainText("Custom sidecar saved");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expectSwingDetachedLayout(page);

  const executionAfterReload = floatingSidecarByTitle(page, "EXECUTION");
  await executionAfterReload.waitFor({ state: "visible", timeout: 30_000 });
  const afterReload = await executionAfterReload.boundingBox();
  expect(afterReload).not.toBeNull();
  if (!afterReload) {
    throw new Error("Execution sidecar box missing after reload");
  }

  expect(Math.abs(Math.round(afterReload.x - afterDrag.x))).toBeLessThanOrEqual(24);
  expect(Math.abs(Math.round(afterReload.y - afterDrag.y))).toBeLessThanOrEqual(24);
  expect(consoleErrors).toEqual([]);
});