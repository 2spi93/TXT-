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

test("global walkthrough progression requires validate before next and advances to the next page", async ({ page }) => {
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

  await page.getByRole("button", { name: "Walkthrough", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Walkthrough global TXT" });
  const nextButton = dialog.getByRole("button", { name: "Suivant", exact: true });
  const validateButton = dialog.getByRole("button", { name: "Valider l'etape", exact: true });

  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText("Raccorde ensuite tes connexions", { exact: true })).toBeVisible();
  await expect(dialog.getByText("etape 2/3", { exact: false })).toBeVisible();
  await expect(nextButton).toBeDisabled();

  await validateButton.click();

  await expect(dialog.getByText("Etape validee. Passe a la suite.", { exact: true })).toBeVisible();
  await expect(nextButton).toBeEnabled();

  await nextButton.click();

  await page.waitForURL("**/learn", { timeout: 30_000 });
  await expect(dialog.getByText("Finis par Learn pour monter en autonomie", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText("etape 3/3", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Valider l'etape", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Suivant", exact: true })).toBeDisabled();

  const persisted = await page.evaluate(() => window.localStorage.getItem("txt.global.walkthrough.state.v1"));
  expect(persisted).toContain('"stepIndex":2');
  expect(persisted).toContain('"validatedKeys":["terminal","connections"]');
});