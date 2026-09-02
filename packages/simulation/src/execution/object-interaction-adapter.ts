import { z } from "zod";

import type {
  InteractionDefinition,
  ObjectDefinition,
} from "@god-sim/plugin-sdk";
import {
  EntityIdSchema,
  OperationDurationSchema,
  OperationIdSchema,
  type EntityId,
  type JsonObject,
  type OperationId,
} from "@god-sim/protocol";

import {
  assertNoObservationBuffer,
  blocked,
  isAtInteractionPosition,
  knownObjects,
} from "./core/core-operation-helpers";
import type {
  OperationRuntimeContext,
  RegisteredOperation,
} from "./operation-runtime";
import { createInteractionContext } from "../interaction/interaction-router";

export const ObjectInteractionArgumentsSchema = z
  .object({
    targetEntityId: EntityIdSchema,
    parameters: z.object({}).passthrough(),
  })
  .strict();

export function objectInteractionOperationId(
  definitionId: string,
  interactionId: string,
): OperationId {
  return OperationIdSchema.parse(`object.${definitionId}.${interactionId}`);
}

function interactionIsKnownUnavailable(
  context: OperationRuntimeContext,
  entityId: EntityId,
  interactionId: string,
): boolean {
  return (
    context.world.agents
      .get(context.agentId)
      ?.knowledge.objects.get(entityId)
      ?.interactionAvailability.some(
        (entry) => entry.interactionId === interactionId && !entry.available,
      ) ?? false
  );
}

function interactionBinding<State>(
  context: OperationRuntimeContext,
  definition: ObjectDefinition<State>,
  interaction: InteractionDefinition<State, JsonObject>,
  argumentsValue: Readonly<JsonObject>,
) {
  const parsed = ObjectInteractionArgumentsSchema.safeParse(argumentsValue);
  if (!parsed.success) return null;
  const object = context.world.objects.get(parsed.data.targetEntityId);
  if (!object || object.definitionId !== definition.id) return null;
  return {
    object,
    state: definition.stateSchema.parse(object.state),
    parameters: interaction.parametersSchema.parse(parsed.data.parameters),
    interactionContext: createInteractionContext(
      context.world,
      context.registry,
      object.id,
      context.agentId,
    ),
  };
}

export function createObjectInteractionOperation<State>(
  ownerPluginId: string,
  definition: ObjectDefinition<State>,
  interactionValue: InteractionDefinition<State, JsonObject>,
): RegisteredOperation {
  const interaction = interactionValue;
  const id = objectInteractionOperationId(definition.id, interaction.id);
  const parametersSchema = interaction.parametersSchema.safeParse({}).success
    ? interaction.parametersSchema.default({})
    : interaction.parametersSchema;
  const argumentsSchema = z
    .object({
      targetEntityId: EntityIdSchema,
      parameters: parametersSchema,
    })
    .strict() as z.ZodType<JsonObject>;
  return {
    id,
    ownerPluginId,
    taskSlots: interaction.taskSlots,
    eventIgnore: interaction.eventIgnore,
    publicBehavior: interaction.publicBehavior,
    domainFailures: interaction.domainFailures,
    resultSchema: interaction.resultSchema,
    argumentsSchema: () => argumentsSchema,
    offers: (context) =>
      knownObjects(context).flatMap((known) => {
        const object = context.world.objects.get(known.entityId);
        if (
          !object ||
          object.definitionId !== definition.id ||
          !isAtInteractionPosition(context, object.id) ||
          interactionIsKnownUnavailable(context, object.id, interaction.id)
        ) {
          return [];
        }
        return [
          {
            id: `task-option:${context.agentId}:${object.id}:${interaction.id}`,
            label: interaction.displayName,
            fixedArguments: { targetEntityId: object.id },
          },
        ];
      }),
    canStart: (context, value) => {
      const binding = interactionBinding(context, definition, interaction, value);
      if (!binding) {
        return {
          available: false,
          reasonCode: "unknown_target",
          summary: `No ${definition.displayName} target is bound to ${id}`,
        };
      }
      if (binding.interactionContext.distance !== 0) {
        return {
          available: false,
          reasonCode: "out_of_range",
          summary: `${binding.object.id} is outside interaction range`,
        };
      }
      return interaction.canStart(
        binding.state,
        binding.interactionContext,
        binding.parameters,
      );
    },
    resolveDuration: (context, value) => {
      const binding = interactionBinding(context, definition, interaction, value);
      if (!binding) {
        throw new Error(`Operation ${id} is not bound to a matching object`);
      }
      return OperationDurationSchema.parse(
        interaction.resolveDuration(
          binding.state,
          binding.interactionContext,
          binding.parameters,
        ),
      );
    },
    createPlan: (context, value, callId, duration) => {
      const binding = interactionBinding(context, definition, interaction, value);
      if (!binding) {
        return blocked("unknown_target", `Operation ${id} has no matching target`);
      }
      return {
        kind: "prepared",
        plan: {
          currentActionIndex: 0,
          actions: [
            {
              id: `${callId}:action:0`,
              kind: "interact_object",
              purpose: "direct",
              targetEntityId: binding.object.id,
              interactionId: interaction.id,
              durationTicks:
                duration.kind === "fixed"
                  ? duration.totalTicks
                  : Number.MAX_SAFE_INTEGER,
              progressTicks: 0,
              started: false,
            },
          ],
        },
      };
    },
    fuse: (context, operation) => {
      const binding = interactionBinding(
        context,
        definition,
        interaction,
        operation.arguments,
      );
      if (!binding) return null;
      const result = interaction.fuse(
        binding.state,
        binding.interactionContext,
        binding.parameters,
      );
      return result === null ? null : interaction.resultSchema.parse(result);
    },
    acknowledgeFuseResult: (_context, operation) => operation,
    terminalResult: () => null,
    validateRestored: (context, operation) => {
      const binding = interactionBinding(
        context,
        definition,
        interaction,
        operation.arguments,
      );
      const action = operation.plan.actions[0];
      const resolvedDuration = binding
        ? OperationDurationSchema.parse(
            interaction.resolveDuration(
              binding.state,
              binding.interactionContext,
              binding.parameters,
            ),
          )
        : null;
      const expectedDuration =
        resolvedDuration?.kind === "fixed"
          ? resolvedDuration.totalTicks
          : Number.MAX_SAFE_INTEGER;
      if (
        !binding ||
        !resolvedDuration ||
        JSON.stringify(operation.duration) !== JSON.stringify(resolvedDuration) ||
        operation.plan.actions.length !== 1 ||
        operation.plan.currentActionIndex !== 0 ||
        action?.kind !== "interact_object" ||
        action.purpose !== "direct" ||
        action.targetEntityId !== binding.object.id ||
        action.interactionId !== interaction.id ||
        action.durationTicks !== expectedDuration ||
        action.progressTicks !== operation.progressTicks
      ) {
        throw new Error(
          `Snapshot interaction operation ${operation.callId} has an incompatible plan`,
        );
      }
      assertNoObservationBuffer(operation);
    },
  };
}
