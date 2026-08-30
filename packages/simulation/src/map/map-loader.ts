import { JsonValueSchema, PluginLockHashSchema } from "@god-sim/protocol";

import { MapDefinitionSchema, type MapDefinition } from "./map-definition";
import { ZoneIndex } from "./zone-index";
import type { PluginRegistry } from "../world/plugin-registry";
import {
  bladderSensation,
  type AgentState,
  type ObjectInstance,
  type WorldState,
} from "../world/world-state";
import { createEmptyBodySlots } from "../execution/body-slots";

const DEFAULT_PLUGIN_LOCK_HASH = "0".repeat(64);

export interface WorldLoadOptions {
  readonly reviewRequired?: boolean;
  readonly seed?: number;
  readonly pluginLockHash?: string;
}

function assertRegionInBounds(
  label: string,
  region: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  map: MapDefinition,
): void {
  if (region.x + region.width > map.width || region.y + region.height > map.height) {
    throw new Error(`${label} leaves map bounds`);
  }
}

function assertCoordinateInBounds(
  label: string,
  position: { readonly x: number; readonly y: number },
  map: MapDefinition,
): void {
  if (position.x < 0 || position.y < 0 || position.x >= map.width || position.y >= map.height) {
    throw new Error(`${label} leaves map bounds at ${position.x},${position.y}`);
  }
}

function assertUnique(label: string, values: readonly string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function validatePluginReferences(map: MapDefinition, registry: PluginRegistry): Set<string> {
  assertUnique(
    "plugin reference",
    map.plugins.map((plugin) => plugin.id),
  );
  const referenced = new Set<string>();
  for (const pluginReference of map.plugins) {
    const plugin = registry.plugins.get(pluginReference.id);
    if (!plugin) throw new Error(`Map requires missing plugin: ${pluginReference.id}`);
    if (plugin.manifest.version !== pluginReference.version) {
      throw new Error(
        `Plugin version mismatch for ${pluginReference.id}: map requires ${pluginReference.version}, registry has ${plugin.manifest.version}`,
      );
    }
    referenced.add(pluginReference.id);
  }
  return referenced;
}

export function loadWorldDefinition(
  input: unknown,
  registry: PluginRegistry,
  options: WorldLoadOptions = {},
): WorldState {
  const map = MapDefinitionSchema.parse(input);
  const referencedPlugins = validatePluginReferences(map, registry);

  for (const region of map.floorRegions) assertRegionInBounds("Floor region", region, map);
  for (const zone of map.zones) assertRegionInBounds(`Zone ${zone.id}`, zone, map);
  assertUnique(
    "zone ID",
    map.zones.map((zone) => zone.id),
  );
  new ZoneIndex(map);

  assertUnique(
    "entity instance ID",
    map.objects.map((object) => object.id),
  );
  const objects = new Map<ObjectInstance["id"], ObjectInstance>();
  for (const placement of map.objects) {
    const registered = registry.getObject(placement.definitionId);
    if (!registered) {
      throw new Error(`Object ${placement.id} uses missing definition ${placement.definitionId}`);
    }
    if (!referencedPlugins.has(registered.ownerPluginId)) {
      throw new Error(
        `Object ${placement.id} uses ${placement.definitionId} from unreferenced plugin ${registered.ownerPluginId}`,
      );
    }
    for (const offset of registered.definition.placement.footprint) {
      assertCoordinateInBounds(
        `Object ${placement.id} footprint`,
        { x: placement.position.x + offset.x, y: placement.position.y + offset.y },
        map,
      );
    }

    try {
      const parsedState = registered.definition.stateSchema.parse(
        placement.state ?? registered.definition.initialState(),
      );
      objects.set(placement.id, {
        id: placement.id,
        definitionId: placement.definitionId,
        version: 0,
        position: placement.position,
        facing: placement.facing,
        state: JsonValueSchema.parse(parsedState),
      });
    } catch (error) {
      throw new Error(`Invalid state for object ${placement.id}`, { cause: error });
    }
  }

  assertUnique(
    "agent instance ID",
    map.spawns.map((spawn) => spawn.agentId),
  );
  const agents = new Map<AgentState["id"], AgentState>();
  for (const spawn of map.spawns) {
    const registered = registry.getAgent(spawn.definitionId);
    if (!registered) {
      throw new Error(`Agent ${spawn.agentId} uses missing definition ${spawn.definitionId}`);
    }
    if (!referencedPlugins.has(registered.ownerPluginId)) {
      throw new Error(
        `Agent ${spawn.agentId} uses ${spawn.definitionId} from unreferenced plugin ${registered.ownerPluginId}`,
      );
    }
    assertCoordinateInBounds(`Agent ${spawn.agentId}`, spawn.position, map);
    agents.set(spawn.agentId, {
      id: spawn.agentId,
      definitionId: spawn.definitionId,
      displayName: registered.definition.displayName,
      resourceId: registered.definition.resourceId,
      animationSetId: registered.definition.animationSetId,
      position: spawn.position,
      facing: spawn.facing,
      bladder: spawn.needs.bladder,
      bladderSensation: bladderSensation(spawn.needs.bladder),
      currentGoal: null,
      actionPlan: null,
      bodySlots: createEmptyBodySlots(),
    });
  }

  return {
    id: map.id,
    name: map.name,
    version: 0,
    tick: 0,
    mode: "THINKING",
    reviewRequired: options.reviewRequired ?? true,
    randomState: (options.seed ?? 1) >>> 0,
    lastEventSequence: 0,
    pluginLockHash: PluginLockHashSchema.parse(
      options.pluginLockHash ?? DEFAULT_PLUGIN_LOCK_HASH,
    ),
    map,
    agents,
    objects,
    decisionCycle: null,
    technicalFailure: null,
  };
}
