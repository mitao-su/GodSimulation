import { expect, test } from "@playwright/test";

import { collectRuntimeErrors } from "./page-quality";
import { launchTestApp, type RunningTestApp } from "./test-app";

let app: RunningTestApp;

test.beforeAll(async () => {
  app = await launchTestApp("review-mode", 4_413);
});

test.afterAll(async () => {
  await app?.stop();
});

test("runs automatically only while decision review is disabled", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const review = page.getByRole("checkbox", { name: "决策审查" });
  const worldTick = page.locator(".header-metric").filter({ hasText: "世界时间" }).locator("strong");

  await page.goto(app.url);
  await expect(page.getByText("决策等待放行", { exact: true })).toBeVisible();
  await review.click();
  await expect(review).not.toBeChecked();

  await expect(page.getByText("运行中", { exact: true })).toBeVisible();
  await expect.poll(async () => Number(await worldTick.textContent())).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "放行世界" })).toBeDisabled();

  await review.click();
  await expect(review).toBeChecked();
  await expect(page.getByText("等待放行", { exact: true })).toBeVisible({ timeout: 8_000 });
  expect(runtimeErrors).toEqual([]);
});
