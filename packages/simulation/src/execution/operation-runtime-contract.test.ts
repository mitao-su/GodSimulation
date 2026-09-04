import { describe, expect, it } from "vitest";

import {
  DirectOperationReferenceSchema,
  type OperationTechnicalFailure,
} from "@god-sim/protocol";

import {
  createOperationRuntimeContext,
  type AtomicOperationTerminationPort,
  type DirectOperationReferenceResolver,
} from "./operation-runtime";
import {
  simulationTestWorld,
  testPluginRegistry,
} from "../testing/simulation-test-fixtures";

describe("hosted operation runtime ports", () => {
  it("resolves a direct reference through a typed protocol rejection", () => {
    const resolver: DirectOperationReferenceResolver = {
      resolveOperationReference: (_context, track, reference) => ({
        kind: "invalid_reference",
        code: "operation_not_mounted",
        message: `${reference.operationId} is not mounted on ${track}`,
      }),
    };
    const context = createOperationRuntimeContext(
      simulationTestWorld(),
      testPluginRegistry,
      "alice" as never,
    );
    const result = resolver.resolveOperationReference(
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
    const result = port.commitTermination(world, testPluginRegistry, {
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
