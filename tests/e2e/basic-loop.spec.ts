import { expect, test } from "@playwright/test";

import { countNonBackgroundCanvasPixels } from "./canvas-pixels";
import { collectRuntimeErrors, inspectWorkbenchLayout } from "./page-quality";
import { launchTestApp, type RunningTestApp } from "./test-app";

let app: RunningTestApp;

test.beforeAll(async () => {
  app = await launchTestApp("basic-loop", 4_411);
});

test.afterAll(async () => {
  await app?.stop();
});

test("runs the perception-conflict decision loop", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto(app.url);

  await expect(page.getByText("角色思考中")).toBeVisible();
  await expect(page.getByText("Alice", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Bob", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "放行世界" })).toBeEnabled();
  await page.getByRole("button", { name: "放行世界" }).click();

  await expect(page.getByText(/Refrigerator used by bob.*current goal/i)).toBeVisible();
  await expect(page.getByText("角色思考中")).toBeVisible();

  for (const viewport of [
    { width: 1_280, height: 720 },
    { width: 960, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => countNonBackgroundCanvasPixels(page)).toBeGreaterThan(1_000);
    expect(await inspectWorkbenchLayout(page)).toEqual({
      clippedControls: [],
      overlappingRegions: [],
      viewportOverflow: false,
    });
    await page.screenshot({
      path: testInfo.outputPath(`workbench-${viewport.width}x${viewport.height}.png`),
    });
  }
  expect(runtimeErrors).toEqual([]);
});
