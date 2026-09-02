import { describe, expect, it } from "vitest";

import { DecisionAcceptedEventSchema } from "./decision-accepted.event";

const envelope = {
  schemaVersion: 1 as const,
  eventId: "event:test:1",
  worldId: "world:test",
  worldVersion: 3,
  worldTick: 2,
  sequence: 1,
  parentSequence: null,
  causationId: "decision-request:test",
  correlationId: "decision-cycle:test",
};

describe("DecisionAcceptedEventSchema", () => {
  it("stores the complete accepted HEAD and BODY decision", () => {
    const parsed = DecisionAcceptedEventSchema.parse({
      ...envelope,
      type: "decision_accepted",
      agentId: "alice",
      requestId: "decision-request:test",
      decision: {
        schemaVersion: 2,
        head: { kind: "continue" },
        body: {
          kind: "replace",
          taskOptionId: "task-option:alice:wait",
          arguments: { durationTicks: 10 },
        },
        reason: "Wait",
      },
    });

    expect(parsed.decision.body).toEqual({
      kind: "replace",
      taskOptionId: "task-option:alice:wait",
      arguments: { durationTicks: 10 },
    });
  });

  it("rejects the legacy single goal option payload", () => {
    expect(
      DecisionAcceptedEventSchema.safeParse({
        ...envelope,
        type: "decision_accepted",
        agentId: "alice",
        requestId: "decision-request:test",
        goalOptionId: "goal-option:alice:wait",
      }).success,
    ).toBe(false);
  });
});
