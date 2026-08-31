import {
  JsonValueSchema,
  WorldSnapshotSchema,
  type JsonValue,
  type WorldSnapshot,
} from "@god-sim/protocol";

import type { WorldState } from "../world/world-state";

function serializeWorldState(world: WorldState): JsonValue {
  return JsonValueSchema.parse({
    name: world.name,
    mode: world.mode,
    suspendedMode: world.suspendedMode,
    reviewRequired: world.reviewRequired,
    randomState: world.randomState,
    map: world.map,
    agents: [...world.agents.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((agent) => ({
        ...agent,
        knowledge: {
          zoneId: agent.knowledge.zoneId,
          objects: [...agent.knowledge.objects.values()].sort((left, right) =>
            left.entityId.localeCompare(right.entityId),
          ),
          agents: [...agent.knowledge.agents.values()].sort((left, right) =>
            left.agentId.localeCompare(right.agentId),
          ),
          visibleEntityIds: [...agent.knowledge.visibleEntityIds].sort((left, right) =>
            left.localeCompare(right),
          ),
          knownTraversalBlockers: [...agent.knowledge.knownTraversalBlockers.values()].sort(
            (left, right) => left.entityId.localeCompare(right.entityId),
          ),
        },
      })),
    objects: [...world.objects.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    decisionCycle:
      world.decisionCycle === null
        ? null
        : {
            id: world.decisionCycle.id,
            baseWorldVersion: world.decisionCycle.baseWorldVersion,
            requestedAgentIds: world.decisionCycle.requestedAgentIds,
            requests: [...world.decisionCycle.requests.entries()]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([agentId, request]) => ({ agentId, ...request })),
          },
    technicalFailure: world.technicalFailure,
  });
}

export function projectWorldSnapshot(world: WorldState): WorldSnapshot {
  return WorldSnapshotSchema.parse({
    schemaVersion: 1,
    worldId: world.id,
    worldVersion: world.version,
    worldTick: world.tick,
    lastEventSequence: world.lastEventSequence,
    pluginLockHash: world.pluginLockHash,
    state: serializeWorldState(world),
  });
}
