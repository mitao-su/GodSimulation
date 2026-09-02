import {
  OperationCallIdSchema,
  resolveTaskDecision,
  type AgentId,
  type DomainEvent,
  type ResolvedTaskSelection,
  type TaskTrack,
} from "@god-sim/protocol";

import {
  operationInteractionLifecycleProposal,
  recordOperationTermination,
} from "../execution/operation-lifecycle";
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

interface AgentDecisionPlan {
  readonly agentId: AgentId;
  readonly resolved: Readonly<Record<TaskTrack, ResolvedTaskSelection>>;
  readonly removedCallIds: ReadonlySet<ActiveOperation["callId"]>;
}

export function allDecisionResultsAccepted(cycle: DecisionCycleState): boolean {
  return cycle.requestedAgentIds.every((agentId) => {
    const request = cycle.requests.get(agentId);
    return request !== undefined && request.acceptedProposal !== null;
  });
}

function resolveSelections(
  agent: AgentState,
  request: DecisionRequestState,
): Readonly<Record<TaskTrack, ResolvedTaskSelection>> {
  if (request.acceptedProposal === null) {
    throw new Error("Cannot resolve an empty decision proposal");
  }
  const resolved = resolveTaskDecision(
    request.acceptedProposal,
    request.promptInput.taskOptions,
  ).tracks;

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

  return resolved;
}

function assertCurrentCallsMatchTracks(agent: AgentState): void {
  for (const [callId, operation] of agent.activeOperations) {
    const referencedTracks = TASK_TRACKS.filter((track) => {
      const state = agent.taskTracks[track];
      return state.kind === "operation" && state.callId === callId;
    });
    if (
      referencedTracks.length !== operation.taskSlots.length ||
      referencedTracks.some((track, index) => track !== operation.taskSlots[index])
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
    ActiveOperation
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
      taskTracks[track] = {
        kind: "operation",
        callId: existing.callId,
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
    preparedByOption.set(selected.option.id, preparation.operation);
    activeOperations.set(callId, preparation.operation);
    for (const occupiedTrack of preparation.operation.taskSlots) {
      taskTracks[occupiedTrack] = { kind: "operation", callId };
    }
  }

  const next = {
    ...agent,
    taskTracks: taskTracks as TaskTracks,
    activeOperations,
    pendingOperationResults: [],
  };
  assertCurrentCallsMatchTracks(next);
  return next;
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
        return operationInteractionLifecycleProposal(
          world,
          registry,
          agent.id,
          operation,
          "cancel",
        ).effects;
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
      const written = recordOperationTermination(
        releasedWorld,
        registry,
        plan.agentId,
        operation,
        "cancelled",
        "task_replaced",
        lifecycleMetadata,
      );
      releasedWorld = written.world;
      events.push(...written.events);
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
