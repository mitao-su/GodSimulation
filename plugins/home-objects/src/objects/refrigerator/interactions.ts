import type { InteractionDefinition } from "@god-sim/plugin-sdk";

import type { RefrigeratorState } from "./state";

export const useRefrigeratorInteraction: InteractionDefinition<RefrigeratorState> = {
  id: "use",
  displayName: "Use refrigerator",
  trigger: "active_command",
  durationTicks: 30,
  slots: ["HANDS", "BODY"],
  canStart(state, context) {
    if (state.occupiedBy === null || state.occupiedBy === context.actor.agentId) {
      return { available: true };
    }
    return {
      available: false,
      reasonCode: "occupied",
      summary: `The refrigerator is being used by ${state.occupiedBy}`,
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
          type: "release_occupancy",
          entityId: context.object.entityId,
          agentId: context.actor.agentId,
          expectedObjectVersion: context.object.version,
        },
      ],
    };
  },
};
