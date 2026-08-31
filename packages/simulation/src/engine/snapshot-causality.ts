import { z } from "zod";

import {
  AgentIdSchema,
  EventIdSchema,
  WorldSnapshotV2Schema,
  type EventId,
  type WorldId,
  type WorldSnapshotV2,
} from "@god-sim/protocol";

const SourceReferenceSchema = z.object({ sourceEventId: EventIdSchema }).passthrough();

const SubjectiveStateSchema = z
  .object({
    agents: z.array(
      z
        .object({
          id: AgentIdSchema,
          knowledge: z
            .object({
              objects: z.array(SourceReferenceSchema),
              agents: z.array(SourceReferenceSchema),
              knownTraversalBlockers: z.array(SourceReferenceSchema),
            })
            .passthrough(),
          memories: z.array(SourceReferenceSchema),
        })
        .passthrough(),
    ),
  })
  .passthrough();

interface LabeledSourceReference {
  readonly agentId: string;
  readonly label: string;
  readonly eventId: EventId;
}

export function eventSequenceInWorld(
  worldId: WorldId,
  eventId: EventId,
): number | null {
  const prefix = `event:${worldId}:`;
  if (!eventId.startsWith(prefix)) return null;
  const sequenceText = eventId.slice(prefix.length);
  if (!/^[1-9]\d*$/.test(sequenceText)) return null;
  const sequence = Number(sequenceText);
  return Number.isSafeInteger(sequence) ? sequence : null;
}

function subjectiveSources(snapshot: WorldSnapshotV2): readonly LabeledSourceReference[] {
  const state = SubjectiveStateSchema.parse(snapshot.state);
  return state.agents.flatMap((agent) => [
    ...agent.knowledge.objects.map((value, index) => ({
      agentId: agent.id,
      label: `knowledge.objects[${index}]`,
      eventId: value.sourceEventId,
    })),
    ...agent.knowledge.agents.map((value, index) => ({
      agentId: agent.id,
      label: `knowledge.agents[${index}]`,
      eventId: value.sourceEventId,
    })),
    ...agent.knowledge.knownTraversalBlockers.map((value, index) => ({
      agentId: agent.id,
      label: `knowledge.knownTraversalBlockers[${index}]`,
      eventId: value.sourceEventId,
    })),
    ...agent.memories.map((value, index) => ({
      agentId: agent.id,
      label: `memories[${index}]`,
      eventId: value.sourceEventId,
    })),
  ]);
}

export function assertSnapshotCausality(snapshotValue: WorldSnapshotV2): void {
  const snapshot = WorldSnapshotV2Schema.parse(snapshotValue);
  if (snapshot.history.causalFromSequence > snapshot.lastEventSequence + 1) {
    throw new Error("Snapshot causal history begins past its Event tail");
  }

  const listed = new Set<EventId>();
  let previous: { readonly sequence: number; readonly eventId: EventId } | null = null;
  for (const eventId of snapshot.causalEventIds) {
    if (listed.has(eventId)) {
      throw new Error(`Snapshot contains duplicate causal Event ${eventId}`);
    }
    listed.add(eventId);
    const sequence = eventSequenceInWorld(snapshot.worldId, eventId);
    if (sequence === null) {
      throw new Error(
        `Snapshot causal Event ${eventId} does not belong to world ${snapshot.worldId}`,
      );
    }
    if (
      sequence < snapshot.history.causalFromSequence ||
      sequence > snapshot.lastEventSequence
    ) {
      throw new Error(
        `Snapshot causal Event ${eventId} sequence is outside the causal history and Event tail`,
      );
    }
    if (
      previous &&
      (sequence < previous.sequence ||
        (sequence === previous.sequence && eventId.localeCompare(previous.eventId) <= 0))
    ) {
      throw new Error("Snapshot causal Event IDs are not in deterministic order");
    }
    previous = { sequence, eventId };
  }

  for (const source of subjectiveSources(snapshot)) {
    const sequence = eventSequenceInWorld(snapshot.worldId, source.eventId);
    const mustBeListed =
      snapshot.history.mode === "strict" ||
      (sequence !== null && sequence >= snapshot.history.causalFromSequence);
    if (mustBeListed && !listed.has(source.eventId)) {
      throw new Error(
        `Snapshot agent ${source.agentId} ${source.label} references unlisted Event ${source.eventId}`,
      );
    }
  }
}
