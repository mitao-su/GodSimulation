import { z } from "zod";

import { CommandIdSchema, WorldIdSchema } from "../identity/ids";

export const CommandEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    commandId: CommandIdSchema,
    worldId: WorldIdSchema,
    expectedWorldVersion: z.number().int().nonnegative(),
    issuedAtRealTime: z.iso.datetime(),
  })
  .strict();

export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
