import type {
  AgentId,
  Coordinate,
  EntityId,
  JsonObject,
  OperationDuration,
  TaskTrack,
} from "@god-sim/protocol";
import {
  InteractionContextSchema,
  type EffectProposal,
  type InteractionAvailability,
  type InteractionDefinition,
} from "@god-sim/plugin-sdk";

import type { PluginRegistry } from "../world/plugin-registry";
import { SpatialIndex } from "../world/spatial-index";
import type { WorldState } from "../world/world-state";

export type ObjectQuery =
  | {
      readonly type: "movement" | "visibility";
      readonly position: Coordinate;
      readonly agentId?: AgentId;
    }
  | {
      readonly type: "occupancy";
      readonly entityId: EntityId;
    }
  | {
      readonly type: "available_interactions";
      readonly entityId: EntityId;
      readonly agentId: AgentId;
    };

export interface InteractionQueryView {
  readonly id: string;
  readonly displayName: string;
  readonly taskSlots: readonly TaskTrack[];
  /**
   * True when the interaction's parameters schema rejects an empty object,
   * meaning duration and availability cannot be previewed without concrete
   * parameters. In that case `duration` and `availability` are `null` and
   * callers must supply real parameters through the proposal path instead.
   */
  readonly requiresParameters: boolean;
  readonly duration: OperationDuration | null;
  readonly availability: InteractionAvailability | null;
}

export type ObjectQueryResult =
  | {
      readonly type: "movement" | "visibility";
      readonly blocked: boolean;
      readonly objectIds: readonly EntityId[];
    }
  | { readonly type: "occupancy"; readonly occupiedBy: string | null }
  | {
      readonly type: "available_interactions";
      readonly interactions: readonly InteractionQueryView[];
    };

function getObjectAndDefinition(
  world: WorldState,
  registry: PluginRegistry,
  entityId: EntityId,
) {
  const object = world.objects.get(entityId);
  if (!object) throw new Error(`Unknown object instance: ${entityId}`);
  const registered = registry.getObject(object.definitionId);
  if (!registered) {
    throw new Error(`Unknown object definition: ${object.definitionId}`);
  }
  const state = registered.definition.stateSchema.parse(object.state);
  return { object, definition: registered.definition, state };
}

export function createInteractionContext(
  world: WorldState,
  registry: PluginRegistry,
  entityId: EntityId,
  agentId: AgentId,
) {
  const object = world.objects.get(entityId);
  if (!object) throw new Error(`Unknown object instance: ${entityId}`);
  const agent = world.agents.get(agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${agentId}`);
  const spatial = new SpatialIndex(world, registry);
  const positions = spatial.interactionPositions(entityId);
  if (positions.length === 0) {
    throw new Error(`Object ${entityId} has no interaction position`);
  }
  const distance = Math.min(
    ...positions.map((position) => manhattan(agent.position, position)),
  );
  return InteractionContextSchema.parse({
    worldTick: world.tick,
    trigger: "active_command",
    object: { entityId, version: object.version },
    actor: {
      agentId,
      position: agent.position,
      needs: { bladder: agent.bladder },
    },
    distance,
  });
}

export function queryObject(
  world: WorldState,
  registry: PluginRegistry,
  query: ObjectQuery,
): ObjectQueryResult {
  const spatial = new SpatialIndex(world, registry);
  switch (query.type) {
    case "movement": {
      const objects = spatial.blockingObjectsAt(query.position, query.agentId);
      return {
        type: "movement",
        blocked: objects.length > 0,
        objectIds: objects.map((object) => object.id),
      };
    }
    case "visibility": {
      const objects = spatial.occludingObjectsAt(query.position, query.agentId);
      return {
        type: "visibility",
        blocked: objects.length > 0,
        objectIds: objects.map((object) => object.id),
      };
    }
    case "occupancy":
      return {
        type: "occupancy",
        occupiedBy: spatial.occupant(query.entityId),
      };
    case "available_interactions": {
      const { definition, state } = getObjectAndDefinition(
        world,
        registry,
        query.entityId,
      );
      const context = createInteractionContext(
        world,
        registry,
        query.entityId,
        query.agentId,
      );
      return {
        type: "available_interactions",
        interactions: definition.interactions.map((interaction) => {
          // Interactions with required parameters cannot be previewed with
          // an empty argument object; surface them as parameter-requiring
          // entries instead of letting the schema error escape the query.
          const parameters = interaction.parametersSchema.safeParse({});
          if (!parameters.success) {
            return {
              id: interaction.id,
              displayName: interaction.displayName,
              taskSlots: interaction.taskSlots,
              requiresParameters: true,
              duration: null,
              availability: null,
            };
          }
          return {
            id: interaction.id,
            displayName: interaction.displayName,
            taskSlots: interaction.taskSlots,
            requiresParameters: false,
            duration: interaction.resolveDuration(
              state,
              context,
              parameters.data,
            ),
            availability: interaction.canStart(state, context, parameters.data),
          };
        }),
      };
    }
  }
}

export interface InteractionRequest {
  readonly agentId: AgentId;
  readonly entityId: EntityId;
  readonly interactionId: string;
  readonly parameters: JsonObject;
  readonly phase: "start" | "complete" | "cancel" | "fail";
  readonly failureCode?: string;
}

export type InteractionProposalResult =
  | {
      readonly accepted: true;
      readonly proposal: EffectProposal;
      readonly result: JsonObject | null;
      readonly taskSlots: readonly TaskTrack[];
    }
  | {
      readonly accepted: false;
      readonly reasonCode: string;
      readonly summary: string;
    };

function manhattan(a: Coordinate, b: Coordinate): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function proposeInteraction(
  world: WorldState,
  registry: PluginRegistry,
  request: InteractionRequest,
): InteractionProposalResult {
  const { definition, state } = getObjectAndDefinition(
    world,
    registry,
    request.entityId,
  );
  const agent = world.agents.get(request.agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${request.agentId}`);
  const context = createInteractionContext(
    world,
    registry,
    request.entityId,
    request.agentId,
  );
  if (
    context.distance !== 0 &&
    (request.phase === "start" || request.phase === "complete")
  ) {
    return {
      accepted: false,
      reasonCode: "not_at_interaction_position",
      summary: `${request.agentId} is not at an interaction position for ${request.entityId}`,
    };
  }

  const interaction = definition.interactions.find(
    (candidate) => candidate.id === request.interactionId,
  ) as InteractionDefinition<typeof state, JsonObject> | undefined;
  if (!interaction) {
    return {
      accepted: false,
      reasonCode: "unknown_interaction",
      summary: `Unknown interaction ${request.interactionId} on ${request.entityId}`,
    };
  }

  const parameters = interaction.parametersSchema.parse(request.parameters);
  if (request.phase === "start") {
    const availability = interaction.canStart(state, context, parameters);
    if (!availability.available) return { accepted: false, ...availability };
  }

  let proposal: EffectProposal;
  let result: JsonObject | null = null;
  switch (request.phase) {
    case "start":
      proposal = interaction.start?.(state, context, parameters) ?? {
        effects: [],
      };
      break;
    case "complete": {
      const lifecycle = interaction.complete(state, context, parameters);
      proposal = { effects: lifecycle.effects };
      result =
        lifecycle.result === undefined
          ? null
          : interaction.resultSchema.parse(lifecycle.result);
      break;
    }
    case "cancel": {
      const lifecycle = interaction.cancel(state, context, parameters);
      proposal = { effects: lifecycle.effects };
      result =
        lifecycle.result === undefined
          ? null
          : interaction.resultSchema.parse(lifecycle.result);
      break;
    }
    case "fail": {
      if (!request.failureCode) {
        throw new Error("An interaction failure proposal requires a failure code");
      }
      const lifecycle = interaction.fail(
        state,
        context,
        parameters,
        request.failureCode,
      );
      proposal = { effects: lifecycle.effects };
      result =
        lifecycle.result === undefined
          ? null
          : interaction.resultSchema.parse(lifecycle.result);
      break;
    }
  }

  // The router's execution lifecycle never resolves a duration. Durations
  // are owned by the operation planner, which locks them once at call
  // creation into `ActiveOperation.duration`; by the time any phase here
  // runs (including `start` of an already-prepared call) the world may
  // have moved on, and re-evaluating a state-dependent resolver could
  // drift the locked value or throw mid-tick.
  return {
    accepted: true,
    proposal,
    result,
    taskSlots: interaction.taskSlots,
  };
}
