import { describe, expect, it } from "vitest";

import {
  DecisionPromptInputSchema,
  GoalProposalSchema,
  ModelDecisionResultSchema,
} from "./decision-contract";

const identity = {
  requestId: "request-1",
  agentId: "alice",
  worldId: "starter-world",
  worldVersion: 3,
  decisionCycleId: "cycle-1",
  schemaVersion: 1,
  pluginLockHash: "a".repeat(64),
} as const;

describe("decision contract", () => {
  it("rejects a free-form goal instead of an offered option ID", () => {
    expect(
      GoalProposalSchema.safeParse({
        schemaVersion: 1,
        goal: {
          kind: "use_object",
          targetEntityId: "toilet-1",
          interactionId: "use",
        },
        reason: "I need the toilet",
      }).success,
    ).toBe(false);
  });

  it("accepts a proposal that selects one offered option", () => {
    expect(
      GoalProposalSchema.parse({
        schemaVersion: 1,
        goalOptionId: "use-toilet-1",
        reason: "My bladder feels urgent",
      }),
    ).toEqual({
      schemaVersion: 1,
      goalOptionId: "use-toilet-1",
      reason: "My bladder feels urgent",
    });
  });

  it("requires complete frozen-world identity on a model result", () => {
    expect(
      ModelDecisionResultSchema.safeParse({
        requestId: "request-1",
        proposal: {
          schemaVersion: 1,
          goalOptionId: "wait-10",
          reason: "Wait",
        },
      }).success,
    ).toBe(false);

    expect(
      ModelDecisionResultSchema.parse({
        ...identity,
        proposal: {
          schemaVersion: 1,
          goalOptionId: "wait-10",
          reason: "Wait",
        },
      }).worldVersion,
    ).toBe(3);
  });

  it("rejects objective world state in subjective prompt input", () => {
    const parsed = DecisionPromptInputSchema.safeParse({
      ...identity,
      decisionReason: { code: "initial_goal", summary: "Choose a first goal" },
      bodySensations: [],
      currentGoal: null,
      memories: [],
      perception: {
        zoneId: "living-room",
        visibleEntities: [],
        heardEvents: [],
      },
      goalOptions: [
        {
          id: "wait-10",
          label: "Wait briefly",
          goal: { kind: "wait", durationTicks: 10 },
        },
      ],
      worldState: { objects: { "fridge-1": { occupiedBy: "bob" } } },
    });

    expect(parsed.success).toBe(false);
  });
});

