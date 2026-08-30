import { z } from "zod";

import { CommandEnvelopeSchema } from "./command-envelope";

export const StopSessionCommandSchema = CommandEnvelopeSchema.extend({
  type: z.literal("stop_session"),
}).strict();

export type StopSessionCommand = z.infer<typeof StopSessionCommandSchema>;
