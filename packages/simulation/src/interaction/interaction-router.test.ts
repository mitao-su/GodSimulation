import { describe, expect, it } from "vitest";

import { proposeInteraction, queryObject } from "./interaction-router";
import { simulationTestWorld, testPluginRegistry } from "../testing/simulation-test-fixtures";

describe("queryObject", () => {
  it("does not change the world during a visibility query", () => {
    const world = simulationTestWorld();
    const beforeState = world.objects.get("wall-1" as never)?.state;

    const result = queryObject(world, testPluginRegistry, {
      type: "visibility",
      position: { x: 2, y: 2 },
      agentId: "alice" as never,
    });

    expect(result).toEqual({ type: "visibility", blocked: true, objectIds: ["wall-1"] });
    expect(world.objects.get("wall-1" as never)?.state).toBe(beforeState);
    expect(world.version).toBe(0);
  });

  it("returns plugin-owned interaction availability", () => {
    const world = simulationTestWorld();
    const result = queryObject(world, testPluginRegistry, {
      type: "available_interactions",
      entityId: "fridge-1" as never,
      agentId: "alice" as never,
      distance: 1,
    });

    expect(result).toMatchObject({
      type: "available_interactions",
      interactions: [{ id: "use", availability: { available: true } }],
    });
  });

  it("turns a valid interaction start into a proposal without applying it", () => {
    const world = simulationTestWorld();
    const result = proposeInteraction(world, testPluginRegistry, {
      agentId: "bob" as never,
      entityId: "fridge-1" as never,
      interactionId: "use",
      phase: "start",
    });

    expect(result).toMatchObject({
      accepted: true,
      proposal: {
        effects: [
          {
            type: "reserve_occupancy",
            entityId: "fridge-1",
            agentId: "bob",
            expectedObjectVersion: 0,
          },
        ],
      },
    });
    expect(world.objects.get("fridge-1" as never)?.state).toEqual({ holder: null });
  });
});
