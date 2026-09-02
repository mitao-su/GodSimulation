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
      readonly distance: number;
    };

export interface InteractionQueryView {
  readonly id: string;
  readonly displayName: string;
  readonly duration: OperationDuration;
  readonly taskSlots: readonly TaskTrack[];
  readonly availability: InteractionAvailability;
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

function interactionContext(
  world: WorldState,
  entityId: EntityId,
  agentId: AgentId,
  distance: number,
) {
  const object = world.objects.get(entityId);
  if (!object) throw new Error(`Unknown object instance: ${entityId}`);
  const agent = world.agents.get(agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${agentId}`);
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
      const context = interactionContext(
        world,
        query.entityId,
        query.agentId,
        query.distance,
      );
      return {
        type: "available_interactions",
        interactions: definition.interactions.map((interaction) => {
          const parameters = interaction.parametersSchema.parse({});
          return {
            id: interaction.id,
            displayName: interaction.displayName,
            duration: interaction.resolveDuration(state, context, parameters),
            taskSlots: interaction.taskSlots,
            availability: interaction.canStart(state, context, parameters),
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
      readonly duration: OperationDuration;
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
  const { object, definition, state } = getObjectAndDefinition(
    world,
    registry,
    request.entityId,
  );
  const agent = world.agents.get(request.agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${request.agentId}`);
  const spatial = new SpatialIndex(world, registry);
  const distance = Math.min(
    ...spatial
      .interactionPositions(request.entityId)
      .map((position) => manhattan(agent.position, position)),
  );
  if (distance !== 0) {
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

  const context = interactionContext(world, object.id, agent.id, 0);
  const parameters = interaction.parametersSchema.parse(request.parameters);
  if (request.phase === "start") {
    const availability = interaction.canStart(state, context, parameters);
    if (!availability.available) return { accepted: false, ...availability };
  }

  let proposal: EffectProposal;
  switch (request.phase) {
    case "start":
      proposal = interaction.start?.(state, context, parameters) ?? {
        effects: [],
      };
      break;
    case "complete":
      proposal = interaction.complete(state, context, parameters);
      break;
    case "cancel":
      proposal = interaction.cancel(state, context, parameters);
      break;
    case "fail":
      if (!request.failureCode) {
        throw new Error("An interaction failure proposal requires a failure code");
      }
      proposal = interaction.fail(
        state,
        context,
        parameters,
        request.failureCode,
      );
      break;
  }

  return {
    accepted: true,
    proposal,
    duration: interaction.resolveDuration(state, context, parameters),
    taskSlots: interaction.taskSlots,
  };
}
