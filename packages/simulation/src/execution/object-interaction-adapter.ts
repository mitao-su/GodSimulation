import { z } from "zod";

import {
  assertHostedOperationContract,
  bindHostedInteractionDefinition,
  mapOperationArbitrationFailure,
  type InteractionDefinition,
  type ObjectDefinition,
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
  EMPTY_OPERATION_STATE_SCHEMA,
  blocked,
  isAtInteractionPosition,
  knownObjects,
} from "./core/core-operation-helpers";
import type {
  HostedOperationRuntime,
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
    arbitrationFailureMappings: interaction.arbitrationFailureMappings,
    resultSchema: interaction.resultSchema,
    stateSchema: EMPTY_OPERATION_STATE_SCHEMA,
    argumentsSchema: () => argumentsSchema,
    initialState: () => ({}),
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
      // The locked duration is resolved exactly once when the call is
      // created. Restoration never re-evaluates `resolveDuration`, because
      // resolvers may legitimately depend on object state that `start()`
      // has already changed (for example occupancy). The saved
      // `operation.duration` is the only authority here.
      const expectedActionTicks =
        operation.duration.kind === "fixed"
          ? operation.duration.totalTicks
          : Number.MAX_SAFE_INTEGER;
      if (
        !binding ||
        operation.plan.actions.length !== 1 ||
        operation.plan.currentActionIndex !== 0 ||
        action?.kind !== "interact_object" ||
        action.purpose !== "direct" ||
        action.targetEntityId !== binding.object.id ||
        action.interactionId !== interaction.id ||
        action.durationTicks !== expectedActionTicks ||
        action.progressTicks !== operation.progressTicks
      ) {
        throw new Error(
          `Snapshot interaction operation ${operation.callId} has an incompatible plan`,
        );
      }
    },
  };
}

export function createHostedObjectInteractionOperation<State>(
  ownerPluginId: string,
  definition: ObjectDefinition<State>,
  interaction: InteractionDefinition<State, JsonObject>,
): HostedOperationRuntime {
  const hosted = bindHostedInteractionDefinition(interaction);
  const expectedId = objectInteractionOperationId(definition.id, interaction.id);
  const operationState = (value: Readonly<JsonObject>) =>
    hosted.stateSchema.parse(value);

  const binding = (
    context: OperationRuntimeContext,
    host: Parameters<HostedOperationRuntime["initialState"]>[1],
    argumentsValue: Readonly<JsonObject>,
  ) => {
    if (host.kind !== "furniture") {
      throw new Error(
        `Operation ${expectedId} requires a furniture host instance`,
      );
    }
    const object = context.world.objects.get(host.hostEntityId);
    if (!object || object.definitionId !== definition.id) {
      throw new Error(
        `Operation ${expectedId} is not bound to a ${definition.id} instance`,
      );
    }
    return {
      state: definition.stateSchema.parse(object.state),
      parameters: hosted.parametersSchema.parse(argumentsValue),
      context: createInteractionContext(
        context.world,
        context.registry,
        object.id,
        context.agentId,
      ),
    };
  };
  const callBinding = (
    context: OperationRuntimeContext,
    operation: Parameters<HostedOperationRuntime["start"]>[1],
  ) => {
    if (
      operation.operationId !== expectedId ||
      operation.hostDefinition.kind !== "furniture" ||
      operation.hostDefinition.hostDefinitionId !== definition.id
    ) {
      throw new Error(
        `Object operation call is not bound to ${definition.id}:${expectedId}`,
      );
    }
    return binding(context, operation.host, operation.arguments);
  };

  const runtime: HostedOperationRuntime = {
    id: expectedId,
    displayName: hosted.displayName,
    trigger: hosted.trigger,
    ownerPluginId,
    host: { kind: "furniture", hostDefinitionId: definition.id },
    manual: hosted.manual,
    target: hosted.target,
    duration: hosted.duration,
    taskSlots: hosted.taskSlots,
    eventIgnore: hosted.eventIgnore,
    publicBehavior: hosted.publicBehavior,
    domainFailures: hosted.domainFailures,
    arbitrationFailureMappings: hosted.arbitrationFailureMappings,
    resultSchema: hosted.resultSchema,
    stateSchema: hosted.stateSchema,
    parametersSchema: hosted.parametersSchema,
    initialState: (context, host, argumentsValue) => {
      const bound = binding(context, host, argumentsValue);
      return hosted.initialState(
        bound.state,
        bound.context,
        bound.parameters,
      );
    },
    resolveDuration: (context, host, argumentsValue) => {
      const bound = binding(context, host, argumentsValue);
      return hosted.resolveDuration(
        bound.state,
        bound.context,
        bound.parameters,
      );
    },
    start: (context, operation) => {
      const bound = callBinding(context, operation);
      return hosted.start(
        bound.state,
        bound.context,
        bound.parameters,
        operationState(operation.state),
      );
    },
    ...(hosted.tick
      ? {
          tick: (context, operation) => {
            const bound = callBinding(context, operation);
            return hosted.tick!(
              bound.state,
              bound.context,
              bound.parameters,
              operationState(operation.state),
            );
          },
        }
      : {}),
    complete: (context, operation) => {
      const bound = callBinding(context, operation);
      return hosted.complete(
        bound.state,
        bound.context,
        bound.parameters,
        operationState(operation.state),
      );
    },
    fail: (context, operation, failure) => {
      const bound = callBinding(context, operation);
      return hosted.fail(
        bound.state,
        bound.context,
        bound.parameters,
        operationState(operation.state),
        failure,
      );
    },
    cancel: (context, operation) => {
      const bound = callBinding(context, operation);
      return hosted.cancel(
        bound.state,
        bound.context,
        bound.parameters,
        operationState(operation.state),
      );
    },
    fuse: (context, operation) => {
      const bound = callBinding(context, operation);
      return hosted.fuse(
        bound.state,
        bound.context,
        bound.parameters,
        operationState(operation.state),
      );
    },
    acknowledgeFuseResult: (context, operation, result) => {
      const bound = callBinding(context, operation);
      return hosted.acknowledgeFuseResult(
        bound.state,
        bound.context,
        bound.parameters,
        operationState(operation.state),
        result,
      );
    },
    mapArbitrationFailure: (_operationCall, failure) =>
      mapOperationArbitrationFailure(
        hosted.arbitrationFailureMappings,
        hosted.domainFailures,
        failure,
      ),
  };
  assertHostedOperationContract(
    `Object ${definition.id} interaction ${interaction.id}`,
    runtime,
  );
  return Object.freeze(runtime);
}
