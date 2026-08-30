import { describe, expect, it } from "vitest";

import { resolveGoalProposal } from "./goal-proposal-validator";

const offeredGoals = [
  {
    id: "wait-10" as never,
    label: "Wait",
    goal: { kind: "wait" as const, durationTicks: 10 },
  },
];

describe("resolveGoalProposal", () => {
  it("returns the exact program-owned goal for an offered option", () => {
    const goal = resolveGoalProposal(
      { schemaVersion: 1, goalOptionId: "wait-10" as never, reason: "Wait briefly" },
      offeredGoals,
    );

    expect(goal).toBe(offeredGoals[0]!.goal);
  });

  it("rejects a syntactically valid option ID outside the offered set", () => {
    expect(() =>
      resolveGoalProposal(
        { schemaVersion: 1, goalOptionId: "use-fridge" as never, reason: "Use it" },
        offeredGoals,
      ),
    ).toThrow(/not offered/);
  });
});

