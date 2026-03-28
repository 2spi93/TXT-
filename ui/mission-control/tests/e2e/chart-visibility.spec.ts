import { expect, test, type Page, type Locator } from "@playwright/test";

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
    throw new Error("Operator account requires password change before chart visibility test can run");
  }

  await page.goto("/terminal", { waitUntil: "domcontentloaded" });
}

async function analyzeChartScreenshot(page: Page, chart: Locator) {
  const screenshot = await chart.screenshot();
  return page.evaluate(async (encoded) => {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Unable to decode chart screenshot"));
    });
    image.src = `data:image/png;base64,${encoded}`;
    await loaded;

    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return { width: image.width, height: image.height, nonBackgroundPixels: 0, accentPixels: 0, colorBuckets: 0 };
    }

    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonBackgroundPixels = 0;
    let accentPixels = 0;
    let bullishPixels = 0;
    let bearishPixels = 0;
    const buckets = new Set<string>();

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      if (alpha < 150) {
        continue;
      }

      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      if (luminance > 26 || max - min > 20) {
        nonBackgroundPixels += 1;
      }
      if (max > 60 && max - min > 28) {
        accentPixels += 1;
        buckets.add(`${Math.floor(red / 32)}-${Math.floor(green / 32)}-${Math.floor(blue / 32)}`);
      }
      if (green > 110 && red < 150 && blue < 170) {
        bullishPixels += 1;
      }
      if (red > 140 && green < 130 && blue < 150) {
        bearishPixels += 1;
      }
    }

    return {
      width: canvas.width,
      height: canvas.height,
      nonBackgroundPixels,
      accentPixels,
      bullishPixels,
      bearishPixels,
      colorBuckets: buckets.size,
    };
  }, screenshot.toString("base64"));
}

test("@chart terminal chart keeps visible candles after auth refresh cycles", async ({ page }, testInfo) => {
  await loginIfRequired(page);

  const chart = page.locator(".chart-canvas-host").first();
  await chart.waitFor({ state: "visible", timeout: 45_000 });

  const signalChip = page.locator(".chart-system-chip, .chart-overlay-chip, .chart-system-badge").filter({
    hasText: /VWAP|Range|Liquidity/i,
  }).first();
  await expect(signalChip).toBeVisible({ timeout: 45_000 });

  await expect.poll(async () => {
    const stats = await analyzeChartScreenshot(page, chart);
    return stats.accentPixels;
  }, { timeout: 45_000, intervals: [1000, 2000, 3000] }).toBeGreaterThan(150);

  const finalStats = await analyzeChartScreenshot(page, chart);
  await chart.screenshot({ path: testInfo.outputPath("chart-visibility.png") });

  expect(finalStats.nonBackgroundPixels).toBeGreaterThan(1200);
  expect(finalStats.accentPixels).toBeGreaterThan(150);
  expect(finalStats.colorBuckets).toBeGreaterThan(5);
  expect(finalStats.bullishPixels + finalStats.bearishPixels).toBeGreaterThan(120);
});