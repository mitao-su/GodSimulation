import { describe, expect, it } from "vitest";

import type { EntityId, TaskOption } from "@god-sim/protocol";

import { buildTaskOptions } from "./operation-catalog";
import { prepareOperationCall } from "./operation-planner";
import {
  simulationTestWorld,
  testPluginRegistry,
} from "../testing/simulation-test-fixtures";

function knownFridgeWorld(inRange: boolean) {
  const base = simulationTestWorld();
  const aliceId = "alice" as never;
  const alice = base.agents.get(aliceId)!;
  const fridgeId = "fridge-1" as EntityId;
  return {
    ...base,
    agents: new Map(base.agents).set(aliceId, {
      ...alice,
      position: inRange ? { x: 4, y: 2 } : alice.position,
      knowledge: {
        ...alice.knowledge,
        objects: new Map([
          [
            fridgeId,
            {
              entityId: fridgeId,
              displayName: "Fridge",
              status: "available",
              summary: "Available",
              observable: { holder: null },
              interactionAvailability: [],
              position: { x: 4, y: 1 },
              sourceEventId: "event:memory:fridge-1" as never,
              observedAtTick: 0,
              observationKind: "vision" as const,
            },
          ],
        ]),
        visibleEntityIds: new Set([fridgeId]),
      },
    }),
  };
}

function operationOption(
  options: readonly TaskOption[],
  operationId: string,
): Extract<TaskOption, { kind: "operation" }> {
  const option = options.find(
    (candidate) =>
      candidate.kind === "operation" && candidate.operationId === operationId,
  );
  if (!option || option.kind !== "operation") {
    throw new Error("Missing operation option " + operationId);
  }
  return option;
}

describe("operation planner", () => {
  it("prepares move as one indeterminate BODY operation", () => {
    const world = knownFridgeWorld(false);
    const option = operationOption(
      buildTaskOptions(world, testPluginRegistry, "alice" as never),
      "core.move",
    );

    const prepared = prepareOperationCall(
      world,
      testPluginRegistry,
      "alice" as never,
      option,
      { targetEntityId: "fridge-1" },
      "operation-call:test:move" as never,
    );

    expect(prepared.kind).toBe("prepared");
    if (prepared.kind !== "prepared") return;
    expect(prepared.operation.duration).toEqual({ kind: "indeterminate" });
    expect(prepared.operation.taskSlots).toEqual(["BODY"]);
    expect(prepared.operation.plan.actions.some((action) => action.kind === "move")).toBe(
      true,
    );
  });

  it("never inserts movement into an object interaction operation", () => {
    const world = knownFridgeWorld(true);
    const option = operationOption(
      buildTaskOptions(world, testPluginRegistry, "alice" as never),
      "object.test.fridge.use",
    );

    const prepared = prepareOperationCall(
      world,
      testPluginRegistry,
      "alice" as never,
      option,
      { targetEntityId: "fridge-1", parameters: {} },
      "operation-call:test:fridge" as never,
    );

    expect(prepared.kind).toBe("prepared");
    if (prepared.kind !== "prepared") return;
    expect(prepared.operation.duration).toEqual({ kind: "fixed", totalTicks: 10 });
    expect(prepared.operation.plan.actions.map((action) => action.kind)).toEqual([
      "interact_object",
    ]);
  });

  it("uses world-locked timing for wait and observe", () => {
    const world = knownFridgeWorld(true);
    const options = buildTaskOptions(world, testPluginRegistry, "alice" as never);
    const wait = operationOption(options, "core.wait");
    const observe = operationOption(options, "core.observe");

    const waiting = prepareOperationCall(
      world,
      testPluginRegistry,
      "alice" as never,
      wait,
      { durationTicks: 7 },
      "operation-call:test:wait" as never,
    );
    const observing = prepareOperationCall(
      world,
      testPluginRegistry,
      "alice" as never,
      observe,
      { targetEntityId: "fridge-1" },
      "operation-call:test:observe" as never,
    );

    expect(waiting.kind === "prepared" && waiting.operation.duration).toEqual({
      kind: "fixed",
      totalTicks: 7,
    });
    expect(observing.kind === "prepared" && observing.operation.duration).toEqual({
      kind: "fixed",
      totalTicks: 1,
    });
  });
});
