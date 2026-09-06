import type {
  AgentId,
  DomainEvent,
  JsonObject,
  OperationCallId,
  OperationId,
  OperationTechnicalFailure,
} from "@god-sim/protocol";
import type { EffectProposal } from "@god-sim/plugin-sdk";

import type { ActiveOperation } from "./operation";
import { operationTechnicalFailure, validateOperationResult } from "./operation-failure-classifier";
import { clearActiveOperation } from "./operation-state";
import type {
  AtomicOperationTerminationPort,
  HostedOperationRuntime,
  HostedOperationRuntimeRegistry,
  OperationRuntimeRegistry,
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

export interface ActiveOperationTerminationRequest {
  readonly agentId: AgentId;
  readonly operation: ActiveOperation;
  readonly outcome: "completed" | "failed" | "cancelled";
  readonly source: string;
  readonly failureCode?: string;
  readonly proposal: EffectProposal;
  readonly resultOverride?: JsonObject;
}

function metadataFor(
  callId: OperationCallId,
  terminatedAtTick: number,
  metadata?: EventMetadata,
): EventMetadata {
  return (
    metadata ?? {
      causationId: `${callId}:termination:${terminatedAtTick}`,
      correlationId: callId,
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

function terminalResultForActiveOperation(
  world: WorldState,
  registry: OperationRuntimeRegistry,
  request: ActiveOperationTerminationRequest,
):
  | { readonly kind: "value"; readonly value: JsonObject }
  | { readonly kind: "failure"; readonly failure: OperationTechnicalFailure } {
  const runtime = registry.getOperation(request.operation.operationId);
  if (!runtime) {
    return {
      kind: "failure",
      failure: operationTechnicalFailure(
        "configuration",
        "termination_runtime_missing",
        `No runtime is registered for ${request.operation.operationId}.`,
        false,
      ),
    };
  }
  let candidate: unknown;
  try {
    candidate =
      request.resultOverride ??
      runtime.terminalResult(
        { world, registry, agentId: request.agentId },
        request.operation,
        request.outcome,
      );
  } catch (error) {
    return {
      kind: "failure",
      failure: operationTechnicalFailure(
        "plugin",
        "termination_result_exception",
        `Terminal result generation threw: ${error instanceof Error ? error.message : String(error)}`,
        true,
      ),
    };
  }
  const validated = validateOperationResult(
    request.outcome === "completed"
      ? "complete"
      : request.outcome === "cancelled"
        ? "cancel"
        : "fail",
    runtime.resultSchema,
    candidate ?? {},
  );
  return validated.kind === "technical_failure"
    ? { kind: "failure", failure: validated.failure }
    : { kind: "value", value: validated.value };
}

interface TerminalCommitInput {
  readonly agentId: AgentId;
  readonly callId: OperationCallId;
  readonly operationId: OperationId;
  readonly activeOperation?: ActiveOperation;
  readonly outcome: "completed" | "failed" | "cancelled";
  readonly source: string;
  readonly proposal: EffectProposal;
  readonly result: JsonObject;
}

function validateTerminalTransaction(
  registry: OperationRuntimeRegistry,
  transaction: OperationTerminationTransaction,
  runtimeOverride?: HostedOperationRuntime,
):
  | { readonly kind: "valid"; readonly result: JsonObject }
  | { readonly kind: "technical_failure"; readonly failure: OperationTechnicalFailure } {
  const runtime = runtimeOverride ?? registry.getOperation(transaction.operationId);
  if (!runtime) {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "configuration",
        "termination_runtime_missing",
        `No runtime is registered for ${transaction.operationId}.`,
        false,
      ),
    };
  }
  if (transaction.outcome === "failed") {
    const declaration = runtime.domainFailures.find(
      (candidate) => candidate.code === transaction.failure.code,
    );
    if (!declaration) {
      return {
        kind: "technical_failure",
        failure: operationTechnicalFailure(
          "protocol",
          "undeclared_domain_failure",
          `Operation returned undeclared domain failure ${transaction.failure.code}.`,
          false,
        ),
      };
    }
  }
  const result = validateOperationResult(
    transaction.outcome === "completed"
      ? "complete"
      : transaction.outcome === "cancelled"
        ? "cancel"
        : "fail",
    runtime.resultSchema,
    transaction.proposal.result,
  );
  return result.kind === "technical_failure"
    ? result
    : { kind: "valid", result: result.value };
}

function commitTerminalParts(
  worldInput: WorldState,
  registry: OperationRuntimeRegistry,
  input: TerminalCommitInput,
  metadata?: EventMetadata,
): OperationTerminationResult {
  const agent = worldInput.agents.get(input.agentId);
  if (!agent) {
    return failure(
      "termination_agent_missing",
      `Cannot terminate ${input.callId}: agent ${input.agentId} does not exist.`,
      false,
    );
  }
  if (
    agent.pendingOperationResults.some(
      (result) => result.callId === input.callId && result.terminal,
    )
  ) {
    return failure(
      "termination_already_committed",
      `Operation ${input.callId} already has a terminal result.`,
      false,
    );
  }

  let committed;
  try {
    committed = commitProposal(
      worldInput,
      registry,
      { effects: input.proposal.effects },
      metadataFor(input.callId, worldInput.tick, metadata),
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

  const cleaned = input.activeOperation
    ? clearActiveOperation(committed.world, input.agentId, input.callId)
    : { kind: "cleaned" as const, world: committed.world };
  if (cleaned.kind === "technical_failure") return cleaned;

  const eventMetadata = metadataFor(input.callId, worldInput.tick, metadata);
  try {
    const terminated = appendDomainEvent(
      cleaned.world,
      {
        type: "operation_terminated",
        agentId: input.agentId,
        callId: input.callId,
        operationId: input.operationId,
        outcome: input.outcome,
        reasonCode: input.source,
      },
      eventMetadata,
    );
    const resultEvent = appendDomainEvent(
      terminated.world,
      {
        type: "operation_result",
        agentId: input.agentId,
        callId: input.callId,
        operationId: input.operationId,
        terminal: true,
        outcome: input.outcome,
        reasonCode: input.source,
        result: input.result,
      },
      eventMetadata,
    );
    const resultAgent = resultEvent.world.agents.get(input.agentId);
    if (!resultAgent) {
      return failure(
        "termination_agent_missing",
        `Agent ${input.agentId} disappeared while recording termination.`,
        false,
      );
    }
    return {
      kind: "committed",
      world: {
        ...resultEvent.world,
        agents: new Map(resultEvent.world.agents).set(input.agentId, {
          ...resultAgent,
          pendingOperationResults: [
            ...resultAgent.pendingOperationResults,
            {
              callId: input.callId,
              operationId: input.operationId,
              terminal: true,
              outcome: input.outcome,
              reasonCode: input.source,
              result: input.result,
              emittedAtTick: resultEvent.world.tick,
            },
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

/**
 * W1-IF hosted termination port. The lifecycle runner has already validated
 * the operation definition, failure catalogue and result schema; this method
 * only commits the terminal effects and result atomically.
 */
export function commitOperationTermination(
  worldInput: WorldState,
  registry: HostedOperationRuntimeRegistry,
  transaction: OperationTerminationTransaction,
  metadata?: EventMetadata,
  runtimeOverride?: HostedOperationRuntime,
): OperationTerminationResult {
  const active = worldInput.agents
    .get(transaction.agentId)
    ?.activeOperations.get(transaction.callId);
  if (active && active.operationId !== transaction.operationId) {
    return failure(
      "termination_operation_mismatch",
      `Operation ${transaction.callId} is ${active.operationId}, not ${transaction.operationId}.`,
      false,
    );
  }
  const validated = validateTerminalTransaction(registry, transaction, runtimeOverride);
  if (validated.kind === "technical_failure") return validated;
  const input: TerminalCommitInput = {
    agentId: transaction.agentId,
    callId: transaction.callId,
    operationId: transaction.operationId,
    outcome: transaction.outcome,
    source: transaction.source,
    proposal: transaction.proposal,
    result: validated.result,
    ...(active === undefined ? {} : { activeOperation: active }),
  };
  return commitTerminalParts(
    worldInput,
    registry,
    input,
    metadata,
  );
}

/** The compatibility bridge used by the existing ActiveOperation pipeline. */
export function commitActiveOperationTermination(
  worldInput: WorldState,
  registry: OperationRuntimeRegistry,
  request: ActiveOperationTerminationRequest,
  metadata?: EventMetadata,
): OperationTerminationResult {
  const active = worldInput.agents
    .get(request.agentId)
    ?.activeOperations.get(request.operation.callId);
  if (active &&
    (active.callId !== request.operation.callId ||
      active.operationId !== request.operation.operationId)) {
    return failure(
      "termination_call_missing",
      `Operation ${request.operation.callId} is not active for ${request.agentId}.`,
      false,
    );
  }
  const result = terminalResultForActiveOperation(worldInput, registry, request);
  if (result.kind === "failure") {
    return { kind: "technical_failure", failure: result.failure };
  }
  const transaction: OperationTerminationTransaction =
    request.outcome === "failed"
      ? {
          agentId: request.agentId,
          callId: request.operation.callId,
          operationId: request.operation.operationId,
          outcome: "failed",
          source: request.source,
          terminatedAtTick: worldInput.tick,
          failure: {
            kind: "domain_failure",
            code: (request.failureCode ?? request.source) as never,
            details: {},
          },
          proposal: { effects: request.proposal.effects, result: result.value },
        }
      : {
          agentId: request.agentId,
          callId: request.operation.callId,
          operationId: request.operation.operationId,
          outcome: request.outcome,
          source: request.source,
          terminatedAtTick: worldInput.tick,
          proposal: { effects: request.proposal.effects, result: result.value },
        };
  const validated = validateTerminalTransaction(registry, transaction);
  if (validated.kind === "technical_failure") return validated;
  return commitTerminalParts(
    worldInput,
    registry,
    {
      agentId: request.agentId,
      callId: request.operation.callId,
      operationId: request.operation.operationId,
      outcome: request.outcome,
      source: request.source,
      proposal: request.proposal,
      result: validated.result,
      ...(active === undefined ? {} : { activeOperation: request.operation }),
    },
    metadata,
  );
}

export const atomicOperationTerminationPort: AtomicOperationTerminationPort = {
  commitTermination: commitOperationTermination,
};
