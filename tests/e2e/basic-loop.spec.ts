import { expect, test } from "@playwright/test";

import { type WorldView } from "@god-sim/protocol";

import {
  countNonBackgroundCanvasPixels,
  inspectNonBackgroundCanvasPixels,
  readWorldTilePixels,
} from "./canvas-pixels";
import { collectRuntimeErrors, inspectWorkbenchLayout } from "./page-quality";
import { launchTestApp, type RunningTestApp } from "./test-app";

let app: RunningTestApp;

test.beforeEach(async () => {
  app = await launchTestApp("basic-loop", 4_411);
});

test.afterEach(async () => {
  await app?.stop();
});

test("zooms and pans the apartment without advancing the world", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto(app.url);
  await expect(page.getByText("决策等待放行", { exact: true })).toBeVisible();
  await expect.poll(() => countNonBackgroundCanvasPixels(page)).toBeGreaterThan(1_000);

  const getWorld = async () => {
    const response = await page.request.get(app.url + "/api/world");
    expect(response.ok()).toBe(true);
    return await response.json() as WorldView;
  };
  const world = await getWorld();
  const bob = world.entities.find(({ entityId }) => entityId === "bob");
  if (!bob) throw new Error("Starter Home is missing Bob");
  const canvas = page.locator("canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Missing world canvas");
  const pixels = () => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  const overview = await pixels();
  const { leftMargin, rightMargin } = await inspectNonBackgroundCanvasPixels(page);
  const cell = (bounds.width - leftMargin - rightMargin) / world.map.width * 1.5;
  const fit = page.getByRole("button", { name: "适应窗口" });
  const bobButton = page.getByRole("button", { name: /^Bob/ });
  await expect(fit).toBeDisabled();
  await expect(bobButton).toHaveAttribute("data-selected", "false");

  await page.getByRole("button", { name: "放大地图" }).click();
  await expect(fit).toBeEnabled();
  await expect.poll(async () => await pixels() !== overview).toBe(true);
  const zoomed = await pixels();
  // 在角色身上开始拖动，确认移动的是相机而不是选中项。
  const x = bounds.x + bounds.width / 2 + (bob.position.x + 0.5 - world.map.width / 2) * cell;
  const y = bounds.y + bounds.height / 2 + (bob.position.y + 0.42 - world.map.height / 2) * cell;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 56, y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => await pixels() !== zoomed).toBe(true);
  await expect(bobButton).toHaveAttribute("data-selected", "false");
  await page.mouse.click(x + 56, y);
  await expect(bobButton).toHaveAttribute("data-selected", "true");

  const panned = await pixels();
  await page.getByRole("region", { name: "地图视野" }).press("ArrowDown");
  await expect.poll(async () => await pixels() !== panned).toBe(true);
  await fit.click();
  await expect.poll(async () => await pixels() === overview).toBe(true);
  expect((await getWorld()).worldVersion).toBe(world.worldVersion);
  expect(runtimeErrors).toEqual([]);
});

test("runs the semantic move and interaction loop", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const agentStatuses = new Set<string>();
  let interactionPose: WorldView["entities"][number] | undefined;
  page.on("websocket", (socket) => {
    if (!socket.url().endsWith("/api/events")) return;
    socket.on("framereceived", ({ payload }) => {
      const view = JSON.parse(payload.toString()) as WorldView;
      for (const entity of view.entities) {
        if (entity.kind !== "agent") continue;
        agentStatuses.add(entity.status);
        if (entity.status === "interact_object") interactionPose ??= entity;
      }
    });
  });
  const getWorld = async () => {
    const response = await page.request.get(app.url + "/api/world");
    expect(response.ok()).toBe(true);
    return await response.json() as WorldView;
  };

  await page.goto(app.url);

  await expect(page.getByText("决策等待放行", { exact: true })).toBeVisible();
  await expect(page.getByText("Alice", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Bob", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "放行世界" })).toBeEnabled();
  await expect.poll(() => countNonBackgroundCanvasPixels(page)).toBeGreaterThan(1_000);
  const before = await getWorld();
  const fridge = before.entities.find(({ entityId }) => entityId === "fridge-1");
  if (!fridge) throw new Error("Starter Home is missing its refrigerator");
  expect(fridge.facing).toBe("west");
  const front = { x: fridge.position.x - 1, y: fridge.position.y };
  const doorway = before.entities.find(({ entityId }) => entityId === "door-living-kitchen");
  if (!doorway) throw new Error("Starter Home is missing its kitchen door");
  expect(doorway.status).toBe("closed");
  const closedDoorPixels = await readWorldTilePixels(page, doorway.position, before.map);

  await page.getByRole("button", { name: "放行世界" }).click();

  await expect(
    page.getByRole("main").getByText("Move to Refrigerator completed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("决策等待放行", { exact: true })).toBeVisible();
  const after = await getWorld();
  expect(after.entities).toContainEqual(expect.objectContaining({
    kind: "agent",
    position: front,
  }));
  expect(after.entities.find(({ entityId }) => entityId === doorway.entityId))
    .toMatchObject({ status: "open" });
  await expect.poll(async () => {
    const openDoorPixels = await readWorldTilePixels(page, doorway.position, before.map);
    return openDoorPixels.filter((value, index) => value !== closedDoorPixels[index]).length;
  }).toBeGreaterThan(20);
  expect(agentStatuses.has("move")).toBe(true);
  await page.getByRole("button", { name: "放行世界" }).click();
  await expect(page.getByText("Use refrigerator", { exact: true }).first()).toBeVisible();
  await expect.poll(() => interactionPose).toMatchObject({ position: front, facing: "east" });

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
