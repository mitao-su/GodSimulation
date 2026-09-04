import { z } from "zod";

import {
  AgentIdSchema,
  OperationCallIdSchema,
  OperationIdSchema,
} from "../identity/ids";
import { OperationTerminationSourceSchema } from "../execution/host-operation-contract";
import { EventEnvelopeSchema } from "./event-envelope";

export const OperationTerminationOutcomeSchema = z.enum([
  "completed",
  "failed",
  "cancelled",
]);
export type OperationTerminationOutcome = z.infer<
  typeof OperationTerminationOutcomeSchema
>;

export const OperationTerminatedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("operation_terminated"),
  agentId: AgentIdSchema,
  callId: OperationCallIdSchema,
  operationId: OperationIdSchema,
  outcome: OperationTerminationOutcomeSchema,
  reasonCode: OperationTerminationSourceSchema,
}).strict();

export type OperationTerminatedEvent = z.infer<
  typeof OperationTerminatedEventSchema
>;
