import { z } from "zod";

import { AgentIdSchema, DecisionCycleIdSchema, RequestIdSchema } from "../identity/ids";
import { EventEnvelopeSchema } from "./event-envelope";

export const DecisionRequestedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("decision_requested"),
  agentId: AgentIdSchema,
  requestId: RequestIdSchema,
  decisionCycleId: DecisionCycleIdSchema,
  reasonCode: z.string().min(1),
}).strict();

export type DecisionRequestedEvent = z.infer<typeof DecisionRequestedEventSchema>;
