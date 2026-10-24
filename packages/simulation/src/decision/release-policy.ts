import {
  OperationCallIdSchema,
  JsonObjectSchema,
  DirectTaskDecisionSchema,
  type DirectTaskDecision,
  type AgentId,
  type DomainEvent,
  type TaskTrack,
} from "@god-sim/protocol";

import {
  operationInteractionLifecycleProposal,
} from "../execution/operation-lifecycle";
import { cancelOperationLifecycle } from "../execution/operation-lifecycle-runner";
import {
  commitOperationTerminations,
  type OperationTerminationBatchRequest,
} from "../execution/operation-termination";
import {
  OperationTechnicalFailureError,
  operationTechnicalFailure,
} from "../execution/operation-failure-classifier";
import {
  prepareDirectOperationCall,
} from "../execution/operation-planner";
import {
  createOperationRuntimeContext,
  isOperationRuntimeCall,
  type HostedOperationRegistry,
  type HostedOperationRuntimeRegistry,
  type OperationRuntimeRegistry,
  type OperationRuntimeCall,
} from "../execution/operation-runtime";
import { hostedOperationLabel } from "../execution/operation-label";
import type { ActiveOperation } from "../execution/operation";
import type { TaskTrackState, TaskTracks } from "../execution/task-tracks";
import { appendDomainEvent } from "../engine/event-writer";
import {
  directOperationBindingKey,
  preflightDirectDecision,
} from "./direct-decision-preflight";
import {
  type GoalUpdateValidator,
} from "./goal-update-validator";
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

interface CancellationLifecycle {
  readonly agentId: AgentId;
  readonly callId: ActiveOperation["callId"];
  readonly request: OperationTerminationBatchRequest;
}

interface DirectAgentDecisionPlan {
  readonly agentId: AgentId;
  readonly proposal: DirectTaskDecision;
  readonly preparedByTrack: Readonly<Record<TaskTrack, OperationRuntimeCall | null>>;
  readonly removedCallIds: ReadonlySet<ActiveOperation["callId"]>;
}

export type { GoalUpdateValidator } from "./goal-update-validator";

export function allDecisionResultsAccepted(cycle: DecisionCycleState): boolean {
  return cycle.requestedAgentIds.every((agentId) => {
    const request = cycle.requests.get(agentId);
    return request !== undefined && request.acceptedProposal !== null;
  });
}

function analyzeDirectTaskDecision(
  world: WorldState,
  registry: HostedOperationRuntimeRegistry,
  agentId: AgentId,
  request: DecisionRequestState,
  goalUpdateValidator?: GoalUpdateValidator,
): DirectAgentDecisionPlan {
  const cycle = world.decisionCycle;
  if (!cycle) throw new Error("No decision cycle is active");
  const agent = world.agents.get(agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${agentId}`);
  const parsed = DirectTaskDecisionSchema.safeParse(request.acceptedProposal);
  if (!parsed.success) {
    throw new Error(`Decision ${request.identity.requestId} is not a direct decision`);
  }
  const proposal = parsed.data;
  const preflight = preflightDirectDecision(
    world,
    registry,
    agentId,
    proposal,
    goalUpdateValidator,
  );
  if (preflight.kind === "invalid") throw new Error(preflight.reason);
  const selections = { HEAD: proposal.head, BODY: proposal.body } as const;
  assertCurrentCallsMatchTracks(agent);

  const preparedByTrack: Record<TaskTrack, OperationRuntimeCall | null> = {
    HEAD: null,
    BODY: null,
  };
  const preparedByBinding = new Map<string, OperationRuntimeCall>();
  let callIndex = 0;
  for (const track of TASK_TRACKS) {
    const selection = selections[track];
    if (selection.kind !== "replace" || selection.task.kind !== "operation") continue;
    const binding = preflight.bindings[track];
    if (!binding) throw new Error(`Missing resolved operation binding for ${track}`);
    const key = directOperationBindingKey(binding);
    const existing = preparedByBinding.get(key);
    if (existing) {
      preparedByTrack[track] = existing;
      continue;
    }
    const result = prepareDirectOperationCall(
      world,
      registry,
      agentId,
      track,
      selection.task,
      OperationCallIdSchema.parse(
        `operation-call:${cycle.id}:${agentId}:${callIndex}`,
      ),
    );
    callIndex += 1;
    if (result.kind === "invalid_reference") {
      throw new Error(result.message);
    }
    if (result.kind === "technical_failure") {
      throw new OperationTechnicalFailureError(result.failure);
    }
    if (
      result.operation.operationId !== binding.runtime.id ||
      directOperationBindingKey({
        runtime: { id: result.operation.operationId },
        host: result.operation.host,
        arguments: result.operation.arguments,
      }) !== key
    ) {
      throw new Error(
        `Operation ${binding.runtime.id} changed its binding during final preparation`,
      );
    }
    preparedByTrack[track] = result.operation;
    preparedByBinding.set(key, result.operation);
  }

  const removedCallIds = new Set(
    TASK_TRACKS.flatMap((track) => {
      if (selections[track].kind === "continue") return [];
      const current = agent.taskTracks[track];
      return current.kind === "operation" ? [current.callId] : [];
    }),
  );
  return { agentId, proposal, preparedByTrack, removedCallIds };
}

function applyDirectAgentDecisionPlan(
  world: WorldState,
  plan: DirectAgentDecisionPlan,
  pendingOperationResults: AgentState["pendingOperationResults"] = [],
): AgentState {
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
  for (const track of TASK_TRACKS) {
    const selection = track === "HEAD" ? plan.proposal.head : plan.proposal.body;
    if (selection.kind === "continue") continue;
    if (selection.task.kind === "empty_task") {
      taskTracks[track] = { kind: "empty" };
      continue;
    }
    const operation = plan.preparedByTrack[track];
    if (!operation) throw new Error(`Missing prepared operation for ${track}`);
    activeOperations.set(operation.callId, operation as unknown as ActiveOperation);
    for (const occupiedTrack of operation.taskSlots) {
      taskTracks[occupiedTrack] = { kind: "operation", callId: operation.callId };
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

type RemovalPlan = {
  readonly agentId: AgentId;
  readonly removedCallIds: ReadonlySet<ActiveOperation["callId"]>;
};

function prepareCancellationLifecycles(
  world: WorldState,
  registry: OperationRuntimeRegistry,
  plans: readonly RemovalPlan[],
): CancellationLifecycle[] {
  const cancellationLifecycles: CancellationLifecycle[] = [];
  for (const plan of plans) {
    const agent = world.agents.get(plan.agentId);
    if (!agent) throw new Error(`Unknown agent instance: ${plan.agentId}`);
    [...plan.removedCallIds]
      .sort((left, right) => left.localeCompare(right))
      .forEach((callId) => {
        const operation = agent.activeOperations.get(callId);
        if (!operation) throw new Error(`Cannot cancel missing operation ${callId}`);
        if (isOperationRuntimeCall(operation)) {
          const hostedRegistry = registry as OperationRuntimeRegistry &
            Partial<HostedOperationRegistry>;
          if (!hostedRegistry.getHostedOperation) {
            throw new OperationTechnicalFailureError(
              operationTechnicalFailure(
                "configuration",
                "hosted_operation_registry_unavailable",
                `Hosted operation ${operation.operationId} cannot be cancelled without a hosted registry.`,
                false,
              ),
            );
          }
          const lifecycle = cancelOperationLifecycle(
            {
              world,
              registry: registry as HostedOperationRuntimeRegistry,
              agentId: agent.id,
              operation,
            },
            "task_replaced",
          );
          if (lifecycle.kind === "technical_failure") {
            throw new OperationTechnicalFailureError(lifecycle.failure, {
              world,
              events: [],
            });
          }
          cancellationLifecycles.push({
            agentId: agent.id,
            callId: operation.callId,
            request: {
              kind: "hosted",
              request: {
                transaction: lifecycle.transaction,
                operation: lifecycle.operation,
              },
            },
          });
          return;
        }
        const lifecycle = operationInteractionLifecycleProposal(
          world,
          registry,
          agent.id,
          operation,
          "cancel",
        );
        cancellationLifecycles.push({
          agentId: agent.id,
          callId: operation.callId,
          request: {
            kind: "active",
            request: {
              agentId: agent.id,
              operation,
              outcome: "cancelled",
              source: "task_replaced",
              proposal: { effects: lifecycle.effects },
              ...(lifecycle.result === null ? {} : { resultOverride: lifecycle.result }),
            },
          },
        });
      });
  }
  return cancellationLifecycles;
}

function releaseDirectDecisionCycle(
  world: WorldState,
  registry: HostedOperationRuntimeRegistry,
  goalUpdateValidator?: GoalUpdateValidator,
): DecisionReleaseTransition {
  const cycle = world.decisionCycle;
  if (!cycle) throw new Error("No decision cycle is active");
  if (!allDecisionResultsAccepted(cycle)) {
    throw new Error(`Decision cycle ${cycle.id} is not ready for release`);
  }

  const acknowledgedWorld = acknowledgeFuseResults(
    world,
    registry,
    cycle.requestedAgentIds,
  );
  const plans: DirectAgentDecisionPlan[] = cycle.requestedAgentIds.map((agentId) => {
    const request = cycle.requests.get(agentId);
    if (!request) throw new Error(`Decision cycle ${cycle.id} is incomplete for ${agentId}`);
    return analyzeDirectTaskDecision(
      acknowledgedWorld,
      registry,
      agentId,
      request,
      goalUpdateValidator,
    );
  });

  // 仍在冻结世界上先完整构造所有角色的任务图。只有全部通过后，
  // 才允许提交取消补偿、占用释放和终态事件。
  const preflightAgents = new Map<AgentId, AgentState>();
  for (const plan of plans) {
    preflightAgents.set(
      plan.agentId,
      applyDirectAgentDecisionPlan(acknowledgedWorld, plan),
    );
  }

  const cancellationLifecycles = prepareCancellationLifecycles(
    acknowledgedWorld,
    registry,
    plans,
  );
  const cancellation = commitOperationTerminations(
    acknowledgedWorld,
    registry,
    cancellationLifecycles.map((lifecycle) => lifecycle.request),
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
        .map((lifecycle) => lifecycle.callId),
    );
    const terminalCancellationResults = candidateWorld
      .agents.get(plan.agentId)!
      .pendingOperationResults.filter(
        (result) => result.terminal && cancelledCallIds.has(result.callId),
      );
    const preflight = preflightAgents.get(plan.agentId);
    if (!preflight) throw new Error(`Missing preflight agent ${plan.agentId}`);
    const candidateAgent = candidateWorld.agents.get(plan.agentId);
    if (!candidateAgent) throw new Error(`Missing candidate agent ${plan.agentId}`);
    preparedAgents.set(plan.agentId, {
      ...candidateAgent,
      taskTracks: preflight.taskTracks,
      activeOperations: preflight.activeOperations,
      pendingOperationResults: terminalCancellationResults,
    });
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
  for (const plan of [...plans].sort((left, right) => left.agentId.localeCompare(right.agentId))) {
    const previousAgent = world.agents.get(plan.agentId)!;
    const nextAgent = releasedWorld.agents.get(plan.agentId)!;
    const started = [...nextAgent.activeOperations.values()]
      .filter((operation) => !previousAgent.activeOperations.has(operation.callId))
      .sort((left, right) => left.callId.localeCompare(right.callId));
    for (const operation of started) {
      if (!isOperationRuntimeCall(operation)) {
        throw new Error(`Direct release started legacy operation ${operation.callId}`);
      }
      const written = appendDomainEvent(
        releasedWorld,
        {
          type: "operation_started",
          agentId: plan.agentId,
          callId: operation.callId,
          operationId: operation.operationId,
          taskSlots: operation.taskSlots,
          label: hostedOperationLabel(releasedWorld, registry, operation),
        },
        lifecycleMetadata,
      );
      releasedWorld = written.world;
      events.push(written.event);
    }
  }
  return { world: releasedWorld, events };
}

export function preflightTaskDecision(
  world: WorldState,
  registry: OperationRuntimeRegistry,
  agentId: AgentId,
  request: DecisionRequestState,
  goalUpdateValidator?: GoalUpdateValidator,
): AgentState {
  const parsed = DirectTaskDecisionSchema.safeParse(request.acceptedProposal);
  if (!parsed.success) {
    throw new Error(`Decision ${request.identity.requestId} is not a direct decision`);
  }
  return applyDirectAgentDecisionPlan(
    world,
    analyzeDirectTaskDecision(
      world,
      registry as HostedOperationRuntimeRegistry,
      agentId,
      request,
      goalUpdateValidator,
    ),
  );
}

export function releaseDecisionCycle(
  world: WorldState,
  registry: OperationRuntimeRegistry,
  goalUpdateValidator?: GoalUpdateValidator,
): DecisionReleaseTransition {
  const cycle = world.decisionCycle;
  if (!cycle) throw new Error("No decision cycle is active");
  if (!allDecisionResultsAccepted(cycle)) {
    throw new Error(`Decision cycle ${cycle.id} is not ready for release`);
  }

  return releaseDirectDecisionCycle(
    world,
    registry as HostedOperationRuntimeRegistry,
    goalUpdateValidator,
  );
}

export function applyReleasePolicy(
  world: WorldState,
  registry: OperationRuntimeRegistry,
  goalUpdateValidator?: GoalUpdateValidator,
): DecisionReleaseTransition {
  const cycle = world.decisionCycle;
  if (!cycle || !allDecisionResultsAccepted(cycle)) {
    return { world, events: [] };
  }
  if (!world.reviewRequired) {
    return releaseDecisionCycle(world, registry, goalUpdateValidator);
  }
  if (world.mode === "READY_FOR_RELEASE") return { world, events: [] };
  return {
    world: { ...world, version: world.version + 1, mode: "READY_FOR_RELEASE" },
    events: [],
  };
}
