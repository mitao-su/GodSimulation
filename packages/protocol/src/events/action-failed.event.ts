import { z } from "zod";

import { AgentIdSchema, EntityIdSchema } from "../identity/ids";
import { EventEnvelopeSchema } from "./event-envelope";

export const ActionFailedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("action_failed"),
  agentId: AgentIdSchema,
  actionId: z.string().min(1),
  reasonCode: z.string().min(1).max(120),
  summary: z.string().min(1).max(500).optional(),
  entityId: EntityIdSchema.optional(),
  perceivedByAgent: z.boolean(),
}).strict();

export type ActionFailedEvent = z.infer<typeof ActionFailedEventSchema>;
