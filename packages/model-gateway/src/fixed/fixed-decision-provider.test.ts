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
};

describe("FixedDecisionProvider", () => {
  it("returns configured direct operations independently for both tracks", async () => {
    const provider = new FixedDecisionProvider({
      byAgentAndReason: {
        "alice:initial_task": {
          head: {
            kind: "operation",
            operationId: "core.observe" as never,
            hostEntityId: "fridge-1",
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
      schemaVersion: 3,
      head: {
        kind: "replace",
        task: {
          kind: "operation",
          operationId: "core.observe",
          hostEntityId: "fridge-1",
          arguments: {},
        },
      },
      body: {
        kind: "replace",
        task: {
          kind: "operation",
          operationId: "core.wait",
          arguments: { durationTicks: 10 },
        },
      },
      reason: "Fixed decision for initial_task",
    });
  });

  it("passes direct operation identity and arguments through without candidate lookup", async () => {
    const provider = new FixedDecisionProvider({
      defaultDecision: {
        head: { kind: "continue" },
        body: {
          kind: "operation",
          operationId: "core.move" as never,
          arguments: { destination: "kitchen" },
        },
      },
    });

    await expect(
      provider.decide(request, new AbortController().signal),
    ).resolves.toMatchObject({
      head: { kind: "continue" },
      body: {
        kind: "replace",
        task: {
          kind: "operation",
          operationId: "core.move",
          arguments: { destination: "kitchen" },
        },
      },
    });
  });

  it("uses an explicit idle operation instead of clearing a track", async () => {
    const provider = new FixedDecisionProvider({
      defaultDecision: {
        head: { kind: "continue" },
        body: {
          kind: "operation",
          operationId: "core.wait" as never,
          arguments: { durationTicks: 10 },
        },
      },
    });

    await expect(
      provider.decide(request, new AbortController().signal),
    ).resolves.toMatchObject({
      head: { kind: "continue" },
      body: {
        kind: "replace",
        task: {
          kind: "operation",
          operationId: "core.wait",
          arguments: { durationTicks: 10 },
        },
      },
    });
  });

  it("emits the stable empty task branch when configured to clear a track", async () => {
    const provider = new FixedDecisionProvider({
      defaultDecision: {
        head: { kind: "empty" },
        body: { kind: "continue" },
      },
    });

    await expect(
      provider.decide(request, new AbortController().signal),
    ).resolves.toMatchObject({
      head: { kind: "replace", task: { kind: "empty_task" } },
      body: { kind: "continue" },
    });
  });
});
