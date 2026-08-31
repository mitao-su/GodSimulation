import { describe, expect, it } from "vitest";

import homePlugin from "@god-sim/home-objects";
import { createPluginRegistry, loadWorldDefinition } from "@god-sim/simulation";
import spatialPlugin from "@god-sim/spatial-objects";
import agentsPlugin from "@god-sim/starter-agents";

import starterHome from "../../content/worlds/starter-home/world.json" with { type: "json" };

describe("starter home", () => {
  it("loads one continuous four-zone home with the milestone entities", () => {
    const registry = createPluginRegistry([spatialPlugin, homePlugin, agentsPlugin]);
    const world = loadWorldDefinition(starterHome, registry, { seed: 20260831 }).world;

    expect(world.map.zones.map((zone) => zone.id)).toEqual([
      "living-room",
      "bedroom",
      "kitchen",
      "bathroom",
    ]);
    expect([...world.agents.keys()]).toEqual(["alice", "bob"]);
    expect([...world.objects.values()].filter((object) => object.definitionId === "spatial.door"))
      .toHaveLength(4);
    expect(world.objects.get("fridge-1" as never)?.definitionId).toBe("home.refrigerator");
    expect(world.objects.get("toilet-1" as never)?.definitionId).toBe("home.toilet");
    expect(world.map.decorations).toEqual([
      expect.objectContaining({ id: "rug-living", frameId: "blue" }),
      expect.objectContaining({ id: "rug-bedroom", frameId: "orange" }),
      expect.objectContaining({ id: "rug-kitchen", frameId: "purple" }),
      expect.objectContaining({ id: "rug-bathroom", frameId: "red" }),
    ]);
    expect(world.map.width * world.map.height).toBeGreaterThan(150);
  });
});
