import type { AgentId, EntityId } from "@god-sim/protocol";

import type { AgentState, ObjectInstance, WorldState } from "./world-state";

export function getAgentOrThrow(world: WorldState, agentId: AgentId): AgentState {
  const agent = world.agents.get(agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${agentId}`);
  return agent;
}

export function getObjectOrThrow(world: WorldState, entityId: EntityId): ObjectInstance {
  const object = world.objects.get(entityId);
  if (!object) throw new Error(`Unknown object instance: ${entityId}`);
  return object;
}
