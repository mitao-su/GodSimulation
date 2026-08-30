import { z } from "zod";

import { RequestIdSchema } from "../identity/ids";
import { CommandEnvelopeSchema } from "./command-envelope";

export const RetryDecisionCommandSchema = CommandEnvelopeSchema.extend({
  type: z.literal("retry_decision"),
  requestId: RequestIdSchema,
}).strict();

export type RetryDecisionCommand = z.infer<typeof RetryDecisionCommandSchema>;
