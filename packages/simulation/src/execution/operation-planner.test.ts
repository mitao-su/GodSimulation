import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  operationParametersJsonSchema,
  type InteractionDefinition,
} from "@god-sim/plugin-sdk";
import {
  resolveTaskDecision,
  type EntityId,
  type JsonValue,
  type TaskOption,
} from "@god-sim/protocol";

import { buildTaskOptions } from "./operation-catalog";
import { createObjectInteractionOperation } from "./object-interaction-adapter";
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

function requiredParameterOperation() {
  const registered = testPluginRegistry.getObject("test.fridge");
  if (!registered) throw new Error("Missing fridge definition");
  const parametersSchema = z
    .object({ mode: z.enum(["cold", "eco"]) })
    .strict();
  const interaction: InteractionDefinition<
    JsonValue,
    { readonly mode: "cold" | "eco" }
  > = {
    id: "set_mode",
    displayName: "Set fridge mode",
    trigger: "active_command",
    manual: {
      operationId: "object.test.fridge.set_mode" as never,
      displayName: "Set fridge mode",
      summary: "Set this refrigerator to cold or eco mode.",
      taskSlots: ["BODY"],
      parametersSchema: operationParametersJsonSchema(parametersSchema),
      target: { kind: "none" },
      duration: { kind: "fixed" },
      worldPreconditions: [],
    },
    target: { kind: "none" },
    duration: { kind: "fixed" },
    taskSlots: ["BODY"],
    parametersSchema,
    resolveDuration: (_state, _context, value) => ({
      kind: "fixed",
      totalTicks: value.mode === "cold" ? 4 : 2,
    }),
    eventIgnore: [],
    publicBehavior: { kind: "visible", label: "setting the fridge mode" },
    domainFailures: [],
    resultSchema: z.object({}).strict(),
    canStart: () => ({ available: true }),
    start: () => ({ effects: [] }),
    complete: () => ({ effects: [] }),
    fail: () => ({ effects: [] }),
    cancel: () => ({ effects: [] }),
    fuse: () => null,
  };
  return createObjectInteractionOperation(
    registered.ownerPluginId,
    registered.definition,
    interaction,
  );
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

  it("carries required furniture parameters through catalog, decision, and planning", () => {
    const registered = requiredParameterOperation();
    const operations = testPluginRegistry.operations as Map<
      unknown,
      typeof registered
    >;
    operations.set(registered.id, registered);
    try {
      const world = knownFridgeWorld(true);
      const options = buildTaskOptions(
        world,
        testPluginRegistry,
        "alice" as never,
      );
      const option = operationOption(options, registered.id);
      expect(option.fixedArguments).toEqual({ targetEntityId: "fridge-1" });

      const resolved = resolveTaskDecision(
        {
          schemaVersion: 2,
          head: { kind: "continue" },
          body: {
            kind: "replace",
            taskOptionId: option.id,
            arguments: { parameters: { mode: "cold" } },
          },
          reason: "Keep food cold",
        },
        options,
      );
      const selected = resolved.tracks.BODY;
      if (selected.kind !== "operation") {
        throw new Error("Furniture decision did not resolve to an operation");
      }
      expect(selected.arguments).toEqual({
        targetEntityId: "fridge-1",
        parameters: { mode: "cold" },
      });

      const prepared = prepareOperationCall(
        world,
        testPluginRegistry,
        "alice" as never,
        selected.option,
        selected.arguments,
        "operation-call:test:set-fridge-mode" as never,
      );

      expect(prepared).toMatchObject({
        kind: "prepared",
        operation: {
          operationId: registered.id,
          arguments: {
            targetEntityId: "fridge-1",
            parameters: { mode: "cold" },
          },
          duration: { kind: "fixed", totalTicks: 4 },
        },
      });
    } finally {
      operations.delete(registered.id);
    }
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

  it("resolves every core duration through the registered runtime", () => {
    const world = knownFridgeWorld(true);
    const wait = operationOption(
      buildTaskOptions(world, testPluginRegistry, "alice" as never),
      "core.wait",
    );
    const registered = testPluginRegistry.getOperation("core.wait")!;
    const resolveDuration = vi.fn(registered.resolveDuration);
    const operations = testPluginRegistry.operations as Map<unknown, typeof registered>;
    operations.set(registered.id, { ...registered, resolveDuration });
    try {
      expect(
        prepareOperationCall(
          world,
          testPluginRegistry,
          "alice" as never,
          wait,
          { durationTicks: 7 },
          "operation-call:test:resolver" as never,
        ).kind,
      ).toBe("prepared");
      expect(resolveDuration).toHaveBeenCalledOnce();
    } finally {
      operations.set(registered.id, registered);
    }
  });

  it("looks up furniture operations by registry identity without parsing the ID", () => {
    const world = knownFridgeWorld(true);
    const registered = testPluginRegistry.getOperation(
      "object.test.fridge.use",
    )!;
    const alias = "custom.fridge-operation" as never;
    const operations = testPluginRegistry.operations as Map<unknown, typeof registered>;
    operations.set(alias, { ...registered, id: alias });
    try {
      const prepared = prepareOperationCall(
        world,
        testPluginRegistry,
        "alice" as never,
        {
          kind: "operation",
          id: "task-option:test:registry-alias" as never,
          operationId: alias,
          label: "Use fridge alias",
          taskSlots: ["BODY"],
          argumentSchema: {},
          fixedArguments: { targetEntityId: "fridge-1", parameters: {} },
        },
        {},
        "operation-call:test:registry-alias" as never,
      );

      expect(prepared).toMatchObject({
        kind: "prepared",
        operation: { operationId: alias },
      });
    } finally {
      operations.delete(alias);
    }
  });
});
