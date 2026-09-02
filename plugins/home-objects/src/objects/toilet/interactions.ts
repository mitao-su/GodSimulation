import { z } from "zod";

import type { InteractionDefinition } from "@god-sim/plugin-sdk";

import type { ToiletState } from "./state";

const noArgumentsSchema = z.object({}).strict();
const emptyResultSchema = z.object({}).strict();

function releaseIfHeld(
  state: Readonly<ToiletState>,
  context: Parameters<InteractionDefinition<ToiletState>["cancel"]>[1],
) {
  if (state.occupiedBy !== context.actor.agentId) return { effects: [] };
  return {
    effects: [
      {
        type: "release_occupancy" as const,
        entityId: context.object.entityId,
        agentId: context.actor.agentId,
        expectedObjectVersion: context.object.version,
      },
    ],
  };
}

export const useToiletInteraction: InteractionDefinition<ToiletState> = {
  id: "use",
  displayName: "Use toilet",
  trigger: "active_command",
  taskSlots: ["BODY"],
  parametersSchema: noArgumentsSchema,
  resolveDuration: () => ({ kind: "fixed", totalTicks: 40 }),
  eventIgnore: [],
  publicBehavior: { kind: "visible", label: "using the toilet" },
  domainFailures: [{ code: "occupied", summary: "The toilet is occupied" }],
  resultSchema: emptyResultSchema,
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
  fail: releaseIfHeld,
  cancel: releaseIfHeld,
  fuse: () => null,
};
