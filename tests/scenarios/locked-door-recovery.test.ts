import { describe, expect, it } from "vitest";

import homePlugin from "@god-sim/home-objects";
import {
  createPluginRegistry,
  loadWorldDefinition,
  planGoal,
  recoverBlockedPlan,
} from "@god-sim/simulation";
import spatialPlugin from "@god-sim/spatial-objects";
import agentsPlugin from "@god-sim/starter-agents";

import starterHome from "../../content/worlds/starter-home/world.json" with { type: "json" };

const registry = createPluginRegistry([spatialPlugin, homePlugin, agentsPlugin]);
const useFridge = {
  kind: "use_object" as const,
  targetEntityId: "fridge-1" as never,
  interactionId: "use",
};

describe("locked door recovery", () => {
  it("adds an automatic open action for a closed door not known to be locked", () => {
    const world = loadWorldDefinition(starterHome, registry);
    const result = planGoal(
      world,
      registry,
      "alice" as never,
      useFridge,
      { knownLockedDoorIds: new Set() },
    );

    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") return;
    expect(result.plan.actions.map((action) => action.kind)).toEqual([
      "move",
      "open_object",
      "move",
      "use_object",
    ]);
  });

  it("reroutes the same goal without thought when another known route exists", () => {
    const world = loadWorldDefinition(starterHome, registry);
    const result = recoverBlockedPlan(
      world,
      registry,
      "alice" as never,
      {
        code: "locked_door",
        entityId: "door-living-kitchen" as never,
        goal: useFridge,
      },
      { knownLockedDoorIds: new Set() },
    );

    expect(result.kind).toBe("replanned");
    if (result.kind !== "replanned") return;
    expect(result.knowledge.knownLockedDoorIds.has("door-living-kitchen" as never)).toBe(true);
    expect(result.plan.actions.filter((action) => action.kind === "open_object").length).toBeGreaterThan(1);
  });

  it("asks for a decision only after all known routes fail", () => {
    const world = loadWorldDefinition(starterHome, registry);
    const result = recoverBlockedPlan(
      world,
      registry,
      "alice" as never,
      {
        code: "locked_door",
        entityId: "door-living-kitchen" as never,
        goal: useFridge,
      },
      {
        knownLockedDoorIds: new Set(["door-bedroom-bathroom" as never]),
      },
    );

    expect(result).toMatchObject({ kind: "needs_decision", reasonCode: "no_known_route" });
  });
});
