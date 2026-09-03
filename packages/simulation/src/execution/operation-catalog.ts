import { z } from "zod";

import {
  JsonObjectSchema,
  TaskOptionSchema,
  type AgentId,
  type JsonObject,
  type TaskOption,
} from "@god-sim/protocol";

import {
  createOperationRuntimeContext,
  type OperationRuntimeRegistry,
} from "./operation-runtime";
import type { WorldState } from "../world/world-state";

function jsonSchema(schema: z.ZodType): JsonObject {
  return JsonObjectSchema.parse(z.toJSONSchema(schema));
}

function emptyOption(
  agentId: AgentId,
  track: "HEAD" | "BODY",
): TaskOption {
  const suffix = track.toLowerCase();
  return TaskOptionSchema.parse({
    kind: "empty",
    id: `task-option:${agentId}:empty-${suffix}`,
    label: `Clear ${suffix} task`,
    taskSlots: [track],
    argumentSchema: jsonSchema(z.object({}).strict()),
  });
}

export function buildTaskOptions(
  world: WorldState,
  registry: OperationRuntimeRegistry,
  agentId: AgentId,
): readonly TaskOption[] {
  if (!world.agents.has(agentId)) {
    throw new Error(`Unknown agent instance: ${agentId}`);
  }
  const context = createOperationRuntimeContext(world, registry, agentId);
  const operationOptions = [...registry.operations.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((operation) => {
      const argumentSchema = jsonSchema(operation.argumentsSchema(context));
      return operation.offers(context).map((offer) =>
        TaskOptionSchema.parse({
          kind: "operation",
          id: offer.id,
          operationId: operation.id,
          label: offer.label,
          taskSlots: operation.taskSlots,
          argumentSchema,
          fixedArguments: offer.fixedArguments,
        }),
      );
    });

  return [
    emptyOption(agentId, "HEAD"),
    emptyOption(agentId, "BODY"),
    ...operationOptions,
  ];
}
