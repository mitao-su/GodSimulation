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

  it("assigns a legacy world-level model failure back to its decision request", () => {
    const original = createSimulation({
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
      reviewRequired: true,
      seed: 1,
      pluginLockHash: "a".repeat(64),
    });
    const request = original.getPendingDecisionInputs()[0]!;
    const failure = {
      id: `failure:model:${request.requestId}`,
      category: "model" as const,
      message: "Provider unavailable",
      requestId: request.requestId,
      retryable: true,
      occurredAtRealTime: "2026-08-31T00:00:00.000Z",
    };
    expect(original.reportDecisionFailure(failure).accepted).toBe(true);
    const snapshot = original.createSnapshot();
    const legacyState = structuredClone(snapshot.state) as {
      decisionCycle: { requests: Array<{ failure?: unknown }> };
      suspendedMode?: unknown;
    };
    delete legacyState.suspendedMode;
    for (const serializedRequest of legacyState.decisionCycle.requests) {
      delete serializedRequest.failure;
    }

    const restored = restoreSimulation({
      snapshot: { ...snapshot, state: legacyState as never },
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
    });

    expect(restored.getView().pendingDecisions).toContainEqual(
      expect.objectContaining({
        requestId: request.requestId,
        status: "error",
        error: failure,
      }),
    );
  });
});
