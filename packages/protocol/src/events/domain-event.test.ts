import { describe, expect, it } from "vitest";

import { DomainEventSchema } from "./domain-event";

describe("domain events", () => {
  it("keeps stable causal and parent sequence identity", () => {
    const event = DomainEventSchema.parse({
      schemaVersion: 1,
      eventId: "event-9",
      type: "agent_need_changed",
      worldId: "starter-world",
      worldVersion: 6,
      worldTick: 21,
      sequence: 9,
      parentSequence: 8,
      causationId: "action-use-toilet",
      correlationId: "goal-use-toilet",
      agentId: "alice",
      need: "bladder",
      previousValue: 83,
      newValue: 5,
    });

    expect(event).toMatchObject({ sequence: 9, parentSequence: 8, newValue: 5 });
  });

  it("rejects an event with an untyped payload", () => {
    expect(
      DomainEventSchema.safeParse({
        schemaVersion: 1,
        eventId: "event-1",
        type: "something_happened",
        worldId: "starter-world",
        worldVersion: 1,
        worldTick: 0,
        sequence: 1,
        parentSequence: null,
        causationId: "system",
        correlationId: "startup",
        payload: {},
      }).success,
    ).toBe(false);
  });
});

