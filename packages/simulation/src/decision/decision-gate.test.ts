import { describe, expect, it } from "vitest";

import type { ModelDecisionResult } from "@god-sim/protocol";

import { acceptDecisionResult, requestDecisions } from "./decision-gate";
import { simulationTestWorld } from "../testing/simulation-test-fixtures";

const aliceWaitRequest = {
  agentId: "alice" as never,
  reason: { code: "initial_goal", summary: "Choose a first goal" },
  goalOptions: [
    {
      id: "alice-wait" as never,
      label: "Wait",
      goal: { kind: "wait" as const, durationTicks: 10 },
    },
  ],
};

describe("decision gate", () => {
  it("builds model input without hidden world facts", () => {
    const base = simulationTestWorld();
    const fridge = base.objects.get("fridge-1" as never)!;
    const world = {
      ...base,
      objects: new Map(base.objects).set("fridge-1" as never, {
        ...fridge,
        state: { occupiedBy: "bob" },
      }),
    };

    const transition = requestDecisions(world, [aliceWaitRequest]);
    const request = transition.world.decisionCycle?.requests.get("alice" as never);

    expect(request?.promptInput.perception.visibleEntities).toEqual([]);
    expect(JSON.stringify(request?.promptInput)).not.toContain("occupiedBy");
    expect(request?.promptInput.memories).toHaveLength(1);
    expect(request?.promptInput.bodySensations).toEqual([
      {
        need: "bladder",
        level: "comfortable",
        description: "Bladder need is comfortable",
      },
    ]);
  });

  it("accepts only the offered goal for the current request", () => {
    const thinking = requestDecisions(simulationTestWorld(), [aliceWaitRequest]).world;
    const request = thinking.decisionCycle?.requests.get("alice" as never);
    if (!request) throw new Error("Missing Alice decision request");
    const result: ModelDecisionResult = {
      ...request.identity,
      proposal: {
        schemaVersion: 1,
        goalOptionId: "not-offered" as never,
        reason: "Use an unavailable choice",
      },
    };

    const rejected = acceptDecisionResult(thinking, result);

    expect(rejected.accepted).toBe(false);
    expect(rejected.reason).toMatch(/not offered/);
    expect(rejected.world).toBe(thinking);
  });
});
