import { describe, expect, it } from "vitest";

import type { TimelineStore, WorldCheckpoint } from "@god-sim/timeline";

import { testSimulationRulesLock } from "../testing/simulation-rules-test-fixture";
import { PersistenceWriter } from "./persistence-writer";

function checkpoint(worldVersion: number): WorldCheckpoint {
  return {
    checkpointId: `checkpoint:starter-world:${worldVersion}:0` as never,
    events: [],
    snapshot: {
      schemaVersion: 3,
      worldId: "starter-world" as never,
      worldVersion,
      worldTick: worldVersion,
      lastEventSequence: 0,
      pluginLockHash: "a".repeat(64) as never,
      simulationRulesLock: testSimulationRulesLock,
      history: { mode: "strict", causalFromSequence: 1 },
      causalEventIds: [],
      state: {},
    },
  };
}

function timelineStore(
  commitCheckpoint: TimelineStore["commitCheckpoint"],
  close: TimelineStore["close"] = async () => undefined,
): TimelineStore {
  return {
    commitCheckpoint,
    async savePluginLock() {},
    async saveModelCall() {},
    async recordFailure() {},
    async loadLatest() {
      return { snapshot: null, events: [] };
    },
    close,
  };
}

describe("PersistenceWriter", () => {
  it("retries a failed checkpoint as one unchanged operation", async () => {
    const attempts: WorldCheckpoint[] = [];
    let diskAvailable = false;
    const store = timelineStore(async (value) => {
      attempts.push(value);
      if (!diskAvailable) throw new Error("disk unavailable");
    });
    const writer = new PersistenceWriter(store);
    const first = checkpoint(1);
    const second = checkpoint(2);

    await expect(writer.commitCheckpoint(first)).rejects.toThrow("disk unavailable");
    await expect(writer.commitCheckpoint(second)).rejects.toThrow(/retry/i);
    expect(attempts).toEqual([first]);

    diskAvailable = true;
    await writer.retryFailed();

    expect(attempts).toEqual([first, first, second]);
    expect(attempts[1]).toBe(first);
    await writer.close();
  });

  it("stays blocked when the store rejects with a non-Error value", async () => {
    const attempts: WorldCheckpoint[] = [];
    let diskAvailable = false;
    const store = timelineStore(async (value) => {
      attempts.push(value);
      if (!diskAvailable) throw null;
    });
    const writer = new PersistenceWriter(store);
    const first = checkpoint(1);
    const second = checkpoint(2);

    await expect(writer.commitCheckpoint(first)).rejects.toBeNull();
    await expect(writer.commitCheckpoint(second)).rejects.toThrow(/retry/i);
    expect(attempts).toEqual([first]);

    diskAvailable = true;
    await writer.retryFailed();

    expect(attempts).toEqual([first, first, second]);
    await writer.close();
  });

  it("closes the store but reports checkpoints that were never retried", async () => {
    let closed = false;
    const store = timelineStore(
      async () => {
        throw new Error("disk unavailable");
      },
      async () => {
        closed = true;
      },
    );
    const writer = new PersistenceWriter(store);
    await expect(writer.commitCheckpoint(checkpoint(1))).rejects.toThrow(
      "disk unavailable",
    );

    await expect(writer.close()).rejects.toThrow(/1 unsaved persistence operation/i);
    expect(closed).toBe(true);
  });
});
