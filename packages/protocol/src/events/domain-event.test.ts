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

  it("records one strict lifecycle for an operation call", () => {
    const started = DomainEventSchema.parse({
      schemaVersion: 1,
      eventId: "event:starter-world:9",
      type: "operation_started",
      worldId: "starter-world",
      worldVersion: 4,
      worldTick: 2,
      sequence: 9,
      parentSequence: 8,
      causationId: "release:cycle-2",
      correlationId: "cycle-2",
      agentId: "alice",
      callId: "operation-call:cycle-2:alice:0",
      operationId: "core.wait",
      taskSlots: ["HEAD", "BODY"],
      label: "Sleep",
    });
    const terminated = DomainEventSchema.parse({
      schemaVersion: 1,
      eventId: "event:starter-world:10",
      type: "operation_terminated",
      worldId: "starter-world",
      worldVersion: 5,
      worldTick: 12,
      sequence: 10,
      parentSequence: 9,
      causationId: "operation-call:cycle-2:alice:0",
      correlationId: "operation-call:cycle-2:alice:0",
      agentId: "alice",
      callId: "operation-call:cycle-2:alice:0",
      operationId: "core.wait",
      outcome: "completed",
      reasonCode: "operation_completed",
    });

    expect(started).toMatchObject({
      type: "operation_started",
      taskSlots: ["HEAD", "BODY"],
    });
    expect(terminated).toMatchObject({
      type: "operation_terminated",
      outcome: "completed",
    });
    expect(
      DomainEventSchema.safeParse({
        ...started,
        taskSlots: ["BODY", "HEAD"],
      }).success,
    ).toBe(false);
  });
});
