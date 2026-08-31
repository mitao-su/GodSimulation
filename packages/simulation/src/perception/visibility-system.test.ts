import { describe, expect, it } from "vitest";

import { refreshAllPerceptions } from "../engine/tick-pipeline";
import { createEmptyKnowledge } from "./agent-knowledge";
import { computeVisibleCells } from "./visibility-system";
import { simulationTestWorld, testPluginRegistry } from "../testing/simulation-test-fixtures";

describe("computeVisibleCells", () => {
  it("includes the blocking wall but not cells hidden directly behind it", () => {
    const base = simulationTestWorld();
    const alice = base.agents.get("alice" as never)!;
    const world = {
      ...base,
      agents: new Map(base.agents).set("alice" as never, {
        ...alice,
        position: { x: 0, y: 2 },
      }),
    };

    const visible = computeVisibleCells(world, testPluginRegistry, "alice" as never, 6);

    expect(visible.has("2,2")).toBe(true);
    expect(visible.has("3,2")).toBe(false);
    expect(visible.has("4,2")).toBe(false);
  });

  it("backs every visual knowledge update with a perception event", () => {
    const base = simulationTestWorld();
    const alice = base.agents.get("alice" as never)!;
    const world = {
      ...base,
      agents: new Map(base.agents).set(alice.id, {
        ...alice,
        knowledge: createEmptyKnowledge(alice.knowledge.zoneId),
        memories: [],
      }),
    };

    const result = refreshAllPerceptions(world, testPluginRegistry);
    const perceptionEventIds = new Set(
      result.events
        .filter((event) => event.type === "perception_recorded")
        .map((event) => event.eventId),
    );
    const observedAlice = result.world.agents.get(alice.id)!;

    expect(perceptionEventIds.size).toBeGreaterThan(0);
    for (const object of observedAlice.knowledge.objects.values()) {
      expect(perceptionEventIds.has(object.sourceEventId)).toBe(true);
    }
  });

  it("records a visible position change and clears that object's stale blocker", () => {
    const first = refreshAllPerceptions(simulationTestWorld(), testPluginRegistry);
    const alice = first.world.agents.get("alice" as never)!;
    const wall = first.world.objects.get("wall-1" as never)!;
    const knownWall = alice.knowledge.objects.get(wall.id);
    if (!knownWall) throw new Error("Alice did not observe the wall fixture");
    const world = {
      ...first.world,
      objects: new Map(first.world.objects).set(wall.id, {
        ...wall,
        version: wall.version + 1,
        position: { x: 2, y: 1 },
      }),
      agents: new Map(first.world.agents).set(alice.id, {
        ...alice,
        knowledge: {
          ...alice.knowledge,
          knownTraversalBlockers: new Map([
            [
              wall.id,
              {
                entityId: wall.id,
                observedObjectVersion: wall.version,
                reasonCode: "stale_test_blocker",
                sourceEventId: knownWall.sourceEventId,
              },
            ],
          ]),
        },
      }),
    };

    const second = refreshAllPerceptions(world, testPluginRegistry);
    const wallEvent = second.events.find(
      (event) =>
        event.type === "perception_recorded" && event.relatedEntityId === wall.id,
    );

    expect(wallEvent).toBeDefined();
    expect(
      second.world.agents.get(alice.id)?.knowledge.knownTraversalBlockers.has(wall.id),
    ).toBe(false);
  });
});
