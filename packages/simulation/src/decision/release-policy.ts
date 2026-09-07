import {
  OperationCallIdSchema,
  JsonObjectSchema,
  resolveTaskDecision,
  type AgentId,
  type DomainEvent,
  type JsonObject,
  type ResolvedTaskSelection,
  type TaskTrack,
} from "@god-sim/protocol";
import type { EffectProposal } from "@god-sim/plugin-sdk";

import {
  operationInteractionLifecycleProposal,
} from "../execution/operation-lifecycle";
import { commitActiveOperationTerminations } from "../execution/operation-termination";
import {
  OperationTechnicalFailureError,
  operationTechnicalFailure,
} from "../execution/operation-failure-classifier";
import { prepareOperationCall } from "../execution/operation-planner";
import {
  createOperationRuntimeContext,
  isOperationRuntimeCall,
  type HostedOperationRegistry,
  type OperationRuntimeRegistry,
} from "../execution/operation-runtime";
import type { ActiveOperation } from "../execution/operation";
import type { TaskTrackState, TaskTracks } from "../execution/task-tracks";
import { appendDomainEvent } from "../engine/event-writer";
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

interface CancellationLifecycle {
  readonly agentId: AgentId;
  readonly operation: ActiveOperation;
  readonly result: JsonObject | null;
  readonly effects: EffectProposal["effects"];
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
  registry: OperationRuntimeRegistry,
  plan: AgentDecisionPlan,
  pendingOperationResults: AgentState["pendingOperationResults"] = [],
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
    pendingOperationResults,
  };
  assertCurrentCallsMatchTracks(next);
  return next;
}

function acknowledgeFuseResults(
  worldInput: WorldState,
  registry: OperationRuntimeRegistry,
  agentIds: readonly AgentId[],
): WorldState {
  let world = worldInput;
  for (const agentId of [...agentIds].sort((left, right) =>
    left.localeCompare(right),
  )) {
    const agent = world.agents.get(agentId);
    if (!agent) throw new Error(`Cannot acknowledge results for unknown agent ${agentId}`);
    let currentAgent = agent;
    for (const receipt of agent.pendingOperationResults.filter(
      (candidate) => !candidate.terminal,
    )) {
      const operation = currentAgent.activeOperations.get(receipt.callId);
      if (!operation || operation.operationId !== receipt.operationId) {
        throw new Error(
          `Pending result ${receipt.callId} does not match an active operation`,
        );
      }
      let acknowledged: ActiveOperation;
      if (isOperationRuntimeCall(operation)) {
        const hostedRegistry = registry as OperationRuntimeRegistry &
          Partial<HostedOperationRegistry>;
        if (!hostedRegistry.getHostedOperation) {
          throw new OperationTechnicalFailureError(
            operationTechnicalFailure(
              "configuration",
              "hosted_operation_registry_unavailable",
              `Hosted operation ${operation.operationId} cannot acknowledge a fuse receipt without a hosted registry.`,
              false,
            ),
          );
        }
        let runtime;
        try {
          runtime = hostedRegistry.getHostedOperation(
            operation.operationId,
            operation.hostDefinition,
          );
        } catch (error) {
          throw new OperationTechnicalFailureError(
            operationTechnicalFailure(
              "configuration",
              "hosted_operation_runtime_lookup_exception",
              `Hosted operation runtime lookup threw: ${error instanceof Error ? error.message : String(error)}`,
              false,
            ),
          );
        }
        if (!runtime) {
          throw new OperationTechnicalFailureError(
            operationTechnicalFailure(
              "configuration",
              "hosted_operation_runtime_missing",
              `No hosted runtime is registered for ${operation.operationId}.`,
              false,
            ),
          );
        }
        let nextState: unknown;
        try {
          nextState = runtime.acknowledgeFuseResult(
            createOperationRuntimeContext(world, registry, agentId),
            operation,
            receipt.result,
          );
        } catch (error) {
          throw new OperationTechnicalFailureError(
            operationTechnicalFailure(
              "plugin",
              "fuse_acknowledge_exception",
              `Hosted fuse acknowledgement threw: ${error instanceof Error ? error.message : String(error)}`,
              true,
            ),
          );
        }
        let parsedState;
        try {
          const parsed = runtime.stateSchema.safeParse(nextState);
          const normalized = parsed.success
            ? JsonObjectSchema.safeParse(parsed.data)
            : undefined;
          if (!parsed.success || !normalized?.success) {
            throw new Error("Hosted fuse acknowledgement returned invalid state");
          }
          parsedState = normalized.data;
        } catch (error) {
          throw new OperationTechnicalFailureError(
            operationTechnicalFailure(
              "plugin",
              "fuse_acknowledge_state_invalid",
              `Hosted fuse acknowledgement returned invalid state: ${error instanceof Error ? error.message : String(error)}`,
              false,
            ),
          );
        }
        acknowledged = { ...operation, state: parsedState };
      } else {
        const runtime = registry.getOperation(operation.operationId);
        if (!runtime) {
          throw new Error(`Operation ${operation.operationId} is not registered`);
        }
        acknowledged = runtime.acknowledgeFuseResult(
          createOperationRuntimeContext(world, registry, agentId),
          operation,
          receipt,
        );
      }
      currentAgent = {
        ...currentAgent,
        activeOperations: new Map(currentAgent.activeOperations).set(
          acknowledged.callId,
          acknowledged,
        ),
      };
      world = {
        ...world,
        agents: new Map(world.agents).set(agentId, currentAgent),
      };
    }
  }
  return world;
}

export function preflightTaskDecision(
  world: WorldState,
  registry: OperationRuntimeRegistry,
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
  registry: OperationRuntimeRegistry,
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

  const acknowledgedWorld = acknowledgeFuseResults(
    world,
    registry,
    plans.map((plan) => plan.agentId),
  );
  const cancellationLifecycles: CancellationLifecycle[] = [];
  plans.forEach((plan) => {
    const agent = acknowledgedWorld.agents.get(plan.agentId)!;
    [...plan.removedCallIds]
      .sort((left, right) => left.localeCompare(right))
      .forEach((callId) => {
        const operation = agent.activeOperations.get(callId);
        if (!operation) {
          throw new Error(`Cannot cancel missing operation ${callId}`);
        }
        const lifecycle = operationInteractionLifecycleProposal(
          acknowledgedWorld,
          registry,
          agent.id,
          operation,
          "cancel",
        );
        cancellationLifecycles.push({
          agentId: agent.id,
          operation,
          result: lifecycle.result,
          effects: lifecycle.effects,
        });
      });
  });
  const cancellation = commitActiveOperationTerminations(
    acknowledgedWorld,
    registry,
    cancellationLifecycles.map((lifecycle) => ({
      agentId: lifecycle.agentId,
      operation: lifecycle.operation,
      outcome: "cancelled" as const,
      source: "task_replaced",
      proposal: { effects: lifecycle.effects },
      ...(lifecycle.result === null ? {} : { resultOverride: lifecycle.result }),
    })),
    {
      causationId: `release:${cycle.id}`,
      correlationId: cycle.id,
    },
  );
  if (cancellation.kind === "technical_failure") {
    throw new OperationTechnicalFailureError(cancellation.failure, {
      world: acknowledgedWorld,
      events: [],
    });
  }

  const candidateWorld = cancellation.world;
  const preparedAgents = new Map<AgentId, AgentState>();
  for (const plan of plans) {
    const cancelledCallIds = new Set(
      cancellationLifecycles
        .filter((lifecycle) => lifecycle.agentId === plan.agentId)
        .map((lifecycle) => lifecycle.operation.callId),
    );
    const terminalCancellationResults = candidateWorld
      .agents.get(plan.agentId)!
      .pendingOperationResults.filter(
        (result) => result.terminal && cancelledCallIds.has(result.callId),
      );
    preparedAgents.set(
      plan.agentId,
      applyAgentDecisionPlan(
        candidateWorld,
        registry,
        plan,
        terminalCancellationResults,
      ),
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
  registry: OperationRuntimeRegistry,
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
