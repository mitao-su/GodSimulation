import { z } from "zod";

import { CommandEnvelopeSchema } from "./command-envelope";

export const RetryTechnicalFailureCommandSchema = CommandEnvelopeSchema.extend({
  type: z.literal("retry_technical_failure"),
  failureId: z.string().min(1).max(200),
}).strict();

export type RetryTechnicalFailureCommand = z.infer<
  typeof RetryTechnicalFailureCommandSchema
>;
