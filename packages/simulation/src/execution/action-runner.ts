import type {
  AgentId,
  DomainEvent,
  EntityId,
  JsonObject,
  OperationCallId,
  OperationTechnicalFailure,
} from "@god-sim/protocol";

import type {
  ActiveOperation,
  OperationAction,
  OperationInteractionPurpose,
  OperationObjectInteractionAction,
} from "./operation";
import { operationTechnicalFailure } from "./operation-failure-classifier";
import {
  completeOperationLifecycle,
  startOperationLifecycle,
  tickOperationLifecycle,
  type OperationLifecycleTransitionResult,
} from "./operation-lifecycle-runner";
import type {
  HostedOperationRuntimeRegistry,
  OperationRuntimeCall,
  OperationTerminationTransaction,
} from "./operation-runtime";
import { operationCallIdsInTrackOrder } from "./task-tracks";
import type { InteractionIntent } from "../interaction/effect-arbiter";
import { commitProposal } from "../interaction/effect-committer";
import type { PluginRegistry } from "../world/plugin-registry";
import { SpatialIndex } from "../world/spatial-index";
import type { AgentState, WorldState } from "../world/world-state";

export interface ActionInteractionIntent extends InteractionIntent {
  readonly callId: OperationCallId;
  readonly actionId: string;
  readonly purpose: OperationInteractionPurpose;
}

export interface InteractionCompletionRequest {
  readonly callId: OperationCallId;
  readonly actionId: string;
  readonly agentId: AgentId;
  readonly entityId: EntityId;
  readonly interactionId: string;
  readonly purpose: OperationInteractionPurpose;
}

export interface OperationFailure {
  readonly code: string;
  readonly callId: OperationCallId;
  readonly actionId: string;
  readonly entityId?: EntityId;
  readonly purpose?: OperationInteractionPurpose;
  readonly summary: string;
}

export interface AgentOperationFailure {
  readonly agentId: AgentId;
  readonly failure: OperationFailure;
}

export interface CompletedOperation {
  readonly agentId: AgentId;
  readonly callId: OperationCallId;
  readonly label: string;
  readonly result?: JsonObject;
}

export interface OperationAdvanceResult {
  readonly world: WorldState;
  readonly interactionIntents: readonly ActionInteractionIntent[];
  readonly completionRequests: readonly InteractionCompletionRequest[];
  readonly failures: readonly AgentOperationFailure[];
  readonly completedOperations: readonly CompletedOperation[];
}

function replaceCurrentAction(
  operation: ActiveOperation,
  action: OperationAction,
): ActiveOperation {
  const actions = [...operation.plan.actions];
  actions[operation.plan.currentActionIndex] = action;
  return {
    ...operation,
    plan: { ...operation.plan, actions },
  };
}

function replaceOperation(
  agent: AgentState,
  operation: ActiveOperation,
): AgentState {
  return {
    ...agent,
    activeOperations: new Map(agent.activeOperations).set(
      operation.callId,
      operation,
    ),
  };
}

function clearOperation(
  agent: AgentState,
  callId: OperationCallId,
): AgentState {
  const activeOperations = new Map(agent.activeOperations);
  activeOperations.delete(callId);
  return {
    ...agent,
    taskTracks: {
      HEAD:
        agent.taskTracks.HEAD.kind === "operation" &&
        agent.taskTracks.HEAD.callId === callId
          ? { kind: "empty" }
          : agent.taskTracks.HEAD,
      BODY:
        agent.taskTracks.BODY.kind === "operation" &&
        agent.taskTracks.BODY.callId === callId
          ? { kind: "empty" }
          : agent.taskTracks.BODY,
    },
    activeOperations,
  };
}

function finishCurrentAction(
  agent: AgentState,
  operation: ActiveOperation,
): { readonly agent: AgentState; readonly operationCompleted: boolean } {
  const nextIndex = operation.plan.currentActionIndex + 1;
  if (nextIndex >= operation.plan.actions.length) {
    return {
      agent: clearOperation(agent, operation.callId),
      operationCompleted: true,
    };
  }
  return {
    agent: replaceOperation(agent, {
      ...operation,
      plan: { ...operation.plan, currentActionIndex: nextIndex },
    }),
    operationCompleted: false,
  };
}

function movementFailure(
  operation: ActiveOperation,
  actionId: string,
  blockerId: EntityId,
): OperationFailure {
  return {
    code: "movement_blocked",
    callId: operation.callId,
    actionId,
    entityId: blockerId,
    summary: `Movement blocked by ${blockerId}`,
  };
}

function emptyResult(world: WorldState): OperationAdvanceResult {
  return {
    world,
    interactionIntents: [],
    completionRequests: [],
    failures: [],
    completedOperations: [],
  };
}

export function advanceOperations(
  world: WorldState,
  registry: PluginRegistry,
): OperationAdvanceResult {
  if (world.mode !== "RUNNING") return emptyResult(world);

  const agents = new Map(world.agents);
  const interactionIntents: ActionInteractionIntent[] = [];
  const completionRequests: InteractionCompletionRequest[] = [];
  const failures: AgentOperationFailure[] = [];
  const completedOperations: CompletedOperation[] = [];
  const ticksPerCell =
    world.simulationRulesLock.rules.operations.move.ticksPerCell;

  for (const agentId of [...agents.keys()].sort((left, right) =>
    left.localeCompare(right),
  )) {
    let agent = agents.get(agentId)!;
    const callIds = operationCallIdsInTrackOrder(agent.taskTracks);
    for (const callId of callIds) {
      const operation = agent.activeOperations.get(callId);
      if (!operation) {
        throw new Error(`Task track references missing operation ${callId}`);
      }
      const action = operation.plan.actions[operation.plan.currentActionIndex];
      if (!action) {
        agent = clearOperation(agent, callId);
        completedOperations.push({ agentId, callId, label: operation.label });
        continue;
      }

      const progressedOperation = {
        ...operation,
        progressTicks: operation.progressTicks + 1,
      };

      if (action.kind === "interact_object") {
        const progressedAction = {
          ...action,
          progressTicks: action.progressTicks + 1,
        };
        const progressed = replaceCurrentAction(
          progressedOperation,
          progressedAction,
        );
        agent = replaceOperation(agent, progressed);
        if (!action.started) {
          interactionIntents.push({
            intentId: `${action.id}:start`,
            callId,
            actionId: action.id,
            agentId,
            entityId: action.targetEntityId,
            interactionId: action.interactionId,
            arrivalTick: world.tick,
            purpose: action.purpose,
          });
        } else if (progressedAction.progressTicks >= progressedAction.durationTicks) {
          completionRequests.push({
            callId,
            actionId: action.id,
            agentId,
            entityId: action.targetEntityId,
            interactionId: action.interactionId,
            purpose: action.purpose,
          });
        }
        continue;
      }

      if (action.kind === "move") {
        const nextProgress = action.progressTicks + 1;
        let nextPosition = agent.position;
        if (nextProgress % ticksPerCell === 0) {
          const pathIndex = nextProgress / ticksPerCell;
          const candidate = action.path[pathIndex];
          if (!candidate) {
            throw new Error(`Move action ${action.id} has invalid path progress`);
          }
          const currentWorld = { ...world, agents };
          const blockers = new SpatialIndex(
            currentWorld,
            registry,
          ).blockingObjectsAt(candidate, agentId);
          if (blockers.length > 0) {
            agent = replaceOperation(agent, progressedOperation);
            failures.push({
              agentId,
              failure: movementFailure(operation, action.id, blockers[0]!.id),
            });
            continue;
          }
          nextPosition = candidate;
        }
        const progressedAction = { ...action, progressTicks: nextProgress };
        const progressed = replaceCurrentAction(
          progressedOperation,
          progressedAction,
        );
        agent = replaceOperation({ ...agent, position: nextPosition }, progressed);
        if (progressedAction.progressTicks >= progressedAction.durationTicks) {
          const finished = finishCurrentAction(agent, progressed);
          agent = finished.agent;
          if (finished.operationCompleted) {
            completedOperations.push({ agentId, callId, label: operation.label });
          }
        }
        continue;
      }

      const progressedAction = {
        ...action,
        progressTicks: action.progressTicks + 1,
      };
      const progressed = replaceCurrentAction(
        progressedOperation,
        progressedAction,
      );
      agent = replaceOperation(agent, progressed);
      if (progressedAction.progressTicks >= progressedAction.durationTicks) {
        const finished = finishCurrentAction(agent, progressed);
        agent = finished.agent;
        if (finished.operationCompleted) {
          completedOperations.push({ agentId, callId, label: operation.label });
        }
      }
    }
    agents.set(agentId, agent);
  }

  return {
    world: { ...world, agents },
    interactionIntents,
    completionRequests,
    failures,
    completedOperations,
  };
}

function updateObjectAction(
  world: WorldState,
  agentId: AgentId,
  callId: OperationCallId,
  actionId: string,
  update: (
    action: OperationObjectInteractionAction,
  ) => OperationObjectInteractionAction,
): WorldState {
  const agent = world.agents.get(agentId);
  const operation = agent?.activeOperations.get(callId);
  const action = operation?.plan.actions[operation.plan.currentActionIndex];
  if (
    !agent ||
    !operation ||
    !action ||
    action.id !== actionId ||
    action.kind !== "interact_object"
  ) {
    throw new Error(`Action ${actionId} is not current for ${agentId}:${callId}`);
  }
  const nextAgent = replaceOperation(
    agent,
    replaceCurrentAction(operation, update(action)),
  );
  return {
    ...world,
    agents: new Map(world.agents).set(agentId, nextAgent),
  };
}

export function markInteractionStarted(
  world: WorldState,
  agentId: AgentId,
  callId: OperationCallId,
  actionId: string,
): WorldState {
  return updateObjectAction(world, agentId, callId, actionId, (action) => ({
    ...action,
    started: true,
  }));
}

export function markInteractionCompleted(
  world: WorldState,
  agentId: AgentId,
  callId: OperationCallId,
  actionId: string,
): { readonly world: WorldState; readonly operationCompleted: boolean } {
  const unchanged = updateObjectAction(
    world,
    agentId,
    callId,
    actionId,
    (action) => action,
  );
  const agent = unchanged.agents.get(agentId)!;
  const operation = agent.activeOperations.get(callId)!;
  const finished = finishCurrentAction(agent, operation);
  return {
    world: {
      ...unchanged,
      agents: new Map(unchanged.agents).set(agentId, finished.agent),
    },
    operationCompleted: finished.operationCompleted,
  };
}

export function terminateOperation(
  world: WorldState,
  agentId: AgentId,
  callId: OperationCallId,
): WorldState {
  const agent = world.agents.get(agentId);
  if (!agent?.activeOperations.has(callId)) {
    throw new Error(`Operation ${callId} is not active for ${agentId}`);
  }
  return {
    ...world,
    agents: new Map(world.agents).set(
      agentId,
      clearOperation(agent, callId),
    ),
  };
}

export function replaceActiveOperation(
  world: WorldState,
  agentId: AgentId,
  operation: ActiveOperation,
): WorldState {
  const agent = world.agents.get(agentId);
  if (!agent?.activeOperations.has(operation.callId)) {
    throw new Error(`Operation ${operation.callId} is not active for ${agentId}`);
  }
  return {
    ...world,
    agents: new Map(world.agents).set(
      agentId,
      replaceOperation(agent, operation),
    ),
  };
}

interface HostedOperationAdvanceBase {
  readonly world: WorldState;
  readonly operation: OperationRuntimeCall;
  readonly events: readonly DomainEvent[];
}

type HostedOperationRunningResult = HostedOperationAdvanceBase & {
  readonly kind: "running";
};

type HostedOperationTechnicalFailureResult = HostedOperationAdvanceBase & {
  readonly kind: "technical_failure";
  readonly failure: OperationTechnicalFailure;
};

export type HostedOperationAdvanceResult =
  | (HostedOperationAdvanceBase & { readonly kind: "not_advanced" })
  | HostedOperationRunningResult
  | (HostedOperationAdvanceBase & {
      readonly kind: "termination_ready";
      readonly transaction: OperationTerminationTransaction;
    })
  | HostedOperationTechnicalFailureResult;

function hostedTechnicalFailure(
  world: WorldState,
  operation: OperationRuntimeCall,
  failure: OperationTechnicalFailure,
  events: readonly DomainEvent[] = [],
): HostedOperationTechnicalFailureResult {
  return { kind: "technical_failure", world, operation, events, failure };
}

function commitLifecycleTransition(
  world: WorldState,
  registry: HostedOperationRuntimeRegistry,
  previousOperation: OperationRuntimeCall,
  transition: OperationLifecycleTransitionResult,
  phase: "start" | "tick",
): HostedOperationRunningResult | HostedOperationTechnicalFailureResult {
  let committed;
  try {
    committed = commitProposal(world, registry, transition.proposal, {
      causationId: `${transition.operation.callId}:${phase}:${world.tick}`,
      correlationId: transition.operation.callId,
    });
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    return hostedTechnicalFailure(
      world,
      previousOperation,
      operationTechnicalFailure(
        "plugin",
        "operation_lifecycle_effect_exception",
        `Operation ${phase} effect commit threw: ${description}`,
        true,
      ),
    );
  }
  if (!committed.accepted) {
    return hostedTechnicalFailure(
      world,
      previousOperation,
      operationTechnicalFailure(
        "plugin",
        "operation_lifecycle_effect_rejected",
        `Operation ${phase} effect was rejected (${committed.reason.code}): ${committed.reason.message}`,
        true,
      ),
    );
  }
  return {
    kind: "running",
    world: committed.world,
    operation: transition.operation,
    events: committed.events,
  };
}

function completeHostedOperation(
  world: WorldState,
  registry: HostedOperationRuntimeRegistry,
  agentId: AgentId,
  operation: OperationRuntimeCall,
  events: readonly DomainEvent[],
  source: "duration_elapsed" | "operation_signalled_completion",
): HostedOperationAdvanceResult {
  const completed = completeOperationLifecycle(
    { world, registry, agentId, operation },
    source,
  );
  if (completed.kind === "technical_failure") {
    return hostedTechnicalFailure(
      world,
      completed.operation,
      completed.failure,
      events,
    );
  }
  return {
    kind: "termination_ready",
    world,
    operation: completed.operation,
    events,
    transaction: completed.transaction,
  };
}

/**
 * 推进一个已经绑定宿主并锁定时长的 W1-IF operation 调用。
 * 终态只返回待提交事务；P2 负责把清理、效果和结果原子提交。
 */
export function advanceHostedOperation(
  world: WorldState,
  registry: HostedOperationRuntimeRegistry,
  agentId: AgentId,
  operation: OperationRuntimeCall,
): HostedOperationAdvanceResult {
  if (world.mode !== "RUNNING") {
    return { kind: "not_advanced", world, operation, events: [] };
  }
  if (
    !Number.isSafeInteger(operation.progressTicks) ||
    operation.progressTicks < 0
  ) {
    return hostedTechnicalFailure(
      world,
      operation,
      operationTechnicalFailure(
        "protocol",
        "operation_progress_invalid",
        `Operation ${operation.callId} has invalid progress.`,
        false,
      ),
    );
  }
  if (
    operation.duration.kind === "fixed" &&
    (!Number.isSafeInteger(operation.duration.totalTicks) ||
      operation.duration.totalTicks <= 0)
  ) {
    return hostedTechnicalFailure(
      world,
      operation,
      operationTechnicalFailure(
        "protocol",
        "operation_duration_invalid",
        `Operation ${operation.callId} has an invalid locked duration.`,
        false,
      ),
    );
  }
  if (
    operation.firstStepState === "pending" &&
    operation.progressTicks !== 0
  ) {
    return hostedTechnicalFailure(
      world,
      operation,
      operationTechnicalFailure(
        "protocol",
        "operation_pending_with_progress",
        `Operation ${operation.callId} has progress before its first step.`,
        false,
      ),
    );
  }
  if (
    operation.duration.kind === "fixed" &&
    operation.progressTicks > operation.duration.totalTicks
  ) {
    return hostedTechnicalFailure(
      world,
      operation,
      operationTechnicalFailure(
        "protocol",
        "operation_progress_exceeds_duration",
        `Operation ${operation.callId} exceeds its locked duration.`,
        false,
      ),
    );
  }
  if (
    operation.duration.kind === "fixed" &&
    operation.progressTicks === operation.duration.totalTicks
  ) {
    return completeHostedOperation(
      world,
      registry,
      agentId,
      operation,
      [],
      "duration_elapsed",
    );
  }

  const nextProgress = operation.progressTicks + 1;
  if (!Number.isSafeInteger(nextProgress)) {
    return hostedTechnicalFailure(
      world,
      operation,
      operationTechnicalFailure(
        "protocol",
        "operation_progress_overflow",
        `Operation ${operation.callId} progress cannot advance safely.`,
        false,
      ),
    );
  }

  const lifecycleInput = { world, registry, agentId, operation };
  const step =
    operation.firstStepState === "pending"
      ? startOperationLifecycle(lifecycleInput)
      : tickOperationLifecycle(lifecycleInput);
  if (step.kind === "technical_failure") {
    return hostedTechnicalFailure(world, step.operation, step.failure);
  }
  if (step.kind === "termination_ready") {
    return {
      kind: "termination_ready",
      world,
      operation: step.operation,
      events: [],
      transaction: step.transaction,
    };
  }

  let advancedWorld = world;
  let advancedOperation = step.operation;
  let events: readonly DomainEvent[] = [];
  if (step.kind === "transition") {
    const phase = operation.firstStepState === "pending" ? "start" : "tick";
    const committed = commitLifecycleTransition(
      world,
      registry,
      operation,
      step,
      phase,
    );
    if (committed.kind === "technical_failure") return committed;
    advancedWorld = committed.world;
    advancedOperation = committed.operation;
    events = committed.events;
  }

  const progressed = { ...advancedOperation, progressTicks: nextProgress };

  if (step.kind === "completion_signal") {
    if (
      progressed.duration.kind === "fixed" &&
      progressed.progressTicks !== progressed.duration.totalTicks
    ) {
      return hostedTechnicalFailure(
        world,
        operation,
        operationTechnicalFailure(
          "protocol",
          "fixed_operation_completed_early",
          `Fixed operation ${operation.callId} completed before its locked duration.`,
          false,
        ),
      );
    }
    return completeHostedOperation(
      advancedWorld,
      registry,
      agentId,
      progressed,
      events,
      progressed.duration.kind === "fixed"
        ? "duration_elapsed"
        : "operation_signalled_completion",
    );
  }

  if (
    progressed.duration.kind === "fixed" &&
    progressed.progressTicks === progressed.duration.totalTicks
  ) {
    return completeHostedOperation(
      advancedWorld,
      registry,
      agentId,
      progressed,
      events,
      "duration_elapsed",
    );
  }

  return {
    kind: "running",
    world: advancedWorld,
    operation: progressed,
    events,
  };
}
