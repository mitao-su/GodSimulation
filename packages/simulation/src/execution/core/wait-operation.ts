import { z } from "zod";

import { OperationIdSchema } from "@god-sim/protocol";

import {
  AVAILABLE,
  EMPTY_OPERATION_STATE_SCHEMA,
  EMPTY_RESULT_SCHEMA,
} from "./core-operation-helpers";
import type {
  OperationRuntimeContext,
  RegisteredOperation,
} from "../operation-runtime";

export const WaitOperationArgumentsSchema = z
  .object({ durationTicks: z.number().int().positive() })
  .strict();

function argumentsSchema(context: OperationRuntimeContext) {
  return z
    .object({
      durationTicks: z
        .number()
        .int()
        .positive()
        .max(
          context.world.simulationRulesLock.rules.operations.wait
            .maxDurationTicks,
        ),
    })
    .strict();
}

export function createWaitOperation(): RegisteredOperation {
  return {
    id: OperationIdSchema.parse("core.wait"),
    ownerPluginId: null,
    taskSlots: ["BODY"],
    eventIgnore: [],
    publicBehavior: { kind: "visible", label: "waiting" },
    arbitrationFailureMappings: {},
    domainFailures: [
      {
        code: "invalid_duration",
        summary: "Wait duration is outside the configured range",
      },
    ],
    resultSchema: EMPTY_RESULT_SCHEMA,
    stateSchema: EMPTY_OPERATION_STATE_SCHEMA,
    argumentsSchema,
    initialState: () => ({}),
    offers: (context) => [
      {
        id: `task-option:${context.agentId}:wait`,
        label: "Wait",
        fixedArguments: {},
      },
    ],
    canStart: (context, value) =>
      argumentsSchema(context).safeParse(value).success
        ? AVAILABLE
        : {
            available: false,
            reasonCode: "invalid_duration",
            summary: `Wait duration must not exceed ${context.world.simulationRulesLock.rules.operations.wait.maxDurationTicks} ticks`,
          },
    resolveDuration: (_context, value) => ({
      kind: "fixed",
      totalTicks: WaitOperationArgumentsSchema.parse(value).durationTicks,
    }),
    createPlan: (_context, value, callId, duration) => {
      const parsed = WaitOperationArgumentsSchema.parse(value);
      if (duration.kind !== "fixed") {
        throw new Error("core.wait requires a fixed duration");
      }
      return {
        kind: "prepared",
        plan: {
          currentActionIndex: 0,
          actions: [
            {
              id: `${callId}:action:0`,
              kind: "wait",
              durationTicks: parsed.durationTicks,
              progressTicks: 0,
            },
          ],
        },
      };
    },
    fuse: () => null,
    acknowledgeFuseResult: (_context, operation) => operation,
    terminalResult: () => ({}),
    validateRestored: (context, operation) => {
      const parsed = argumentsSchema(context).parse(operation.arguments);
      const action = operation.plan.actions[0];
      if (
        operation.duration.kind !== "fixed" ||
        operation.duration.totalTicks !== parsed.durationTicks ||
        operation.plan.actions.length !== 1 ||
        operation.plan.currentActionIndex !== 0 ||
        action?.kind !== "wait" ||
        action.durationTicks !== parsed.durationTicks ||
        action.progressTicks !== operation.progressTicks
      ) {
        throw new Error(`Snapshot wait operation ${operation.callId} has an incompatible plan`);
      }
    },
  };
}
