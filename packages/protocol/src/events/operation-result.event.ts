import { z } from "zod";

import {
  AgentIdSchema,
  OperationCallIdSchema,
  OperationIdSchema,
} from "../identity/ids";
import { JsonObjectSchema } from "../json/json-value";
import { OperationTerminationSourceSchema } from "../execution/host-operation-contract";
import { EventEnvelopeSchema } from "./event-envelope";
import { OperationTerminationOutcomeSchema } from "./operation-terminated.event";

export const OperationResultEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("operation_result"),
  agentId: AgentIdSchema,
  callId: OperationCallIdSchema,
  operationId: OperationIdSchema,
  terminal: z.boolean(),
  outcome: OperationTerminationOutcomeSchema.nullable(),
  reasonCode: OperationTerminationSourceSchema,
  result: JsonObjectSchema,
})
  .strict()
  .superRefine((value, context) => {
    if (value.terminal !== (value.outcome !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only terminal operation results have an outcome",
      });
    }
  });

export type OperationResultEvent = z.infer<typeof OperationResultEventSchema>;
