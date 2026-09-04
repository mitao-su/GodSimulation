import { describe, expect, it } from "vitest";

import {
  L1ActiveOperationSnapshotFieldsSchema,
  L1DecisionRequestSnapshotFieldsSchema,
  L1OperationTerminationSnapshotFieldsSchema,
  type L1ActiveOperationSnapshotFields,
  type L1OperationSnapshotSerializationPort,
} from "./operation-snapshot-contract";

const activeOperation = {
  callId: "operation-call:1",
  operationId: "furniture.home.stove.cook",
  host: { kind: "furniture", hostEntityId: "stove-1" },
  target: { kind: "none" },
  taskSlots: ["BODY"],
  arguments: { recipeId: "tomato-eggs" },
  duration: { kind: "fixed", totalTicks: 30 },
  startedAtTick: 12,
  progressTicks: 3,
  firstStepState: "started",
  state: { phase: "heating" },
} as const;

describe("L1 operation snapshot fragments", () => {
  it("serializes locked host, target, timing, first-step state, and opaque state", () => {
    expect(L1ActiveOperationSnapshotFieldsSchema.parse(activeOperation)).toEqual(
      activeOperation,
    );
  });

  it("rejects an incomplete active operation fragment", () => {
    const { host, ...withoutHost } = activeOperation;
    expect(host.kind).toBe("furniture");
    expect(
      L1ActiveOperationSnapshotFieldsSchema.safeParse(withoutHost).success,
    ).toBe(false);
    expect(
      L1ActiveOperationSnapshotFieldsSchema.safeParse({
        ...activeOperation,
        firstStepState: "completed",
      }).success,
    ).toBe(false);
  });

  it("keeps the direct decision fragment independent of legacy task options", () => {
    const fields = {
      acceptedProposal: {
        schemaVersion: 3,
        head: { kind: "continue" },
        body: {
          kind: "replace",
          task: {
            kind: "operation",
            operationId: "core.wait",
            arguments: {},
          },
        },
        reason: "Wait.",
      },
    } as const;

    expect(L1DecisionRequestSnapshotFieldsSchema.parse(fields)).toEqual(fields);
    expect(
      L1DecisionRequestSnapshotFieldsSchema.safeParse({
        acceptedProposal: {
          schemaVersion: 2,
          head: { kind: "continue" },
          body: { kind: "continue" },
          reason: "Legacy decision.",
        },
      }).success,
    ).toBe(false);
  });

  it("persists actual termination tick and source", () => {
    expect(
      L1OperationTerminationSnapshotFieldsSchema.parse({
        callId: activeOperation.callId,
        outcome: "completed",
        terminatedAtTick: 42,
        source: "duration_elapsed",
      }),
    ).toEqual({
      callId: activeOperation.callId,
      outcome: "completed",
      terminatedAtTick: 42,
      source: "duration_elapsed",
    });
  });

  it("defines a round-trip port without connecting the online snapshot", () => {
    type RuntimeOperation = {
      readonly fields: L1ActiveOperationSnapshotFields;
    };
    type RuntimeTermination = {
      readonly callId: string;
      readonly terminatedAtTick: number;
    };

    const port: L1OperationSnapshotSerializationPort<
      RuntimeOperation,
      RuntimeTermination
    > = {
      serializeOperation: (operation) =>
        L1ActiveOperationSnapshotFieldsSchema.parse(operation.fields),
      deserializeOperation: (fields) => ({ fields }),
      serializeTermination: (termination) =>
        L1OperationTerminationSnapshotFieldsSchema.parse({
          callId: termination.callId,
          outcome: "completed",
          terminatedAtTick: termination.terminatedAtTick,
          source: "duration_elapsed",
        }),
      deserializeTermination: (fields) => ({
        callId: fields.callId,
        terminatedAtTick: fields.terminatedAtTick,
      }),
    };

    const encoded = port.serializeOperation({
      fields: L1ActiveOperationSnapshotFieldsSchema.parse(activeOperation),
    });
    expect(port.deserializeOperation(encoded).fields).toEqual(activeOperation);
  });
});
