import {
  EntityIdSchema,
  WorldViewSchema,
  type AgentId,
  type DomainEvent,
  type WorldView,
} from "@god-sim/protocol";
import { ObservationContextSchema } from "@god-sim/plugin-sdk";

import type { PluginRegistry } from "../world/plugin-registry";
import type { AgentState, WorldState } from "../world/world-state";

function pauseReason(world: WorldState): WorldView["pauseReason"] {
  const cycle = world.decisionCycle;
  if (!cycle) return null;
  const requests = cycle.requestedAgentIds
    .map((agentId) => cycle.requests.get(agentId))
    .filter((request) => request !== undefined);
  if (requests.length === 0) return null;
  const codes = new Set(requests.map((request) => request.promptInput.decisionReason.code));
  return {
    code: codes.size === 1 ? requests[0]!.promptInput.decisionReason.code : "multiple_decisions",
    message: requests
      .map((request) => request.promptInput.decisionReason.summary)
      .join("; "),
    agentIds: [...cycle.requestedAgentIds],
  };
}

function mapView(world: WorldState): WorldView["map"] {
  const zones = world.map.zones.map((zone) => {
    const cells = [];
    for (let y = zone.y; y < zone.y + zone.height; y += 1) {
      for (let x = zone.x; x < zone.x + zone.width; x += 1) cells.push({ x, y });
    }
    return { id: zone.id, name: zone.name, cells };
  });
  const floorTiles = world.map.floorRegions.flatMap((region) => {
    const result = [];
    for (let y = region.y; y < region.y + region.height; y += 1) {
      for (let x = region.x; x < region.x + region.width; x += 1) {
        result.push({
          position: { x, y },
          resourceId: region.resourceId,
          frameId: region.frameId,
          renderLayer: 0,
        });
      }
    }
    return result;
  });
  const decorationTiles = world.map.decorations.map((decoration) => ({
    position: decoration.position,
    resourceId: decoration.resourceId,
    frameId: decoration.frameId,
    renderLayer: decoration.renderLayer,
  }));
  return {
    width: world.map.width,
    height: world.map.height,
    tileSize: world.map.tileSize,
    zones,
    tiles: [...floorTiles, ...decorationTiles],
  };
}

function perceivedSummaries(agent: AgentState): string[] {
  const objectSummaries = [...agent.knowledge.objects.values()]
    .filter((object) => agent.knowledge.visibleEntityIds.has(object.entityId))
    .map((object) => object.summary);
  const agentSummaries = [...agent.knowledge.agents.values()]
    .filter((knownAgent) =>
      agent.knowledge.visibleEntityIds.has(EntityIdSchema.parse(knownAgent.agentId)),
    )
    .map((knownAgent) => `${knownAgent.displayName} is nearby`);
  return [...objectSummaries, ...agentSummaries];
}

function decisionStatus(world: WorldState, agentId: AgentId): "none" | "thinking" | "ready" | "error" {
  const request = world.decisionCycle?.requests.get(agentId);
  if (!request) return "none";
  if (world.technicalFailure?.requestId === request.identity.requestId) return "error";
  return request.acceptedProposal === null ? "thinking" : "ready";
}

function renderEntities(world: WorldState, registry: PluginRegistry): WorldView["entities"] {
  const observerAgentId = [...world.agents.keys()].sort((left, right) =>
    left.localeCompare(right),
  )[0];
  if (!observerAgentId) throw new Error("A world view requires at least one agent");
  const objects = [...world.objects.values()].map((object) => {
    const registered = registry.getObject(object.definitionId);
    if (!registered) throw new Error(`Unknown object definition: ${object.definitionId}`);
    const state = registered.definition.stateSchema.parse(object.state);
    const observable = registered.definition.observe(
      state,
      ObservationContextSchema.parse({ kind: "vision", observerAgentId }),
    );
    return {
      entityId: object.id,
      kind: "object" as const,
      displayName: registered.definition.displayName,
      resourceId: registered.definition.resourceId,
      position: object.position,
      facing: object.facing,
      renderLayer: 20,
      status: observable.status,
    };
  });
  const agents = [...world.agents.values()].map((agent) => {
    const action = agent.actionPlan?.actions[agent.actionPlan.currentActionIndex];
    return {
      entityId: EntityIdSchema.parse(agent.id),
      kind: "agent" as const,
      displayName: agent.displayName,
      resourceId: agent.resourceId,
      position: agent.position,
      facing: agent.facing,
      renderLayer: 30,
      status: action?.kind ?? world.mode.toLowerCase(),
    };
  });
  return [...objects, ...agents].sort((left, right) => left.entityId.localeCompare(right.entityId));
}

export function projectWorldView(
  world: WorldState,
  registry: PluginRegistry,
  revision: number,
  recentEvents: readonly DomainEvent[],
): WorldView {
  return WorldViewSchema.parse({
    schemaVersion: 1,
    revision,
    worldId: world.id,
    worldName: world.name,
    worldVersion: world.version,
    worldTick: world.tick,
    mode: world.mode,
    reviewRequired: world.reviewRequired,
    pauseReason: pauseReason(world),
    map: mapView(world),
    entities: renderEntities(world, registry),
    agents: [...world.agents.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((agent) => {
        const action = agent.actionPlan?.actions[agent.actionPlan.currentActionIndex];
        return {
          agentId: agent.id,
          displayName: agent.displayName,
          currentGoalLabel: agent.currentGoal?.label ?? null,
          actionLabel: action?.kind ?? null,
          bladderLevel: agent.bladderSensation,
          decisionStatus: decisionStatus(world, agent.id),
          perceivedSummaries: perceivedSummaries(agent),
          memorySummaries: agent.memories.map((memory) => memory.summary),
        };
      }),
    pendingDecisions:
      world.decisionCycle?.requestedAgentIds.map((agentId) => {
        const request = world.decisionCycle!.requests.get(agentId);
        if (!request) throw new Error(`Missing decision request for ${agentId}`);
        const error =
          world.technicalFailure?.requestId === request.identity.requestId
            ? world.technicalFailure
            : null;
        return {
          requestId: request.identity.requestId,
          agentId,
          status: error ? "error" : request.acceptedProposal === null ? "pending" : "ready",
          reason: request.promptInput.decisionReason.summary,
          proposalReason: request.acceptedProposal?.reason ?? null,
          error,
        };
      }) ?? [],
    recentEvents,
    technicalFailure: world.technicalFailure,
  });
}
