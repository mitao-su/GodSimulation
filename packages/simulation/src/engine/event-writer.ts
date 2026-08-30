import { DomainEventSchema, type DomainEvent } from "@god-sim/protocol";

import type { WorldState } from "../world/world-state";

export interface EventMetadata {
  readonly causationId: string;
  readonly correlationId: string;
}

export interface EventWriteResult {
  readonly world: WorldState;
  readonly event: DomainEvent;
}

export function appendDomainEvent(
  world: WorldState,
  payload: Readonly<Record<string, unknown>>,
  metadata: EventMetadata,
): EventWriteResult {
  const sequence = world.lastEventSequence + 1;
  const event = DomainEventSchema.parse({
    schemaVersion: 1,
    eventId: `event:${world.id}:${sequence}`,
    worldId: world.id,
    worldVersion: world.version,
    worldTick: world.tick,
    sequence,
    parentSequence: sequence === 1 ? null : sequence - 1,
    causationId: metadata.causationId,
    correlationId: metadata.correlationId,
    ...payload,
  });
  return {
    world: { ...world, lastEventSequence: sequence },
    event,
  };
}

