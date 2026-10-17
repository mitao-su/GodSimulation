import { JsonValueSchema, type DomainEvent } from "@god-sim/protocol";
import { EffectProposalSchema, type EffectProposal } from "@god-sim/plugin-sdk";

import { createEffectEvents, type EventChange, type EventMetadata } from "./domain-event-factory";
import type { PluginRegistry } from "../world/plugin-registry";
import { SpatialIndex } from "../world/spatial-index";
import { hasElapsedMoveStep } from "../execution/core/hosted-move-state";
import { bladderSensation, type WorldState } from "../world/world-state";

export interface CommitRejection {
  readonly code: string;
  readonly message: string;
  readonly effectIndex: number;
}

export type CommitResult =
  | {
      readonly accepted: true;
      readonly world: WorldState;
      readonly events: readonly DomainEvent[];
    }
  | {
      readonly accepted: false;
      readonly world: WorldState;
      readonly reason: CommitRejection;
    };

function rejected(
  world: WorldState,
  effectIndex: number,
  code: string,
  message: string,
): CommitResult {
  return { accepted: false, world, reason: { effectIndex, code, message } };
}

export function commitProposal(
  world: WorldState,
  registry: PluginRegistry,
  proposalInput: EffectProposal,
  metadata: EventMetadata,
): CommitResult {
  const parsed = EffectProposalSchema.safeParse(proposalInput);
  if (!parsed.success) return rejected(world, 0, "invalid_proposal", parsed.error.message);
  if (parsed.data.effects.length === 0) return { accepted: true, world, events: [] };

  const agents = new Map(world.agents);
  const objects = new Map(world.objects);
  const changedObjectIds = new Set<string>();
  const movementAgentIds = new Set<string>();
  const changes: EventChange[] = [];

  for (const [effectIndex, effect] of parsed.data.effects.entries()) {
    switch (effect.type) {
      case "move_agent":
      case "record_traversal_blocker": {
        const agent = agents.get(effect.agentId);
        const operation = agent?.activeOperations.get(effect.callId);
        if (
          world.mode !== "RUNNING" || !agent || !operation ||
          operation.operationId !== "core.move" ||
          metadata.correlationId !== effect.callId ||
          agent.taskTracks.BODY.kind !== "operation" ||
          agent.taskTracks.BODY.callId !== effect.callId ||
          operation.progressTicks !== effect.expectedProgressTicks
        ) {
          return rejected(world, effectIndex, "invalid_movement_call", "Movement must belong to the current running BODY call and progress.");
        }
        if (movementAgentIds.has(effect.agentId)) {
          return rejected(world, effectIndex, "duplicate_movement_effect", "A proposal may advance a character's movement only once.");
        }
        const spatial = new SpatialIndex({ ...world, agents, objects }, registry);
        if (effect.type === "move_agent") {
          if (agent.position.x !== effect.from.x || agent.position.y !== effect.from.y) {
            return rejected(world, effectIndex, "stale_agent_position", "Movement departure does not match the character's position.");
          }
          if (Math.abs(effect.to.x - effect.from.x) + Math.abs(effect.to.y - effect.from.y) !== 1) {
            return rejected(world, effectIndex, "invalid_movement_step", "Movement must reach one cardinally adjacent cell.");
          }
          if (effect.to.x >= world.map.width || effect.to.y >= world.map.height) {
            return rejected(world, effectIndex, "movement_out_of_bounds", "Movement destination is outside the map.");
          }
          if (spatial.blockingObjectsAt(effect.to, effect.agentId).length > 0) {
            return rejected(world, effectIndex, "movement_blocked", "Movement destination is blocked.");
          }
          if (!hasElapsedMoveStep(operation.state, world.simulationRulesLock.rules.operations.move.ticksPerCell)) {
            return rejected(world, effectIndex, "movement_too_early", "Movement has not consumed a cell's travel time.");
          }
          agents.set(effect.agentId, { ...agent, position: effect.to });
        } else {
          const object = objects.get(effect.entityId);
          const definition = object && registry.getObject(object.definitionId)?.definition;
          const traversal = definition?.interactions.find((entry) => entry.id === definition.traversal?.interactionId);
          if (!object || object.version !== effect.expectedObjectVersion || !traversal ||
              !spatial.objectBlocksMovement(object.id, agent.id) ||
              (!traversal.domainFailures.some((entry) => entry.code === effect.reasonCode) && effect.reasonCode !== "out_of_range")) {
            return rejected(world, effectIndex, "invalid_traversal_blocker", "Traversal failure must identify a current blocker and a declared failure.");
          }
        }
        movementAgentIds.add(effect.agentId);
        changes.push({ effect });
        break;
      }
      case "set_agent_need": {
        const agent = agents.get(effect.agentId);
        if (!agent) {
          return rejected(
            world,
            effectIndex,
            "unknown_agent",
            `Unknown agent ${effect.agentId}`,
          );
        }
        agents.set(effect.agentId, {
          ...agent,
          bladder: effect.value,
          bladderSensation: bladderSensation(effect.value),
        });
        changes.push({ effect, previousNeedValue: agent.bladder });
        break;
      }

      case "replace_object_state":
      case "reserve_occupancy":
      case "release_occupancy": {
        if (
          effect.type !== "replace_object_state" &&
          !agents.has(effect.agentId)
        ) {
          return rejected(
            world,
            effectIndex,
            "unknown_agent",
            `Unknown agent ${effect.agentId}`,
          );
        }
        if (changedObjectIds.has(effect.entityId)) {
          return rejected(
            world,
            effectIndex,
            "duplicate_object_effect",
            `Proposal changes ${effect.entityId} more than once`,
          );
        }
        const object = objects.get(effect.entityId);
        if (!object) {
          return rejected(
            world,
            effectIndex,
            "unknown_object",
            `Unknown object ${effect.entityId}`,
          );
        }
        if (object.version !== effect.expectedObjectVersion) {
          return rejected(
            world,
            effectIndex,
            "stale_object_version",
            `Expected ${effect.entityId} version ${effect.expectedObjectVersion}, found ${object.version}`,
          );
        }
        const registered = registry.getObject(object.definitionId);
        if (!registered) {
          return rejected(
            world,
            effectIndex,
            "unknown_definition",
            `Unknown definition ${object.definitionId}`,
          );
        }

        let nextState: unknown;
        if (effect.type === "replace_object_state") {
          nextState = effect.state;
        } else {
          const occupancy = registered.definition.occupancy;
          if (!occupancy) {
            return rejected(
              world,
              effectIndex,
              "not_occupiable",
              `${effect.entityId} has no occupancy capability`,
            );
          }
          const currentState = registered.definition.stateSchema.parse(object.state);
          const currentOccupant = occupancy.occupant(currentState);
          if (
            effect.type === "reserve_occupancy" &&
            currentOccupant !== null &&
            currentOccupant !== effect.agentId
          ) {
            return rejected(
              world,
              effectIndex,
              "occupied",
              `${effect.entityId} is occupied by ${currentOccupant}`,
            );
          }
          if (effect.type === "release_occupancy" && currentOccupant !== effect.agentId) {
            return rejected(
              world,
              effectIndex,
              "not_occupancy_owner",
              `${effect.agentId} does not occupy ${effect.entityId}`,
            );
          }
          nextState = occupancy.withOccupant(
            currentState,
            effect.type === "reserve_occupancy" ? effect.agentId : null,
          );
        }

        let validatedState;
        try {
          validatedState = JsonValueSchema.parse(
            registered.definition.stateSchema.parse(nextState),
          );
        } catch (error) {
          return rejected(
            world,
            effectIndex,
            "invalid_object_state",
            error instanceof Error ? error.message : String(error),
          );
        }
        const nextObject = { ...object, version: object.version + 1, state: validatedState };
        objects.set(object.id, nextObject);
        changedObjectIds.add(object.id);
        changes.push({
          effect,
          objectVersion: nextObject.version,
          objectState: nextObject.state,
        });
        break;
      }

      case "emit_perceptible_result": {
        if (!objects.has(effect.sourceEntityId) && !agents.has(effect.sourceEntityId as never)) {
          return rejected(
            world,
            effectIndex,
            "unknown_source",
            `Unknown perceptible source ${effect.sourceEntityId}`,
          );
        }
        const missingAudience = effect.audienceAgentIds.find((agentId) => !agents.has(agentId));
        if (missingAudience) {
          return rejected(
            world,
            effectIndex,
            "unknown_audience",
            `Unknown audience agent ${missingAudience}`,
          );
        }
        changes.push({ effect });
        break;
      }
    }
  }

  const committedWorldVersion = world.version + 1;
  const events = createEffectEvents(world, committedWorldVersion, changes, metadata);
  for (const [index, change] of changes.entries()) {
    if (change.effect.type !== "record_traversal_blocker") continue;
    const effect = change.effect;
    const agent = agents.get(effect.agentId)!;
    agents.set(agent.id, {
      ...agent,
      knowledge: {
        ...agent.knowledge,
        knownTraversalBlockers: new Map(agent.knowledge.knownTraversalBlockers).set(effect.entityId, {
          entityId: effect.entityId,
          observedObjectVersion: effect.expectedObjectVersion,
          reasonCode: effect.reasonCode,
          sourceEventId: events[index]!.eventId,
        }),
      },
    });
  }
  return {
    accepted: true,
    world: {
      ...world,
      version: committedWorldVersion,
      lastEventSequence: world.lastEventSequence + events.length,
      agents,
      objects,
    },
    events,
  };
}
