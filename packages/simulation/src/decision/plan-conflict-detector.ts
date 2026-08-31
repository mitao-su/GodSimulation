import type { AgentState } from "../world/world-state";
import type { KnowledgeChange } from "../perception/agent-knowledge";

export interface PlanConflict {
  readonly code: "perceived_goal_conflict";
  readonly summary: string;
  readonly relatedEntityId: KnowledgeChange["current"]["entityId"];
}

export function detectPlanConflict(
  agent: AgentState,
  changes: readonly KnowledgeChange[],
): PlanConflict | null {
  const goal = agent.currentGoal?.goal;
  if (!goal || goal.kind !== "use_object") return null;
  const targetChange = changes.find((change) => change.current.entityId === goal.targetEntityId);
  if (!targetChange) return null;
  const availability = targetChange.current.interactionAvailability.find(
    (candidate) => candidate.interactionId === goal.interactionId,
  );
  if (availability && !availability.available) {
    return {
      code: "perceived_goal_conflict",
      summary: `${availability.summary} conflicts with the current goal`,
      relatedEntityId: targetChange.current.entityId,
    };
  }
  return null;
}
