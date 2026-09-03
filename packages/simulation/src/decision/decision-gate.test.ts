import { describe, expect, it } from "vitest";

import type { ModelDecisionResult } from "@god-sim/protocol";

import {
  acceptDecisionResult,
  recordDecisionFailure,
  requestDecisions,
  retryDecisionRequest,
} from "./decision-gate";
import { recordPerceptionCandidates } from "../perception/perception-recorder";
import { simulationTestWorld } from "../testing/simulation-test-fixtures";

const aliceWaitRequest = {
  agentId: "alice" as never,
  reason: { code: "initial_goal", summary: "Choose a first goal" },
  taskOptions: [
    {
      kind: "empty" as const,
      id: "task-option:alice:empty-head" as never,
      label: "Clear head task",
      taskSlots: ["HEAD" as const],
      argumentSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      kind: "empty" as const,
      id: "task-option:alice:empty-body" as never,
      label: "Clear body task",
      taskSlots: ["BODY" as const],
      argumentSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      kind: "operation" as const,
      id: "task-option:alice:wait" as never,
      operationId: "core.wait" as never,
      label: "Wait",
      taskSlots: ["BODY" as const],
      argumentSchema: {
        type: "object",
        properties: { durationTicks: { type: "integer", minimum: 1 } },
        required: ["durationTicks"],
        additionalProperties: false,
      },
      fixedArguments: {},
    },
  ],
};

describe("decision gate", () => {
  it("builds model input without hidden world facts", () => {
    const base = simulationTestWorld();
    const withMemory = recordPerceptionCandidates(
      base,
      [
        {
          agentId: "alice" as never,
          observationKind: "memory",
          summary: "Test memory",
          relatedEntityId: null,
          subject: { kind: "memory", memoryId: "test-memory" },
        },
      ],
      () => ({
        causationId: "test-memory",
        correlationId: "test-memory",
      }),
    ).world;
    const fridge = withMemory.objects.get("fridge-1" as never)!;
    const world = {
      ...withMemory,
      objects: new Map(withMemory.objects).set("fridge-1" as never, {
        ...fridge,
        state: { holder: "bob" },
      }),
    };

    const transition = requestDecisions(world, [aliceWaitRequest]);
    const request = transition.world.decisionCycle?.requests.get("alice" as never);

    expect(request?.promptInput.perception.visibleEntities).toEqual([]);
    expect(JSON.stringify(request?.promptInput)).not.toContain("holder");
    expect(request?.promptInput.memories).toHaveLength(1);
    expect(request?.promptInput.activeTasks).toEqual({
      tracks: { HEAD: null, BODY: null },
      operations: [],
    });
    expect(request?.promptInput.bodySensations).toEqual([
      {
        need: "bladder",
        level: "comfortable",
        description: "Bladder need is comfortable",
      },
    ]);
  });

  it("accepts only task options offered for the selected track", () => {
    const thinking = requestDecisions(simulationTestWorld(), [aliceWaitRequest]).world;
    const request = thinking.decisionCycle?.requests.get("alice" as never);
    if (!request) throw new Error("Missing Alice decision request");
    const result: ModelDecisionResult = {
      ...request.identity,
      proposal: {
        schemaVersion: 2,
        head: { kind: "continue" },
        body: {
          kind: "replace",
          taskOptionId: "task-option:alice:not-offered" as never,
          arguments: {},
        },
        reason: "Use an unavailable choice",
      },
    };

    const rejected = acceptDecisionResult(thinking, result);

    expect(rejected.accepted).toBe(false);
    expect(rejected.reason).toMatch(/not offered/i);
    expect(rejected.world).toBe(thinking);
  });

  it("retries only the failed request and keeps accepted peer results", () => {
    const initial = requestDecisions(simulationTestWorld(), [
      aliceWaitRequest,
      {
        ...aliceWaitRequest,
        agentId: "bob" as never,
        taskOptions: [
          {
            kind: "empty" as const,
            id: "task-option:bob:empty-head" as never,
            label: "Clear head task",
            taskSlots: ["HEAD" as const],
            argumentSchema: {},
          },
          {
            kind: "empty" as const,
            id: "task-option:bob:empty-body" as never,
            label: "Clear body task",
            taskSlots: ["BODY" as const],
            argumentSchema: {},
          },
          {
            kind: "operation" as const,
            id: "task-option:bob:wait" as never,
            operationId: "core.wait" as never,
            label: "Wait",
            taskSlots: ["BODY" as const],
            argumentSchema: {},
            fixedArguments: {},
          },
        ],
      },
    ]).world;
    const aliceRequest = initial.decisionCycle!.requests.get("alice" as never)!;
    const aliceAccepted = acceptDecisionResult(initial, {
      ...aliceRequest.identity,
      proposal: {
        schemaVersion: 2,
        head: { kind: "continue" },
        body: {
          kind: "replace",
          taskOptionId: "task-option:alice:wait" as never,
          arguments: { durationTicks: 10 },
        },
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
    expect(retriedAlice.acceptedProposal?.body).toEqual({
      kind: "replace",
      taskOptionId: "task-option:alice:wait",
      arguments: { durationTicks: 10 },
    });
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
        taskOptions: [
          {
            kind: "empty" as const,
            id: "task-option:bob:empty-head" as never,
            label: "Clear head task",
            taskSlots: ["HEAD" as const],
            argumentSchema: {},
          },
          {
            kind: "empty" as const,
            id: "task-option:bob:empty-body" as never,
            label: "Clear body task",
            taskSlots: ["BODY" as const],
            argumentSchema: {},
          },
          {
            kind: "operation" as const,
            id: "task-option:bob:wait" as never,
            operationId: "core.wait" as never,
            label: "Wait",
            taskSlots: ["BODY" as const],
            argumentSchema: {},
            fixedArguments: {},
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
