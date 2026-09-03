import {
  JsonValueSchema,
  PluginLockHashSchema,
  SimulationRulesLockSchema,
  type AgentId,
  type Coordinate,
  type EntityId,
  type SimulationRulesLock,
} from "@god-sim/protocol";

import { MapDefinitionSchema, type MapDefinition } from "./map-definition";
import { ZoneIndex } from "./zone-index";
import type { PluginRegistry } from "../world/plugin-registry";
import {
  bladderSensation,
  type AgentState,
  type ObjectInstance,
  type WorldState,
} from "../world/world-state";
import { createEmptyTaskTracks } from "../execution/task-tracks";
import { createEmptyKnowledge } from "../perception/agent-knowledge";

const DEFAULT_PLUGIN_LOCK_HASH = "0".repeat(64);

export interface WorldLoadOptions {
  readonly simulationRulesLock: SimulationRulesLock;
  readonly reviewRequired?: boolean;
  readonly seed?: number;
  readonly pluginLockHash?: string;
}

export type InitialPerceptionSeed =
  | {
      readonly kind: "memory";
      readonly agentId: AgentId;
      readonly memoryId: string;
      readonly summary: string;
    }
  | {
      readonly kind: "known_object";
      readonly agentId: AgentId;
      readonly entityId: EntityId;
      readonly displayName: string;
      readonly position: Coordinate;
      readonly summary: string;
    };

export interface LoadedWorldDefinition {
  readonly world: WorldState;
  readonly initialPerceptions: readonly InitialPerceptionSeed[];
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

function initialPerceptionSeeds(
  spawn: MapDefinition["spawns"][number],
  objects: ReadonlyMap<ObjectInstance["id"], ObjectInstance>,
  registry: PluginRegistry,
  initialMemories: readonly { readonly id: string; readonly summary: string }[],
): readonly InitialPerceptionSeed[] {
  assertUnique(`known object ID for ${spawn.agentId}`, spawn.knownObjectIds);
  assertUnique(
    `initial memory ID for ${spawn.agentId}`,
    initialMemories.map((memory) => memory.id),
  );
  const seeds: InitialPerceptionSeed[] = initialMemories.map((memory) => ({
    kind: "memory",
    agentId: spawn.agentId,
    memoryId: memory.id,
    summary: memory.summary,
  }));

  for (const entityId of spawn.knownObjectIds) {
    const object = objects.get(entityId);
    if (!object) {
      throw new Error(`Agent ${spawn.agentId} knows missing object ${entityId}`);
    }
    const definition = registry.getObject(object.definitionId)?.definition;
    if (!definition) throw new Error(`Known object ${entityId} has no plugin definition`);
    seeds.push({
      kind: "known_object",
      agentId: spawn.agentId,
      entityId,
      displayName: definition.displayName,
      summary: `Remembers where ${definition.displayName} is`,
      position: object.position,
    });
  }

  return seeds;
}

export function loadWorldDefinition(
  input: unknown,
  registry: PluginRegistry,
  options: WorldLoadOptions,
): LoadedWorldDefinition {
  const map = MapDefinitionSchema.parse(input);
  const simulationRulesLock = SimulationRulesLockSchema.parse(options.simulationRulesLock);
  if (
    simulationRulesLock.rules.id !== map.rules.id ||
    simulationRulesLock.rules.version !== map.rules.version
  ) {
    throw new Error("Simulation rules lock does not match the world rule reference");
  }
  const referencedPlugins = validatePluginReferences(map, registry);

  for (const region of map.floorRegions) assertRegionInBounds("Floor region", region, map);
  assertUnique(
    "decoration ID",
    map.decorations.map((decoration) => decoration.id),
  );
  for (const decoration of map.decorations) {
    assertCoordinateInBounds(`Decoration ${decoration.id}`, decoration.position, map);
  }
  for (const zone of map.zones) assertRegionInBounds(`Zone ${zone.id}`, zone, map);
  assertUnique(
    "zone ID",
    map.zones.map((zone) => zone.id),
  );
  const zoneIndex = new ZoneIndex(map);

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
  const initialPerceptions: InitialPerceptionSeed[] = [];
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
    const zoneId = zoneIndex.at(spawn.position)?.id;
    if (!zoneId) throw new Error(`Agent ${spawn.agentId} does not spawn inside a named zone`);
    initialPerceptions.push(
      ...initialPerceptionSeeds(
        spawn,
        objects,
        registry,
        registered.definition.initialMemories,
      ),
    );
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
      taskTracks: createEmptyTaskTracks(),
      activeOperations: new Map(),
      pendingOperationResults: [],
      knowledge: createEmptyKnowledge(zoneId),
      memories: [],
    });
  }

  return {
    world: {
      id: map.id,
      name: map.name,
      version: 0,
      tick: 0,
      mode: "THINKING",
      suspendedMode: null,
      reviewRequired: options.reviewRequired ?? true,
      randomState: (options.seed ?? 1) >>> 0,
      lastEventSequence: 0,
      pluginLockHash: PluginLockHashSchema.parse(
        options.pluginLockHash ?? DEFAULT_PLUGIN_LOCK_HASH,
      ),
      simulationRulesLock,
      history: { mode: "strict", causalFromSequence: 1 },
      map,
      agents,
      objects,
      decisionCycle: null,
      technicalFailure: null,
    },
    initialPerceptions: initialPerceptions.sort(
      (left, right) =>
        left.agentId.localeCompare(right.agentId) ||
        left.kind.localeCompare(right.kind) ||
        (left.kind === "memory" ? left.memoryId : left.entityId).localeCompare(
          right.kind === "memory" ? right.memoryId : right.entityId,
        ),
    ),
  };
}
