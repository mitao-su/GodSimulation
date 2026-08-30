import { z } from "zod";

import { PluginLockHashSchema, WorldIdSchema } from "../identity/ids";
import { JsonValueSchema } from "../json/json-value";

export const WorldSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    worldId: WorldIdSchema,
    worldVersion: z.number().int().nonnegative(),
    worldTick: z.number().int().nonnegative(),
    lastEventSequence: z.number().int().nonnegative(),
    pluginLockHash: PluginLockHashSchema,
    state: JsonValueSchema,
  })
  .strict();

export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;
