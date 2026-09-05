import { describe, expect, it } from "vitest";

import {
  assertHostedOperationContract,
  type GamePlugin,
} from "@god-sim/plugin-sdk";
import {
  JsonObjectSchema,
  OperationArbitrationFailureSchema,
  type JsonObject,
  type OperationCallId,
} from "@god-sim/protocol";

import {
  createOperationRuntimeContext,
  type HostedOperationRegistry,
  type HostedOperationRuntime,
  type OperationRuntimeContext,
  type OperationRuntimeCall,
} from "./operation-runtime";
import { createOperationRegistry } from "./operation-registry";
import {
  simulationTestWorld,
  testPlugin,
  testPluginRegistry,
} from "../testing/simulation-test-fixtures";
import { createPluginRegistry } from "../world/plugin-registry";

const coreOperationIds = [
  "core.move",
  "core.observe",
  "core.read",
  "core.recall",
  "core.speak",
  "core.wait",
] as const;

function hostedRegistry() {
  return testPluginRegistry as typeof testPluginRegistry & HostedOperationRegistry;
}

function createTestRegistry(plugins: readonly GamePlugin[]) {
  const pluginRegistry = createPluginRegistry(plugins);
  return {
    ...pluginRegistry,
    ...createOperationRegistry(pluginRegistry),
  };
}

function agentRuntime(operationId: string): HostedOperationRuntime {
  const runtime = hostedRegistry().getHostedOperation(operationId, {
    kind: "agent",
    hostDefinitionId: "test.alice",
  });
  if (!runtime) throw new Error(`Missing hosted runtime ${operationId}`);
  return runtime;
}

function runtimeCall(
  runtime: HostedOperationRuntime,
  context: OperationRuntimeContext,
  host: Parameters<HostedOperationRuntime["initialState"]>[1],
  callId: OperationCallId,
  argumentsValue: JsonObject,
  state: JsonObject,
): OperationRuntimeCall {
  return {
    callId,
    operationId: runtime.id,
    host,
    hostDefinition: runtime.host,
    target:
      runtime.target.kind === "object"
        ? {
            kind: "object",
            targetEntityId: argumentsValue["targetEntityId"] as never,
          }
        : runtime.target.kind === "character"
          ? {
              kind: "character",
              targetCharacterId: argumentsValue["targetCharacterId"] as never,
            }
          : { kind: "none" },
    taskSlots: runtime.taskSlots,
    arguments: argumentsValue,
    duration: runtime.resolveDuration(
      context,
      host,
      argumentsValue,
    ),
    startedAtTick: context.world.tick,
    progressTicks: 0,
    firstStepState: "pending",
    state,
  };
}

describe("hosted operation registry", () => {
  it("binds every mounted core operation through the shared hosted contract", () => {
    for (const operationId of coreOperationIds) {
      const runtime = agentRuntime(operationId);
      expect(() =>
        assertHostedOperationContract(`Test ${operationId}`, runtime),
      ).not.toThrow();
      expect(runtime.host).toEqual({
        kind: "agent",
        hostDefinitionId: "test.alice",
      });
    }
  });

  it("rejects a mismatched agent call before mapping arbitration failure", () => {
    const runtime = agentRuntime("core.wait");
    const world = simulationTestWorld();
    const context = createOperationRuntimeContext(
      world,
      testPluginRegistry,
      "alice" as never,
    );
    const host = { kind: "agent", hostEntityId: "alice" as never } as const;
    const argumentsValue = JsonObjectSchema.parse({ durationTicks: 1 });
    const call = runtimeCall(
      runtime,
      context,
      host,
      "operation-call:agent-arbitration" as OperationCallId,
      argumentsValue,
      runtime.initialState(context, host, argumentsValue),
    );

    expect(
      runtime.mapArbitrationFailure(
        context,
        {
          ...call,
          hostDefinition: {
            kind: "agent",
            hostDefinitionId: "test.bob",
          },
        },
        OperationArbitrationFailureSchema.parse({
          reasonCode: "resource_claimed",
          resourceEntityId: "fridge-1",
          winnerAgentId: "bob",
        }),
      ),
    ).toMatchObject({
      kind: "technical_failure",
      code: "invalid_operation_call_binding",
    });

    expect(
      runtime.mapArbitrationFailure(
        context,
        {
          ...call,
          host: { kind: "agent", hostEntityId: "bob" as never },
        },
        OperationArbitrationFailureSchema.parse({
          reasonCode: "resource_claimed",
          resourceEntityId: "fridge-1",
          winnerAgentId: "bob",
        }),
      ),
    ).toMatchObject({
      kind: "technical_failure",
      code: "invalid_operation_call_binding",
    });
  });

  it("binds furniture operations through the same hosted registry", () => {
    const runtime = hostedRegistry().getHostedOperation(
      "object.test.fridge.use",
      { kind: "furniture", hostDefinitionId: "test.fridge" },
    );

    expect(runtime).toBeDefined();
    expect(() =>
      assertHostedOperationContract("Test fridge use", runtime!),
    ).not.toThrow();
    expect(runtime?.host).toEqual({
      kind: "furniture",
      hostDefinitionId: "test.fridge",
    });
    expect(
      hostedRegistry().getHostedOperation("object.test.fridge.use", {
        kind: "furniture",
        hostDefinitionId: "test.wall",
      }),
    ).toBeUndefined();
  });

  it("passes structured arbitration facts through the hosted object adapter", () => {
    const runtime = hostedRegistry().getHostedOperation(
      "object.test.fridge.use",
      { kind: "furniture", hostDefinitionId: "test.fridge" },
    );
    if (!runtime) throw new Error("Missing hosted fridge runtime");

    const world = simulationTestWorld();
    const context = createOperationRuntimeContext(
      world,
      testPluginRegistry,
      "alice" as never,
    );
    const host = {
      kind: "furniture",
      hostEntityId: "fridge-1" as never,
    } as const;
    const argumentsValue = JsonObjectSchema.parse({});
    const call = runtimeCall(
      runtime,
      context,
      host,
      "operation-call:fridge-arbitration" as OperationCallId,
      argumentsValue,
      runtime.initialState(context, host, argumentsValue),
    );

    expect(
      runtime.mapArbitrationFailure(
        context,
        call,
        OperationArbitrationFailureSchema.parse({
          reasonCode: "resource_claimed",
          resourceEntityId: "fridge-1",
          winnerAgentId: "bob",
        }),
      ),
    ).toEqual({
      kind: "mapped",
      failure: {
        kind: "domain_failure",
        code: "occupied",
        details: {
          resourceEntityId: "fridge-1",
          winnerAgentId: "bob",
        },
      },
    });

    expect(
      runtime.mapArbitrationFailure(
        context,
        { ...call, operationId: "core.wait" as never },
        OperationArbitrationFailureSchema.parse({
          reasonCode: "resource_claimed",
          resourceEntityId: "fridge-1",
          winnerAgentId: "bob",
        }),
      ),
    ).toMatchObject({
      kind: "technical_failure",
      code: "invalid_operation_call_binding",
    });

    expect(
      runtime.mapArbitrationFailure(
        context,
        {
          ...call,
          host: { kind: "furniture", hostEntityId: "wall-1" as never },
        },
        OperationArbitrationFailureSchema.parse({
          reasonCode: "resource_claimed",
          resourceEntityId: "fridge-1",
          winnerAgentId: "bob",
        }),
      ),
    ).toMatchObject({
      kind: "technical_failure",
      code: "invalid_operation_call_binding",
    });
  });

  it("rejects furniture lifecycle calls with mismatched binding metadata", () => {
    const runtime = hostedRegistry().getHostedOperation(
      "object.test.fridge.use",
      { kind: "furniture", hostDefinitionId: "test.fridge" },
    );
    if (!runtime) throw new Error("Missing hosted fridge runtime");
    const world = simulationTestWorld();
    const context = createOperationRuntimeContext(
      world,
      testPluginRegistry,
      "alice" as never,
    );
    const host = {
      kind: "furniture",
      hostEntityId: "fridge-1" as never,
    } as const;
    const argumentsValue = JsonObjectSchema.parse({});
    const call = runtimeCall(
      runtime,
      context,
      host,
      "operation-call:fridge" as OperationCallId,
      argumentsValue,
      runtime.initialState(context, host, argumentsValue),
    );

    expect(() =>
      runtime.start(context, {
        ...call,
        operationId: "core.wait" as never,
      }),
    ).toThrow(/not bound to test\.fridge/i);
    expect(() =>
      runtime.start(context, {
        ...call,
        hostDefinition: {
          kind: "furniture",
          hostDefinitionId: "test.wall",
        },
      }),
    ).toThrow(/not bound to test\.fridge/i);
  });

  it("does not grant a core operation to an agent definition that omitted it", () => {
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
    const registry = createTestRegistry([plugin]);
    const world = simulationTestWorld();
    const bobContext = createOperationRuntimeContext(
      world,
      registry,
      "bob" as never,
    );

    expect(
      registry.getHostedOperation("core.wait", {
        kind: "agent",
        hostDefinitionId: "test.bob",
      }),
    ).toBeUndefined();
    expect(registry.getOperation("core.wait")?.offers(bobContext)).toEqual([]);
    expect(
      registry.getOperation("core.wait")?.canStart(bobContext, {
        durationTicks: 1,
      }),
    ).toMatchObject({ available: false, reasonCode: "operation_not_mounted" });
  });

  it("rejects a mounted manual that disagrees with the core runtime", () => {
    const plugin: GamePlugin = {
      ...testPlugin,
      agents: testPlugin.agents.map((definition) => ({
        ...definition,
        operations: definition.operations!.map((operation) =>
          operation.operationId === "core.wait"
            ? {
                ...operation,
                manual: { ...operation.manual, taskSlots: ["HEAD"] },
              }
            : operation,
        ),
      })),
    };

    expect(() => createTestRegistry([plugin])).toThrow(
      /task slots do not match/i,
    );
  });

  it("rejects a mount when core has no authoritative runtime", () => {
    const plugin: GamePlugin = {
      ...testPlugin,
      agents: testPlugin.agents.map((definition) => ({
        ...definition,
        operations: [
          ...definition.operations!,
          {
            operationId: "core.unknown" as never,
            manual: {
              ...definition.operations![0]!.manual,
              operationId: "core.unknown" as never,
            },
          },
        ],
      })),
    };

    expect(() => createTestRegistry([plugin])).toThrow(
      /mounts unknown core operation core\.unknown/i,
    );
  });

  it("rejects an agent runtime used with another character or definition", () => {
    const runtime = agentRuntime("core.wait");
    const world = simulationTestWorld();
    const aliceContext = createOperationRuntimeContext(
      world,
      testPluginRegistry,
      "alice" as never,
    );
    const bobContext = createOperationRuntimeContext(
      world,
      testPluginRegistry,
      "bob" as never,
    );
    const argumentsValue = JsonObjectSchema.parse({ durationTicks: 1 });

    expect(() =>
      runtime.initialState(
        aliceContext,
        { kind: "agent", hostEntityId: "bob" as never },
        argumentsValue,
      ),
    ).toThrow(/must be hosted by its acting character/i);
    expect(() =>
      runtime.initialState(
        bobContext,
        { kind: "agent", hostEntityId: "bob" as never },
        argumentsValue,
      ),
    ).toThrow(/mounted on test\.alice/i);

    const host = { kind: "agent", hostEntityId: "alice" as never } as const;
    const call = runtimeCall(
      runtime,
      aliceContext,
      host,
      "operation-call:wait" as OperationCallId,
      argumentsValue,
      runtime.initialState(aliceContext, host, argumentsValue),
    );
    expect(() =>
      runtime.start(aliceContext, {
        ...call,
        hostDefinition: {
          kind: "agent",
          hostDefinitionId: "test.bob",
        },
      }),
    ).toThrow(/not bound to test\.alice/i);
  });

  it("accepts only the three declared speak volume levels", () => {
    const schema = agentRuntime("core.speak").parametersSchema;

    for (const volume of ["quiet", "normal", "loud"] as const) {
      expect(schema.safeParse({ content: "Hello", volume }).success).toBe(true);
    }
    for (const volume of [undefined, "whisper", 1]) {
      expect(schema.safeParse({ content: "Hello", volume }).success).toBe(false);
    }
    expect(
      schema.safeParse({
        content: "Hello",
        volume: "normal",
        targetCharacterId: "bob",
      }).success,
    ).toBe(false);
  });
});

describe("core read operation", () => {
  it("returns static host manuals without changing world state or worldTick", () => {
    const runtime = agentRuntime("core.read");
    const world = simulationTestWorld();
    const occupiedWorld = {
      ...world,
      objects: new Map(world.objects).set("fridge-1" as never, {
        ...world.objects.get("fridge-1" as never)!,
        state: { holder: "bob" },
      }),
    };
    const host = { kind: "agent", hostEntityId: "alice" as never } as const;
    const argumentsValue = JsonObjectSchema.parse({
      hostDefinitionId: "test.fridge",
    });

    const runRead = (worldValue: typeof world, callId: OperationCallId) => {
      const context = createOperationRuntimeContext(
        worldValue,
        testPluginRegistry,
        "alice" as never,
      );
      const initialState = runtime.initialState(context, host, argumentsValue);
      const call = runtimeCall(
        runtime,
        context,
        host,
        callId,
        argumentsValue,
        initialState,
      );
      const started = runtime.start(context, call);
      expect(started.kind).toBe("started");
      if (started.kind !== "started") throw new Error("Read did not start");
      const startedCall = {
        ...call,
        firstStepState: "started" as const,
        state: started.nextState,
      };
      const ticked = runtime.tick?.(context, startedCall);
      expect(ticked?.kind).toBe("complete");
      if (!ticked || ticked.kind !== "complete") {
        throw new Error("Read did not complete before the next Tick");
      }
      return runtime.complete(context, {
        ...startedCall,
        state: ticked.nextState,
      });
    };

    const first = runRead(world, "operation-call:read:1" as OperationCallId);
    const second = runRead(
      occupiedWorld,
      "operation-call:read:2" as OperationCallId,
    );

    expect(first).toEqual(second);
    expect(first.effects).toEqual([]);
    expect(first.result).toMatchObject({
      kind: "manual",
      hostDefinitionId: "test.fridge",
      hostKind: "furniture",
    });
    expect(
      (first.result["operations"] as readonly { operationId: string }[]).map(
        (manual) => manual.operationId,
      ),
    ).toEqual([
      "object.test.fridge.configure",
      "object.test.fridge.stock",
      "object.test.fridge.use",
    ]);
    expect(world.tick).toBe(occupiedWorld.tick);
    expect(world.objects.get("fridge-1" as never)?.state).toEqual({
      holder: null,
    });
    expect(occupiedWorld.objects.get("fridge-1" as never)?.state).toEqual({
      holder: "bob",
    });
  });

  it("keeps consecutive reads as independent calls at the same worldTick", () => {
    const runtime = agentRuntime("core.read");
    const world = simulationTestWorld();
    const context = createOperationRuntimeContext(
      world,
      testPluginRegistry,
      "alice" as never,
    );
    const host = { kind: "agent", hostEntityId: "alice" as never } as const;
    const argumentsValue = JsonObjectSchema.parse({
      hostDefinitionId: "test.alice",
    });
    const first = runtimeCall(
      runtime,
      context,
      host,
      "operation-call:read:first" as OperationCallId,
      argumentsValue,
      runtime.initialState(context, host, argumentsValue),
    );
    const second = runtimeCall(
      runtime,
      context,
      host,
      "operation-call:read:second" as OperationCallId,
      argumentsValue,
      runtime.initialState(context, host, argumentsValue),
    );

    expect(first.callId).not.toBe(second.callId);
    expect(first.startedAtTick).toBe(second.startedAtTick);
    expect(world.tick).toBe(first.startedAtTick);
  });
});

describe("core recall operation", () => {
  it("enters an explicit technical failure until the L5 runtime is connected", () => {
    const runtime = agentRuntime("core.recall");
    const world = simulationTestWorld();
    const context = createOperationRuntimeContext(
      world,
      testPluginRegistry,
      "alice" as never,
    );
    const host = { kind: "agent", hostEntityId: "alice" as never } as const;
    const argumentsValue = JsonObjectSchema.parse({ query: "the kitchen" });
    const call = runtimeCall(
      runtime,
      context,
      host,
      "operation-call:recall" as OperationCallId,
      argumentsValue,
      runtime.initialState(context, host, argumentsValue),
    );

    expect(runtime.start(context, call)).toMatchObject({
      kind: "technical_failure",
      category: "configuration",
      code: "recall_runtime_unavailable",
      retryable: false,
    });
    expect(world.tick).toBe(call.startedAtTick);
  });
});
