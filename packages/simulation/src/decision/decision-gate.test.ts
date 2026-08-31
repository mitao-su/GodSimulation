import { describe, expect, it } from "vitest";

import type { ModelDecisionResult } from "@god-sim/protocol";

import {
  acceptDecisionResult,
  recordDecisionFailure,
  requestDecisions,
  retryDecisionRequest,
} from "./decision-gate";
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

  it("retries only the failed request and keeps accepted peer results", () => {
    const initial = requestDecisions(simulationTestWorld(), [
      aliceWaitRequest,
      {
        ...aliceWaitRequest,
        agentId: "bob" as never,
        goalOptions: [
          {
            id: "bob-wait" as never,
            label: "Wait",
            goal: { kind: "wait" as const, durationTicks: 10 },
          },
        ],
      },
    ]).world;
    const aliceRequest = initial.decisionCycle!.requests.get("alice" as never)!;
    const aliceAccepted = acceptDecisionResult(initial, {
      ...aliceRequest.identity,
      proposal: {
        schemaVersion: 1,
        goalOptionId: "alice-wait" as never,
        reason: "Wait",
      },
    }).world;
    const bobRequest = aliceAccepted.decisionCycle!.requests.get("bob" as never)!;
    const blocked = recordDecisionFailure(aliceAccepted, {
      id: "failure-1",
      category: "model",
      message: "Provider unavailable",
      requestId: bobRequest.identity.requestId,
      retryable: true,
      occurredAtRealTime: "2026-08-31T00:00:00.000Z",
    });

    expect(blocked.mode).toBe("TECHNICALLY_BLOCKED");
    const retried = retryDecisionRequest(blocked, bobRequest.identity.requestId);
    const retriedAlice = retried.decisionCycle!.requests.get("alice" as never)!;
    const retriedBob = retried.decisionCycle!.requests.get("bob" as never)!;

    expect(retried.mode).toBe("THINKING");
    expect(retried.technicalFailure).toBeNull();
    expect(retriedAlice.acceptedProposal?.goalOptionId).toBe("alice-wait");
    expect(retriedBob.acceptedProposal).toBeNull();
    expect(retriedBob.identity.requestId).not.toBe(bobRequest.identity.requestId);
    expect(retriedBob.identity.retryOfRequestId).toBe(bobRequest.identity.requestId);
  });

  it("keeps concurrent decision failures independently retryable", () => {
    const initial = requestDecisions(simulationTestWorld(), [
      aliceWaitRequest,
      {
        ...aliceWaitRequest,
        agentId: "bob" as never,
        goalOptions: [
          {
            id: "bob-wait" as never,
            label: "Wait",
            goal: { kind: "wait" as const, durationTicks: 10 },
          },
        ],
      },
    ]).world;
    const aliceRequest = initial.decisionCycle!.requests.get("alice" as never)!;
    const bobRequest = initial.decisionCycle!.requests.get("bob" as never)!;
    const aliceFailure = {
      id: "failure:model:alice",
      category: "model" as const,
      message: "Alice provider request failed",
      requestId: aliceRequest.identity.requestId,
      retryable: true,
      occurredAtRealTime: "2026-08-31T00:00:00.000Z",
    };
    const bobFailure = {
      id: "failure:model:bob",
      category: "model" as const,
      message: "Bob provider request failed",
      requestId: bobRequest.identity.requestId,
      retryable: true,
      occurredAtRealTime: "2026-08-31T00:00:01.000Z",
    };

    const blocked = recordDecisionFailure(
      recordDecisionFailure(initial, aliceFailure),
      bobFailure,
    );

    expect(blocked.decisionCycle!.requests.get("alice" as never)!.failure).toEqual(aliceFailure);
    expect(blocked.decisionCycle!.requests.get("bob" as never)!.failure).toEqual(bobFailure);

    const bobRetried = retryDecisionRequest(blocked, bobRequest.identity.requestId);
    expect(bobRetried.mode).toBe("TECHNICALLY_BLOCKED");
    expect(bobRetried.technicalFailure).toEqual(aliceFailure);
    expect(bobRetried.decisionCycle!.requests.get("alice" as never)!.failure).toEqual(
      aliceFailure,
    );
    expect(bobRetried.decisionCycle!.requests.get("bob" as never)!.failure).toBeNull();

    const aliceRetried = retryDecisionRequest(
      bobRetried,
      aliceRequest.identity.requestId,
    );
    expect(aliceRetried.mode).toBe("THINKING");
    expect(aliceRetried.technicalFailure).toBeNull();
    expect(aliceRetried.decisionCycle!.requests.get("alice" as never)!.failure).toBeNull();
  });
});
