import { describe, expect, it } from "vitest";

import { WorldSnapshotSchema } from "./world-snapshot";

const snapshot = {
  schemaVersion: 1,
  worldId: "starter-world",
  worldVersion: 8,
  worldTick: 42,
  lastEventSequence: 17,
  pluginLockHash: "b".repeat(64),
  state: {
    agents: [],
    objects: [],
    randomState: 1234,
  },
} as const;

describe("world snapshot", () => {
  it("accepts versioned JSON state", () => {
    expect(WorldSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it.each([
    new Map([["alice", { x: 1, y: 2 }]]),
    { invalid: undefined },
    { invalid: Number.NaN },
    { invalid: Number.POSITIVE_INFINITY },
  ])("rejects non-JSON state %#", (state) => {
    expect(WorldSnapshotSchema.safeParse({ ...snapshot, state }).success).toBe(false);
  });

  it("accepts a strict causal version-two snapshot", () => {
    const strictSnapshot = {
      ...snapshot,
      schemaVersion: 2,
      history: { mode: "strict", causalFromSequence: 1 },
      causalEventIds: ["event:starter-world:3", "event:starter-world:17"],
    } as const;

    expect(WorldSnapshotSchema.parse(strictSnapshot)).toEqual(strictSnapshot);
  });

  it("requires causal metadata on version-two snapshots", () => {
    expect(
      WorldSnapshotSchema.safeParse({
        ...snapshot,
        schemaVersion: 2,
      }).success,
    ).toBe(false);
  });

  it("accepts a version-two continuation of legacy history", () => {
    const legacyContinuation = {
      ...snapshot,
      schemaVersion: 2,
      history: { mode: "legacy", causalFromSequence: 18 },
      causalEventIds: [],
    } as const;

    expect(WorldSnapshotSchema.parse(legacyContinuation)).toEqual(legacyContinuation);
  });
});
