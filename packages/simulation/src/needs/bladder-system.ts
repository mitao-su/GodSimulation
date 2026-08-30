import type { AgentId } from "@god-sim/protocol";

import { bladderSensation, type BladderSensation, type WorldState } from "../world/world-state";

export interface BladderThresholdCrossing {
  readonly agentId: AgentId;
  readonly previousValue: number;
  readonly newValue: number;
  readonly previousSensation: BladderSensation;
  readonly newSensation: BladderSensation;
}

export interface BladderAdvanceResult {
  readonly world: WorldState;
  readonly crossings: readonly BladderThresholdCrossing[];
}

export function advanceBladderNeeds(world: WorldState): BladderAdvanceResult {
  if (world.mode !== "RUNNING") return { world, crossings: [] };
  const agents = new Map(world.agents);
  const crossings: BladderThresholdCrossing[] = [];

  for (const agentId of [...agents.keys()].sort((left, right) => left.localeCompare(right))) {
    const agent = agents.get(agentId)!;
    const newValue = Math.min(100, agent.bladder + 1);
    const newSensation = bladderSensation(newValue);
    if (newSensation !== agent.bladderSensation) {
      crossings.push({
        agentId,
        previousValue: agent.bladder,
        newValue,
        previousSensation: agent.bladderSensation,
        newSensation,
      });
    }
    agents.set(agentId, { ...agent, bladder: newValue, bladderSensation: newSensation });
  }

  return { world: { ...world, agents }, crossings };
}

