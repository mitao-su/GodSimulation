import type { Facing, WorldView } from "@god-sim/protocol";

import type { StaticAssetResource } from "./asset-catalog";

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

// 家具装饰与可交互实体共享按脚底行号排序的绘制层。
const depthLayer = 15;
const neighbors = [
  { dx: 0, dy: -1, bit: 1 },
  { dx: 1, dy: 0, bit: 2 },
  { dx: 0, dy: 1, bit: 4 },
  { dx: -1, dy: 0, bit: 8 },
] as const;

function animationForStatus(status: string): RenderAnimationId {
  if (status === "move") return "walk";
  if (status === "interact_object") return "interact";
  return "idle";
}

function gridKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function depthGroup(entity: RenderEntity): number {
  return entity.kind === "tile" ? Math.min(entity.renderLayer, depthLayer) : depthLayer;
}

function depthPriority(entity: RenderEntity): number {
  if (entity.kind === "agent") return 3;
  if (entity.kind === "object") return 1;
  return entity.renderLayer > depthLayer ? 2 : 0;
}

export function projectWorldView(
  view: WorldView,
  resources: ReadonlyMap<string, StaticAssetResource>,
): readonly RenderEntity[] {
  const baseY = (entity: RenderEntity): number =>
    entity.gridPosition.y + (resources.get(entity.resourceId)?.gridAnchor?.y ?? 1);
  const connections = new Map<string, string>();
  for (const entity of view.entities) {
    if (entity.kind !== "object") continue;
    const group = resources.get(entity.resourceId)?.connectionGroup;
    if (group) connections.set(gridKey(entity.position.x, entity.position.y), group);
  }

  const tiles: RenderEntity[] = view.map.tiles.map((tile, index) => ({
    entityId: `tile:${tile.renderLayer}:${tile.position.x}:${tile.position.y}:${index}`,
    kind: "tile",
    resourceId: tile.resourceId,
    frameId: floorFrame(tile, resources.get(tile.resourceId)),
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
    frameId: entity.kind === "object"
      ? objectFrame(entity, resources.get(entity.resourceId), connections)
      : null,
    animationId: entity.kind === "agent"
      ? animationForStatus(view.mode === "RUNNING" ? entity.status : "idle")
      : null,
    gridPosition: entity.position,
    facing: entity.facing,
    renderLayer: entity.renderLayer,
    status: entity.status,
    selectable: true,
  }));
  return [...tiles, ...entities].sort(
    (left, right) =>
      depthGroup(left) - depthGroup(right) ||
      baseY(left) - baseY(right) ||
      depthPriority(left) - depthPriority(right) ||
      left.renderLayer - right.renderLayer ||
      left.gridPosition.x - right.gridPosition.x ||
      left.entityId.localeCompare(right.entityId),
  );
}

function floorFrame(tile: WorldView["map"]["tiles"][number], resource?: StaticAssetResource): string {
  if (tile.renderLayer !== 0 || !resource) return tile.frameId;
  const { x, y } = tile.position;
  const hash = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77);
  const variant = hash >>> 30;
  const key = `${tile.frameId}.${variant}`;
  return resource.frames[key] ? key : tile.frameId;
}

function objectFrame(
  entity: WorldView["entities"][number],
  resource: StaticAssetResource | undefined,
  connections: ReadonlyMap<string, string>,
): string {
  if (!resource) return entity.facing;
  const state = `${entity.facing}.${entity.status}`;
  if (resource.frames[state]) return state;

  const group = resource.connectionGroup;
  if (group) {
    const { x, y } = entity.position;
    const mask = neighbors.reduce<number>(
      (value, { dx, dy, bit }) => connections.get(gridKey(x + dx, y + dy)) === group
        ? value | bit
        : value,
      0,
    );
    const joined = `join-${mask}`;
    if (resource.frames[joined]) return joined;
  }
  return resource.frames[entity.facing] ? entity.facing : "default";
}
