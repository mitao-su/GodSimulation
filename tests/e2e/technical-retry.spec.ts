import { expect, test } from "@playwright/test";

import { collectRuntimeErrors } from "./page-quality";
import { launchTestApp, type RunningTestApp } from "./test-app";

let app: RunningTestApp;

test.beforeAll(async () => {
  app = await launchTestApp("technical-retry", 4_414);
});

test.afterAll(async () => {
  await app?.stop();
});

test("shows a model failure and retries only the failed request", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto(app.url);
  const failure = page.getByRole("group", { name: "Alice 决策错误" });
  await expect(failure).toBeVisible();
  await expect(failure.getByText("Alice", { exact: true })).toBeVisible();
  await expect(failure.getByText("模型", { exact: true })).toBeVisible();
  await expect(failure.locator(".decision-error__request")).not.toHaveText("");
  await expect(failure.getByText("Deterministic model outage", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "重试 Alice 的决策" }).click();

  await expect(failure).toHaveCount(0);
  await expect(page.getByText("等待放行", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "放行世界" })).toBeEnabled();
  expect(runtimeErrors).toEqual([]);
});
