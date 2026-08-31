import type {
  AgentId,
  DecisionReason,
  DomainEvent,
  EntityId,
  EventId,
} from "@god-sim/protocol";

import {
  advanceActions,
  markInteractionCompleted,
  markInteractionStarted,
  type AgentActionFailure,
} from "../execution/action-runner";
import { createEmptyBodySlots } from "../execution/body-slots";
import { planGoal } from "../execution/goal-planner";
import { recoverBlockedPlan } from "../execution/local-recovery";
import { arbitrateInteractionBatch } from "../interaction/effect-arbiter";
import { commitProposal } from "../interaction/effect-committer";
import { proposeInteraction } from "../interaction/interaction-router";
import { advanceBladderNeeds } from "../needs/bladder-system";
import {
  applyPerceptionUpdate,
  refreshPerception,
} from "../perception/visibility-system";
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
  readonly failures: readonly AgentActionFailure[];
  readonly completedGoalAgentIds: readonly AgentId[];
}

interface RecordedActionFailure extends AgentActionFailure {
  readonly sourceEventId: EventId;
}

function eventMetadata(causationId: string, correlationId = causationId) {
  return { causationId, correlationId };
}

function ensureActionPlans(
  world: WorldState,
  registry: PluginRegistry,
): { readonly world: WorldState; readonly needs: readonly DecisionNeed[] } {
  const agents = new Map(world.agents);
  const needs: DecisionNeed[] = [];

  for (const agentId of [...agents.keys()].sort((left, right) => left.localeCompare(right))) {
    const agent = agents.get(agentId)!;
    if (!agent.currentGoal || agent.actionPlan) continue;
    const planned = planGoal(
      { ...world, agents },
      registry,
      agentId,
      agent.currentGoal.goal,
      agent.knowledge,
      agent.currentGoal.id,
    );
    if (planned.kind === "blocked") {
      needs.push({
        agentId,
        reason: { code: planned.reasonCode, summary: planned.summary },
      });
      continue;
    }
    agents.set(agentId, { ...agent, actionPlan: planned.plan });
  }

  return { world: { ...world, agents }, needs };
}

function interactionFailure(
  agentId: AgentId,
  actionId: string,
  purpose: NonNullable<AgentActionFailure["failure"]["purpose"]>,
  reasonCode: string,
  summary: string,
  entityId?: EntityId,
): AgentActionFailure {
  return {
    agentId,
    failure: {
      code: reasonCode,
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
  return !new SpatialIndex(world, registry).objectBlocksMovement(entityId, agentId);
}

function processInteractions(
  worldInput: WorldState,
  registry: PluginRegistry,
  actionResult: ReturnType<typeof advanceActions>,
): InteractionProcessingResult {
  let world = worldInput;
  const events: DomainEvent[] = [];
  const failures: AgentActionFailure[] = [];
  const completedGoalAgentIds: AgentId[] = [];

  for (const completion of [...actionResult.completionRequests].sort((left, right) =>
    left.actionId.localeCompare(right.actionId),
  )) {
    const goalId = world.agents.get(completion.agentId)?.currentGoal?.id ?? completion.actionId;
    const proposed = proposeInteraction(world, registry, {
      agentId: completion.agentId,
      entityId: completion.entityId,
      interactionId: completion.interactionId,
      phase: "complete",
    });
    if (!proposed.accepted) {
      if (
        completion.purpose === "automatic_traversal" &&
        automaticTraversalIsClear(
          world,
          registry,
          completion.agentId,
          completion.entityId,
        )
      ) {
        const completed = markInteractionCompleted(
          world,
          completion.agentId,
          completion.actionId,
        );
        world = completed.world;
        if (completed.goalCompleted) completedGoalAgentIds.push(completion.agentId);
        continue;
      }
      failures.push(
        interactionFailure(
          completion.agentId,
          completion.actionId,
          completion.purpose,
          proposed.reasonCode,
          proposed.summary,
          completion.entityId,
        ),
      );
      continue;
    }
    const committed = commitProposal(
      world,
      registry,
      proposed.proposal,
      eventMetadata(completion.actionId, goalId),
    );
    if (!committed.accepted) {
      failures.push(
        interactionFailure(
          completion.agentId,
          completion.actionId,
          completion.purpose,
          committed.reason.code,
          committed.reason.message,
          completion.entityId,
        ),
      );
      continue;
    }
    world = committed.world;
    events.push(...committed.events);
    if (
      completion.purpose === "automatic_traversal" &&
      !automaticTraversalIsClear(
        world,
        registry,
        completion.agentId,
        completion.entityId,
      )
    ) {
      failures.push({
        agentId: completion.agentId,
        failure: {
          code: "automatic_traversal_still_blocked",
          actionId: completion.actionId,
          entityId: completion.entityId,
          purpose: "automatic_traversal",
          summary: `${completion.entityId} still blocks movement after ${completion.interactionId}`,
        },
      });
      continue;
    }
    const completed = markInteractionCompleted(world, completion.agentId, completion.actionId);
    world = completed.world;
    if (completed.goalCompleted) completedGoalAgentIds.push(completion.agentId);
  }

  const arbitration = arbitrateInteractionBatch(world, actionResult.interactionIntents);
  world = { ...world, randomState: arbitration.randomState };
  for (const record of arbitration.records) {
    if (record.contenderAgentIds.length < 2 || record.tieBreaker === null) continue;
    const winner = arbitration.decisions.find(
      (decision) =>
        decision.accepted &&
        decision.entityId === record.entityId &&
        decision.arrivalTick === record.arrivalTick,
    );
    if (!winner) throw new Error(`Arbitration for ${record.entityId} has no winner`);
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
    const intent = actionResult.interactionIntents.find(
      (candidate) => candidate.intentId === decision.intentId,
    );
    if (!intent) throw new Error(`Missing action intent ${decision.intentId}`);
    if (!decision.accepted) {
      failures.push(
        interactionFailure(
          decision.agentId,
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
      phase: "start",
    });
    if (!proposed.accepted) {
      if (
        intent.purpose === "automatic_traversal" &&
        automaticTraversalIsClear(world, registry, decision.agentId, decision.entityId)
      ) {
        const completed = markInteractionCompleted(world, decision.agentId, intent.actionId);
        world = completed.world;
        if (completed.goalCompleted) completedGoalAgentIds.push(decision.agentId);
        continue;
      }
      failures.push(
        interactionFailure(
          decision.agentId,
          intent.actionId,
          intent.purpose,
          proposed.reasonCode,
          proposed.summary,
          decision.entityId,
        ),
      );
      continue;
    }
    const goalId = world.agents.get(decision.agentId)?.currentGoal?.id ?? intent.actionId;
    const committed = commitProposal(
      world,
      registry,
      proposed.proposal,
      eventMetadata(intent.actionId, goalId),
    );
    if (!committed.accepted) {
      failures.push(
        interactionFailure(
          decision.agentId,
          intent.actionId,
          intent.purpose,
          committed.reason.code,
          committed.reason.message,
          decision.entityId,
        ),
      );
      continue;
    }
    world = markInteractionStarted(committed.world, decision.agentId, intent.actionId);
    events.push(...committed.events);
  }

  return { world, events, failures, completedGoalAgentIds };
}

function addDecisionNeed(
  needs: Map<AgentId, DecisionNeed>,
  agentId: AgentId,
  reason: DecisionReason,
  overwrite = false,
): void {
  if (overwrite || !needs.has(agentId)) needs.set(agentId, { agentId, reason });
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
    const memory = {
      id: `memory:${written.event.eventId}`,
      sourceEventId: written.event.eventId,
      formedAtTick: world.tick,
      observationKind: "body" as const,
      summary: `Bladder need became ${crossing.newSensation}`,
      relatedEntityId: null,
    };
    world = {
      ...world,
      agents: new Map(world.agents).set(crossing.agentId, {
        ...agent,
        memories: [...agent.memories, memory],
      }),
    };
    if (crossing.newSensation === "urgent") urgentAgentIds.push(crossing.agentId);
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
} {
  let world = worldInput;
  const events: DomainEvent[] = [];
  const conflicts: DecisionNeed[] = [];
  for (const agentId of [...world.agents.keys()].sort((left, right) =>
    left.localeCompare(right),
  )) {
    const update = refreshPerception(world, registry, agentId);
    world = applyPerceptionUpdate(world, update);
    for (const change of update.changes) {
      const written = appendDomainEvent(
        world,
        {
          type: "observation_remembered",
          agentId,
          sourceEventId: change.current.sourceEventId,
          observationKind: change.current.observationKind,
          summary: change.current.summary,
        },
        eventMetadata(change.current.sourceEventId),
      );
      world = written.world;
      events.push(written.event);
    }
    if (update.conflict) {
      conflicts.push({
        agentId,
        reason: { code: update.conflict.code, summary: update.conflict.summary },
      });
    }
  }
  return { world, events, conflicts };
}

function recoverFailures(
  worldInput: WorldState,
  registry: PluginRegistry,
  failures: readonly RecordedActionFailure[],
): { readonly world: WorldState; readonly needs: readonly DecisionNeed[] } {
  let world = worldInput;
  const needs: DecisionNeed[] = [];
  for (const item of failures) {
    const agent = world.agents.get(item.agentId);
    if (!agent?.currentGoal) continue;
    if (
      item.failure.purpose === "automatic_traversal" &&
      item.failure.entityId
    ) {
      const object = world.objects.get(item.failure.entityId);
      if (!object) {
        needs.push({
          agentId: item.agentId,
          reason: { code: item.failure.code, summary: item.failure.summary },
        });
        continue;
      }
      const recovered = recoverBlockedPlan(
        world,
        registry,
        item.agentId,
        {
          entityId: item.failure.entityId,
          goal: agent.currentGoal.goal,
          observedObjectVersion: object.version,
          reasonCode: item.failure.code,
          sourceEventId: item.sourceEventId,
        },
        agent.knowledge,
      );
      const knowledge = {
        ...agent.knowledge,
        knownTraversalBlockers: recovered.knowledge.knownTraversalBlockers,
      };
      if (recovered.kind === "replanned") {
        world = {
          ...world,
          agents: new Map(world.agents).set(item.agentId, {
            ...agent,
            knowledge,
            actionPlan: recovered.plan,
            bodySlots: createEmptyBodySlots(),
          }),
        };
      } else {
        world = {
          ...world,
          agents: new Map(world.agents).set(item.agentId, {
            ...agent,
            knowledge,
            bodySlots: createEmptyBodySlots(),
          }),
        };
        needs.push({
          agentId: item.agentId,
          reason: { code: recovered.reasonCode, summary: item.failure.summary },
        });
      }
      continue;
    }
    needs.push({
      agentId: item.agentId,
      reason: { code: item.failure.code, summary: item.failure.summary },
    });
  }
  return { world, needs };
}

export function runTickPipeline(
  worldInput: WorldState,
  registry: PluginRegistry,
): TickPipelineResult {
  if (worldInput.mode !== "RUNNING") {
    return { world: worldInput, events: [], decisionNeeds: [] };
  }

  const planned = ensureActionPlans(worldInput, registry);
  if (planned.needs.length > 0) {
    return { world: planned.world, events: [], decisionNeeds: planned.needs };
  }

  let world = advanceWorldClock(planned.world);
  const events: DomainEvent[] = [];
  const needs = new Map<AgentId, DecisionNeed>();

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

  const actions = advanceActions(world, registry);
  world = actions.world;
  const interactions = processInteractions(world, registry, actions);
  world = interactions.world;
  events.push(...interactions.events);
  const failures = [...actions.failures, ...interactions.failures];
  const recordedFailures: RecordedActionFailure[] = [];

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
      eventMetadata(failure.failure.actionId),
    );
    world = written.world;
    events.push(written.event);
    recordedFailures.push({ ...failure, sourceEventId: written.event.eventId });
  }

  const perception = refreshAllPerceptions(world, registry);
  world = perception.world;
  events.push(...perception.events);
  for (const conflict of perception.conflicts) {
    addDecisionNeed(needs, conflict.agentId, conflict.reason, true);
  }

  const recovery = recoverFailures(world, registry, recordedFailures);
  world = recovery.world;
  for (const need of recovery.needs) addDecisionNeed(needs, need.agentId, need.reason);

  const completedGoalAgentIds = new Set([
    ...actions.completedGoalAgentIds,
    ...interactions.completedGoalAgentIds,
  ]);
  for (const agentId of [...completedGoalAgentIds].sort((left, right) =>
    left.localeCompare(right),
  )) {
    addDecisionNeed(needs, agentId, {
      code: "goal_completed",
      summary: "Choose the next goal",
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
