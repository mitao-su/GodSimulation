import { describe, expect, it } from "vitest";

import { SimulationRulesLockSchema } from "../rules/simulation-rules";
import {
  WorldSnapshotCurrentSchema,
  WorldSnapshotSchema,
  WorldSnapshotV3Schema,
} from "./world-snapshot";

const simulationRulesLock = SimulationRulesLockSchema.parse({
  hash: "c".repeat(64),
  rules: {
    schemaVersion: 1,
    id: "default",
    version: 1,
    time: { secondsPerGameTick: 6, epoch: { day: 1, hour: 8, minute: 0 } },
    context: { attentionBudgetTokens: 200_000, technicalHardLimitTokens: 200_000 },
    fatigue: {
      timeWeight: 0.6,
      tokenWeight: 0.4,
      forcedSleepThreshold: 0.6,
      timePressureFullAtTicks: 43_200,
    },
    inventory: { capacityUnits: 9 },
    operations: {
      move: { ticksPerCell: 2 },
      wait: { defaultDurationTicks: 600, maxDurationTicks: 600 },
      observe: { durationTicks: 1 },
    },
    memory: {
      importance: {
        critical: { initialStrength: 1, halfLifeDays: 90 },
        high: { initialStrength: 1, halfLifeDays: 30 },
        normal: { initialStrength: 1, halfLifeDays: 7 },
        low: { initialStrength: 1, halfLifeDays: 2 },
      },
      deletionThreshold: 0.1,
      recall: {
        maxReturnTokensPerOperation: 8_000,
        rankingWeights: {
          semanticSimilarity: 0.55,
          keywordMatch: 0.25,
          currentStrength: 0.2,
        },
      },
    },
    sound: {
      speakSourceStrength: { quiet: 1, normal: 2, loud: 4 },
      attenuationPerTile: 0.25,
      attenuationPerWall: 1,
      attenuationPerOpenDoor: 0.1,
      attenuationPerClosedDoor: 0.75,
      fullContentThreshold: 1,
      unclearContentThreshold: 0.25,
    },
  },
});

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

  it("stores the complete simulation rule lock in a version-three snapshot", () => {
    const currentSnapshot = {
      ...snapshot,
      schemaVersion: 3,
      simulationRulesLock,
      history: { mode: "strict", causalFromSequence: 1 },
      causalEventIds: ["event:starter-world:3", "event:starter-world:17"],
    } as const;

    expect(WorldSnapshotV3Schema.parse(currentSnapshot)).toEqual(currentSnapshot);
    expect(WorldSnapshotSchema.parse(currentSnapshot)).toEqual(currentSnapshot);
    expect(WorldSnapshotCurrentSchema.parse(currentSnapshot)).toEqual(currentSnapshot);
  });

  it("does not treat a legacy version-two snapshot as the current checkpoint type", () => {
    expect(
      WorldSnapshotCurrentSchema.safeParse({
        ...snapshot,
        schemaVersion: 2,
        history: { mode: "strict", causalFromSequence: 1 },
        causalEventIds: [],
      }).success,
    ).toBe(false);
  });
});
