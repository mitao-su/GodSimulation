import { describe, expect, it } from "vitest";

import { starterEngine } from "./fixtures/fixed-decision-provider";

describe("subjective task options", () => {
  it("offers movement to remembered furniture and observation of visible objects", () => {
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
    const targetedTasks = input.taskOptions.filter(
      (option) => option.kind === "operation" && option.operationId !== "core.wait",
    );

    expect(
      targetedTasks.every((option) => {
        if (option.kind !== "operation") return false;
        const targetEntityId = String(option.fixedArguments.targetEntityId);
        return (
          visibleObjectIds.has(targetEntityId as never) ||
          rememberedObjectIds.has(targetEntityId)
        );
      }),
    ).toBe(true);
    expect(
      targetedTasks.map((option) =>
        option.kind === "operation" ? option.fixedArguments.targetEntityId : null,
      ),
    ).toEqual(
      expect.arrayContaining(["fridge-1", "toilet-1"]),
    );

    const doorOperations = targetedTasks
      .filter(
        (option) =>
          option.kind === "operation" &&
          option.fixedArguments.targetEntityId === "door-living-kitchen",
      )
      .map((option) => option.kind === "operation" ? option.operationId : null);
    expect(doorOperations).toEqual(
      expect.arrayContaining(["core.move", "core.observe"]),
    );
    expect(
      doorOperations.some((operationId) => operationId?.startsWith("object.")),
    ).toBe(false);
  });
});
