import { z } from "zod";

import {
  AgentIdSchema,
  BodySensationSchema,
  CanonicalTaskTracksSchema,
  CoordinateSchema,
  DecisionCycleIdSchema,
  DecisionIdentitySchema,
  DecisionMemorySchema,
  DecisionReasonSchema,
  DecisionPromptInputSchema,
  DirectTaskDecisionSchema,
  EntityIdSchema,
  EventIdSchema,
  FacingSchema,
  JsonObjectSchema,
  JsonValueSchema,
  OperationCallIdSchema,
  OperationIdSchema,
  PerceptionSnapshotSchema,
  mergeTaskOptionArguments,
  TaskOptionIdSchema,
  TaskOptionSchema,
  TechnicalFailureSchema,
  type AgentId,
  type DirectTaskDecision,
  type EntityId,
  type EventId,
  type JsonObject,
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
  SerializedWorldStateV3Schema,
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
    purpose: z.enum(["direct", "goal", "automatic_traversal"]),
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

/**
 * W1 之前的 current 快照仍可能把 v2 task decision 和动态候选写进
 * decisionCycle。生产协议已经删除这些字段，所以迁移边界保留一份
 * 私有 schema，解析后立即转换为 direct decision。
 *
 * hostEntityId 是早期 hosted-operation 迁移期间出现过的过渡字段；它
 * 不再属于 TaskOption/TaskDecision 生产协议，但读取时必须无损保留。
 */
const LegacyCurrentOperationTaskOptionSchema = z
  .object({
    kind: z.literal("operation"),
    id: TaskOptionIdSchema,
    label: z.string().min(1).max(160),
    taskSlots: CanonicalTaskTracksSchema,
    argumentSchema: JsonObjectSchema,
    operationId: OperationIdSchema,
    fixedArguments: JsonObjectSchema,
    hostEntityId: EntityIdSchema.optional(),
  })
  .strict();

const LegacyCurrentTaskOptionSchema = z.union([
  TaskOptionSchema,
  LegacyCurrentOperationTaskOptionSchema,
]);

const LegacyCurrentTaskSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("continue") }).strict(),
  z
    .object({
      kind: z.literal("replace"),
      taskOptionId: TaskOptionIdSchema,
      arguments: JsonObjectSchema,
      hostEntityId: EntityIdSchema.optional(),
    })
    .strict(),
]);

const LegacyCurrentTaskDecisionSchema = z
  .object({
    schemaVersion: z.literal(2),
    head: LegacyCurrentTaskSelectionSchema,
    body: LegacyCurrentTaskSelectionSchema,
    reason: z.string().min(1).max(500),
  })
  .strict();

const LegacyCurrentDecisionPromptInputSchema = DecisionPromptInputSchema.extend({
  taskOptions: z.array(LegacyCurrentTaskOptionSchema).min(1).optional(),
}).strict();

const LegacyCurrentSerializedDecisionRequestSchema = z
  .object({
    agentId: AgentIdSchema,
    identity: DecisionIdentitySchema,
    promptInput: LegacyCurrentDecisionPromptInputSchema,
    acceptedProposal: z
      .union([DirectTaskDecisionSchema, LegacyCurrentTaskDecisionSchema])
      .nullable(),
    failure: TechnicalFailureSchema.nullable().default(null),
  })
  .strict();

const LegacyCurrentSerializedDecisionCycleSchema = z
  .object({
    id: DecisionCycleIdSchema,
    baseWorldVersion: z.number().int().nonnegative(),
    requestedAgentIds: z.array(AgentIdSchema).min(1),
    requests: z.array(LegacyCurrentSerializedDecisionRequestSchema).min(1),
  })
  .strict();

const LegacyCurrentSerializedWorldStateV4Schema = z
  .object({
    ...SerializedWorldStateCommonShape,
    stateSchemaVersion: z.literal(4),
    agents: z.array(SerializedAgentSchema).min(1),
    decisionCycle: LegacyCurrentSerializedDecisionCycleSchema.nullable(),
    // The final current codec validates these fields strictly after the
    // decision cycle has been converted. Keeping them opaque here allows the
    // migration to remain independent from runtime-owned termination state.
    pendingOperationTerminations: z.array(JsonValueSchema).default([]),
    terminalOperationCallIds: z.array(OperationCallIdSchema).default([]),
  })
  .strict();

const LegacyCurrentSerializedWorldStateV3Schema = z
  .object({
    ...SerializedWorldStateCommonShape,
    stateSchemaVersion: z.literal(3),
    agents: z.array(SerializedAgentSchema).min(1),
    decisionCycle: LegacyCurrentSerializedDecisionCycleSchema.nullable(),
  })
  .strict();

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

type LegacyCurrentTaskOption = z.infer<typeof LegacyCurrentTaskOptionSchema>;
type LegacyCurrentTaskSelection = z.infer<
  typeof LegacyCurrentTaskSelectionSchema
>;
type LegacyCurrentTaskDecision = z.infer<
  typeof LegacyCurrentTaskDecisionSchema
>;

function canonicalJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJson(entry)]),
  );
}

function sameJson(left: JsonObject, right: JsonObject): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function migrateCurrentTaskSelection(
  agentId: AgentId,
  track: "HEAD" | "BODY",
  selection: LegacyCurrentTaskSelection,
  optionsById: ReadonlyMap<string, LegacyCurrentTaskOption>,
): {
  readonly selection: DirectTaskDecision["head"];
  readonly option: LegacyCurrentTaskOption | null;
  readonly arguments: JsonObject | null;
} {
  if (selection.kind === "continue") {
    return { selection, option: null, arguments: null };
  }
  const option = optionsById.get(selection.taskOptionId);
  if (!option) {
    throw new Error(
      `Snapshot decision for ${agentId} selected an unoffered task option ${selection.taskOptionId}`,
    );
  }
  if (!option.taskSlots.includes(track)) {
    throw new Error(
      `Snapshot decision for ${agentId} selected task option ${selection.taskOptionId} on unsupported track ${track}`,
    );
  }
  if (option.kind === "empty") {
    if (Object.keys(selection.arguments).length > 0 || selection.hostEntityId) {
      throw new Error(
        `Snapshot decision for ${agentId} supplied arguments or a host for empty task option ${selection.taskOptionId}`,
      );
    }
    return {
      selection: { kind: "replace", task: { kind: "empty_task" } },
      option,
      arguments: {},
    };
  }

  const mergedArguments = mergeTaskOptionArguments(option, selection.arguments);
  const optionHostEntityId =
    "hostEntityId" in option ? option.hostEntityId : undefined;
  if (
    optionHostEntityId !== undefined &&
    selection.hostEntityId !== undefined &&
    optionHostEntityId !== selection.hostEntityId
  ) {
    throw new Error(
      `Snapshot decision for ${agentId} selected conflicting hosts for task option ${selection.taskOptionId}`,
    );
  }
  let hostEntityId = selection.hostEntityId ?? optionHostEntityId;
  let argumentsValue = mergedArguments;
  if (option.operationId.startsWith("object.")) {
    const targetEntityId = mergedArguments["targetEntityId"];
    if (targetEntityId !== undefined) {
      const argumentHost = EntityIdSchema.parse(targetEntityId);
      if (hostEntityId !== undefined && hostEntityId !== argumentHost) {
        throw new Error(
          `Snapshot decision for ${agentId} selected conflicting hosts for task option ${selection.taskOptionId}`,
        );
      }
      hostEntityId = argumentHost;
      const legacyParameters = mergedArguments["parameters"];
      const extraArgumentNames = Object.keys(mergedArguments).filter(
        (name) => name !== "targetEntityId" && name !== "parameters",
      );
      if (!isJsonObject(legacyParameters) || extraArgumentNames.length > 0) {
        throw new Error(
          `Snapshot decision for ${agentId} has invalid legacy parameters for task option ${selection.taskOptionId}`,
        );
      }
      // 旧 object.* operation 把宿主 ID 和交互参数包在同一个参数对象里；
      // hosted operation 的 arguments 只接收交互参数本身。
      argumentsValue = JsonObjectSchema.parse(legacyParameters);
    }
    if (hostEntityId === undefined) {
      throw new Error(
        `Snapshot decision for ${agentId} cannot resolve a host for task option ${selection.taskOptionId}`,
      );
    }
  }
  return {
    selection: {
      kind: "replace",
      task: {
        kind: "operation",
        operationId: option.operationId,
        ...(hostEntityId === undefined ? {} : { hostEntityId }),
        arguments: argumentsValue,
      },
    },
    option,
    arguments: argumentsValue,
  };
}

function migrateCurrentTaskDecision(
  agentId: AgentId,
  decision: LegacyCurrentTaskDecision,
  options: readonly LegacyCurrentTaskOption[],
): DirectTaskDecision {
  const optionsById = uniqueMap(options, (option) => option.id, "task option ID");
  const head = migrateCurrentTaskSelection(
    agentId,
    "HEAD",
    decision.head,
    optionsById,
  );
  const body = migrateCurrentTaskSelection(
    agentId,
    "BODY",
    decision.body,
    optionsById,
  );
  for (const selected of [head, body]) {
    if (
      selected.option?.kind !== "operation" ||
      selected.option.taskSlots.length === 1
    ) {
      continue;
    }
    const peer = selected.option.taskSlots.includes("HEAD") ? head : body;
    const otherTrack = selected.option.taskSlots.includes("HEAD") ? body : head;
    if (
      peer.option?.id !== selected.option.id ||
      peer.arguments === null ||
      selected.arguments === null ||
      !sameJson(peer.arguments, selected.arguments)
    ) {
      throw new Error(
        `Snapshot decision for ${agentId} did not preserve synchronized task option ${selected.option.id}`,
      );
    }
    if (otherTrack.option?.id !== selected.option.id) {
      throw new Error(
        `Snapshot decision for ${agentId} did not select task option ${selected.option.id} on every required track`,
      );
    }
  }
  return DirectTaskDecisionSchema.parse({
    schemaVersion: 3,
    head: head.selection,
    body: body.selection,
    reason: decision.reason,
  });
}

function migrateCurrentDecisionCycle(
  cycle: z.infer<typeof LegacyCurrentSerializedDecisionCycleSchema> | null,
): z.infer<typeof SerializedDecisionCycleSchema> | null {
  if (cycle === null) return null;
  return SerializedDecisionCycleSchema.parse({
    ...cycle,
    requests: cycle.requests.map((request) => {
      const { taskOptions = [], ...promptInput } = request.promptInput;
      const acceptedProposal = request.acceptedProposal;
      return {
        ...request,
        promptInput: DecisionPromptInputSchema.parse(promptInput),
        acceptedProposal:
          acceptedProposal === null || acceptedProposal.schemaVersion === 3
            ? acceptedProposal
            : migrateCurrentTaskDecision(
                request.agentId,
                acceptedProposal,
                taskOptions,
              ),
      };
    }),
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
      label: "label" in operation ? operation.label : operation.operationId,
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
      const goalOptions = uniqueMap(
        request.promptInput.goalOptions,
        (option) => option.id,
        "legacy goal option ID",
      );
      const selectedGoal =
        request.acceptedProposal === null
          ? null
          : goalOptions.get(request.acceptedProposal.goalOptionId);
      if (request.acceptedProposal !== null && !selectedGoal) {
        throw new Error(
          `Snapshot decision for ${request.agentId} accepted an unoffered goal`,
        );
      }
      let acceptedProposal: DirectTaskDecision | null = null;
      if (request.acceptedProposal !== null && selectedGoal) {
        const binding = legacyOperationBinding(selectedGoal.goal, objects);
        const taskSlots: readonly ("HEAD" | "BODY")[] = binding.taskSlots;
        const task = {
          kind: "operation" as const,
          operationId: binding.operationId,
          ...(selectedGoal.goal.kind === "use_object"
            ? { hostEntityId: selectedGoal.goal.targetEntityId }
            : {}),
          arguments:
            selectedGoal.goal.kind === "use_object"
              ? {}
              : binding.arguments,
        };
        const replacement = { kind: "replace" as const, task };
        acceptedProposal = DirectTaskDecisionSchema.parse({
          schemaVersion: 3,
          head: taskSlots.includes("HEAD")
            ? replacement
            : { kind: "continue" },
          body: taskSlots.includes("BODY")
            ? replacement
            : { kind: "continue" },
          reason: request.acceptedProposal.reason,
        });
      }
      return {
        agentId: request.agentId,
        identity: request.identity,
        promptInput: DecisionPromptInputSchema.parse({
          ...request.identity,
          decisionReason: request.promptInput.decisionReason,
          bodySensations: request.promptInput.bodySensations,
          activeTasks: activeTasksFor(agent),
          memories: request.promptInput.memories,
          perception: request.promptInput.perception,
        }),
        acceptedProposal,
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
    stateSchemaVersion: 4,
    agents,
    decisionCycle: migrateLegacyDecisionCycle(
      value.decisionCycle,
      agents,
      objects,
    ),
    pendingOperationTerminations: [],
    terminalOperationCallIds: [],
  });
}

function isJsonArray(
  value: JsonValue | undefined,
): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function isJsonObject(
  value: JsonValue | undefined,
): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !isJsonArray(value);
}

function stripCurrentStateFields(state: JsonValue): JsonValue {
  if (!isJsonObject(state)) return state;
  const legacy = { ...state };
  delete legacy.stateSchemaVersion;
  delete legacy.pendingOperationTerminations;
  delete legacy.terminalOperationCallIds;
  return JsonValueSchema.parse(legacy);
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

/**
 * State schema V2 stored the move operation's private observation buffer
 * directly on every serialized active operation. V3 moves that buffer
 * into the opaque runtime-owned `state` field, so non-move operations no
 * longer carry fields they never used.
 */
function migrateV2ActiveOperationState(state: JsonValue): JsonValue {
  if (!isJsonObject(state) || state["stateSchemaVersion"] !== 2) return state;
  const agents = state["agents"];
  if (!isJsonArray(agents)) return state;
  const migratedAgents = agents.map((agent) => {
    if (!isJsonObject(agent)) return agent;
    const operations = agent["activeOperations"];
    if (!isJsonArray(operations)) return agent;
    return {
      ...agent,
      activeOperations: operations.map((operation) => {
        if (!isJsonObject(operation)) return operation;
        const {
          accumulatedObservations = [],
          observationDeliveryCursor = 0,
          ...stable
        } = operation;
        return {
          ...stable,
          state:
            operation["operationId"] === "core.move"
              ? { accumulatedObservations, observationDeliveryCursor }
              : {},
        };
      }),
    };
  });
  return JsonValueSchema.parse({
    ...state,
    stateSchemaVersion: 3,
    agents: migratedAgents,
  });
}

/**
 * V3 already contains the current HEAD/BODY and operation shapes, but the
 * hosted-call termination ledger did not exist yet. Add only the new fields;
 * no runtime resolver is consulted during this migration.
 */
function migrateV3State(state: JsonValue): JsonValue {
  if (!isJsonObject(state) || state["stateSchemaVersion"] !== 3) return state;
  return JsonValueSchema.parse({
    ...state,
    stateSchemaVersion: 4,
    pendingOperationTerminations: [],
    terminalOperationCallIds: [],
  });
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
  const migratedV2 = migrateV2ActiveOperationState(serializedState);
  const currentState = SerializedWorldStateSchema.safeParse(
    migrateV3State(migratedV2),
  );
  const legacyCurrentV4State = currentState.success
    ? null
    : LegacyCurrentSerializedWorldStateV4Schema.safeParse(migratedV2);
  const v3State = currentState.success
    || legacyCurrentV4State?.success
    ? null
    : SerializedWorldStateV3Schema.safeParse(migratedV2);
  const legacyCurrentV3State =
    currentState.success || legacyCurrentV4State?.success || v3State?.success
      ? null
      : LegacyCurrentSerializedWorldStateV3Schema.safeParse(migratedV2);
  const singleGoalState = currentState.success
    || legacyCurrentV4State?.success
    || v3State?.success
    || legacyCurrentV3State?.success
    ? null
    : SingleGoalSerializedWorldStateSchema.safeParse(
        stripCurrentStateFields(serializedState),
      );
  let state: z.infer<typeof SerializedWorldStateSchema>;
  if (currentState.success) {
    state = currentState.data;
  } else if (legacyCurrentV4State?.success) {
    state = SerializedWorldStateSchema.parse({
      ...legacyCurrentV4State.data,
      decisionCycle: migrateCurrentDecisionCycle(
        legacyCurrentV4State.data.decisionCycle,
      ),
    });
  } else if (v3State?.success) {
    state = SerializedWorldStateSchema.parse(
      migrateV3State(JsonValueSchema.parse(v3State.data)),
    );
  } else if (legacyCurrentV3State?.success) {
    state = SerializedWorldStateSchema.parse(
      migrateV3State(
        JsonValueSchema.parse({
          ...legacyCurrentV3State.data,
          decisionCycle: migrateCurrentDecisionCycle(
            legacyCurrentV3State.data.decisionCycle,
          ),
        }),
      ),
    );
  } else if (singleGoalState?.success) {
    state = migrateSingleGoalState(singleGoalState.data, snapshot.worldTick);
  } else {
    state = migrateSingleGoalState(
      normalizeLegacyState(
        LegacySerializedWorldStateSchema.parse(
          stripCurrentStateFields(serializedState),
        ),
      ),
      snapshot.worldTick,
    );
  }
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
