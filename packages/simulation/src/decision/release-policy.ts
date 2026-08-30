import { createEmptyBodySlots } from "../execution/body-slots";
import type { DecisionCycleState, WorldState } from "../world/world-state";

export function allDecisionResultsAccepted(cycle: DecisionCycleState): boolean {
  return cycle.requestedAgentIds.every((agentId) => {
    const request = cycle.requests.get(agentId);
    return request !== undefined && request.acceptedProposal !== null;
  });
}

export function releaseDecisionCycle(world: WorldState): WorldState {
  const cycle = world.decisionCycle;
  if (!cycle) throw new Error("No decision cycle is active");
  if (!allDecisionResultsAccepted(cycle)) {
    throw new Error(`Decision cycle ${cycle.id} is not ready for release`);
  }

  const agents = new Map(world.agents);
  for (const agentId of cycle.requestedAgentIds) {
    const request = cycle.requests.get(agentId);
    const proposal = request?.acceptedProposal;
    const agent = agents.get(agentId);
    if (!request || !proposal || !agent) {
      throw new Error(`Decision cycle ${cycle.id} is incomplete for ${agentId}`);
    }
    const option = request.promptInput.goalOptions.find(
      (candidate) => candidate.id === proposal.goalOptionId,
    );
    if (!option) throw new Error(`Accepted goal ${proposal.goalOptionId} is no longer available`);
    agents.set(agentId, {
      ...agent,
      currentGoal: {
        id: `goal:${cycle.id}:${agentId}`,
        goal: option.goal,
        label: option.label,
      },
      actionPlan: null,
      bodySlots: createEmptyBodySlots(),
    });
  }

  return {
    ...world,
    version: world.version + 1,
    mode: "RUNNING",
    agents,
    decisionCycle: null,
  };
}

export function applyReleasePolicy(world: WorldState): WorldState {
  const cycle = world.decisionCycle;
  if (!cycle || !allDecisionResultsAccepted(cycle)) return world;
  if (!world.reviewRequired) return releaseDecisionCycle(world);
  if (world.mode === "READY_FOR_RELEASE") return world;
  return { ...world, version: world.version + 1, mode: "READY_FOR_RELEASE" };
}
