import { z } from "zod";

import {
  AgentIdSchema,
  CoordinateSchema,
  EntityIdSchema,
  JsonValueSchema,
  OperationCallIdSchema,
  OperationDomainFailureCodeSchema,
} from "@god-sim/protocol";

/** 位移提议绑定当前调用进度与出发格，重复或过期提交不得再次移动。 */
export const MoveAgentEffectSchema = z.object({
  type: z.literal("move_agent"),
  agentId: AgentIdSchema,
  callId: OperationCallIdSchema,
  expectedProgressTicks: z.number().int().nonnegative(),
  from: CoordinateSchema,
  to: CoordinateSchema,
}).strict();
export type MoveAgentEffect = z.infer<typeof MoveAgentEffectSchema>;

/** 自动通行失败作为移动事实提交，来源事件与角色已知阻挡同时写入。 */
export const RecordTraversalBlockerEffectSchema = z.object({
  type: z.literal("record_traversal_blocker"),
  agentId: AgentIdSchema,
  callId: OperationCallIdSchema,
  expectedProgressTicks: z.number().int().nonnegative(),
  entityId: EntityIdSchema,
  expectedObjectVersion: z.number().int().nonnegative(),
  reasonCode: OperationDomainFailureCodeSchema,
  summary: z.string().min(1).max(500),
}).strict();
export type RecordTraversalBlockerEffect = z.infer<typeof RecordTraversalBlockerEffectSchema>;

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
  MoveAgentEffectSchema,
  RecordTraversalBlockerEffectSchema,
  ReplaceObjectStateEffectSchema,
  SetAgentNeedEffectSchema,
  ReserveOccupancyEffectSchema,
  ReleaseOccupancyEffectSchema,
  EmitPerceptibleResultEffectSchema,
]);

export type Effect = z.infer<typeof EffectSchema>;

export const EffectProposalSchema = z.object({ effects: z.array(EffectSchema) }).strict();
export type EffectProposal = z.infer<typeof EffectProposalSchema>;
