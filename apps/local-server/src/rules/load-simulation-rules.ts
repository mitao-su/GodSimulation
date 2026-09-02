import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  SimulationRulesLockSchema,
  SimulationRulesSchema,
  type JsonValue,
  type SimulationRulesLock,
  type WorldRulesReference,
} from "@god-sim/protocol";

export interface LoadSimulationRulesOptions {
  readonly rulesDirectory: string;
  readonly reference: WorldRulesReference;
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (isJsonArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(",")}}`;
}

export async function loadSimulationRules(
  options: LoadSimulationRulesOptions,
): Promise<SimulationRulesLock> {
  const filename = join(options.rulesDirectory, `${options.reference.id}.json`);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(filename, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Unable to read simulation rules at ${filename}`, { cause: error });
  }

  let rules: ReturnType<typeof SimulationRulesSchema.parse>;
  try {
    rules = SimulationRulesSchema.parse(value);
  } catch (error) {
    throw new Error(`Invalid simulation rules at ${filename}`, { cause: error });
  }

  if (rules.id !== options.reference.id || rules.version !== options.reference.version) {
    throw new Error(
      `World requires ${options.reference.id}@${options.reference.version}, but ${filename} contains ${rules.id}@${rules.version}`,
    );
  }

  const normalized = canonicalJson(rules);
  return SimulationRulesLockSchema.parse({
    hash: createHash("sha256").update(normalized, "utf8").digest("hex"),
    rules,
  });
}
