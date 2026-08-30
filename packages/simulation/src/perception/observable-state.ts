import { JsonValueSchema, type AgentId, type EventId } from "@god-sim/protocol";
import { ObservationContextSchema } from "@god-sim/plugin-sdk";

import type { KnowledgeChange } from "./agent-knowledge";
import type { PluginRegistry } from "../world/plugin-registry";
import type { ObjectInstance, WorldState } from "../world/world-state";

export function observeObject(
  world: WorldState,
  registry: PluginRegistry,
  observerAgentId: AgentId,
  object: ObjectInstance,
  sourceEventId: EventId,
): KnowledgeChange["current"] {
  const registered = registry.getObject(object.definitionId);
  if (!registered) throw new Error(`Unknown object definition: ${object.definitionId}`);
  const state = registered.definition.stateSchema.parse(object.state);
  const observable = registered.definition.observe(
    state,
    ObservationContextSchema.parse({ kind: "vision", observerAgentId }),
  );
  return {
    entityId: object.id,
    displayName: registered.definition.displayName,
    status: observable.status,
    summary: observable.summary,
    observable: JsonValueSchema.parse(observable.details),
    position: object.position,
    sourceEventId,
    observedAtTick: world.tick,
    observationKind: "vision",
  };
}
