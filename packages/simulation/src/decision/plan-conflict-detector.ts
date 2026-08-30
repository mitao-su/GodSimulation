import type { AgentState } from "../world/world-state";
import type { KnowledgeChange } from "../perception/agent-knowledge";

export interface PlanConflict {
  readonly code: "perceived_goal_conflict";
  readonly summary: string;
  readonly relatedEntityId: KnowledgeChange["current"]["entityId"];
}

function occupiedBy(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("occupiedBy" in value)) return null;
  return typeof value.occupiedBy === "string" ? value.occupiedBy : null;
}

export function detectPlanConflict(
  agent: AgentState,
  changes: readonly KnowledgeChange[],
): PlanConflict | null {
  const goal = agent.currentGoal?.goal;
  if (!goal || (goal.kind !== "use_object" && goal.kind !== "observe")) return null;
  const targetChange = changes.find((change) => change.current.entityId === goal.targetEntityId);
  if (!targetChange) return null;
  const occupant = occupiedBy(targetChange.current.observable);
  if (goal.kind === "use_object" && occupant !== null && occupant !== agent.id) {
    return {
      code: "perceived_goal_conflict",
      summary: `${targetChange.current.summary} conflicts with the current goal`,
      relatedEntityId: targetChange.current.entityId,
    };
  }
  return null;
}
