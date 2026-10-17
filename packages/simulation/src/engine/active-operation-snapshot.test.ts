import { describe, expect, it } from "vitest";

import {
  OperationCallIdSchema,
  OperationIdSchema,
  TaskOptionIdSchema,
} from "@god-sim/protocol";

import { projectWorldSnapshot } from "./snapshot-projector";
import { restoreWorldSnapshot } from "./snapshot-restorer";
import type { ActiveOperation } from "../execution/operation";
import { prepareDirectOperationCall } from "../execution/operation-planner";
import type {
  OperationRuntimeCall,
} from "../execution/operation-runtime";
import type { PendingOperationTermination } from "../world/world-state";
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
    state: {},
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

function hostedOperationFixture() {
  const base = simulationTestWorld();
  const aliceId = "alice" as never;
  const callId = OperationCallIdSchema.parse("operation-call:test:hosted-snapshot");
  const prepared = prepareDirectOperationCall(
    base,
    testPluginRegistry,
    aliceId,
    "BODY",
    {
      kind: "operation",
      operationId: OperationIdSchema.parse("object.test.fridge.use"),
      hostEntityId: "fridge-1" as never,
      arguments: {},
    },
    callId,
  );
  if (prepared.kind !== "prepared") {
    throw new Error(`Hosted fixture failed to prepare: ${prepared.kind}`);
  }
  const operation = prepared.operation;
  const alice = base.agents.get(aliceId)!;
  const world = {
    ...base,
    mode: "RUNNING" as const,
    agents: new Map(base.agents).set(aliceId, {
      ...alice,
      taskTracks: {
        HEAD: { kind: "empty" as const },
        BODY: { kind: "operation" as const, callId },
      },
      activeOperations: new Map([
        [callId, operation as unknown as ActiveOperation],
      ]),
    }),
  };
  return { base, world, operation };
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
      state: {},
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
      state: {},
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
    expect(snapshot.state).toMatchObject({ stateSchemaVersion: 4 });
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
      state: {},
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

  it("round-trips a production hosted call with its locked lifecycle state", () => {
    const { base, world, operation } = hostedOperationFixture();
    const started = {
      ...operation,
      firstStepState: "started" as const,
      progressTicks: 3,
    } satisfies OperationRuntimeCall;
    const aliceId = "alice" as never;
    const alice = world.agents.get(aliceId)!;
    const activeWorld = {
      ...world,
      tick: 3,
      agents: new Map(world.agents).set(aliceId, {
        ...alice,
        activeOperations: new Map([
          [started.callId, started as unknown as ActiveOperation],
        ]),
      }),
    };

    const restored = restoreWorldSnapshot(
      projectWorldSnapshot(activeWorld),
      testPluginRegistry,
      base.map,
      testSimulationRulesLock,
    );
    const restoredOperation = restored.agents
      .get(aliceId)!
      .activeOperations.get(started.callId);

    expect(restoredOperation).toEqual(started);
    expect(restoredOperation).toHaveProperty("host", {
      kind: "furniture",
      hostEntityId: "fridge-1",
    });
    expect(restoredOperation).toHaveProperty("hostDefinition", {
      kind: "furniture",
      hostDefinitionId: "test.fridge",
    });
    expect(restoredOperation).toHaveProperty("firstStepState", "started");
    expect(restoredOperation).toHaveProperty("duration", {
      kind: "fixed",
      totalTicks: 10,
    });
  });

  it("round-trips pending termination and terminal call ledger without rerunning lifecycle resolution", () => {
    const { base, world, operation } = hostedOperationFixture();
    const call = {
      ...operation,
      firstStepState: "started" as const,
      progressTicks: 10,
    } satisfies OperationRuntimeCall;
    const aliceId = "alice" as never;
    const pending = {
      kind: "transaction_ready" as const,
      agentId: aliceId,
      operation: call,
      transaction: {
        agentId: aliceId,
        callId: call.callId,
        operationId: call.operationId,
        source: "duration_elapsed",
        terminatedAtTick: 10,
        outcome: "completed" as const,
        proposal: { effects: [], result: { status: "completed" } },
      },
    } satisfies Extract<PendingOperationTermination, { kind: "transaction_ready" }>;
    const alice = world.agents.get(aliceId)!;
    const snapshot = projectWorldSnapshot({
      ...world,
      tick: 10,
      agents: new Map(world.agents).set(aliceId, {
        ...alice,
        activeOperations: new Map([
          [call.callId, call as unknown as ActiveOperation],
        ]),
      }),
      pendingOperationTerminations: new Map([[call.callId, pending]]),
      terminalOperationCallIds: new Set([
        OperationCallIdSchema.parse("operation-call:test:already-terminal"),
      ]),
    });

    const restored = restoreWorldSnapshot(
      snapshot,
      testPluginRegistry,
      base.map,
      testSimulationRulesLock,
    );
    expect(restored.pendingOperationTerminations?.get(call.callId)).toEqual(pending);
    expect(restored.terminalOperationCallIds).toEqual(
      new Set(["operation-call:test:already-terminal"]),
    );
  });

  it("rejects a pending hosted call whose first step is still pending after progress", () => {
    const { base, world, operation } = hostedOperationFixture();
    const call = {
      ...operation,
      progressTicks: 1,
    } satisfies OperationRuntimeCall;
    const aliceId = "alice" as never;
    const alice = world.agents.get(aliceId)!;
    const changed = projectWorldSnapshot({
      ...world,
      tick: 1,
      agents: new Map(world.agents).set(aliceId, {
        ...alice,
        activeOperations: new Map([
          [call.callId, call as unknown as ActiveOperation],
        ]),
      }),
      pendingOperationTerminations: new Map([
        [
          call.callId,
          {
            kind: "complete_pending" as const,
            agentId: aliceId,
            operation: call,
            source: "duration_elapsed" as const,
          },
        ],
      ]),
    });

    expect(() =>
      restoreWorldSnapshot(
        changed,
        testPluginRegistry,
        base.map,
        testSimulationRulesLock,
      ),
    ).toThrow(/pending but has progressed/i);
  });

  it("rejects a pending termination whose saved operation diverges from the active call", () => {
    const { base, world, operation } = hostedOperationFixture();
    const aliceId = "alice" as never;
    const alice = world.agents.get(aliceId)!;
    const changedOperation = {
      ...operation,
      arguments: { unexpected: true },
    } satisfies OperationRuntimeCall;
    const snapshot = projectWorldSnapshot({
      ...world,
      agents: new Map(world.agents).set(aliceId, {
        ...alice,
        activeOperations: new Map([
          [operation.callId, operation as unknown as ActiveOperation],
        ]),
      }),
      pendingOperationTerminations: new Map([
        [
          operation.callId,
          {
            kind: "complete_pending" as const,
            agentId: aliceId,
            operation: changedOperation,
            source: "duration_elapsed" as const,
          },
        ],
      ]),
    });

    expect(() =>
      restoreWorldSnapshot(
        snapshot,
        testPluginRegistry,
        base.map,
        testSimulationRulesLock,
      ),
    ).toThrow(/does not match its active call/i);
  });

  it("rejects a terminal ledger entry that still has an active call", () => {
    const { base, world, operation } = hostedOperationFixture();
    const aliceId = "alice" as never;
    const alice = world.agents.get(aliceId)!;
    const snapshot = projectWorldSnapshot({
      ...world,
      agents: new Map(world.agents).set(aliceId, {
        ...alice,
        activeOperations: new Map([
          [operation.callId, operation as unknown as ActiveOperation],
        ]),
      }),
      terminalOperationCallIds: new Set([operation.callId]),
    });

    expect(() =>
      restoreWorldSnapshot(
        snapshot,
        testPluginRegistry,
        base.map,
        testSimulationRulesLock,
      ),
    ).toThrow(/still active/i);
  });

  it("rejects duplicate terminal call IDs instead of silently collapsing them", () => {
    const { base, world } = hostedOperationFixture();
    const callId = OperationCallIdSchema.parse("operation-call:test:already-terminal");
    const snapshot = projectWorldSnapshot({
      ...world,
      terminalOperationCallIds: new Set([callId]),
    });
    const changed = structuredClone(snapshot) as typeof snapshot & {
      state: { terminalOperationCallIds: string[] };
    };
    changed.state.terminalOperationCallIds = [callId, callId];

    expect(() =>
      restoreWorldSnapshot(
        changed,
        testPluginRegistry,
        base.map,
        testSimulationRulesLock,
      ),
    ).toThrow(/duplicate terminal operation call IDs/i);
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

  it.each([
    {
      name: "exceeds its own action duration",
      progressTicks: 99,
    },
    {
      name: "runs ahead of the call-level progress",
      progressTicks: 5,
    },
  ])(
    "rejects an action progress that $name",
    ({ progressTicks }) => {
      const { base, snapshot } = snapshotWithActiveWait();
      const changed = structuredClone(snapshot);
      // The saved call-level progress is 3 on a 9-tick wait; both mutations
      // break universal restoration invariants even though every
      // runtime-specific field still matches.
      mutableFirstOperation(changed).plan.actions[0]!["progressTicks"] =
        progressTicks;

      expect(() =>
        restoreWorldSnapshot(
          changed,
          testPluginRegistry,
          base.map,
          testSimulationRulesLock,
        ),
      ).toThrow(/invalid action progress/i);
    },
  );

  it("rejects a multi-action plan whose call-level progress trails the completed prefix", () => {
    const base = simulationTestWorld();
    const aliceId = "alice" as never;
    const alice = base.agents.get(aliceId)!;
    const callId = OperationCallIdSchema.parse("operation-call:test:forged-move");
    const makeOperation = (
      progressTicks: number,
      prefixProgressTicks = 4,
    ): ActiveOperation => ({
      callId,
      operationId: OperationIdSchema.parse("core.move"),
      taskOptionId: TaskOptionIdSchema.parse("task-option:alice:forged-move"),
      label: "Move",
      taskSlots: ["BODY"],
      arguments: { targetEntityId: "fridge-1" },
      duration: { kind: "indeterminate" },
      startedAtTick: 0,
      progressTicks,
      state: { accumulatedObservations: [], observationDeliveryCursor: 0 },
      plan: {
        currentActionIndex: 1,
        actions: [
          {
            id: "operation-call:test:forged-move:action:0",
            kind: "move",
            path: [
              { x: 3, y: 2 },
              { x: 3, y: 1 },
              { x: 3, y: 0 },
            ],
            durationTicks: 4,
            progressTicks: prefixProgressTicks,
          },
          {
            id: "operation-call:test:forged-move:action:1",
            kind: "move",
            path: [
              { x: 3, y: 0 },
              { x: 4, y: 0 },
            ],
            durationTicks: 2,
            progressTicks: 1,
          },
        ],
      },
    });
    const snapshotFor = (progressTicks: number, prefixProgressTicks = 4) =>
      projectWorldSnapshot({
        ...base,
        tick: 5,
        mode: "RUNNING",
        agents: new Map(base.agents).set(aliceId, {
          ...alice,
          taskTracks: {
            HEAD: { kind: "empty" },
            BODY: { kind: "operation", callId },
          },
          activeOperations: new Map([
            [callId, makeOperation(progressTicks, prefixProgressTicks)],
          ]),
        }),
      });

    // The first action finished (4/4) and the second has 1/2, so any real
    // execution has at least 5 cumulative ticks. A saved progress of 1 is
    // forged even though it still matches the current action's own
    // progress, which is all the previous check looked at.
    expect(() =>
      restoreWorldSnapshot(
        snapshotFor(1),
        testPluginRegistry,
        base.map,
        testSimulationRulesLock,
      ),
    ).toThrow(/invalid action progress/i);

    // An unfinished prefix action (0/4) before the cursor means the
    // snapshot skipped work that never happened, even when the cumulative
    // progress (6) clears the completed-prefix floor.
    expect(() =>
      restoreWorldSnapshot(
        snapshotFor(6, 0),
        testPluginRegistry,
        base.map,
        testSimulationRulesLock,
      ),
    ).toThrow(/unfinished prefix action/i);

    // Replanned operations legitimately exceed the floor: a rerouted move
    // keeps the ticks spent on the replaced plan in its cumulative
    // progress, so the invariant is a lower bound, not equality.
    const restored = restoreWorldSnapshot(
      snapshotFor(6),
      testPluginRegistry,
      base.map,
      testSimulationRulesLock,
    );
    expect(
      restored.agents.get(aliceId)!.activeOperations.get(callId)?.progressTicks,
    ).toBe(6);
  });

  it("restores a running call whose duration resolver depends on state changed by start()", () => {
    const base = simulationTestWorld();
    const aliceId = "alice" as never;
    const alice = base.agents.get(aliceId)!;
    const callId = OperationCallIdSchema.parse("operation-call:test:restored-stock");
    // The fridge `stock` interaction resolves to 10 ticks while unreserved,
    // but its start() reserves occupancy, which flips the resolver to 20.
    // The saved duration was locked at creation time; restoration must not
    // re-evaluate the resolver against the already-changed object state.
    const operation: ActiveOperation = {
      callId,
      operationId: OperationIdSchema.parse("object.test.fridge.stock"),
      taskOptionId: TaskOptionIdSchema.parse("task-option:alice:stock"),
      label: "Stock fridge",
      taskSlots: ["BODY"],
      arguments: { targetEntityId: "fridge-1", parameters: {} },
      duration: { kind: "fixed", totalTicks: 10 },
      startedAtTick: 0,
      progressTicks: 3,
      state: {},
      plan: {
        currentActionIndex: 0,
        actions: [
          {
            id: "operation-call:test:restored-stock:action:0",
            kind: "interact_object",
            purpose: "direct",
            targetEntityId: "fridge-1" as never,
            interactionId: "stock",
            durationTicks: 10,
            progressTicks: 3,
            started: true,
          },
        ],
      },
    };
    const fridge = base.objects.get("fridge-1" as never)!;
    const world = {
      ...base,
      tick: 3,
      mode: "RUNNING" as const,
      objects: new Map(base.objects).set(fridge.id, {
        ...fridge,
        version: 1,
        state: { holder: "alice" },
      }),
      agents: new Map(base.agents).set(aliceId, {
        ...alice,
        position: { x: 4, y: 2 },
        taskTracks: {
          HEAD: { kind: "empty" },
          BODY: { kind: "operation", callId },
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

    expect([...restored.agents.get(aliceId)!.activeOperations.keys()]).toEqual([
      callId,
    ]);
    expect(
      restored.agents.get(aliceId)!.activeOperations.get(callId)?.duration,
    ).toEqual({ kind: "fixed", totalTicks: 10 });
  });

  it("migrates a state-v2 snapshot buffer into runtime-owned operation state", () => {
    const base = simulationTestWorld();
    const aliceId = "alice" as never;
    const alice = base.agents.get(aliceId)!;
    const moveCallId = OperationCallIdSchema.parse("operation-call:test:v2-move");
    const observeCallId = OperationCallIdSchema.parse("operation-call:test:v2-observe");
    const move: ActiveOperation = {
      callId: moveCallId,
      operationId: OperationIdSchema.parse("core.move"),
      taskOptionId: TaskOptionIdSchema.parse("task-option:alice:v2-move"),
      label: "Move",
      taskSlots: ["BODY"],
      arguments: { targetEntityId: "fridge-1" },
      duration: { kind: "indeterminate" },
      startedAtTick: 0,
      progressTicks: 1,
      state: {
        accumulatedObservations: [
          { entityId: "wall-1", kind: "object", summary: "Wall" },
        ],
        observationDeliveryCursor: 1,
      },
      plan: {
        currentActionIndex: 0,
        actions: [
          {
            id: "operation-call:test:v2-move:action:0",
            kind: "move",
            path: [
              { x: 3, y: 2 },
              { x: 3, y: 1 },
            ],
            durationTicks: 2,
            progressTicks: 1,
          },
        ],
      },
    };
    const observe: ActiveOperation = {
      callId: observeCallId,
      operationId: OperationIdSchema.parse("core.observe"),
      taskOptionId: TaskOptionIdSchema.parse("task-option:alice:v2-observe"),
      label: "Observe",
      taskSlots: ["HEAD"],
      arguments: { targetEntityId: "fridge-1" },
      duration: { kind: "fixed", totalTicks: 1 },
      startedAtTick: 0,
      progressTicks: 0,
      state: {},
      plan: {
        currentActionIndex: 0,
        actions: [
          {
            id: "operation-call:test:v2-observe:action:0",
            kind: "observe",
            targetEntityId: "fridge-1" as never,
            durationTicks: 1,
            progressTicks: 0,
          },
        ],
      },
    };
    const world = {
      ...base,
      tick: 1,
      mode: "RUNNING" as const,
      agents: new Map(base.agents).set(aliceId, {
        ...alice,
        taskTracks: {
          HEAD: { kind: "operation", callId: observeCallId },
          BODY: { kind: "operation", callId: moveCallId },
        },
        activeOperations: new Map([
          [moveCallId, move],
          [observeCallId, observe],
        ]),
      }),
    };
    const snapshot = projectWorldSnapshot(world);
    // Rewrite the serialized state back to the V2 shape: the move buffer
    // lived directly on every active operation instead of inside the
    // runtime-owned `state` field.
    const v2State = structuredClone(snapshot.state) as {
      stateSchemaVersion: number;
      agents: Array<{
        activeOperations: Array<Record<string, unknown>>;
      }>;
    };
    v2State.stateSchemaVersion = 2;
    for (const agent of v2State.agents) {
      for (const operation of agent.activeOperations) {
        const state = (operation["state"] ?? {}) as Record<string, unknown>;
        operation["accumulatedObservations"] =
          state["accumulatedObservations"] ?? [];
        operation["observationDeliveryCursor"] =
          state["observationDeliveryCursor"] ?? 0;
        delete operation["state"];
      }
    }

    const restored = restoreWorldSnapshot(
      { ...snapshot, state: v2State as never },
      testPluginRegistry,
      base.map,
      testSimulationRulesLock,
    );
    const restoredAlice = restored.agents.get(aliceId)!;

    expect(restoredAlice.activeOperations.get(moveCallId)?.state).toEqual({
      accumulatedObservations: [
        { entityId: "wall-1", kind: "object", summary: "Wall" },
      ],
      observationDeliveryCursor: 1,
    });
    expect(restoredAlice.activeOperations.get(observeCallId)?.state).toEqual(
      {},
    );
  });
});
