import { describe, expect, it } from "vitest";

import type { WorldSnapshot } from "@god-sim/protocol";
import type { TimelineStore } from "@god-sim/timeline";

import { PersistenceWriter } from "./persistence-writer";

function snapshot(worldVersion: number): WorldSnapshot {
  return {
    schemaVersion: 1,
    worldId: "starter-world" as never,
    worldVersion,
    worldTick: worldVersion,
    lastEventSequence: 0,
    pluginLockHash: "a".repeat(64) as never,
    state: {},
  };
}

describe("PersistenceWriter", () => {
  it("holds later writes behind a failure and replays them in order", async () => {
    const attempts: number[] = [];
    let diskAvailable = false;
    const store: TimelineStore = {
      async appendEvents() {},
      async saveSnapshot(value) {
        attempts.push(value.worldVersion);
        if (!diskAvailable) throw new Error("disk unavailable");
      },
      async savePluginLock() {},
      async saveModelCall() {},
      async recordFailure() {},
      async loadLatest() {
        return { snapshot: null, events: [] };
      },
      async close() {},
    };
    const writer = new PersistenceWriter(store);

    await expect(writer.saveSnapshot(snapshot(1))).rejects.toThrow("disk unavailable");
    await expect(writer.saveSnapshot(snapshot(2))).rejects.toThrow(/retry/i);
    expect(attempts).toEqual([1]);

    diskAvailable = true;
    await writer.retryFailed();

    expect(attempts).toEqual([1, 1, 2]);
    await writer.close();
  });

  it("stays blocked when the store rejects with a non-Error value", async () => {
    const attempts: number[] = [];
    let diskAvailable = false;
    const store: TimelineStore = {
      async appendEvents() {},
      async saveSnapshot(value) {
        attempts.push(value.worldVersion);
        if (!diskAvailable) throw null;
      },
      async savePluginLock() {},
      async saveModelCall() {},
      async recordFailure() {},
      async loadLatest() {
        return { snapshot: null, events: [] };
      },
      async close() {},
    };
    const writer = new PersistenceWriter(store);

    await expect(writer.saveSnapshot(snapshot(1))).rejects.toBeNull();
    await expect(writer.saveSnapshot(snapshot(2))).rejects.toThrow(/retry/i);
    expect(attempts).toEqual([1]);

    diskAvailable = true;
    await writer.retryFailed();

    expect(attempts).toEqual([1, 1, 2]);
    await writer.close();
  });

  it("closes the store but reports writes that were never retried", async () => {
    let closed = false;
    const store: TimelineStore = {
      async appendEvents() {},
      async saveSnapshot() {
        throw new Error("disk unavailable");
      },
      async savePluginLock() {},
      async saveModelCall() {},
      async recordFailure() {},
      async loadLatest() {
        return { snapshot: null, events: [] };
      },
      async close() {
        closed = true;
      },
    };
    const writer = new PersistenceWriter(store);
    await expect(writer.saveSnapshot(snapshot(1))).rejects.toThrow("disk unavailable");

    await expect(writer.close()).rejects.toThrow(/1 unsaved persistence operation/i);
    expect(closed).toBe(true);
  });
});
