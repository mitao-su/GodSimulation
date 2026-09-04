import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  CapabilityListSchema,
  createDirectTaskDecisionSchema,
  DirectTaskDecisionSchema,
  OperationFailureSchema,
  OperationHostDefinitionReferenceSchema,
  OperationHostReferenceSchema,
  OperationManualSchema,
  OperationTargetReferenceSchema,
  OperationTargetRequirementSchema,
  OperationTerminationRecordSchema,
} from "./host-operation-contract";
import { TaskDecisionSchema } from "./task-contract";

const manual = {
  operationId: "item.put_into",
  displayName: "Put into",
  summary: "Put this item into a compatible object.",
  taskSlots: ["BODY"],
  parametersSchema: {
    type: "object",
    properties: { targetEntityId: { type: "string" } },
    required: ["targetEntityId"],
    additionalProperties: false,
  },
  target: { kind: "object", requiredCapabilities: ["heating"] },
  duration: { kind: "fixed" },
  worldPreconditions: [
    {
      failureCode: "out_of_range",
      description: "The actor must be close enough to the target.",
    },
  ],
} as const;

describe("host operation contract", () => {
  it("distinguishes agent, item, and furniture hosts", () => {
    expect(
      OperationHostReferenceSchema.parse({
        kind: "agent",
        hostEntityId: "alice",
      }),
    ).toEqual({ kind: "agent", hostEntityId: "alice" });
    expect(
      OperationHostReferenceSchema.parse({
        kind: "item",
        hostEntityId: "item-1",
      }),
    ).toEqual({ kind: "item", hostEntityId: "item-1" });
    expect(
      OperationHostReferenceSchema.parse({
        kind: "furniture",
        hostEntityId: "stove-1",
      }),
    ).toEqual({ kind: "furniture", hostEntityId: "stove-1" });
    expect(
      OperationHostDefinitionReferenceSchema.parse({
        kind: "furniture",
        hostDefinitionId: "home.stove",
      }),
    ).toEqual({ kind: "furniture", hostDefinitionId: "home.stove" });
    expect(
      OperationHostReferenceSchema.safeParse({
        kind: "item",
        hostDefinitionId: "item.egg",
      }).success,
    ).toBe(false);
  });

  it("keeps category tags out of target capability requirements", () => {
    expect(CapabilityListSchema.parse(["food", "portable"])).toEqual([
      "food",
      "portable",
    ]);
    expect(CapabilityListSchema.safeParse(["food", "food"]).success).toBe(
      false,
    );
    expect(
      OperationTargetRequirementSchema.parse({
        kind: "object",
        requiredCapabilities: ["heating", "container"],
      }),
    ).toEqual({
      kind: "object",
      requiredCapabilities: ["heating", "container"],
    });
    expect(
      OperationTargetRequirementSchema.safeParse({
        kind: "object",
        requiredCapabilities: [],
      }).success,
    ).toBe(false);
    expect(
      OperationTargetRequirementSchema.safeParse({
        kind: "object",
        requiredCapabilities: ["heating"],
        tags: ["stove"],
      }).success,
    ).toBe(false);
  });

  it("requires a self-contained static manual", () => {
    expect(OperationManualSchema.parse(manual)).toEqual(manual);
    const { worldPreconditions, ...withoutPreconditions } = manual;
    expect(worldPreconditions).toHaveLength(1);
    expect(OperationManualSchema.safeParse(withoutPreconditions).success).toBe(
      false,
    );
    expect(
      OperationManualSchema.safeParse({
        ...manual,
        currentAvailability: "available",
      }).success,
    ).toBe(false);
  });

  it("accepts direct operation references without a dynamic task option", () => {
    const decision = {
      schemaVersion: 3,
      head: { kind: "continue" },
      body: {
        kind: "replace",
        task: {
          kind: "operation",
          operationId: "item.put_into",
          hostEntityId: "egg-1",
          arguments: { targetEntityId: "stove-1" },
        },
      },
      reason: "Put the egg into the stove.",
    } as const;

    expect(DirectTaskDecisionSchema.parse(decision)).toEqual(decision);
    expect(TaskDecisionSchema.safeParse(decision).success).toBe(false);
  });

  it("allows an agent-hosted operation to omit its own host instance", () => {
    expect(
      DirectTaskDecisionSchema.parse({
        schemaVersion: 3,
        head: {
          kind: "replace",
          task: {
            kind: "operation",
            operationId: "core.read",
            arguments: { hostDefinitionId: "home.refrigerator" },
          },
        },
        body: { kind: "continue" },
        reason: "Read the refrigerator manual.",
      }).head,
    ).toMatchObject({
      kind: "replace",
      task: { kind: "operation", operationId: "core.read" },
    });
  });

  it("keeps the empty task branch free of operation and call fields", () => {
    const base = {
      schemaVersion: 3,
      head: { kind: "continue" },
      body: {
        kind: "replace",
        task: { kind: "empty_task" },
      },
      reason: "Clear the body track.",
    } as const;
    expect(DirectTaskDecisionSchema.parse(base)).toEqual(base);

    for (const extra of [
      { operationId: "core.wait" },
      { hostEntityId: "chair-1" },
      { arguments: {} },
      { callId: "operation-call:forbidden" },
    ]) {
      expect(
        DirectTaskDecisionSchema.safeParse({
          ...base,
          body: {
            kind: "replace",
            task: { kind: "empty_task", ...extra },
          },
        }).success,
      ).toBe(false);
    }
  });

  it("does not let a model supply a call ID for a new operation", () => {
    expect(
      DirectTaskDecisionSchema.safeParse({
        schemaVersion: 3,
        head: { kind: "continue" },
        body: {
          kind: "replace",
          task: {
            kind: "operation",
            operationId: "core.wait",
            arguments: {},
            callId: "operation-call:model-chosen",
          },
        },
        reason: "Wait.",
      }).success,
    ).toBe(false);
  });

  it("round-trips goal updates through a schema that later layers can tighten", () => {
    const decision = {
      schemaVersion: 3,
      head: { kind: "continue" },
      body: { kind: "continue" },
      goalUpdates: {
        updates: [{ kind: "complete", goalId: "goal:breakfast" }],
      },
      reason: "Breakfast is ready.",
    } as const;
    expect(DirectTaskDecisionSchema.parse(decision)).toEqual(decision);

    const strictGoalUpdates = createDirectTaskDecisionSchema(
      z
        .object({
          updates: z
            .array(
              z
                .object({
                  kind: z.literal("complete"),
                  goalId: z.string().min(1),
                })
                .strict(),
            )
            .min(1),
        })
        .strict(),
    );
    expect(strictGoalUpdates.parse(decision)).toEqual(decision);
    expect(
      strictGoalUpdates.safeParse({
        ...decision,
        goalUpdates: { updates: [{ kind: "delete", goalId: "goal:breakfast" }] },
      }).success,
    ).toBe(false);
  });

  it("locks only concrete external target references", () => {
    expect(
      OperationTargetReferenceSchema.parse({
        kind: "character",
        targetCharacterId: "bob",
      }),
    ).toEqual({ kind: "character", targetCharacterId: "bob" });
    expect(
      OperationTargetReferenceSchema.safeParse({
        kind: "character",
        targetEntityId: "chair-1",
      }).success,
    ).toBe(false);
  });

  it("separates declared domain failures from technical failures", () => {
    expect(
      OperationFailureSchema.parse({
        kind: "domain_failure",
        code: "occupied",
        details: { holder: "bob" },
      }).kind,
    ).toBe("domain_failure");
    expect(
      OperationFailureSchema.parse({
        kind: "technical_failure",
        category: "plugin",
        code: "invalid_effect",
        message: "The proposed effect did not match its schema.",
        retryable: true,
      }).kind,
    ).toBe("technical_failure");
  });

  it("records a typed failure only for failed terminations", () => {
    const failure = {
      kind: "domain_failure",
      code: "occupied",
      details: {},
    } as const;
    const failed = OperationTerminationRecordSchema.parse({
      callId: "operation-call:1",
      outcome: "failed",
      terminatedAtTick: 12,
      source: "first_step",
      failure,
    });
    expect(failed.outcome).toBe("failed");
    if (failed.outcome !== "failed") throw new Error("Expected failure");
    expect(failed.failure).toEqual(failure);
    expect(
      OperationTerminationRecordSchema.safeParse({
        callId: "operation-call:1",
        outcome: "completed",
        terminatedAtTick: 12,
        source: "duration_elapsed",
        failure,
      }).success,
    ).toBe(false);
    expect(
      OperationTerminationRecordSchema.safeParse({
        callId: "operation-call:1",
        outcome: "failed",
        terminatedAtTick: 12,
        source: "first_step",
      }).success,
    ).toBe(false);
  });
});
