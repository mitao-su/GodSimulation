import { z } from "zod";

const StableIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const WorldIdSchema = StableIdSchema.brand<"WorldId">();
export type WorldId = z.infer<typeof WorldIdSchema>;

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

export const GoalOptionIdSchema = StableIdSchema.brand<"GoalOptionId">();
export type GoalOptionId = z.infer<typeof GoalOptionIdSchema>;

export const CausalIdSchema = StableIdSchema.brand<"CausalId">();
export type CausalId = z.infer<typeof CausalIdSchema>;

export const PluginLockHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export type PluginLockHash = z.infer<typeof PluginLockHashSchema>;
