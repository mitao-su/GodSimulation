import { expect, test } from "@playwright/test";

import { type WorldView } from "@god-sim/protocol";

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
  let interactionPose: WorldView["entities"][number] | undefined;
  page.on("websocket", (socket) => {
    if (!socket.url().endsWith("/api/events")) return;
    socket.on("framereceived", ({ payload }) => {
      const view = JSON.parse(payload.toString()) as WorldView;
      interactionPose ??= view.entities.find(
        ({ entityId, status }) => entityId === "alice" && status === "interact_object",
      );
    });
  });
  const release = page.getByRole("button", { name: "放行世界" });
  const bladderValue = page
    .locator(".detail-list div")
    .filter({ hasText: "内急状态" })
    .locator("dd");
  const decisionStatus = page.locator(".decision-banner__copy");

  await page.goto(app.url);
  await expect(page.getByText("决策等待放行", { exact: true })).toBeVisible();
  await expect(release).toBeEnabled();
  await release.click();

  await expect(
    decisionStatus.getByText("Bladder need became urgent", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("角色思考中")).toBeVisible();
  await expect(bladderValue).toHaveText("urgent");
  await expect(release).toBeEnabled();
  await release.click();

  await expect(page.getByText("Move to Toilet completed", { exact: true })).toBeVisible();
  await expect(release).toBeEnabled();
  const response = await page.request.get(app.url + "/api/world");
  expect(response.ok()).toBe(true);
  const { entities } = await response.json() as WorldView;
  const toilet = entities.find(({ entityId }) => entityId === "toilet-1");
  if (!toilet) throw new Error("Starter Home is missing its toilet");
  expect(toilet.facing).toBe("west");
  const front = { x: toilet.position.x - 1, y: toilet.position.y };
  expect(entities.find(({ entityId }) => entityId === "alice")).toMatchObject({ position: front });
  await release.click();
  await expect(page.getByText("Use toilet", { exact: true }).first()).toBeVisible();
  await expect.poll(() => interactionPose).toMatchObject({ position: front, facing: "east" });
  await expect
    .poll(
      async () => {
        if (await release.isEnabled()) await release.click();
        return bladderValue.textContent();
      },
      { timeout: 15_000 },
    )
    .toBe("comfortable");
  expect(runtimeErrors).toEqual([]);
});
