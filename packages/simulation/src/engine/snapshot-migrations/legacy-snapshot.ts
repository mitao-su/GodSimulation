import { z } from "zod";

import {
  AgentIdSchema,
  BodySensationSchema,
  CoordinateSchema,
  DecisionCycleIdSchema,
  DecisionIdentitySchema,
  DecisionMemorySchema,
  DecisionReasonSchema,
  EntityIdSchema,
  EventIdSchema,
  FacingSchema,
  JsonValueSchema,
  OperationCallIdSchema,
  PerceptionSnapshotSchema,
  TaskOptionIdSchema,
  TaskOptionSchema,
  TechnicalFailureSchema,
  type AgentId,
  type EntityId,
  type EventId,
  type JsonValue,
  type WorldSnapshot,
  type WorldRulesReference,
} from "@god-sim/protocol";

import type { WorldHistory } from "../../world/world-state";
import { objectInteractionOperationId } from "../../execution/object-interaction-adapter";
import { assertSnapshotCausality } from "../snapshot-causality";
import {
  SerializedActiveOperationSchema as ActiveOperationSchema,
  SerializedAgentSchema,
  SerializedDecisionCycleSchema,
  SerializedImmediateMemorySchema as ImmediateMemorySchema,
  SerializedKnowledgeSchema,
  SerializedKnownAgentSchema as KnownAgentSchema,
  SerializedKnownObjectSchema as KnownObjectSchema,
  SerializedOperationActionSchema as OperationActionSchema,
  SerializedWorldStateCommonShape,
  SerializedWorldStateSchema,
} from "../snapshot-state-codec";
import {
  LegacyCurrentGoalContextSchema,
  LegacyGoalOptionSchema,
  LegacyGoalProposalSchema,
  LegacyGoalSchema,
} from "./legacy-goal-schema";

const LegacyBodySlotSchema = z.enum(["HEAD", "HANDS", "BODY"]);

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
    goal: LegacyGoalSchema,
    label: z.string().min(1),
  })
  .strict();

const ActionPlanSchema = z
  .object({
    goalId: z.string().min(1),
    goal: LegacyGoalSchema,
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
    goal: LegacyGoalSchema,
    actions: z.array(LegacyRunningActionSchema).min(1),
    currentActionIndex: z.number().int().nonnegative(),
  })
  .strict()
  .refine((plan) => plan.currentActionIndex < plan.actions.length, {
    message: "Snapshot action index is outside its action plan",
  });

const BodySlotsSchema = z
  .object({
    HEAD: z.string().min(1).nullable(),
    HANDS: z.string().min(1).nullable(),
    BODY: z.string().min(1).nullable(),
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

const LegacyDecisionPromptInputSchema = DecisionIdentitySchema.extend({
  decisionReason: DecisionReasonSchema,
  bodySensations: z.array(BodySensationSchema),
  currentGoal: LegacyCurrentGoalContextSchema.nullable(),
  memories: z.array(DecisionMemorySchema),
  perception: PerceptionSnapshotSchema,
  goalOptions: z.array(LegacyGoalOptionSchema).min(1),
}).strict();

const LegacySerializedDecisionRequestSchema = z
  .object({
    agentId: AgentIdSchema,
    identity: DecisionIdentitySchema,
    promptInput: LegacyDecisionPromptInputSchema,
    acceptedProposal: LegacyGoalProposalSchema.nullable(),
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

export function uniqueMap<Key, Value>(
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
type LegacyObjectIndex = ReadonlyMap<
  EntityId,
  { readonly definitionId: string }
>;

function legacyOperationBinding(
  goal: z.infer<typeof LegacyGoalSchema>,
  objects: LegacyObjectIndex,
) {
  switch (goal.kind) {
    case "wait":
      return {
        operationId: "core.wait",
        taskSlots: ["BODY"] as const,
        arguments: { durationTicks: goal.durationTicks },
      };
    case "observe":
      return {
        operationId: "core.observe",
        taskSlots: ["HEAD"] as const,
        arguments: { targetEntityId: goal.targetEntityId },
      };
    case "use_object": {
      const object = objects.get(goal.targetEntityId);
      if (!object) {
        throw new Error(
          `Legacy goal targets unknown object ${goal.targetEntityId}`,
        );
      }
      return {
        operationId: objectInteractionOperationId(
          object.definitionId,
          goal.interactionId,
        ),
        taskSlots: ["BODY"] as const,
        arguments: { targetEntityId: goal.targetEntityId, parameters: {} },
      };
    }
  }
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
  objects: LegacyObjectIndex,
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
  const binding = legacyOperationBinding(currentGoal.goal, objects);
  const taskSlots: readonly ("HEAD" | "BODY")[] = binding.taskSlots;
  const currentAction = actions[currentActionIndex];
  const progressTicks = currentAction?.progressTicks ?? 0;
  const callId = OperationCallIdSchema.parse(
    `operation-call:legacy:${agent.id}`,
  );
  const operation = ActiveOperationSchema.parse({
    callId,
    operationId: binding.operationId,
    taskOptionId: `task-option:legacy:${agent.id}`,
    label: currentGoal.label,
    taskSlots,
    arguments: binding.arguments,
    duration: currentAction
      ? { kind: "fixed", totalTicks: currentAction.durationTicks }
      : { kind: "indeterminate" },
    startedAtTick: Math.max(0, worldTick - progressTicks),
    progressTicks,
    plan: {
      actions: currentAction ? [migrateLegacyAction(currentAction)] : [],
      currentActionIndex: 0,
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
  option: z.infer<typeof LegacyGoalOptionSchema>,
  objects: LegacyObjectIndex,
) {
  const binding = legacyOperationBinding(option.goal, objects);
  return TaskOptionSchema.parse({
    kind: "operation",
    id: TaskOptionIdSchema.parse(option.id),
    operationId: binding.operationId,
    label: option.label,
    taskSlots: binding.taskSlots,
    argumentSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    fixedArguments: binding.arguments,
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
  objects: LegacyObjectIndex,
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
        ...request.promptInput.goalOptions.map((option) =>
          migrateLegacyGoalOption(option, objects),
        ),
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
  const objects = uniqueMap(value.objects, (object) => object.id, "object ID");
  const agents = value.agents.map((agent) =>
    migrateSingleGoalAgent(agent, worldTick, objects),
  );
  return SerializedWorldStateSchema.parse({
    ...value,
    stateSchemaVersion: 2,
    agents,
    decisionCycle: migrateLegacyDecisionCycle(
      value.decisionCycle,
      agents,
      objects,
    ),
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

export function parseSerializedState(
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
