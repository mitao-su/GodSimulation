import { describe, expect, it } from "vitest";

import { resolveTaskDecision } from "./goal-proposal-validator";

const offeredTasks = [
  {
    kind: "empty" as const,
    id: "task-option:alice:empty-head" as never,
    label: "Clear head task",
    taskSlots: ["HEAD" as const],
    argumentSchema: {},
  },
  {
    kind: "operation" as const,
    id: "task-option:alice:wait" as never,
    operationId: "core.wait" as never,
    label: "Wait",
    taskSlots: ["BODY" as const],
    argumentSchema: {},
    fixedArguments: {},
  },
];

describe("resolveTaskDecision", () => {
  it("returns the exact program-owned options for both tracks", () => {
    const decision = resolveTaskDecision(
      {
        schemaVersion: 2,
        head: {
          kind: "replace",
          taskOptionId: "task-option:alice:empty-head" as never,
          arguments: {},
        },
        body: {
          kind: "replace",
          taskOptionId: "task-option:alice:wait" as never,
          arguments: { durationTicks: 10 },
        },
        reason: "Wait briefly",
      },
      offeredTasks,
    );

    expect(decision.HEAD.kind).toBe("replace");
    expect(decision.BODY.kind).toBe("replace");
    if (decision.HEAD.kind !== "replace" || decision.BODY.kind !== "replace") {
      throw new Error("Expected resolved replacements");
    }
    expect(decision.HEAD.option).toBe(offeredTasks[0]);
    expect(decision.BODY.option).toBe(offeredTasks[1]);
    expect(decision.BODY.arguments).toEqual({ durationTicks: 10 });
  });

  it("rejects an offered task option selected on the wrong track", () => {
    expect(() =>
      resolveTaskDecision(
        {
          schemaVersion: 2,
          head: { kind: "continue" },
          body: {
            kind: "replace",
            taskOptionId: "task-option:alice:empty-head" as never,
            arguments: {},
          },
          reason: "Clear body",
        },
        offeredTasks,
      ),
    ).toThrow(/does not occupy BODY/);
  });
});
