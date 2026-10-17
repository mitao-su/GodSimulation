import { z } from "zod";

import { AgentIdSchema, OperationCallIdSchema } from "../identity/ids";
import { CoordinateSchema } from "../world/coordinate";
import { EventEnvelopeSchema } from "./event-envelope";

/** 世界已提交的一格位移；不能用 operation 的意图或预计路径代替。 */
export const AgentMovedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("agent_moved"),
  agentId: AgentIdSchema,
  callId: OperationCallIdSchema,
  from: CoordinateSchema,
  to: CoordinateSchema,
}).strict();
export type AgentMovedEvent = z.infer<typeof AgentMovedEventSchema>;
