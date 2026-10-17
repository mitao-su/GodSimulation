import { z } from "zod";

import {
  JsonObjectSchema,
  TaskOptionSchema,
  type AgentId,
  type EntityId,
  type TaskOption,
} from "@god-sim/protocol";

import {
  createOperationRuntimeContext,
  type OperationRuntimeRegistry,
} from "../execution/operation-runtime";
import { SpatialIndex } from "../world/spatial-index";
import type { WorldState } from "../world/world-state";

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  return JsonObjectSchema.parse(z.toJSONSchema(schema));
}

function emptyOption(agentId: AgentId, track: "HEAD" | "BODY"): TaskOption {
  return TaskOptionSchema.parse({
    kind: "empty",
    id: `task-option:${agentId}:empty-${track.toLowerCase()}`,
    label: `Clear ${track.toLowerCase()} task`,
    taskSlots: [track],
    argumentSchema: { type: "object", properties: {}, additionalProperties: false },
  });
}

/**
 * Legacy-only fixture for replay tests. Production requests never build a
 * dynamic task-option list; migrated snapshots may still contain one.
 */
export function legacyTaskOptionsFor(
  world: WorldState,
  registry: OperationRuntimeRegistry,
  agentId: AgentId,
): readonly TaskOption[] {
  if (!world.agents.has(agentId)) throw new Error(`Unknown agent instance: ${agentId}`);
  const context = createOperationRuntimeContext(world, registry, agentId);
  const agent = world.agents.get(agentId)!;
  const spatial = new SpatialIndex(world, registry);
  const options: TaskOption[] = [
    emptyOption(agentId, "HEAD"),
    emptyOption(agentId, "BODY"),
  ];
  const add = (
    operationId: string,
    fixedArguments: Record<string, unknown>,
    suffix: string,
  ): void => {
    const operation = registry.getOperation(operationId);
    if (!operation) return;
    options.push(
      TaskOptionSchema.parse({
        kind: "operation",
        id: `task-option:${agentId}:${suffix}`,
        operationId: operation.id,
        label: operation.id,
        taskSlots: operation.taskSlots,
        argumentSchema: jsonSchema(operation.argumentsSchema(context)),
        fixedArguments,
      }),
    );
  };

  add("core.wait", {}, "wait");
  for (const known of [...agent.knowledge.objects.values()].sort((left, right) =>
    left.entityId.localeCompare(right.entityId),
  )) {
    const object = world.objects.get(known.entityId as EntityId);
    if (!object) continue;
    const atInteractionPosition = spatial
      .interactionPositions(object.id)
      .some(
        (position) =>
          position.x === agent.position.x && position.y === agent.position.y,
      );
    if (!atInteractionPosition) add("core.move", { targetEntityId: object.id }, `${object.id}:move`);
    if (agent.knowledge.visibleEntityIds.has(known.entityId)) {
      add("core.observe", { targetEntityId: object.id }, `${object.id}:observe`);
    }
    const operationPrefix = `object.${object.definitionId}.`;
    for (const operation of [...registry.operations.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    )) {
      if (!operation.id.startsWith(operationPrefix)) continue;
      const interactionId = operation.id.slice(operationPrefix.length);
      const unavailable = known.interactionAvailability.some(
        (entry) => entry.interactionId === interactionId && !entry.available,
      );
      if (unavailable || !atInteractionPosition) continue;
      add(
        operation.id,
        { targetEntityId: object.id },
        `${object.id}:${interactionId}`,
      );
    }
  }
  return options;
}
