import { describe, expect, it } from "vitest";

import {
  DomainEventSchema,
  WorldSnapshotV2Schema,
  type DomainEvent,
  type WorldSnapshotV2,
} from "@god-sim/protocol";
import type { ModelCallRecord, WorldCheckpoint } from "@god-sim/timeline";

import { createSqliteTimelineStore } from "./sqlite-timeline-store";

function snapshotAt(sequence: number, marker = `snapshot-${sequence}`): WorldSnapshotV2 {
  return WorldSnapshotV2Schema.parse({
    schemaVersion: 2,
    worldId: "starter-world",
    worldVersion: sequence,
    worldTick: sequence,
    lastEventSequence: sequence,
    pluginLockHash: "a".repeat(64),
    history: { mode: "strict", causalFromSequence: 1 },
    causalEventIds:
      sequence === 0
        ? []
        : Array.from(
            { length: sequence },
            (_, index) => `event:starter-world:${index + 1}` as never,
          ),
    state: { marker },
  });
}

function eventAt(sequence: number): DomainEvent {
  return DomainEventSchema.parse({
    schemaVersion: 1,
    eventId: `event:starter-world:${sequence}`,
    worldId: "starter-world",
    worldVersion: sequence,
    worldTick: sequence,
    sequence,
    parentSequence: sequence === 1 ? null : sequence - 1,
    causationId: `cause:${sequence}`,
    correlationId: "cycle:1",
    type: "decision_requested",
    agentId: "alice",
    requestId: `request:${sequence}`,
    decisionCycleId: "cycle:1",
    reasonCode: "test",
  });
}

function checkpointAt(sequence: number): WorldCheckpoint {
  return {
    checkpointId: `checkpoint:starter-world:${sequence}:${sequence}` as never,
    events: Array.from({ length: sequence }, (_, index) => eventAt(index + 1)),
    snapshot: snapshotAt(sequence),
  };
}

function modelCall(): ModelCallRecord {
  return {
    requestId: "request:1" as never,
    worldId: "starter-world" as never,
    worldVersion: 1,
    agentId: "alice" as never,
    protocolSchemaVersion: 1,
    decisionCycleId: "cycle:1" as never,
    pluginLockHash: "a".repeat(64) as never,
    decisionReasonCode: "initial_goal",
    modelId: "fixed-test",
    status: "accepted",
    goalOptionId: "goal-option:alice:wait" as never,
    responseReason: "Alice waits",
    latencyMs: 10,
    retryOfRequestId: null,
    recordedAtRealTime: "2026-08-31T00:00:00.000Z",
  };
}

describe("SQLite timeline store", () => {
  it("rolls back events when snapshot insertion fails", async () => {
    const store = await createSqliteTimelineStore({
      filename: ":memory:",
      checkpointFailpoint(phase) {
        if (phase === "after_events_before_snapshot") {
          throw new Error("snapshot unavailable");
        }
      },
    });
    try {
      await expect(store.commitCheckpoint(checkpointAt(2))).rejects.toThrow(
        "snapshot unavailable",
      );
      await expect(store.loadLatest("starter-world" as never)).resolves.toEqual({
        snapshot: null,
        events: [],
      });
    } finally {
      await store.close();
    }
  });

  it("accepts an exact checkpoint replay and rejects changed payload", async () => {
    const store = await createSqliteTimelineStore({ filename: ":memory:" });
    const checkpoint = checkpointAt(2);
    try {
      await store.commitCheckpoint(checkpoint);
      await store.commitCheckpoint(checkpoint);
      await expect(
        store.commitCheckpoint({
          ...checkpoint,
          snapshot: snapshotAt(2, "conflicting-state"),
        }),
      ).rejects.toThrow(/checkpoint|history conflict/i);
      await expect(store.loadLatest("starter-world" as never)).resolves.toEqual({
        snapshot: checkpoint.snapshot,
        events: [],
      });
    } finally {
      await store.close();
    }
  });

  it("rejects a discontinuous event batch before writing any record", async () => {
    const store = await createSqliteTimelineStore({ filename: ":memory:" });
    const checkpoint = checkpointAt(2);
    try {
      await expect(
        store.commitCheckpoint({
          ...checkpoint,
          events: [eventAt(1), eventAt(3)],
        }),
      ).rejects.toThrow(/continuous|sequence|parent/i);
      await expect(store.loadLatest("starter-world" as never)).resolves.toEqual({
        snapshot: null,
        events: [],
      });
    } finally {
      await store.close();
    }
  });

  it("rejects a snapshot whose causal Event is not durable", async () => {
    const store = await createSqliteTimelineStore({ filename: ":memory:" });
    const checkpoint = checkpointAt(1);
    try {
      await expect(
        store.commitCheckpoint({
          ...checkpoint,
          snapshot: {
            ...checkpoint.snapshot,
            causalEventIds: ["event:starter-world:2" as never],
          },
        }),
      ).rejects.toThrow(/causal event/i);
      await expect(store.loadLatest("starter-world" as never)).resolves.toEqual({
        snapshot: null,
        events: [],
      });
    } finally {
      await store.close();
    }
  });

  it("includes causal model identity in exact replay comparison", async () => {
    const store = await createSqliteTimelineStore({ filename: ":memory:" });
    const record = modelCall();
    try {
      await store.saveModelCall(record);
      await store.saveModelCall(record);
      await expect(
        store.saveModelCall({ ...record, decisionReasonCode: "conflict" }),
      ).rejects.toThrow(/model call replay conflicts/i);
    } finally {
      await store.close();
    }
  });

});
