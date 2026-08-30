import { z } from "zod";

import { AgentIdSchema, EntityIdSchema, JsonValueSchema } from "@god-sim/protocol";

export const ReplaceObjectStateEffectSchema = z
  .object({
    type: z.literal("replace_object_state"),
    entityId: EntityIdSchema,
    expectedObjectVersion: z.number().int().nonnegative(),
    state: JsonValueSchema,
  })
  .strict();

export const SetAgentNeedEffectSchema = z
  .object({
    type: z.literal("set_agent_need"),
    agentId: AgentIdSchema,
    need: z.literal("bladder"),
    value: z.number().int().min(0).max(100),
  })
  .strict();

export const ReserveOccupancyEffectSchema = z
  .object({
    type: z.literal("reserve_occupancy"),
    entityId: EntityIdSchema,
    agentId: AgentIdSchema,
    expectedObjectVersion: z.number().int().nonnegative(),
  })
  .strict();

export const ReleaseOccupancyEffectSchema = z
  .object({
    type: z.literal("release_occupancy"),
    entityId: EntityIdSchema,
    agentId: AgentIdSchema,
    expectedObjectVersion: z.number().int().nonnegative(),
  })
  .strict();

export const EmitPerceptibleResultEffectSchema = z
  .object({
    type: z.literal("emit_perceptible_result"),
    sourceEntityId: EntityIdSchema,
    audienceAgentIds: z.array(AgentIdSchema),
    senses: z.array(z.enum(["vision", "hearing", "contact", "interaction"])).min(1),
    summary: z.string().min(1).max(500),
  })
  .strict();

export const EffectSchema = z.discriminatedUnion("type", [
  ReplaceObjectStateEffectSchema,
  SetAgentNeedEffectSchema,
  ReserveOccupancyEffectSchema,
  ReleaseOccupancyEffectSchema,
  EmitPerceptibleResultEffectSchema,
]);

export type Effect = z.infer<typeof EffectSchema>;

export const EffectProposalSchema = z.object({ effects: z.array(EffectSchema) }).strict();
export type EffectProposal = z.infer<typeof EffectProposalSchema>;
