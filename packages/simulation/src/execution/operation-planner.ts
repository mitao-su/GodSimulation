import {
  JsonObjectSchema,
  OperationDurationSchema,
  mergeTaskOptionArguments,
  type DirectOperationReference,
  type AgentId,
  type JsonObject,
  type OperationCallId,
  type OperationTechnicalFailure,
  type TaskOption,
} from "@god-sim/protocol";

import type { ActiveOperation } from "./operation";
import {
  createOperationRuntimeContext,
  type HostedOperationRuntimeRegistry,
  type OperationRuntimeCall,
  type OperationReferenceRejectionCode,
  type OperationRuntimeRegistry,
} from "./operation-runtime";
import type { WorldState } from "../world/world-state";

export type PrepareOperationResult =
  | { readonly kind: "prepared"; readonly operation: ActiveOperation }
  | {
      readonly kind: "blocked";
      readonly reasonCode: string;
      readonly summary: string;
    };

export type PrepareDirectOperationResult =
  | {
      readonly kind: "prepared";
      readonly operation: OperationRuntimeCall;
    }
  | {
      readonly kind: "invalid_reference";
      readonly code: OperationReferenceRejectionCode;
      readonly message: string;
    }
  | {
      readonly kind: "technical_failure";
      readonly failure: OperationTechnicalFailure;
    };

function directPreparationFailure(error: unknown): OperationTechnicalFailure {
  const message =
    error instanceof Error
      ? error.message
      : "Operation preparation failed with an unknown plugin error.";
  return {
    kind: "technical_failure",
    category: "plugin",
    code: "operation_preparation_failed",
    message: message.slice(0, 2_000),
    retryable: false,
  };
}

function sameTracks(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((track, index) => track === right[index])
  );
}

export function prepareOperationCall(
  world: WorldState,
  registry: OperationRuntimeRegistry,
  agentId: AgentId,
  optionValue: Extract<TaskOption, { kind: "operation" }>,
  argumentsInput: JsonObject,
  callId: OperationCallId,
): PrepareOperationResult {
  const option = optionValue;
  const runtime = registry.getOperation(option.operationId);
  if (!runtime) {
    return {
      kind: "blocked",
      reasonCode: "unknown_operation",
      summary: `Operation ${option.operationId} is not registered`,
    };
  }
  if (!sameTracks(option.taskSlots, runtime.taskSlots)) {
    throw new Error(
      `Task option ${option.id} does not match operation ${option.operationId} task slots`,
    );
  }

  const context = createOperationRuntimeContext(world, registry, agentId);
  const merged = mergeTaskOptionArguments(
    option,
    JsonObjectSchema.parse(argumentsInput),
  );
  const parsed = runtime.argumentsSchema(context).safeParse(merged);
  if (!parsed.success) {
    return {
      kind: "blocked",
      reasonCode: "invalid_arguments",
      summary: parsed.error.message,
    };
  }
  const argumentsValue = JsonObjectSchema.parse(parsed.data);
  const availability = runtime.canStart(context, argumentsValue);
  if (!availability.available) {
    return {
      kind: "blocked",
      reasonCode: availability.reasonCode,
      summary: availability.summary,
    };
  }
  const duration = OperationDurationSchema.parse(
    runtime.resolveDuration(context, argumentsValue),
  );
  const planned = runtime.createPlan(
    context,
    argumentsValue,
    callId,
    duration,
  );
  if (planned.kind === "blocked") return planned;

  return {
    kind: "prepared",
    operation: {
      callId,
      operationId: runtime.id,
      taskOptionId: option.id,
      label: option.label,
      taskSlots: runtime.taskSlots,
      arguments: argumentsValue,
      duration,
      startedAtTick: world.tick,
      progressTicks: 0,
      state: runtime.initialState(context, argumentsValue),
      plan: planned.plan,
    },
  };
}

/**
 * 直接引用的唯一创建入口。这里只做协议绑定和调用级不变量初始化：
 * 世界前置条件必须留给首个执行步骤的 hosted runtime.start。
 */
export function prepareDirectOperationCall(
  world: WorldState,
  registry: HostedOperationRuntimeRegistry,
  agentId: AgentId,
  track: Parameters<HostedOperationRuntimeRegistry["resolveOperationReference"]>[1],
  reference: DirectOperationReference,
  callId: OperationCallId,
): PrepareDirectOperationResult {
  if (!world.agents.has(agentId)) {
    return {
      kind: "invalid_reference",
      code: "unknown_host",
      message: `Acting agent ${agentId} does not exist`,
    };
  }
  const context = createOperationRuntimeContext(world, registry, agentId);
  let resolved: ReturnType<typeof registry.resolveOperationReference>;
  try {
    resolved = registry.resolveOperationReference(context, track, reference);
  } catch (error) {
    return { kind: "technical_failure", failure: directPreparationFailure(error) };
  }
  if (resolved.kind === "invalid_reference") return resolved;

  try {
    const { runtime, host, target, arguments: argumentsValue } = resolved.binding;
    const duration = OperationDurationSchema.parse(
      runtime.resolveDuration(context, host, argumentsValue),
    );
    if (duration.kind !== runtime.duration.kind) {
      throw new Error(
        `Operation ${runtime.id} resolved ${duration.kind} duration despite declaring ${runtime.duration.kind}`,
      );
    }
    const state = JsonObjectSchema.parse(
      runtime.stateSchema.parse(
        runtime.initialState(context, host, argumentsValue),
      ),
    );

    return {
      kind: "prepared",
      operation: {
        callId,
        operationId: runtime.id,
        host,
        hostDefinition: runtime.host,
        target,
        taskSlots: runtime.taskSlots,
        arguments: argumentsValue,
        duration,
        startedAtTick: world.tick,
        progressTicks: 0,
        firstStepState: "pending",
        state,
      },
    };
  } catch (error) {
    return { kind: "technical_failure", failure: directPreparationFailure(error) };
  }
}
