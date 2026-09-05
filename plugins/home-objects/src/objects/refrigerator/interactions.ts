import { z } from "zod";

import {
  operationParametersJsonSchema,
  type InteractionDefinition,
} from "@god-sim/plugin-sdk";
import { AgentIdSchema, EntityIdSchema } from "@god-sim/protocol";

import type { RefrigeratorState } from "./state";

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
  manual: {
    operationId: "object.home.refrigerator.use" as never,
    displayName: "Use refrigerator",
    summary: "Open and use this refrigerator.",
    taskSlots: ["BODY"],
    parametersSchema: operationParametersJsonSchema(noArgumentsSchema),
    target: { kind: "none" },
    duration: { kind: "fixed" },
    worldPreconditions: [
      {
        failureCode: "out_of_range",
        description: "The character must be at the refrigerator interaction position.",
      },
      {
        failureCode: "occupied",
        description: "Another character may already be using the refrigerator.",
      },
    ],
  },
  target: { kind: "none" },
  duration: { kind: "fixed" },
  taskSlots: ["BODY"],
  parametersSchema: noArgumentsSchema,
  resolveDuration: () => ({ kind: "fixed", totalTicks: 30 }),
  eventIgnore: [],
  publicBehavior: { kind: "visible", label: "using the refrigerator" },
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
      summary: "The refrigerator is out of range",
      detailsSchema: failureDetailsSchema,
      resultSchema: emptyResultSchema,
    },
    {
      code: "occupied",
      summary: "The refrigerator is occupied",
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
