import {
  EntityIdSchema,
  JsonObjectSchema,
  OperationDurationSchema,
  type AgentId,
  type Coordinate,
  type JsonObject,
  type OperationCallId,
  type TaskOption,
} from "@god-sim/protocol";
import {
  InteractionContextSchema,
  type InteractionDefinition,
} from "@god-sim/plugin-sdk";
import type { JsonValue } from "@god-sim/protocol";

import {
  EntityTargetArgumentsSchema,
  ObjectInteractionArgumentsSchema,
  WaitOperationArgumentsSchema,
  mergedOptionArguments,
} from "./operation-catalog";
import type {
  ActiveOperation,
  OperationAction,
  OperationPlan,
} from "./operation";
import {
  findPath,
  type AgentNavigationKnowledge,
} from "./path-planner";
import type { PluginRegistry } from "../world/plugin-registry";
import { SpatialIndex } from "../world/spatial-index";
import type { ObjectInstance, WorldState } from "../world/world-state";

export type PrepareOperationResult =
  | { readonly kind: "prepared"; readonly operation: ActiveOperation }
  | {
      readonly kind: "blocked";
      readonly reasonCode: string;
      readonly summary: string;
    };

function interactionContext(
  world: WorldState,
  agentId: AgentId,
  object: ObjectInstance,
) {
  const agent = world.agents.get(agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${agentId}`);
  return InteractionContextSchema.parse({
    worldTick: world.tick,
    trigger: "active_command",
    object: { entityId: object.id, version: object.version },
    actor: {
      agentId,
      position: agent.position,
      needs: { bladder: agent.bladder },
    },
    distance:
      Math.abs(agent.position.x - object.position.x) +
      Math.abs(agent.position.y - object.position.y),
  });
}

function automaticTraversalObjectsAt(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
  position: Coordinate,
): readonly ObjectInstance[] {
  const spatial = new SpatialIndex(world, registry);
  return spatial
    .blockingObjectsAt(position, agentId)
    .filter((object) => {
      const registered = registry.getObject(object.definitionId);
      return registered?.definition.traversal !== undefined;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function traversalDuration(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
  object: ObjectInstance,
  interactionId: string,
): number {
  const definition = registry.getObject(object.definitionId)?.definition;
  const interaction = definition?.interactions.find(
    (candidate) => candidate.id === interactionId,
  );
  if (!interaction) {
    throw new Error(
      `Object ${object.id} has no traversal interaction ${interactionId}`,
    );
  }
  const duration = OperationDurationSchema.parse(
    interaction.resolveDuration(
      definition!.stateSchema.parse(object.state),
      interactionContext(world, agentId, object),
      interaction.parametersSchema.parse({}),
    ),
  );
  if (duration.kind !== "fixed") {
    throw new Error(
      `Traversal interaction ${object.id}:${interactionId} must have fixed duration`,
    );
  }
  return duration.totalTicks;
}

function createMoveActions(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
  callId: OperationCallId,
  path: readonly Coordinate[],
  actionNamespace: string = callId,
): readonly OperationAction[] {
  const actions: OperationAction[] = [];
  let segment: Coordinate[] = [path[0]!];
  const ticksPerCell =
    world.simulationRulesLock.rules.operations.move.ticksPerCell;

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
    const traversalObjects = automaticTraversalObjectsAt(
      world,
      registry,
      agentId,
      position,
    );
    if (traversalObjects.length === 0) {
      segment.push(position);
      continue;
    }
    pushMove();
    for (const object of traversalObjects) {
      const interactionId = registry.getObject(object.definitionId)?.definition
        .traversal?.interactionId;
      if (!interactionId) {
        throw new Error(`Object ${object.id} has no traversal capability`);
      }
      actions.push({
        id: `${actionNamespace}:action:${actions.length}`,
        kind: "interact_object",
        purpose: "automatic_traversal",
        targetEntityId: object.id,
        interactionId,
        durationTicks: traversalDuration(
          world,
          registry,
          agentId,
          object,
          interactionId,
        ),
        progressTicks: 0,
        started: false,
      });
    }
    segment = [path[index - 1]!, position];
  }
  pushMove();
  return actions;
}

export type ReplanMoveOperationResult =
  | { readonly kind: "replanned"; readonly operation: ActiveOperation }
  | {
      readonly kind: "blocked";
      readonly reasonCode: string;
      readonly summary: string;
    };

export function replanMoveOperation(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
  operation: ActiveOperation,
  knowledge: AgentNavigationKnowledge,
): ReplanMoveOperationResult {
  if (operation.operationId !== "core.move") {
    throw new Error(`Operation ${operation.callId} is not a core move`);
  }
  const parsed = EntityTargetArgumentsSchema.parse(operation.arguments);
  const targetEntityId = EntityIdSchema.parse(parsed.targetEntityId);
  if (!world.objects.has(targetEntityId)) {
    return {
      kind: "blocked",
      reasonCode: "unknown_target",
      summary: `Unknown target ${targetEntityId}`,
    };
  }
  const path = findPath(
    world,
    registry,
    agentId,
    new SpatialIndex(world, registry).interactionPositions(targetEntityId),
    knowledge,
  );
  if (path.kind === "not_found") {
    return {
      kind: "blocked",
      reasonCode: "no_known_route",
      summary: "No known route to target",
    };
  }
  return {
    kind: "replanned",
    operation: {
      ...operation,
      plan: {
        currentActionIndex: 0,
        actions: createMoveActions(
          world,
          registry,
          agentId,
          operation.callId,
          path.path,
          `${operation.callId}:replan:${operation.progressTicks}`,
        ),
      },
    },
  };
}

function directInteraction(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
  operationId: string,
  argumentsValue: JsonObject,
): {
  readonly object: ObjectInstance;
  readonly interaction: InteractionDefinition<JsonValue, JsonObject>;
  readonly parameters: JsonObject;
} | PrepareOperationResult {
  const parsed = ObjectInteractionArgumentsSchema.parse(argumentsValue);
  const entityId = EntityIdSchema.parse(parsed.targetEntityId);
  const object = world.objects.get(entityId);
  if (!object) {
    return {
      kind: "blocked",
      reasonCode: "unknown_target",
      summary: `Unknown target ${entityId}`,
    };
  }
  const definition = registry.getObject(object.definitionId)?.definition;
  if (!definition) throw new Error(`Unknown object definition ${object.definitionId}`);
  const suffix = "." + object.definitionId + ".";
  if (!operationId.includes(suffix)) {
    throw new Error("Direct interaction is missing its operation binding");
  }
  const localId = operationId.slice(operationId.indexOf(suffix) + suffix.length);
  const interaction = definition.interactions.find(
    (candidate) => candidate.id === localId,
  ) as InteractionDefinition<JsonValue, JsonObject> | undefined;
  if (!interaction) {
    return {
      kind: "blocked",
      reasonCode: "unknown_interaction",
      summary: `${object.id} has no ${localId} interaction`,
    };
  }
  const spatial = new SpatialIndex(world, registry);
  const agent = world.agents.get(agentId)!;
  const inRange = spatial.interactionPositions(object.id).some(
    (position) =>
      position.x === agent.position.x && position.y === agent.position.y,
  );
  if (!inRange) {
    return {
      kind: "blocked",
      reasonCode: "out_of_range",
      summary: `${object.id} is outside interaction range`,
    };
  }
  const state = definition.stateSchema.parse(object.state);
  const parameters = interaction.parametersSchema.parse(parsed.parameters);
  const availability = interaction.canStart(
    state,
    interactionContext(world, agentId, object),
    parameters,
  );
  if (!availability.available) {
    return {
      kind: "blocked",
      reasonCode: availability.reasonCode,
      summary: availability.summary,
    };
  }
  return { object, interaction, parameters };
}

export function prepareOperationCall(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
  optionValue: Extract<TaskOption, { kind: "operation" }>,
  argumentsInput: JsonObject,
  callId: OperationCallId,
): PrepareOperationResult {
  const option = optionValue;
  const merged = mergedOptionArguments(option, JsonObjectSchema.parse(argumentsInput));
  const base = {
    callId,
    operationId: option.operationId,
    taskOptionId: option.id,
    label: option.label,
    taskSlots: option.taskSlots,
    startedAtTick: world.tick,
    progressTicks: 0,
  } as const;

  if (option.operationId === "core.wait") {
    const parsed = WaitOperationArgumentsSchema.parse(merged);
    const max = world.simulationRulesLock.rules.operations.wait.maxDurationTicks;
    if (parsed.durationTicks > max) {
      return {
        kind: "blocked",
        reasonCode: "invalid_duration",
        summary: `Wait duration exceeds ${max} ticks`,
      };
    }
    return {
      kind: "prepared",
      operation: {
        ...base,
        arguments: parsed,
        duration: { kind: "fixed", totalTicks: parsed.durationTicks },
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
      },
    };
  }

  if (option.operationId === "core.observe") {
    const parsed = EntityTargetArgumentsSchema.parse(merged);
    const targetEntityId = EntityIdSchema.parse(parsed.targetEntityId);
    const agent = world.agents.get(agentId);
    if (!agent?.knowledge.visibleEntityIds.has(targetEntityId)) {
      return {
        kind: "blocked",
        reasonCode: "target_not_visible",
        summary: `${targetEntityId} is not currently visible`,
      };
    }
    const totalTicks =
      world.simulationRulesLock.rules.operations.observe.durationTicks;
    return {
      kind: "prepared",
      operation: {
        ...base,
        arguments: { targetEntityId },
        duration: { kind: "fixed", totalTicks },
        plan: {
          currentActionIndex: 0,
          actions: [
            {
              id: `${callId}:action:0`,
              kind: "observe",
              targetEntityId,
              durationTicks: totalTicks,
              progressTicks: 0,
            },
          ],
        },
      },
    };
  }

  if (option.operationId === "core.move") {
    const parsed = EntityTargetArgumentsSchema.parse(merged);
    const targetEntityId = EntityIdSchema.parse(parsed.targetEntityId);
    const target = world.objects.get(targetEntityId);
    if (!target) {
      return {
        kind: "blocked",
        reasonCode: "unknown_target",
        summary: `Unknown target ${targetEntityId}`,
      };
    }
    const agent = world.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent instance: ${agentId}`);
    const path = findPath(
      world,
      registry,
      agentId,
      new SpatialIndex(world, registry).interactionPositions(targetEntityId),
      agent.knowledge,
    );
    if (path.kind === "not_found") {
      return {
        kind: "blocked",
        reasonCode: "no_known_route",
        summary: "No known route to target",
      };
    }
    return {
      kind: "prepared",
      operation: {
        ...base,
        arguments: { targetEntityId },
        duration: { kind: "indeterminate" },
        plan: {
          currentActionIndex: 0,
          actions: createMoveActions(world, registry, agentId, callId, path.path),
        },
      },
    };
  }

  const direct = directInteraction(
    world,
    registry,
    agentId,
    option.operationId,
    merged,
  );
  if ("kind" in direct) return direct;
  const definition = registry.getObject(direct.object.definitionId)!.definition;
  const state = definition.stateSchema.parse(direct.object.state);
  const duration = OperationDurationSchema.parse(
    direct.interaction.resolveDuration(
      state,
      interactionContext(world, agentId, direct.object),
      direct.parameters,
    ),
  );
  const actionDuration =
    duration.kind === "fixed" ? duration.totalTicks : Number.MAX_SAFE_INTEGER;
  const plan: OperationPlan = {
    currentActionIndex: 0,
    actions: [
      {
        id: `${callId}:action:0`,
        kind: "interact_object",
        purpose: "direct",
        targetEntityId: direct.object.id,
        interactionId: direct.interaction.id,
        durationTicks: actionDuration,
        progressTicks: 0,
        started: false,
      },
    ],
  };
  return {
    kind: "prepared",
    operation: {
      ...base,
      arguments: {
        targetEntityId: direct.object.id,
        parameters: direct.parameters,
      },
      duration,
      plan,
    },
  };
}
