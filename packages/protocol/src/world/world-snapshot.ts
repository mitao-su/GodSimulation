import { z } from "zod";

import { EventIdSchema, PluginLockHashSchema, WorldIdSchema } from "../identity/ids";
import { JsonValueSchema } from "../json/json-value";
import { SimulationRulesLockSchema } from "../rules/simulation-rules";

const WorldSnapshotBaseShape = {
  worldId: WorldIdSchema,
  worldVersion: z.number().int().nonnegative(),
  worldTick: z.number().int().nonnegative(),
  lastEventSequence: z.number().int().nonnegative(),
  pluginLockHash: PluginLockHashSchema,
  state: JsonValueSchema,
};

export const WorldSnapshotV1Schema = z
  .object({ schemaVersion: z.literal(1), ...WorldSnapshotBaseShape })
  .strict();

const WorldHistorySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("strict"), causalFromSequence: z.literal(1) }).strict(),
  z
    .object({
      mode: z.literal("legacy"),
      causalFromSequence: z.number().int().positive(),
    })
    .strict(),
]);

export const WorldSnapshotV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    ...WorldSnapshotBaseShape,
    history: WorldHistorySchema,
    causalEventIds: z.array(EventIdSchema),
  })
  .strict();

export const WorldSnapshotV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    ...WorldSnapshotBaseShape,
    simulationRulesLock: SimulationRulesLockSchema,
    history: WorldHistorySchema,
    causalEventIds: z.array(EventIdSchema),
  })
  .strict();

export const WorldSnapshotSchema = z.discriminatedUnion("schemaVersion", [
  WorldSnapshotV1Schema,
  WorldSnapshotV2Schema,
  WorldSnapshotV3Schema,
]);

export const WorldSnapshotWithCausalHistorySchema = z.discriminatedUnion(
  "schemaVersion",
  [WorldSnapshotV2Schema, WorldSnapshotV3Schema],
);

export const WorldSnapshotCurrentSchema = WorldSnapshotV3Schema;

export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;
export type WorldSnapshotV1 = z.infer<typeof WorldSnapshotV1Schema>;
export type WorldSnapshotV2 = z.infer<typeof WorldSnapshotV2Schema>;
export type WorldSnapshotV3 = z.infer<typeof WorldSnapshotV3Schema>;
export type WorldSnapshotWithCausalHistory = z.infer<
  typeof WorldSnapshotWithCausalHistorySchema
>;
export type WorldSnapshotCurrent = z.infer<typeof WorldSnapshotCurrentSchema>;
