import type {
  AgentId,
  Coordinate,
  EntityId,
  EventId,
  JsonValue,
} from "@god-sim/protocol";
import type { ObservedInteractionAvailability } from "@god-sim/plugin-sdk";

export type ObservationKind =
  | "vision"
  | "hearing"
  | "contact"
  | "interaction"
  | "body"
  | "memory";

export interface ObservedObjectValue {
  readonly entityId: EntityId;
  readonly displayName: string;
  readonly status: string;
  readonly summary: string;
  readonly observable: JsonValue;
  readonly interactionAvailability: readonly ObservedInteractionAvailability[];
  readonly position: Coordinate;
  readonly observedAtTick: number;
}

export interface KnownObjectState extends ObservedObjectValue {
  readonly sourceEventId: EventId;
  readonly observationKind: ObservationKind;
}

export interface ObservedAgentValue {
  readonly agentId: AgentId;
  readonly displayName: string;
  readonly position: Coordinate;
  readonly observedAtTick: number;
}

export interface KnownAgentState extends ObservedAgentValue {
  readonly sourceEventId: EventId;
}

export interface KnownTraversalBlocker {
  readonly entityId: EntityId;
  readonly observedObjectVersion: number;
  readonly reasonCode: string;
  readonly sourceEventId: EventId;
}

export interface AgentKnowledge {
  readonly zoneId: string;
  readonly objects: ReadonlyMap<EntityId, KnownObjectState>;
  readonly agents: ReadonlyMap<AgentId, KnownAgentState>;
  readonly visibleEntityIds: ReadonlySet<EntityId>;
  readonly knownTraversalBlockers: ReadonlyMap<EntityId, KnownTraversalBlocker>;
}

export interface ImmediateMemory {
  readonly id: string;
  readonly sourceEventId: EventId;
  readonly formedAtTick: number;
  readonly observationKind: ObservationKind;
  readonly summary: string;
  readonly relatedEntityId: EntityId | null;
}

export interface KnowledgeChange {
  readonly previous: KnownObjectState | null;
  readonly current: KnownObjectState;
}

export function createEmptyKnowledge(zoneId: string): AgentKnowledge {
  return {
    zoneId,
    objects: new Map(),
    agents: new Map(),
    visibleEntityIds: new Set(),
    knownTraversalBlockers: new Map(),
  };
}
