import { describe, expect, it } from "vitest";

import type { ActionPlan, ActiveGoal } from "./action";
import { advanceActions } from "./action-runner";
import { createEmptyBodySlots } from "./body-slots";
import { simulationTestWorld, testPluginRegistry } from "../testing/simulation-test-fixtures";

function withPlan(plan: ActionPlan, goal: ActiveGoal) {
  const world = simulationTestWorld();
  const alice = world.agents.get("alice" as never)!;
  return {
    ...world,
    mode: "RUNNING" as const,
    agents: new Map([
      ...[...world.agents].filter(([agentId]) => agentId !== ("alice" as never)),
      [
        "alice" as never,
        { ...alice, currentGoal: goal, actionPlan: plan, bodySlots: createEmptyBodySlots() },
      ],
    ]),
  };
}

describe("advanceActions", () => {
  it("moves one cell after the configured integer progress", () => {
    const goal = {
      id: "goal-move",
      label: "Move",
      goal: { kind: "wait", durationTicks: 1 } as const,
    };
    const plan: ActionPlan = {
      goalId: goal.id,
      goal: goal.goal,
      currentActionIndex: 0,
      actions: [
        {
          id: "move-1",
          goalId: goal.id,
          kind: "move",
          path: [
            { x: 3, y: 2 },
            { x: 3, y: 1 },
          ],
          durationTicks: 2,
          progressTicks: 0,
          slots: ["BODY"],
        },
      ],
    };

    const first = advanceActions(withPlan(plan, goal), testPluginRegistry);
    expect(first.world.agents.get("alice" as never)?.position).toEqual({ x: 3, y: 2 });
    const second = advanceActions(first.world, testPluginRegistry);
    expect(second.world.agents.get("alice" as never)?.position).toEqual({ x: 3, y: 1 });
    expect(second.completedGoalAgentIds).toEqual(["alice"]);
  });

  it("emits an interaction intent before starting an object action", () => {
    const goal = {
      id: "goal-fridge",
      label: "Use fridge",
      goal: {
        kind: "use_object",
        targetEntityId: "fridge-1" as never,
        interactionId: "use",
      } as const,
    };
    const plan: ActionPlan = {
      goalId: goal.id,
      goal: goal.goal,
      currentActionIndex: 0,
      actions: [
        {
          id: "use-1",
          goalId: goal.id,
          kind: "interact_object",
          purpose: "goal",
          targetEntityId: "fridge-1" as never,
          interactionId: "use",
          durationTicks: 10,
          progressTicks: 0,
          slots: ["HANDS", "BODY"],
          started: false,
        },
      ],
    };

    const result = advanceActions(withPlan(plan, goal), testPluginRegistry);

    expect(result.interactionIntents).toEqual([
      {
        intentId: "use-1:start",
        agentId: "alice",
        entityId: "fridge-1",
        interactionId: "use",
        arrivalTick: 0,
        actionId: "use-1",
        purpose: "goal",
      },
    ]);
    expect(result.world.objects.get("fridge-1" as never)?.state).toEqual({ occupiedBy: null });
  });
});
