import { z } from "zod";

import { AgentIdSchema, EntityIdSchema } from "../identity/ids";
import { EventEnvelopeSchema } from "./event-envelope";

export const InteractionArbitratedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("interaction_arbitrated"),
  entityId: EntityIdSchema,
  interactionId: z.string().min(1),
  contenders: z.array(AgentIdSchema).min(2),
  winnerAgentId: AgentIdSchema,
  tieBreaker: z.number().int().nonnegative(),
}).strict();

export type InteractionArbitratedEvent = z.infer<typeof InteractionArbitratedEventSchema>;
