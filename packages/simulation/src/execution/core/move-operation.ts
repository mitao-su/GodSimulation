import { z } from "zod";

import {
  EntityIdSchema,
  OperationDurationSchema,
  OperationIdSchema,
  type Coordinate,
  type EntityId,
  type JsonObject,
  type OperationCallId,
} from "@god-sim/protocol";

import {
  AVAILABLE,
  ENTITY_TARGET_ARGUMENTS_SCHEMA,
  blocked,
  isAtInteractionPosition,
  knownObjects,
  targetObject,
} from "./core-operation-helpers";
import { objectInteractionOperationId } from "../object-interaction-adapter";
import type { AgentNavigationKnowledge } from "../path-planner";
import { findPath } from "../path-planner";
import type {
  ActiveOperation,
  OperationAction,
  OperationObservation,
} from "../operation";
import type {
  OperationRuntimeContext,
  RegisteredOperation,
} from "../operation-runtime";
import { SpatialIndex } from "../../world/spatial-index";
import type { ObjectInstance } from "../../world/world-state";

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

/**
 * Runtime-owned state of a move call: every observation swept during the
 * move, plus the cursor marking which prefix has already been delivered
 * to the agent. Kept inside the opaque `ActiveOperation.state` so other
 * operations never have to know these fields exist.
 */
export const MoveOperationStateSchema = z
  .object({
    accumulatedObservations: z.array(OperationObservationSchema),
    observationDeliveryCursor: z.number().int().nonnegative(),
  })
  .strict();

type MoveOperationState = z.infer<typeof MoveOperationStateSchema>;

function moveState(operation: ActiveOperation): MoveOperationState {
  return MoveOperationStateSchema.parse(operation.state);
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

function undeliveredResult(operation: ActiveOperation): JsonObject {
  const state = moveState(operation);
  return MoveOperationResultSchema.parse({
    nearby: state.accumulatedObservations.slice(state.observationDeliveryCursor),
  });
}

function assertRestoredMovePlan(
  context: OperationRuntimeContext,
  operation: ActiveOperation,
): void {
  ENTITY_TARGET_ARGUMENTS_SCHEMA.parse(operation.arguments);
  if (operation.duration.kind !== "indeterminate") {
    throw new Error(`Snapshot move operation ${operation.callId} has a fixed duration`);
  }
  const state = moveState(operation);
  if (state.observationDeliveryCursor > state.accumulatedObservations.length) {
    throw new Error(
      `Snapshot move operation ${operation.callId} has an invalid observation delivery cursor`,
    );
  }
  const ticksPerCell =
    context.world.simulationRulesLock.rules.operations.move.ticksPerCell;
  for (const action of operation.plan.actions) {
    if (action.kind === "move") {
      if (action.durationTicks !== (action.path.length - 1) * ticksPerCell) {
        throw new Error(
          `Snapshot move operation ${operation.callId} has an incompatible movement segment`,
        );
      }
      continue;
    }
    if (action.kind !== "interact_object" || action.purpose !== "automatic_traversal") {
      throw new Error(
        `Snapshot move operation ${operation.callId} contains an incompatible action`,
      );
    }
    const object = context.world.objects.get(action.targetEntityId);
    const traversal = object
      ? context.registry.getObject(object.definitionId)?.definition.traversal
      : undefined;
    if (!object || traversal?.interactionId !== action.interactionId) {
      throw new Error(
        `Snapshot move operation ${operation.callId} contains an invalid traversal action`,
      );
    }
  }
}

export function createMoveOperation(): RegisteredOperation {
  return {
    id: OperationIdSchema.parse("core.move"),
    ownerPluginId: null,
    taskSlots: ["BODY"],
    eventIgnore: [],
    publicBehavior: { kind: "visible", label: "moving" },
    arbitrationFailureMappings: {},
    domainFailures: [
      { code: "unknown_target", summary: "Movement target does not exist" },
      { code: "no_known_route", summary: "No known route reaches the target" },
      { code: "movement_blocked", summary: "Movement was blocked" },
    ],
    resultSchema: MoveOperationResultSchema,
    stateSchema: MoveOperationStateSchema,
    argumentsSchema: () => ENTITY_TARGET_ARGUMENTS_SCHEMA,
    initialState: () => ({
      accumulatedObservations: [],
      observationDeliveryCursor: 0,
    }),
    offers: (context) =>
      knownObjects(context).flatMap((known) => {
        const object = context.world.objects.get(known.entityId);
        const definition = object
          ? context.registry.getObject(object.definitionId)?.definition
          : undefined;
        return object &&
          definition &&
          !isAtInteractionPosition(context, object.id)
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
        ? AVAILABLE
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
    fuse: (_context, operation) => undeliveredResult(operation),
    acknowledgeFuseResult: (_context, operation, receipt) => {
      const expected = undeliveredResult(operation);
      const actual = MoveOperationResultSchema.parse(receipt.result);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
          `Operation result for ${operation.callId} does not match its pending observations`,
        );
      }
      const state = moveState(operation);
      return {
        ...operation,
        state: {
          ...state,
          observationDeliveryCursor: state.accumulatedObservations.length,
        },
      };
    },
    terminalResult: (_context, operation) => undeliveredResult(operation),
    validateRestored: assertRestoredMovePlan,
    accumulateObservations: (operation, observations) => {
      const state = moveState(operation);
      const merged = new Map<EntityId, OperationObservation>();
      for (const observation of [
        ...state.accumulatedObservations,
        ...observations,
      ]) {
        if (!merged.has(observation.entityId)) {
          merged.set(observation.entityId, observation);
        }
      }
      return {
        ...operation,
        state: { ...state, accumulatedObservations: [...merged.values()] },
      };
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
  };
}
