import { z } from "zod";

import {
  AgentIdSchema,
  CanonicalTaskTracksSchema,
  CoordinateSchema,
  DecisionCycleIdSchema,
  DecisionIdentitySchema,
  DecisionPromptInputSchema,
  EntityIdSchema,
  EventIdSchema,
  FacingSchema,
  JsonObjectSchema,
  JsonValueSchema,
  OperationCallIdSchema,
  OperationDurationSchema,
  OperationIdSchema,
  OperationResultContextSchema,
  TaskDecisionSchema,
  TaskOptionIdSchema,
  TechnicalFailureSchema,
  WorldModeSchema,
} from "@god-sim/protocol";
import { ObservedInteractionAvailabilitySchema } from "@god-sim/plugin-sdk";

import { MapDefinitionSchema } from "../map/map-definition";

export const SnapshotObservationKindSchema = z.enum([
  "vision",
  "hearing",
  "contact",
  "interaction",
  "body",
  "memory",
]);

const OperationActionBaseShape = {
  id: z.string().min(1),
  durationTicks: z.number().int().positive(),
  progressTicks: z.number().int().nonnegative(),
};

const OperationMoveActionSchema = z
  .object({
    ...OperationActionBaseShape,
    kind: z.literal("move"),
    path: z.array(CoordinateSchema).min(1),
  })
  .strict();

const OperationObjectInteractionActionSchema = z
  .object({
    ...OperationActionBaseShape,
    kind: z.literal("interact_object"),
    purpose: z.enum(["direct", "automatic_traversal"]),
    targetEntityId: EntityIdSchema,
    interactionId: z.string().min(1),
    started: z.boolean(),
  })
  .strict();

const OperationWaitActionSchema = z
  .object({ ...OperationActionBaseShape, kind: z.literal("wait") })
  .strict();

const OperationObserveActionSchema = z
  .object({
    ...OperationActionBaseShape,
    kind: z.literal("observe"),
    targetEntityId: EntityIdSchema,
  })
  .strict();

export const SerializedOperationActionSchema = z.discriminatedUnion("kind", [
  OperationMoveActionSchema,
  OperationObjectInteractionActionSchema,
  OperationWaitActionSchema,
  OperationObserveActionSchema,
]);

const OperationPlanSchema = z
  .object({
    actions: z.array(SerializedOperationActionSchema),
    currentActionIndex: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (plan) =>
      plan.actions.length === 0
        ? plan.currentActionIndex === 0
        : plan.currentActionIndex < plan.actions.length,
    { message: "Snapshot operation action index is outside its plan" },
  );

export const SerializedActiveOperationSchema = z
  .object({
    callId: OperationCallIdSchema,
    operationId: OperationIdSchema,
    taskOptionId: TaskOptionIdSchema,
    label: z.string().min(1).max(160),
    taskSlots: CanonicalTaskTracksSchema,
    arguments: JsonObjectSchema,
    duration: OperationDurationSchema,
    startedAtTick: z.number().int().nonnegative(),
    progressTicks: z.number().int().nonnegative(),
    /**
     * Opaque runtime-owned state. The codec deliberately does not know
     * what each operation stores here; the operation runtime's
     * `stateSchema` validates it at the restoration boundary.
     */
    state: JsonObjectSchema.default({}),
    plan: OperationPlanSchema,
  })
  .strict();

const TaskTrackStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("empty") }).strict(),
  z
    .object({
      kind: z.literal("operation"),
      callId: OperationCallIdSchema,
    })
    .strict(),
]);

export const SerializedTaskTracksSchema = z
  .object({
    HEAD: TaskTrackStateSchema,
    BODY: TaskTrackStateSchema,
  })
  .strict();

export const SerializedKnownObjectSchema = z
  .object({
    entityId: EntityIdSchema,
    displayName: z.string().min(1),
    status: z.string().min(1),
    summary: z.string().min(1),
    observable: JsonValueSchema,
    interactionAvailability: z
      .array(ObservedInteractionAvailabilitySchema)
      .default([]),
    position: CoordinateSchema,
    sourceEventId: EventIdSchema,
    observedAtTick: z.number().int().nonnegative(),
    observationKind: SnapshotObservationKindSchema,
  })
  .strict();

export const SerializedKnownAgentSchema = z
  .object({
    agentId: AgentIdSchema,
    displayName: z.string().min(1),
    position: CoordinateSchema,
    sourceEventId: EventIdSchema,
    observedAtTick: z.number().int().nonnegative(),
  })
  .strict();

export const SerializedImmediateMemorySchema = z
  .object({
    id: z.string().min(1),
    sourceEventId: EventIdSchema,
    formedAtTick: z.number().int().nonnegative(),
    observationKind: SnapshotObservationKindSchema,
    summary: z.string().min(1),
    relatedEntityId: EntityIdSchema.nullable(),
  })
  .strict();

export const SerializedKnownTraversalBlockerSchema = z
  .object({
    entityId: EntityIdSchema,
    observedObjectVersion: z.number().int().nonnegative(),
    reasonCode: z.string().min(1),
    sourceEventId: EventIdSchema,
  })
  .strict();

export const SerializedKnowledgeSchema = z
  .object({
    zoneId: z.string().min(1),
    objects: z.array(SerializedKnownObjectSchema),
    agents: z.array(SerializedKnownAgentSchema),
    visibleEntityIds: z.array(EntityIdSchema),
    knownTraversalBlockers: z.array(SerializedKnownTraversalBlockerSchema),
  })
  .strict();

export const SerializedAgentSchema = z
  .object({
    id: AgentIdSchema,
    definitionId: z.string().min(1),
    displayName: z.string().min(1),
    resourceId: z.string().min(1),
    animationSetId: z.string().min(1),
    position: CoordinateSchema,
    facing: FacingSchema,
    bladder: z.number().int().min(0).max(100),
    bladderSensation: z.enum(["comfortable", "noticeable", "urgent"]),
    taskTracks: SerializedTaskTracksSchema,
    activeOperations: z.array(SerializedActiveOperationSchema),
    pendingOperationResults: z.array(OperationResultContextSchema).default([]),
    knowledge: SerializedKnowledgeSchema,
    memories: z.array(SerializedImmediateMemorySchema),
  })
  .strict();

export const SerializedObjectSchema = z
  .object({
    id: EntityIdSchema,
    definitionId: z.string().min(1),
    version: z.number().int().nonnegative(),
    position: CoordinateSchema,
    facing: FacingSchema,
    state: JsonValueSchema,
  })
  .strict();

const SerializedDecisionRequestSchema = z
  .object({
    agentId: AgentIdSchema,
    identity: DecisionIdentitySchema,
    promptInput: DecisionPromptInputSchema,
    acceptedProposal: TaskDecisionSchema.nullable(),
    failure: TechnicalFailureSchema.nullable().default(null),
  })
  .strict();

export const SerializedDecisionCycleSchema = z
  .object({
    id: DecisionCycleIdSchema,
    baseWorldVersion: z.number().int().nonnegative(),
    requestedAgentIds: z.array(AgentIdSchema).min(1),
    requests: z.array(SerializedDecisionRequestSchema).min(1),
  })
  .strict();

export const SerializedWorldStateCommonShape = {
  name: z.string().min(1),
  mode: WorldModeSchema,
  suspendedMode: z
    .enum(["THINKING", "READY_FOR_RELEASE", "RUNNING"])
    .nullable()
    .optional(),
  reviewRequired: z.boolean(),
  randomState: z.number().int().min(0).max(0xffff_ffff),
  map: MapDefinitionSchema,
  objects: z.array(SerializedObjectSchema),
  technicalFailure: TechnicalFailureSchema.nullable(),
};

export const SerializedWorldStateSchema = z
  .object({
    ...SerializedWorldStateCommonShape,
    stateSchemaVersion: z.literal(3),
    agents: z.array(SerializedAgentSchema).min(1),
    decisionCycle: SerializedDecisionCycleSchema.nullable(),
  })
  .strict();

export type SerializedWorldState = z.infer<typeof SerializedWorldStateSchema>;
