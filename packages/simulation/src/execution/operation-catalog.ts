import { z } from "zod";

import {
  EntityIdSchema,
  JsonObjectSchema,
  OperationIdSchema,
  TaskOptionSchema,
  type AgentId,
  type EntityId,
  type JsonObject,
  type TaskOption,
} from "@god-sim/protocol";

import type { PluginRegistry } from "../world/plugin-registry";
import { SpatialIndex } from "../world/spatial-index";
import type { AgentState, WorldState } from "../world/world-state";

export const WaitOperationArgumentsSchema = z
  .object({ durationTicks: z.number().int().positive() })
  .strict();
export const EntityTargetArgumentsSchema = z
  .object({ targetEntityId: EntityIdSchema })
  .strict();
export const ObjectInteractionArgumentsSchema = z
  .object({
    targetEntityId: EntityIdSchema,
    parameters: JsonObjectSchema,
  })
  .strict();

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

function waitOption(world: WorldState, agentId: AgentId): TaskOption {
  const rules = world.simulationRulesLock.rules.operations.wait;
  return TaskOptionSchema.parse({
    kind: "operation",
    id: `task-option:${agentId}:wait`,
    operationId: "core.wait",
    label: "Wait",
    taskSlots: ["BODY"],
    argumentSchema: jsonSchema(
      z
        .object({
          durationTicks: z
            .number()
            .int()
            .positive()
            .max(rules.maxDurationTicks),
        })
        .strict(),
    ),
    fixedArguments: {},
  });
}

function interactionIsKnownUnavailable(
  agent: AgentState,
  entityId: EntityId,
  interactionId: string,
): boolean {
  return (
    agent.knowledge.objects
      .get(entityId)
      ?.interactionAvailability.some(
        (availability) =>
          availability.interactionId === interactionId && !availability.available,
      ) ?? false
  );
}

function isAtInteractionPosition(
  world: WorldState,
  registry: PluginRegistry,
  agent: AgentState,
  entityId: EntityId,
): boolean {
  return new SpatialIndex(world, registry)
    .interactionPositions(entityId)
    .some(
      (position) =>
        position.x === agent.position.x && position.y === agent.position.y,
    );
}

function objectOperationId(definitionId: string, interactionId: string) {
  return OperationIdSchema.parse(
    `object.${definitionId}.${interactionId}`,
  );
}

export function buildTaskOptions(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
): readonly TaskOption[] {
  const agent = world.agents.get(agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${agentId}`);

  const options: TaskOption[] = [
    emptyOption(agentId, "HEAD"),
    emptyOption(agentId, "BODY"),
    waitOption(world, agentId),
  ];

  for (const knownObject of [...agent.knowledge.objects.values()].sort(
    (left, right) => left.entityId.localeCompare(right.entityId),
  )) {
    const object = world.objects.get(knownObject.entityId);
    if (!object) continue;
    const registered = registry.getObject(object.definitionId);
    const definition = registered?.definition;
    if (!definition) continue;
    const targetArguments = { targetEntityId: object.id };
    const inRange = isAtInteractionPosition(
      world,
      registry,
      agent,
      object.id,
    );

    if (agent.knowledge.visibleEntityIds.has(object.id)) {
      options.push(
        TaskOptionSchema.parse({
          kind: "operation",
          id: `task-option:${agentId}:${object.id}:observe`,
          operationId: "core.observe",
          label: `Observe ${definition.displayName}`,
          taskSlots: ["HEAD"],
          argumentSchema: jsonSchema(EntityTargetArgumentsSchema),
          fixedArguments: targetArguments,
        }),
      );
    }

    if (!inRange) {
      options.push(
        TaskOptionSchema.parse({
          kind: "operation",
          id: `task-option:${agentId}:${object.id}:move`,
          operationId: "core.move",
          label: `Move to ${definition.displayName}`,
          taskSlots: ["BODY"],
          argumentSchema: jsonSchema(EntityTargetArgumentsSchema),
          fixedArguments: targetArguments,
        }),
      );
      continue;
    }

    for (const interaction of definition.interactions) {
      if (
        interaction.trigger !== "active_command" ||
        interactionIsKnownUnavailable(agent, object.id, interaction.id)
      ) {
        continue;
      }
      const argumentsValue = {
        targetEntityId: object.id,
        parameters: {},
      };
      options.push(
        TaskOptionSchema.parse({
          kind: "operation",
          id: `task-option:${agentId}:${object.id}:${interaction.id}`,
          operationId: objectOperationId(
            object.definitionId,
            interaction.id,
          ),
          label: interaction.displayName,
          taskSlots: interaction.taskSlots,
          argumentSchema: jsonSchema(ObjectInteractionArgumentsSchema),
          fixedArguments: argumentsValue,
        }),
      );
    }
  }

  return options;
}

export function mergedOptionArguments(
  option: Extract<TaskOption, { kind: "operation" }>,
  value: JsonObject,
): JsonObject {
  for (const [key, fixedValue] of Object.entries(option.fixedArguments)) {
    if (
      Object.hasOwn(value, key) &&
      JSON.stringify(value[key]) !== JSON.stringify(fixedValue)
    ) {
      throw new Error(`Task option ${option.id} cannot change fixed argument ${key}`);
    }
  }
  return JsonObjectSchema.parse({ ...value, ...option.fixedArguments });
}
