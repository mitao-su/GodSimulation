import { describe, expect, it } from "vitest";

import {
  DomainEventSchema,
  WorldSnapshotSchema,
  type DomainEvent,
} from "@god-sim/protocol";

import { createSqliteTimelineStore } from "./sqlite-timeline-store";

function snapshotAt(sequence: number) {
  return WorldSnapshotSchema.parse({
    schemaVersion: 1,
    worldId: "starter-world",
    worldVersion: sequence,
    worldTick: sequence,
    lastEventSequence: sequence,
    pluginLockHash: "a".repeat(64),
    state: { marker: `snapshot-${sequence}` },
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

describe("SQLite timeline store", () => {
  it("restores the newest snapshot and every later event in order", async () => {
    const store = await createSqliteTimelineStore({ filename: ":memory:" });
    try {
      await store.saveSnapshot(snapshotAt(12));
      await store.appendEvents([eventAt(13), eventAt(14)]);

      await expect(store.loadLatest("starter-world" as never)).resolves.toEqual({
        snapshot: snapshotAt(12),
        events: [eventAt(13), eventAt(14)],
      });
    } finally {
      await store.close();
    }
  });

  it("rolls back the whole event batch when a later insert conflicts", async () => {
    const store = await createSqliteTimelineStore({ filename: ":memory:" });
    try {
      const first = eventAt(1);
      const conflicting = {
        ...eventAt(2),
        sequence: 1,
        parentSequence: null,
      } as DomainEvent;

      await expect(store.appendEvents([first, conflicting])).rejects.toThrow();
      await expect(store.loadLatest("starter-world" as never)).resolves.toEqual({
        snapshot: null,
        events: [],
      });
    } finally {
      await store.close();
    }
  });
});
