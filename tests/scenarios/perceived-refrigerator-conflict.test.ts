import { describe, expect, it } from "vitest";

import homePlugin from "@god-sim/home-objects";
import {
  createPluginRegistry,
  loadWorldDefinition,
  refreshAllPerceptions,
} from "@god-sim/simulation";
import spatialPlugin from "@god-sim/spatial-objects";
import agentsPlugin from "@god-sim/starter-agents";

import starterHome from "../../content/worlds/starter-home/world.json" with { type: "json" };

const registry = createPluginRegistry([spatialPlugin, homePlugin, agentsPlugin]);
const fridgeGoal = {
  id: "goal:alice:fridge",
  label: "Use refrigerator",
  goal: {
    kind: "use_object" as const,
    targetEntityId: "fridge-1" as never,
    interactionId: "use",
  },
};

function occupiedFridgeWorld() {
  const base = loadWorldDefinition(starterHome, registry).world;
  const fridge = base.objects.get("fridge-1" as never)!;
  const alice = base.agents.get("alice" as never)!;
  return {
    ...base,
    objects: new Map(base.objects).set("fridge-1" as never, {
      ...fridge,
      version: 1,
      state: { occupiedBy: "bob" },
    }),
    agents: new Map(base.agents).set("alice" as never, {
      ...alice,
      currentGoal: fridgeGoal,
    }),
  };
}

function refreshAlice(world: ReturnType<typeof occupiedFridgeWorld>) {
  const result = refreshAllPerceptions(world, registry);
  const agent = result.world.agents.get("alice" as never)!;
  const conflict = result.conflicts.find((item) => item.agentId === agent.id)?.reason ?? null;
  return {
    agent,
    knowledge: agent.knowledge,
    memories: agent.memories,
    conflict,
    decisionRequested: conflict !== null,
  };
}

describe("perceived refrigerator conflict", () => {
  it("does not reveal occupancy through the wall", () => {
    const update = refreshAlice(occupiedFridgeWorld());

    expect(update.knowledge.objects.get("fridge-1" as never)?.observable).not.toMatchObject({
      occupiedBy: "bob",
    });
    expect(update.decisionRequested).toBe(false);
  });

  it("requests thought only after Alice sees Bob's occupancy", () => {
    const hidden = refreshAlice(occupiedFridgeWorld());
    const alice = hidden.agent;
    const visibleWorld = {
      ...occupiedFridgeWorld(),
      agents: new Map(occupiedFridgeWorld().agents).set("alice" as never, {
        ...alice,
        position: { x: 14, y: 3 },
      }),
    };
    const visible = refreshAlice(visibleWorld);

    expect(visible.knowledge.objects.get("fridge-1" as never)?.observable).toMatchObject({
      occupiedBy: "bob",
    });
    expect(
      visible.memories.find(
        (memory) =>
          memory.relatedEntityId === ("fridge-1" as never) &&
          memory.observationKind === "vision",
      ),
    ).toMatchObject({
      observationKind: "vision",
      relatedEntityId: "fridge-1",
    });
    expect(visible.decisionRequested).toBe(true);
    expect(visible.conflict?.code).toBe("perceived_goal_conflict");
  });
});
