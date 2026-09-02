import { describe, expect, it } from "vitest";

import type { OperationCallId } from "@god-sim/protocol";

import type { ActiveOperation } from "../execution/operation";
import {
  simulationTestWorld,
  testPlugin,
  testPluginRegistry,
  testSimulationRulesLock,
} from "../testing/simulation-test-fixtures";
import { restoreSimulation } from "./simulation-engine";
import { projectWorldSnapshot } from "./snapshot-projector";
import { runTickPipeline } from "./tick-pipeline";

function parallelOperationWorld() {
  const base = simulationTestWorld();
  const aliceId = "alice" as never;
  const alice = base.agents.get(aliceId)!;
  const headCall = {
      callId: "operation-call:test:head" as never,
      operationId: "core.observe" as never,
      taskOptionId: "task-option:test:head" as never,
      label: "Observe",
      taskSlots: ["HEAD"] as const,
      arguments: { targetEntityId: "fridge-1" },
      duration: { kind: "fixed" as const, totalTicks: 1 },
      startedAtTick: 0,
      progressTicks: 0,
      plan: {
        currentActionIndex: 0,
        actions: [
          {
            id: "operation-call:test:head:action:0",
            kind: "observe" as const,
            targetEntityId: "fridge-1" as never,
            durationTicks: 1,
            progressTicks: 0,
          },
        ],
      },
  } satisfies ActiveOperation;
  const bodyCall = {
      callId: "operation-call:test:body" as never,
      operationId: "core.wait" as never,
      taskOptionId: "task-option:test:body" as never,
      label: "Wait",
      taskSlots: ["BODY"] as const,
      arguments: { durationTicks: 3 },
      duration: { kind: "fixed" as const, totalTicks: 3 },
      startedAtTick: 0,
      progressTicks: 0,
      plan: {
        currentActionIndex: 0,
        actions: [
          {
            id: "operation-call:test:body:action:0",
            kind: "wait" as const,
            durationTicks: 3,
            progressTicks: 0,
          },
        ],
      },
  } satisfies ActiveOperation;
  const world = {
    ...base,
    mode: "RUNNING" as const,
    agents: new Map(base.agents).set(aliceId, {
      ...alice,
      taskTracks: {
        HEAD: { kind: "operation" as const, callId: headCall.callId },
        BODY: { kind: "operation" as const, callId: bodyCall.callId },
      },
      activeOperations: new Map<OperationCallId, ActiveOperation>([
        [headCall.callId, headCall],
        [bodyCall.callId, bodyCall],
      ]),
    }),
  };
  return { aliceId, bodyCall, headCall, world };
}

describe("HEAD/BODY Tick pipeline", () => {
  it("freezes for a completed HEAD call after advancing its BODY peer", () => {
    const { aliceId, bodyCall, headCall, world } = parallelOperationWorld();

    const result = runTickPipeline(world, testPluginRegistry);
    const nextAlice = result.world.agents.get(aliceId)!;

    expect(result.world.tick).toBe(1);
    expect(nextAlice.taskTracks.HEAD).toEqual({ kind: "empty" });
    expect(nextAlice.taskTracks.BODY).toEqual({
      kind: "operation",
      callId: bodyCall.callId,
    });
    expect(nextAlice.activeOperations.get(bodyCall.callId)?.progressTicks).toBe(1);
    expect(result.decisionNeeds).toEqual([
      {
        agentId: "alice",
        reason: {
          code: "operation_completed",
          summary: "Observe completed",
        },
      },
    ]);
    expect(
      result.events.filter((event) => event.type === "operation_terminated"),
    ).toEqual([
      expect.objectContaining({
        type: "operation_terminated",
        agentId: "alice",
        callId: headCall.callId,
        operationId: "core.observe",
        outcome: "completed",
        reasonCode: "operation_completed",
      }),
    ]);
  });

  it("keeps the entire world frozen across repeated engine ticks while thinking", () => {
    const { world } = parallelOperationWorld();
    const engine = restoreSimulation({
      snapshot: projectWorldSnapshot(world),
      worldDefinition: world.map,
      plugins: [testPlugin],
      simulationRulesLock: testSimulationRulesLock,
    });

    const paused = engine.tick();

    expect(paused).toMatchObject({ mode: "THINKING", worldTick: 1 });
    expect(paused.agents.find((agent) => agent.agentId === "alice")?.bodyTask)
      .toMatchObject({
        kind: "operation",
        callId: "operation-call:test:body",
        progressTicks: 1,
      });
    const frozenSnapshot = engine.createSnapshot();

    engine.tick();
    engine.tick();

    expect(engine.createSnapshot()).toEqual(frozenSnapshot);
  });
});
