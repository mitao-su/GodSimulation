import { z } from "zod";

import { CanonicalTaskTracksSchema } from "../execution/task-contract";
import {
  AgentIdSchema,
  OperationCallIdSchema,
  OperationIdSchema,
} from "../identity/ids";
import { EventEnvelopeSchema } from "./event-envelope";

export const OperationStartedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("operation_started"),
  agentId: AgentIdSchema,
  callId: OperationCallIdSchema,
  operationId: OperationIdSchema,
  taskSlots: CanonicalTaskTracksSchema,
  label: z.string().min(1).max(160),
}).strict();

export type OperationStartedEvent = z.infer<
  typeof OperationStartedEventSchema
>;
