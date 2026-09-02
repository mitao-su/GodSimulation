import { describe, expect, it } from "vitest";

import type { ModelDecisionRequest } from "@god-sim/protocol";

import { FixedDecisionProvider } from "./fixed-decision-provider";

const request: ModelDecisionRequest = {
  requestId: "request-1" as never,
  agentId: "alice" as never,
  worldId: "starter-world" as never,
  worldVersion: 3,
  decisionCycleId: "cycle-1" as never,
  schemaVersion: 1,
  pluginLockHash: "a".repeat(64) as never,
  decisionReason: { code: "initial_task", summary: "Choose" },
  messages: [{ role: "user", content: "Choose" }],
  taskOptions: [
    {
      kind: "empty",
      id: "task-option:alice:empty-head" as never,
      label: "Clear head task",
      taskSlots: ["HEAD"],
      argumentSchema: {},
    },
    {
      kind: "empty",
      id: "task-option:alice:empty-body" as never,
      label: "Clear body task",
      taskSlots: ["BODY"],
      argumentSchema: {},
    },
    {
      kind: "operation",
      id: "task-option:alice:observe-fridge" as never,
      operationId: "core.observe" as never,
      label: "Observe fridge",
      taskSlots: ["HEAD"],
      argumentSchema: {},
      fixedArguments: { targetEntityId: "fridge-1" },
    },
    {
      kind: "operation",
      id: "task-option:alice:wait" as never,
      operationId: "core.wait" as never,
      label: "Wait",
      taskSlots: ["BODY"],
      argumentSchema: {},
      fixedArguments: {},
    },
  ],
};

describe("FixedDecisionProvider", () => {
  it("selects configured choices independently for both tracks", async () => {
    const provider = new FixedDecisionProvider({
      byAgentAndReason: {
        "alice:initial_task": {
          head: {
            kind: "operation",
            operationId: "core.observe" as never,
            arguments: {},
          },
          body: {
            kind: "operation",
            operationId: "core.wait" as never,
            arguments: { durationTicks: 10 },
          },
        },
      },
    });

    await expect(
      provider.decide(request, new AbortController().signal),
    ).resolves.toEqual({
      schemaVersion: 2,
      head: {
        kind: "replace",
        taskOptionId: "task-option:alice:observe-fridge",
        arguments: {},
      },
      body: {
        kind: "replace",
        taskOptionId: "task-option:alice:wait",
        arguments: { durationTicks: 10 },
      },
      reason: "Fixed decision for initial_task",
    });
  });

  it("rejects a configured operation that was not offered on its track", async () => {
    const provider = new FixedDecisionProvider({
      defaultDecision: {
        head: { kind: "continue" },
        body: {
          kind: "operation",
          operationId: "core.move" as never,
          arguments: {},
        },
      },
    });

    await expect(
      provider.decide(request, new AbortController().signal),
    ).rejects.toThrow(/not offered.*BODY/i);
  });

  it("can clear one track while continuing the other", async () => {
    const provider = new FixedDecisionProvider({
      defaultDecision: {
        head: { kind: "continue" },
        body: { kind: "empty" },
      },
    });

    await expect(
      provider.decide(request, new AbortController().signal),
    ).resolves.toMatchObject({
      head: { kind: "continue" },
      body: {
        kind: "replace",
        taskOptionId: "task-option:alice:empty-body",
        arguments: {},
      },
    });
  });
});
