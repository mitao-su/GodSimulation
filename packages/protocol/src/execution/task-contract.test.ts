import { describe, expect, it } from "vitest";

import {
  OperationDurationSchema,
  TaskDecisionSchema,
  TaskOptionSchema,
  TaskTrackSchema,
  canonicalTaskTracks,
} from "./task-contract";

describe("task execution contract", () => {
  it("keeps exactly HEAD and BODY as task tracks", () => {
    expect(TaskTrackSchema.options).toEqual(["HEAD", "BODY"]);
    expect(TaskTrackSchema.safeParse("HANDS").success).toBe(false);
  });

  it("accepts only fixed positive or indeterminate operation durations", () => {
    expect(
      OperationDurationSchema.parse({ kind: "fixed", totalTicks: 3 }),
    ).toEqual({ kind: "fixed", totalTicks: 3 });
    expect(OperationDurationSchema.parse({ kind: "indeterminate" })).toEqual({
      kind: "indeterminate",
    });
    expect(
      OperationDurationSchema.safeParse({ kind: "fixed", totalTicks: 0 })
        .success,
    ).toBe(false);
  });

  it("requires canonical non-duplicate task tracks", () => {
    expect(canonicalTaskTracks(["HEAD", "BODY"])).toEqual(["HEAD", "BODY"]);
    expect(() => canonicalTaskTracks([])).toThrow(/at least one/i);
    expect(() => canonicalTaskTracks(["BODY", "HEAD"])).toThrow(/canonical/i);
    expect(() => canonicalTaskTracks(["BODY", "BODY"])).toThrow(/duplicate/i);
  });

  it("requires every decision to choose for both tracks", () => {
    expect(
      TaskDecisionSchema.safeParse({
        schemaVersion: 2,
        head: { kind: "continue" },
        reason: "Missing the body decision",
      }).success,
    ).toBe(false);

    expect(
      TaskDecisionSchema.parse({
        schemaVersion: 2,
        head: { kind: "continue" },
        body: {
          kind: "replace",
          taskOptionId: "task-option:alice:wait",
          arguments: { durationTicks: 600 },
        },
        reason: "Think while the body waits",
      }),
    ).toEqual({
      schemaVersion: 2,
      head: { kind: "continue" },
      body: {
        kind: "replace",
        taskOptionId: "task-option:alice:wait",
        arguments: { durationTicks: 600 },
      },
      reason: "Think while the body waits",
    });
  });

  it("rejects undeclared decision fields and invalid argument values", () => {
    expect(
      TaskDecisionSchema.safeParse({
        schemaVersion: 2,
        head: {
          kind: "replace",
          taskOptionId: "task-option:alice:empty-head",
          arguments: {},
          extra: true,
        },
        body: { kind: "continue" },
        reason: "Invalid extra field",
      }).success,
    ).toBe(false);
    expect(
      TaskDecisionSchema.safeParse({
        schemaVersion: 2,
        head: { kind: "continue" },
        body: {
          kind: "replace",
          taskOptionId: "task-option:alice:wait",
          arguments: { invalid: undefined },
        },
        reason: "Arguments must be JSON",
      }).success,
    ).toBe(false);
  });

  it("distinguishes empty task options from executable operations", () => {
    expect(
      TaskOptionSchema.parse({
        kind: "empty",
        id: "task-option:alice:empty-head",
        label: "Clear head task",
        taskSlots: ["HEAD"],
        argumentSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      }),
    ).toMatchObject({ kind: "empty", taskSlots: ["HEAD"] });

    expect(
      TaskOptionSchema.parse({
        kind: "operation",
        id: "task-option:alice:wait",
        operationId: "core.wait",
        label: "Wait",
        taskSlots: ["BODY"],
        argumentSchema: {
          type: "object",
          properties: { durationTicks: { type: "integer" } },
          required: ["durationTicks"],
          additionalProperties: false,
        },
        fixedArguments: {},
      }),
    ).toMatchObject({ operationId: "core.wait", taskSlots: ["BODY"] });
  });
});
