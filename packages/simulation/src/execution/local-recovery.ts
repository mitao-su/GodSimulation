import type { AgentId } from "@god-sim/protocol";

import {
  createOperationRuntimeContext,
  type OperationRecoveryFailure,
  type OperationRecoveryResult,
} from "./operation-runtime";
import type { AgentNavigationKnowledge } from "./path-planner";
import type { SimulationRegistry } from "../engine/simulation-registry";
import type { WorldState } from "../world/world-state";

export type TraversalFailure = OperationRecoveryFailure;
export type RecoveryResult = OperationRecoveryResult;

export function recoverBlockedOperation(
  world: WorldState,
  registry: SimulationRegistry,
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
  const runtime = registry.getOperation(operation.operationId);
  if (!runtime?.recover) {
    return {
      kind: "needs_decision",
      reasonCode: failure.reasonCode,
      knowledge,
    };
  }
  return runtime.recover(
    createOperationRuntimeContext(world, registry, agentId),
    operation,
    failure,
    knowledge,
  );
}
