import { z } from "zod";

import { DecisionCycleIdSchema } from "../identity/ids";
import { EventEnvelopeSchema } from "./event-envelope";

export const WorldReleasedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("world_released"),
  decisionCycleId: DecisionCycleIdSchema,
  automatic: z.boolean(),
}).strict();

export type WorldReleasedEvent = z.infer<typeof WorldReleasedEventSchema>;
