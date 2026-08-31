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

  it("restores a generic object interaction and projects its plugin display name", () => {
    const original = createSimulation({
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
      reviewRequired: true,
      seed: 1,
      pluginLockHash: "a".repeat(64),
    });
    const snapshot = original.createSnapshot();
    const state = structuredClone(snapshot.state) as {
      agents: Array<{
        id: string;
        currentGoal: unknown;
        actionPlan: unknown;
      }>;
    };
    const alice = state.agents.find((agent) => agent.id === "alice");
    if (!alice) throw new Error("Missing Alice in snapshot fixture");
    const goal = {
      kind: "use_object",
      targetEntityId: "fridge-1",
      interactionId: "use",
    };
    alice.currentGoal = { id: "goal:alice:test", goal, label: "Use fridge" };
    alice.actionPlan = {
      goalId: "goal:alice:test",
      goal,
      currentActionIndex: 0,
      actions: [
        {
          id: "goal:alice:test:action:0",
          goalId: "goal:alice:test",
          kind: "interact_object",
          purpose: "goal",
          targetEntityId: "fridge-1",
          interactionId: "use",
          durationTicks: 10,
          progressTicks: 3,
          slots: ["HANDS", "BODY"],
          started: true,
        },
      ],
    };

    const restored = restoreSimulation({
      snapshot: { ...snapshot, state: state as never },
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
    });

    expect(restored.createSnapshot()).toEqual({ ...snapshot, state });
    expect(restored.getView().agents.find((agent) => agent.agentId === "alice")?.actionLabel)
      .toBe("Use fridge");
  });
});
