import {
  DecisionCycleIdSchema,
  DecisionPromptInputSchema,
  DecisionReasonSchema,
  EntityIdSchema,
  GoalOptionSchema,
  ModelDecisionResultSchema,
  RequestIdSchema,
  type AgentId,
  type DecisionIdentity,
  type DecisionPromptInput,
  type DecisionReason,
  type GoalOption,
  type ModelDecisionResult,
} from "@god-sim/protocol";

import type { AgentState, DecisionRequestState, WorldState } from "../world/world-state";

export interface DecisionRequestSpec {
  readonly agentId: AgentId;
  readonly reason: DecisionReason;
  readonly goalOptions: readonly GoalOption[];
}

export interface DecisionRequestTransition {
  readonly world: WorldState;
  readonly promptInputs: readonly DecisionPromptInput[];
}

export interface DecisionAcceptanceResult {
  readonly accepted: boolean;
  readonly world: WorldState;
  readonly reason: string | null;
}

function currentGoalContext(agent: AgentState): DecisionPromptInput["currentGoal"] {
  const activeGoal = agent.currentGoal;
  if (!activeGoal) return null;
  const action = agent.actionPlan?.actions[agent.actionPlan.currentActionIndex];
  return {
    goal: activeGoal.goal,
    label: activeGoal.label,
    actionKind: action?.kind ?? null,
    actionProgress: action?.progressTicks ?? null,
    lastFailure: null,
  };
}

function visibleEntities(agent: AgentState): DecisionPromptInput["perception"]["visibleEntities"] {
  const objects = [...agent.knowledge.objects.values()]
    .filter((object) => agent.knowledge.visibleEntityIds.has(object.entityId))
    .map((object) => ({
      entityId: object.entityId,
      displayName: object.displayName,
      kind: "object" as const,
      observable: {
        status: object.status,
        summary: object.summary,
        details: object.observable,
      },
    }));
  const agents = [...agent.knowledge.agents.values()]
    .filter((knownAgent) =>
      agent.knowledge.visibleEntityIds.has(EntityIdSchema.parse(knownAgent.agentId)),
    )
    .map((knownAgent) => ({
      entityId: EntityIdSchema.parse(knownAgent.agentId),
      displayName: knownAgent.displayName,
      kind: "agent" as const,
      observable: { position: knownAgent.position },
    }));
  return [...objects, ...agents].sort((left, right) =>
    left.entityId.localeCompare(right.entityId),
  );
}

export function buildDecisionPromptInput(
  agent: AgentState,
  identity: DecisionIdentity,
  reason: DecisionReason,
  goalOptions: readonly GoalOption[],
): DecisionPromptInput {
  return DecisionPromptInputSchema.parse({
    ...identity,
    decisionReason: reason,
    bodySensations: [
      {
        need: "bladder",
        level: agent.bladderSensation,
        description: `Bladder need is ${agent.bladderSensation}`,
      },
    ],
    currentGoal: currentGoalContext(agent),
    memories: agent.memories.map((memory) => ({
      memoryId: memory.id,
      sourceEventId: memory.sourceEventId,
      summary: memory.summary,
      formedAtTick: memory.formedAtTick,
      observationKind: memory.observationKind,
    })),
    perception: {
      zoneId: agent.knowledge.zoneId,
      visibleEntities: visibleEntities(agent),
      heardEvents: [],
    },
    goalOptions,
  });
}

export function requestDecisions(
  world: WorldState,
  requestSpecs: readonly DecisionRequestSpec[],
): DecisionRequestTransition {
  if (requestSpecs.length === 0) throw new Error("A decision cycle requires at least one request");
  if (world.decisionCycle) throw new Error(`Decision cycle ${world.decisionCycle.id} is still active`);

  const orderedSpecs = [...requestSpecs].sort((left, right) =>
    left.agentId.localeCompare(right.agentId),
  );
  const uniqueAgentIds = new Set(orderedSpecs.map((request) => request.agentId));
  if (uniqueAgentIds.size !== orderedSpecs.length) {
    throw new Error("A decision cycle cannot request the same agent more than once");
  }

  const cycleVersion = world.version + 1;
  const cycleId = DecisionCycleIdSchema.parse(`decision-cycle:${cycleVersion}`);
  const requests = new Map<AgentId, DecisionRequestState>();
  const promptInputs: DecisionPromptInput[] = [];

  for (const [index, requestSpec] of orderedSpecs.entries()) {
    const agent = world.agents.get(requestSpec.agentId);
    if (!agent) throw new Error(`Unknown agent instance: ${requestSpec.agentId}`);
    const reason = DecisionReasonSchema.parse(requestSpec.reason);
    const goalOptions = requestSpec.goalOptions.map((option) => GoalOptionSchema.parse(option));
    if (goalOptions.length === 0) {
      throw new Error(`Decision request for ${requestSpec.agentId} has no goal options`);
    }
    const identity: DecisionIdentity = {
      requestId: RequestIdSchema.parse(`decision-request:${cycleVersion}:${index}`),
      agentId: requestSpec.agentId,
      worldId: world.id,
      worldVersion: world.version,
      decisionCycleId: cycleId,
      schemaVersion: 1,
      pluginLockHash: world.pluginLockHash,
    };
    const promptInput = buildDecisionPromptInput(
      agent,
      identity,
      reason,
      goalOptions,
    );
    requests.set(requestSpec.agentId, {
      identity,
      promptInput,
      acceptedProposal: null,
    });
    promptInputs.push(promptInput);
  }

  return {
    world: {
      ...world,
      version: cycleVersion,
      mode: "THINKING",
      decisionCycle: {
        id: cycleId,
        baseWorldVersion: world.version,
        requestedAgentIds: orderedSpecs.map((request) => request.agentId),
        requests,
      },
      technicalFailure: null,
    },
    promptInputs,
  };
}

function identitiesMatch(expected: DecisionIdentity, actual: DecisionIdentity): boolean {
  return (
    expected.requestId === actual.requestId &&
    expected.agentId === actual.agentId &&
    expected.worldId === actual.worldId &&
    expected.worldVersion === actual.worldVersion &&
    expected.decisionCycleId === actual.decisionCycleId &&
    expected.schemaVersion === actual.schemaVersion &&
    expected.pluginLockHash === actual.pluginLockHash &&
    expected.retryOfRequestId === actual.retryOfRequestId
  );
}

export function acceptDecisionResult(
  world: WorldState,
  resultInput: ModelDecisionResult,
): DecisionAcceptanceResult {
  const parsed = ModelDecisionResultSchema.safeParse(resultInput);
  if (!parsed.success) {
    return { accepted: false, world, reason: `Invalid decision result: ${parsed.error.message}` };
  }
  const result = parsed.data;
  const cycle = world.decisionCycle;
  if (!cycle) return { accepted: false, world, reason: "No decision cycle is active" };
  const request = cycle.requests.get(result.agentId);
  if (!request || !identitiesMatch(request.identity, result)) {
    return { accepted: false, world, reason: "Decision result does not match an active request" };
  }
  if (request.acceptedProposal) {
    return { accepted: false, world, reason: `Request ${result.requestId} already has a result` };
  }
  const offered = request.promptInput.goalOptions.some(
    (option) => option.id === result.proposal.goalOptionId,
  );
  if (!offered) {
    return {
      accepted: false,
      world,
      reason: `Goal option ${result.proposal.goalOptionId} was not offered`,
    };
  }

  const requests = new Map(cycle.requests).set(result.agentId, {
    ...request,
    acceptedProposal: result.proposal,
  });
  return {
    accepted: true,
    reason: null,
    world: {
      ...world,
      version: world.version + 1,
      decisionCycle: { ...cycle, requests },
    },
  };
}
