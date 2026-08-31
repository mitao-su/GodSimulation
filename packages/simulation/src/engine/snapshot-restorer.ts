import { z } from "zod";

import {
  AgentIdSchema,
  CoordinateSchema,
  DecisionCycleIdSchema,
  DecisionIdentitySchema,
  DecisionPromptInputSchema,
  EntityIdSchema,
  EventIdSchema,
  FacingSchema,
  GoalProposalSchema,
  GoalSchema,
  JsonValueSchema,
  TechnicalFailureSchema,
  WorldModeSchema,
  WorldSnapshotSchema,
  type AgentId,
  type EntityId,
  type EventId,
  type WorldSnapshot,
} from "@god-sim/protocol";
import { BodySlotSchema } from "@god-sim/plugin-sdk";

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
  slots: z.array(BodySlotSchema),
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
    acceptedProposal: GoalProposalSchema.nullable(),
    failure: TechnicalFailureSchema.nullable().default(null),
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

const SerializedWorldStateBaseShape = {
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
  decisionCycle: SerializedDecisionCycleSchema.nullable(),
  technicalFailure: TechnicalFailureSchema.nullable(),
};

const SerializedWorldStateSchema = z
  .object({
    ...SerializedWorldStateBaseShape,
    agents: z.array(SerializedAgentSchema).min(1),
  })
  .strict();

const LegacySerializedWorldStateSchema = z
  .object({
    ...SerializedWorldStateBaseShape,
    agents: z.array(LegacySerializedAgentSchema).min(1),
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
): z.infer<typeof SerializedWorldStateSchema> {
  const objects = uniqueMap(value.objects, (object) => object.id, "object ID");
  return SerializedWorldStateSchema.parse({
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

function parseSerializedState(snapshot: WorldSnapshot): {
  readonly state: z.infer<typeof SerializedWorldStateSchema>;
  readonly history: WorldHistory;
} {
  if (snapshot.schemaVersion === 2) {
    assertSnapshotCausality(snapshot);
    return {
      state: SerializedWorldStateSchema.parse(snapshot.state),
      history: snapshot.history,
    };
  }

  const currentState = SerializedWorldStateSchema.safeParse(snapshot.state);
  return {
    state: currentState.success
      ? currentState.data
      : normalizeLegacyState(LegacySerializedWorldStateSchema.parse(snapshot.state)),
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
    restored.set(agentId, {
      ...agent,
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
    if (
      request.acceptedProposal !== null &&
      !prompt.goalOptions.some((option) => option.id === request.acceptedProposal?.goalOptionId)
    ) {
      throw new Error(`Snapshot decision for ${agentId} accepted an unoffered goal`);
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
): WorldState {
  const snapshot = WorldSnapshotSchema.parse(snapshotValue);
  const { state, history } = parseSerializedState(snapshot);
  const expectedMap = MapDefinitionSchema.parse(worldDefinition);
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
    history,
    map: expectedMap,
    agents,
    objects,
    decisionCycle,
    technicalFailure: state.technicalFailure,
  };
}
