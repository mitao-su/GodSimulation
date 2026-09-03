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
    });

    expect(result).toMatchObject({
      type: "available_interactions",
      interactions: [
        {
          id: "use",
          taskSlots: ["BODY"],
          duration: { kind: "fixed", totalTicks: 10 },
          availability: { available: true },
        },
        {
          id: "stock",
          taskSlots: ["BODY"],
          duration: { kind: "fixed", totalTicks: 10 },
          availability: { available: true },
        },
      ],
    });
  });

  it("turns a valid interaction start into a proposal without applying it", () => {
    const world = simulationTestWorld();
    const result = proposeInteraction(world, testPluginRegistry, {
      agentId: "bob" as never,
      entityId: "fridge-1" as never,
      interactionId: "use",
      parameters: {},
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
      duration: { kind: "fixed", totalTicks: 10 },
      taskSlots: ["BODY"],
    });
    expect(world.objects.get("fridge-1" as never)?.state).toEqual({ holder: null });
  });

  it("allows cancellation cleanup after the actor leaves interaction range", () => {
    const base = simulationTestWorld();
    const fridge = base.objects.get("fridge-1" as never)!;
    const world = {
      ...base,
      objects: new Map(base.objects).set(fridge.id, {
        ...fridge,
        version: 1,
        state: { holder: "alice" },
      }),
    };

    const result = proposeInteraction(world, testPluginRegistry, {
      agentId: "alice" as never,
      entityId: "fridge-1" as never,
      interactionId: "use",
      parameters: {},
      phase: "cancel",
    });

    expect(result).toMatchObject({
      accepted: true,
      proposal: {
        effects: [
          {
            type: "release_occupancy",
            entityId: "fridge-1",
            agentId: "alice",
            expectedObjectVersion: 1,
          },
        ],
      },
    });
  });
});
