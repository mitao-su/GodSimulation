import { describe, expect, it } from "vitest";

import { simulationTestWorld, testPlugin } from "../testing/simulation-test-fixtures";
import { createSimulation, restoreSimulation } from "./simulation-engine";

describe("simulation snapshot restoration", () => {
  it("restores the complete frozen world without re-emitting persisted events", () => {
    const original = createSimulation({
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
      reviewRequired: true,
      seed: 1,
      pluginLockHash: "a".repeat(64),
    });
    original.drainEvents();
    const snapshot = original.createSnapshot();

    const restored = restoreSimulation({
      snapshot,
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
    });

    expect(restored.createSnapshot()).toEqual(snapshot);
    expect(restored.getPendingDecisionInputs()).toEqual(
      original.getPendingDecisionInputs(),
    );
    expect(restored.drainEvents()).toEqual([]);
  });
});
