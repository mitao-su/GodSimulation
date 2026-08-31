import { expect, test } from "@playwright/test";

import {
  countNonBackgroundCanvasPixels,
  inspectNonBackgroundCanvasPixels,
} from "./canvas-pixels";
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

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => countNonBackgroundCanvasPixels(page)).toBeGreaterThan(1_000);

  const phoneLayout = await page.evaluate(() => {
    const canvasBounds = document.querySelector("canvas")?.getBoundingClientRect();
    const horizontallyClippedControls = [
      ...document.querySelectorAll("button, label, [role='tab']"),
    ]
      .filter((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== "none" && bounds.width > 0 && bounds.height > 0;
      })
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left < -1 || bounds.right > innerWidth + 1;
      })
      .map((element) => (element.getAttribute("aria-label") || element.textContent || "").trim());

    return {
      canvasBounds: canvasBounds
        ? { left: canvasBounds.left, right: canvasBounds.right, width: canvasBounds.width }
        : null,
      documentWidth: document.documentElement.scrollWidth,
      horizontallyClippedControls,
      viewportWidth: innerWidth,
    };
  });

  expect.soft(phoneLayout.documentWidth).toBeLessThanOrEqual(phoneLayout.viewportWidth + 1);
  expect.soft(phoneLayout.horizontallyClippedControls).toEqual([]);
  expect.soft(phoneLayout.canvasBounds).not.toBeNull();
  expect.soft(phoneLayout.canvasBounds!.left).toBeGreaterThanOrEqual(-1);
  expect.soft(phoneLayout.canvasBounds!.right).toBeLessThanOrEqual(phoneLayout.viewportWidth + 1);
  expect.soft(phoneLayout.canvasBounds!.width).toBeLessThanOrEqual(phoneLayout.viewportWidth + 1);

  const phoneCanvas = await inspectNonBackgroundCanvasPixels(page);
  expect.soft(phoneCanvas.leftMargin).toBeGreaterThanOrEqual(8);
  expect.soft(phoneCanvas.rightMargin).toBeGreaterThanOrEqual(8);
  expect.soft(phoneCanvas.topMargin).toBeGreaterThanOrEqual(8);
  expect.soft(phoneCanvas.bottomMargin).toBeGreaterThanOrEqual(8);

  await page.getByText("决策审查", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText("决策审查", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "感知" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("tab", { name: "感知" })).toBeVisible();
  await page.getByRole("button", { name: "放行世界" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "放行世界" })).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("workbench-390x844.png"),
  });

  expect(runtimeErrors).toEqual([]);
});
