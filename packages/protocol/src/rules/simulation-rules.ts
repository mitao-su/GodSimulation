import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  SimulationRulesHashSchema,
  SimulationRulesIdSchema,
} from "../identity/ids";
import type { JsonValue } from "../json/json-value";

const PositiveFiniteNumberSchema = z.number().finite().positive();
const PositiveIntegerSchema = z.number().int().positive();
const UnitIntervalSchema = z.number().finite().min(0).max(1);

function approximatelyOne(values: readonly number[]): boolean {
  return Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= Number.EPSILON * 8;
}

export const SpeakVolumeSchema = z.enum(["quiet", "normal", "loud"]);
export type SpeakVolume = z.infer<typeof SpeakVolumeSchema>;

export const WorldRulesReferenceSchema = z
  .object({
    id: SimulationRulesIdSchema,
    version: PositiveIntegerSchema,
  })
  .strict();
export type WorldRulesReference = z.infer<typeof WorldRulesReferenceSchema>;

const TimeRulesSchema = z
  .object({
    secondsPerGameTick: PositiveIntegerSchema,
    epoch: z
      .object({
        day: PositiveIntegerSchema,
        hour: z.number().int().min(0).max(23),
        minute: z.number().int().min(0).max(59),
      })
      .strict(),
  })
  .strict();

const ContextRulesSchema = z
  .object({
    attentionBudgetTokens: PositiveIntegerSchema,
    technicalHardLimitTokens: PositiveIntegerSchema,
  })
  .strict()
  .refine(
    (value) => value.technicalHardLimitTokens >= value.attentionBudgetTokens,
    { message: "technicalHardLimitTokens must be at least attentionBudgetTokens" },
  );

const FatigueRulesSchema = z
  .object({
    timeWeight: UnitIntervalSchema,
    tokenWeight: UnitIntervalSchema,
    forcedSleepThreshold: UnitIntervalSchema,
    timePressureFullAtTicks: PositiveIntegerSchema,
  })
  .strict()
  .refine((value) => approximatelyOne([value.timeWeight, value.tokenWeight]), {
    message: "Fatigue weights must total 1",
  });

const ImportanceRuleSchema = z
  .object({
    initialStrength: PositiveFiniteNumberSchema,
    halfLifeDays: PositiveFiniteNumberSchema,
  })
  .strict();

const RecallRulesSchema = z
  .object({
    maxReturnTokensPerOperation: PositiveIntegerSchema,
    rankingWeights: z
      .object({
        semanticSimilarity: UnitIntervalSchema,
        keywordMatch: UnitIntervalSchema,
        currentStrength: UnitIntervalSchema,
      })
      .strict()
      .refine(
        (value) =>
          approximatelyOne([
            value.semanticSimilarity,
            value.keywordMatch,
            value.currentStrength,
          ]),
        { message: "Recall ranking weights must total 1" },
      ),
  })
  .strict();

const OperationRulesSchema = z
  .object({
    move: z.object({ ticksPerCell: PositiveIntegerSchema }).strict(),
    wait: z
      .object({
        defaultDurationTicks: PositiveIntegerSchema,
        maxDurationTicks: PositiveIntegerSchema,
      })
      .strict()
      .refine(
        (value) => value.defaultDurationTicks <= value.maxDurationTicks,
        { message: "wait defaultDurationTicks must not exceed maxDurationTicks" },
      ),
    observe: z.object({ durationTicks: PositiveIntegerSchema }).strict(),
  })
  .strict();

const MemoryRulesSchema = z
  .object({
    importance: z
      .object({
        critical: ImportanceRuleSchema,
        high: ImportanceRuleSchema,
        normal: ImportanceRuleSchema,
        low: ImportanceRuleSchema,
      })
      .strict(),
    deletionThreshold: PositiveFiniteNumberSchema,
    recall: RecallRulesSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.importance.critical.halfLifeDays > value.importance.high.halfLifeDays &&
      value.importance.high.halfLifeDays > value.importance.normal.halfLifeDays &&
      value.importance.normal.halfLifeDays > value.importance.low.halfLifeDays,
    { message: "Memory half-lives must descend from critical to low" },
  );

const SoundRulesSchema = z
  .object({
    speakSourceStrength: z
      .object({
        quiet: PositiveFiniteNumberSchema,
        normal: PositiveFiniteNumberSchema,
        loud: PositiveFiniteNumberSchema,
      })
      .strict(),
    attenuationPerTile: PositiveFiniteNumberSchema,
    attenuationPerWall: PositiveFiniteNumberSchema,
    attenuationPerOpenDoor: PositiveFiniteNumberSchema,
    attenuationPerClosedDoor: PositiveFiniteNumberSchema,
    fullContentThreshold: PositiveFiniteNumberSchema,
    unclearContentThreshold: PositiveFiniteNumberSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.speakSourceStrength.quiet < value.speakSourceStrength.normal &&
      value.speakSourceStrength.normal < value.speakSourceStrength.loud,
    { message: "Speak source strength must increase from quiet to loud" },
  )
  .refine((value) => value.fullContentThreshold > value.unclearContentThreshold, {
    message: "Full-content threshold must exceed unclear-content threshold",
  })
  .refine(
    (value) =>
      value.attenuationPerClosedDoor > value.attenuationPerOpenDoor,
    {
      message: "Closed-door attenuation must exceed open-door attenuation",
    },
  );

export const SimulationRulesSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: SimulationRulesIdSchema,
    version: PositiveIntegerSchema,
    time: TimeRulesSchema,
    context: ContextRulesSchema,
    fatigue: FatigueRulesSchema,
    inventory: z.object({ capacityUnits: PositiveIntegerSchema }).strict(),
    operations: OperationRulesSchema,
    memory: MemoryRulesSchema,
    sound: SoundRulesSchema,
  })
  .strict();
export type SimulationRules = z.infer<typeof SimulationRulesSchema>;

export const SimulationRulesLockSchema = z
  .object({
    hash: SimulationRulesHashSchema,
    rules: SimulationRulesSchema,
  })
  .strict();
export type SimulationRulesLock = z.infer<typeof SimulationRulesLockSchema>;

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

export function canonicalSimulationRulesJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (isJsonArray(value)) {
    return `[${value.map(canonicalSimulationRulesJson).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalSimulationRulesJson(value[key]!)}`,
    )
    .join(",")}}`;
}

export function simulationRulesHash(rulesValue: unknown): string {
  const rules = SimulationRulesSchema.parse(rulesValue);
  const bytes = new TextEncoder().encode(
    canonicalSimulationRulesJson(rules as JsonValue),
  );
  return bytesToHex(sha256(bytes));
}

export function createSimulationRulesLock(
  rulesValue: unknown,
): SimulationRulesLock {
  const rules = SimulationRulesSchema.parse(rulesValue);
  return SimulationRulesLockSchema.parse({
    hash: simulationRulesHash(rules),
    rules,
  });
}

export function verifySimulationRulesLock(
  lockValue: unknown,
): SimulationRulesLock {
  const lock = SimulationRulesLockSchema.parse(lockValue);
  const actualHash = simulationRulesHash(lock.rules);
  if (lock.hash !== actualHash) {
    throw new Error(
      `Simulation rules lock hash mismatch: expected ${lock.hash}, computed ${actualHash}`,
    );
  }
  return lock;
}
