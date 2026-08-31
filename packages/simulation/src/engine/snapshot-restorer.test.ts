import { describe, expect, it } from "vitest";

import type { WorldSnapshotV1 } from "@god-sim/protocol";

import { simulationTestWorld, testPlugin } from "../testing/simulation-test-fixtures";
import { createSimulation, restoreSimulation } from "./simulation-engine";

function allSubjectiveSourceIds(stateValue: unknown): Set<string> {
  const state = stateValue as {
    agents: Array<{
      knowledge: {
        objects: Array<{ sourceEventId: string }>;
        agents: Array<{ sourceEventId: string }>;
        knownTraversalBlockers: Array<{ sourceEventId: string }>;
      };
      memories: Array<{ sourceEventId: string }>;
    }>;
  };
  return new Set(
    state.agents.flatMap((agent) => [
      ...agent.knowledge.objects.map((value) => value.sourceEventId),
      ...agent.knowledge.agents.map((value) => value.sourceEventId),
      ...agent.knowledge.knownTraversalBlockers.map((value) => value.sourceEventId),
      ...agent.memories.map((value) => value.sourceEventId),
    ]),
  );
}

function legacySnapshot(): WorldSnapshotV1 {
  const engine = createSimulation({
    worldDefinition: simulationTestWorld().map,
    plugins: [testPlugin],
    reviewRequired: true,
    seed: 1,
    pluginLockHash: "a".repeat(64),
  });
  const current = engine.createSnapshot();
  const state = structuredClone(current.state) as {
    agents: Array<{
      id: string;
      currentGoal: unknown;
      actionPlan: unknown;
      knowledge: {
        knownTraversalBlockers?: unknown;
        knownLockedDoorIds?: string[];
      };
    }>;
  };
  for (const agent of state.agents) {
    delete agent.knowledge.knownTraversalBlockers;
    agent.knowledge.knownLockedDoorIds =
      agent.id === "alice" ? ["wall-1"] : [];
  }
  const alice = state.agents.find((agent) => agent.id === "alice");
  if (!alice) throw new Error("Missing Alice in legacy fixture");
  const goal = {
    kind: "use_object",
    targetEntityId: "fridge-1",
    interactionId: "use",
  };
  alice.currentGoal = { id: "goal:legacy", goal, label: "Use fridge" };
  alice.actionPlan = {
    goalId: "goal:legacy",
    goal,
    currentActionIndex: 0,
    actions: [
      {
        id: "goal:legacy:action:0",
        goalId: "goal:legacy",
        kind: "open_object",
        targetEntityId: "wall-1",
        interactionId: "open",
        durationTicks: 2,
        progressTicks: 1,
        slots: ["HANDS"],
        started: true,
      },
    ],
  };
  return {
    schemaVersion: 1,
    worldId: current.worldId,
    worldVersion: current.worldVersion,
    worldTick: current.worldTick,
    lastEventSequence: current.lastEventSequence,
    pluginLockHash: current.pluginLockHash,
    state: state as never,
  };
}

describe("simulation snapshot restoration", () => {
  it("projects every strict subjective source into causalEventIds", () => {
    const engine = createSimulation({
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
      reviewRequired: true,
      seed: 1,
      pluginLockHash: "a".repeat(64),
    });
    const snapshot = engine.createSnapshot();

    expect(snapshot.schemaVersion).toBe(2);
    if (snapshot.schemaVersion !== 2) return;
    expect(snapshot.history).toEqual({ mode: "strict", causalFromSequence: 1 });
    expect(new Set(snapshot.causalEventIds)).toEqual(
      allSubjectiveSourceIds(snapshot.state),
    );
  });

  it("restores the complete frozen world without re-emitting persisted events", () => {
    const original = createSimulation({
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
      reviewRequired: true,
      seed: 1,
      pluginLockHash: "a".repeat(64),
    });
    const originalCheckpoint = original.prepareCheckpoint();
    expect(original.acknowledgeCheckpoint(originalCheckpoint.checkpointId).accepted)
      .toBe(true);
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
    expect(restored.prepareCheckpoint().events).toEqual([]);
  });

  it("restores older v2 knowledge with unknown interaction availability", () => {
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
        knowledge: {
          objects: Array<{ interactionAvailability?: unknown }>;
        };
      }>;
    };
    for (const agent of state.agents) {
      for (const object of agent.knowledge.objects) {
        delete object.interactionAvailability;
      }
    }

    const restored = restoreSimulation({
      snapshot: { ...snapshot, state: state as never },
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
    });
    const restoredState = restored.createSnapshot().state as {
      agents: Array<{
        id: string;
        knowledge: {
          objects: Array<{ entityId: string; interactionAvailability: unknown[] }>;
        };
      }>;
    };

    const alice = restoredState.agents.find((agent) => agent.id === "alice");
    expect(
      alice?.knowledge.objects.find((object) => object.entityId === "fridge-1")
        ?.interactionAvailability,
    ).toEqual([]);
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

  it("restores v1 furniture actions and locked-door knowledge as legacy generic state", () => {
    const legacy = legacySnapshot();
    const restored = restoreSimulation({
      snapshot: legacy,
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
    });
    const next = restored.createSnapshot();

    expect(next).toMatchObject({
      schemaVersion: 2,
      history: {
        mode: "legacy",
        causalFromSequence: legacy.lastEventSequence + 1,
      },
      causalEventIds: [],
    });
    const state = next.state as {
      agents: Array<{
        id: string;
        actionPlan: { actions: unknown[] } | null;
        knowledge: { knownTraversalBlockers: unknown[] };
      }>;
    };
    const alice = state.agents.find((agent) => agent.id === "alice")!;
    expect(alice.actionPlan?.actions[0]).toMatchObject({
      kind: "interact_object",
      purpose: "automatic_traversal",
      targetEntityId: "wall-1",
    });
    expect(alice.knowledge.knownTraversalBlockers).toEqual([
      {
        entityId: "wall-1",
        observedObjectVersion: 0,
        reasonCode: "legacy_locked_door",
        sourceEventId: "event:legacy-locked-door:alice:wall-1",
      },
    ]);
  });
});
