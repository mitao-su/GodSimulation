import {
  EntityIdSchema,
  WorldViewSchema,
  type AgentId,
  type DomainEvent,
  type WorldView,
} from "@god-sim/protocol";
import { ObservationContextSchema } from "@god-sim/plugin-sdk";

import type { PluginRegistry } from "../world/plugin-registry";
import { projectGameTime } from "../world/game-time";
import type {
  AgentState,
  DecisionRequestState,
  WorldState,
} from "../world/world-state";

function decisionTrackProposal(
  request: DecisionRequestState,
  track: "HEAD" | "BODY",
): WorldView["pendingDecisions"][number]["headProposal"] {
  const proposal = request.acceptedProposal;
  if (!proposal) return null;
  const selection = track === "HEAD" ? proposal.head : proposal.body;
  if (selection.kind === "continue") {
    return { kind: "continue", label: `Continue current ${track} task` };
  }
  const option = request.promptInput.taskOptions.find(
    (candidate) => candidate.id === selection.taskOptionId,
  );
  if (!option) {
    throw new Error(
      `Accepted decision references missing task option ${selection.taskOptionId}`,
    );
  }
  return {
    kind: "replace",
    taskOptionId: selection.taskOptionId,
    label: option.label,
    arguments: selection.arguments,
  };
}

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
  if (request.failure) return "error";
  return request.acceptedProposal === null ? "thinking" : "ready";
}

function taskView(
  agent: AgentState,
  track: "HEAD" | "BODY",
): WorldView["agents"][number]["headTask"] {
  const state = agent.taskTracks[track];
  if (state.kind === "empty") return { kind: "empty", label: null };
  const operation = agent.activeOperations.get(state.callId);
  if (!operation) {
    throw new Error(`${agent.id} ${track} references missing call ${state.callId}`);
  }
  return {
    kind: "operation",
    callId: operation.callId,
    operationId: operation.operationId,
    label: operation.label,
    duration: operation.duration,
    progressTicks: operation.progressTicks,
  };
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
    const activeCallId = [agent.taskTracks.HEAD, agent.taskTracks.BODY]
      .find((track) => track.kind === "operation")?.callId;
    const operation = activeCallId
      ? agent.activeOperations.get(activeCallId)
      : undefined;
    const action = operation?.plan.actions[operation.plan.currentActionIndex];
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
    gameTime: projectGameTime(world.tick, world.simulationRulesLock.rules.time),
    mode: world.mode,
    reviewRequired: world.reviewRequired,
    pauseReason: pauseReason(world),
    map: mapView(world),
    entities: renderEntities(world, registry),
    agents: [...world.agents.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((agent) => {
        return {
          agentId: agent.id,
          displayName: agent.displayName,
          headTask: taskView(agent, "HEAD"),
          bodyTask: taskView(agent, "BODY"),
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
        const error = request.failure;
        return {
          requestId: request.identity.requestId,
          agentId,
          status: error ? "error" : request.acceptedProposal === null ? "pending" : "ready",
          reason: request.promptInput.decisionReason.summary,
          proposalReason: request.acceptedProposal?.reason ?? null,
          headProposal: decisionTrackProposal(request, "HEAD"),
          bodyProposal: decisionTrackProposal(request, "BODY"),
          error,
        };
      }) ?? [],
    recentEvents,
    technicalFailure: world.technicalFailure,
  });
}
