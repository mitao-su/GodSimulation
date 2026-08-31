import { describe, expect, it } from "vitest";

import { starterEngine } from "./fixtures/fixed-decision-provider";

describe("subjective goal options", () => {
  it("offers remembered furniture and every active interaction on a visible door", () => {
    const engine = starterEngine();
    const input = engine
      .getPendingDecisionInputs()
      .find((candidate) => candidate.agentId === "alice");
    if (!input) throw new Error("Alice has no initial decision request");

    const visibleObjectIds = new Set(
      input.perception.visibleEntities
        .filter((entity) => entity.kind === "object")
        .map((entity) => entity.entityId),
    );
    const rememberedObjectIds = new Set(["fridge-1", "toilet-1"]);
    const targetedGoals = input.goalOptions.filter(
      (option) => option.goal.kind !== "wait",
    );

    expect(
      targetedGoals.every((option) => {
        const targetEntityId = option.goal.targetEntityId;
        return (
          visibleObjectIds.has(targetEntityId) ||
          rememberedObjectIds.has(targetEntityId)
        );
      }),
    ).toBe(true);
    expect(targetedGoals.map((option) => option.goal.targetEntityId)).toEqual(
      expect.arrayContaining(["fridge-1", "toilet-1"]),
    );

    const doorGoals = targetedGoals
      .filter((option) => option.goal.targetEntityId === "door-living-kitchen")
      .map((option) => option.goal);
    expect(doorGoals).toContainEqual({
      kind: "observe",
      targetEntityId: "door-living-kitchen",
    });
    expect(
      doorGoals
        .filter((goal) => goal.kind === "use_object")
        .map((goal) => goal.interactionId)
        .sort(),
    ).toEqual(["close", "lock", "open", "unlock"]);
  });
});
