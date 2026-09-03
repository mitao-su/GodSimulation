import {
  DecisionCycleIdSchema,
  DecisionPromptInputSchema,
  DecisionReasonSchema,
  EntityIdSchema,
  ModelDecisionResultSchema,
  RequestIdSchema,
  resolveTaskDecision,
  TaskOptionSchema,
  TechnicalFailureSchema,
  type AgentId,
  type DecisionIdentity,
  type DecisionPromptInput,
  type DecisionReason,
  type TaskOption,
  type ModelDecisionResult,
  type RequestId,
  type TechnicalFailure,
} from "@god-sim/protocol";

import type { AgentState, DecisionRequestState, WorldState } from "../world/world-state";

export interface DecisionRequestSpec {
  readonly agentId: AgentId;
  readonly reason: DecisionReason;
  readonly taskOptions: readonly TaskOption[];
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

function activeTasksContext(agent: AgentState): DecisionPromptInput["activeTasks"] {
  const callIdFor = (track: "HEAD" | "BODY") => {
    const state = agent.taskTracks[track];
    return state.kind === "operation" ? state.callId : null;
  };
  return {
    tracks: {
      HEAD: callIdFor("HEAD"),
      BODY: callIdFor("BODY"),
    },
    operations: [...agent.activeOperations.values()]
      .sort((left, right) => left.callId.localeCompare(right.callId))
      .map((operation) => ({
        callId: operation.callId,
        operationId: operation.operationId,
        label: operation.label,
        taskSlots: [...operation.taskSlots],
        arguments: operation.arguments,
        duration: operation.duration,
        startedAtTick: operation.startedAtTick,
        progressTicks: operation.progressTicks,
      })),
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
  taskOptions: readonly TaskOption[],
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
    activeTasks: activeTasksContext(agent),
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
    operationResults: agent.pendingOperationResults,
    taskOptions,
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
    const taskOptions = requestSpec.taskOptions.map((option) => TaskOptionSchema.parse(option));
    if (taskOptions.length === 0) {
      throw new Error(`Decision request for ${requestSpec.agentId} has no task options`);
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
      taskOptions,
    );
    requests.set(requestSpec.agentId, {
      identity,
      promptInput,
      acceptedProposal: null,
      failure: null,
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
  if (request.failure) {
    return { accepted: false, world, reason: `Request ${result.requestId} has a recorded failure` };
  }
  let normalizedProposal;
  try {
    normalizedProposal = resolveTaskDecision(
      result.proposal,
      request.promptInput.taskOptions,
    ).normalizedDecision;
  } catch (error) {
    return {
      accepted: false,
      world,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const requests = new Map(cycle.requests).set(result.agentId, {
    ...request,
    acceptedProposal: normalizedProposal,
    failure: null,
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

export function recordDecisionFailure(
  world: WorldState,
  failureValue: TechnicalFailure,
): WorldState {
  const failure = TechnicalFailureSchema.parse(failureValue);
  const requestId = failure.requestId;
  if (!requestId) throw new Error("A decision failure requires a request ID");
  const request = [...(world.decisionCycle?.requests.values() ?? [])].find(
    (candidate) => candidate.identity.requestId === requestId,
  );
  if (!request) throw new Error(`Decision failure targets inactive request ${requestId}`);
  if (request.acceptedProposal !== null) {
    throw new Error(`Decision failure targets completed request ${requestId}`);
  }
  const cycle = world.decisionCycle!;
  const requests = new Map(cycle.requests).set(request.identity.agentId, {
    ...request,
    failure,
  });
  return {
    ...world,
    version: world.version + 1,
    mode: "TECHNICALLY_BLOCKED",
    suspendedMode:
      world.mode === "TECHNICALLY_BLOCKED" ? world.suspendedMode : world.mode,
    decisionCycle: { ...cycle, requests },
    technicalFailure: world.technicalFailure ?? failure,
  };
}

export function retryDecisionRequest(world: WorldState, requestId: RequestId): WorldState {
  const cycle = world.decisionCycle;
  if (!cycle) {
    throw new Error(`Request ${requestId} has no active technical failure`);
  }
  const entry = [...cycle.requests.entries()].find(
    ([, request]) => request.identity.requestId === requestId,
  );
  if (!entry) throw new Error(`Decision request ${requestId} is no longer active`);
  const [agentId, request] = entry;
  const failure = request.failure;
  if (!failure) throw new Error(`Request ${requestId} has no active technical failure`);
  if (!failure.retryable) throw new Error(`Failure for ${requestId} is not retryable`);
  const nextVersion = world.version + 1;
  const nextRequestId = RequestIdSchema.parse(`decision-request:${nextVersion}:retry`);
  const identity: DecisionIdentity = {
    ...request.identity,
    requestId: nextRequestId,
    worldVersion: world.version,
    retryOfRequestId: requestId,
  };
  const promptInput = DecisionPromptInputSchema.parse({
    ...request.promptInput,
    ...identity,
  });
  const requests = new Map(cycle.requests).set(agentId, {
    identity,
    promptInput,
    acceptedProposal: null,
    failure: null,
  });
  const remainingDecisionFailure = cycle.requestedAgentIds
    .map((requestedAgentId) => requests.get(requestedAgentId)?.failure ?? null)
    .find((candidate) => candidate !== null) ?? null;
  const blockingFailure =
    world.technicalFailure?.category !== "model"
      ? world.technicalFailure
      : remainingDecisionFailure;
  return {
    ...world,
    version: nextVersion,
    mode: blockingFailure ? "TECHNICALLY_BLOCKED" : "THINKING",
    suspendedMode: blockingFailure
      ? world.suspendedMode ?? (world.mode === "TECHNICALLY_BLOCKED" ? "THINKING" : world.mode)
      : null,
    decisionCycle: { ...cycle, requests },
    technicalFailure: blockingFailure,
  };
}
