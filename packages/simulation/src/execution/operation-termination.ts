import {
  JsonObjectSchema,
  OperationDomainFailureSchema,
} from "@god-sim/protocol";
import type {
  AgentId,
  DomainEvent,
  JsonObject,
  OperationCallId,
  OperationDomainFailure,
  OperationId,
  OperationTechnicalFailure,
} from "@god-sim/protocol";
import type { EffectProposal } from "@god-sim/plugin-sdk";

import type { ActiveOperation } from "./operation";
import {
  operationTechnicalFailure,
  validateDeclaredOperationFailure,
  validateOperationResult,
} from "./operation-failure-classifier";
import { clearActiveOperation } from "./operation-state";
import type {
  AtomicOperationTerminationPort,
  HostedOperationRuntime,
  HostedOperationRegistry,
  HostedOperationRuntimeRegistry,
  OperationRuntimeRegistry,
  OperationTerminationTransaction,
} from "./operation-runtime";
import { isOperationRuntimeCall } from "./operation-runtime";
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
  readonly failure?: OperationDomainFailure;
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

function hostedRuntimeForActiveOperation(
  world: WorldState,
  registry: OperationRuntimeRegistry,
  agentId: AgentId,
  operation: ActiveOperation,
): HostedOperationRuntime | undefined {
  const hostedRegistry = registry as OperationRuntimeRegistry &
    Partial<HostedOperationRegistry>;
  const targetEntityId = operation.arguments["targetEntityId"];
  if (typeof targetEntityId === "string") {
    const object = world.objects.get(targetEntityId as never);
    if (object) {
      return hostedRegistry.getHostedOperation?.(operation.operationId, {
        kind: "furniture",
        hostDefinitionId: object.definitionId,
      });
    }
  }
  const agent = world.agents.get(agentId);
  const definitionId = agent?.definitionId;
  return definitionId === undefined
    ? undefined
    : hostedRegistry.getHostedOperation?.(operation.operationId, {
        kind: "agent",
        hostDefinitionId: definitionId,
      });
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

export type ActiveOperationTerminationBatchRequest = ActiveOperationTerminationRequest;

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
  let candidateResult: unknown = transaction.proposal.result;
  if (transaction.outcome === "failed") {
    const catalog = runtime.domainFailures;
    const declared = catalog.every(
      (entry) => "detailsSchema" in entry && "resultSchema" in entry,
    )
      ? validateDeclaredOperationFailure(
          catalog as HostedOperationRuntime["domainFailures"],
          transaction.failure,
          transaction.proposal.result,
        )
      : validateLegacyOperationFailure(
          catalog,
          transaction.failure,
          transaction.proposal.result,
        );
    if (declared.kind === "technical_failure") return declared;
    candidateResult = declared.value.result;
  }
  const result = validateOperationResult(
    transaction.outcome === "completed"
      ? "complete"
      : transaction.outcome === "cancelled"
        ? "cancel"
        : "fail",
    runtime.resultSchema,
    candidateResult,
  );
  return result.kind === "technical_failure"
    ? result
    : { kind: "valid", result: result.value };
}

function validateLegacyOperationFailure(
  catalog: readonly { readonly code: string; readonly summary: string }[],
  failureValue: unknown,
  resultValue: unknown,
):
  | { readonly kind: "returned"; readonly value: { readonly failure: OperationDomainFailure; readonly result: JsonObject } }
  | { readonly kind: "technical_failure"; readonly failure: OperationTechnicalFailure } {
  const parsed = OperationDomainFailureSchema.safeParse(failureValue);
  if (!parsed.success) {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "protocol",
        "invalid_domain_failure",
        "A failed operation did not provide a valid domain failure.",
        false,
      ),
    };
  }
  if (!catalog.some((entry) => entry.code === parsed.data.code)) {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "protocol",
        "undeclared_domain_failure",
        `Operation returned undeclared domain failure ${parsed.data.code}.`,
        false,
      ),
    };
  }
  const details = JsonObjectSchema.safeParse(parsed.data.details);
  const result = JsonObjectSchema.safeParse(resultValue);
  if (!details.success || !result.success) {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "protocol",
        "invalid_domain_failure_payload",
        "A legacy operation returned an invalid domain failure payload.",
        false,
      ),
    };
  }
  return { kind: "returned", value: { failure: { ...parsed.data, details: details.data }, result: result.data } };
}

function commitTerminalParts(
  worldInput: WorldState,
  registry: OperationRuntimeRegistry,
  inputs: readonly TerminalCommitInput[],
  metadata?: EventMetadata,
): OperationTerminationResult {
  if (inputs.length === 0) {
    return { kind: "committed", world: worldInput, events: [] };
  }
  const seenCalls = new Set<OperationCallId>();
  for (const input of inputs) {
    const agent = worldInput.agents.get(input.agentId);
    if (!agent) {
      return failure(
        "termination_agent_missing",
        `Cannot terminate ${input.callId}: agent ${input.agentId} does not exist.`,
        false,
      );
    }
    if (seenCalls.has(input.callId)) {
      return failure(
        "termination_duplicate_call",
        `Operation ${input.callId} appears more than once in one termination batch.`,
        false,
      );
    }
    seenCalls.add(input.callId);
    if (worldInput.terminalOperationCallIds?.has(input.callId) ?? false) {
      return failure(
        "termination_already_committed",
        `Operation ${input.callId} already has a terminal result.`,
        false,
      );
    }
  }

  let committed;
  try {
    committed = commitProposal(
      worldInput,
      registry,
      { effects: inputs.flatMap((input) => input.proposal.effects) },
      metadataFor(inputs[0]!.callId, worldInput.tick, metadata),
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

  let nextWorld = committed.world;
  const events: DomainEvent[] = [...committed.events];
  const eventMetadata = metadataFor(inputs[0]!.callId, worldInput.tick, metadata);
  for (const input of inputs) {
    if (input.activeOperation) {
      const cleaned = clearActiveOperation(nextWorld, input.agentId, input.callId);
      if (cleaned.kind === "technical_failure") return cleaned;
      nextWorld = cleaned.world;
    }
    try {
      const terminated = appendDomainEvent(
        nextWorld,
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
      nextWorld = {
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
      };
      events.push(terminated.event, resultEvent.event);
    } catch (error) {
      return failure(
        "termination_event_exception",
        `Terminal event commit threw: ${error instanceof Error ? error.message : String(error)}`,
        true,
        "protocol",
      );
    }
  }
  const terminalOperationCallIds = new Set(
    nextWorld.terminalOperationCallIds ?? [],
  );
  for (const input of inputs) terminalOperationCallIds.add(input.callId);
  nextWorld = { ...nextWorld, terminalOperationCallIds };
  return { kind: "committed", world: nextWorld, events };
}

function prepareActiveTermination(
  worldInput: WorldState,
  registry: OperationRuntimeRegistry,
  request: ActiveOperationTerminationRequest,
):
  | { readonly kind: "prepared"; readonly input: TerminalCommitInput }
  | { readonly kind: "technical_failure"; readonly failure: OperationTechnicalFailure } {
  const active = worldInput.agents
    .get(request.agentId)
    ?.activeOperations.get(request.operation.callId);
  if (
    active &&
    (active.callId !== request.operation.callId ||
      active.operationId !== request.operation.operationId)
  ) {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "protocol",
        "termination_call_mismatch",
        `Operation ${request.operation.callId} does not match the active call.`,
        false,
      ),
    };
  }
  const result = terminalResultForActiveOperation(worldInput, registry, request);
  if (result.kind === "failure") {
    return { kind: "technical_failure", failure: result.failure };
  }
  if (request.outcome === "failed" && request.failure === undefined) {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "protocol",
        "missing_domain_failure",
        `Failed operation ${request.operation.callId} did not provide a typed domain failure.`,
        false,
      ),
    };
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
          failure: request.failure!,
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
  const validated = validateTerminalTransaction(
    registry,
    transaction,
    hostedRuntimeForActiveOperation(
      worldInput,
      registry,
      request.agentId,
      request.operation,
    ),
  );
  if (validated.kind === "technical_failure") return validated;
  return {
    kind: "prepared",
    input: {
      agentId: request.agentId,
      callId: request.operation.callId,
      operationId: request.operation.operationId,
      outcome: request.outcome,
      source: request.source,
      proposal: request.proposal,
      result: validated.result,
      ...(active === undefined ? {} : { activeOperation: request.operation }),
    },
  };
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
  let activeHostedRuntime: HostedOperationRuntime | undefined;
  if (active && isOperationRuntimeCall(active)) {
    try {
      activeHostedRuntime = registry.getHostedOperation(
        active.operationId,
        active.hostDefinition,
      );
    } catch (error) {
      return failure(
        "termination_runtime_lookup_exception",
        `Hosted runtime lookup threw: ${error instanceof Error ? error.message : String(error)}`,
        false,
        "configuration",
      );
    }
  }
  const validated = validateTerminalTransaction(
    registry,
    transaction,
    runtimeOverride ?? activeHostedRuntime,
  );
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
    [input],
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
  const prepared = prepareActiveTermination(worldInput, registry, request);
  if (prepared.kind === "technical_failure") return prepared;
  return commitTerminalParts(
    worldInput,
    registry,
    [prepared.input],
    metadata,
  );
}

export function commitActiveOperationTerminations(
  worldInput: WorldState,
  registry: OperationRuntimeRegistry,
  requests: readonly ActiveOperationTerminationBatchRequest[],
  metadata?: EventMetadata,
): OperationTerminationResult {
  const prepared: TerminalCommitInput[] = [];
  for (const request of requests) {
    const result = prepareActiveTermination(worldInput, registry, request);
    if (result.kind === "technical_failure") return result;
    prepared.push(result.input);
  }
  return commitTerminalParts(worldInput, registry, prepared, metadata);
}

export const atomicOperationTerminationPort: AtomicOperationTerminationPort = {
  commitTermination: commitOperationTermination,
};
