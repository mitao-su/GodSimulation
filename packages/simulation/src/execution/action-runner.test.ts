import { describe, expect, it } from "vitest";

import type { OperationCallId, TaskTrack } from "@god-sim/protocol";

import type { ActiveOperation } from "./operation";
import { advanceOperations } from "./action-runner";
import type { TaskTrackState } from "./task-tracks";
import {
  simulationTestWorld,
  testPluginRegistry,
} from "../testing/simulation-test-fixtures";
import type { WorldState } from "../world/world-state";

function operation(
  callId: string,
  value: Omit<
    ActiveOperation,
    "callId" | "startedAtTick" | "progressTicks" | "accumulatedObservations"
  > & {
    readonly progressTicks?: number;
    readonly accumulatedObservations?: ActiveOperation["accumulatedObservations"];
  },
): ActiveOperation {
  return {
    callId: callId as OperationCallId,
    startedAtTick: 0,
    progressTicks: value.progressTicks ?? 0,
    accumulatedObservations: value.accumulatedObservations ?? [],
    ...value,
  };
}

function withOperations(
  operations: readonly ActiveOperation[],
): WorldState {
  const world = simulationTestWorld();
  const aliceId = "alice" as never;
  const alice = world.agents.get(aliceId)!;
  const tracks: Record<TaskTrack, TaskTrackState> = {
    HEAD: { kind: "empty" },
    BODY: { kind: "empty" },
  };
  for (const active of operations) {
    for (const track of active.taskSlots) {
      tracks[track] = { kind: "operation", callId: active.callId };
    }
  }
  return {
    ...world,
    mode: "RUNNING",
    agents: new Map(world.agents).set(aliceId, {
      ...alice,
      taskTracks: tracks,
      activeOperations: new Map(
        operations.map((active) => [active.callId, active]),
      ),
    }),
  };
}

describe("advanceOperations", () => {
  it("moves one cell after the configured number of Tick advances", () => {
    const move = operation("operation-call:test:move", {
      operationId: "core.move" as never,
      taskOptionId: "task-option:test:move" as never,
      label: "Move",
      taskSlots: ["BODY"],
      arguments: { targetEntityId: "fridge-1" },
      duration: { kind: "indeterminate" },
      plan: {
        currentActionIndex: 0,
        actions: [
          {
            id: "operation-call:test:move:action:0",
            kind: "move",
            path: [
              { x: 3, y: 2 },
              { x: 3, y: 1 },
            ],
            durationTicks: 2,
            progressTicks: 0,
          },
        ],
      },
    });

    const first = advanceOperations(withOperations([move]), testPluginRegistry);
    expect(first.world.agents.get("alice" as never)?.position).toEqual({ x: 3, y: 2 });
    const second = advanceOperations(first.world, testPluginRegistry);

    expect(second.world.agents.get("alice" as never)?.position).toEqual({ x: 3, y: 1 });
    expect(second.completedOperations).toEqual([
      {
        agentId: "alice",
        callId: "operation-call:test:move",
        label: "Move",
      },
    ]);
  });

  it("counts the interaction arbitration Tick as operation progress", () => {
    const use = operation("operation-call:test:use", {
      operationId: "object.test.fridge.use" as never,
      taskOptionId: "task-option:test:use" as never,
      label: "Use fridge",
      taskSlots: ["BODY"],
      arguments: { targetEntityId: "fridge-1", parameters: {} },
      duration: { kind: "fixed", totalTicks: 10 },
      plan: {
        currentActionIndex: 0,
        actions: [
          {
            id: "operation-call:test:use:action:0",
            kind: "interact_object",
            purpose: "direct",
            targetEntityId: "fridge-1" as never,
            interactionId: "use",
            durationTicks: 10,
            progressTicks: 0,
            started: false,
          },
        ],
      },
    });

    const result = advanceOperations(withOperations([use]), testPluginRegistry);

    expect(result.interactionIntents).toEqual([
      {
        intentId: "operation-call:test:use:action:0:start",
        callId: "operation-call:test:use",
        actionId: "operation-call:test:use:action:0",
        agentId: "alice",
        entityId: "fridge-1",
        interactionId: "use",
        arrivalTick: 0,
        purpose: "direct",
      },
    ]);
    expect(
      result.world.agents
        .get("alice" as never)
        ?.activeOperations.get(use.callId)?.progressTicks,
    ).toBe(1);
  });

  it("completes HEAD while preserving the BODY call advanced in the same Tick", () => {
    const head = operation("operation-call:test:head", {
      operationId: "core.observe" as never,
      taskOptionId: "task-option:test:head" as never,
      label: "Observe",
      taskSlots: ["HEAD"],
      arguments: { targetEntityId: "fridge-1" },
      duration: { kind: "fixed", totalTicks: 1 },
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
    });
    const body = operation("operation-call:test:body", {
      operationId: "core.wait" as never,
      taskOptionId: "task-option:test:body" as never,
      label: "Wait",
      taskSlots: ["BODY"],
      arguments: { durationTicks: 3 },
      duration: { kind: "fixed", totalTicks: 3 },
      plan: {
        currentActionIndex: 0,
        actions: [
          {
            id: "operation-call:test:body:action:0",
            kind: "wait",
            durationTicks: 3,
            progressTicks: 0,
          },
        ],
      },
    });

    const result = advanceOperations(withOperations([head, body]), testPluginRegistry);
    const alice = result.world.agents.get("alice" as never)!;

    expect(alice.taskTracks.HEAD).toEqual({ kind: "empty" });
    expect(alice.taskTracks.BODY).toEqual({
      kind: "operation",
      callId: body.callId,
    });
    expect(alice.activeOperations.has(head.callId)).toBe(false);
    expect(alice.activeOperations.get(body.callId)?.progressTicks).toBe(1);
    expect(result.completedOperations).toEqual([
      { agentId: "alice", callId: head.callId, label: "Observe" },
    ]);
  });

  it("advances and terminates a synchronized call exactly once", () => {
    const synchronized = operation("operation-call:test:synchronized", {
      operationId: "core.wait" as never,
      taskOptionId: "task-option:test:synchronized" as never,
      label: "Sleep",
      taskSlots: ["HEAD", "BODY"],
      arguments: { durationTicks: 1 },
      duration: { kind: "fixed", totalTicks: 1 },
      plan: {
        currentActionIndex: 0,
        actions: [
          {
            id: "operation-call:test:synchronized:action:0",
            kind: "wait",
            durationTicks: 1,
            progressTicks: 0,
          },
        ],
      },
    });

    const result = advanceOperations(
      withOperations([synchronized]),
      testPluginRegistry,
    );
    const alice = result.world.agents.get("alice" as never)!;

    expect(alice.taskTracks).toEqual({
      HEAD: { kind: "empty" },
      BODY: { kind: "empty" },
    });
    expect(result.completedOperations).toEqual([
      { agentId: "alice", callId: synchronized.callId, label: "Sleep" },
    ]);
  });

  it("does not advance operations while the world is frozen", () => {
    const wait = operation("operation-call:test:frozen", {
      operationId: "core.wait" as never,
      taskOptionId: "task-option:test:frozen" as never,
      label: "Wait",
      taskSlots: ["BODY"],
      arguments: { durationTicks: 3 },
      duration: { kind: "fixed", totalTicks: 3 },
      plan: {
        currentActionIndex: 0,
        actions: [
          {
            id: "operation-call:test:frozen:action:0",
            kind: "wait",
            durationTicks: 3,
            progressTicks: 0,
          },
        ],
      },
    });
    const frozen = { ...withOperations([wait]), mode: "THINKING" as const };

    const result = advanceOperations(frozen, testPluginRegistry);

    expect(result.world).toBe(frozen);
    expect(result.completedOperations).toEqual([]);
  });
});
