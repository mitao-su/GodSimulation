import { z } from "zod";

import { CausalIdSchema, EventIdSchema, WorldIdSchema } from "../identity/ids";

export const EventEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: EventIdSchema,
    worldId: WorldIdSchema,
    worldVersion: z.number().int().nonnegative(),
    worldTick: z.number().int().nonnegative(),
    sequence: z.number().int().positive(),
    parentSequence: z.number().int().positive().nullable(),
    causationId: CausalIdSchema,
    correlationId: CausalIdSchema,
  })
  .strict();

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
