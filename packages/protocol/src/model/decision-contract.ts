import { z } from "zod";

import {
  AgentIdSchema,
  DecisionCycleIdSchema,
  EntityIdSchema,
  EventIdSchema,
  OperationCallIdSchema,
  OperationIdSchema,
  PluginLockHashSchema,
  RequestIdSchema,
  WorldIdSchema,
} from "../identity/ids";
import {
  ActiveTasksContextSchema,
  TaskDecisionSchema,
  TaskOptionSchema,
} from "../execution/task-contract";
import { OperationTerminationOutcomeSchema } from "../events/operation-terminated.event";
import { JsonObjectSchema, JsonValueSchema } from "../json/json-value";

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

export const DecisionMemorySchema = z
  .object({
    memoryId: z.string().min(1),
    sourceEventId: EventIdSchema,
    summary: z.string().min(1).max(500),
    formedAtTick: z.number().int().nonnegative(),
    observationKind: z.enum([
      "vision",
      "hearing",
      "contact",
      "interaction",
      "body",
      "memory",
    ]),
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

export const OperationResultContextSchema = z
  .object({
    callId: OperationCallIdSchema,
    operationId: OperationIdSchema,
    terminal: z.boolean(),
    outcome: OperationTerminationOutcomeSchema.nullable(),
    reasonCode: z.string().min(1).max(120),
    result: JsonObjectSchema,
    emittedAtTick: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.terminal !== (value.outcome !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only terminal operation results have an outcome",
      });
    }
  });
export type OperationResultContext = z.infer<
  typeof OperationResultContextSchema
>;

export const SubjectiveDecisionContextSchema = z
  .object({
    decisionReason: DecisionReasonSchema,
    bodySensations: z.array(BodySensationSchema),
    activeTasks: ActiveTasksContextSchema,
    memories: z.array(DecisionMemorySchema),
    perception: PerceptionSnapshotSchema,
    operationResults: z.array(OperationResultContextSchema).default([]),
  })
  .strict();

export type SubjectiveDecisionContext = z.infer<typeof SubjectiveDecisionContextSchema>;

export const DecisionPromptInputSchema = DecisionIdentitySchema.extend({
  ...SubjectiveDecisionContextSchema.shape,
  taskOptions: z.array(TaskOptionSchema).min(1),
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
  taskOptions: z.array(TaskOptionSchema).min(1),
}).strict();

export type ModelDecisionRequest = z.infer<typeof ModelDecisionRequestSchema>;

export const ModelDecisionResultSchema = DecisionIdentitySchema.extend({
  proposal: TaskDecisionSchema,
}).strict();

export type ModelDecisionResult = z.infer<typeof ModelDecisionResultSchema>;
