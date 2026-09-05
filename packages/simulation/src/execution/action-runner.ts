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
  failOperationLifecycle,
  mapOperationArbitrationFailure,
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
import {
  arbitrateInteractionBatch,
  type InteractionIntent,
} from "../interaction/effect-arbiter";
import { commitProposal } from "../interaction/effect-committer";
import { appendDomainEvent } from "../engine/event-writer";
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
  /** 生命周期提议等待批量仲裁/提交；单调用推进不会直接写世界。 */
  readonly proposal?: OperationLifecycleTransitionResult["proposal"];
  readonly phase?: "start" | "tick";
};

type HostedOperationTerminationReadyResult = HostedOperationAdvanceBase & {
  readonly kind: "termination_ready";
  readonly transaction: OperationTerminationTransaction;
  readonly preTerminationProposal?: {
    readonly proposal: OperationLifecycleTransitionResult["proposal"];
    readonly phase: "start" | "tick";
  };
};

export interface HostedOperationTerminationPendingResult
  extends HostedOperationAdvanceBase {
  readonly kind: "termination_pending";
  readonly pending: {
    readonly outcome: "completed";
    readonly source: "duration_elapsed" | "operation_signalled_completion";
    readonly operation: OperationRuntimeCall;
    readonly preTerminationProposal?: {
      readonly proposal: OperationLifecycleTransitionResult["proposal"];
      readonly phase: "start" | "tick";
    };
  };
  readonly failure: OperationTechnicalFailure;
}

type HostedOperationTechnicalFailureResult = HostedOperationAdvanceBase & {
  readonly kind: "technical_failure";
  readonly failure: OperationTechnicalFailure;
};

export type HostedOperationAdvanceResult =
  | (HostedOperationAdvanceBase & { readonly kind: "not_advanced" })
  | HostedOperationRunningResult
  | HostedOperationTerminationReadyResult
  | HostedOperationTerminationPendingResult
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
  proposal: OperationLifecycleTransitionResult["proposal"],
  callId: OperationCallId,
  phase: "start" | "tick",
):
  | { readonly kind: "committed"; readonly world: WorldState; readonly events: readonly DomainEvent[] }
  | HostedOperationTechnicalFailureResult {
  let committed;
  try {
    committed = commitProposal(world, registry, proposal, {
      causationId: `${callId}:${phase}:${world.tick}`,
      correlationId: callId,
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
  return { kind: "committed", world: committed.world, events: committed.events };
}

function projectLifecycleProposal(
  world: WorldState,
  registry: HostedOperationRuntimeRegistry,
  operation: OperationRuntimeCall,
  proposal: OperationLifecycleTransitionResult["proposal"],
  phase: "start" | "tick",
): WorldState | HostedOperationTechnicalFailureResult {
  try {
    const projected = commitProposal(world, registry, proposal, {
      causationId: `${operation.callId}:${phase}:${world.tick}`,
      correlationId: operation.callId,
    });
    if (!projected.accepted) {
      return hostedTechnicalFailure(
        world,
        operation,
        operationTechnicalFailure(
          "plugin",
          "operation_lifecycle_effect_rejected",
          `Operation ${phase} effect was rejected (${projected.reason.code}): ${projected.reason.message}`,
          true,
        ),
      );
    }
    return projected.world;
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    return hostedTechnicalFailure(
      world,
      operation,
      operationTechnicalFailure(
        "plugin",
        "operation_lifecycle_effect_exception",
        `Operation ${phase} effect commit threw: ${description}`,
        true,
      ),
    );
  }
}

function completeHostedOperation(
  world: WorldState,
  registry: HostedOperationRuntimeRegistry,
  agentId: AgentId,
  operation: OperationRuntimeCall,
  events: readonly DomainEvent[],
  source: "duration_elapsed" | "operation_signalled_completion",
  preTerminationProposal?: HostedOperationTerminationReadyResult["preTerminationProposal"],
): HostedOperationAdvanceResult {
  const completed = completeOperationLifecycle(
    { world, registry, agentId, operation },
    source,
  );
  if (completed.kind === "technical_failure") {
    return {
      world,
      operation: completed.operation,
      events,
      kind: "termination_pending",
      pending: {
        outcome: "completed",
        source,
        operation: completed.operation,
        ...(preTerminationProposal === undefined ? {} : { preTerminationProposal }),
      },
      failure: completed.failure,
    };
  }
  return {
    kind: "termination_ready",
    world,
    operation: completed.operation,
    events,
    transaction: completed.transaction,
    ...(preTerminationProposal === undefined ? {} : { preTerminationProposal }),
  };
}

/**
 * 重试此前已经收到完成信号、但 complete 阶段技术失败的调用。
 * 该入口只重试 complete，不会再次消费 tick 的完成信号。
 */
export function resumeHostedOperationTermination(
  world: WorldState,
  registry: HostedOperationRuntimeRegistry,
  agentId: AgentId,
  pending: HostedOperationTerminationPendingResult["pending"],
): HostedOperationAdvanceResult {
  let completionWorld = world;
  if (pending.preTerminationProposal) {
    const projected = projectLifecycleProposal(
      world,
      registry,
      pending.operation,
      pending.preTerminationProposal.proposal,
      pending.preTerminationProposal.phase,
    );
    if ("kind" in projected) return projected;
    completionWorld = projected;
  }
  const completed = completeOperationLifecycle(
    { world: completionWorld, registry, agentId, operation: pending.operation },
    pending.source,
  );
  if (completed.kind === "technical_failure") {
    return {
      kind: "termination_pending",
      world,
      operation: pending.operation,
      events: [],
      pending,
      failure: completed.failure,
    };
  }
  return {
    kind: "termination_ready",
    world,
    operation: completed.operation,
    events: [],
    transaction: completed.transaction,
    ...(pending.preTerminationProposal === undefined
      ? {}
      : { preTerminationProposal: pending.preTerminationProposal }),
  };
}

export interface HostedOperationBatchEntry {
  readonly agentId: AgentId;
  readonly operation: OperationRuntimeCall;
}

export interface HostedOperationBatchResult {
  readonly world: WorldState;
  readonly events: readonly DomainEvent[];
  readonly results: readonly {
    readonly agentId: AgentId;
    readonly callId: OperationCallId;
    readonly result: HostedOperationAdvanceResult;
  }[];
}

function transitionIntent(
  entry: HostedOperationBatchEntry,
  proposal: OperationLifecycleTransitionResult["proposal"],
  phase: "start" | "tick",
  arrivalTick: number,
): InteractionIntent[] {
  return proposal.effects.flatMap((effect, effectIndex) =>
    effect.type === "reserve_occupancy"
      ? [
          {
            intentId: `${entry.agentId}:${entry.operation.callId}:${phase}:${effectIndex}`,
            agentId: entry.agentId,
            entityId: effect.entityId,
            interactionId: entry.operation.operationId,
            arrivalTick,
          },
        ]
      : [],
  );
}

function proposalForResult(
  result: HostedOperationAdvanceResult,
):
  | {
      readonly proposal: OperationLifecycleTransitionResult["proposal"];
      readonly phase: "start" | "tick";
    }
  | undefined {
  if (result.kind === "running" && result.proposal && result.phase) {
    return { proposal: result.proposal, phase: result.phase };
  }
  if (result.kind === "termination_ready" && result.preTerminationProposal) {
    return result.preTerminationProposal;
  }
  if (result.kind === "termination_pending" && result.pending.preTerminationProposal) {
    return result.pending.preTerminationProposal;
  }
  return undefined;
}

/**
 * 在同一 Tick 收集所有 hosted operation 生命周期提议，再以稳定顺序仲裁
 * 资源争用并提交。输入遍历顺序不会决定同 Tick 的占用赢家。
 */
export function advanceHostedOperationBatch(
  world: WorldState,
  registry: HostedOperationRuntimeRegistry,
  entries: readonly HostedOperationBatchEntry[],
): HostedOperationBatchResult {
  const ordered = [...entries].sort(
    (left, right) =>
      left.agentId.localeCompare(right.agentId) ||
      left.operation.callId.localeCompare(right.operation.callId),
  );
  const results = ordered.map((entry) => ({
    entry,
    result: advanceHostedOperation(world, registry, entry.agentId, entry.operation),
  }));
  const intents = results.flatMap(({ entry, result }) => {
    const proposal = proposalForResult(result);
    return proposal
      ? transitionIntent(entry, proposal.proposal, proposal.phase, world.tick)
      : [];
  });
  const arbitration = arbitrateInteractionBatch(world, intents);
  const rejectedIntentIds = new Set(
    arbitration.decisions
      .filter((decision) => !decision.accepted)
      .map((decision) => decision.intentId),
  );
  let nextWorld =
    arbitration.randomState === world.randomState
      ? world
      : { ...world, randomState: arbitration.randomState };
  const events: DomainEvent[] = [];
  const processed = new Map<OperationCallId, HostedOperationAdvanceResult>();

  for (const record of arbitration.records) {
    if (record.contenderAgentIds.length < 2 || record.tieBreaker === null) continue;
    const winner = arbitration.decisions.find(
      (decision) =>
        decision.accepted &&
        decision.entityId === record.entityId &&
        decision.arrivalTick === record.arrivalTick,
    );
    if (!winner) {
      throw new Error(`Arbitration for ${record.entityId} has no winner`);
    }
    const written = appendDomainEvent(
      nextWorld,
      {
        type: "interaction_arbitrated",
        entityId: record.entityId,
        interactionId: winner.interactionId,
        contenders: record.contenderAgentIds,
        winnerAgentId: record.winnerAgentId,
        tieBreaker: record.tieBreaker,
      },
      {
        causationId: winner.intentId,
        correlationId: winner.intentId,
      },
    );
    nextWorld = written.world;
    events.push(written.event);
  }

  // Commit every accepted proposal before invoking loser failure handlers so
  // all lifecycle effects observe one arbitrated world state.
  for (const { entry, result } of results) {
    const proposal = proposalForResult(result);
    if (!proposal) {
      processed.set(entry.operation.callId, { ...result, world: nextWorld });
      continue;
    }
    const proposalIntents = transitionIntent(
      entry,
      proposal.proposal,
      proposal.phase,
      world.tick,
    );
    if (proposalIntents.some((intent) => rejectedIntentIds.has(intent.intentId))) {
      continue;
    }
    const committed = commitLifecycleTransition(
      nextWorld,
      registry,
      result.operation,
      proposal.proposal,
      entry.operation.callId,
      proposal.phase,
    );
    if (committed.kind === "technical_failure") {
      processed.set(entry.operation.callId, committed);
      continue;
    }
    nextWorld = committed.world;
    events.push(...committed.events);
    if (result.kind === "termination_pending" && result.pending.preTerminationProposal) {
      processed.set(entry.operation.callId, {
        ...result,
        world: nextWorld,
        events: committed.events,
        pending: {
          outcome: result.pending.outcome,
          source: result.pending.source,
          operation: result.pending.operation,
        },
      });
      continue;
    }
    if (result.kind === "termination_ready" && result.preTerminationProposal) {
      processed.set(entry.operation.callId, {
        kind: "termination_ready",
        world: nextWorld,
        operation: result.operation,
        events: committed.events,
        transaction: result.transaction,
      });
      continue;
    }
    processed.set(entry.operation.callId, {
      ...result,
      world: nextWorld,
      events: committed.events,
    });
  }

  for (const { entry, result } of results) {
    const proposal = proposalForResult(result);
    if (!proposal) {
      if (!processed.has(entry.operation.callId)) {
        processed.set(entry.operation.callId, { ...result, world: nextWorld });
      }
      continue;
    }
    const proposalIntents = transitionIntent(
      entry,
      proposal.proposal,
      proposal.phase,
      world.tick,
    );
    if (!proposalIntents.some((intent) => rejectedIntentIds.has(intent.intentId))) {
      continue;
    }
    const rejected = arbitration.decisions.find(
      (decision) =>
        !decision.accepted &&
        proposalIntents.some((intent) => intent.intentId === decision.intentId),
    );
    if (!rejected || rejected.accepted) {
      processed.set(
        entry.operation.callId,
        hostedTechnicalFailure(
          nextWorld,
          result.operation,
          operationTechnicalFailure(
            "protocol",
            "operation_arbitration_decision_missing",
            `Operation ${entry.operation.callId} has no rejected arbitration decision.`,
            false,
          ),
        ),
      );
      continue;
    }
    const winner = arbitration.decisions.find(
      (decision) =>
        decision.accepted &&
        decision.entityId === rejected.entityId &&
        decision.arrivalTick === rejected.arrivalTick,
    );
    if (!winner) {
      processed.set(
        entry.operation.callId,
        hostedTechnicalFailure(
          nextWorld,
          result.operation,
          operationTechnicalFailure(
            "protocol",
            "operation_arbitration_winner_missing",
            `Operation ${entry.operation.callId} has no arbitration winner.`,
            false,
          ),
        ),
      );
      continue;
    }
    const mapped = mapOperationArbitrationFailure(
      {
        world: nextWorld,
        registry,
        agentId: entry.agentId,
        operation: result.operation,
      },
      {
        reasonCode: rejected.reasonCode,
        resourceEntityId: rejected.entityId,
        winnerAgentId: winner.agentId,
      },
    );
    if (mapped.kind === "technical_failure") {
      processed.set(
        entry.operation.callId,
        hostedTechnicalFailure(nextWorld, mapped.operation, mapped.failure),
      );
      continue;
    }
    const failed = failOperationLifecycle(
      {
        world: nextWorld,
        registry,
        agentId: entry.agentId,
        operation: mapped.operation,
      },
      mapped.failure,
      "arbitration_domain_failure",
    );
    if (failed.kind === "technical_failure") {
      processed.set(
        entry.operation.callId,
        hostedTechnicalFailure(nextWorld, failed.operation, failed.failure),
      );
      continue;
    }
    processed.set(entry.operation.callId, {
      kind: "termination_ready",
      world: nextWorld,
      operation: failed.operation,
      events: [],
      transaction: failed.transaction,
    });
  }
  return {
    world: nextWorld,
    events,
    results: entries.map((entry) => ({
      agentId: entry.agentId,
      callId: entry.operation.callId,
      result:
        processed.get(entry.operation.callId) ??
        hostedTechnicalFailure(
          world,
          entry.operation,
          operationTechnicalFailure(
            "protocol",
            "operation_batch_result_missing",
            `Operation ${entry.operation.callId} did not produce a batch result.`,
            false,
          ),
        ),
    })),
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
      operation.duration.totalTicks <= Number.MIN_VALUE)
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

  const advancedOperation = step.operation;
  let evaluationWorld = world;
  const events: readonly DomainEvent[] = [];
  let transitionProposal: HostedOperationRunningResult["proposal"];
  let transitionPhase: HostedOperationRunningResult["phase"];
  if (step.kind === "transition") {
    transitionProposal = step.proposal;
    transitionPhase = operation.firstStepState === "pending" ? "start" : "tick";
    const projected = projectLifecycleProposal(
      world,
      registry,
      operation,
      step.proposal,
      transitionPhase,
    );
    if ("kind" in projected) return projected;
    evaluationWorld = projected;
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
    const completed = completeHostedOperation(
      evaluationWorld,
      registry,
      agentId,
      progressed,
      [],
      progressed.duration.kind === "fixed"
        ? "duration_elapsed"
        : "operation_signalled_completion",
      transitionProposal === undefined || transitionPhase === undefined
        ? undefined
        : { proposal: transitionProposal, phase: transitionPhase },
    );
    return { ...completed, world, events: [] };
  }

  if (
    progressed.duration.kind === "fixed" &&
    progressed.progressTicks === progressed.duration.totalTicks
  ) {
    const completed = completeHostedOperation(
      evaluationWorld,
      registry,
      agentId,
      progressed,
      [],
      "duration_elapsed",
      transitionProposal === undefined || transitionPhase === undefined
        ? undefined
        : { proposal: transitionProposal, phase: transitionPhase },
    );
    return { ...completed, world, events: [] };
  }

  return {
    kind: "running",
    world,
    operation: progressed,
    events,
    ...(transitionProposal === undefined || transitionPhase === undefined
      ? {}
      : { proposal: transitionProposal, phase: transitionPhase }),
  };
}
