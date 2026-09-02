import type { AgentId, EntityId, OperationCallId } from "@god-sim/protocol";

import type {
  ActiveOperation,
  OperationAction,
  OperationInteractionPurpose,
  OperationObjectInteractionAction,
} from "./operation";
import { operationCallIdsInTrackOrder } from "./task-tracks";
import type { InteractionIntent } from "../interaction/effect-arbiter";
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
