import type {
  AgentId,
  Coordinate,
  DecisionCycleId,
  DecisionIdentity,
  DecisionPromptInput,
  EntityId,
  Facing,
  JsonValue,
  OperationCallId,
  OperationResultContext,
  PluginLockHash,
  SimulationRulesLock,
  TaskDecision,
  TechnicalFailure,
  WorldId,
  WorldMode,
} from "@god-sim/protocol";

import type { MapDefinition } from "../map/map-definition";
import type { ActiveOperation } from "../execution/operation";
import type { TaskTracks } from "../execution/task-tracks";
import type { AgentKnowledge, ImmediateMemory } from "../perception/agent-knowledge";

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
  readonly taskTracks: TaskTracks;
  readonly activeOperations: ReadonlyMap<OperationCallId, ActiveOperation>;
  readonly pendingOperationResults: readonly OperationResultContext[];
  readonly knowledge: AgentKnowledge;
  readonly memories: readonly ImmediateMemory[];
}

export interface DecisionCycleState {
  readonly id: DecisionCycleId;
  readonly baseWorldVersion: number;
  readonly requestedAgentIds: readonly AgentId[];
  readonly requests: ReadonlyMap<AgentId, DecisionRequestState>;
}

export interface DecisionRequestState {
  readonly identity: DecisionIdentity;
  readonly promptInput: DecisionPromptInput;
  readonly acceptedProposal: TaskDecision | null;
  readonly failure: TechnicalFailure | null;
}

export type WorldHistory =
  | { readonly mode: "strict"; readonly causalFromSequence: 1 }
  | { readonly mode: "legacy"; readonly causalFromSequence: number };

export interface WorldState {
  readonly id: WorldId;
  readonly name: string;
  readonly version: number;
  readonly tick: number;
  readonly mode: WorldMode;
  readonly suspendedMode: Exclude<WorldMode, "TECHNICALLY_BLOCKED"> | null;
  readonly reviewRequired: boolean;
  readonly randomState: number;
  readonly lastEventSequence: number;
  readonly pluginLockHash: PluginLockHash;
  readonly simulationRulesLock: SimulationRulesLock;
  readonly history: WorldHistory;
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
