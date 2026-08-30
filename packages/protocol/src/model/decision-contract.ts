import { z } from "zod";

import {
  AgentIdSchema,
  DecisionCycleIdSchema,
  EntityIdSchema,
  EventIdSchema,
  GoalOptionIdSchema,
  PluginLockHashSchema,
  RequestIdSchema,
  WorldIdSchema,
} from "../identity/ids";
import { JsonValueSchema } from "../json/json-value";

export const UseObjectGoalSchema = z
  .object({
    kind: z.literal("use_object"),
    targetEntityId: EntityIdSchema,
    interactionId: z.string().min(1),
  })
  .strict();

export const WaitGoalSchema = z
  .object({
    kind: z.literal("wait"),
    durationTicks: z.number().int().positive().max(600),
  })
  .strict();

export const ObserveGoalSchema = z
  .object({
    kind: z.literal("observe"),
    targetEntityId: EntityIdSchema,
  })
  .strict();

export const GoalSchema = z.discriminatedUnion("kind", [
  UseObjectGoalSchema,
  WaitGoalSchema,
  ObserveGoalSchema,
]);

export type Goal = z.infer<typeof GoalSchema>;

export const GoalOptionSchema = z
  .object({
    id: GoalOptionIdSchema,
    label: z.string().min(1).max(160),
    goal: GoalSchema,
  })
  .strict();

export type GoalOption = z.infer<typeof GoalOptionSchema>;

export const GoalProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    goalOptionId: GoalOptionIdSchema,
    reason: z.string().min(1).max(500),
  })
  .strict();

export type GoalProposal = z.infer<typeof GoalProposalSchema>;

export const DecisionIdentitySchema = z
  .object({
    requestId: RequestIdSchema,
    agentId: AgentIdSchema,
    worldId: WorldIdSchema,
    worldVersion: z.number().int().nonnegative(),
    decisionCycleId: DecisionCycleIdSchema,
    schemaVersion: z.literal(1),
    pluginLockHash: PluginLockHashSchema,
    retryOfRequestId: RequestIdSchema.optional(),
  })
  .strict();

export type DecisionIdentity = z.infer<typeof DecisionIdentitySchema>;

export const DecisionReasonSchema = z
  .object({
    code: z.string().min(1).max(80),
    summary: z.string().min(1).max(500),
  })
  .strict();

export type DecisionReason = z.infer<typeof DecisionReasonSchema>;

export const BodySensationSchema = z
  .object({
    need: z.literal("bladder"),
    level: z.enum(["comfortable", "noticeable", "urgent"]),
    description: z.string().min(1).max(200),
  })
  .strict();

export const CurrentGoalContextSchema = z
  .object({
    goal: GoalSchema,
    label: z.string().min(1).max(160),
    actionKind: z.string().min(1).nullable(),
    actionProgress: z.number().int().nonnegative().nullable(),
    lastFailure: z.string().max(500).nullable(),
  })
  .strict();

export const DecisionMemorySchema = z
  .object({
    memoryId: z.string().min(1),
    sourceEventId: EventIdSchema,
    summary: z.string().min(1).max(500),
    formedAtTick: z.number().int().nonnegative(),
    observationKind: z.enum(["vision", "hearing", "contact", "interaction", "body"]),
  })
  .strict();

export const PerceivedEntitySchema = z
  .object({
    entityId: EntityIdSchema,
    displayName: z.string().min(1).max(160),
    kind: z.enum(["agent", "object"]),
    observable: JsonValueSchema,
  })
  .strict();

export const HeardEventSchema = z
  .object({
    sourceEventId: EventIdSchema,
    summary: z.string().min(1).max(500),
  })
  .strict();

export const PerceptionSnapshotSchema = z
  .object({
    zoneId: z.string().min(1),
    visibleEntities: z.array(PerceivedEntitySchema),
    heardEvents: z.array(HeardEventSchema),
  })
  .strict();

export const SubjectiveDecisionContextSchema = z
  .object({
    decisionReason: DecisionReasonSchema,
    bodySensations: z.array(BodySensationSchema),
    currentGoal: CurrentGoalContextSchema.nullable(),
    memories: z.array(DecisionMemorySchema),
    perception: PerceptionSnapshotSchema,
  })
  .strict();

export type SubjectiveDecisionContext = z.infer<typeof SubjectiveDecisionContextSchema>;

export const DecisionPromptInputSchema = DecisionIdentitySchema.extend({
  ...SubjectiveDecisionContextSchema.shape,
  goalOptions: z.array(GoalOptionSchema).min(1),
}).strict();

export type DecisionPromptInput = z.infer<typeof DecisionPromptInputSchema>;

export const ModelMessageSchema = z
  .object({
    role: z.enum(["system", "user"]),
    content: z.string().min(1),
  })
  .strict();

export const ModelDecisionRequestSchema = DecisionIdentitySchema.extend({
  decisionReason: DecisionReasonSchema,
  messages: z.array(ModelMessageSchema).min(1),
  goalOptions: z.array(GoalOptionSchema).min(1),
}).strict();

export type ModelDecisionRequest = z.infer<typeof ModelDecisionRequestSchema>;

export const ModelDecisionResultSchema = DecisionIdentitySchema.extend({
  proposal: GoalProposalSchema,
}).strict();

export type ModelDecisionResult = z.infer<typeof ModelDecisionResultSchema>;
