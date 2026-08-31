import { z } from "zod";

import { AgentIdSchema, EntityIdSchema } from "../identity/ids";
import { EventEnvelopeSchema } from "./event-envelope";

export const PerceptionRecordedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("perception_recorded"),
  agentId: AgentIdSchema,
  observationKind: z.enum([
    "vision",
    "hearing",
    "contact",
    "interaction",
    "body",
    "memory",
  ]),
  summary: z.string().min(1).max(500),
  relatedEntityId: EntityIdSchema.nullable(),
}).strict();

export type PerceptionRecordedEvent = z.infer<typeof PerceptionRecordedEventSchema>;
