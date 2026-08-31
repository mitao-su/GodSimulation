import { Path } from "rot-js";

import type { AgentId, Coordinate, EntityId } from "@god-sim/protocol";

import type { KnownTraversalBlocker } from "../perception/agent-knowledge";
import type { PluginRegistry } from "../world/plugin-registry";
import { SpatialIndex } from "../world/spatial-index";
import type { WorldState } from "../world/world-state";

export interface AgentNavigationKnowledge {
  readonly knownTraversalBlockers: ReadonlyMap<EntityId, KnownTraversalBlocker>;
}

export type PathResult =
  | { readonly kind: "found"; readonly path: readonly Coordinate[] }
  | { readonly kind: "not_found" };

function pathKey(path: readonly Coordinate[]): string {
  return path.map((position) => `${position.x},${position.y}`).join("|");
}

export function findPath(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
  destinations: readonly Coordinate[],
  knowledge: AgentNavigationKnowledge,
): PathResult {
  const agent = world.agents.get(agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${agentId}`);
  const spatial = new SpatialIndex(world, registry);
  const candidates: Coordinate[][] = [];

  const passable = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= world.map.width || y >= world.map.height) return false;
    for (const object of spatial.objectsAt({ x, y })) {
      if (knowledge.knownTraversalBlockers.has(object.id)) return false;
      if (!spatial.objectBlocksMovement(object.id, agentId)) continue;
      const definition = registry.getObject(object.definitionId)?.definition;
      if (!definition?.traversal) return false;
    }
    return true;
  };

  for (const destination of destinations) {
    if (!passable(destination.x, destination.y)) continue;
    const path: Coordinate[] = [];
    const astar = new Path.AStar(destination.x, destination.y, passable, { topology: 4 });
    astar.compute(agent.position.x, agent.position.y, (x, y) => path.push({ x, y }));
    if (path.length > 0) candidates.push(path);
  }

  candidates.sort((left, right) => left.length - right.length || pathKey(left).localeCompare(pathKey(right)));
  const shortest = candidates[0];
  return shortest ? { kind: "found", path: shortest } : { kind: "not_found" };
}
