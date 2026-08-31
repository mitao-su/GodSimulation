import {
  EntityIdSchema,
  type AgentId,
  type DomainEvent,
  type EntityId,
} from "@god-sim/protocol";

import type {
  ImmediateMemory,
  KnowledgeChange,
  ObservationKind,
  ObservedAgentValue,
  ObservedObjectValue,
} from "./agent-knowledge";
import { appendDomainEvent, type EventMetadata } from "../engine/event-writer";
import type { WorldState } from "../world/world-state";

export interface PerceptionCandidate {
  readonly agentId: AgentId;
  readonly observationKind: ObservationKind;
  readonly summary: string;
  readonly relatedEntityId: EntityId | null;
  readonly subject:
    | { readonly kind: "memory"; readonly memoryId: string }
    | { readonly kind: "object"; readonly value: ObservedObjectValue }
    | { readonly kind: "agent"; readonly value: ObservedAgentValue };
}

export interface PerceptionRecordResult {
  readonly world: WorldState;
  readonly events: readonly DomainEvent[];
  readonly changes: readonly KnowledgeChange[];
}

function memoryFor(
  candidate: PerceptionCandidate,
  sourceEventId: DomainEvent["eventId"],
  formedAtTick: number,
): ImmediateMemory {
  return {
    id:
      candidate.subject.kind === "memory"
        ? candidate.subject.memoryId
        : `memory:${sourceEventId}`,
    sourceEventId,
    formedAtTick,
    observationKind: candidate.observationKind,
    summary: candidate.summary,
    relatedEntityId: candidate.relatedEntityId,
  };
}

export function recordPerceptionCandidates(
  worldInput: WorldState,
  candidates: readonly PerceptionCandidate[],
  metadata: (candidate: PerceptionCandidate) => EventMetadata,
): PerceptionRecordResult {
  let world = worldInput;
  const events: DomainEvent[] = [];
  const changes: KnowledgeChange[] = [];

  for (const candidate of candidates) {
    const agent = world.agents.get(candidate.agentId);
    if (!agent) throw new Error(`Perception targets unknown agent ${candidate.agentId}`);
    const written = appendDomainEvent(
      world,
      {
        type: "perception_recorded",
        agentId: candidate.agentId,
        observationKind: candidate.observationKind,
        summary: candidate.summary,
        relatedEntityId: candidate.relatedEntityId,
      },
      metadata(candidate),
    );
    world = written.world;
    events.push(written.event);

    const objects = new Map(agent.knowledge.objects);
    const knownAgents = new Map(agent.knowledge.agents);
    const knownTraversalBlockers = new Map(
      agent.knowledge.knownTraversalBlockers,
    );
    if (candidate.subject.kind === "object") {
      const current = {
        ...candidate.subject.value,
        sourceEventId: written.event.eventId,
        observationKind: candidate.observationKind,
      };
      const previous = objects.get(current.entityId) ?? null;
      objects.set(current.entityId, current);
      if (candidate.observationKind === "vision") {
        knownTraversalBlockers.delete(current.entityId);
      }
      changes.push({ previous, current });
    } else if (candidate.subject.kind === "agent") {
      const current = {
        ...candidate.subject.value,
        sourceEventId: written.event.eventId,
      };
      knownAgents.set(current.agentId, current);
      if (candidate.relatedEntityId !== EntityIdSchema.parse(current.agentId)) {
        throw new Error(`Perception subject does not match ${current.agentId}`);
      }
    }

    const updatedAgent = {
      ...agent,
      knowledge: {
        ...agent.knowledge,
        objects,
        agents: knownAgents,
        knownTraversalBlockers,
      },
      memories: [
        ...agent.memories,
        memoryFor(candidate, written.event.eventId, world.tick),
      ],
    };
    world = {
      ...world,
      agents: new Map(world.agents).set(candidate.agentId, updatedAgent),
    };
  }

  return { world, events, changes };
}
