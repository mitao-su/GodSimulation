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
          requiresParameters: false,
          duration: { kind: "fixed", totalTicks: 10 },
          availability: { available: true },
        },
        {
          id: "stock",
          taskSlots: ["BODY"],
          requiresParameters: false,
          duration: { kind: "fixed", totalTicks: 10 },
          availability: { available: true },
        },
        {
          id: "configure",
          taskSlots: ["BODY"],
          requiresParameters: true,
          duration: null,
          availability: null,
        },
      ],
    });
  });

  it("marks required-parameter interactions instead of throwing", () => {
    const world = simulationTestWorld();

    const query = () =>
      queryObject(world, testPluginRegistry, {
        type: "available_interactions",
        entityId: "fridge-1" as never,
        agentId: "alice" as never,
      });

    expect(query).not.toThrow();
    const result = query();
    if (result.type !== "available_interactions") {
      throw new Error("Expected an available_interactions result");
    }
    const configure = result.interactions.find(
      (interaction) => interaction.id === "configure",
    );
    // A required-parameter interaction cannot be previewed with empty
    // arguments; the query must surface it explicitly rather than failing
    // or silently dropping it.
    expect(configure).toEqual({
      id: "configure",
      displayName: "Configure fridge",
      taskSlots: ["BODY"],
      requiresParameters: true,
      duration: null,
      availability: null,
    });
    // Interactions whose schema accepts empty arguments still preview.
    const use = result.interactions.find(
      (interaction) => interaction.id === "use",
    );
    expect(use?.requiresParameters).toBe(false);
    expect(use?.duration).toEqual({ kind: "fixed", totalTicks: 10 });
  });

  it("does not re-resolve the locked duration during lifecycle phases", () => {
    const base = simulationTestWorld();
    // Starting a stock call resolves the duration exactly once, while the
    // fridge is still free (10 ticks).
    const started = proposeInteraction(base, testPluginRegistry, {
      agentId: "bob" as never,
      entityId: "fridge-1" as never,
      interactionId: "stock",
      parameters: {},
      phase: "start",
    });
    expect(started).toMatchObject({
      accepted: true,
      duration: { kind: "fixed", totalTicks: 10 },
    });

    // Applying the start effects reserves occupancy. The state-dependent
    // resolver would now return 20 ticks if any lifecycle phase evaluated
    // it again, so a null duration proves the locked-duration boundary.
    const fridge = base.objects.get("fridge-1" as never)!;
    const world = {
      ...base,
      objects: new Map(base.objects).set(fridge.id, {
        ...fridge,
        version: 1,
        state: { holder: "bob" },
      }),
    };

    for (const phase of ["complete", "cancel", "fail"] as const) {
      const result = proposeInteraction(world, testPluginRegistry, {
        agentId: "bob" as never,
        entityId: "fridge-1" as never,
        interactionId: "stock",
        parameters: {},
        phase,
        ...(phase === "fail" ? { failureCode: "occupied" } : {}),
      });
      expect(result).toMatchObject({ accepted: true, duration: null });
    }
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
