import { z } from "zod";

import { AgentIdSchema, EventIdSchema } from "../identity/ids";
import { EventEnvelopeSchema } from "./event-envelope";

export const ObservationRememberedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("observation_remembered"),
  agentId: AgentIdSchema,
  sourceEventId: EventIdSchema,
  observationKind: z.enum(["vision", "hearing", "contact", "interaction", "body"]),
  summary: z.string().min(1).max(500),
}).strict();

export type ObservationRememberedEvent = z.infer<typeof ObservationRememberedEventSchema>;
