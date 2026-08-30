import { z } from "zod";

import { CommandEnvelopeSchema } from "./command-envelope";

export const SetReviewModeCommandSchema = CommandEnvelopeSchema.extend({
  type: z.literal("set_review_mode"),
  enabled: z.boolean(),
}).strict();

export type SetReviewModeCommand = z.infer<typeof SetReviewModeCommandSchema>;
