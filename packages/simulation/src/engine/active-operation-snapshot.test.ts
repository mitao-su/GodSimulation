import { describe, expect, it } from "vitest";

import {
  OperationCallIdSchema,
  OperationIdSchema,
  TaskOptionIdSchema,
} from "@god-sim/protocol";

import { projectWorldSnapshot } from "./snapshot-projector";
import { restoreWorldSnapshot } from "./snapshot-restorer";
import type { ActiveOperation } from "../execution/operation";
import {
  simulationTestWorld,
  testPluginRegistry,
  testSimulationRulesLock,
} from "../testing/simulation-test-fixtures";

function snapshotWithActiveWait() {
  const base = simulationTestWorld();
  const aliceId = "alice" as never;
  const alice = base.agents.get(aliceId)!;
  const callId = OperationCallIdSchema.parse("operation-call:test:restored-wait");
  const operation: ActiveOperation = {
    callId,
    operationId: OperationIdSchema.parse("core.wait"),
    taskOptionId: TaskOptionIdSchema.parse("task-option:alice:restored-wait"),
    label: "Wait",
    taskSlots: ["BODY"],
    arguments: { durationTicks: 9 },
    duration: { kind: "fixed", totalTicks: 9 },
    startedAtTick: 0,
    progressTicks: 3,
    accumulatedObservations: [],
    observationDeliveryCursor: 0,
    plan: {
      currentActionIndex: 0,
      actions: [
        {
          id: "operation-call:test:restored-wait:action:0",
          kind: "wait",
          durationTicks: 9,
          progressTicks: 3,
        },
      ],
    },
  };
  return {
    base,
    snapshot: projectWorldSnapshot({
      ...base,
      tick: 3,
      mode: "RUNNING",
      agents: new Map(base.agents).set(aliceId, {
        ...alice,
        taskTracks: {
          HEAD: { kind: "empty" },
          BODY: { kind: "operation", callId },
        },
        activeOperations: new Map([[callId, operation]]),
      }),
    }),
  };
}

interface MutableOperationSnapshot {
  operationId: string;
  taskSlots: string[];
  arguments: Record<string, unknown>;
  plan: { actions: Array<Record<string, unknown>> };
}

function mutableFirstOperation(snapshotValue: unknown): MutableOperationSnapshot {
  const snapshot = snapshotValue as {
    state: {
      agents: Array<{
        id: string;
        taskTracks: Record<string, unknown>;
        activeOperations: MutableOperationSnapshot[];
      }>;
    };
  };
  const alice = snapshot.state.agents.find((agent) => agent.id === "alice");
  const operation = alice?.activeOperations[0];
  if (!alice || !operation) throw new Error("Missing active wait fixture");
  return operation;
}

describe("active operation snapshot state", () => {
  it("creates agents with two empty tracks and no active calls", () => {
    const alice = simulationTestWorld().agents.get("alice" as never)!;

    expect(alice.taskTracks).toEqual({
      HEAD: { kind: "empty" },
      BODY: { kind: "empty" },
    });
    expect([...alice.activeOperations]).toEqual([]);
    expect(alice).not.toHaveProperty("currentGoal");
    expect(alice).not.toHaveProperty("actionPlan");
    expect(alice).not.toHaveProperty("bodySlots");
  });

  it("round-trips two independent active calls without changing identity or progress", () => {
    const base = simulationTestWorld();
    const aliceId = "alice" as never;
    const alice = base.agents.get(aliceId)!;
    const headCallId = OperationCallIdSchema.parse("operation-call:test:head");
    const bodyCallId = OperationCallIdSchema.parse("operation-call:test:body");
    const head: ActiveOperation = {
      callId: headCallId,
      operationId: OperationIdSchema.parse("core.observe"),
      taskOptionId: TaskOptionIdSchema.parse("task-option:alice:observe"),
      label: "Observe",
      taskSlots: ["HEAD"],
      arguments: { targetEntityId: "fridge-1" },
      duration: { kind: "fixed", totalTicks: 1 },
      startedAtTick: 2,
      progressTicks: 0,
      accumulatedObservations: [],
      observationDeliveryCursor: 0,
      plan: {
        currentActionIndex: 0,
        actions: [
          {
            id: "operation-call:test:head:action:0",
            kind: "observe",
            targetEntityId: "fridge-1" as never,
            durationTicks: 1,
            progressTicks: 0,
          },
        ],
      },
    };
    const body: ActiveOperation = {
      callId: bodyCallId,
      operationId: OperationIdSchema.parse("core.wait"),
      taskOptionId: TaskOptionIdSchema.parse("task-option:alice:wait"),
      label: "Wait",
      taskSlots: ["BODY"],
      arguments: { durationTicks: 9 },
      duration: { kind: "fixed", totalTicks: 9 },
      startedAtTick: 2,
      progressTicks: 3,
      accumulatedObservations: [],
      observationDeliveryCursor: 0,
      plan: {
        currentActionIndex: 0,
        actions: [
          {
            id: "operation-call:test:body:action:0",
            kind: "wait",
            durationTicks: 9,
            progressTicks: 3,
          },
        ],
      },
    };
    const world = {
      ...base,
      tick: 5,
      mode: "RUNNING" as const,
      agents: new Map(base.agents).set(aliceId, {
        ...alice,
        taskTracks: {
          HEAD: { kind: "operation" as const, callId: headCallId },
          BODY: { kind: "operation" as const, callId: bodyCallId },
        },
        activeOperations: new Map([
          [headCallId, head],
          [bodyCallId, body],
        ]),
      }),
    };

    const snapshot = projectWorldSnapshot(world);
    const restored = restoreWorldSnapshot(
      snapshot,
      testPluginRegistry,
      base.map,
      testSimulationRulesLock,
    );
    const restoredAlice = restored.agents.get(aliceId)!;

    expect(restoredAlice.taskTracks).toEqual(world.agents.get(aliceId)!.taskTracks);
    expect([...restoredAlice.activeOperations]).toEqual([
      [bodyCallId, body],
      [headCallId, head],
    ]);
    expect(snapshot.state).toMatchObject({ stateSchemaVersion: 2 });
  });

  it("round-trips a synchronized call as one operation referenced by both tracks", () => {
    const base = simulationTestWorld();
    const aliceId = "alice" as never;
    const alice = base.agents.get(aliceId)!;
    const callId = OperationCallIdSchema.parse("operation-call:test:sleep");
    const operation: ActiveOperation = {
      callId,
      operationId: OperationIdSchema.parse("test.synchronized_wait"),
      taskOptionId: TaskOptionIdSchema.parse("task-option:alice:sleep"),
      label: "Sleep",
      taskSlots: ["HEAD", "BODY"],
      arguments: { durationTicks: 100 },
      duration: { kind: "fixed", totalTicks: 100 },
      startedAtTick: 0,
      progressTicks: 7,
      accumulatedObservations: [],
      observationDeliveryCursor: 0,
      plan: {
        currentActionIndex: 0,
        actions: [
          {
            id: "operation-call:test:sleep:action:0",
            kind: "wait",
            durationTicks: 100,
            progressTicks: 7,
          },
        ],
      },
    };
    const world = {
      ...base,
      tick: 7,
      mode: "RUNNING" as const,
      agents: new Map(base.agents).set(aliceId, {
        ...alice,
        taskTracks: {
          HEAD: { kind: "operation" as const, callId },
          BODY: { kind: "operation" as const, callId },
        },
        activeOperations: new Map([[callId, operation]]),
      }),
    };

    const restored = restoreWorldSnapshot(
      projectWorldSnapshot(world),
      testPluginRegistry,
      base.map,
      testSimulationRulesLock,
    );
    const tracks = restored.agents.get(aliceId)!.taskTracks;

    expect(tracks.HEAD).toEqual({ kind: "operation", callId });
    expect(tracks.BODY).toEqual({ kind: "operation", callId });
    expect(restored.agents.get(aliceId)!.activeOperations.size).toBe(1);
  });

  it("rejects an active call whose operation is no longer registered", () => {
    const { base, snapshot } = snapshotWithActiveWait();
    const changed = structuredClone(snapshot);
    mutableFirstOperation(changed).operationId = "core.not_registered";

    expect(() =>
      restoreWorldSnapshot(
        changed,
        testPluginRegistry,
        base.map,
        testSimulationRulesLock,
      ),
    ).toThrow(/unregistered operation core\.not_registered/i);
  });

  it("rejects saved task slots that differ from the registered operation", () => {
    const { base, snapshot } = snapshotWithActiveWait();
    const changed = structuredClone(snapshot) as typeof snapshot & {
      state: {
        agents: Array<{
          id: string;
          taskTracks: Record<string, unknown>;
          activeOperations: MutableOperationSnapshot[];
        }>;
      };
    };
    const alice = changed.state.agents.find((agent) => agent.id === "alice")!;
    const operation = mutableFirstOperation(changed);
    operation.taskSlots = ["HEAD"];
    alice.taskTracks = {
      HEAD: {
        kind: "operation",
        callId: "operation-call:test:restored-wait",
      },
      BODY: { kind: "empty" },
    };

    expect(() =>
      restoreWorldSnapshot(
        changed,
        testPluginRegistry,
        base.map,
        testSimulationRulesLock,
      ),
    ).toThrow(/task slots do not match core\.wait/i);
  });

  it("rejects arguments that no longer satisfy the operation runtime", () => {
    const { base, snapshot } = snapshotWithActiveWait();
    const changed = structuredClone(snapshot);
    mutableFirstOperation(changed).arguments = { durationTicks: 0 };

    expect(() =>
      restoreWorldSnapshot(
        changed,
        testPluginRegistry,
        base.map,
        testSimulationRulesLock,
      ),
    ).toThrow(/incompatible arguments/i);
  });

  it("rejects a plan that no longer matches the operation runtime", () => {
    const { base, snapshot } = snapshotWithActiveWait();
    const changed = structuredClone(snapshot);
    mutableFirstOperation(changed).plan.actions[0]!["durationTicks"] = 8;

    expect(() =>
      restoreWorldSnapshot(
        changed,
        testPluginRegistry,
        base.map,
        testSimulationRulesLock,
      ),
    ).toThrow(/incompatible plan/i);
  });
});
