import type { AgentId, EntityId, EventId, Goal } from "@god-sim/protocol";

import { planGoal } from "./goal-planner";
import type { AgentNavigationKnowledge } from "./path-planner";
import type { PluginRegistry } from "../world/plugin-registry";
import type { WorldState } from "../world/world-state";

export interface TraversalFailure {
  readonly entityId: EntityId;
  readonly goal: Goal;
  readonly observedObjectVersion: number;
  readonly reasonCode: string;
  readonly sourceEventId: EventId;
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
  failure: TraversalFailure,
  knowledge: AgentNavigationKnowledge,
): RecoveryResult {
  const knownTraversalBlockers = new Map(knowledge.knownTraversalBlockers);
  knownTraversalBlockers.set(failure.entityId, {
    entityId: failure.entityId,
    observedObjectVersion: failure.observedObjectVersion,
    reasonCode: failure.reasonCode,
    sourceEventId: failure.sourceEventId,
  });
  const updatedKnowledge = { knownTraversalBlockers };
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
