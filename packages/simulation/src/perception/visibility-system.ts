import { FOV } from "rot-js";

import {
  EntityIdSchema,
  type AgentId,
  type EntityId,
} from "@god-sim/protocol";

import type {
  KnownAgentState,
  KnownObjectState,
  ObservedAgentValue,
  ObservedObjectValue,
} from "./agent-knowledge";
import type { PerceptionCandidate } from "./perception-recorder";
import { observeObject } from "./observable-state";
import { ZoneIndex } from "../map/zone-index";
import type { PluginRegistry } from "../world/plugin-registry";
import { SpatialIndex } from "../world/spatial-index";
import type { WorldState } from "../world/world-state";

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function computeVisibleCells(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
  radius = Math.max(world.map.width, world.map.height),
): ReadonlySet<string> {
  const agent = world.agents.get(agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${agentId}`);
  const spatial = new SpatialIndex(world, registry);
  const visible = new Set<string>();
  const lightPasses = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= world.map.width || y >= world.map.height) return false;
    return spatial.occludingObjectsAt({ x, y }, agentId).length === 0;
  };
  const fov = new FOV.PreciseShadowcasting(lightPasses, { topology: 8 });
  fov.compute(agent.position.x, agent.position.y, radius, (x, y, distance, visibility) => {
    void distance;
    if (visibility > 0 && x >= 0 && y >= 0 && x < world.map.width && y < world.map.height) {
      visible.add(cellKey(x, y));
    }
  });
  return visible;
}

function objectObservationChanged(
  previous: KnownObjectState | undefined,
  current: ObservedObjectValue,
): boolean {
  return (
    previous === undefined ||
    previous.status !== current.status ||
    previous.summary !== current.summary ||
    previous.position.x !== current.position.x ||
    previous.position.y !== current.position.y ||
    JSON.stringify(previous.observable) !== JSON.stringify(current.observable)
  );
}

function agentObservationChanged(
  previous: KnownAgentState | undefined,
  current: ObservedAgentValue,
): boolean {
  return (
    previous === undefined ||
    previous.displayName !== current.displayName ||
    previous.position.x !== current.position.x ||
    previous.position.y !== current.position.y
  );
}

export interface PerceptionScan {
  readonly agentId: AgentId;
  readonly zoneId: string;
  readonly visibleEntityIds: ReadonlySet<EntityId>;
  readonly candidates: readonly PerceptionCandidate[];
}

export function collectPerceptionCandidates(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
): PerceptionScan {
  const agent = world.agents.get(agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${agentId}`);
  const visibleCells = computeVisibleCells(world, registry, agentId);
  const visibleEntityIds = new Set<EntityId>();
  const candidates: PerceptionCandidate[] = [];

  for (const object of [...world.objects.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (!visibleCells.has(cellKey(object.position.x, object.position.y))) continue;
    visibleEntityIds.add(object.id);
    const current = observeObject(world, registry, agentId, object);
    if (!objectObservationChanged(agent.knowledge.objects.get(object.id), current)) {
      continue;
    }
    candidates.push({
      agentId,
      observationKind: "vision",
      summary: current.summary,
      relatedEntityId: object.id,
      subject: { kind: "object", value: current },
    });
  }

  for (const other of [...world.agents.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (
      other.id === agentId ||
      !visibleCells.has(cellKey(other.position.x, other.position.y))
    ) {
      continue;
    }
    const entityId = EntityIdSchema.parse(other.id);
    visibleEntityIds.add(entityId);
    const current: ObservedAgentValue = {
      agentId: other.id,
      displayName: other.displayName,
      position: other.position,
      observedAtTick: world.tick,
    };
    if (!agentObservationChanged(agent.knowledge.agents.get(other.id), current)) {
      continue;
    }
    candidates.push({
      agentId,
      observationKind: "vision",
      summary: `${other.displayName} is nearby`,
      relatedEntityId: entityId,
      subject: { kind: "agent", value: current },
    });
  }

  return {
    agentId,
    zoneId: new ZoneIndex(world.map).at(agent.position)?.id ?? agent.knowledge.zoneId,
    visibleEntityIds,
    candidates,
  };
}

export function applyPerceptionVisibility(
  world: WorldState,
  scan: PerceptionScan,
): WorldState {
  const agent = world.agents.get(scan.agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${scan.agentId}`);
  return {
    ...world,
    agents: new Map(world.agents).set(scan.agentId, {
      ...agent,
      knowledge: {
        ...agent.knowledge,
        zoneId: scan.zoneId,
        visibleEntityIds: scan.visibleEntityIds,
      },
    }),
  };
}
