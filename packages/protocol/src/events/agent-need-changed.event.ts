import { z } from "zod";

import { AgentIdSchema } from "../identity/ids";
import { EventEnvelopeSchema } from "./event-envelope";

export const AgentNeedChangedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("agent_need_changed"),
  agentId: AgentIdSchema,
  need: z.literal("bladder"),
  previousValue: z.number().int().min(0).max(100),
  newValue: z.number().int().min(0).max(100),
}).strict();

export type AgentNeedChangedEvent = z.infer<typeof AgentNeedChangedEventSchema>;
