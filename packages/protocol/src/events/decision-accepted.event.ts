import { z } from "zod";

import { TaskDecisionSchema } from "../execution/task-contract";
import { AgentIdSchema, RequestIdSchema } from "../identity/ids";
import { EventEnvelopeSchema } from "./event-envelope";

export const DecisionAcceptedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("decision_accepted"),
  agentId: AgentIdSchema,
  requestId: RequestIdSchema,
  decision: TaskDecisionSchema,
}).strict();

export type DecisionAcceptedEvent = z.infer<typeof DecisionAcceptedEventSchema>;
