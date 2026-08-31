import type { Facing, WorldView } from "@god-sim/protocol";

export type RenderKind = "tile" | "object" | "agent";
export type RenderAnimationId = "idle" | "walk" | "interact";

export interface RenderEntity {
  readonly entityId: string;
  readonly kind: RenderKind;
  readonly resourceId: string;
  readonly frameId: string | null;
  readonly animationId: RenderAnimationId | null;
  readonly gridPosition: { readonly x: number; readonly y: number };
  readonly facing: Facing;
  readonly renderLayer: number;
  readonly status: string;
  readonly selectable: boolean;
}

function animationForStatus(status: string): RenderAnimationId {
  if (status === "move") return "walk";
  if (status === "interact_object") return "interact";
  return "idle";
}

export function projectWorldView(view: WorldView): readonly RenderEntity[] {
  const tiles: RenderEntity[] = view.map.tiles.map((tile, index) => ({
    entityId: `tile:${tile.renderLayer}:${tile.position.x}:${tile.position.y}:${index}`,
    kind: "tile",
    resourceId: tile.resourceId,
    frameId: tile.frameId,
    animationId: null,
    gridPosition: tile.position,
    facing: "south",
    renderLayer: tile.renderLayer,
    status: "static",
    selectable: false,
  }));
  const entities: RenderEntity[] = view.entities.map((entity) => ({
    entityId: entity.entityId,
    kind: entity.kind,
    resourceId: entity.resourceId,
    frameId: entity.kind === "object" ? entity.facing : null,
    animationId: entity.kind === "agent" ? animationForStatus(entity.status) : null,
    gridPosition: entity.position,
    facing: entity.facing,
    renderLayer: entity.renderLayer,
    status: entity.status,
    selectable: true,
  }));
  return [...tiles, ...entities].sort(
    (left, right) =>
      left.renderLayer - right.renderLayer ||
      left.gridPosition.y - right.gridPosition.y ||
      left.gridPosition.x - right.gridPosition.x ||
      left.entityId.localeCompare(right.entityId),
  );
}
