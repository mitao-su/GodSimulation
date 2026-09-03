import type { AgentState } from "../world/world-state";
import type { KnowledgeChange } from "../perception/agent-knowledge";
import { operationCallIdsInTrackOrder } from "../execution/task-tracks";

export interface PlanConflict {
  readonly code: "perceived_goal_conflict";
  readonly summary: string;
  readonly relatedEntityId: KnowledgeChange["current"]["entityId"];
}

export function detectPlanConflict(
  agent: AgentState,
  changes: readonly KnowledgeChange[],
): PlanConflict | null {
  for (const callId of operationCallIdsInTrackOrder(agent.taskTracks)) {
    const operation = agent.activeOperations.get(callId);
    const action = operation?.plan.actions[operation.plan.currentActionIndex];
    if (
      !action ||
      action.kind !== "interact_object" ||
      action.purpose !== "direct"
    ) {
      continue;
    }
    const targetChange = changes.find(
      (change) => change.current.entityId === action.targetEntityId,
    );
    if (!targetChange) continue;
    const availability = targetChange.current.interactionAvailability.find(
      (candidate) => candidate.interactionId === action.interactionId,
    );
    if (availability && !availability.available) {
      return {
        code: "perceived_goal_conflict",
        summary: `${availability.summary} conflicts with the current goal`,
        relatedEntityId: targetChange.current.entityId,
      };
    }
  }
  return null;
}
