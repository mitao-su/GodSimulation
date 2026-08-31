import {
  JsonValueSchema,
  WorldSnapshotV2Schema,
  type EventId,
  type JsonValue,
  type WorldSnapshotV2,
} from "@god-sim/protocol";

import type { WorldState } from "../world/world-state";
import {
  assertSnapshotCausality,
  eventSequenceInWorld,
} from "./snapshot-causality";

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

function collectCausalEventIds(world: WorldState): readonly EventId[] {
  const sourceIds = new Set<EventId>();
  for (const agent of world.agents.values()) {
    for (const value of agent.knowledge.objects.values()) {
      sourceIds.add(value.sourceEventId);
    }
    for (const value of agent.knowledge.agents.values()) {
      sourceIds.add(value.sourceEventId);
    }
    for (const value of agent.knowledge.knownTraversalBlockers.values()) {
      sourceIds.add(value.sourceEventId);
    }
    for (const memory of agent.memories) {
      sourceIds.add(memory.sourceEventId);
    }
  }

  return [...sourceIds]
    .filter((eventId) => {
      if (world.history.mode === "strict") return true;
      const sequence = eventSequenceInWorld(world.id, eventId);
      return sequence !== null && sequence >= world.history.causalFromSequence;
    })
    .sort((left, right) => {
      const leftSequence = eventSequenceInWorld(world.id, left);
      const rightSequence = eventSequenceInWorld(world.id, right);
      if (leftSequence === null || rightSequence === null) {
        return left.localeCompare(right);
      }
      return leftSequence - rightSequence || left.localeCompare(right);
    });
}

export function projectWorldSnapshot(world: WorldState): WorldSnapshotV2 {
  const snapshot = WorldSnapshotV2Schema.parse({
    schemaVersion: 2,
    worldId: world.id,
    worldVersion: world.version,
    worldTick: world.tick,
    lastEventSequence: world.lastEventSequence,
    pluginLockHash: world.pluginLockHash,
    history: world.history,
    causalEventIds: collectCausalEventIds(world),
    state: serializeWorldState(world),
  });
  assertSnapshotCausality(snapshot);
  return snapshot;
}
