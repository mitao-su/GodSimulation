import { describe, expect, it } from "vitest";

import { detectPlanConflict } from "./plan-conflict-detector";
import { simulationTestWorld } from "../testing/simulation-test-fixtures";

describe("detectPlanConflict", () => {
  it("detects when the current interaction becomes observably unavailable", () => {
    const base = simulationTestWorld();
    const alice = {
      ...base.agents.get("alice" as never)!,
      taskTracks: {
        HEAD: { kind: "empty" as const },
        BODY: {
          kind: "operation" as const,
          callId: "operation-call:alice:fixture" as never,
        },
      },
      activeOperations: new Map([
        [
          "operation-call:alice:fixture" as never,
          {
            callId: "operation-call:alice:fixture" as never,
            operationId: "object.test.fridge.use" as never,
            taskOptionId: "task-option:alice:fixture" as never,
            taskSlots: ["BODY" as const],
            arguments: { targetEntityId: "fridge-1", parameters: {} },
            duration: { kind: "fixed" as const, totalTicks: 10 },
            startedAtTick: 0,
            progressTicks: 2,
            accumulatedObservations: [],
            plan: {
              currentActionIndex: 0,
              actions: [
                {
                  id: "operation-call:alice:fixture:action:0",
                  kind: "interact_object" as const,
                  purpose: "direct" as const,
                  targetEntityId: "fridge-1" as never,
                  interactionId: "use",
                  durationTicks: 10,
                  progressTicks: 2,
                  started: true,
                },
              ],
            },
            label: "Use fixture",
          },
        ],
      ]),
    };

    const conflict = detectPlanConflict(alice, [
      {
        previous: null,
        current: {
          entityId: "fridge-1" as never,
          displayName: "Fixture",
          status: "busy",
          summary: "Fixture is busy",
          observable: { holder: "bob" },
          interactionAvailability: [
            {
              interactionId: "use",
              available: false,
              reasonCode: "in_use",
              summary: "Fixture is already in use",
            },
          ],
          position: { x: 4, y: 1 },
          sourceEventId: "event:test-world:1" as never,
          observedAtTick: 1,
          observationKind: "vision",
        },
      },
    ]);

    expect(conflict).toEqual({
      code: "perceived_goal_conflict",
      summary: "Fixture is already in use conflicts with the current goal",
      relatedEntityId: "fridge-1",
    });
  });
});
