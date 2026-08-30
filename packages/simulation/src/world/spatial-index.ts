import type { AgentId, Coordinate, EntityId } from "@god-sim/protocol";

import type { PluginRegistry } from "./plugin-registry";
import type { ObjectInstance, WorldState } from "./world-state";

function key(position: Coordinate): string {
  return `${position.x},${position.y}`;
}

function translate(origin: Coordinate, offset: { readonly x: number; readonly y: number }): Coordinate {
  return { x: origin.x + offset.x, y: origin.y + offset.y };
}

export class SpatialIndex {
  readonly #world: WorldState;
  readonly #registry: PluginRegistry;
  readonly #objectsByCell = new Map<string, ObjectInstance[]>();

  constructor(world: WorldState, registry: PluginRegistry) {
    this.#world = world;
    this.#registry = registry;

    for (const object of world.objects.values()) {
      const registered = registry.getObject(object.definitionId);
      if (!registered) throw new Error(`Unknown object definition: ${object.definitionId}`);
      for (const offset of registered.definition.placement.footprint) {
        const cell = translate(object.position, offset);
        const existing = this.#objectsByCell.get(key(cell)) ?? [];
        existing.push(object);
        this.#objectsByCell.set(key(cell), existing);
      }
    }
  }

  objectsAt(position: Coordinate): readonly ObjectInstance[] {
    return this.#objectsByCell.get(key(position)) ?? [];
  }

  blockingObjectsAt(position: Coordinate, queryingAgentId?: AgentId): readonly ObjectInstance[] {
    return this.objectsAt(position).filter((object) => {
      const registered = this.#registry.getObject(object.definitionId);
      if (!registered?.definition.movement) return false;
      const state = registered.definition.stateSchema.parse(object.state) as Readonly<unknown>;
      return registered.definition.movement.blocksMovement(state, {
        worldTick: this.#world.tick,
        ...(queryingAgentId === undefined ? {} : { queryingAgentId }),
      });
    });
  }

  occludingObjectsAt(position: Coordinate, queryingAgentId?: AgentId): readonly ObjectInstance[] {
    return this.objectsAt(position).filter((object) => {
      const registered = this.#registry.getObject(object.definitionId);
      if (!registered?.definition.vision) return false;
      const state = registered.definition.stateSchema.parse(object.state) as Readonly<unknown>;
      return registered.definition.vision.blocksVision(state, {
        worldTick: this.#world.tick,
        ...(queryingAgentId === undefined ? {} : { queryingAgentId }),
      });
    });
  }

  interactionPositions(entityId: EntityId): readonly Coordinate[] {
    const object = this.#world.objects.get(entityId);
    if (!object) throw new Error(`Unknown object instance: ${entityId}`);
    const registered = this.#registry.getObject(object.definitionId);
    if (!registered) throw new Error(`Unknown object definition: ${object.definitionId}`);
    return registered.definition.placement.interactionOffsets.map((offset) =>
      translate(object.position, offset),
    );
  }

  occupant(entityId: EntityId): string | null {
    const object = this.#world.objects.get(entityId);
    if (!object) throw new Error(`Unknown object instance: ${entityId}`);
    const registered = this.#registry.getObject(object.definitionId);
    if (!registered?.definition.occupancy) return null;
    const state = registered.definition.stateSchema.parse(object.state) as Readonly<unknown>;
    return registered.definition.occupancy.occupant(state);
  }
}
