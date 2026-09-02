import {
  JsonObjectSchema,
  type AgentId,
  type DomainEvent,
  type JsonObject,
  type OperationResultContext,
} from "@god-sim/protocol";
import type { EffectProposal } from "@god-sim/plugin-sdk";

import type { ActiveOperation, OperationObservation } from "./operation";
import { createOperationRuntimeContext } from "./operation-runtime";
import { appendDomainEvent, type EventMetadata } from "../engine/event-writer";
import type { SimulationRegistry } from "../engine/simulation-registry";
import { proposeInteraction } from "../interaction/interaction-router";
import type { WorldState } from "../world/world-state";

function operationParameters(operation: ActiveOperation): JsonObject {
  const value = operation.arguments["parameters"];
  return JsonObjectSchema.parse(
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? value
      : {},
  );
}

export function operationInteractionLifecycleProposal(
  world: WorldState,
  registry: SimulationRegistry,
  agentId: AgentId,
  operation: ActiveOperation,
  phase: "cancel" | "fail",
  failureCode?: string,
): EffectProposal & { readonly result: JsonObject | null } {
  const action = operation.plan.actions[operation.plan.currentActionIndex];
  if (
    !action ||
    action.kind !== "interact_object" ||
    (phase === "cancel" && !action.started)
  ) {
    return { effects: [], result: null };
  }
  const proposed = proposeInteraction(world, registry, {
    agentId,
    entityId: action.targetEntityId,
    interactionId: action.interactionId,
    parameters:
      action.purpose === "direct" ? operationParameters(operation) : {},
    phase,
    ...(failureCode === undefined ? {} : { failureCode }),
  });
  if (!proposed.accepted) {
    throw new Error(
      `Operation ${phase} lifecycle ${operation.callId} was rejected: ${proposed.reasonCode}: ${proposed.summary}`,
    );
  }
  return { effects: proposed.proposal.effects, result: proposed.result };
}

function appendResult(
  worldInput: WorldState,
  agentId: AgentId,
  operation: ActiveOperation,
  terminal: boolean,
  outcome: "completed" | "failed" | "cancelled" | null,
  reasonCode: string,
  result: JsonObject,
  metadata: EventMetadata,
): { readonly world: WorldState; readonly event: DomainEvent } {
  const written = appendDomainEvent(
    worldInput,
    {
      type: "operation_result",
      agentId,
      callId: operation.callId,
      operationId: operation.operationId,
      terminal,
      outcome,
      reasonCode,
      result,
    },
    metadata,
  );
  const agent = written.world.agents.get(agentId);
  if (!agent) throw new Error(`Operation result targets unknown agent ${agentId}`);
  const context: OperationResultContext = {
    callId: operation.callId,
    operationId: operation.operationId,
    terminal,
    outcome,
    reasonCode,
    result,
    emittedAtTick: written.world.tick,
  };
  return {
    world: {
      ...written.world,
      agents: new Map(written.world.agents).set(agentId, {
        ...agent,
        pendingOperationResults: [...agent.pendingOperationResults, context],
      }),
    },
    event: written.event,
  };
}

export function recordOperationTermination(
  worldInput: WorldState,
  registry: SimulationRegistry,
  agentId: AgentId,
  operation: ActiveOperation,
  outcome: "completed" | "failed" | "cancelled",
  reasonCode: string,
  metadata: EventMetadata,
  resultOverride?: JsonObject,
): { readonly world: WorldState; readonly events: readonly DomainEvent[] } {
  const runtime = registry.getOperation(operation.operationId);
  if (!runtime) {
    throw new Error(`Operation ${operation.operationId} is not registered`);
  }
  const context = createOperationRuntimeContext(worldInput, registry, agentId);
  const candidate =
    resultOverride === undefined
      ? runtime.terminalResult(context, operation, outcome)
      : resultOverride;
  const result =
    candidate === null
      ? {}
      : JsonObjectSchema.parse(runtime.resultSchema.parse(candidate));
  const terminated = appendDomainEvent(
    worldInput,
    {
      type: "operation_terminated",
      agentId,
      callId: operation.callId,
      operationId: operation.operationId,
      outcome,
      reasonCode,
    },
    metadata,
  );
  const receipt = appendResult(
    terminated.world,
    agentId,
    operation,
    true,
    outcome,
    reasonCode,
    result,
    metadata,
  );
  return {
    world: receipt.world,
    events: [terminated.event, receipt.event],
  };
}

export function recordFuseResults(
  worldInput: WorldState,
  registry: SimulationRegistry,
  agentIds: readonly AgentId[],
  metadata: EventMetadata,
): { readonly world: WorldState; readonly events: readonly DomainEvent[] } {
  let world = worldInput;
  const events: DomainEvent[] = [];
  for (const agentId of [...new Set(agentIds)].sort((left, right) =>
    left.localeCompare(right),
  )) {
    const agent = world.agents.get(agentId);
    if (!agent) throw new Error(`Cannot fuse unknown agent ${agentId}`);
    for (const operation of [...agent.activeOperations.values()].sort(
      (left, right) => left.callId.localeCompare(right.callId),
    )) {
      const runtime = registry.getOperation(operation.operationId);
      if (!runtime) {
        throw new Error(`Operation ${operation.operationId} is not registered`);
      }
      const context = createOperationRuntimeContext(world, registry, agentId);
      const candidate = runtime.fuse(context, operation);
      if (candidate === null) continue;
      const result = JsonObjectSchema.parse(runtime.resultSchema.parse(candidate));
      const written = appendResult(
        world,
        agentId,
        operation,
        false,
        null,
        "world_fused",
        result,
        metadata,
      );
      world = written.world;
      events.push(written.event);
    }
  }
  return { world, events };
}

export function accumulateOperationObservations(
  world: WorldState,
  registry: SimulationRegistry,
  agentId: AgentId,
  observations: readonly OperationObservation[],
): WorldState {
  if (observations.length === 0) return world;
  const agent = world.agents.get(agentId);
  if (!agent) throw new Error(`Cannot record observations for unknown agent ${agentId}`);
  let changed = false;
  const activeOperations = new Map(agent.activeOperations);
  for (const operation of agent.activeOperations.values()) {
    const runtime = registry.getOperation(operation.operationId);
    if (!runtime?.accumulateObservations) continue;
    const updated = runtime.accumulateObservations(operation, observations);
    activeOperations.set(operation.callId, updated);
    changed ||= updated !== operation;
  }
  if (!changed) return world;
  return {
    ...world,
    agents: new Map(world.agents).set(agentId, {
      ...agent,
      activeOperations,
    }),
  };
}
