import { describe, expect, it } from "vitest";

import { starterEngine } from "./fixtures/fixed-decision-provider";

describe("subjective direct decisions", () => {
  it("exposes subjective facts without generating a dynamic operation whitelist", () => {
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
    expect(input.taskOptions).toBeUndefined();
    expect(visibleObjectIds.size).toBeGreaterThan(0);
    expect(input.memories.map((memory) => memory.summary).join(" ")).toContain(
      "refrigerator",
    );
    expect(input.memories.map((memory) => memory.summary).join(" ")).toContain(
      "toilet",
    );
  });
});
