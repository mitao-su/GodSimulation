import {
  JsonObjectSchema,
  type AgentId,
  type DomainEvent,
  type OperationTechnicalFailure,
  type OperationCallId,
} from "@god-sim/protocol";

import type { ActiveOperation } from "./operation";
import {
  operationTechnicalFailure,
  validateOperationResult,
} from "./operation-failure-classifier";
import {
  clearActiveOperation,
} from "./operation-state";
import type {
  AtomicOperationTerminationPort,
  HostedOperationRuntimeRegistry,
  OperationTerminationTransaction,
} from "./operation-runtime";
import { appendDomainEvent, type EventMetadata } from "../engine/event-writer";
import { commitProposal } from "../interaction/effect-committer";
import type { WorldState } from "../world/world-state";

export type OperationTerminationResult =
  | {
      readonly kind: "committed";
      readonly world: WorldState;
      readonly events: readonly DomainEvent[];
    }
  | {
      readonly kind: "technical_failure";
      readonly failure: OperationTechnicalFailure;
    };

function metadataFor(
  transaction: OperationTerminationTransaction,
  metadata?: EventMetadata,
): EventMetadata {
  return (
    metadata ?? {
      causationId: `${transaction.callId}:termination:${transaction.terminatedAtTick}`,
      correlationId: transaction.callId,
    }
  );
}

function failure(
  code: string,
  message: string,
  retryable = true,
  category: OperationTechnicalFailure["category"] = "protocol",
): OperationTerminationResult {
  return {
    kind: "technical_failure",
    failure: operationTechnicalFailure(category, code, message, retryable),
  };
}

function activeOperation(
  world: WorldState,
  agentId: AgentId,
  callId: OperationCallId,
): ActiveOperation | undefined {
  return world.agents.get(agentId)?.activeOperations.get(callId);
}

/**
 * 原子提交终止提案并移除活动调用。
 *
 * 先在输入世界上评估提案，效果、调用清理和两个终态事件全部成功前
 * 都只保留局部结果。效果被拒绝或抛错时，调用方世界保持不变且可重试。
 */
export function commitOperationTermination(
  worldInput: WorldState,
  registry: HostedOperationRuntimeRegistry,
  transaction: OperationTerminationTransaction,
  metadata?: EventMetadata,
): OperationTerminationResult {
  const agent = worldInput.agents.get(transaction.agentId);
  if (!agent) {
    return failure(
      "termination_agent_missing",
      `Cannot terminate ${transaction.callId}: agent ${transaction.agentId} does not exist.`,
      false,
    );
  }

  if (
    agent.pendingOperationResults.some(
      (result) => result.callId === transaction.callId && result.terminal,
    )
  ) {
    return failure(
      "termination_already_committed",
      `Operation ${transaction.callId} already has a terminal result.`,
      false,
    );
  }

  const operation = activeOperation(
    worldInput,
    transaction.agentId,
    transaction.callId,
  );
  if (operation && operation.operationId !== transaction.operationId) {
    return failure(
      "termination_operation_mismatch",
      `Operation ${transaction.callId} is ${operation.operationId}, not ${transaction.operationId}.`,
      false,
    );
  }

  const runtime = registry.getOperation(transaction.operationId);
  if (!runtime) {
    return failure(
      "termination_runtime_missing",
      `No runtime is registered for ${transaction.operationId}.`,
      false,
    );
  }

  if (transaction.outcome === "failed") {
    const declaration = runtime.domainFailures.find(
      (candidate) => candidate.code === transaction.failure.code,
    );
    if (!declaration) {
      return failure(
        "undeclared_domain_failure",
        `Operation returned undeclared domain failure ${transaction.failure.code}.`,
        false,
      );
    }
  }

  const result = validateOperationResult(
    transaction.outcome === "completed" ? "complete" : transaction.outcome === "cancelled" ? "cancel" : "fail",
    runtime.resultSchema,
    transaction.proposal.result,
  );
  if (result.kind === "technical_failure") {
    return { kind: "technical_failure", failure: result.failure };
  }

  let committed;
  try {
    committed = commitProposal(
      worldInput,
      registry,
      { effects: transaction.proposal.effects },
      metadataFor(transaction, metadata),
    );
  } catch (error) {
    return failure(
      "termination_effect_exception",
      `Terminal effect commit threw: ${error instanceof Error ? error.message : String(error)}`,
      true,
      "plugin",
    );
  }
  if (!committed.accepted) {
    return failure(
      "termination_effect_rejected",
      `Terminal effect commit was rejected (${committed.reason.code}): ${committed.reason.message}`,
      true,
      "plugin",
    );
  }

  const cleaned = operation
    ? clearActiveOperation(
        committed.world,
        transaction.agentId,
        transaction.callId,
      )
    : { kind: "cleaned" as const, world: committed.world };
  if (cleaned.kind === "technical_failure") return cleaned;

  const eventMetadata = metadataFor(transaction, metadata);
  try {
    const terminated = appendDomainEvent(
      cleaned.world,
      {
        type: "operation_terminated",
        agentId: transaction.agentId,
        callId: transaction.callId,
        operationId: transaction.operationId,
        outcome: transaction.outcome,
        reasonCode: transaction.source,
      },
      eventMetadata,
    );
    const resultEvent = appendDomainEvent(
      terminated.world,
      {
        type: "operation_result",
        agentId: transaction.agentId,
        callId: transaction.callId,
        operationId: transaction.operationId,
        terminal: true,
        outcome: transaction.outcome,
        reasonCode: transaction.source,
        result: JsonObjectSchema.parse(result.value),
      },
      eventMetadata,
    );
    const resultContext = {
      callId: transaction.callId,
      operationId: transaction.operationId,
      terminal: true,
      outcome: transaction.outcome,
      reasonCode: transaction.source,
      result: JsonObjectSchema.parse(result.value),
      emittedAtTick: resultEvent.world.tick,
    } as const;
    const resultAgent = resultEvent.world.agents.get(transaction.agentId);
    if (!resultAgent) {
      return failure(
        "termination_agent_missing",
        `Agent ${transaction.agentId} disappeared while recording termination.`,
        false,
      );
    }
    return {
      kind: "committed",
      world: {
        ...resultEvent.world,
        agents: new Map(resultEvent.world.agents).set(transaction.agentId, {
          ...resultAgent,
          pendingOperationResults: [
            ...resultAgent.pendingOperationResults,
            resultContext,
          ],
        }),
      },
      events: [...committed.events, terminated.event, resultEvent.event],
    };
  } catch (error) {
    return failure(
      "termination_event_exception",
      `Terminal event commit threw: ${error instanceof Error ? error.message : String(error)}`,
      true,
      "protocol",
    );
  }
}

export const atomicOperationTerminationPort: AtomicOperationTerminationPort = {
  commitTermination: commitOperationTermination,
};
