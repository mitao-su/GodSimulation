import { z } from "zod";

import { AgentIdSchema, GoalOptionIdSchema, RequestIdSchema } from "../identity/ids";
import { EventEnvelopeSchema } from "./event-envelope";

export const DecisionAcceptedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("decision_accepted"),
  agentId: AgentIdSchema,
  requestId: RequestIdSchema,
  goalOptionId: GoalOptionIdSchema,
}).strict();

export type DecisionAcceptedEvent = z.infer<typeof DecisionAcceptedEventSchema>;
