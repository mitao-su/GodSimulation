import { describe, expect, it } from "vitest";

import {
  createSimulationRulesLock,
  SimulationRulesLockSchema,
  SimulationRulesSchema,
  SpeakVolumeSchema,
  verifySimulationRulesLock,
  WorldRulesReferenceSchema,
} from "./simulation-rules";

const validRules = {
  schemaVersion: 1,
  id: "default",
  version: 1,
  time: {
    secondsPerGameTick: 6,
    epoch: { day: 1, hour: 8, minute: 0 },
  },
  context: {
    attentionBudgetTokens: 200_000,
    technicalHardLimitTokens: 200_000,
  },
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
} as const;

describe("SimulationRulesSchema", () => {
  it("accepts the complete version-one rule set", () => {
    expect(SimulationRulesSchema.parse(validRules)).toEqual(validRules);
    expect(WorldRulesReferenceSchema.parse({ id: "default", version: 1 })).toEqual({
      id: "default",
      version: 1,
    });
  });

  it("rejects unknown or missing policy fields", () => {
    expect(SimulationRulesSchema.safeParse({ ...validRules, extra: true }).success).toBe(false);
    const withoutInventory = { ...validRules };
    Reflect.deleteProperty(withoutInventory, "inventory");
    expect(SimulationRulesSchema.safeParse(withoutInventory).success).toBe(false);
  });

  it("keeps deployment timing out of the world-locked rules", () => {
    expect(
      SimulationRulesSchema.safeParse({
        ...validRules,
        time: { ...validRules.time, realTickIntervalMs: 50 },
      }).success,
    ).toBe(false);
    expect(
      SimulationRulesSchema.safeParse({
        ...validRules,
        modelTimeoutMs: 120_000,
      }).success,
    ).toBe(false);
  });

  it("requires every currently confirmed core operation rule", () => {
    for (const operationId of ["move", "wait", "observe"] as const) {
      const operations: Record<string, unknown> = { ...validRules.operations };
      Reflect.deleteProperty(operations, operationId);
      expect(
        SimulationRulesSchema.safeParse({ ...validRules, operations }).success,
        operationId,
      ).toBe(false);
    }
  });

  it("requires fatigue and retrieval weights to total one", () => {
    expect(
      SimulationRulesSchema.safeParse({
        ...validRules,
        fatigue: { ...validRules.fatigue, tokenWeight: 0.5 },
      }).success,
    ).toBe(false);
    expect(
      SimulationRulesSchema.safeParse({
        ...validRules,
        memory: {
          ...validRules.memory,
          recall: {
            ...validRules.memory.recall,
            rankingWeights: {
              ...validRules.memory.recall.rankingWeights,
              currentStrength: 0.3,
            },
          },
        },
      }).success,
    ).toBe(false);
  });

  it("requires positive operation timing and a valid wait default", () => {
    expect(
      SimulationRulesSchema.safeParse({
        ...validRules,
        operations: {
          ...validRules.operations,
          move: { ticksPerCell: 0 },
        },
      }).success,
    ).toBe(false);
    expect(
      SimulationRulesSchema.safeParse({
        ...validRules,
        operations: {
          ...validRules.operations,
          wait: { defaultDurationTicks: 601, maxDurationTicks: 600 },
        },
      }).success,
    ).toBe(false);
  });

  it("requires ordered memory half-lives and speak strengths", () => {
    expect(
      SimulationRulesSchema.safeParse({
        ...validRules,
        memory: {
          ...validRules.memory,
          importance: {
            ...validRules.memory.importance,
            high: { initialStrength: 1, halfLifeDays: 100 },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      SimulationRulesSchema.safeParse({
        ...validRules,
        sound: {
          ...validRules.sound,
          speakSourceStrength: { quiet: 2, normal: 1, loud: 4 },
        },
      }).success,
    ).toBe(false);
  });

  it("requires explicit wall and door attenuation with closed doors stronger", () => {
    const soundWithoutWall: Record<string, unknown> = { ...validRules.sound };
    Reflect.deleteProperty(soundWithoutWall, "attenuationPerWall");
    expect(
      SimulationRulesSchema.safeParse({
        ...validRules,
        sound: soundWithoutWall,
      }).success,
    ).toBe(false);
    expect(
      SimulationRulesSchema.safeParse({
        ...validRules,
        sound: {
          ...validRules.sound,
          attenuationPerOpenDoor: 0.75,
          attenuationPerClosedDoor: 0.75,
        },
      }).success,
    ).toBe(false);
    expect(
      SimulationRulesSchema.safeParse({
        ...validRules,
        sound: { ...validRules.sound, attenuationPerOpenDoor: 0 },
      }).success,
    ).toBe(false);
  });

  it("keeps speak volume to exactly three choices", () => {
    expect(SpeakVolumeSchema.options).toEqual(["quiet", "normal", "loud"]);
    expect(SpeakVolumeSchema.safeParse(2).success).toBe(false);
    expect(SpeakVolumeSchema.safeParse("shout").success).toBe(false);
  });

  it("validates the normalized rule lock", () => {
    expect(
      SimulationRulesLockSchema.parse({
        hash: "a".repeat(64),
        rules: validRules,
      }),
    ).toEqual({ hash: "a".repeat(64), rules: validRules });
  });

  it("creates a deterministic content hash and rejects forged locks", () => {
    const lock = createSimulationRulesLock(validRules);

    expect(lock.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(createSimulationRulesLock(structuredClone(validRules))).toEqual(lock);
    expect(() =>
      verifySimulationRulesLock({ ...lock, hash: "a".repeat(64) }),
    ).toThrow(/hash mismatch/i);
    expect(() =>
      verifySimulationRulesLock({
        ...lock,
        rules: {
          ...lock.rules,
          operations: {
            ...lock.rules.operations,
            move: { ticksPerCell: 3 },
          },
        },
      }),
    ).toThrow(/hash mismatch/i);
  });
});
