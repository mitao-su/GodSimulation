import { describe, expect, it } from "vitest";

import homePlugin from "@god-sim/home-objects";
import { AgentIdSchema, EntityIdSchema } from "@god-sim/protocol";
import { createPluginRegistry, findPath, loadWorldDefinition, SpatialIndex, ZoneIndex } from "@god-sim/simulation";
import spatialPlugin from "@god-sim/spatial-objects";
import agentsPlugin from "@god-sim/starter-agents";

import starterHome from "../../content/worlds/starter-home/world.json" with { type: "json" };
import { testSimulationRulesLock } from "../fixtures/simulation-rules";

const registry = createPluginRegistry([spatialPlugin, homePlugin, agentsPlugin]);
const { world } = loadWorldDefinition(starterHome, registry, {
  simulationRulesLock: testSimulationRulesLock,
});
const spatial = new SpatialIndex(world, registry);
const zones = new ZoneIndex(world.map);
const noKnownBlockers = { knownTraversalBlockers: new Map() };

describe("starter home", () => {
  it("loads the four rooms with an aligned seating area and workspace", () => {
    expect(world.map.zones.map((zone) => zone.id)).toEqual([
      "living-room",
      "bedroom",
      "kitchen",
      "bathroom",
    ]);
    expect([...world.agents.keys()]).toEqual(["alice", "bob"]);
    expect([...world.objects.values()].filter((object) => object.definitionId === "spatial.door"))
      .toHaveLength(4);
    const sofa = world.objects.get(EntityIdSchema.parse("living-sofa"))!;
    const table = world.objects.get(EntityIdSchema.parse("living-table"))!;
    const media = world.objects.get(EntityIdSchema.parse("living-media"))!;
    expect(sofa.facing).toBe("north");
    expect(table.position.x).toBe(media.position.x);
    expect(table.position.y).toBeGreaterThan(media.position.y);
    expect(table.position.y).toBeLessThan(sofa.position.y);
    expect(spatial.interactionPositions(sofa.id)).toEqual([{ x: media.position.x, y: sofa.position.y - 1 }]);

    const desk = world.objects.get(EntityIdSchema.parse("bedroom-desk"))!;
    const chair = world.objects.get(EntityIdSchema.parse("bedroom-chair"))!;
    expect(chair.facing).toBe("north");
    expect(chair.position).toEqual({ x: desk.position.x, y: desk.position.y + 1 });
  });

  it("routes around ground furniture and keeps both sides of each door accessible", () => {
    for (const id of ["living-sofa", "bedroom-bed", "bathroom-bathtub"]) {
      const object = world.objects.get(EntityIdSchema.parse(id))!;
      const cells = world.map.zones.flatMap((zone) =>
        Array.from({ length: zone.width * zone.height }, (_, index) => ({
          x: zone.x + index % zone.width,
          y: zone.y + Math.floor(index / zone.width),
        })),
      ).filter((cell) => spatial.blockingObjectsAt(cell).some(({ id }) => id === object.id));
      expect(cells.length, id).toBeGreaterThan(1);
      expect(findPath(world, registry, AgentIdSchema.parse("alice"), cells, noKnownBlockers))
        .toEqual({ kind: "not_found" });
    }
    for (const [id, firstZone, secondZone] of [
      ["door-living-kitchen", "living-room", "kitchen"],
      ["door-living-bedroom", "living-room", "bedroom"],
      ["door-bedroom-bathroom", "bedroom", "bathroom"],
      ["door-kitchen-bathroom", "kitchen", "bathroom"],
    ] as const) {
      const stops = spatial.interactionPositions(EntityIdSchema.parse(id));
      expect(stops.map((cell) => zones.at(cell)?.id).sort(), id).toEqual([firstZone, secondZone].sort());
      for (const cell of stops) {
        expect(spatial.blockingObjectsAt(cell), id).toEqual([]);
        for (const agent of world.agents.values()) {
          expect(findPath(world, registry, agent.id, [cell], noKnownBlockers), id)
            .toMatchObject({ kind: "found" });
        }
      }
    }
  });

  it.each([
    ["fridge-1", "home.refrigerator", "kitchen"],
    ["toilet-1", "home.toilet", "bathroom"],
  ] as const)("can reach the visible front of %s, including after the kitchen door locks", (id, definitionId, zone) => {
    const fixture = world.objects.get(EntityIdSchema.parse(id))!;
    const front = { x: fixture.position.x - 1, y: fixture.position.y };
    expect(fixture).toMatchObject({ definitionId, facing: "west" });
    expect(zones.at(front)?.id).toBe(zone);
    expect(spatial.interactionPositions(fixture.id)).toEqual([front]);
    expect(spatial.blockingObjectsAt(front)).toEqual([]);

    const kitchenDoor = world.objects.get(EntityIdSchema.parse("door-living-kitchen"))!;
    for (const agent of world.agents.values()) {
      const route = findPath(world, registry, agent.id, [front], {
        knownTraversalBlockers: new Map([[kitchenDoor.id, {
          entityId: kitchenDoor.id,
          observedObjectVersion: kitchenDoor.version,
          reasonCode: "locked",
          sourceEventId: "event:test:locked" as never,
        }]]),
      });
      expect(route.kind).toBe("found");
      if (route.kind !== "found") throw new Error(`No route to ${id}`);
      expect(route.path.at(-1)).toEqual(front);
      expect(route.path).not.toContainEqual(kitchenDoor.position);
    }
  });
});
