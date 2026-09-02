import {
  OperationCallIdSchema,
  TaskDecisionSchema,
  type AgentId,
  type DomainEvent,
  type JsonObject,
  type JsonValue,
  type TaskOption,
  type TaskSelection,
  type TaskTrack,
} from "@god-sim/protocol";
import {
  InteractionContextSchema,
  type EffectProposal,
  type InteractionDefinition,
} from "@god-sim/plugin-sdk";

import {
  mergedOptionArguments,
} from "../execution/operation-catalog";
import { prepareOperationCall } from "../execution/operation-planner";
import type { ActiveOperation } from "../execution/operation";
import type { TaskTrackState, TaskTracks } from "../execution/task-tracks";
import { appendDomainEvent } from "../engine/event-writer";
import { commitProposal } from "../interaction/effect-committer";
import type { PluginRegistry } from "../world/plugin-registry";
import type {
  AgentState,
  DecisionCycleState,
  DecisionRequestState,
  WorldState,
} from "../world/world-state";

const TASK_TRACKS = ["HEAD", "BODY"] as const;

export interface DecisionReleaseTransition {
  readonly world: WorldState;
  readonly events: readonly DomainEvent[];
}

type ResolvedSelection =
  | { readonly kind: "continue" }
  | { readonly kind: "empty"; readonly option: TaskOption }
  | {
      readonly kind: "operation";
      readonly option: Extract<TaskOption, { kind: "operation" }>;
      readonly arguments: JsonObject;
      readonly comparisonKey: string;
    };

interface AgentDecisionPlan {
  readonly agentId: AgentId;
  readonly resolved: Readonly<Record<TaskTrack, ResolvedSelection>>;
  readonly removedCallIds: ReadonlySet<ActiveOperation["callId"]>;
}

export function allDecisionResultsAccepted(cycle: DecisionCycleState): boolean {
  return cycle.requestedAgentIds.every((agentId) => {
    const request = cycle.requests.get(agentId);
    return request !== undefined && request.acceptedProposal !== null;
  });
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJson(entry)]),
  );
}

function comparisonKey(value: JsonObject): string {
  return JSON.stringify(canonicalJson(value));
}

function selectionFor(
  request: DecisionRequestState,
  track: TaskTrack,
): TaskSelection {
  const decision = TaskDecisionSchema.parse(request.acceptedProposal);
  return track === "HEAD" ? decision.head : decision.body;
}

function resolveSelections(
  agent: AgentState,
  request: DecisionRequestState,
): Readonly<Record<TaskTrack, ResolvedSelection>> {
  const options = request.promptInput.taskOptions;
  const optionIds = new Set<string>();
  for (const option of options) {
    if (optionIds.has(option.id)) {
      throw new Error(`Decision request contains duplicate task option ${option.id}`);
    }
    optionIds.add(option.id);
  }

  const resolve = (track: TaskTrack): ResolvedSelection => {
    const selection = selectionFor(request, track);
    if (selection.kind === "continue") return selection;
    const option = options.find(
      (candidate) => candidate.id === selection.taskOptionId,
    );
    if (!option) {
      throw new Error(`Task option ${selection.taskOptionId} was not offered`);
    }
    if (!option.taskSlots.includes(track)) {
      throw new Error(`Task option ${option.id} does not occupy ${track}`);
    }
    if (option.kind === "empty") {
      if (Object.keys(selection.arguments).length !== 0) {
        throw new Error(`Empty task option ${option.id} accepts no arguments`);
      }
      return { kind: "empty", option };
    }
    const normalized = mergedOptionArguments(option, selection.arguments);
    return {
      kind: "operation",
      option,
      arguments: selection.arguments,
      comparisonKey: comparisonKey(normalized),
    };
  };

  const resolved = {
    HEAD: resolve("HEAD"),
    BODY: resolve("BODY"),
  } as const;

  for (const operation of agent.activeOperations.values()) {
    if (operation.taskSlots.length === 1) continue;
    const replacements = operation.taskSlots.filter(
      (track) => resolved[track].kind !== "continue",
    );
    if (replacements.length > 0 && replacements.length !== operation.taskSlots.length) {
      throw new Error(
        `Existing synchronized call ${operation.callId} must be replaced on every occupied track`,
      );
    }
  }

  for (const track of TASK_TRACKS) {
    const selected = resolved[track];
    if (selected.kind !== "operation" || selected.option.taskSlots.length === 1) {
      continue;
    }
    for (const requiredTrack of selected.option.taskSlots) {
      const peer = resolved[requiredTrack];
      if (
        peer.kind !== "operation" ||
        peer.option.id !== selected.option.id
      ) {
        throw new Error(
          `Task option ${selected.option.id} must be selected on all declared tracks`,
        );
      }
      if (peer.comparisonKey !== selected.comparisonKey) {
        throw new Error(
          `Task option ${selected.option.id} requires the same arguments on every track`,
        );
      }
    }
  }

  return resolved;
}

function assertCurrentCallsMatchTracks(agent: AgentState): void {
  for (const [callId, operation] of agent.activeOperations) {
    const referencedTracks = TASK_TRACKS.filter((track) => {
      const state = agent.taskTracks[track];
      return state.kind === "operation" && state.callId === callId;
    });
    if (
      comparisonKey({ tracks: referencedTracks }) !==
      comparisonKey({ tracks: operation.taskSlots })
    ) {
      throw new Error(`Active call ${callId} does not match its task tracks`);
    }
  }
  for (const track of TASK_TRACKS) {
    const state = agent.taskTracks[track];
    if (state.kind === "operation" && !agent.activeOperations.has(state.callId)) {
      throw new Error(`Task track ${track} references missing call ${state.callId}`);
    }
  }
}

function analyzeTaskDecision(
  world: WorldState,
  agentId: AgentId,
  request: DecisionRequestState,
): AgentDecisionPlan {
  const cycle = world.decisionCycle;
  if (!cycle) throw new Error("No decision cycle is active");
  const agent = world.agents.get(agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${agentId}`);
  if (request.acceptedProposal === null) {
    throw new Error(`Decision cycle ${cycle.id} is incomplete for ${agentId}`);
  }
  assertCurrentCallsMatchTracks(agent);
  const resolved = resolveSelections(agent, request);
  const removedCallIds = new Set(
    TASK_TRACKS.flatMap((track) => {
      if (resolved[track].kind === "continue") return [];
      const current = agent.taskTracks[track];
      return current.kind === "operation" ? [current.callId] : [];
    }),
  );
  return { agentId, resolved, removedCallIds };
}

function applyAgentDecisionPlan(
  world: WorldState,
  registry: PluginRegistry,
  plan: AgentDecisionPlan,
): AgentState {
  const cycle = world.decisionCycle;
  if (!cycle) throw new Error("No decision cycle is active");
  const agent = world.agents.get(plan.agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${plan.agentId}`);
  const activeOperations = new Map(
    [...agent.activeOperations].filter(
      ([callId]) => !plan.removedCallIds.has(callId),
    ),
  );
  const taskTracks: Record<TaskTrack, TaskTrackState> = {
    HEAD: agent.taskTracks.HEAD,
    BODY: agent.taskTracks.BODY,
  };
  const preparedByOption = new Map<
    string,
    { readonly operation: ActiveOperation; readonly comparisonKey: string }
  >();
  let callIndex = 0;

  for (const track of TASK_TRACKS) {
    const selected = plan.resolved[track];
    if (selected.kind === "continue") continue;
    if (selected.kind === "empty") {
      taskTracks[track] = { kind: "empty" };
      continue;
    }

    const existing = preparedByOption.get(selected.option.id);
    if (existing) {
      if (existing.comparisonKey !== selected.comparisonKey) {
        throw new Error(
          `Task option ${selected.option.id} requires the same arguments on every track`,
        );
      }
      taskTracks[track] = {
        kind: "operation",
        callId: existing.operation.callId,
      };
      continue;
    }

    const callId = OperationCallIdSchema.parse(
      `operation-call:${cycle.id}:${plan.agentId}:${callIndex}`,
    );
    callIndex += 1;
    if (activeOperations.has(callId)) {
      throw new Error(`Operation call ID ${callId} already exists`);
    }
    const preparation = prepareOperationCall(
      world,
      registry,
      plan.agentId,
      selected.option,
      selected.arguments,
      callId,
    );
    if (preparation.kind === "blocked") {
      throw new Error(
        `Task option ${selected.option.id} cannot start: ${preparation.reasonCode}: ${preparation.summary}`,
      );
    }
    preparedByOption.set(selected.option.id, {
      operation: preparation.operation,
      comparisonKey: selected.comparisonKey,
    });
    activeOperations.set(callId, preparation.operation);
    for (const occupiedTrack of preparation.operation.taskSlots) {
      taskTracks[occupiedTrack] = { kind: "operation", callId };
    }
  }

  const next = {
    ...agent,
    taskTracks: taskTracks as TaskTracks,
    activeOperations,
  };
  assertCurrentCallsMatchTracks(next);
  return next;
}

function cancellationProposal(
  world: WorldState,
  registry: PluginRegistry,
  agent: AgentState,
  operation: ActiveOperation,
): EffectProposal {
  const action = operation.plan.actions[operation.plan.currentActionIndex];
  if (!action || action.kind !== "interact_object" || !action.started) {
    return { effects: [] };
  }
  const object = world.objects.get(action.targetEntityId);
  if (!object) {
    throw new Error(
      `Cannot cancel ${operation.callId}: object ${action.targetEntityId} is missing`,
    );
  }
  const definition = registry.getObject(object.definitionId)?.definition;
  if (!definition) {
    throw new Error(
      `Cannot cancel ${operation.callId}: definition ${object.definitionId} is missing`,
    );
  }
  const interaction = definition.interactions.find(
    (candidate) => candidate.id === action.interactionId,
  ) as InteractionDefinition<JsonValue, JsonObject> | undefined;
  if (!interaction) {
    throw new Error(
      `Cannot cancel ${operation.callId}: interaction ${action.interactionId} is missing`,
    );
  }
  const parameterInput =
    action.purpose === "direct" &&
    typeof operation.arguments["parameters"] === "object" &&
    operation.arguments["parameters"] !== null &&
    !Array.isArray(operation.arguments["parameters"])
      ? operation.arguments["parameters"]
      : {};
  const parameters = interaction.parametersSchema.parse(parameterInput);
  const context = InteractionContextSchema.parse({
    worldTick: world.tick,
    trigger: "active_command",
    object: { entityId: object.id, version: object.version },
    actor: {
      agentId: agent.id,
      position: agent.position,
      needs: { bladder: agent.bladder },
    },
    distance:
      Math.abs(agent.position.x - object.position.x) +
      Math.abs(agent.position.y - object.position.y),
  });
  return interaction.cancel(
    definition.stateSchema.parse(object.state),
    context,
    parameters,
  );
}

export function preflightTaskDecision(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
  request: DecisionRequestState,
): AgentState {
  return applyAgentDecisionPlan(
    world,
    registry,
    analyzeTaskDecision(world, agentId, request),
  );
}

export function releaseDecisionCycle(
  world: WorldState,
  registry: PluginRegistry,
): DecisionReleaseTransition {
  const cycle = world.decisionCycle;
  if (!cycle) throw new Error("No decision cycle is active");
  if (!allDecisionResultsAccepted(cycle)) {
    throw new Error(`Decision cycle ${cycle.id} is not ready for release`);
  }

  const plans: AgentDecisionPlan[] = [];
  for (const agentId of cycle.requestedAgentIds) {
    const request = cycle.requests.get(agentId);
    if (!request) {
      throw new Error(`Decision cycle ${cycle.id} is incomplete for ${agentId}`);
    }
    plans.push(analyzeTaskDecision(world, agentId, request));
  }

  const cancellationEffects = plans.flatMap((plan) => {
    const agent = world.agents.get(plan.agentId)!;
    return [...plan.removedCallIds]
      .sort((left, right) => left.localeCompare(right))
      .flatMap((callId) => {
        const operation = agent.activeOperations.get(callId);
        if (!operation) {
          throw new Error(`Cannot cancel missing operation ${callId}`);
        }
        return cancellationProposal(world, registry, agent, operation).effects;
      });
  });
  const cancellation = commitProposal(
    world,
    registry,
    { effects: cancellationEffects },
    {
      causationId: `release:${cycle.id}`,
      correlationId: cycle.id,
    },
  );
  if (!cancellation.accepted) {
    throw new Error(
      `Operation cancellation failed: ${cancellation.reason.code}: ${cancellation.reason.message}`,
    );
  }

  const candidateWorld = cancellation.world;
  const preparedAgents = new Map<AgentId, AgentState>();
  for (const plan of plans) {
    preparedAgents.set(
      plan.agentId,
      applyAgentDecisionPlan(candidateWorld, registry, plan),
    );
  }

  const agents = new Map(candidateWorld.agents);
  for (const [agentId, agent] of preparedAgents) agents.set(agentId, agent);
  let releasedWorld: WorldState = {
    ...candidateWorld,
    version: candidateWorld.version + 1,
    mode: "RUNNING",
    agents,
    decisionCycle: null,
  };
  const events: DomainEvent[] = [...cancellation.events];
  const lifecycleMetadata = {
    causationId: `release:${cycle.id}`,
    correlationId: cycle.id,
  };

  for (const plan of [...plans].sort((left, right) =>
    left.agentId.localeCompare(right.agentId),
  )) {
    const previousAgent = world.agents.get(plan.agentId)!;
    for (const callId of [...plan.removedCallIds].sort((left, right) =>
      left.localeCompare(right),
    )) {
      const operation = previousAgent.activeOperations.get(callId);
      if (!operation) throw new Error(`Cannot terminate missing operation ${callId}`);
      const written = appendDomainEvent(
        releasedWorld,
        {
          type: "operation_terminated",
          agentId: plan.agentId,
          callId,
          operationId: operation.operationId,
          outcome: "cancelled",
          reasonCode: "task_replaced",
        },
        lifecycleMetadata,
      );
      releasedWorld = written.world;
      events.push(written.event);
    }
  }

  for (const plan of [...plans].sort((left, right) =>
    left.agentId.localeCompare(right.agentId),
  )) {
    const previousAgent = world.agents.get(plan.agentId)!;
    const nextAgent = releasedWorld.agents.get(plan.agentId)!;
    const started = [...nextAgent.activeOperations.values()]
      .filter((operation) => !previousAgent.activeOperations.has(operation.callId))
      .sort((left, right) => left.callId.localeCompare(right.callId));
    for (const operation of started) {
      const written = appendDomainEvent(
        releasedWorld,
        {
          type: "operation_started",
          agentId: plan.agentId,
          callId: operation.callId,
          operationId: operation.operationId,
          taskSlots: operation.taskSlots,
          label: operation.label,
        },
        lifecycleMetadata,
      );
      releasedWorld = written.world;
      events.push(written.event);
    }
  }

  return {
    world: releasedWorld,
    events,
  };
}

export function applyReleasePolicy(
  world: WorldState,
  registry: PluginRegistry,
): DecisionReleaseTransition {
  const cycle = world.decisionCycle;
  if (!cycle || !allDecisionResultsAccepted(cycle)) {
    return { world, events: [] };
  }
  if (!world.reviewRequired) return releaseDecisionCycle(world, registry);
  if (world.mode === "READY_FOR_RELEASE") return { world, events: [] };
  return {
    world: { ...world, version: world.version + 1, mode: "READY_FOR_RELEASE" },
    events: [],
  };
}
