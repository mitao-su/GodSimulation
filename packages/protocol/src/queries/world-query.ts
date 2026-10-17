import { z } from "zod";

import { AgentIdSchema, CausalIdSchema, QueryIdSchema, WorldIdSchema } from "../identity/ids";
import { CoordinateSchema } from "../world/coordinate";

const QueryEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    queryId: QueryIdSchema,
    worldId: WorldIdSchema,
    expectedWorldVersion: z.number().int().nonnegative(),
    causationId: CausalIdSchema,
  })
  .strict();

export const GetWorldViewQuerySchema = QueryEnvelopeSchema.extend({
  type: z.literal("get_world_view"),
}).strict();

export const VisibilityQuerySchema = QueryEnvelopeSchema.extend({
  type: z.literal("visibility"),
  agentId: AgentIdSchema,
  origin: CoordinateSchema,
  radius: z.number().int().positive().max(64),
}).strict();

export const WorldQuerySchema = z.discriminatedUnion("type", [
  GetWorldViewQuerySchema,
  VisibilityQuerySchema,
]);

export type WorldQuery = z.infer<typeof WorldQuerySchema>;
