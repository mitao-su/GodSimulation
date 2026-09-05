import { z } from "zod";

import {
  operationParametersJsonSchema,
  type InteractionDefinition,
} from "@god-sim/plugin-sdk";
import { AgentIdSchema, EntityIdSchema } from "@god-sim/protocol";

import type { ToiletState } from "./state";

const noArgumentsSchema = z.object({}).strict();
const emptyResultSchema = z.object({}).strict();
const failureDetailsSchema = z.union([
  z.object({ summary: z.string() }).strict(),
  z
    .object({
      resourceEntityId: EntityIdSchema,
      winnerAgentId: AgentIdSchema,
    })
    .strict(),
]);

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
  manual: {
    operationId: "object.home.toilet.use" as never,
    displayName: "Use toilet",
    summary: "Use this toilet to relieve bladder pressure.",
    taskSlots: ["BODY"],
    parametersSchema: operationParametersJsonSchema(noArgumentsSchema),
    target: { kind: "none" },
    duration: { kind: "fixed" },
    worldPreconditions: [
      {
        failureCode: "out_of_range",
        description: "The character must be at the toilet interaction position.",
      },
      {
        failureCode: "occupied",
        description: "Another character may already be using the toilet.",
      },
    ],
  },
  target: { kind: "none" },
  duration: { kind: "fixed" },
  taskSlots: ["BODY"],
  parametersSchema: noArgumentsSchema,
  resolveDuration: () => ({ kind: "fixed", totalTicks: 40 }),
  eventIgnore: [],
  publicBehavior: { kind: "visible", label: "using the toilet" },
  arbitrationFailureMappings: {
    resource_claimed: {
      failureCode: "occupied",
      buildDetails: ({ resourceEntityId, winnerAgentId }) => ({
        resourceEntityId,
        winnerAgentId,
      }),
    },
  },
  domainFailures: [
    {
      code: "out_of_range",
      summary: "The toilet is out of range",
      detailsSchema: failureDetailsSchema,
      resultSchema: emptyResultSchema,
    },
    {
      code: "occupied",
      summary: "The toilet is occupied",
      detailsSchema: failureDetailsSchema,
      resultSchema: emptyResultSchema,
    },
  ],
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
