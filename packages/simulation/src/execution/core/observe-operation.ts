import { OperationIdSchema } from "@god-sim/protocol";

import {
  AVAILABLE,
  EMPTY_OPERATION_STATE_SCHEMA,
  EMPTY_RESULT_SCHEMA,
  ENTITY_TARGET_ARGUMENTS_SCHEMA,
  targetObject,
} from "./core-operation-helpers";
import type { RegisteredOperation } from "../operation-runtime";

const ZERO_TICKS = 0;

export function createObserveOperation(): RegisteredOperation {
  return {
    id: OperationIdSchema.parse("core.observe"),
    ownerPluginId: null,
    taskSlots: ["HEAD"],
    eventIgnore: [],
    publicBehavior: { kind: "visible", label: "observing" },
    arbitrationFailureMappings: {},
    domainFailures: [
      { code: "target_not_visible", summary: "Observation target is not visible" },
    ],
    resultSchema: EMPTY_RESULT_SCHEMA,
    stateSchema: EMPTY_OPERATION_STATE_SCHEMA,
    argumentsSchema: () => ENTITY_TARGET_ARGUMENTS_SCHEMA,
    initialState: () => ({}),
    canStart: (context, value) => {
      const object = targetObject(context, value);
      const targetEntityId = ENTITY_TARGET_ARGUMENTS_SCHEMA.safeParse(value).data
        ?.targetEntityId;
      const agent = context.world.agents.get(context.agentId)!;
      return object &&
        targetEntityId &&
        agent.knowledge.visibleEntityIds.has(targetEntityId)
        ? AVAILABLE
        : {
            available: false,
            reasonCode: "target_not_visible",
            summary: `${targetEntityId ?? "Target"} is not currently visible`,
            details: { summary: `${targetEntityId ?? "Target"} is not currently visible` },
          };
    },
    resolveDuration: () => ({
      kind: "fixed",
      totalTicks: ZERO_TICKS,
    }),
    createPlan: (_context, value, callId, duration) => {
      if (duration.kind !== "fixed") {
        throw new Error("core.observe requires a fixed duration");
      }
      const targetEntityId = ENTITY_TARGET_ARGUMENTS_SCHEMA.parse(value).targetEntityId;
      return {
        kind: "prepared",
        plan: {
          currentActionIndex: 0,
          actions: [
            {
              id: `${callId}:action:0`,
              kind: "observe",
              targetEntityId,
              durationTicks: duration.totalTicks,
              progressTicks: 0,
            },
          ],
        },
      };
    },
    fuse: () => null,
    acknowledgeFuseResult: (_context, operation) => operation,
    terminalResult: () => ({}),
    validateRestored: (_context, operation) => {
      const parsed = ENTITY_TARGET_ARGUMENTS_SCHEMA.parse(operation.arguments);
      const expectedTicks = ZERO_TICKS;
      const action = operation.plan.actions[0];
      if (
        operation.duration.kind !== "fixed" ||
        operation.duration.totalTicks !== expectedTicks ||
        operation.plan.actions.length !== 1 ||
        operation.plan.currentActionIndex !== 0 ||
        action?.kind !== "observe" ||
        action.targetEntityId !== parsed.targetEntityId ||
        action.durationTicks !== expectedTicks ||
        action.progressTicks !== operation.progressTicks
      ) {
        throw new Error(
          `Snapshot observe operation ${operation.callId} has an incompatible plan`,
        );
      }
    },
  };
}
