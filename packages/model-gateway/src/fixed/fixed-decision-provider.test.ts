import { describe, expect, it } from "vitest";

import type { ModelDecisionRequest } from "@god-sim/protocol";

import { FixedDecisionProvider } from "./fixed-decision-provider";

const request = {
  requestId: "request-1",
  agentId: "alice",
  worldId: "starter-world",
  worldVersion: 3,
  decisionCycleId: "cycle-1",
  schemaVersion: 1,
  pluginLockHash: "a".repeat(64),
  decisionReason: { code: "initial_goal", summary: "Choose" },
  messages: [{ role: "user", content: "Choose" }],
  goalOptions: [
    { id: "wait-10", label: "Wait", goal: { kind: "wait", durationTicks: 10 } },
  ],
} as ModelDecisionRequest;

describe("FixedDecisionProvider", () => {
  it("selects a configured option by agent and decision reason", async () => {
    const provider = new FixedDecisionProvider({
      byAgentAndReason: { "alice:initial_goal": "wait-10" as never },
    });

    await expect(provider.decide(request, new AbortController().signal)).resolves.toMatchObject({
      goalOptionId: "wait-10",
    });
  });

  it("rejects a configured option that was not offered", async () => {
    const provider = new FixedDecisionProvider({ defaultGoalOptionId: "hidden-goal" as never });

    await expect(provider.decide(request, new AbortController().signal)).rejects.toThrow(
      /not offered/,
    );
  });

  it("selects the first offered option with the configured goal kind", async () => {
    const provider = new FixedDecisionProvider({ defaultGoalKind: "wait" });

    await expect(provider.decide(request, new AbortController().signal)).resolves.toMatchObject({
      goalOptionId: "wait-10",
    });
  });
});
