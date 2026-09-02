import { describe, expect, it } from "vitest";

import {
  SimulationRulesLockSchema,
  WorldSnapshotV2Schema,
  type WorldSnapshotV1,
} from "@god-sim/protocol";

import {
  simulationTestWorld,
  testPlugin,
  testSimulationRulesLock,
} from "../testing/simulation-test-fixtures";
import { createSimulation, restoreSimulation } from "./simulation-engine";

interface MutableTaskOption {
  readonly id: string;
  readonly label: string;
  readonly operationId?: string;
  readonly [key: string]: unknown;
}

interface MutablePromptInput {
  activeTasks?: unknown;
  taskOptions?: MutableTaskOption[];
  goalOptions?: MutableTaskOption[];
  [key: string]: unknown;
}

interface MutableDecisionRequest {
  readonly agentId: string;
  promptInput: MutablePromptInput;
  acceptedProposal: unknown;
  [key: string]: unknown;
}

interface MutableDecisionCycle {
  requests: MutableDecisionRequest[];
  [key: string]: unknown;
}

interface MutableAgentState {
  id: string;
  currentGoal: unknown;
  actionPlan: unknown;
  bodySlots: unknown;
  knowledge: Record<string, unknown>;
  taskTracks?: unknown;
  activeOperations?: unknown;
  [key: string]: unknown;
}

interface MutableSnapshotState {
  stateSchemaVersion?: number;
  map: Record<string, unknown>;
  agents: MutableAgentState[];
  decisionCycle: MutableDecisionCycle | null;
  [key: string]: unknown;
}

function singleGoalStateFromCurrent(stateValue: unknown): MutableSnapshotState {
  const state = structuredClone(stateValue) as MutableSnapshotState;
  delete state.stateSchemaVersion;
  state.agents = state.agents.map((agent) => {
    const stable = { ...agent };
    delete stable.taskTracks;
    delete stable.activeOperations;
    return {
      ...stable,
      currentGoal: null,
      actionPlan: null,
      bodySlots: { HEAD: null, HANDS: null, BODY: null },
    };
  });
  if (state.decisionCycle !== null) {
    state.decisionCycle.requests = state.decisionCycle.requests.map(
      (request) => {
        const wait = request.promptInput.taskOptions?.find(
          (option) => option.operationId === "core.wait",
        );
        if (!wait) throw new Error("Missing wait option in current snapshot fixture");
        const stablePrompt = { ...request.promptInput };
        delete stablePrompt.activeTasks;
        delete stablePrompt.taskOptions;
        return {
          ...request,
          promptInput: {
            ...stablePrompt,
            currentGoal: null,
            goalOptions: [
              {
                id: wait.id,
                label: wait.label,
                goal: { kind: "wait", durationTicks: 600 },
              },
            ],
          },
          acceptedProposal: null,
        };
      },
    );
  }
  return state;
}

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
    simulationRulesLock: testSimulationRulesLock,
  });
  const current = engine.createSnapshot();
  const state = singleGoalStateFromCurrent(current.state) as {
    map: { rules?: unknown };
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
  delete state.map.rules;
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
  it("adopts the supplied rule lock when migrating a version-two snapshot", () => {
    const original = createSimulation({
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
      reviewRequired: true,
      seed: 1,
      pluginLockHash: "a".repeat(64),
      simulationRulesLock: testSimulationRulesLock,
    });
    const legacyValue = structuredClone(original.createSnapshot()) as Record<string, unknown>;
    delete legacyValue.simulationRulesLock;
    const legacyState = legacyValue.state as { map: { rules?: unknown } };
    delete legacyState.map.rules;
    const legacySnapshot = WorldSnapshotV2Schema.parse({
      ...legacyValue,
      schemaVersion: 2,
    });

    const restored = restoreSimulation({
      snapshot: legacySnapshot,
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
      simulationRulesLock: testSimulationRulesLock,
    });

    expect(restored.createSnapshot()).toMatchObject({
      schemaVersion: 3,
      simulationRulesLock: testSimulationRulesLock,
    });
  });

  it.each([
    {
      name: "hash",
      configuredLock: SimulationRulesLockSchema.parse({
        ...testSimulationRulesLock,
        hash: "d".repeat(64),
      }),
    },
    {
      name: "normalized rule content",
      configuredLock: SimulationRulesLockSchema.parse({
        ...testSimulationRulesLock,
        rules: {
          ...testSimulationRulesLock.rules,
          time: {
            ...testSimulationRulesLock.rules.time,
            secondsPerGameTick: 12,
          },
        },
      }),
    },
  ])("rejects a version-three snapshot with mismatched $name", ({ configuredLock }) => {
    const original = createSimulation({
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
      reviewRequired: true,
      seed: 1,
      pluginLockHash: "a".repeat(64),
      simulationRulesLock: testSimulationRulesLock,
    });
    const currentSnapshot = {
      ...original.createSnapshot(),
      schemaVersion: 3,
      simulationRulesLock: testSimulationRulesLock,
    } as never;

    expect(() =>
      restoreSimulation({
        snapshot: currentSnapshot,
        worldDefinition: simulationTestWorld().map,
        plugins: [testPlugin],
        simulationRulesLock: configuredLock,
      }),
    ).toThrow("Snapshot simulation rules do not match the configured rule lock");
  });

  it("projects every strict subjective source into causalEventIds", () => {
    const engine = createSimulation({
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
      reviewRequired: true,
    seed: 1,
    pluginLockHash: "a".repeat(64),
    simulationRulesLock: testSimulationRulesLock,
    });
    const snapshot = engine.createSnapshot();

    expect(snapshot.schemaVersion).toBe(3);
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
    simulationRulesLock: testSimulationRulesLock,
    });
    const originalCheckpoint = original.prepareCheckpoint();
    expect(original.acknowledgeCheckpoint(originalCheckpoint.checkpointId).accepted)
      .toBe(true);
    const snapshot = original.createSnapshot();

    const restored = restoreSimulation({
      snapshot,
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
      simulationRulesLock: testSimulationRulesLock,
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
    simulationRulesLock: testSimulationRulesLock,
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
      simulationRulesLock: testSimulationRulesLock,
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
    simulationRulesLock: testSimulationRulesLock,
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
      simulationRulesLock: testSimulationRulesLock,
    });

    expect(restored.getView().pendingDecisions).toContainEqual(
      expect.objectContaining({
        requestId: request.requestId,
        status: "error",
        error: failure,
      }),
    );
  });

  it("restores a generic object interaction as one compatibility operation", () => {
    const original = createSimulation({
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
      reviewRequired: true,
    seed: 1,
    pluginLockHash: "a".repeat(64),
    simulationRulesLock: testSimulationRulesLock,
    });
    const snapshot = original.createSnapshot();
    const state = singleGoalStateFromCurrent(snapshot.state) as {
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
      simulationRulesLock: testSimulationRulesLock,
    });

    const nextState = restored.createSnapshot().state as {
      stateSchemaVersion: number;
      agents: Array<{
        id: string;
        taskTracks: { BODY: { kind: string; callId?: string } };
        activeOperations: Array<{
          operationId: string;
          label: string;
          progressTicks: number;
          plan: { currentActionIndex: number; actions: unknown[] };
        }>;
      }>;
    };
    const restoredAlice = nextState.agents.find((agent) => agent.id === "alice")!;
    expect(nextState.stateSchemaVersion).toBe(2);
    expect(restoredAlice.taskTracks.BODY.kind).toBe("operation");
    expect(restoredAlice.activeOperations).toEqual([
      expect.objectContaining({
        operationId: "legacy.goal",
        label: "Use fridge",
        progressTicks: 3,
        plan: expect.objectContaining({
          currentActionIndex: 0,
          actions: [
            expect.objectContaining({
              kind: "interact_object",
              purpose: "direct",
              targetEntityId: "fridge-1",
              progressTicks: 3,
            }),
          ],
        }),
      }),
    ]);
  });

  it("migrates an accepted legacy goal into a complete two-track decision", () => {
    const original = createSimulation({
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
      reviewRequired: true,
      seed: 1,
      pluginLockHash: "a".repeat(64),
      simulationRulesLock: testSimulationRulesLock,
    });
    const snapshot = original.createSnapshot();
    const state = singleGoalStateFromCurrent(snapshot.state);
    const aliceRequest = state.decisionCycle?.requests.find(
      (request) => request.agentId === "alice",
    );
    if (!aliceRequest) throw new Error("Missing Alice legacy decision fixture");
    const wait = aliceRequest.promptInput.goalOptions?.[0];
    if (!wait) throw new Error("Missing legacy wait option");
    aliceRequest.acceptedProposal = {
      schemaVersion: 1,
      goalOptionId: wait.id,
      reason: "Wait",
    };

    const restored = restoreSimulation({
      snapshot: { ...snapshot, state: state as never },
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
      simulationRulesLock: testSimulationRulesLock,
    });
    const nextState = restored.createSnapshot().state as MutableSnapshotState;
    const restoredRequest = nextState.decisionCycle?.requests.find(
      (request) => request.agentId === "alice",
    );
    if (!restoredRequest) throw new Error("Missing restored Alice decision");

    expect(restoredRequest.promptInput.activeTasks).toEqual({
      tracks: { HEAD: null, BODY: null },
      operations: [],
    });
    expect(restoredRequest.promptInput.taskOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "empty", taskSlots: ["HEAD"] }),
        expect.objectContaining({ kind: "empty", taskSlots: ["BODY"] }),
        expect.objectContaining({
          kind: "operation",
          id: wait.id,
          operationId: "legacy.goal",
          taskSlots: ["BODY"],
        }),
      ]),
    );
    expect(restoredRequest.acceptedProposal).toEqual({
      schemaVersion: 2,
      head: { kind: "continue" },
      body: {
        kind: "replace",
        taskOptionId: wait.id,
        arguments: {},
      },
      reason: "Wait",
    });
  });

  it("restores v1 furniture actions and locked-door knowledge as legacy generic state", () => {
    const legacy = legacySnapshot();
    const restored = restoreSimulation({
      snapshot: legacy,
      worldDefinition: simulationTestWorld().map,
      plugins: [testPlugin],
      simulationRulesLock: testSimulationRulesLock,
    });
    const next = restored.createSnapshot();

    expect(next).toMatchObject({
      schemaVersion: 3,
      history: {
        mode: "legacy",
        causalFromSequence: legacy.lastEventSequence + 1,
      },
      causalEventIds: [],
    });
    const state = next.state as {
      agents: Array<{
        id: string;
        activeOperations: Array<{ plan: { actions: unknown[] } }>;
        knowledge: { knownTraversalBlockers: unknown[] };
      }>;
    };
    const alice = state.agents.find((agent) => agent.id === "alice")!;
    expect(alice.activeOperations[0]?.plan.actions[0]).toMatchObject({
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
