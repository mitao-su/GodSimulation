import type { AgentId, Coordinate, EntityId } from "@god-sim/protocol";
import type {
  BodySlot,
  EffectProposal,
  InteractionAvailability,
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
  readonly durationTicks: number;
  readonly slots: readonly BodySlot[];
  readonly availability: InteractionAvailability;
}

export type ObjectQueryResult =
  | { readonly type: "movement" | "visibility"; readonly blocked: boolean; readonly objectIds: readonly EntityId[] }
  | { readonly type: "occupancy"; readonly occupiedBy: string | null }
  | { readonly type: "available_interactions"; readonly interactions: readonly InteractionQueryView[] };

function getObjectAndDefinition(world: WorldState, registry: PluginRegistry, entityId: EntityId) {
  const object = world.objects.get(entityId);
  if (!object) throw new Error(`Unknown object instance: ${entityId}`);
  const registered = registry.getObject(object.definitionId);
  if (!registered) throw new Error(`Unknown object definition: ${object.definitionId}`);
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
  return {
    worldTick: world.tick,
    trigger: "active_command" as const,
    object: { entityId, version: object.version },
    actor: {
      agentId,
      position: agent.position,
      needs: { bladder: agent.bladder },
    },
    distance,
  };
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
      return { type: "movement", blocked: objects.length > 0, objectIds: objects.map((object) => object.id) };
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
      return { type: "occupancy", occupiedBy: spatial.occupant(query.entityId) };
    case "available_interactions": {
      const { definition, state } = getObjectAndDefinition(world, registry, query.entityId);
      const context = interactionContext(
        world,
        query.entityId,
        query.agentId,
        query.distance,
      );
      return {
        type: "available_interactions",
        interactions: definition.interactions.map((interaction) => ({
          id: interaction.id,
          displayName: interaction.displayName,
          durationTicks: interaction.durationTicks,
          slots: interaction.slots,
          availability: interaction.canStart(state, context),
        })),
      };
    }
  }
}

export interface InteractionRequest {
  readonly agentId: AgentId;
  readonly entityId: EntityId;
  readonly interactionId: string;
  readonly phase: "start" | "complete";
}

export type InteractionProposalResult =
  | {
      readonly accepted: true;
      readonly proposal: EffectProposal;
      readonly durationTicks: number;
      readonly slots: readonly BodySlot[];
    }
  | { readonly accepted: false; readonly reasonCode: string; readonly summary: string };

function manhattan(a: Coordinate, b: Coordinate): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function proposeInteraction(
  world: WorldState,
  registry: PluginRegistry,
  request: InteractionRequest,
): InteractionProposalResult {
  const { object, definition, state } = getObjectAndDefinition(world, registry, request.entityId);
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
  );
  if (!interaction) {
    return {
      accepted: false,
      reasonCode: "unknown_interaction",
      summary: `Unknown interaction ${request.interactionId} on ${request.entityId}`,
    };
  }

  const context = interactionContext(world, object.id, agent.id, 1);
  const availability = interaction.canStart(state, context);
  if (!availability.available) return { accepted: false, ...availability };

  return {
    accepted: true,
    proposal:
      request.phase === "start"
        ? (interaction.start?.(state, context) ?? { effects: [] })
        : interaction.complete(state, context),
    durationTicks: interaction.durationTicks,
    slots: interaction.slots,
  };
}
