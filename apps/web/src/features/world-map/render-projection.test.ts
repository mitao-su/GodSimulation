import { describe, expect, it } from "vitest";

import { WorldViewSchema, type WorldView } from "@god-sim/protocol";

import { projectWorldView } from "./render-projection";

function worldView(): WorldView {
  return WorldViewSchema.parse({
    schemaVersion: 1,
    revision: 1,
    worldId: "starter-world",
    worldName: "Starter Home",
    worldVersion: 1,
    worldTick: 4,
    mode: "RUNNING",
    reviewRequired: true,
    pauseReason: null,
    map: {
      width: 18,
      height: 12,
      tileSize: 16,
      zones: [],
      tiles: [
        {
          position: { x: 0, y: 0 },
          resourceId: "pixel-16-interiors.floor",
          frameId: "living-wood",
          renderLayer: 0,
        },
      ],
    },
    entities: [
      {
        entityId: "alice",
        kind: "agent",
        displayName: "Alice",
        resourceId: "starter-agents.memao.alice",
        position: { x: 2, y: 3 },
        facing: "east",
        renderLayer: 30,
        status: "move",
      },
    ],
    agents: [],
    pendingDecisions: [],
    recentEvents: [],
    technicalFailure: null,
  });
}

describe("world render projection", () => {
  it("keeps stable resource IDs and maps movement to the walk animation", () => {
    const projected = projectWorldView(worldView());
    const alice = projected.find((entity) => entity.entityId === "alice");

    expect(alice).toMatchObject({
      entityId: "alice",
      kind: "agent",
      resourceId: "starter-agents.memao.alice",
      animationId: "walk",
      facing: "east",
      gridPosition: { x: 2, y: 3 },
    });
    expect(JSON.stringify(alice)).not.toContain(".png");
  });

  it("orders floor tiles below selectable entities", () => {
    const projected = projectWorldView(worldView());

    expect(projected.map((entity) => entity.kind)).toEqual(["tile", "agent"]);
    expect(projected[0]).toMatchObject({
      resourceId: "pixel-16-interiors.floor",
      frameId: "living-wood",
      renderLayer: 0,
    });
  });
});
