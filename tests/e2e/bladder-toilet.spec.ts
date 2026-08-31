import { expect, test } from "@playwright/test";

import { collectRuntimeErrors } from "./page-quality";
import { launchTestApp, type RunningTestApp } from "./test-app";

let app: RunningTestApp;

test.beforeAll(async () => {
  app = await launchTestApp("bladder-toilet", 4_412);
});

test.afterAll(async () => {
  await app?.stop();
});

test("rethinks at the urgent threshold and completes toilet use", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const release = page.getByRole("button", { name: "放行世界" });
  const bladderValue = page
    .locator(".detail-list div")
    .filter({ hasText: "内急状态" })
    .locator("dd");

  await page.goto(app.url);
  await expect(page.getByText("角色思考中")).toBeVisible();
  await expect(release).toBeEnabled();
  await release.click();

  await expect(page.getByText("Bladder need became urgent", { exact: true })).toBeVisible();
  await expect(page.getByText("角色思考中")).toBeVisible();
  await expect(bladderValue).toHaveText("urgent");
  await expect(release).toBeEnabled();
  await release.click();

  await expect(page.getByText("Use toilet", { exact: true }).first()).toBeVisible();
  await expect
    .poll(
      async () => {
        if (await release.isEnabled()) await release.click();
        return bladderValue.textContent();
      },
      { timeout: 8_000 },
    )
    .toBe("comfortable");
  expect(runtimeErrors).toEqual([]);
});
