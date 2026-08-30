import { z } from "zod";

import { CommandEnvelopeSchema } from "./command-envelope";

export const ReleaseExecutionCommandSchema = CommandEnvelopeSchema.extend({
  type: z.literal("release_execution"),
}).strict();

export type ReleaseExecutionCommand = z.infer<typeof ReleaseExecutionCommandSchema>;
