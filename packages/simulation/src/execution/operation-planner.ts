import {
  JsonObjectSchema,
  OperationDurationSchema,
  mergeTaskOptionArguments,
  type AgentId,
  type JsonObject,
  type OperationCallId,
  type TaskOption,
} from "@god-sim/protocol";

import type { ActiveOperation } from "./operation";
import { createOperationRuntimeContext } from "./operation-runtime";
import type { SimulationRegistry } from "../engine/simulation-registry";
import type { WorldState } from "../world/world-state";

export type PrepareOperationResult =
  | { readonly kind: "prepared"; readonly operation: ActiveOperation }
  | {
      readonly kind: "blocked";
      readonly reasonCode: string;
      readonly summary: string;
    };

function sameTracks(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((track, index) => track === right[index])
  );
}

export function prepareOperationCall(
  world: WorldState,
  registry: SimulationRegistry,
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
      accumulatedObservations: [],
      observationDeliveryCursor: 0,
      plan: planned.plan,
    },
  };
}
