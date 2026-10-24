import { z } from "zod";

const StableIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const WorldIdSchema = StableIdSchema.brand<"WorldId">();
export type WorldId = z.infer<typeof WorldIdSchema>;

/**
 * 可回放时间线的分支身份。
 *
 * 分支不是数据库里的展示字段：它是请求、事件和快照的作用域，任何
 * 异步记忆结果都必须带着同一分支身份回到权威模拟进程。
 */
export const BranchIdSchema = StableIdSchema.brand<"BranchId">();
export type BranchId = z.infer<typeof BranchIdSchema>;

export const AgentIdSchema = StableIdSchema.brand<"AgentId">();
export type AgentId = z.infer<typeof AgentIdSchema>;

export const EntityIdSchema = StableIdSchema.brand<"EntityId">();
export type EntityId = z.infer<typeof EntityIdSchema>;

export const RequestIdSchema = StableIdSchema.brand<"RequestId">();
export type RequestId = z.infer<typeof RequestIdSchema>;

export const EventIdSchema = StableIdSchema.brand<"EventId">();
export type EventId = z.infer<typeof EventIdSchema>;

export const CheckpointIdSchema = StableIdSchema.brand<"CheckpointId">();
export type CheckpointId = z.infer<typeof CheckpointIdSchema>;

export const CommandIdSchema = StableIdSchema.brand<"CommandId">();
export type CommandId = z.infer<typeof CommandIdSchema>;

export const QueryIdSchema = StableIdSchema.brand<"QueryId">();
export type QueryId = z.infer<typeof QueryIdSchema>;

export const DecisionCycleIdSchema = StableIdSchema.brand<"DecisionCycleId">();
export type DecisionCycleId = z.infer<typeof DecisionCycleIdSchema>;

export const ConsolidationCycleIdSchema = StableIdSchema.brand<"ConsolidationCycleId">();
export type ConsolidationCycleId = z.infer<typeof ConsolidationCycleIdSchema>;

export const GoalOptionIdSchema = StableIdSchema.brand<"GoalOptionId">();
export type GoalOptionId = z.infer<typeof GoalOptionIdSchema>;

export const TaskOptionIdSchema = StableIdSchema.brand<"TaskOptionId">();
export type TaskOptionId = z.infer<typeof TaskOptionIdSchema>;

export const OperationIdSchema = StableIdSchema.brand<"OperationId">();
export type OperationId = z.infer<typeof OperationIdSchema>;

export const OperationCallIdSchema = StableIdSchema.brand<"OperationCallId">();
export type OperationCallId = z.infer<typeof OperationCallIdSchema>;

export const CausalIdSchema = StableIdSchema.brand<"CausalId">();
export type CausalId = z.infer<typeof CausalIdSchema>;

export const PluginLockHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export type PluginLockHash = z.infer<typeof PluginLockHashSchema>;

export const SimulationRulesIdSchema = StableIdSchema.brand<"SimulationRulesId">();
export type SimulationRulesId = z.infer<typeof SimulationRulesIdSchema>;

export const SimulationRulesHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export type SimulationRulesHash = z.infer<typeof SimulationRulesHashSchema>;
