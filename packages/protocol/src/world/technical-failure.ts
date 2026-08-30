import { z } from "zod";

import { RequestIdSchema } from "../identity/ids";

export const TechnicalFailureCategorySchema = z.enum([
  "configuration",
  "model",
  "plugin",
  "protocol",
  "persistence",
  "worker",
]);

export const TechnicalFailureSchema = z
  .object({
    id: z.string().min(1),
    category: TechnicalFailureCategorySchema,
    message: z.string().min(1).max(2_000),
    requestId: RequestIdSchema.optional(),
    retryable: z.boolean(),
    occurredAtRealTime: z.iso.datetime(),
  })
  .strict();

export type TechnicalFailure = z.infer<typeof TechnicalFailureSchema>;
