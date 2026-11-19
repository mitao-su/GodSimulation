import { describe, expect, it } from "vitest";

import { EntityIdSchema, WorldViewSchema, type WorldView } from "@god-sim/protocol";

import { type StaticAssetResource } from "./asset-catalog";
import { projectWorldView } from "./render-projection";

function resource(id: string, frameIds: readonly string[], connectionGroup?: string): StaticAssetResource {
  const frame = { sheetId: "test", x: 0, y: 0, width: 16, height: 16 };
  return {
    id,
    anchor: { x: 0, y: 0 },
    frames: Object.fromEntries(frameIds.map((id) => [id, frame])),
    ...(connectionGroup ? { connectionGroup } : {}),
  };
}

const resources = new Map([
  resource("modern-pixel.floor", ["living-wood", "living-wood.1", "living-wood.2", "living-wood.3"]),
  resource("modern-pixel.wall", ["default", "join-3"], "partition"),
  resource("modern-pixel.door", ["east.open", "east.closed"], "partition"),
].map((resource) => [resource.id, resource]));

function worldView(): WorldView {
  return WorldViewSchema.parse({
    schemaVersion: 1,
    revision: 1,
    worldId: "starter-world",
    worldName: "Starter Home",
    worldVersion: 1,
    worldTick: 4,
    gameTime: { day: 1, hour: 8, minute: 0 },
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
          resourceId: "modern-pixel.floor",
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
        resourceId: "starter-agents.modern-pixel.alice",
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
    const projected = projectWorldView(worldView(), resources);
    const alice = projected.find((entity) => entity.entityId === "alice");

    expect(alice).toMatchObject({
      entityId: "alice",
      kind: "agent",
      resourceId: "starter-agents.modern-pixel.alice",
      animationId: "walk",
      facing: "east",
      gridPosition: { x: 2, y: 3 },
    });
    expect(JSON.stringify(alice)).not.toContain(".png");
  });

  it("orders floor tiles below selectable entities", () => {
    const projected = projectWorldView(worldView(), resources);

    expect(projected.map((entity) => entity.kind)).toEqual(["tile", "agent"]);
    expect(projected[0]).toMatchObject({
      resourceId: "modern-pixel.floor",
      frameId: "living-wood",
      renderLayer: 0,
    });
  });

  it("maps a generic object interaction to the interact animation", () => {
    const view = worldView();
    const interacting = WorldViewSchema.parse({
      ...view,
      entities: view.entities.map((entity) =>
        entity.entityId === "alice"
          ? { ...entity, status: "interact_object" }
          : entity,
      ),
    });

    expect(
      projectWorldView(interacting, resources).find((entity) => entity.entityId === "alice"),
    ).toMatchObject({ animationId: "interact" });
    expect(
      projectWorldView({ ...interacting, mode: "READY_FOR_RELEASE" }, resources).find(
        (entity) => entity.entityId === "alice",
      ),
    ).toMatchObject({ animationId: "idle" });
  });

  it("selects the side profile of a west-facing appliance", () => {
    const appliance = resource("modern-pixel.refrigerator", ["default", "west"]);
    const view = worldView();
    const fridge = {
      entityId: EntityIdSchema.parse("fridge-1"), kind: "object", displayName: "Refrigerator",
      resourceId: appliance.id, position: { x: 8, y: 1 }, facing: "west",
      renderLayer: 20, status: "available",
    } as const;
    const catalog = new Map(resources).set(appliance.id, appliance);
    expect(projectWorldView({ ...view, entities: [fridge] }, catalog).find(
      ({ entityId }) => entityId === fridge.entityId,
    )).toMatchObject({ frameId: "west" });
  });

  it("joins the wall through its doorway and keeps the visible door leaf in sync", () => {
    const object = {
      kind: "object" as const, displayName: "Wall", resourceId: "modern-pixel.wall",
      facing: "north" as const, renderLayer: 20, status: "solid",
    };
    const view = worldView();
    for (const status of ["closed", "open"] as const) {
      const walls = WorldViewSchema.parse({
        ...view,
        entities: [
          { ...object, entityId: "north-wall", position: { x: 5, y: 0 } },
          { ...object, entityId: "corner-wall", position: { x: 5, y: 1 } },
          {
            ...object, entityId: "east-door", resourceId: "modern-pixel.door",
            position: { x: 6, y: 1 }, facing: "east", status,
          },
        ],
      });
      const frames = new Map(projectWorldView(walls, resources).map(
        (entity) => [entity.entityId, entity.frameId],
      ));
      expect(frames.get("corner-wall")).toBe("join-3");
      expect(frames.get("east-door")).toBe("east." + status);
    }
  });

  it("draws a character between furnishings behind and in front of their feet", () => {
    const world = worldView();
    const furniture = {
      resourceId: "modern-pixel.furniture", frameId: "desk", renderLayer: 15,
    };
    const furnished = {
      ...world,
      map: {
        ...world.map,
        tiles: [
          { ...furniture, position: { x: 2, y: 4 } },
          { ...furniture, position: { x: 2, y: 2 } },
          ...world.map.tiles,
        ],
      },
    };
    expect(projectWorldView(furnished, resources).map(({ gridPosition }) => gridPosition.y))
      .toEqual([0, 2, 3, 4]);
  });
});
