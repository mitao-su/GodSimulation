import { describe, expect, it } from "vitest";

import { detectPlanConflict } from "./plan-conflict-detector";
import { simulationTestWorld } from "../testing/simulation-test-fixtures";

describe("detectPlanConflict", () => {
  it("detects when the current interaction becomes observably unavailable", () => {
    const base = simulationTestWorld();
    const alice = {
      ...base.agents.get("alice" as never)!,
      currentGoal: {
        id: "goal:alice:fixture",
        label: "Use fixture",
        goal: {
          kind: "use_object" as const,
          targetEntityId: "fridge-1" as never,
          interactionId: "use",
        },
      },
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
