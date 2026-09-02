import {
  JsonObjectSchema,
  type AgentId,
  type DecisionReason,
  type DomainEvent,
  type EntityId,
  type EventId,
} from "@god-sim/protocol";

import {
  advanceOperations,
  markInteractionCompleted,
  markInteractionStarted,
  replaceActiveOperation,
  terminateOperation,
  type AgentOperationFailure,
  type CompletedOperation,
  type InteractionCompletionRequest,
  type OperationAdvanceResult,
} from "../execution/action-runner";
import { recoverBlockedOperation } from "../execution/local-recovery";
import {
  accumulateOperationObservations,
  operationInteractionLifecycleProposal,
  recordOperationTermination,
} from "../execution/operation-lifecycle";
import type { ActiveOperation, OperationObservation } from "../execution/operation";
import { detectPlanConflict } from "../decision/plan-conflict-detector";
import { arbitrateInteractionBatch } from "../interaction/effect-arbiter";
import { commitProposal } from "../interaction/effect-committer";
import { proposeInteraction } from "../interaction/interaction-router";
import { advanceBladderNeeds } from "../needs/bladder-system";
import {
  applyPerceptionVisibility,
  collectPerceptionCandidates,
} from "../perception/visibility-system";
import {
  recordPerceptionCandidates,
  type PerceptionCandidate,
} from "../perception/perception-recorder";
import { advanceWorldClock } from "../world/world-clock";
import type { PluginRegistry } from "../world/plugin-registry";
import { SpatialIndex } from "../world/spatial-index";
import type { WorldState } from "../world/world-state";
import { appendDomainEvent } from "./event-writer";

export interface DecisionNeed {
  readonly agentId: AgentId;
  readonly reason: DecisionReason;
}

export interface TickPipelineResult {
  readonly world: WorldState;
  readonly events: readonly DomainEvent[];
  readonly decisionNeeds: readonly DecisionNeed[];
}

interface InteractionProcessingResult {
  readonly world: WorldState;
  readonly events: readonly DomainEvent[];
  readonly failures: readonly AgentOperationFailure[];
  readonly completedOperations: readonly CompletedOperation[];
}

interface RecordedOperationFailure extends AgentOperationFailure {
  readonly sourceEventId: EventId;
}

interface FailedOperationTermination {
  readonly agentId: AgentId;
  readonly operation: ActiveOperation;
  readonly reasonCode: string;
}

function eventMetadata(causationId: string, correlationId = causationId) {
  return { causationId, correlationId };
}

function perceptionMetadata(
  worldTick: number,
  candidate: PerceptionCandidate,
) {
  const subjectId =
    candidate.subject.kind === "memory"
      ? candidate.subject.memoryId
      : candidate.subject.kind === "object"
        ? candidate.subject.value.entityId
        : candidate.subject.value.agentId;
  return eventMetadata(
    `perception:${candidate.agentId}:${worldTick}:${candidate.subject.kind}:${subjectId}`,
  );
}

function interactionFailure(
  agentId: AgentId,
  callId: AgentOperationFailure["failure"]["callId"],
  actionId: string,
  purpose: NonNullable<AgentOperationFailure["failure"]["purpose"]>,
  reasonCode: string,
  summary: string,
  entityId?: EntityId,
): AgentOperationFailure {
  return {
    agentId,
    failure: {
      code: reasonCode,
      callId,
      actionId,
      purpose,
      summary,
      ...(entityId === undefined ? {} : { entityId }),
    },
  };
}

function automaticTraversalIsClear(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
  entityId: EntityId,
): boolean {
  return !new SpatialIndex(world, registry).objectBlocksMovement(
    entityId,
    agentId,
  );
}

function interactionParameters(
  world: WorldState,
  agentId: AgentId,
  callId: AgentOperationFailure["failure"]["callId"],
) {
  const operation = world.agents.get(agentId)?.activeOperations.get(callId);
  if (!operation) {
    throw new Error(`Operation ${callId} is not active for ${agentId}`);
  }
  return JsonObjectSchema.parse(operation.arguments["parameters"] ?? {});
}

function completeInteraction(
  worldInput: WorldState,
  registry: PluginRegistry,
  request: InteractionCompletionRequest,
): InteractionProcessingResult {
  let world = worldInput;
  const events: DomainEvent[] = [];
  const failures: AgentOperationFailure[] = [];
  const completedOperations: CompletedOperation[] = [];
  const operation = world.agents
    .get(request.agentId)
    ?.activeOperations.get(request.callId);
  if (!operation) {
    throw new Error(`Operation ${request.callId} is not active for ${request.agentId}`);
  }
  const proposed = proposeInteraction(world, registry, {
    agentId: request.agentId,
    entityId: request.entityId,
    interactionId: request.interactionId,
    parameters: interactionParameters(world, request.agentId, request.callId),
    phase: "complete",
  });
  if (!proposed.accepted) {
    if (
      request.purpose === "automatic_traversal" &&
      automaticTraversalIsClear(
        world,
        registry,
        request.agentId,
        request.entityId,
      )
    ) {
      const completed = markInteractionCompleted(
        world,
        request.agentId,
        request.callId,
        request.actionId,
      );
      world = completed.world;
      if (completed.operationCompleted) {
        completedOperations.push({
          agentId: request.agentId,
          callId: request.callId,
          label: operation.label,
        });
      }
      return { world, events, failures, completedOperations };
    }
    failures.push(
      interactionFailure(
        request.agentId,
        request.callId,
        request.actionId,
        request.purpose,
        proposed.reasonCode,
        proposed.summary,
        request.entityId,
      ),
    );
    return { world, events, failures, completedOperations };
  }

  const committed = commitProposal(
    world,
    registry,
    proposed.proposal,
    eventMetadata(request.actionId, request.callId),
  );
  if (!committed.accepted) {
    failures.push(
      interactionFailure(
        request.agentId,
        request.callId,
        request.actionId,
        request.purpose,
        committed.reason.code,
        committed.reason.message,
        request.entityId,
      ),
    );
    return { world, events, failures, completedOperations };
  }
  world = committed.world;
  events.push(...committed.events);
  if (
    request.purpose === "automatic_traversal" &&
    !automaticTraversalIsClear(
      world,
      registry,
      request.agentId,
      request.entityId,
    )
  ) {
    failures.push(
      interactionFailure(
        request.agentId,
        request.callId,
        request.actionId,
        request.purpose,
        "automatic_traversal_still_blocked",
        `${request.entityId} still blocks movement after ${request.interactionId}`,
        request.entityId,
      ),
    );
    return { world, events, failures, completedOperations };
  }
  const completed = markInteractionCompleted(
    world,
    request.agentId,
    request.callId,
    request.actionId,
  );
  world = completed.world;
  if (completed.operationCompleted) {
    completedOperations.push({
      agentId: request.agentId,
      callId: request.callId,
      label: operation.label,
      ...(request.purpose === "direct" && proposed.result !== null
        ? { result: proposed.result }
        : {}),
    });
  }
  return { world, events, failures, completedOperations };
}

function processInteractions(
  worldInput: WorldState,
  registry: PluginRegistry,
  operationResult: OperationAdvanceResult,
): InteractionProcessingResult {
  let world = worldInput;
  const events: DomainEvent[] = [];
  const failures: AgentOperationFailure[] = [];
  const completedOperations: CompletedOperation[] = [];

  for (const request of [...operationResult.completionRequests].sort(
    (left, right) => left.actionId.localeCompare(right.actionId),
  )) {
    const completed = completeInteraction(world, registry, request);
    world = completed.world;
    events.push(...completed.events);
    failures.push(...completed.failures);
    completedOperations.push(...completed.completedOperations);
  }

  const arbitration = arbitrateInteractionBatch(
    world,
    operationResult.interactionIntents,
  );
  world = { ...world, randomState: arbitration.randomState };
  for (const record of arbitration.records) {
    if (record.contenderAgentIds.length < 2 || record.tieBreaker === null) {
      continue;
    }
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
      world,
      {
        type: "interaction_arbitrated",
        entityId: record.entityId,
        interactionId: winner.interactionId,
        contenders: record.contenderAgentIds,
        winnerAgentId: record.winnerAgentId,
        tieBreaker: record.tieBreaker,
      },
      eventMetadata(winner.intentId),
    );
    world = written.world;
    events.push(written.event);
  }

  for (const decision of arbitration.decisions) {
    const intent = operationResult.interactionIntents.find(
      (candidate) => candidate.intentId === decision.intentId,
    );
    if (!intent) throw new Error(`Missing operation intent ${decision.intentId}`);
    if (!decision.accepted) {
      failures.push(
        interactionFailure(
          decision.agentId,
          intent.callId,
          intent.actionId,
          intent.purpose,
          decision.reasonCode,
          `${decision.entityId} was claimed by another agent`,
          decision.entityId,
        ),
      );
      continue;
    }

    const proposed = proposeInteraction(world, registry, {
      agentId: decision.agentId,
      entityId: decision.entityId,
      interactionId: decision.interactionId,
      parameters: interactionParameters(world, decision.agentId, intent.callId),
      phase: "start",
    });
    if (!proposed.accepted) {
      if (
        intent.purpose === "automatic_traversal" &&
        automaticTraversalIsClear(
          world,
          registry,
          decision.agentId,
          decision.entityId,
        )
      ) {
        const completed = markInteractionCompleted(
          world,
          decision.agentId,
          intent.callId,
          intent.actionId,
        );
        world = completed.world;
        if (completed.operationCompleted) {
          completedOperations.push({
            agentId: decision.agentId,
            callId: intent.callId,
            label: world.agents
              .get(decision.agentId)
              ?.activeOperations.get(intent.callId)?.label ?? "Operation",
          });
        }
        continue;
      }
      failures.push(
        interactionFailure(
          decision.agentId,
          intent.callId,
          intent.actionId,
          intent.purpose,
          proposed.reasonCode,
          proposed.summary,
          decision.entityId,
        ),
      );
      continue;
    }
    const committed = commitProposal(
      world,
      registry,
      proposed.proposal,
      eventMetadata(intent.actionId, intent.callId),
    );
    if (!committed.accepted) {
      failures.push(
        interactionFailure(
          decision.agentId,
          intent.callId,
          intent.actionId,
          intent.purpose,
          committed.reason.code,
          committed.reason.message,
          decision.entityId,
        ),
      );
      continue;
    }
    world = markInteractionStarted(
      committed.world,
      decision.agentId,
      intent.callId,
      intent.actionId,
    );
    events.push(...committed.events);

    const currentOperation = world.agents
      .get(decision.agentId)
      ?.activeOperations.get(intent.callId);
    const currentAction = currentOperation?.plan.actions[
      currentOperation.plan.currentActionIndex
    ];
    if (
      currentAction?.kind === "interact_object" &&
      currentAction.progressTicks >= currentAction.durationTicks
    ) {
      const completed = completeInteraction(world, registry, {
        callId: intent.callId,
        actionId: intent.actionId,
        agentId: decision.agentId,
        entityId: decision.entityId,
        interactionId: decision.interactionId,
        purpose: intent.purpose,
      });
      world = completed.world;
      events.push(...completed.events);
      failures.push(...completed.failures);
      completedOperations.push(...completed.completedOperations);
    }
  }

  return { world, events, failures, completedOperations };
}

function addDecisionNeed(
  needs: Map<AgentId, DecisionNeed>,
  agentId: AgentId,
  reason: DecisionReason,
  overwrite = false,
): void {
  if (overwrite || !needs.has(agentId)) {
    needs.set(agentId, { agentId, reason });
  }
}

function recordNeedCrossings(
  worldInput: WorldState,
  crossings: ReturnType<typeof advanceBladderNeeds>["crossings"],
): {
  readonly world: WorldState;
  readonly events: readonly DomainEvent[];
  readonly urgentAgentIds: readonly AgentId[];
} {
  let world = worldInput;
  const events: DomainEvent[] = [];
  const urgentAgentIds: AgentId[] = [];
  for (const crossing of crossings) {
    const written = appendDomainEvent(
      world,
      {
        type: "agent_need_changed",
        agentId: crossing.agentId,
        need: "bladder",
        previousValue: crossing.previousValue,
        newValue: crossing.newValue,
      },
      eventMetadata(`need:${crossing.agentId}:${world.tick}`),
    );
    world = written.world;
    events.push(written.event);
    const agent = world.agents.get(crossing.agentId);
    if (!agent) throw new Error(`Unknown agent instance: ${crossing.agentId}`);
    world = {
      ...world,
      agents: new Map(world.agents).set(crossing.agentId, {
        ...agent,
        memories: [
          ...agent.memories,
          {
            id: `memory:${written.event.eventId}`,
            sourceEventId: written.event.eventId,
            formedAtTick: world.tick,
            observationKind: "body" as const,
            summary: `Bladder need became ${crossing.newSensation}`,
            relatedEntityId: null,
          },
        ],
      }),
    };
    if (crossing.newSensation === "urgent") {
      urgentAgentIds.push(crossing.agentId);
    }
  }
  return { world, events, urgentAgentIds };
}

export function refreshAllPerceptions(
  worldInput: WorldState,
  registry: PluginRegistry,
): {
  readonly world: WorldState;
  readonly events: readonly DomainEvent[];
  readonly conflicts: readonly DecisionNeed[];
  readonly observationsByAgent: ReadonlyMap<AgentId, readonly OperationObservation[]>;
} {
  let world = worldInput;
  const events: DomainEvent[] = [];
  const conflicts: DecisionNeed[] = [];
  const observationsByAgent = new Map<AgentId, readonly OperationObservation[]>();
  for (const agentId of [...world.agents.keys()].sort((left, right) =>
    left.localeCompare(right),
  )) {
    const scan = collectPerceptionCandidates(world, registry, agentId);
    observationsByAgent.set(agentId, scan.observations);
    world = applyPerceptionVisibility(world, scan);
    const recorded = recordPerceptionCandidates(
      world,
      scan.candidates,
      (candidate) => perceptionMetadata(world.tick, candidate),
    );
    world = recorded.world;
    world = accumulateOperationObservations(
      world,
      registry,
      agentId,
      scan.observations,
    );
    events.push(...recorded.events);
    const agent = world.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent instance: ${agentId}`);
    const conflict = detectPlanConflict(agent, recorded.changes);
    if (conflict) {
      conflicts.push({
        agentId,
        reason: { code: conflict.code, summary: conflict.summary },
      });
    }
  }
  return { world, events, conflicts, observationsByAgent };
}

function recordOperationFailures(
  worldInput: WorldState,
  failures: readonly AgentOperationFailure[],
): {
  readonly world: WorldState;
  readonly events: readonly DomainEvent[];
  readonly failures: readonly RecordedOperationFailure[];
} {
  let world = worldInput;
  const events: DomainEvent[] = [];
  const recordedFailures: RecordedOperationFailure[] = [];
  for (const failure of failures) {
    const written = appendDomainEvent(
      world,
      {
        type: "action_failed",
        agentId: failure.agentId,
        actionId: failure.failure.actionId,
        reasonCode: failure.failure.code,
        summary: failure.failure.summary,
        ...(failure.failure.entityId === undefined
          ? {}
          : { entityId: failure.failure.entityId }),
        perceivedByAgent: true,
      },
      eventMetadata(failure.failure.actionId, failure.failure.callId),
    );
    world = written.world;
    events.push(written.event);
    recordedFailures.push({ ...failure, sourceEventId: written.event.eventId });

    const agent = world.agents.get(failure.agentId);
    if (!agent) throw new Error(`Unknown agent instance: ${failure.agentId}`);
    const knownTraversalBlockers = new Map(
      agent.knowledge.knownTraversalBlockers,
    );
    if (
      failure.failure.purpose === "automatic_traversal" &&
      failure.failure.entityId
    ) {
      const object = world.objects.get(failure.failure.entityId);
      if (object) {
        knownTraversalBlockers.set(object.id, {
          entityId: object.id,
          observedObjectVersion: object.version,
          reasonCode: failure.failure.code,
          sourceEventId: written.event.eventId,
        });
      }
    }
    world = {
      ...world,
      agents: new Map(world.agents).set(agent.id, {
        ...agent,
        knowledge: { ...agent.knowledge, knownTraversalBlockers },
        memories: [
          ...agent.memories,
          {
            id: `memory:${written.event.eventId}`,
            sourceEventId: written.event.eventId,
            formedAtTick: world.tick,
            observationKind: "interaction",
            summary: failure.failure.summary,
            relatedEntityId: failure.failure.entityId ?? null,
          },
        ],
      }),
    };
  }
  return { world, events, failures: recordedFailures };
}

function applyOperationFailureLifecycles(
  worldInput: WorldState,
  registry: PluginRegistry,
  failures: readonly RecordedOperationFailure[],
): { readonly world: WorldState; readonly events: readonly DomainEvent[] } {
  let world = worldInput;
  const events: DomainEvent[] = [];
  const handled = new Set<string>();

  for (const item of failures) {
    const key = `${item.agentId}:${item.failure.callId}`;
    if (handled.has(key)) continue;
    handled.add(key);
    const operation = world.agents
      .get(item.agentId)
      ?.activeOperations.get(item.failure.callId);
    const action = operation?.plan.actions[operation.plan.currentActionIndex];
    if (!operation || !action || action.kind !== "interact_object") continue;

    const proposal = operationInteractionLifecycleProposal(
      world,
      registry,
      item.agentId,
      operation,
      "fail",
      item.failure.code,
    );
    const committed = commitProposal(
      world,
      registry,
      proposal,
      eventMetadata(`${item.failure.actionId}:fail`, item.failure.callId),
    );
    if (!committed.accepted) {
      throw new Error(
        `Operation failure lifecycle ${item.failure.callId} could not commit: ${committed.reason.code}: ${committed.reason.message}`,
      );
    }
    world = committed.world;
    events.push(...committed.events);
  }

  return { world, events };
}

function recoverFailedOperations(
  worldInput: WorldState,
  registry: PluginRegistry,
  failures: readonly RecordedOperationFailure[],
): {
  readonly world: WorldState;
  readonly needs: readonly DecisionNeed[];
  readonly terminations: readonly FailedOperationTermination[];
} {
  let world = worldInput;
  const needs: DecisionNeed[] = [];
  const terminations: FailedOperationTermination[] = [];
  const handled = new Set<string>();
  for (const item of failures) {
    const key = `${item.agentId}:${item.failure.callId}`;
    if (handled.has(key)) continue;
    handled.add(key);
    const agent = world.agents.get(item.agentId);
    const operation = agent?.activeOperations.get(item.failure.callId);
    if (!agent || !operation) continue;

    if (
      item.failure.purpose === "automatic_traversal" &&
      item.failure.entityId
    ) {
      const object = world.objects.get(item.failure.entityId);
      if (object) {
        const recovered = recoverBlockedOperation(
          world,
          registry,
          item.agentId,
          {
            callId: item.failure.callId,
            entityId: item.failure.entityId,
            observedObjectVersion: object.version,
            reasonCode: item.failure.code,
            sourceEventId: item.sourceEventId,
          },
          agent.knowledge,
        );
        const currentAgent = world.agents.get(item.agentId)!;
        world = {
          ...world,
          agents: new Map(world.agents).set(item.agentId, {
            ...currentAgent,
            knowledge: {
              ...currentAgent.knowledge,
              knownTraversalBlockers:
                recovered.knowledge.knownTraversalBlockers,
            },
          }),
        };
        if (recovered.kind === "replanned") {
          world = replaceActiveOperation(
            world,
            item.agentId,
            recovered.operation,
          );
          continue;
        }
        world = terminateOperation(
          world,
          item.agentId,
          item.failure.callId,
        );
        terminations.push({
          agentId: item.agentId,
          operation,
          reasonCode: recovered.reasonCode,
        });
        needs.push({
          agentId: item.agentId,
          reason: {
            code: recovered.reasonCode,
            summary: item.failure.summary,
          },
        });
        continue;
      }
    }

    world = terminateOperation(
      world,
      item.agentId,
      item.failure.callId,
    );
    terminations.push({
      agentId: item.agentId,
      operation,
      reasonCode: item.failure.code,
    });
    needs.push({
      agentId: item.agentId,
      reason: {
        code: item.failure.code,
        summary: item.failure.summary,
      },
    });
  }
  return { world, needs, terminations };
}

function activeOperationsAtTickStart(world: WorldState): Map<string, ActiveOperation> {
  const operations = new Map<string, ActiveOperation>();
  for (const [agentId, agent] of world.agents) {
    for (const operation of agent.activeOperations.values()) {
      operations.set(`${agentId}:${operation.callId}`, operation);
    }
  }
  return operations;
}

export function runTickPipeline(
  worldInput: WorldState,
  registry: PluginRegistry,
): TickPipelineResult {
  if (worldInput.mode !== "RUNNING") {
    return { world: worldInput, events: [], decisionNeeds: [] };
  }

  let world = advanceWorldClock(worldInput);
  const events: DomainEvent[] = [];
  const needs = new Map<AgentId, DecisionNeed>();
  const operationSnapshots = activeOperationsAtTickStart(world);

  const bladder = advanceBladderNeeds(world);
  const recordedNeeds = recordNeedCrossings(bladder.world, bladder.crossings);
  world = recordedNeeds.world;
  events.push(...recordedNeeds.events);
  for (const agentId of recordedNeeds.urgentAgentIds) {
    addDecisionNeed(needs, agentId, {
      code: "urgent_bladder",
      summary: "Bladder need became urgent",
    });
  }

  const operations = advanceOperations(world, registry);
  world = operations.world;
  const interactions = processInteractions(world, registry, operations);
  world = interactions.world;
  events.push(...interactions.events);
  const recorded = recordOperationFailures(world, [
    ...operations.failures,
    ...interactions.failures,
  ]);
  world = recorded.world;
  events.push(...recorded.events);
  const failureLifecycles = applyOperationFailureLifecycles(
    world,
    registry,
    recorded.failures,
  );
  world = failureLifecycles.world;
  events.push(...failureLifecycles.events);

  const perception = refreshAllPerceptions(world, registry);
  world = perception.world;
  events.push(...perception.events);
  for (const conflict of perception.conflicts) {
    addDecisionNeed(needs, conflict.agentId, conflict.reason, true);
  }

  const failed = recoverFailedOperations(world, registry, recorded.failures);
  world = failed.world;
  for (const need of failed.needs) {
    addDecisionNeed(needs, need.agentId, need.reason);
  }

  for (const termination of [...failed.terminations].sort(
    (left, right) =>
      left.agentId.localeCompare(right.agentId) ||
      left.operation.callId.localeCompare(right.operation.callId),
  )) {
    const written = recordOperationTermination(
      world,
      registry,
      termination.agentId,
      termination.operation,
      "failed",
      termination.reasonCode,
      eventMetadata(termination.operation.callId),
    );
    world = written.world;
    events.push(...written.events);
  }

  const completedByCall = new Map<string, CompletedOperation>();
  for (const completed of [
    ...operations.completedOperations,
    ...interactions.completedOperations,
  ]) {
    completedByCall.set(`${completed.agentId}:${completed.callId}`, completed);
  }
  for (const completed of [...completedByCall.values()].sort(
    (left, right) =>
      left.agentId.localeCompare(right.agentId) ||
      left.callId.localeCompare(right.callId),
  )) {
    const snapshot = operationSnapshots.get(
      `${completed.agentId}:${completed.callId}`,
    );
    if (!snapshot) {
      throw new Error(
        `Completed operation ${completed.agentId}:${completed.callId} has no identity`,
      );
    }
    const runtime = registry.getOperation(snapshot.operationId);
    if (!runtime) {
      throw new Error(`Operation ${snapshot.operationId} is not registered`);
    }
    const operation = runtime.accumulateObservations
      ? runtime.accumulateObservations(
          snapshot,
          perception.observationsByAgent.get(completed.agentId) ?? [],
        )
      : snapshot;
    const written = recordOperationTermination(
      world,
      registry,
      completed.agentId,
      operation,
      "completed",
      "operation_completed",
      eventMetadata(completed.callId),
      completed.result,
    );
    world = written.world;
    events.push(...written.events);
    addDecisionNeed(needs, completed.agentId, {
      code: "operation_completed",
      summary: `${completed.label} completed`,
    });
  }

  return {
    world,
    events,
    decisionNeeds: [...needs.values()].sort((left, right) =>
      left.agentId.localeCompare(right.agentId),
    ),
  };
}
