import { OperationIdSchema } from "@god-sim/protocol";

import {
  AVAILABLE,
  EMPTY_RESULT_SCHEMA,
  ENTITY_TARGET_ARGUMENTS_SCHEMA,
  assertNoObservationBuffer,
  knownObjects,
  targetObject,
} from "./core-operation-helpers";
import type { RegisteredOperation } from "../operation-runtime";

export function createObserveOperation(): RegisteredOperation {
  return {
    id: OperationIdSchema.parse("core.observe"),
    ownerPluginId: null,
    taskSlots: ["HEAD"],
    eventIgnore: [],
    publicBehavior: { kind: "visible", label: "observing" },
    domainFailures: [
      { code: "target_not_visible", summary: "Observation target is not visible" },
    ],
    resultSchema: EMPTY_RESULT_SCHEMA,
    argumentsSchema: () => ENTITY_TARGET_ARGUMENTS_SCHEMA,
    offers: (context) => {
      const agent = context.world.agents.get(context.agentId)!;
      return knownObjects(context)
        .filter((object) => agent.knowledge.visibleEntityIds.has(object.entityId))
        .flatMap((object) => {
          const definition = context.registry.getObject(
            context.world.objects.get(object.entityId)?.definitionId ?? "",
          )?.definition;
          return definition
            ? [
                {
                  id: `task-option:${context.agentId}:${object.entityId}:observe`,
                  label: `Observe ${definition.displayName}`,
                  fixedArguments: { targetEntityId: object.entityId },
                },
              ]
            : [];
        });
    },
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
          };
    },
    resolveDuration: (context) => ({
      kind: "fixed",
      totalTicks:
        context.world.simulationRulesLock.rules.operations.observe.durationTicks,
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
    validateRestored: (context, operation) => {
      const parsed = ENTITY_TARGET_ARGUMENTS_SCHEMA.parse(operation.arguments);
      const expectedTicks =
        context.world.simulationRulesLock.rules.operations.observe.durationTicks;
      const action = operation.plan.actions[0];
      if (
        operation.duration.kind !== "fixed" ||
        operation.duration.totalTicks !== expectedTicks ||
        operation.plan.actions.length !== 1 ||
        operation.plan.currentActionIndex !== 0 ||
        action?.kind !== "observe" ||
        action.targetEntityId !== parsed.targetEntityId ||
        action.durationTicks !== expectedTicks
      ) {
        throw new Error(
          `Snapshot observe operation ${operation.callId} has an incompatible plan`,
        );
      }
      assertNoObservationBuffer(operation);
    },
  };
}
