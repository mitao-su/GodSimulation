import { z } from "zod";
import { describe, expect, it } from "vitest";

import { assertHostedOperationContract } from "@god-sim/plugin-sdk";
import {
  DirectOperationReferenceSchema,
  OperationHostDefinitionReferenceSchema,
  OperationManualSchema,
  type OperationTechnicalFailure,
} from "@god-sim/protocol";

import {
  createOperationRuntimeContext,
  type AtomicOperationTerminationPort,
  type HostedOperationRuntime,
  type HostedOperationRuntimeRegistry,
} from "./operation-runtime";
import {
  simulationTestWorld,
  testPluginRegistry,
} from "../testing/simulation-test-fixtures";

const hostDefinition = OperationHostDefinitionReferenceSchema.parse({
  kind: "furniture",
  hostDefinitionId: "test.fridge",
});

const runtime: HostedOperationRuntime = {
  id: "furniture.test.fridge.use" as never,
  displayName: "Use fridge",
  trigger: "active_command",
  ownerPluginId: "test.simulation",
  host: hostDefinition,
  manual: OperationManualSchema.parse({
    operationId: "furniture.test.fridge.use",
    displayName: "Use fridge",
    summary: "Use this refrigerator.",
    taskSlots: ["BODY"],
    parametersSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    target: { kind: "none" },
    duration: { kind: "fixed" },
    worldPreconditions: [],
  }),
  target: { kind: "none" },
  duration: { kind: "fixed" },
  taskSlots: ["BODY"],
  eventIgnore: [],
  publicBehavior: { kind: "visible", label: "using the fridge" },
  arbitrationFailureMappings: {},
  domainFailures: [],
  resultSchema: z.object({}).strict(),
  stateSchema: z.object({}).strict(),
  parametersSchema: z.object({}).strict(),
  initialState: () => ({}),
  resolveDuration: () => ({ kind: "fixed", totalTicks: 10 }),
  start: (_context, operation) => ({
    kind: "started",
    proposal: { effects: [] },
    nextState: operation.state,
  }),
  complete: () => ({ effects: [], result: {} }),
  fail: () => ({ effects: [], result: {} }),
  cancel: () => ({ effects: [], result: {} }),
  fuse: () => null,
  acknowledgeFuseResult: (_context, operation) => operation.state,
  mapArbitrationFailure: (_operationCall, failure) =>
    ({ kind: "unmapped", reasonCode: failure.reasonCode }),
};

const hostedRegistry: HostedOperationRuntimeRegistry = {
  ...testPluginRegistry,
  resolveOperationReference: (_context, track, reference) => ({
    kind: "invalid_reference",
    code: "operation_not_mounted",
    message: `${reference.operationId} is not mounted on ${track}`,
  }),
  getHostedOperation: (operationId, host) =>
    operationId === runtime.id &&
    host.kind === runtime.host.kind &&
    host.hostDefinitionId === runtime.host.hostDefinitionId
      ? runtime
      : undefined,
};

describe("hosted operation runtime ports", () => {
  it("validates a bound core runtime through the shared hosted validator", () => {
    expect(() =>
      assertHostedOperationContract("Bound fridge operation", runtime),
    ).not.toThrow();
  });

  it("resolves a direct reference through a typed protocol rejection", () => {
    const context = createOperationRuntimeContext(
      simulationTestWorld(),
      hostedRegistry,
      "alice" as never,
    );
    const result = hostedRegistry.resolveOperationReference(
      context,
      "BODY",
      DirectOperationReferenceSchema.parse({
        kind: "operation",
        operationId: "furniture.home.stove.cook",
        hostEntityId: "stove-1",
        arguments: {},
      }),
    );

    expect(result).toEqual({
      kind: "invalid_reference",
      code: "operation_not_mounted",
      message: "furniture.home.stove.cook is not mounted on BODY",
    });
  });

  it("looks up a bound runtime by locked operation and host definition", () => {
    const worldAfterHostRemoval = {
      ...simulationTestWorld(),
      objects: new Map(),
    };
    expect(worldAfterHostRemoval.objects.has("fridge-1" as never)).toBe(false);
    expect(
      hostedRegistry.getHostedOperation(runtime.id, hostDefinition),
    ).toBe(runtime);
    expect(
      hostedRegistry.getHostedOperation(runtime.id, {
        kind: "furniture",
        hostDefinitionId: "home.stove",
      }),
    ).toBeUndefined();
  });

  it("cannot return a partially changed world after termination fails", () => {
    const technicalFailure: OperationTechnicalFailure = {
      kind: "technical_failure",
      category: "plugin",
      code: "invalid_effect",
      message: "The terminal effect proposal was rejected.",
      retryable: true,
    };
    const port: AtomicOperationTerminationPort = {
      commitTermination: () => ({
        kind: "technical_failure",
        failure: technicalFailure,
      }),
    };
    const world = simulationTestWorld();
    const result = port.commitTermination(world, hostedRegistry, {
      agentId: "alice" as never,
      callId: "operation-call:1" as never,
      operationId: "core.wait" as never,
      outcome: "cancelled",
      source: "replacement",
      terminatedAtTick: world.tick,
      proposal: { effects: [], result: {} },
    });

    expect(result).toEqual({
      kind: "technical_failure",
      failure: technicalFailure,
    });
  });
});
