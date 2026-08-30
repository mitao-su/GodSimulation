import { z } from "zod";

import { EntityIdSchema } from "../identity/ids";
import { JsonValueSchema } from "../json/json-value";
import { EventEnvelopeSchema } from "./event-envelope";

export const ObjectStateChangedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("object_state_changed"),
  entityId: EntityIdSchema,
  objectVersion: z.number().int().nonnegative(),
  state: JsonValueSchema,
}).strict();

export type ObjectStateChangedEvent = z.infer<typeof ObjectStateChangedEventSchema>;
