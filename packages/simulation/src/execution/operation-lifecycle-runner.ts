import {
  JsonObjectSchema,
  OperationArbitrationFailureSchema,
  OperationArbitrationFailureReasonCodeSchema,
  OperationTechnicalFailureSchema,
  type AgentId,
  type JsonObject,
  type OperationArbitrationFailure,
  type OperationDomainFailure,
  type OperationTechnicalFailure,
  type OperationTerminationSource,
} from "@god-sim/protocol";
import {
  OperationStartResultSchema,
  OperationTerminalProposalSchema,
  OperationTickResultSchema,
  validateOperationStateTransition,
  type EffectProposal,
} from "@god-sim/plugin-sdk";

import {
  invokeOperationLifecycle,
  operationInvariantFailure,
  operationTechnicalFailure,
  validateDeclaredOperationFailure,
  validateDeclaredOperationFailureInput,
  validateOperationResult,
} from "./operation-failure-classifier";
import {
  createOperationRuntimeContext,
  type HostedOperationRuntime,
  type HostedOperationRuntimeRegistry,
  type OperationRuntimeCall,
  type OperationRuntimeContext,
  type OperationTerminationTransaction,
} from "./operation-runtime";
import type { WorldState } from "../world/world-state";

export interface OperationLifecycleRunInput {
  readonly world: WorldState;
  readonly registry: HostedOperationRuntimeRegistry;
  readonly agentId: AgentId;
  readonly operation: OperationRuntimeCall;
}

export interface OperationLifecycleTechnicalFailureResult {
  readonly kind: "technical_failure";
  readonly operation: OperationRuntimeCall;
  readonly failure: OperationTechnicalFailure;
}

export type OperationLifecycleArbitrationFailureResult =
  | {
      readonly kind: "mapped";
      readonly operation: OperationRuntimeCall;
      readonly failure: OperationDomainFailure;
    }
  | OperationLifecycleTechnicalFailureResult;

export interface OperationLifecycleTransitionResult {
  readonly kind: "transition";
  readonly operation: OperationRuntimeCall;
  readonly proposal: EffectProposal;
}

export interface OperationLifecycleCompletionSignalResult {
  readonly kind: "completion_signal";
  readonly operation: OperationRuntimeCall;
}

export interface OperationLifecycleTerminationReadyResult {
  readonly kind: "termination_ready";
  readonly operation: OperationRuntimeCall;
  readonly transaction: OperationTerminationTransaction;
}

export interface OperationLifecycleNoTickResult {
  readonly kind: "no_tick";
  readonly operation: OperationRuntimeCall;
}

export type OperationStartLifecycleResult =
  | OperationLifecycleTransitionResult
  | OperationLifecycleTerminationReadyResult
  | OperationLifecycleTechnicalFailureResult;

export type OperationTickLifecycleResult =
  | OperationLifecycleTransitionResult
  | OperationLifecycleCompletionSignalResult
  | OperationLifecycleTerminationReadyResult
  | OperationLifecycleNoTickResult
  | OperationLifecycleTechnicalFailureResult;

export type OperationTerminalLifecycleResult =
  | OperationLifecycleTerminationReadyResult
  | OperationLifecycleTechnicalFailureResult;

export type OperationFuseLifecycleResult =
  | { readonly kind: "no_result"; readonly operation: OperationRuntimeCall }
  | {
      readonly kind: "result";
      readonly operation: OperationRuntimeCall;
      readonly result: JsonObject;
    }
  | OperationLifecycleTechnicalFailureResult;

interface BoundLifecycle {
  readonly runtime: HostedOperationRuntime;
  readonly context: OperationRuntimeContext;
  readonly operation: OperationRuntimeCall;
}

type BindLifecycleResult =
  | { readonly kind: "bound"; readonly binding: BoundLifecycle }
  | OperationLifecycleTechnicalFailureResult;

function technicalFailure(
  operation: OperationRuntimeCall,
  failure: OperationTechnicalFailure,
): OperationLifecycleTechnicalFailureResult {
  return { kind: "technical_failure", operation, failure };
}

function sameTaskSlots(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((track, index) => track === right[index])
  );
}

function bindLifecycle(input: OperationLifecycleRunInput): BindLifecycleResult {
  const { operation } = input;
  let runtime: HostedOperationRuntime | undefined;
  try {
    runtime = input.registry.getHostedOperation(
      operation.operationId,
      operation.hostDefinition,
    );
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    return technicalFailure(
      operation,
      operationTechnicalFailure(
        "configuration",
        "operation_runtime_lookup_exception",
        `Hosted operation runtime lookup threw: ${description}`,
        false,
      ),
    );
  }
  if (!runtime) {
    return technicalFailure(
      operation,
      operationTechnicalFailure(
        "configuration",
        "operation_runtime_unavailable",
        `No hosted runtime is registered for ${operation.operationId} on ${operation.hostDefinition.hostDefinitionId}.`,
        false,
      ),
    );
  }

  if (
    runtime.id !== operation.operationId ||
    runtime.host.kind !== operation.hostDefinition.kind ||
    runtime.host.hostDefinitionId !== operation.hostDefinition.hostDefinitionId ||
    operation.host.kind !== operation.hostDefinition.kind ||
    (operation.host.kind === "agent" &&
      operation.host.hostEntityId !== input.agentId) ||
    runtime.target.kind !== operation.target.kind ||
    runtime.duration.kind !== operation.duration.kind ||
    !sameTaskSlots(runtime.taskSlots, operation.taskSlots)
  ) {
    return technicalFailure(
      operation,
      operationInvariantFailure(
        "operation_runtime_binding_mismatch",
        `Active operation ${operation.callId} does not match its locked hosted runtime.`,
      ),
    );
  }

  let isolatedWorld: WorldState;
  let isolatedOperation: OperationRuntimeCall;
  try {
    isolatedWorld = structuredClone(input.world);
    isolatedOperation = structuredClone(operation);
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    return technicalFailure(
      operation,
      operationInvariantFailure(
        "operation_runtime_isolation_failed",
        `Could not isolate lifecycle input: ${description}`,
      ),
    );
  }

  let context: OperationRuntimeContext;
  try {
    context = createOperationRuntimeContext(
      isolatedWorld,
      input.registry,
      input.agentId,
    );
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    return technicalFailure(
      operation,
      operationInvariantFailure(
        "operation_runtime_context_invalid",
        `Could not create lifecycle context: ${description}`,
      ),
    );
  }

  let parsedState;
  let parsedArguments;
  try {
    parsedState = validateOperationStateTransition(
      runtime.stateSchema,
      isolatedOperation.state,
    );
    const argumentsResult = runtime.parametersSchema.safeParse(
      isolatedOperation.arguments,
    );
    const normalizedArguments = argumentsResult.success
      ? JsonObjectSchema.safeParse(argumentsResult.data)
      : undefined;
    if (!argumentsResult.success || !normalizedArguments?.success) {
      return technicalFailure(
        operation,
        operationInvariantFailure(
          "operation_locked_arguments_invalid",
          `Active operation ${operation.callId} has invalid locked arguments.`,
        ),
      );
    }
    parsedArguments = normalizedArguments.data;
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    return technicalFailure(
      operation,
      operationTechnicalFailure(
        "plugin",
        "operation_runtime_schema_exception",
        `Hosted operation runtime schema threw: ${description}`,
        false,
      ),
    );
  }
  if (parsedState.kind === "technical_failure") {
    return technicalFailure(operation, parsedState);
  }

  return {
    kind: "bound",
    binding: {
      runtime,
      context,
      operation: {
        ...isolatedOperation,
        arguments: parsedArguments,
        state: parsedState.state,
      },
    },
  };
}

function invalidArbitrationMappingResult(
  operation: OperationRuntimeCall,
): OperationLifecycleTechnicalFailureResult {
  return technicalFailure(
    operation,
    operationTechnicalFailure(
      "plugin",
      "arbitration_failure_mapping_invalid_result",
      "Operation arbitration failure mapping returned an invalid result.",
      false,
    ),
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

/**
 * 让 operation 自己把结构化仲裁事实映射为已声明的游戏内失败。
 * 映射在隔离上下文中执行，任何未映射或非法返回都保持为技术失败。
 */
export function mapOperationArbitrationFailure(
  input: OperationLifecycleRunInput,
  failure: OperationArbitrationFailure,
): OperationLifecycleArbitrationFailureResult {
  let parsedFailure: OperationArbitrationFailure;
  try {
    const parsed = OperationArbitrationFailureSchema.safeParse(failure);
    if (!parsed.success) return invalidArbitrationMappingResult(input.operation);
    parsedFailure = parsed.data;
  } catch {
    return invalidArbitrationMappingResult(input.operation);
  }

  const bound = bindLifecycle(input);
  if (bound.kind === "technical_failure") return bound;

  let mapped: unknown;
  try {
    mapped = bound.binding.runtime.mapArbitrationFailure(
      bound.binding.context,
      bound.binding.operation,
      parsedFailure,
    );
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    return technicalFailure(
      input.operation,
      operationTechnicalFailure(
        "plugin",
        "arbitration_failure_mapping_exception",
        `Operation arbitration failure mapping threw: ${description}`,
        true,
      ),
    );
  }

  if (typeof mapped !== "object" || mapped === null) {
    return invalidArbitrationMappingResult(input.operation);
  }
  const candidate = mapped as Record<string, unknown>;
  if (candidate["kind"] === "technical_failure") {
    const parsed = OperationTechnicalFailureSchema.safeParse(mapped);
    return parsed.success
      ? technicalFailure(input.operation, parsed.data)
      : invalidArbitrationMappingResult(input.operation);
  }
  if (candidate["kind"] === "unmapped") {
    if (!hasExactKeys(candidate, ["kind", "reasonCode"])) {
      return invalidArbitrationMappingResult(input.operation);
    }
    const reasonCode = OperationArbitrationFailureReasonCodeSchema.safeParse(
      candidate["reasonCode"],
    );
    return reasonCode.success
      ? technicalFailure(
          input.operation,
          operationTechnicalFailure(
            "protocol",
            "operation_arbitration_failure_unmapped",
            `Operation ${input.operation.operationId} did not map arbitration reason ${reasonCode.data}.`,
            false,
          ),
        )
      : invalidArbitrationMappingResult(input.operation);
  }
  if (candidate["kind"] !== "mapped") {
    return invalidArbitrationMappingResult(input.operation);
  }
  if (!hasExactKeys(candidate, ["kind", "failure"])) {
    return invalidArbitrationMappingResult(input.operation);
  }

  const validated = validateDeclaredOperationFailureInput(
    bound.binding.runtime.domainFailures,
    candidate["failure"],
  );
  if (validated.kind === "technical_failure") {
    return technicalFailure(input.operation, validated.failure);
  }
  return {
    kind: "mapped",
    operation: bound.binding.operation,
    failure: validated.value,
  };
}

function withState(
  binding: BoundLifecycle,
  stateValue: unknown,
):
  | { readonly kind: "valid"; readonly operation: OperationRuntimeCall }
  | OperationLifecycleTechnicalFailureResult {
  let validated;
  try {
    validated = validateOperationStateTransition(
      binding.runtime.stateSchema,
      stateValue,
    );
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    return technicalFailure(
      binding.operation,
      operationTechnicalFailure(
        "plugin",
        "operation_state_schema_exception",
        `Operation state schema threw: ${description}`,
        false,
      ),
    );
  }
  if (validated.kind === "technical_failure") {
    return technicalFailure(binding.operation, validated);
  }
  return {
    kind: "valid",
    operation: { ...binding.operation, state: validated.state },
  };
}

function failBoundOperation(
  input: OperationLifecycleRunInput,
  binding: BoundLifecycle,
  failureValue: OperationDomainFailure,
  source: OperationTerminationSource,
): OperationTerminalLifecycleResult {
  const declared = validateDeclaredOperationFailureInput(
    binding.runtime.domainFailures,
    failureValue,
  );
  if (declared.kind === "technical_failure") {
    return technicalFailure(input.operation, declared.failure);
  }

  const invoked = invokeOperationLifecycle(
    "fail",
    OperationTerminalProposalSchema,
    () => binding.runtime.fail(binding.context, binding.operation, declared.value),
  );
  if (invoked.kind === "technical_failure") {
    return technicalFailure(input.operation, invoked.failure);
  }
  const validated = validateDeclaredOperationFailure(
    binding.runtime.domainFailures,
    declared.value,
    invoked.value.result,
  );
  if (validated.kind === "technical_failure") {
    return technicalFailure(input.operation, validated.failure);
  }
  const overallResult = validateOperationResult(
    "fail",
    binding.runtime.resultSchema,
    validated.value.result,
  );
  if (overallResult.kind === "technical_failure") {
    return technicalFailure(input.operation, overallResult.failure);
  }
  return {
    kind: "termination_ready",
    operation: binding.operation,
    transaction: {
      agentId: input.agentId,
      callId: binding.operation.callId,
      operationId: binding.operation.operationId,
      outcome: "failed",
      failure: validated.value.failure,
      source,
      terminatedAtTick: input.world.tick,
      proposal: {
        effects: invoked.value.effects,
        result: overallResult.value,
      },
    },
  };
}

function terminalBoundOperation(
  input: OperationLifecycleRunInput,
  binding: BoundLifecycle,
  outcome: "completed" | "cancelled",
  source: OperationTerminationSource,
): OperationTerminalLifecycleResult {
  const phase = outcome === "completed" ? "complete" : "cancel";
  const invoked = invokeOperationLifecycle(
    phase,
    OperationTerminalProposalSchema,
    () =>
      outcome === "completed"
        ? binding.runtime.complete(binding.context, binding.operation)
        : binding.runtime.cancel(binding.context, binding.operation),
  );
  if (invoked.kind === "technical_failure") {
    return technicalFailure(input.operation, invoked.failure);
  }
  const result = validateOperationResult(
    phase,
    binding.runtime.resultSchema,
    invoked.value.result,
  );
  if (result.kind === "technical_failure") {
    return technicalFailure(input.operation, result.failure);
  }
  return {
    kind: "termination_ready",
    operation: binding.operation,
    transaction: {
      agentId: input.agentId,
      callId: binding.operation.callId,
      operationId: binding.operation.operationId,
      outcome,
      source,
      terminatedAtTick: input.world.tick,
      proposal: { effects: invoked.value.effects, result: result.value },
    },
  };
}

export function startOperationLifecycle(
  input: OperationLifecycleRunInput,
): OperationStartLifecycleResult {
  if (input.operation.firstStepState !== "pending") {
    return technicalFailure(
      input.operation,
      operationInvariantFailure(
        "operation_start_repeated",
        `Operation ${input.operation.callId} has already run its first step.`,
      ),
    );
  }
  const bound = bindLifecycle(input);
  if (bound.kind === "technical_failure") return bound;
  const { binding } = bound;
  const invoked = invokeOperationLifecycle(
    "start",
    OperationStartResultSchema,
    () => binding.runtime.start(binding.context, binding.operation),
  );
  if (invoked.kind === "technical_failure") {
    return technicalFailure(input.operation, invoked.failure);
  }
  if (invoked.value.kind === "technical_failure") {
    return technicalFailure(input.operation, invoked.value);
  }
  if (invoked.value.kind === "domain_failure") {
    return failBoundOperation(
      input,
      binding,
      invoked.value,
      "start_domain_failure",
    );
  }
  const transitioned = withState(binding, invoked.value.nextState);
  if (transitioned.kind === "technical_failure") return transitioned;
  return {
    kind: "transition",
    operation: {
      ...transitioned.operation,
      firstStepState: "started",
    },
    proposal: invoked.value.proposal,
  };
}

export function tickOperationLifecycle(
  input: OperationLifecycleRunInput,
): OperationTickLifecycleResult {
  if (input.operation.firstStepState !== "started") {
    return technicalFailure(
      input.operation,
      operationInvariantFailure(
        "operation_tick_before_start",
        `Operation ${input.operation.callId} cannot tick before start.`,
      ),
    );
  }
  const bound = bindLifecycle(input);
  if (bound.kind === "technical_failure") return bound;
  const { binding } = bound;
  const tick = binding.runtime.tick;
  if (!tick) {
    return { kind: "no_tick", operation: binding.operation };
  }
  const invoked = invokeOperationLifecycle(
    "tick",
    OperationTickResultSchema,
    () => tick(binding.context, binding.operation),
  );
  if (invoked.kind === "technical_failure") {
    return technicalFailure(input.operation, invoked.failure);
  }
  if (invoked.value.kind === "technical_failure") {
    return technicalFailure(input.operation, invoked.value);
  }
  if (invoked.value.kind === "domain_failure") {
    return failBoundOperation(
      input,
      binding,
      invoked.value,
      "tick_domain_failure",
    );
  }
  const transitioned = withState(binding, invoked.value.nextState);
  if (transitioned.kind === "technical_failure") return transitioned;
  return invoked.value.kind === "complete"
    ? { kind: "completion_signal", operation: transitioned.operation }
    : {
        kind: "transition",
        operation: transitioned.operation,
        proposal: invoked.value.proposal,
      };
}

export function completeOperationLifecycle(
  input: OperationLifecycleRunInput,
  source: OperationTerminationSource,
): OperationTerminalLifecycleResult {
  if (input.operation.firstStepState !== "started") {
    return technicalFailure(
      input.operation,
      operationInvariantFailure(
        "operation_complete_before_start",
        `Operation ${input.operation.callId} cannot complete before start.`,
      ),
    );
  }
  const bound = bindLifecycle(input);
  if (bound.kind === "technical_failure") return bound;
  return terminalBoundOperation(input, bound.binding, "completed", source);
}

export function failOperationLifecycle(
  input: OperationLifecycleRunInput,
  failure: OperationDomainFailure,
  source: OperationTerminationSource,
): OperationTerminalLifecycleResult {
  const bound = bindLifecycle(input);
  if (bound.kind === "technical_failure") return bound;
  return failBoundOperation(input, bound.binding, failure, source);
}

export function cancelOperationLifecycle(
  input: OperationLifecycleRunInput,
  source: OperationTerminationSource,
): OperationTerminalLifecycleResult {
  const bound = bindLifecycle(input);
  if (bound.kind === "technical_failure") return bound;
  return terminalBoundOperation(input, bound.binding, "cancelled", source);
}

export function fuseOperationLifecycle(
  input: OperationLifecycleRunInput,
): OperationFuseLifecycleResult {
  if (input.world.mode === "RUNNING") {
    return technicalFailure(
      input.operation,
      operationInvariantFailure(
        "operation_fuse_requires_frozen_world",
        `Operation ${input.operation.callId} cannot fuse while the world is running.`,
      ),
    );
  }
  const bound = bindLifecycle(input);
  if (bound.kind === "technical_failure") return bound;
  const { binding } = bound;
  const invoked = invokeOperationLifecycle(
    "fuse",
    JsonObjectSchema.nullable(),
    () => binding.runtime.fuse(binding.context, binding.operation),
  );
  if (invoked.kind === "technical_failure") {
    return technicalFailure(input.operation, invoked.failure);
  }
  if (invoked.value === null) {
    return { kind: "no_result", operation: input.operation };
  }
  const result = validateOperationResult(
    "fuse",
    binding.runtime.resultSchema,
    invoked.value,
  );
  if (result.kind === "technical_failure") {
    return technicalFailure(input.operation, result.failure);
  }
  return { kind: "result", operation: input.operation, result: result.value };
}
