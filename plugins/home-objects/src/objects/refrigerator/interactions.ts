import { z } from "zod";

import type { InteractionDefinition } from "@god-sim/plugin-sdk";

import type { RefrigeratorState } from "./state";

const noArgumentsSchema = z.object({}).strict();
const emptyResultSchema = z.object({}).strict();

function releaseIfHeld(
  state: Readonly<RefrigeratorState>,
  context: Parameters<
    InteractionDefinition<RefrigeratorState>["cancel"]
  >[1],
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

export const useRefrigeratorInteraction: InteractionDefinition<RefrigeratorState> = {
  id: "use",
  displayName: "Use refrigerator",
  trigger: "active_command",
  taskSlots: ["BODY"],
  parametersSchema: noArgumentsSchema,
  resolveDuration: () => ({ kind: "fixed", totalTicks: 30 }),
  eventIgnore: [],
  publicBehavior: { kind: "visible", label: "using the refrigerator" },
  domainFailures: [
    { code: "occupied", summary: "The refrigerator is occupied" },
  ],
  resultSchema: emptyResultSchema,
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
  fail: releaseIfHeld,
  cancel: releaseIfHeld,
  fuse: () => null,
};
