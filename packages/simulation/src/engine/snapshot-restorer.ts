import { z } from "zod";

import {
  AgentIdSchema,
  BodySensationSchema,
  CanonicalTaskTracksSchema,
  CoordinateSchema,
  CurrentGoalContextSchema,
  DecisionCycleIdSchema,
  DecisionIdentitySchema,
  DecisionMemorySchema,
  DecisionPromptInputSchema,
  DecisionReasonSchema,
  EntityIdSchema,
  EventIdSchema,
  FacingSchema,
  GoalProposalSchema,
  GoalOptionSchema,
  GoalSchema,
  JsonObjectSchema,
  JsonValueSchema,
  OperationCallIdSchema,
  OperationDurationSchema,
  OperationIdSchema,
  PerceptionSnapshotSchema,
  SimulationRulesLockSchema,
  TaskDecisionSchema,
  TaskOptionIdSchema,
  TaskOptionSchema,
  TechnicalFailureSchema,
  WorldModeSchema,
  WorldSnapshotSchema,
  type AgentId,
  type EntityId,
  type EventId,
  type JsonValue,
  type OperationCallId,
  type SimulationRulesLock,
  type WorldSnapshot,
  type WorldRulesReference,
} from "@god-sim/protocol";
import {
  ObservedInteractionAvailabilitySchema,
} from "@god-sim/plugin-sdk";

import { MapDefinitionSchema } from "../map/map-definition";
import { loadWorldDefinition } from "../map/map-loader";
import type { AgentKnowledge } from "../perception/agent-knowledge";
import type { PluginRegistry } from "../world/plugin-registry";
import {
  bladderSensation,
  type AgentState,
  type DecisionCycleState,
  type ObjectInstance,
  type WorldHistory,
  type WorldState,
} from "../world/world-state";
import { assertSnapshotCausality } from "./snapshot-causality";

const LegacyBodySlotSchema = z.enum(["HEAD", "HANDS", "BODY"]);

const ObservationKindSchema = z.enum([
  "vision",
  "hearing",
  "contact",
  "interaction",
  "body",
  "memory",
]);

const ActionBaseShape = {
  id: z.string().min(1),
  goalId: z.string().min(1),
  durationTicks: z.number().int().positive(),
  progressTicks: z.number().int().nonnegative(),
  slots: z.array(LegacyBodySlotSchema),
};

const MoveActionSchema = z
  .object({
    ...ActionBaseShape,
    kind: z.literal("move"),
    path: z.array(CoordinateSchema).min(1),
  })
  .strict();

const ObjectInteractionActionSchema = z
  .object({
    ...ActionBaseShape,
    kind: z.literal("interact_object"),
    purpose: z.enum(["goal", "automatic_traversal"]),
    targetEntityId: EntityIdSchema,
    interactionId: z.string().min(1),
    started: z.boolean(),
  })
  .strict();

const LegacyObjectActionSchema = z
  .object({
    ...ActionBaseShape,
    kind: z.enum([
      "open_object",
      "close_object",
      "lock_object",
      "unlock_object",
      "use_object",
    ]),
    targetEntityId: EntityIdSchema,
    interactionId: z.string().min(1),
    started: z.boolean(),
  })
  .strict();

const WaitActionSchema = z
  .object({ ...ActionBaseShape, kind: z.literal("wait") })
  .strict();

const ObserveActionSchema = z
  .object({
    ...ActionBaseShape,
    kind: z.literal("observe"),
    targetEntityId: EntityIdSchema,
  })
  .strict();

const RunningActionSchema = z.discriminatedUnion("kind", [
  MoveActionSchema,
  ObjectInteractionActionSchema,
  WaitActionSchema,
  ObserveActionSchema,
]);

const LegacyRunningActionSchema = z.discriminatedUnion("kind", [
  MoveActionSchema,
  LegacyObjectActionSchema,
  WaitActionSchema,
  ObserveActionSchema,
]);

const ActiveGoalSchema = z
  .object({
    id: z.string().min(1),
    goal: GoalSchema,
    label: z.string().min(1),
  })
  .strict();

const ActionPlanSchema = z
  .object({
    goalId: z.string().min(1),
    goal: GoalSchema,
    actions: z.array(RunningActionSchema).min(1),
    currentActionIndex: z.number().int().nonnegative(),
  })
  .strict()
  .refine((plan) => plan.currentActionIndex < plan.actions.length, {
    message: "Snapshot action index is outside its action plan",
  });

const LegacyActionPlanSchema = z
  .object({
    goalId: z.string().min(1),
    goal: GoalSchema,
    actions: z.array(LegacyRunningActionSchema).min(1),
    currentActionIndex: z.number().int().nonnegative(),
  })
  .strict()
  .refine((plan) => plan.currentActionIndex < plan.actions.length, {
    message: "Snapshot action index is outside its action plan",
  });

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

const OperationActionSchema = z.discriminatedUnion("kind", [
  OperationMoveActionSchema,
  OperationObjectInteractionActionSchema,
  OperationWaitActionSchema,
  OperationObserveActionSchema,
]);

const OperationPlanSchema = z
  .object({
    actions: z.array(OperationActionSchema),
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

const ActiveOperationSchema = z
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

const TaskTracksSchema = z
  .object({
    HEAD: TaskTrackStateSchema,
    BODY: TaskTrackStateSchema,
  })
  .strict();

const BodySlotsSchema = z
  .object({
    HEAD: z.string().min(1).nullable(),
    HANDS: z.string().min(1).nullable(),
    BODY: z.string().min(1).nullable(),
  })
  .strict();

const KnownObjectSchema = z
  .object({
    entityId: EntityIdSchema,
    displayName: z.string().min(1),
    status: z.string().min(1),
    summary: z.string().min(1),
    observable: JsonValueSchema,
    interactionAvailability: z.array(ObservedInteractionAvailabilitySchema).default([]),
    position: CoordinateSchema,
    sourceEventId: EventIdSchema,
    observedAtTick: z.number().int().nonnegative(),
    observationKind: ObservationKindSchema,
  })
  .strict();

const KnownAgentSchema = z
  .object({
    agentId: AgentIdSchema,
    displayName: z.string().min(1),
    position: CoordinateSchema,
    sourceEventId: EventIdSchema,
    observedAtTick: z.number().int().nonnegative(),
  })
  .strict();

const ImmediateMemorySchema = z
  .object({
    id: z.string().min(1),
    sourceEventId: EventIdSchema,
    formedAtTick: z.number().int().nonnegative(),
    observationKind: ObservationKindSchema,
    summary: z.string().min(1),
    relatedEntityId: EntityIdSchema.nullable(),
  })
  .strict();

const KnownTraversalBlockerSchema = z
  .object({
    entityId: EntityIdSchema,
    observedObjectVersion: z.number().int().nonnegative(),
    reasonCode: z.string().min(1),
    sourceEventId: EventIdSchema,
  })
  .strict();

const SerializedKnowledgeSchema = z
  .object({
    zoneId: z.string().min(1),
    objects: z.array(KnownObjectSchema),
    agents: z.array(KnownAgentSchema),
    visibleEntityIds: z.array(EntityIdSchema),
    knownTraversalBlockers: z.array(KnownTraversalBlockerSchema),
  })
  .strict();

const LegacySerializedKnowledgeSchema = z
  .object({
    zoneId: z.string().min(1),
    objects: z.array(KnownObjectSchema),
    agents: z.array(KnownAgentSchema),
    visibleEntityIds: z.array(EntityIdSchema),
    knownLockedDoorIds: z.array(EntityIdSchema),
  })
  .strict();

const SerializedAgentSchema = z
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
    taskTracks: TaskTracksSchema,
    activeOperations: z.array(ActiveOperationSchema),
    knowledge: SerializedKnowledgeSchema,
    memories: z.array(ImmediateMemorySchema),
  })
  .strict();

const SingleGoalSerializedAgentSchema = z
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
    currentGoal: ActiveGoalSchema.nullable(),
    actionPlan: ActionPlanSchema.nullable(),
    bodySlots: BodySlotsSchema,
    knowledge: SerializedKnowledgeSchema,
    memories: z.array(ImmediateMemorySchema),
  })
  .strict();

const LegacySerializedAgentSchema = z
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
    currentGoal: ActiveGoalSchema.nullable(),
    actionPlan: LegacyActionPlanSchema.nullable(),
    bodySlots: BodySlotsSchema,
    knowledge: LegacySerializedKnowledgeSchema,
    memories: z.array(ImmediateMemorySchema),
  })
  .strict();

const SerializedObjectSchema = z
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

const LegacyDecisionPromptInputSchema = DecisionIdentitySchema.extend({
  decisionReason: DecisionReasonSchema,
  bodySensations: z.array(BodySensationSchema),
  currentGoal: CurrentGoalContextSchema.nullable(),
  memories: z.array(DecisionMemorySchema),
  perception: PerceptionSnapshotSchema,
  goalOptions: z.array(GoalOptionSchema).min(1),
}).strict();

const LegacySerializedDecisionRequestSchema = z
  .object({
    agentId: AgentIdSchema,
    identity: DecisionIdentitySchema,
    promptInput: LegacyDecisionPromptInputSchema,
    acceptedProposal: GoalProposalSchema.nullable(),
    failure: TechnicalFailureSchema.nullable().default(null),
  })
  .strict();

const LegacySerializedDecisionCycleSchema = z
  .object({
    id: DecisionCycleIdSchema,
    baseWorldVersion: z.number().int().nonnegative(),
    requestedAgentIds: z.array(AgentIdSchema).min(1),
    requests: z.array(LegacySerializedDecisionRequestSchema).min(1),
  })
  .strict();

const SerializedDecisionCycleSchema = z
  .object({
    id: DecisionCycleIdSchema,
    baseWorldVersion: z.number().int().nonnegative(),
    requestedAgentIds: z.array(AgentIdSchema).min(1),
    requests: z.array(SerializedDecisionRequestSchema).min(1),
  })
  .strict();

const SerializedWorldStateCommonShape = {
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

const SerializedWorldStateSchema = z
  .object({
    ...SerializedWorldStateCommonShape,
    stateSchemaVersion: z.literal(2),
    agents: z.array(SerializedAgentSchema).min(1),
    decisionCycle: SerializedDecisionCycleSchema.nullable(),
  })
  .strict();

const SingleGoalSerializedWorldStateSchema = z
  .object({
    ...SerializedWorldStateCommonShape,
    agents: z.array(SingleGoalSerializedAgentSchema).min(1),
    decisionCycle: LegacySerializedDecisionCycleSchema.nullable(),
  })
  .strict();

const LegacySerializedWorldStateSchema = z
  .object({
    ...SerializedWorldStateCommonShape,
    agents: z.array(LegacySerializedAgentSchema).min(1),
    decisionCycle: LegacySerializedDecisionCycleSchema.nullable(),
  })
  .strict();

function uniqueMap<Key, Value>(
  values: readonly Value[],
  keyOf: (value: Value) => Key,
  label: string,
): Map<Key, Value> {
  const result = new Map<Key, Value>();
  for (const value of values) {
    const key = keyOf(value);
    if (result.has(key)) throw new Error(`Snapshot contains duplicate ${label}`);
    result.set(key, value);
  }
  return result;
}

function legacySourceEventId(agentId: AgentId, entityId: EntityId): EventId {
  return EventIdSchema.parse(`event:legacy-locked-door:${agentId}:${entityId}`);
}

function normalizeLegacyState(
  value: z.infer<typeof LegacySerializedWorldStateSchema>,
): z.infer<typeof SingleGoalSerializedWorldStateSchema> {
  const objects = uniqueMap(value.objects, (object) => object.id, "object ID");
  return SingleGoalSerializedWorldStateSchema.parse({
    ...value,
    agents: value.agents.map((agent) => ({
      ...agent,
      actionPlan:
        agent.actionPlan === null
          ? null
          : {
              ...agent.actionPlan,
              actions: agent.actionPlan.actions.map((action) => {
                if (
                  action.kind === "move" ||
                  action.kind === "wait" ||
                  action.kind === "observe"
                ) {
                  return action;
                }
                const { kind, ...rest } = action;
                return {
                  ...rest,
                  kind: "interact_object",
                  purpose: kind === "open_object" ? "automatic_traversal" : "goal",
                };
              }),
            },
      knowledge: {
        zoneId: agent.knowledge.zoneId,
        objects: agent.knowledge.objects,
        agents: agent.knowledge.agents,
        visibleEntityIds: agent.knowledge.visibleEntityIds,
        knownTraversalBlockers: agent.knowledge.knownLockedDoorIds.map((entityId) => {
          const object = objects.get(entityId);
          if (!object) {
            throw new Error(
              `Snapshot agent ${agent.id} knows unknown legacy locked door ${entityId}`,
            );
          }
          return {
            entityId,
            observedObjectVersion: object.version,
            reasonCode: "legacy_locked_door",
            sourceEventId: legacySourceEventId(agent.id, entityId),
          };
        }),
      },
    })),
  });
}

type SingleGoalAgent = z.infer<typeof SingleGoalSerializedAgentSchema>;
type SerializedAgent = z.infer<typeof SerializedAgentSchema>;

function legacyTaskSlots(
  goal: z.infer<typeof GoalSchema>,
  actions: readonly z.infer<typeof RunningActionSchema>[],
  currentActionIndex: number,
): readonly ("HEAD" | "BODY")[] {
  const slots = new Set<"HEAD" | "BODY">();
  for (const action of actions.slice(currentActionIndex)) {
    for (const slot of action.slots) {
      slots.add(slot === "HEAD" ? "HEAD" : "BODY");
    }
  }
  if (slots.size === 0) {
    if (goal.kind === "observe") slots.add("HEAD");
    slots.add("BODY");
  }
  return slots.has("HEAD") ? ["HEAD", "BODY"] : ["BODY"];
}

function migrateLegacyAction(
  action: z.infer<typeof RunningActionSchema>,
): z.infer<typeof OperationActionSchema> {
  const rest: Record<string, unknown> = { ...action };
  delete rest.goalId;
  delete rest.slots;
  if (rest.kind !== "interact_object") {
    return OperationActionSchema.parse(rest);
  }
  return OperationActionSchema.parse({
    ...rest,
    purpose:
      rest.purpose === "automatic_traversal"
        ? "automatic_traversal"
        : "direct",
  });
}

function migrateSingleGoalAgent(
  agent: SingleGoalAgent,
  worldTick: number,
): SerializedAgent {
  const { currentGoal, actionPlan } = agent;
  const stable: Record<string, unknown> = { ...agent };
  delete stable.currentGoal;
  delete stable.actionPlan;
  delete stable.bodySlots;
  if (currentGoal === null) {
    if (actionPlan !== null) {
      throw new Error(
        `Snapshot agent ${agent.id} has an action plan without a current goal`,
      );
    }
    return SerializedAgentSchema.parse({
      ...stable,
      taskTracks: {
        HEAD: { kind: "empty" },
        BODY: { kind: "empty" },
      },
      activeOperations: [],
    });
  }
  if (
    actionPlan !== null &&
    (actionPlan.goalId !== currentGoal.id ||
      JSON.stringify(actionPlan.goal) !== JSON.stringify(currentGoal.goal))
  ) {
    throw new Error(
      `Snapshot agent ${agent.id} has an inconsistent legacy action plan`,
    );
  }
  const actions = actionPlan?.actions ?? [];
  const currentActionIndex = actionPlan?.currentActionIndex ?? 0;
  const taskSlots = legacyTaskSlots(
    currentGoal.goal,
    actions,
    currentActionIndex,
  );
  const progressTicks =
    actions
      .slice(0, currentActionIndex)
      .reduce((sum, action) => sum + action.durationTicks, 0) +
    (actions[currentActionIndex]?.progressTicks ?? 0);
  const callId = OperationCallIdSchema.parse(
    `operation-call:legacy:${agent.id}`,
  );
  const operation = ActiveOperationSchema.parse({
    callId,
    operationId: "legacy.goal",
    taskOptionId: `task-option:legacy:${agent.id}`,
    label: currentGoal.label,
    taskSlots,
    arguments: { goal: currentGoal.goal },
    duration: { kind: "indeterminate" },
    startedAtTick: Math.max(0, worldTick - progressTicks),
    progressTicks,
    plan: {
      actions: actions.map(migrateLegacyAction),
      currentActionIndex,
    },
  });
  return SerializedAgentSchema.parse({
    ...stable,
    taskTracks: {
      HEAD: taskSlots.includes("HEAD")
        ? { kind: "operation", callId }
        : { kind: "empty" },
      BODY: taskSlots.includes("BODY")
        ? { kind: "operation", callId }
        : { kind: "empty" },
    },
    activeOperations: [operation],
  });
}

function legacyOptionSlots(
  goal: z.infer<typeof GoalSchema>,
): readonly ("HEAD" | "BODY")[] {
  return goal.kind === "observe" ? ["HEAD", "BODY"] : ["BODY"];
}

function legacyEmptyTaskOption(
  agentId: AgentId,
  track: "HEAD" | "BODY",
) {
  return TaskOptionSchema.parse({
    kind: "empty",
    id: `task-option:${agentId}:empty-${track.toLowerCase()}`,
    label: `Clear ${track.toLowerCase()} task`,
    taskSlots: [track],
    argumentSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  });
}

function migrateLegacyGoalOption(
  option: z.infer<typeof GoalOptionSchema>,
) {
  return TaskOptionSchema.parse({
    kind: "operation",
    id: TaskOptionIdSchema.parse(option.id),
    operationId: "legacy.goal",
    label: option.label,
    taskSlots: legacyOptionSlots(option.goal),
    argumentSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    fixedArguments: { goal: option.goal },
  });
}

function activeTasksFor(agent: SerializedAgent) {
  return {
    tracks: {
      HEAD:
        agent.taskTracks.HEAD.kind === "operation"
          ? agent.taskTracks.HEAD.callId
          : null,
      BODY:
        agent.taskTracks.BODY.kind === "operation"
          ? agent.taskTracks.BODY.callId
          : null,
    },
    operations: agent.activeOperations.map((operation) => ({
      callId: operation.callId,
      operationId: operation.operationId,
      label: operation.label,
      taskSlots: operation.taskSlots,
      arguments: operation.arguments,
      duration: operation.duration,
      startedAtTick: operation.startedAtTick,
      progressTicks: operation.progressTicks,
    })),
  };
}

function migrateLegacyDecisionCycle(
  cycle: z.infer<typeof LegacySerializedDecisionCycleSchema> | null,
  agents: readonly SerializedAgent[],
) {
  if (cycle === null) return null;
  const agentsById = uniqueMap(agents, (agent) => agent.id, "agent ID");
  return SerializedDecisionCycleSchema.parse({
    ...cycle,
    requests: cycle.requests.map((request) => {
      const agent = agentsById.get(request.agentId);
      if (!agent) {
        throw new Error(
          `Snapshot decision targets unknown agent ${request.agentId}`,
        );
      }
      const taskOptions = [
        legacyEmptyTaskOption(request.agentId, "HEAD"),
        legacyEmptyTaskOption(request.agentId, "BODY"),
        ...request.promptInput.goalOptions.map(migrateLegacyGoalOption),
      ];
      const selected =
        request.acceptedProposal === null
          ? null
          : taskOptions.find(
              (option) =>
                String(option.id) ===
                String(request.acceptedProposal?.goalOptionId),
            );
      if (request.acceptedProposal !== null && !selected) {
        throw new Error(
          `Snapshot decision for ${request.agentId} accepted an unoffered goal`,
        );
      }
      const replacement =
        selected?.kind === "operation"
          ? {
              kind: "replace" as const,
              taskOptionId: selected.id,
              arguments: {},
            }
          : null;
      return {
        agentId: request.agentId,
        identity: request.identity,
        promptInput: {
          ...request.identity,
          decisionReason: request.promptInput.decisionReason,
          bodySensations: request.promptInput.bodySensations,
          activeTasks: activeTasksFor(agent),
          memories: request.promptInput.memories,
          perception: request.promptInput.perception,
          taskOptions,
        },
        acceptedProposal:
          request.acceptedProposal === null || !selected || !replacement
            ? null
            : {
                schemaVersion: 2,
                head: selected.taskSlots.includes("HEAD")
                  ? replacement
                  : { kind: "continue" },
                body: selected.taskSlots.includes("BODY")
                  ? replacement
                  : { kind: "continue" },
                reason: request.acceptedProposal.reason,
              },
        failure: request.failure,
      };
    }),
  });
}

function migrateSingleGoalState(
  value: z.infer<typeof SingleGoalSerializedWorldStateSchema>,
  worldTick: number,
): z.infer<typeof SerializedWorldStateSchema> {
  const agents = value.agents.map((agent) =>
    migrateSingleGoalAgent(agent, worldTick),
  );
  return SerializedWorldStateSchema.parse({
    ...value,
    stateSchemaVersion: 2,
    agents,
    decisionCycle: migrateLegacyDecisionCycle(value.decisionCycle, agents),
  });
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function isJsonObject(
  value: JsonValue | undefined,
): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !isJsonArray(value);
}

function adoptLegacyMapRules(
  state: JsonValue,
  rules: WorldRulesReference,
): JsonValue {
  if (!isJsonObject(state)) return state;
  const map = state["map"];
  if (!isJsonObject(map) || map["rules"] !== undefined) return state;
  return JsonValueSchema.parse({ ...state, map: { ...map, rules } });
}

function parseSerializedState(
  snapshot: WorldSnapshot,
  worldRulesReference: WorldRulesReference,
): {
  readonly state: z.infer<typeof SerializedWorldStateSchema>;
  readonly history: WorldHistory;
} {
  const serializedState =
    snapshot.schemaVersion === 3
      ? snapshot.state
      : adoptLegacyMapRules(snapshot.state, worldRulesReference);
  const currentState = SerializedWorldStateSchema.safeParse(serializedState);
  const singleGoalState = currentState.success
    ? null
    : SingleGoalSerializedWorldStateSchema.safeParse(serializedState);
  const state = currentState.success
    ? currentState.data
    : singleGoalState?.success
      ? migrateSingleGoalState(singleGoalState.data, snapshot.worldTick)
      : migrateSingleGoalState(
          normalizeLegacyState(
            LegacySerializedWorldStateSchema.parse(serializedState),
          ),
          snapshot.worldTick,
        );
  if (snapshot.schemaVersion !== 1) {
    assertSnapshotCausality(snapshot);
    return { state, history: snapshot.history };
  }
  return {
    state,
    history: {
      mode: "legacy",
      causalFromSequence: snapshot.lastEventSequence + 1,
    },
  };
}

function assertCoordinateInMap(
  position: { readonly x: number; readonly y: number },
  width: number,
  height: number,
  label: string,
): void {
  if (position.x >= width || position.y >= height) {
    throw new Error(`Snapshot ${label} is outside the map`);
  }
}

function restoreKnowledge(
  value: z.infer<typeof SerializedKnowledgeSchema>,
): AgentKnowledge {
  return {
    zoneId: value.zoneId,
    objects: uniqueMap(value.objects, (object) => object.entityId, "known object ID"),
    agents: uniqueMap(value.agents, (agent) => agent.agentId, "known agent ID"),
    visibleEntityIds: new Set(value.visibleEntityIds),
    knownTraversalBlockers: uniqueMap(
      value.knownTraversalBlockers,
      (blocker) => blocker.entityId,
      "known traversal blocker ID",
    ),
  };
}

function restoreObjects(
  values: readonly z.infer<typeof SerializedObjectSchema>[],
  baseline: WorldState,
  registry: PluginRegistry,
): ReadonlyMap<EntityId, ObjectInstance> {
  const parsed = uniqueMap(values, (object) => object.id, "object ID");
  if (parsed.size !== baseline.objects.size) {
    throw new Error("Snapshot object set does not match its map");
  }
  const restored = new Map<EntityId, ObjectInstance>();
  for (const [entityId, object] of parsed) {
    const expected = baseline.objects.get(entityId);
    if (!expected || expected.definitionId !== object.definitionId) {
      throw new Error(`Snapshot object ${entityId} does not match its map placement`);
    }
    const definition = registry.getObject(object.definitionId)?.definition;
    if (!definition) throw new Error(`Snapshot object ${entityId} has no plugin definition`);
    assertCoordinateInMap(
      object.position,
      baseline.map.width,
      baseline.map.height,
      `object ${entityId}`,
    );
    restored.set(entityId, {
      ...object,
      state: JsonValueSchema.parse(definition.stateSchema.parse(object.state)),
    });
  }
  return restored;
}

function restoreAgents(
  values: readonly z.infer<typeof SerializedAgentSchema>[],
  baseline: WorldState,
  registry: PluginRegistry,
): ReadonlyMap<AgentId, AgentState> {
  const parsed = uniqueMap(values, (agent) => agent.id, "agent ID");
  if (parsed.size !== baseline.agents.size) {
    throw new Error("Snapshot agent set does not match its map");
  }
  const restored = new Map<AgentId, AgentState>();
  for (const [agentId, agent] of parsed) {
    const expected = baseline.agents.get(agentId);
    if (!expected || expected.definitionId !== agent.definitionId) {
      throw new Error(`Snapshot agent ${agentId} does not match its map spawn`);
    }
    const definition = registry.getAgent(agent.definitionId)?.definition;
    if (
      !definition ||
      definition.displayName !== agent.displayName ||
      definition.resourceId !== agent.resourceId ||
      definition.animationSetId !== agent.animationSetId
    ) {
      throw new Error(`Snapshot agent ${agentId} does not match its plugin definition`);
    }
    if (bladderSensation(agent.bladder) !== agent.bladderSensation) {
      throw new Error(`Snapshot agent ${agentId} has an inconsistent bladder sensation`);
    }
    assertCoordinateInMap(
      agent.position,
      baseline.map.width,
      baseline.map.height,
      `agent ${agentId}`,
    );
    const activeOperations = uniqueMap(
      agent.activeOperations,
      (operation) => operation.callId,
      "active operation call ID",
    );
    const referencedCallIds = new Set<OperationCallId>();
    for (const track of ["HEAD", "BODY"] as const) {
      const task = agent.taskTracks[track];
      if (task.kind === "empty") continue;
      const operation = activeOperations.get(task.callId);
      if (!operation) {
        throw new Error(
          `Snapshot agent ${agentId} track ${track} references missing operation ${task.callId}`,
        );
      }
      if (!operation.taskSlots.includes(track)) {
        throw new Error(
          `Snapshot operation ${task.callId} does not occupy track ${track}`,
        );
      }
      referencedCallIds.add(task.callId);
    }
    for (const operation of activeOperations.values()) {
      if (
        operation.taskSlots.some((track) => {
          const task = agent.taskTracks[track];
          return task.kind !== "operation" || task.callId !== operation.callId;
        })
      ) {
        throw new Error(
          `Snapshot operation ${operation.callId} is not referenced by every declared track`,
        );
      }
      if (!referencedCallIds.has(operation.callId)) {
        throw new Error(
          `Snapshot operation ${operation.callId} is not referenced by a task track`,
        );
      }
      if (
        operation.duration.kind === "fixed" &&
        operation.progressTicks > operation.duration.totalTicks
      ) {
        throw new Error(
          `Snapshot operation ${operation.callId} exceeds its fixed duration`,
        );
      }
    }
    restored.set(agentId, {
      ...agent,
      activeOperations,
      knowledge: restoreKnowledge(agent.knowledge),
    });
  }
  return restored;
}

function restoreDecisionCycle(
  value: z.infer<typeof SerializedDecisionCycleSchema> | null,
  snapshot: WorldSnapshot,
  agents: ReadonlyMap<AgentId, AgentState>,
  technicalFailure: z.infer<typeof TechnicalFailureSchema> | null,
): DecisionCycleState | null {
  if (value === null) return null;
  const requests = uniqueMap(value.requests, (request) => request.agentId, "decision agent ID");
  const requestFailures = new Map<AgentId, z.infer<typeof TechnicalFailureSchema> | null>();
  if (
    requests.size !== value.requestedAgentIds.length ||
    value.requestedAgentIds.some((agentId) => !requests.has(agentId))
  ) {
    throw new Error("Snapshot decision requests do not match the requested agents");
  }
  for (const [agentId, request] of requests) {
    if (!agents.has(agentId)) throw new Error(`Snapshot decision targets unknown agent ${agentId}`);
    const identity = request.identity;
    const prompt = request.promptInput;
    if (
      identity.agentId !== agentId ||
      identity.worldId !== snapshot.worldId ||
      identity.decisionCycleId !== value.id ||
      identity.pluginLockHash !== snapshot.pluginLockHash ||
      prompt.requestId !== identity.requestId ||
      prompt.agentId !== identity.agentId ||
      prompt.worldId !== identity.worldId ||
      prompt.worldVersion !== identity.worldVersion ||
      prompt.decisionCycleId !== identity.decisionCycleId ||
      prompt.pluginLockHash !== identity.pluginLockHash
    ) {
      throw new Error(`Snapshot decision identity is inconsistent for ${agentId}`);
    }
    if (request.acceptedProposal !== null) {
      for (const selection of [
        request.acceptedProposal.head,
        request.acceptedProposal.body,
      ]) {
        if (
          selection.kind === "replace" &&
          !prompt.taskOptions.some(
            (option) => option.id === selection.taskOptionId,
          )
        ) {
          throw new Error(
            `Snapshot decision for ${agentId} accepted an unoffered task`,
          );
        }
      }
    }
    const requestFailure =
      request.failure ??
      (technicalFailure?.category === "model" &&
      technicalFailure.requestId === request.identity.requestId
        ? technicalFailure
        : null);
    if (
      requestFailure !== null &&
      (requestFailure.category !== "model" ||
        requestFailure.requestId !== request.identity.requestId ||
        request.acceptedProposal !== null)
    ) {
      throw new Error(`Snapshot decision failure is inconsistent for ${agentId}`);
    }
    requestFailures.set(agentId, requestFailure);
  }
  return {
    id: value.id,
    baseWorldVersion: value.baseWorldVersion,
    requestedAgentIds: value.requestedAgentIds,
    requests: new Map(
      [...requests].map(([agentId, request]) => [
        agentId,
        {
          identity: request.identity,
          promptInput: request.promptInput,
          acceptedProposal: request.acceptedProposal,
          failure: requestFailures.get(agentId) ?? null,
        },
      ]),
    ),
  };
}

export function restoreWorldSnapshot(
  snapshotValue: WorldSnapshot,
  registry: PluginRegistry,
  worldDefinition: unknown,
  simulationRulesLock: SimulationRulesLock,
): WorldState {
  const snapshot = WorldSnapshotSchema.parse(snapshotValue);
  const configuredRulesLock = SimulationRulesLockSchema.parse(simulationRulesLock);
  if (
    snapshot.schemaVersion === 3 &&
    (snapshot.simulationRulesLock.hash !== configuredRulesLock.hash ||
      JSON.stringify(snapshot.simulationRulesLock.rules) !==
        JSON.stringify(configuredRulesLock.rules))
  ) {
    throw new Error("Snapshot simulation rules do not match the configured rule lock");
  }
  const expectedMap = MapDefinitionSchema.parse(worldDefinition);
  const { state, history } = parseSerializedState(snapshot, expectedMap.rules);
  if (state.map.id !== snapshot.worldId || expectedMap.id !== snapshot.worldId) {
    throw new Error("Snapshot world ID does not match its map");
  }
  if (JSON.stringify(state.map) !== JSON.stringify(expectedMap)) {
    throw new Error("Snapshot map does not match the configured world definition");
  }
  if (state.name !== state.map.name) {
    throw new Error("Snapshot world name does not match its map");
  }
  const baseline = loadWorldDefinition(expectedMap, registry, {
    simulationRulesLock: configuredRulesLock,
    reviewRequired: state.reviewRequired,
    seed: state.randomState,
    pluginLockHash: snapshot.pluginLockHash,
  }).world;
  const objects = restoreObjects(state.objects, baseline, registry);
  const agents = restoreAgents(state.agents, baseline, registry);
  const decisionCycle = restoreDecisionCycle(
    state.decisionCycle,
    snapshot,
    agents,
    state.technicalFailure,
  );
  const hasPendingDecision = decisionCycle
    ? [...decisionCycle.requests.values()].some((request) => request.acceptedProposal === null)
    : false;
  const suspendedMode =
    state.suspendedMode === undefined
      ? state.mode === "TECHNICALLY_BLOCKED"
        ? decisionCycle === null
          ? "RUNNING"
          : hasPendingDecision
            ? "THINKING"
            : "READY_FOR_RELEASE"
        : null
      : state.suspendedMode;
  if ((state.mode === "TECHNICALLY_BLOCKED") !== (state.technicalFailure !== null)) {
    throw new Error("Snapshot technical failure does not match its world mode");
  }
  if ((state.mode === "TECHNICALLY_BLOCKED") !== (suspendedMode !== null)) {
    throw new Error("Snapshot suspended mode does not match its world mode");
  }
  const resumableMode =
    state.mode === "TECHNICALLY_BLOCKED" ? suspendedMode : state.mode;
  if (!resumableMode) throw new Error("Snapshot has no resumable world mode");
  if (resumableMode === "RUNNING" && decisionCycle !== null) {
    throw new Error("Running snapshot cannot retain a decision cycle");
  }
  if (resumableMode !== "RUNNING" && decisionCycle === null) {
    throw new Error("Frozen snapshot requires a decision cycle");
  }
  if (resumableMode === "READY_FOR_RELEASE" && hasPendingDecision) {
    throw new Error("Ready snapshot still has pending decisions");
  }
  if (resumableMode === "THINKING" && !hasPendingDecision) {
    throw new Error("Thinking snapshot has no pending decision");
  }
  return {
    id: snapshot.worldId,
    name: state.name,
    version: snapshot.worldVersion,
    tick: snapshot.worldTick,
    mode: state.mode,
    suspendedMode,
    reviewRequired: state.reviewRequired,
    randomState: state.randomState,
    lastEventSequence: snapshot.lastEventSequence,
    pluginLockHash: snapshot.pluginLockHash,
    simulationRulesLock: configuredRulesLock,
    history,
    map: expectedMap,
    agents,
    objects,
    decisionCycle,
    technicalFailure: state.technicalFailure,
  };
}
