import { describe, expect, it } from "vitest";

import { arbitrateInteractionBatch } from "./effect-arbiter";
import { simulationTestWorld } from "../testing/simulation-test-fixtures";

const alice = {
  intentId: "intent-alice",
  agentId: "alice" as never,
  entityId: "fridge-1" as never,
  interactionId: "use",
  arrivalTick: 8,
};

const bob = {
  intentId: "intent-bob",
  agentId: "bob" as never,
  entityId: "fridge-1" as never,
  interactionId: "use",
  arrivalTick: 8,
};

describe("arbitrateInteractionBatch", () => {
  it("does not let input iteration order choose a same-tick winner", () => {
    const world = simulationTestWorld();
    const forward = arbitrateInteractionBatch(world, [alice, bob]);
    const reverse = arbitrateInteractionBatch(world, [bob, alice]);

    expect(forward.decisions).toEqual(reverse.decisions);
    expect(forward.randomState).toBe(reverse.randomState);
    expect(forward.decisions.filter((decision) => decision.accepted)).toHaveLength(1);
  });

  it("always accepts the earlier arrival without consuming randomness", () => {
    const world = simulationTestWorld();
    const result = arbitrateInteractionBatch(world, [alice, { ...bob, arrivalTick: 7 }]);

    expect(result.decisions.find((decision) => decision.accepted)?.agentId).toBe("bob");
    expect(result.randomState).toBe(world.randomState);
  });
});
