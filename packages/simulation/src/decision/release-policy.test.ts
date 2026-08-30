import { describe, expect, it } from "vitest";

import type { ModelDecisionResult } from "@god-sim/protocol";

import { acceptDecisionResult, requestDecisions } from "./decision-gate";
import { applyReleasePolicy } from "./release-policy";
import { simulationTestWorld } from "../testing/simulation-test-fixtures";

function requests(world = simulationTestWorld()) {
  return requestDecisions(world, [
    {
      agentId: "alice" as never,
      reason: { code: "initial_goal", summary: "Choose a first goal" },
      goalOptions: [
        {
          id: "alice-wait" as never,
          label: "Wait",
          goal: { kind: "wait", durationTicks: 10 },
        },
      ],
    },
    {
      agentId: "bob" as never,
      reason: { code: "initial_goal", summary: "Choose a first goal" },
      goalOptions: [
        {
          id: "bob-wait" as never,
          label: "Wait",
          goal: { kind: "wait", durationTicks: 10 },
        },
      ],
    },
  ]).world;
}

function resultFor(world: ReturnType<typeof requests>, agentId: "alice" | "bob"): ModelDecisionResult {
  const request = world.decisionCycle?.requests.get(agentId as never);
  if (!request) throw new Error(`Missing request for ${agentId}`);
  return {
    ...request.identity,
    proposal: {
      schemaVersion: 1,
      goalOptionId: `${agentId}-wait` as never,
      reason: "Waiting is fine",
    },
  };
}

describe("decision release policy", () => {
  it("keeps the world frozen until every request is accepted", () => {
    const thinking = requests();
    const first = acceptDecisionResult(thinking, resultFor(thinking, "alice"));

    expect(first.accepted).toBe(true);
    expect(first.world.mode).toBe("THINKING");
    expect(first.world.tick).toBe(0);

    const second = acceptDecisionResult(first.world, resultFor(thinking, "bob"));
    expect(second.accepted).toBe(true);
    expect(applyReleasePolicy(second.world).mode).toBe("READY_FOR_RELEASE");
  });

  it("automatically releases when review is disabled", () => {
    const thinking = requests({ ...simulationTestWorld(), reviewRequired: false });
    const first = acceptDecisionResult(thinking, resultFor(thinking, "alice"));
    const second = acceptDecisionResult(first.world, resultFor(thinking, "bob"));

    expect(applyReleasePolicy(second.world).mode).toBe("RUNNING");
  });

  it("does not invalidate a peer result when the first result changes world version", () => {
    const thinking = requests();
    const bobResult = resultFor(thinking, "bob");
    const first = acceptDecisionResult(thinking, resultFor(thinking, "alice"));
    const second = acceptDecisionResult(first.world, bobResult);

    expect(second.accepted).toBe(true);
  });

  it("keeps the world frozen when a required request record is missing", () => {
    const thinking = requests();
    const first = acceptDecisionResult(thinking, resultFor(thinking, "alice"));
    const cycle = first.world.decisionCycle!;
    const incompleteRequests = new Map(cycle.requests);
    incompleteRequests.delete("bob" as never);
    const incomplete = {
      ...first.world,
      decisionCycle: { ...cycle, requests: incompleteRequests },
    };

    expect(applyReleasePolicy(incomplete).mode).toBe("THINKING");
  });
});
