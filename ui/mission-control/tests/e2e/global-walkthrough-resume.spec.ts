import { expect, test, type Page } from "@playwright/test";

async function seedClientSession(page: Page): Promise<void> {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const origin = new URL(page.url()).origin;
  const payload = Buffer.from(JSON.stringify({ role: "client", exp: Math.floor(Date.now() / 1000) + 3600 }), "utf8").toString("base64url");
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

test("global walkthrough resumes the paused client journey after reload", async ({ page }) => {
  test.setTimeout(180_000);

  await page.addInitScript(() => {
    window.localStorage.setItem("txt.global.walkthrough.state.v1", JSON.stringify({
      version: "3",
      roleGroup: "client",
      done: false,
      visible: false,
      stepIndex: 1,
      validatedKeys: ["terminal"],
    }));
  });

  await seedClientSession(page);
  await page.goto("/connections", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#username")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('#txt-global-nav[data-hydrated="1"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#global-guide-connections-hero")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("dialog", { name: "Walkthrough global TXT" })).toHaveCount(0);

  await page.getByRole("button", { name: "Walkthrough", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Walkthrough global TXT" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText("Raccorde ensuite tes connexions", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText("etape 2/3", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Recommencer", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Mettre le walkthrough en pause" }).click();
  await expect(page.getByRole("dialog", { name: "Walkthrough global TXT" })).toHaveCount(0);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('#txt-global-nav[data-hydrated="1"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("dialog", { name: "Walkthrough global TXT" })).toHaveCount(0);

  await page.getByRole("button", { name: "Walkthrough", exact: true }).click();

  const resumedDialog = page.getByRole("dialog", { name: "Walkthrough global TXT" });
  await expect(resumedDialog).toBeVisible({ timeout: 30_000 });
  await expect(resumedDialog.getByText("Raccorde ensuite tes connexions", { exact: true })).toBeVisible();
  await expect(resumedDialog.getByText("etape 2/3", { exact: false })).toBeVisible();
});