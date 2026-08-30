import {
  DomainEventSchema,
  type DomainEvent,
  type JsonValue,
} from "@god-sim/protocol";

import type { Effect } from "@god-sim/plugin-sdk";

import type { WorldState } from "../world/world-state";

export interface EventMetadata {
  readonly causationId: string;
  readonly correlationId: string;
}

export interface EventChange {
  readonly effect: Effect;
  readonly previousNeedValue?: number;
  readonly objectVersion?: number;
  readonly objectState?: JsonValue;
}

export function createEffectEvents(
  world: WorldState,
  committedWorldVersion: number,
  changes: readonly EventChange[],
  metadata: EventMetadata,
): readonly DomainEvent[] {
  const events: DomainEvent[] = [];

  for (const change of changes) {
    const sequence = world.lastEventSequence + events.length + 1;
    const base = {
      schemaVersion: 1 as const,
      eventId: `event:${world.id}:${sequence}`,
      worldId: world.id,
      worldVersion: committedWorldVersion,
      worldTick: world.tick,
      sequence,
      parentSequence: sequence === 1 ? null : sequence - 1,
      causationId: metadata.causationId,
      correlationId: metadata.correlationId,
    };

    switch (change.effect.type) {
      case "set_agent_need":
        events.push(
          DomainEventSchema.parse({
            ...base,
            type: "agent_need_changed",
            agentId: change.effect.agentId,
            need: change.effect.need,
            previousValue: change.previousNeedValue,
            newValue: change.effect.value,
          }),
        );
        break;
      case "replace_object_state":
      case "reserve_occupancy":
      case "release_occupancy":
        events.push(
          DomainEventSchema.parse({
            ...base,
            type: "object_state_changed",
            entityId: change.effect.entityId,
            objectVersion: change.objectVersion,
            state: change.objectState,
          }),
        );
        break;
      case "emit_perceptible_result":
        events.push(
          DomainEventSchema.parse({
            ...base,
            type: "perceptible_result_emitted",
            sourceEntityId: change.effect.sourceEntityId,
            audienceAgentIds: change.effect.audienceAgentIds,
            senses: change.effect.senses,
            summary: change.effect.summary,
          }),
        );
        break;
    }
  }

  return events;
}
