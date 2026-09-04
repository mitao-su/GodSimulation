import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorldRulesReferenceSchema } from "@god-sim/protocol";

import { loadSimulationRules } from "./load-simulation-rules";

const temporaryDirectories: string[] = [];

const validRules = {
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
} as const;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function rulesDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "god-sim-rules-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeRules(directory: string, value: unknown): Promise<void> {
  await writeFile(join(directory, "default.json"), JSON.stringify(value, null, 2), "utf8");
}

const reference = WorldRulesReferenceSchema.parse({ id: "default", version: 1 });

describe("loadSimulationRules", () => {
  it("produces the same lock when JSON object keys are reordered", async () => {
    const directory = await rulesDirectory();
    await writeRules(directory, validRules);
    const first = await loadSimulationRules({ rulesDirectory: directory, reference });

    await writeRules(directory, {
      sound: validRules.sound,
      memory: validRules.memory,
      inventory: validRules.inventory,
      operations: validRules.operations,
      fatigue: validRules.fatigue,
      context: validRules.context,
      time: {
        epoch: validRules.time.epoch,
        secondsPerGameTick: validRules.time.secondsPerGameTick,
      },
      version: validRules.version,
      id: validRules.id,
      schemaVersion: validRules.schemaVersion,
    });
    const second = await loadSimulationRules({ rulesDirectory: directory, reference });

    expect(second).toEqual(first);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.rules).toEqual(validRules);
  });

  it("rejects content whose identity differs from the world reference", async () => {
    const directory = await rulesDirectory();
    await writeRules(directory, { ...validRules, version: 2 });

    await expect(loadSimulationRules({ rulesDirectory: directory, reference })).rejects.toThrow(
      /requires default@1.*contains default@2/iu,
    );
  });

  it("rejects unknown fields instead of silently dropping policy", async () => {
    const directory = await rulesDirectory();
    await writeRules(directory, { ...validRules, extraPolicy: 1 });

    await expect(loadSimulationRules({ rulesDirectory: directory, reference })).rejects.toThrow(
      /invalid simulation rules/iu,
    );
  });
});
