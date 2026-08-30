import type { InteractionDefinition } from "@god-sim/plugin-sdk";

import type { ToiletState } from "./state";

export const useToiletInteraction: InteractionDefinition<ToiletState> = {
  id: "use",
  displayName: "Use toilet",
  trigger: "active_command",
  durationTicks: 40,
  slots: ["BODY"],
  canStart(state, context) {
    if (state.occupiedBy === null || state.occupiedBy === context.actor.agentId) {
      return { available: true };
    }
    return {
      available: false,
      reasonCode: "occupied",
      summary: `The toilet is being used by ${state.occupiedBy}`,
    };
  },
  start(state, context) {
    if (state.occupiedBy !== null && state.occupiedBy !== context.actor.agentId) {
      return { effects: [] };
    }
    return {
      effects: [
        {
          type: "reserve_occupancy",
          entityId: context.object.entityId,
          agentId: context.actor.agentId,
          expectedObjectVersion: context.object.version,
        },
      ],
    };
  },
  complete(_state, context) {
    return {
      effects: [
        {
          type: "set_agent_need",
          agentId: context.actor.agentId,
          need: "bladder",
          value: 5,
        },
        {
          type: "release_occupancy",
          entityId: context.object.entityId,
          agentId: context.actor.agentId,
          expectedObjectVersion: context.object.version,
        },
      ],
    };
  },
};
