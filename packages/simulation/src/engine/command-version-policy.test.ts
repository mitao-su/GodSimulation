import { describe, expect, it } from "vitest";

import { simulationTestWorld, testPlugin } from "../testing/simulation-test-fixtures";
import { createSimulation } from "./simulation-engine";

function engine() {
  return createSimulation({
    worldDefinition: simulationTestWorld().map,
    plugins: [testPlugin],
    reviewRequired: true,
    seed: 1,
    pluginLockHash: "a".repeat(64),
  });
}

describe("world command version policy", () => {
  it("applies an idempotent review setting from a stale browser view", () => {
    const simulation = engine();
    const view = simulation.getView();
    simulation.dispatch({
      schemaVersion: 1,
      commandId: "command:review:stale" as never,
      worldId: view.worldId,
      expectedWorldVersion: view.worldVersion - 1,
      issuedAtRealTime: "2026-08-31T00:00:00.000Z",
      type: "set_review_mode",
      enabled: false,
    });

    expect(() => simulation.tick()).not.toThrow();
    expect(simulation.getView().reviewRequired).toBe(false);
  });

  it("keeps release commands bound to the exact frozen world version", () => {
    const simulation = engine();
    const view = simulation.getView();
    simulation.dispatch({
      schemaVersion: 1,
      commandId: "command:release:stale" as never,
      worldId: view.worldId,
      expectedWorldVersion: view.worldVersion - 1,
      issuedAtRealTime: "2026-08-31T00:00:00.000Z",
      type: "release_execution",
    });

    expect(() => simulation.tick()).toThrow(/expected world version/);
  });
});
