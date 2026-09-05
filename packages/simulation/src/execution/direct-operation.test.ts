import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { GamePlugin } from "@god-sim/plugin-sdk";
import type {
  DirectOperationReference,
  JsonObject,
  OperationCallId,
} from "@god-sim/protocol";

import { createOperationRuntimeContext } from "./operation-runtime";
import { createOperationRegistry } from "./operation-registry";
import {
  prepareDirectOperationCall,
  type PrepareDirectOperationResult,
} from "./operation-planner";
import {
  simulationTestWorld,
  testPlugin,
  testPluginRegistry,
} from "../testing/simulation-test-fixtures";
import { createPluginRegistry } from "../world/plugin-registry";

const aliceId = "alice" as never;
const bobId = "bob" as never;
const fridgeId = "fridge-1" as never;

function registryWithOutOfRangeFailure() {
  const plugin: GamePlugin = {
    ...testPlugin,
    objects: testPlugin.objects.map((definition) =>
      definition.id !== "test.fridge"
        ? definition
        : {
            ...definition,
            interactions: definition.interactions.map((interaction) =>
              interaction.id !== "use"
                ? interaction
                : {
                    ...interaction,
                    manual: {
                      ...interaction.manual,
                      worldPreconditions: [
                        ...interaction.manual.worldPreconditions,
                        {
                          failureCode: "out_of_range",
                          description:
                            "The actor must be at the refrigerator interaction position.",
                        },
                      ],
                    },
                    domainFailures: [
                      ...interaction.domainFailures,
                      {
                        code: "out_of_range",
                        summary: "The refrigerator is out of range",
                        detailsSchema: z
                          .object({ summary: z.string() })
                          .strict(),
                        resultSchema: interaction.resultSchema,
                      },
                    ],
                  },
            ),
          },
    ),
  };
  const pluginRegistry = createPluginRegistry([plugin]);
  return {
    ...pluginRegistry,
    ...createOperationRegistry(pluginRegistry),
  };
}

function worldAtFridge(options?: { readonly holder?: string | null }) {
  const world = simulationTestWorld();
  const alice = world.agents.get(aliceId)!;
  const fridge = world.objects.get(fridgeId)!;
  return {
    ...world,
    agents: new Map(world.agents).set(aliceId, {
      ...alice,
      position: { x: 4, y: 2 },
    }),
    objects: new Map(world.objects).set(fridgeId, {
      ...fridge,
      state: { holder: options?.holder ?? null },
    }),
  };
}

function registryWithCountedDuration() {
  const resolveDuration = vi.fn(() => ({
    kind: "fixed" as const,
    totalTicks: 17,
  }));
  const plugin: GamePlugin = {
    ...testPlugin,
    objects: testPlugin.objects.map((definition) =>
      definition.id !== "test.fridge"
        ? definition
        : {
            ...definition,
            interactions: definition.interactions.map((interaction) =>
              interaction.id !== "stock"
                ? interaction
                : { ...interaction, resolveDuration },
            ),
          },
    ),
  };
  const pluginRegistry = createPluginRegistry([plugin]);
  return {
    ...pluginRegistry,
    ...createOperationRegistry(pluginRegistry),
    resolveDuration,
  };
}

function operationReference(
  operationId: string,
  argumentsValue: JsonObject,
  hostEntityId?: string,
): DirectOperationReference {
  return {
    kind: "operation",
    operationId: operationId as never,
    ...(hostEntityId === undefined
      ? {}
      : { hostEntityId: hostEntityId as never }),
    arguments: argumentsValue,
  };
}

function preparedOperation(
  result: PrepareDirectOperationResult,
): Extract<PrepareDirectOperationResult, { kind: "prepared" }> {
  expect(result.kind).toBe("prepared");
  if (result.kind !== "prepared") {
    throw new Error(`Expected a prepared operation, got ${result.kind}`);
  }
  return result;
}

function startPrepared(
  world: ReturnType<typeof simulationTestWorld>,
  registry: typeof testPluginRegistry,
  result: Extract<PrepareDirectOperationResult, { kind: "prepared" }>,
) {
  const operation = result.operation;
  const runtime = registry.getHostedOperation(
    operation.operationId,
    operation.hostDefinition,
  );
  if (!runtime) throw new Error(`Missing runtime ${operation.operationId}`);
  const context = createOperationRuntimeContext(world, registry, aliceId);
  return runtime.start(context, operation);
}

describe("direct operation invocation", () => {
  it("establishes a furniture call before checking distance", () => {
    const registry = registryWithOutOfRangeFailure();
    const world = simulationTestWorld();
    const prepared = preparedOperation(
      prepareDirectOperationCall(
        world,
        registry,
        aliceId,
        "BODY",
        operationReference("object.test.fridge.use", {}, "fridge-1"),
        "operation-call:direct:out-of-range" as OperationCallId,
      ),
    );

    expect(prepared.operation.host).toEqual({
      kind: "furniture",
      hostEntityId: fridgeId,
    });
    expect(startPrepared(world, registry, prepared)).toMatchObject({
      kind: "domain_failure",
      code: "out_of_range",
    });
  });

  it("establishes an occupied furniture call and fails at start", () => {
    const registry = registryWithOutOfRangeFailure();
    const world = worldAtFridge({ holder: "bob" });
    const prepared = preparedOperation(
      prepareDirectOperationCall(
        world,
        registry,
        aliceId,
        "BODY",
        operationReference("object.test.fridge.use", {}, "fridge-1"),
        "operation-call:direct:occupied" as OperationCallId,
      ),
    );

    expect(startPrepared(world, registry, prepared)).toMatchObject({
      kind: "domain_failure",
      code: "occupied",
    });
  });

  it("rejects references that cannot bind a hosted operation", () => {
    const world = simulationTestWorld();
    const cases = [
      {
        name: "unknown operation",
        reference: operationReference("core.not_registered", {}),
        track: "HEAD" as const,
        code: "unknown_operation",
      },
      {
        name: "unknown host",
        reference: operationReference("object.test.fridge.use", {}, "missing"),
        track: "BODY" as const,
        code: "unknown_host",
      },
      {
        name: "furniture operation without a furniture host",
        reference: operationReference("object.test.fridge.use", {}),
        track: "BODY" as const,
        code: "invalid_host_reference",
      },
      {
        name: "furniture operation on an agent host",
        reference: operationReference("object.test.fridge.use", {}, "alice"),
        track: "BODY" as const,
        code: "invalid_host_reference",
      },
      {
        name: "agent operation with an explicit acting host",
        reference: operationReference("core.wait", { durationTicks: 1 }, "alice"),
        track: "BODY" as const,
        code: "invalid_host_reference",
      },
      {
        name: "wrong task track",
        reference: operationReference("core.wait", { durationTicks: 1 }),
        track: "HEAD" as const,
        code: "invalid_task_track",
      },
      {
        name: "invalid parameters",
        reference: operationReference(
          "object.test.fridge.use",
          { unexpected: true },
          "fridge-1",
        ),
        track: "BODY" as const,
        code: "invalid_arguments",
      },
    ] as const;

    for (const testCase of cases) {
      const result = prepareDirectOperationCall(
        world,
        testPluginRegistry,
        aliceId,
        testCase.track,
        testCase.reference,
        `operation-call:direct:invalid:${testCase.name}` as OperationCallId,
      );
      expect(result, testCase.name).toMatchObject({
        kind: "invalid_reference",
        code: testCase.code,
      });
    }
  });

  it("rejects a direct call when the acting agent does not exist", () => {
    const result = prepareDirectOperationCall(
      simulationTestWorld(),
      testPluginRegistry,
      "missing-agent" as never,
      "BODY",
      operationReference("core.wait", { durationTicks: 1 }),
      "operation-call:direct:missing-agent" as OperationCallId,
    );

    expect(result).toMatchObject({
      kind: "invalid_reference",
      code: "unknown_host",
    });
  });

  it("rejects a core operation omitted from the acting character mount table", () => {
    const plugin: GamePlugin = {
      ...testPlugin,
      agents: testPlugin.agents.map((definition) =>
        definition.id === "test.bob"
          ? {
              ...definition,
              operations: definition.operations!.filter(
                (operation) => operation.operationId !== "core.wait",
              ),
            }
          : definition,
      ),
    };
    const pluginRegistry = createPluginRegistry([plugin]);
    const registry = {
      ...pluginRegistry,
      ...createOperationRegistry(pluginRegistry),
    };

    const result = prepareDirectOperationCall(
      simulationTestWorld(),
      registry,
      bobId,
      "BODY",
      operationReference("core.wait", { durationTicks: 1 }),
      "operation-call:direct:unmounted" as OperationCallId,
    );

    expect(result).toMatchObject({
      kind: "invalid_reference",
      code: "operation_not_mounted",
    });
  });

  it("locks state-dependent duration at call creation", () => {
    const registry = registryWithOutOfRangeFailure();
    const world = worldAtFridge();
    const prepared = preparedOperation(
      prepareDirectOperationCall(
        world,
        registry,
        aliceId,
        "BODY",
        operationReference("object.test.fridge.stock", {}, "fridge-1"),
        "operation-call:direct:duration" as OperationCallId,
      ),
    );
    const occupiedWorld = worldAtFridge({ holder: "bob" });
    const runtime = registry.getHostedOperation(
      prepared.operation.operationId,
      prepared.operation.hostDefinition,
    );
    if (!runtime) throw new Error("Missing stock runtime");

    expect(prepared.operation.duration).toEqual({ kind: "fixed", totalTicks: 10 });
    expect(
      runtime.resolveDuration(
        createOperationRuntimeContext(occupiedWorld, registry, aliceId),
        prepared.operation.host,
        prepared.operation.arguments,
      ),
    ).toEqual({ kind: "fixed", totalTicks: 20 });
    expect(prepared.operation.duration).toEqual({ kind: "fixed", totalTicks: 10 });
    expect(startPrepared(occupiedWorld, registry, prepared)).toMatchObject({
      kind: "domain_failure",
      code: "occupied",
    });
  });

  it("resolves a direct call duration exactly once during creation", () => {
    const registry = registryWithCountedDuration();
    const prepared = preparedOperation(
      prepareDirectOperationCall(
        worldAtFridge(),
        registry,
        aliceId,
        "BODY",
        operationReference("object.test.fridge.stock", {}, "fridge-1"),
        "operation-call:direct:duration-once" as OperationCallId,
      ),
    );

    expect(prepared.operation.duration).toEqual({
      kind: "fixed",
      totalTicks: 17,
    });
    expect(registry.resolveDuration).toHaveBeenCalledOnce();
  });

  it("keeps core start failures inside each operation's declared catalog", () => {
    const world = simulationTestWorld();
    const move = preparedOperation(
      prepareDirectOperationCall(
        world,
        testPluginRegistry,
        aliceId,
        "BODY",
        operationReference("core.move", { targetEntityId: "missing-object" }),
        "operation-call:direct:move-failure" as OperationCallId,
      ),
    );
    const observe = preparedOperation(
      prepareDirectOperationCall(
        world,
        testPluginRegistry,
        aliceId,
        "HEAD",
        operationReference("core.observe", { targetEntityId: "wall-1" }),
        "operation-call:direct:observe-failure" as OperationCallId,
      ),
    );
    const wait = preparedOperation(
      prepareDirectOperationCall(
        world,
        testPluginRegistry,
        aliceId,
        "BODY",
        operationReference("core.wait", { durationTicks: 601 }),
        "operation-call:direct:wait-failure" as OperationCallId,
      ),
    );

    const failures = [
      [move, startPrepared(world, testPluginRegistry, move)],
      [observe, startPrepared(world, testPluginRegistry, observe)],
      [wait, startPrepared(world, testPluginRegistry, wait)],
    ] as const;
    for (const [preparedCall, result] of failures) {
      expect(result.kind).toBe("domain_failure");
      if (result.kind !== "domain_failure") continue;
      const runtime = testPluginRegistry.getHostedOperation(
        preparedCall.operation.operationId,
        preparedCall.operation.hostDefinition,
      );
      expect(runtime?.domainFailures.some((failure) => failure.code === result.code)).toBe(
        true,
      );
    }
  });
});
