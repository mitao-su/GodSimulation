import { JsonValueSchema, type AgentId } from "@god-sim/protocol";
import {
  ObservableObjectStateSchema,
  ObservationContextSchema,
} from "@god-sim/plugin-sdk";

import type { ObservedObjectValue } from "./agent-knowledge";
import type { PluginRegistry } from "../world/plugin-registry";
import type { ObjectInstance, WorldState } from "../world/world-state";

export function observeObject(
  world: WorldState,
  registry: PluginRegistry,
  observerAgentId: AgentId,
  object: ObjectInstance,
): ObservedObjectValue {
  const registered = registry.getObject(object.definitionId);
  if (!registered) throw new Error(`Unknown object definition: ${object.definitionId}`);
  const state = registered.definition.stateSchema.parse(object.state);
  const observable = ObservableObjectStateSchema.parse(
    registered.definition.observe(
      state,
      ObservationContextSchema.parse({ kind: "vision", observerAgentId }),
    ),
  );
  return {
    entityId: object.id,
    displayName: registered.definition.displayName,
    status: observable.status,
    summary: observable.summary,
    observable: JsonValueSchema.parse(observable.details),
    interactionAvailability: observable.interactionAvailability ?? [],
    position: object.position,
    observedAtTick: world.tick,
  };
}
