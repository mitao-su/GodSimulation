import {
  JsonObjectSchema,
  type AgentId,
  type DomainEvent,
  type JsonObject,
  type OperationDomainFailure,
  type OperationResultContext,
} from "@god-sim/protocol";
import type { EffectProposal } from "@god-sim/plugin-sdk";

import type { ActiveOperation, OperationObservation } from "./operation";
import {
  createOperationRuntimeContext,
  isOperationRuntimeCall,
  type HostedOperationRegistry,
  type HostedOperationRuntimeRegistry,
  type OperationRuntimeRegistry,
} from "./operation-runtime";
import { fuseOperationLifecycle } from "./operation-lifecycle-runner";
import { commitActiveOperationTermination } from "./operation-termination";
import {
  OperationTechnicalFailureError,
  operationTechnicalFailure,
} from "./operation-failure-classifier";
import { appendDomainEvent, type EventMetadata } from "../engine/event-writer";
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
  registry: OperationRuntimeRegistry,
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
  // Only a direct interaction — where the interaction IS the top-level
  // operation — may contribute its lifecycle result to the terminal
  // operation_result. Automatic traversal is a private micro-step of the
  // enclosing operation (move); the traversal interaction speaks a
  // different result protocol, so the enclosing operation explicitly
  // ignores it and produces its own terminal result instead.
  return {
    effects: proposed.proposal.effects,
    result: action.purpose === "direct" ? proposed.result : null,
  };
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
  registry: OperationRuntimeRegistry,
  agentId: AgentId,
  operation: ActiveOperation,
  outcome: "completed" | "failed" | "cancelled",
  reasonCode: string,
  metadata: EventMetadata,
  resultOverride?: JsonObject,
  proposal?: EffectProposal,
  failure?: OperationDomainFailure,
): { readonly world: WorldState; readonly events: readonly DomainEvent[] } {
  // 旧 action/release 管线在收集终止项时已从 activeOperations 移除调用。
  // 先把调用放回局部候选世界，才能让清理与失败回滚都经过同一原子入口；
  // 成功提交随后会再次由终止事务移除它。
  const currentAgent = worldInput.agents.get(agentId);
  const terminationWorld =
    currentAgent && !currentAgent.activeOperations.has(operation.callId)
      ? {
          ...worldInput,
          agents: new Map(worldInput.agents).set(agentId, {
            ...currentAgent,
            activeOperations: new Map(currentAgent.activeOperations).set(
              operation.callId,
              operation,
            ),
          }),
        }
      : worldInput;
  const committed = commitActiveOperationTermination(
    terminationWorld,
    registry,
    {
      agentId,
      operation,
      outcome,
      source: reasonCode,
      ...(failure === undefined ? {} : { failure }),
      proposal: proposal ?? { effects: [] },
      ...(resultOverride === undefined ? {} : { resultOverride }),
    },
    metadata,
  );
  if (committed.kind === "technical_failure") {
    throw new OperationTechnicalFailureError(committed.failure);
  }
  return committed;
}

export function recordFuseResults(
  worldInput: WorldState,
  registry: OperationRuntimeRegistry & Partial<HostedOperationRegistry>,
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
      if (isOperationRuntimeCall(operation)) {
        if (!registry.getHostedOperation) {
          throw new OperationTechnicalFailureError(
            operationTechnicalFailure(
              "configuration",
              "hosted_operation_registry_unavailable",
              `Hosted operation ${operation.operationId} cannot be fused without a hosted registry.`,
              false,
            ),
          );
        }
        const fused = fuseOperationLifecycle({
          world,
          registry: registry as HostedOperationRuntimeRegistry,
          agentId,
          operation,
        });
        if (fused.kind === "technical_failure") {
          throw new OperationTechnicalFailureError(fused.failure);
        }
        if (fused.kind === "no_result") continue;
        const written = appendResult(
          world,
          agentId,
          fused.operation as unknown as ActiveOperation,
          false,
          null,
          "world_fused",
          fused.result,
          metadata,
        );
        world = written.world;
        events.push(written.event);
        continue;
      }
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
  registry: OperationRuntimeRegistry,
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
