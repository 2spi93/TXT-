import { expect, test } from "@playwright/test";

import { loginIfRequired } from "./helpers/terminal";

const REQUIRED_BLOCKS = [
  "Desk Header",
  "Routes IA disponibles",
  "Capacite machine",
  "Lancer une tache IA",
  "Modeles locaux",
  "Journal des taches IA",
] as const;

test("ai desk renders the institutional blocks for an authenticated operator", async ({ page }) => {
  test.setTimeout(120_000);

  await loginIfRequired(page, "/ai", "ai desk validation");

  await expect(page.getByText("AI Desk Institutionnelle").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Desk IA operationnel" })).toBeVisible({ timeout: 30_000 });
  for (const block of REQUIRED_BLOCKS) {
    await expect(page.getByText(block).first()).toBeVisible({ timeout: 30_000 });
  }
});