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

  it("records a subjective perception as its own causal source", () => {
    const event = DomainEventSchema.parse({
      schemaVersion: 1,
      eventId: "event:starter-world:7",
      type: "perception_recorded",
      worldId: "starter-world",
      worldVersion: 3,
      worldTick: 2,
      sequence: 7,
      parentSequence: 6,
      causationId: "vision:alice:fridge-1",
      correlationId: "tick:2",
      agentId: "alice",
      observationKind: "vision",
      summary: "Bob is using the refrigerator",
      relatedEntityId: "fridge-1",
    });

    expect(event).toMatchObject({
      type: "perception_recorded",
      agentId: "alice",
      relatedEntityId: "fridge-1",
    });
  });

  it("keeps the perceived reason and object on an action failure", () => {
    const event = DomainEventSchema.parse({
      schemaVersion: 1,
      eventId: "event:starter-world:8",
      type: "action_failed",
      worldId: "starter-world",
      worldVersion: 3,
      worldTick: 2,
      sequence: 8,
      parentSequence: 7,
      causationId: "action:alice:raise-passage",
      correlationId: "goal:alice:refrigerator",
      agentId: "alice",
      actionId: "action:alice:raise-passage",
      reasonCode: "sealed",
      summary: "The passage cannot be raised",
      entityId: "passage-1",
      perceivedByAgent: true,
    });

    expect(event).toMatchObject({
      reasonCode: "sealed",
      summary: "The passage cannot be raised",
      entityId: "passage-1",
    });
  });
});
