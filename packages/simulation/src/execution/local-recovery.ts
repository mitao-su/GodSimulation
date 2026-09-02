import type {
  AgentId,
  EntityId,
  EventId,
  OperationCallId,
} from "@god-sim/protocol";

import {
  replanMoveOperation,
  type ReplanMoveOperationResult,
} from "./operation-planner";
import type { ActiveOperation } from "./operation";
import type { AgentNavigationKnowledge } from "./path-planner";
import type { PluginRegistry } from "../world/plugin-registry";
import type { WorldState } from "../world/world-state";

export interface TraversalFailure {
  readonly callId: OperationCallId;
  readonly entityId: EntityId;
  readonly observedObjectVersion: number;
  readonly reasonCode: string;
  readonly sourceEventId: EventId;
}

export type RecoveryResult =
  | {
      readonly kind: "replanned";
      readonly operation: ActiveOperation;
      readonly knowledge: AgentNavigationKnowledge;
    }
  | {
      readonly kind: "needs_decision";
      readonly reasonCode: string;
      readonly knowledge: AgentNavigationKnowledge;
    };

export function recoverBlockedOperation(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
  failure: TraversalFailure,
  knowledge: AgentNavigationKnowledge,
): RecoveryResult {
  const operation = world.agents
    .get(agentId)
    ?.activeOperations.get(failure.callId);
  if (!operation) {
    throw new Error(`Operation ${failure.callId} is not active for ${agentId}`);
  }
  const knownTraversalBlockers = new Map(knowledge.knownTraversalBlockers);
  knownTraversalBlockers.set(failure.entityId, {
    entityId: failure.entityId,
    observedObjectVersion: failure.observedObjectVersion,
    reasonCode: failure.reasonCode,
    sourceEventId: failure.sourceEventId,
  });
  const updatedKnowledge = { knownTraversalBlockers };
  if (operation.operationId !== "core.move") {
    return {
      kind: "needs_decision",
      reasonCode: failure.reasonCode,
      knowledge: updatedKnowledge,
    };
  }
  const replanned: ReplanMoveOperationResult = replanMoveOperation(
    world,
    registry,
    agentId,
    operation,
    updatedKnowledge,
  );
  return replanned.kind === "replanned"
    ? {
        kind: "replanned",
        operation: replanned.operation,
        knowledge: updatedKnowledge,
      }
    : {
        kind: "needs_decision",
        reasonCode: replanned.reasonCode,
        knowledge: updatedKnowledge,
      };
}
