import type {
  AgentId,
  OperationCallId,
  OperationTechnicalFailure,
} from "@god-sim/protocol";

import type { WorldState } from "../world/world-state";

export type ActiveOperationCleanupResult =
  | { readonly kind: "cleaned"; readonly world: WorldState }
  | { readonly kind: "technical_failure"; readonly failure: OperationTechnicalFailure };

/** 在一次局部更新中移除调用及其所有任务轨道引用。 */
export function clearActiveOperation(
  world: WorldState,
  agentId: AgentId,
  callId: OperationCallId,
): ActiveOperationCleanupResult {
  const agent = world.agents.get(agentId);
  if (!agent) {
    return {
      kind: "technical_failure",
      failure: {
        kind: "technical_failure",
        category: "protocol",
        code: "termination_agent_missing",
        message: `Unknown agent ${agentId}.`,
        retryable: false,
      },
    };
  }
  if (!agent.activeOperations.has(callId)) {
    return {
      kind: "technical_failure",
      failure: {
        kind: "technical_failure",
        category: "protocol",
        code: "termination_call_missing",
        message: `Operation ${callId} is not active for ${agentId}.`,
        retryable: false,
      },
    };
  }
  const activeOperations = new Map(agent.activeOperations);
  activeOperations.delete(callId);
  const nextAgent = {
    ...agent,
    activeOperations,
    taskTracks: {
      HEAD:
        agent.taskTracks.HEAD.kind === "operation" &&
        agent.taskTracks.HEAD.callId === callId
          ? ({ kind: "empty" } as const)
          : agent.taskTracks.HEAD,
      BODY:
        agent.taskTracks.BODY.kind === "operation" &&
        agent.taskTracks.BODY.callId === callId
          ? ({ kind: "empty" } as const)
          : agent.taskTracks.BODY,
    },
  };
  return {
    kind: "cleaned",
    world: {
      ...world,
      agents: new Map(world.agents).set(agentId, nextAgent),
    },
  };
}
