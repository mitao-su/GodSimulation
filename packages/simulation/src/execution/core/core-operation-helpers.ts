import { z } from "zod";

import {
  EntityIdSchema,
  type EntityId,
  type JsonObject,
} from "@god-sim/protocol";

import type {
  OperationPlanResult,
  OperationRuntimeContext,
} from "../operation-runtime";
import { SpatialIndex } from "../../world/spatial-index";
import type { ObjectInstance } from "../../world/world-state";

export const ENTITY_TARGET_ARGUMENTS_SCHEMA = z
  .object({ targetEntityId: EntityIdSchema })
  .strict();
export const EMPTY_RESULT_SCHEMA = z.object({}).strict();
/**
 * State schema for operations that own no per-call private state. Their
 * opaque `ActiveOperation.state` must always be the empty object.
 */
export const EMPTY_OPERATION_STATE_SCHEMA = z.object({}).strict();
export const AVAILABLE = { available: true } as const;

export function knownObjects(context: OperationRuntimeContext) {
  const agent = context.world.agents.get(context.agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${context.agentId}`);
  return [...agent.knowledge.objects.values()].sort((left, right) =>
    left.entityId.localeCompare(right.entityId),
  );
}

export function isAtInteractionPosition(
  context: OperationRuntimeContext,
  entityId: EntityId,
): boolean {
  const agent = context.world.agents.get(context.agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${context.agentId}`);
  return new SpatialIndex(context.world, context.registry)
    .interactionPositions(entityId)
    .some(
      (position) =>
        position.x === agent.position.x && position.y === agent.position.y,
    );
}

export function targetObject(
  context: OperationRuntimeContext,
  argumentsValue: Readonly<JsonObject>,
  expectedDefinitionId?: string,
): ObjectInstance | null {
  const parsed = ENTITY_TARGET_ARGUMENTS_SCHEMA.safeParse(argumentsValue);
  if (!parsed.success) return null;
  const object = context.world.objects.get(parsed.data.targetEntityId);
  if (
    !object ||
    (expectedDefinitionId !== undefined &&
      object.definitionId !== expectedDefinitionId)
  ) {
    return null;
  }
  return object;
}

export function blocked(
  reasonCode: string,
  summary: string,
): OperationPlanResult {
  return { kind: "blocked", reasonCode, summary };
}
