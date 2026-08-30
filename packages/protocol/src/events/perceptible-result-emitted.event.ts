import { z } from "zod";

import { AgentIdSchema, EntityIdSchema } from "../identity/ids";
import { EventEnvelopeSchema } from "./event-envelope";

export const PerceptibleResultEmittedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("perceptible_result_emitted"),
  sourceEntityId: EntityIdSchema,
  audienceAgentIds: z.array(AgentIdSchema),
  senses: z.array(z.enum(["vision", "hearing", "contact", "interaction"])).min(1),
  summary: z.string().min(1).max(500),
}).strict();

export type PerceptibleResultEmittedEvent = z.infer<
  typeof PerceptibleResultEmittedEventSchema
>;
