import type {
  AgentId,
  Coordinate,
  EntityId,
  Facing,
  JsonValue,
  PluginLockHash,
  TechnicalFailure,
  WorldId,
  WorldMode,
} from "@god-sim/protocol";

import type { MapDefinition } from "../map/map-definition";
import type { ActionPlan, ActiveGoal } from "../execution/action";
import type { BodySlotReservations } from "../execution/body-slots";

export interface ObjectInstance {
  readonly id: EntityId;
  readonly definitionId: string;
  readonly version: number;
  readonly position: Coordinate;
  readonly facing: Facing;
  readonly state: JsonValue;
}

export type BladderSensation = "comfortable" | "noticeable" | "urgent";

export interface AgentState {
  readonly id: AgentId;
  readonly definitionId: string;
  readonly displayName: string;
  readonly resourceId: string;
  readonly animationSetId: string;
  readonly position: Coordinate;
  readonly facing: Facing;
  readonly bladder: number;
  readonly bladderSensation: BladderSensation;
  readonly currentGoal: ActiveGoal | null;
  readonly actionPlan: ActionPlan | null;
  readonly bodySlots: BodySlotReservations;
}

export interface DecisionCycleState {
  readonly id: string;
  readonly baseWorldVersion: number;
  readonly requestedAgentIds: readonly AgentId[];
}

export interface WorldState {
  readonly id: WorldId;
  readonly name: string;
  readonly version: number;
  readonly tick: number;
  readonly mode: WorldMode;
  readonly reviewRequired: boolean;
  readonly randomState: number;
  readonly lastEventSequence: number;
  readonly pluginLockHash: PluginLockHash;
  readonly map: MapDefinition;
  readonly agents: ReadonlyMap<AgentId, AgentState>;
  readonly objects: ReadonlyMap<EntityId, ObjectInstance>;
  readonly decisionCycle: DecisionCycleState | null;
  readonly technicalFailure: TechnicalFailure | null;
}

export function bladderSensation(value: number): BladderSensation {
  if (value >= 75) return "urgent";
  if (value >= 45) return "noticeable";
  return "comfortable";
}
