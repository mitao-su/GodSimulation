import type { AgentId, EntityId, Goal } from "@god-sim/protocol";

import { planGoal } from "./goal-planner";
import type { AgentNavigationKnowledge } from "./path-planner";
import type { PluginRegistry } from "../world/plugin-registry";
import type { WorldState } from "../world/world-state";

export interface LockedDoorFailure {
  readonly code: "locked_door";
  readonly entityId: EntityId;
  readonly goal: Goal;
}

export type RecoveryResult =
  | {
      readonly kind: "replanned";
      readonly plan: Extract<ReturnType<typeof planGoal>, { kind: "planned" }>["plan"];
      readonly knowledge: AgentNavigationKnowledge;
    }
  | {
      readonly kind: "needs_decision";
      readonly reasonCode: string;
      readonly knowledge: AgentNavigationKnowledge;
    };

export function recoverBlockedPlan(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
  failure: LockedDoorFailure,
  knowledge: AgentNavigationKnowledge,
): RecoveryResult {
  const knownLockedDoorIds = new Set(knowledge.knownLockedDoorIds);
  knownLockedDoorIds.add(failure.entityId);
  const updatedKnowledge = { knownLockedDoorIds };
  const replanned = planGoal(
    world,
    registry,
    agentId,
    failure.goal,
    updatedKnowledge,
    `goal:${agentId}:${world.version}:recovery`,
  );
  return replanned.kind === "planned"
    ? { kind: "replanned", plan: replanned.plan, knowledge: updatedKnowledge }
    : { kind: "needs_decision", reasonCode: replanned.reasonCode, knowledge: updatedKnowledge };
}
