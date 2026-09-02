import { z } from "zod";

import {
  EntityIdSchema,
  JsonObjectSchema,
  OperationDurationSchema,
  OperationIdSchema,
  type AgentId,
  type Coordinate,
  type EntityId,
  type EventId,
  type JsonObject,
  type JsonValue,
  type OperationCallId,
  type OperationDuration,
  type OperationId,
  type TaskOptionId,
  type TaskTrack,
} from "@god-sim/protocol";
import type {
  InteractionAvailability,
  InteractionDefinition,
  ObjectDefinition,
  OperationDomainFailureDefinition,
  OperationEventIgnoreRule,
  PublicBehaviorDeclaration,
} from "@god-sim/plugin-sdk";

import {
  createInteractionContext,
} from "../interaction/interaction-router";
import type { AgentNavigationKnowledge } from "./path-planner";
import { findPath } from "./path-planner";
import type {
  ActiveOperation,
  OperationAction,
  OperationObservation,
  OperationPlan,
} from "./operation";
import type { PluginRegistry } from "../world/plugin-registry";
import { SpatialIndex } from "../world/spatial-index";
import type { ObjectInstance, WorldState } from "../world/world-state";

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

const OperationObservationSchema = z
  .object({
    entityId: EntityIdSchema,
    kind: z.enum(["object", "agent"]),
    summary: z.string().min(1).max(500),
  })
  .strict();
export const MoveOperationResultSchema = z
  .object({ nearby: z.array(OperationObservationSchema) })
  .strict();

export interface OperationOffer {
  readonly id: TaskOptionId | string;
  readonly label: string;
  readonly fixedArguments: JsonObject;
}

export interface OperationRuntimeContext {
  readonly world: WorldState;
  readonly registry: PluginRegistry;
  readonly agentId: AgentId;
}

export type OperationPlanResult =
  | { readonly kind: "prepared"; readonly plan: OperationPlan }
  | {
      readonly kind: "blocked";
      readonly reasonCode: string;
      readonly summary: string;
    };

export interface OperationRecoveryFailure {
  readonly callId: OperationCallId;
  readonly entityId: EntityId;
  readonly observedObjectVersion: number;
  readonly reasonCode: string;
  readonly sourceEventId: EventId;
}

export type OperationRecoveryResult =
  | {
      readonly kind: "replanned";
      readonly operation: ActiveOperation;
      readonly knowledge: AgentNavigationKnowledge;
    }
  | {
      readonly kind: "needs_decision";
      readonly reasonCode: string;
      readonly knowledge: AgentNavigationKnowledge;
    };

export interface RegisteredOperation {
  readonly id: OperationId;
  readonly ownerPluginId: string | null;
  readonly taskSlots: readonly TaskTrack[];
  readonly eventIgnore: readonly OperationEventIgnoreRule[];
  readonly publicBehavior: PublicBehaviorDeclaration;
  readonly domainFailures: readonly OperationDomainFailureDefinition[];
  readonly resultSchema: z.ZodType<JsonObject>;
  argumentsSchema(context: OperationRuntimeContext): z.ZodType<JsonObject>;
  offers(context: OperationRuntimeContext): readonly OperationOffer[];
  canStart(
    context: OperationRuntimeContext,
    argumentsValue: Readonly<JsonObject>,
  ): InteractionAvailability;
  resolveDuration(
    context: OperationRuntimeContext,
    argumentsValue: Readonly<JsonObject>,
  ): OperationDuration;
  createPlan(
    context: OperationRuntimeContext,
    argumentsValue: Readonly<JsonObject>,
    callId: OperationCallId,
    duration: OperationDuration,
  ): OperationPlanResult;
  fuse(
    context: OperationRuntimeContext,
    operation: ActiveOperation,
  ): JsonObject | null;
  terminalResult(
    context: OperationRuntimeContext,
    operation: ActiveOperation,
    outcome: "completed" | "failed" | "cancelled",
  ): JsonObject | null;
  accumulateObservations?(
    operation: ActiveOperation,
    observations: readonly OperationObservation[],
  ): ActiveOperation;
  recover?(
    context: OperationRuntimeContext,
    operation: ActiveOperation,
    failure: OperationRecoveryFailure,
    knowledge: AgentNavigationKnowledge,
  ): OperationRecoveryResult;
}

const available: InteractionAvailability = { available: true };
const emptyResultSchema = z.object({}).strict();

function operationContext(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
): OperationRuntimeContext {
  return { world, registry, agentId };
}

export function createOperationRuntimeContext(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
): OperationRuntimeContext {
  if (!world.agents.has(agentId)) {
    throw new Error(`Unknown agent instance: ${agentId}`);
  }
  return operationContext(world, registry, agentId);
}

function knownObjects(context: OperationRuntimeContext) {
  const agent = context.world.agents.get(context.agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${context.agentId}`);
  return [...agent.knowledge.objects.values()].sort((left, right) =>
    left.entityId.localeCompare(right.entityId),
  );
}

function isAtInteractionPosition(
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

function targetObject(
  context: OperationRuntimeContext,
  argumentsValue: Readonly<JsonObject>,
  expectedDefinitionId?: string,
): ObjectInstance | null {
  const parsed = EntityTargetArgumentsSchema.safeParse(argumentsValue);
  if (!parsed.success) return null;
  const object = context.world.objects.get(parsed.data.targetEntityId);
  if (!object || (expectedDefinitionId && object.definitionId !== expectedDefinitionId)) {
    return null;
  }
  return object;
}

function blocked(reasonCode: string, summary: string): OperationPlanResult {
  return { kind: "blocked", reasonCode, summary };
}

function automaticTraversalObjectsAt(
  context: OperationRuntimeContext,
  position: Coordinate,
): readonly ObjectInstance[] {
  const spatial = new SpatialIndex(context.world, context.registry);
  return spatial
    .blockingObjectsAt(position, context.agentId)
    .filter((object) => {
      const registered = context.registry.getObject(object.definitionId);
      return registered?.definition.traversal !== undefined;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function traversalDuration(
  context: OperationRuntimeContext,
  object: ObjectInstance,
  interactionId: string,
): number {
  const runtime = context.registry.getOperation(
    objectInteractionOperationId(object.definitionId, interactionId),
  );
  if (!runtime) {
    throw new Error(
      `Object ${object.id} has no registered traversal interaction ${interactionId}`,
    );
  }
  const duration = OperationDurationSchema.parse(
    runtime.resolveDuration(context, {
      targetEntityId: object.id,
      parameters: {},
    }),
  );
  if (duration.kind !== "fixed") {
    throw new Error(
      `Traversal interaction ${object.id}:${interactionId} must have fixed duration`,
    );
  }
  return duration.totalTicks;
}

function createMoveActions(
  context: OperationRuntimeContext,
  callId: OperationCallId,
  path: readonly Coordinate[],
  actionNamespace: string = callId,
): readonly OperationAction[] {
  const actions: OperationAction[] = [];
  let segment: Coordinate[] = [path[0]!];
  const ticksPerCell =
    context.world.simulationRulesLock.rules.operations.move.ticksPerCell;

  const pushMove = (): void => {
    if (segment.length < 2) return;
    actions.push({
      id: `${actionNamespace}:action:${actions.length}`,
      kind: "move",
      path: segment,
      durationTicks: (segment.length - 1) * ticksPerCell,
      progressTicks: 0,
    });
  };

  for (let index = 1; index < path.length; index += 1) {
    const position = path[index]!;
    const traversalObjects = automaticTraversalObjectsAt(context, position);
    if (traversalObjects.length === 0) {
      segment.push(position);
      continue;
    }
    pushMove();
    for (const object of traversalObjects) {
      const interactionId = context.registry.getObject(object.definitionId)
        ?.definition.traversal?.interactionId;
      if (!interactionId) {
        throw new Error(`Object ${object.id} has no traversal capability`);
      }
      actions.push({
        id: `${actionNamespace}:action:${actions.length}`,
        kind: "interact_object",
        purpose: "automatic_traversal",
        targetEntityId: object.id,
        interactionId,
        durationTicks: traversalDuration(context, object, interactionId),
        progressTicks: 0,
        started: false,
      });
    }
    segment = [path[index - 1]!, position];
  }
  pushMove();
  return actions;
}

function routeToTarget(
  context: OperationRuntimeContext,
  argumentsValue: Readonly<JsonObject>,
  knowledge: AgentNavigationKnowledge,
) {
  const object = targetObject(context, argumentsValue);
  if (!object) {
    return {
      kind: "blocked" as const,
      reasonCode: "unknown_target",
      summary: "The movement target does not exist",
    };
  }
  const path = findPath(
    context.world,
    context.registry,
    context.agentId,
    new SpatialIndex(context.world, context.registry).interactionPositions(object.id),
    knowledge,
  );
  return path.kind === "found"
    ? path
    : {
        kind: "blocked" as const,
        reasonCode: "no_known_route",
        summary: "No known route to target",
      };
}

function baseCoreRuntime(
  input: Pick<
    RegisteredOperation,
    | "id"
    | "taskSlots"
    | "publicBehavior"
    | "domainFailures"
    | "resultSchema"
    | "argumentsSchema"
    | "offers"
    | "canStart"
    | "resolveDuration"
    | "createPlan"
    | "fuse"
    | "terminalResult"
  > &
    Partial<
      Pick<RegisteredOperation, "accumulateObservations" | "recover">
    >,
): RegisteredOperation {
  return {
    ownerPluginId: null,
    eventIgnore: [],
    ...input,
  };
}

function waitRuntime(): RegisteredOperation {
  return baseCoreRuntime({
    id: OperationIdSchema.parse("core.wait"),
    taskSlots: ["BODY"],
    publicBehavior: { kind: "visible", label: "waiting" },
    domainFailures: [
      { code: "invalid_duration", summary: "Wait duration is outside the configured range" },
    ],
    resultSchema: emptyResultSchema,
    argumentsSchema: (context) =>
      z
        .object({
          durationTicks: z
            .number()
            .int()
            .positive()
            .max(
              context.world.simulationRulesLock.rules.operations.wait
                .maxDurationTicks,
            ),
        })
        .strict(),
    offers: (context) => [
      {
        id: `task-option:${context.agentId}:wait`,
        label: "Wait",
        fixedArguments: {},
      },
    ],
    canStart: (context, value) => {
      const parsed = WaitOperationArgumentsSchema.safeParse(value);
      const max =
        context.world.simulationRulesLock.rules.operations.wait.maxDurationTicks;
      return parsed.success && parsed.data.durationTicks <= max
        ? available
        : {
            available: false,
            reasonCode: "invalid_duration",
            summary: `Wait duration must not exceed ${max} ticks`,
          };
    },
    resolveDuration: (_context, value) => ({
      kind: "fixed",
      totalTicks: WaitOperationArgumentsSchema.parse(value).durationTicks,
    }),
    createPlan: (_context, value, callId, duration) => {
      const parsed = WaitOperationArgumentsSchema.parse(value);
      if (duration.kind !== "fixed") {
        throw new Error("core.wait requires a fixed duration");
      }
      return {
        kind: "prepared",
        plan: {
          currentActionIndex: 0,
          actions: [
            {
              id: `${callId}:action:0`,
              kind: "wait",
              durationTicks: parsed.durationTicks,
              progressTicks: 0,
            },
          ],
        },
      };
    },
    fuse: () => null,
    terminalResult: () => ({}),
  });
}

function observeRuntime(): RegisteredOperation {
  return baseCoreRuntime({
    id: OperationIdSchema.parse("core.observe"),
    taskSlots: ["HEAD"],
    publicBehavior: { kind: "visible", label: "observing" },
    domainFailures: [
      { code: "target_not_visible", summary: "Observation target is not visible" },
    ],
    resultSchema: emptyResultSchema,
    argumentsSchema: () => EntityTargetArgumentsSchema,
    offers: (context) => {
      const agent = context.world.agents.get(context.agentId)!;
      return knownObjects(context)
        .filter((object) => agent.knowledge.visibleEntityIds.has(object.entityId))
        .flatMap((object) => {
          const definition = context.registry.getObject(
            context.world.objects.get(object.entityId)?.definitionId ?? "",
          )?.definition;
          return definition
            ? [
                {
                  id: `task-option:${context.agentId}:${object.entityId}:observe`,
                  label: `Observe ${definition.displayName}`,
                  fixedArguments: { targetEntityId: object.entityId },
                },
              ]
            : [];
        });
    },
    canStart: (context, value) => {
      const object = targetObject(context, value);
      const targetEntityId = EntityTargetArgumentsSchema.safeParse(value).data
        ?.targetEntityId;
      const agent = context.world.agents.get(context.agentId)!;
      return object && targetEntityId && agent.knowledge.visibleEntityIds.has(targetEntityId)
        ? available
        : {
            available: false,
            reasonCode: "target_not_visible",
            summary: `${targetEntityId ?? "Target"} is not currently visible`,
          };
    },
    resolveDuration: (context) => ({
      kind: "fixed",
      totalTicks:
        context.world.simulationRulesLock.rules.operations.observe.durationTicks,
    }),
    createPlan: (_context, value, callId, duration) => {
      if (duration.kind !== "fixed") {
        throw new Error("core.observe requires a fixed duration");
      }
      const targetEntityId = EntityTargetArgumentsSchema.parse(value).targetEntityId;
      return {
        kind: "prepared",
        plan: {
          currentActionIndex: 0,
          actions: [
            {
              id: `${callId}:action:0`,
              kind: "observe",
              targetEntityId,
              durationTicks: duration.totalTicks,
              progressTicks: 0,
            },
          ],
        },
      };
    },
    fuse: () => null,
    terminalResult: () => ({}),
  });
}

function moveResult(operation: ActiveOperation): JsonObject {
  return MoveOperationResultSchema.parse({
    nearby: operation.accumulatedObservations,
  });
}

function moveRuntime(): RegisteredOperation {
  return baseCoreRuntime({
    id: OperationIdSchema.parse("core.move"),
    taskSlots: ["BODY"],
    publicBehavior: { kind: "visible", label: "moving" },
    domainFailures: [
      { code: "unknown_target", summary: "Movement target does not exist" },
      { code: "no_known_route", summary: "No known route reaches the target" },
      { code: "movement_blocked", summary: "Movement was blocked" },
    ],
    resultSchema: MoveOperationResultSchema,
    argumentsSchema: () => EntityTargetArgumentsSchema,
    offers: (context) =>
      knownObjects(context).flatMap((known) => {
        const object = context.world.objects.get(known.entityId);
        const definition = object
          ? context.registry.getObject(object.definitionId)?.definition
          : undefined;
        return object && definition && !isAtInteractionPosition(context, object.id)
          ? [
              {
                id: `task-option:${context.agentId}:${object.id}:move`,
                label: `Move to ${definition.displayName}`,
                fixedArguments: { targetEntityId: object.id },
              },
            ]
          : [];
      }),
    canStart: (context, value) => {
      const agent = context.world.agents.get(context.agentId)!;
      const route = routeToTarget(context, value, agent.knowledge);
      return route.kind === "found"
        ? available
        : {
            available: false,
            reasonCode: route.reasonCode,
            summary: route.summary,
          };
    },
    resolveDuration: () => ({ kind: "indeterminate" }),
    createPlan: (context, value, callId) => {
      const agent = context.world.agents.get(context.agentId)!;
      const route = routeToTarget(context, value, agent.knowledge);
      if (route.kind !== "found") {
        return blocked(route.reasonCode, route.summary);
      }
      return {
        kind: "prepared",
        plan: {
          currentActionIndex: 0,
          actions: createMoveActions(context, callId, route.path),
        },
      };
    },
    fuse: (_context, operation) => moveResult(operation),
    terminalResult: (_context, operation) => moveResult(operation),
    accumulateObservations: (operation, observations) => {
      const merged = new Map<EntityId, OperationObservation>();
      for (const observation of [
        ...operation.accumulatedObservations,
        ...observations,
      ]) {
        if (!merged.has(observation.entityId)) {
          merged.set(observation.entityId, observation);
        }
      }
      return { ...operation, accumulatedObservations: [...merged.values()] };
    },
    recover: (context, operation, failure, knowledge) => {
      const knownTraversalBlockers = new Map(knowledge.knownTraversalBlockers);
      knownTraversalBlockers.set(failure.entityId, {
        entityId: failure.entityId,
        observedObjectVersion: failure.observedObjectVersion,
        reasonCode: failure.reasonCode,
        sourceEventId: failure.sourceEventId,
      });
      const updatedKnowledge = { knownTraversalBlockers };
      const route = routeToTarget(context, operation.arguments, updatedKnowledge);
      if (route.kind !== "found") {
        return {
          kind: "needs_decision",
          reasonCode: route.reasonCode,
          knowledge: updatedKnowledge,
        };
      }
      return {
        kind: "replanned",
        knowledge: updatedKnowledge,
        operation: {
          ...operation,
          plan: {
            currentActionIndex: 0,
            actions: createMoveActions(
              context,
              operation.callId,
              route.path,
              `${operation.callId}:replan:${operation.progressTicks}`,
            ),
          },
        },
      };
    },
  });
}

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

function objectInteractionRuntime<State>(
  ownerPluginId: string,
  definition: ObjectDefinition<State>,
  interactionValue: InteractionDefinition<State>,
): RegisteredOperation {
  const interaction = interactionValue as InteractionDefinition<State, JsonObject>;
  const id = objectInteractionOperationId(definition.id, interaction.id);
  return {
    id,
    ownerPluginId,
    taskSlots: interaction.taskSlots,
    eventIgnore: interaction.eventIgnore,
    publicBehavior: interaction.publicBehavior,
    domainFailures: interaction.domainFailures,
    resultSchema: interaction.resultSchema,
    argumentsSchema: () =>
      z
        .object({
          targetEntityId: EntityIdSchema,
          parameters: interaction.parametersSchema,
        })
        .strict() as z.ZodType<JsonObject>,
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
            fixedArguments: { targetEntityId: object.id, parameters: {} },
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
    terminalResult: () => null,
  };
}

export function createRegisteredOperations(
  registry: PluginRegistry,
): ReadonlyMap<OperationId, RegisteredOperation> {
  const operations = new Map<OperationId, RegisteredOperation>();
  const register = (operation: RegisteredOperation): void => {
    if (operations.has(operation.id)) {
      throw new Error(`Duplicate operation ID: ${operation.id}`);
    }
    operations.set(operation.id, operation);
  };

  register(waitRuntime());
  register(observeRuntime());
  register(moveRuntime());

  for (const registered of [...registry.objects.values()].sort((left, right) =>
    left.definition.id.localeCompare(right.definition.id),
  )) {
    for (const interaction of registered.definition.interactions) {
      register(
        objectInteractionRuntime(
          registered.ownerPluginId,
          registered.definition as ObjectDefinition<JsonValue>,
          interaction as InteractionDefinition<JsonValue>,
        ),
      );
    }
  }
  return operations;
}
