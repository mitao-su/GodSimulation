import { z } from "zod";

import { TaskDecisionSchema } from "../execution/task-contract";
import { DirectTaskDecisionSchema } from "../execution/host-operation-contract";
import { AgentIdSchema, RequestIdSchema } from "../identity/ids";
import { EventEnvelopeSchema } from "./event-envelope";

export const DecisionAcceptedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("decision_accepted"),
  agentId: AgentIdSchema,
  requestId: RequestIdSchema,
  decision: z.union([DirectTaskDecisionSchema, TaskDecisionSchema]),
}).strict();

export type DecisionAcceptedEvent = z.infer<typeof DecisionAcceptedEventSchema>;
