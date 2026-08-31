import { FOV } from "rot-js";

import {
  EntityIdSchema,
  EventIdSchema,
  type AgentId,
  type EntityId,
} from "@god-sim/protocol";

import { detectPlanConflict, type PlanConflict } from "../decision/plan-conflict-detector";
import { formImmediateMemories } from "./immediate-memory";
import {
  type AgentKnowledge,
  type ImmediateMemory,
  type KnowledgeChange,
  type KnownAgentState,
} from "./agent-knowledge";
import { observeObject } from "./observable-state";
import { ZoneIndex } from "../map/zone-index";
import type { PluginRegistry } from "../world/plugin-registry";
import { SpatialIndex } from "../world/spatial-index";
import type { AgentState, WorldState } from "../world/world-state";

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

function observationChanged(previous: KnowledgeChange["previous"], current: KnowledgeChange["current"]): boolean {
  return (
    previous === null ||
    previous.status !== current.status ||
    previous.summary !== current.summary ||
    JSON.stringify(previous.observable) !== JSON.stringify(current.observable)
  );
}

export interface PerceptionUpdate {
  readonly agent: AgentState;
  readonly knowledge: AgentKnowledge;
  readonly memories: readonly ImmediateMemory[];
  readonly changes: readonly KnowledgeChange[];
  readonly conflict: PlanConflict | null;
  readonly decisionRequested: boolean;
}

export function refreshPerception(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
): PerceptionUpdate {
  const agent = world.agents.get(agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${agentId}`);
  const visibleCells = computeVisibleCells(world, registry, agentId);
  const objects = new Map(agent.knowledge.objects);
  const knownAgents = new Map(agent.knowledge.agents);
  const visibleEntityIds = new Set<EntityId>();
  const changes: KnowledgeChange[] = [];

  for (const object of [...world.objects.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!visibleCells.has(cellKey(object.position.x, object.position.y))) continue;
    visibleEntityIds.add(object.id);
    const sourceEventId = EventIdSchema.parse(
      `event:observation:${world.id}:${world.tick}:${agentId}:${object.id}:${object.version}`,
    );
    const current = observeObject(world, registry, agentId, object, sourceEventId);
    const previous = objects.get(object.id) ?? null;
    if (observationChanged(previous, current)) {
      changes.push({ previous, current });
      objects.set(object.id, current);
    }
  }

  for (const other of [...world.agents.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    if (other.id === agentId || !visibleCells.has(cellKey(other.position.x, other.position.y))) continue;
    const entityId = EntityIdSchema.parse(other.id);
    visibleEntityIds.add(entityId);
    const sourceEventId = EventIdSchema.parse(
      `event:observation:${world.id}:${world.tick}:${agentId}:${other.id}`,
    );
    const known: KnownAgentState = {
      agentId: other.id,
      displayName: other.displayName,
      position: other.position,
      sourceEventId,
      observedAtTick: world.tick,
    };
    knownAgents.set(other.id, known);
  }

  const zoneId = new ZoneIndex(world.map).at(agent.position)?.id ?? agent.knowledge.zoneId;
  const knowledge: AgentKnowledge = {
    zoneId,
    objects,
    agents: knownAgents,
    visibleEntityIds,
    knownTraversalBlockers: agent.knowledge.knownTraversalBlockers,
  };
  const memories = formImmediateMemories(agent.memories, changes);
  const updatedAgent = { ...agent, knowledge, memories };
  const conflict = detectPlanConflict(updatedAgent, changes);
  return {
    agent: updatedAgent,
    knowledge,
    memories,
    changes,
    conflict,
    decisionRequested: conflict !== null,
  };
}

export function applyPerceptionUpdate(world: WorldState, update: PerceptionUpdate): WorldState {
  return {
    ...world,
    agents: new Map(world.agents).set(update.agent.id, update.agent),
  };
}
