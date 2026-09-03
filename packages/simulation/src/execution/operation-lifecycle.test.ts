import { describe, expect, it } from "vitest";

import { acceptDecisionResult, requestDecisions } from "../decision/decision-gate";
import { releaseDecisionCycle } from "../decision/release-policy";
import type { ActiveOperation } from "./operation";
import {
  accumulateOperationObservations,
  recordFuseResults,
} from "./operation-lifecycle";
import { buildTaskOptions } from "./operation-catalog";
import { runTickPipeline } from "../engine/tick-pipeline";
import {
  simulationTestWorld,
  testPluginRegistry,
} from "../testing/simulation-test-fixtures";

function withActiveOperation(
  operation: ActiveOperation,
  position = { x: 3, y: 2 },
) {
  const base = simulationTestWorld();
  const aliceId = "alice" as never;
  const alice = base.agents.get(aliceId)!;
  return {
    ...base,
    mode: "RUNNING" as const,
    agents: new Map(base.agents).set(aliceId, {
      ...alice,
      position,
      taskTracks: {
        HEAD: operation.taskSlots.includes("HEAD")
          ? { kind: "operation" as const, callId: operation.callId }
          : { kind: "empty" as const },
        BODY: operation.taskSlots.includes("BODY")
          ? { kind: "operation" as const, callId: operation.callId }
          : { kind: "empty" as const },
      },
      activeOperations: new Map([[operation.callId, operation]]),
    }),
  };
}

function moveOperation(progressTicks: number): ActiveOperation {
  return {
    callId: "operation-call:test:move-result" as never,
    operationId: "core.move" as never,
    taskOptionId: "task-option:test:move-result" as never,
    label: "Move",
    taskSlots: ["BODY"],
    arguments: { targetEntityId: "fridge-1" },
    duration: { kind: "indeterminate" },
    startedAtTick: 0,
    progressTicks,
    state: { accumulatedObservations: [], observationDeliveryCursor: 0 },
    plan: {
      currentActionIndex: 0,
      actions: [
        {
          id: "operation-call:test:move-result:action:0",
          kind: "move",
          path: [
            { x: 3, y: 2 },
            { x: 3, y: 1 },
          ],
          durationTicks: 2,
          progressTicks,
        },
      ],
    },
  };
}

function moveWithObservations(
  observations: readonly { entityId: string; kind: "object" | "agent"; summary: string }[],
): ActiveOperation {
  const operation = moveOperation(0);
  return {
    ...operation,
    state: {
      accumulatedObservations: observations.map((observation) => ({
        ...observation,
        entityId: observation.entityId as never,
      })),
      observationDeliveryCursor: 0,
    },
  };
}

describe("operation lifecycle results", () => {
  it("invokes fuse through the registered operation and emits a nonterminal receipt", () => {
    const operation = moveWithObservations([
      { entityId: "wall-1", kind: "object", summary: "Wall" },
    ]);
    const world = withActiveOperation(operation);

    const fused = recordFuseResults(
      world,
      testPluginRegistry,
      ["alice" as never],
      { causationId: "test:fuse", correlationId: "test:fuse" },
    );

    expect(fused.events).toEqual([
      expect.objectContaining({
        type: "operation_result",
        callId: operation.callId,
        terminal: false,
        outcome: null,
        result: {
          nearby: [
            { entityId: "wall-1", kind: "object", summary: "Wall" },
          ],
        },
      }),
    ]);
    expect(
      fused.world.agents
        .get("alice" as never)
        ?.activeOperations.get(operation.callId),
    ).toBe(operation);
  });

  it("returns the plugin result after successful interaction effects commit", () => {
    const operation: ActiveOperation = {
      callId: "operation-call:test:fridge-result" as never,
      operationId: "object.test.fridge.use" as never,
      taskOptionId: "task-option:test:fridge-result" as never,
      label: "Use fridge",
      taskSlots: ["BODY"],
      arguments: { targetEntityId: "fridge-1", parameters: {} },
      duration: { kind: "fixed", totalTicks: 10 },
      startedAtTick: 0,
      progressTicks: 9,
      state: {},
      plan: {
        currentActionIndex: 0,
        actions: [
          {
            id: "operation-call:test:fridge-result:action:0",
            kind: "interact_object",
            purpose: "direct",
            targetEntityId: "fridge-1" as never,
            interactionId: "use",
            durationTicks: 10,
            progressTicks: 9,
            started: true,
          },
        ],
      },
    };
    const active = withActiveOperation(operation, { x: 4, y: 2 });
    const fridge = active.objects.get("fridge-1" as never)!;
    const world = {
      ...active,
      objects: new Map(active.objects).set(fridge.id, {
        ...fridge,
        version: 1,
        state: { holder: "alice" },
      }),
    };

    const result = runTickPipeline(world, testPluginRegistry);

    expect(
      result.events.filter((event) => event.type === "operation_result"),
    ).toEqual([
      expect.objectContaining({
        callId: operation.callId,
        terminal: true,
        outcome: "completed",
        result: { status: "completed" },
      }),
    ]);
  });

  it("acknowledges delivered move observations only after a continued decision releases", () => {
    const operation = moveWithObservations([
      { entityId: "wall-1", kind: "object", summary: "Wall" },
    ]);
    const firstFuse = recordFuseResults(
      withActiveOperation(operation),
      testPluginRegistry,
      ["alice" as never],
      { causationId: "test:first-fuse", correlationId: "test:first-fuse" },
    );
    const thinking = requestDecisions(firstFuse.world, [
      {
        agentId: "alice" as never,
        reason: { code: "test_fuse", summary: "Review movement" },
        taskOptions: buildTaskOptions(
          firstFuse.world,
          testPluginRegistry,
          "alice" as never,
        ),
      },
    ]).world;
    const request = thinking.decisionCycle!.requests.get("alice" as never)!;
    const accepted = acceptDecisionResult(thinking, {
      ...request.identity,
      proposal: {
        schemaVersion: 2,
        head: { kind: "continue" },
        body: { kind: "continue" },
        reason: "Keep moving",
      },
    });
    expect(accepted.accepted).toBe(true);
    const released = releaseDecisionCycle(
      accepted.world,
      testPluginRegistry,
    ).world;
    expect(
      released.agents
        .get("alice" as never)
        ?.activeOperations.get(operation.callId)?.state,
    ).toMatchObject({ observationDeliveryCursor: 1 });

    const observed = accumulateOperationObservations(
      released,
      testPluginRegistry,
      "alice" as never,
      [
        {
          entityId: "fridge-1" as never,
          kind: "object",
          summary: "Fridge",
        },
      ],
    );
    const secondFuse = recordFuseResults(
      observed,
      testPluginRegistry,
      ["alice" as never],
      { causationId: "test:second-fuse", correlationId: "test:second-fuse" },
    );

    expect(secondFuse.events).toEqual([
      expect.objectContaining({
        type: "operation_result",
        terminal: false,
        result: {
          nearby: [
            { entityId: "fridge-1", kind: "object", summary: "Fridge" },
          ],
        },
      }),
    ]);
  });

  it("does not repeat acknowledged move observations in a cancellation result", () => {
    const operation = moveWithObservations([
      { entityId: "wall-1", kind: "object", summary: "Wall" },
    ]);
    const fused = recordFuseResults(
      withActiveOperation(operation),
      testPluginRegistry,
      ["alice" as never],
      { causationId: "test:fuse-cancel", correlationId: "test:fuse-cancel" },
    );
    const taskOptions = buildTaskOptions(
      fused.world,
      testPluginRegistry,
      "alice" as never,
    );
    const emptyBody = taskOptions.find(
      (option) => option.kind === "empty" && option.taskSlots[0] === "BODY",
    )!;
    const thinking = requestDecisions(fused.world, [
      {
        agentId: "alice" as never,
        reason: { code: "test_fuse", summary: "Stop movement" },
        taskOptions,
      },
    ]).world;
    const request = thinking.decisionCycle!.requests.get("alice" as never)!;
    const accepted = acceptDecisionResult(thinking, {
      ...request.identity,
      proposal: {
        schemaVersion: 2,
        head: { kind: "continue" },
        body: {
          kind: "replace",
          taskOptionId: emptyBody.id,
          arguments: {},
        },
        reason: "Stop moving",
      },
    });
    expect(accepted.accepted).toBe(true);
    const released = releaseDecisionCycle(accepted.world, testPluginRegistry);

    expect(
      released.events.filter((event) => event.type === "operation_result"),
    ).toEqual([
      expect.objectContaining({
        callId: operation.callId,
        terminal: true,
        outcome: "cancelled",
        result: { nearby: [] },
      }),
    ]);
  });

  it("returns the plugin failure result after failure effects commit", () => {
    const operation: ActiveOperation = {
      callId: "operation-call:test:fridge-failure" as never,
      operationId: "object.test.fridge.use" as never,
      taskOptionId: "task-option:test:fridge-failure" as never,
      label: "Use fridge",
      taskSlots: ["BODY"],
      arguments: { targetEntityId: "fridge-1", parameters: {} },
      duration: { kind: "fixed", totalTicks: 10 },
      startedAtTick: 0,
      progressTicks: 9,
      state: {},
      plan: {
        currentActionIndex: 0,
        actions: [
          {
            id: "operation-call:test:fridge-failure:action:0",
            kind: "interact_object",
            purpose: "direct",
            targetEntityId: "fridge-1" as never,
            interactionId: "use",
            durationTicks: 10,
            progressTicks: 9,
            started: true,
          },
        ],
      },
    };
    const active = withActiveOperation(operation, { x: 3, y: 2 });
    const fridge = active.objects.get("fridge-1" as never)!;
    const world = {
      ...active,
      objects: new Map(active.objects).set(fridge.id, {
        ...fridge,
        version: 1,
        state: { holder: "alice" },
      }),
    };

    const result = runTickPipeline(world, testPluginRegistry);

    expect(result.world.objects.get("fridge-1" as never)).toMatchObject({
      version: 2,
      state: { holder: null },
    });
    expect(
      result.events.filter((event) => event.type === "operation_result"),
    ).toEqual([
      expect.objectContaining({
        callId: operation.callId,
        terminal: true,
        outcome: "failed",
        reasonCode: "not_at_interaction_position",
        result: { status: "failed" },
      }),
    ]);
  });

  it("returns a deduplicated summary of everything seen during a move", () => {
    const result = runTickPipeline(
      withActiveOperation(moveOperation(1)),
      testPluginRegistry,
    );
    const receipt = result.events.find(
      (event) =>
        event.type === "operation_result" &&
        event.callId === "operation-call:test:move-result",
    );
    if (!receipt || receipt.type !== "operation_result") {
      throw new Error("Missing move operation result");
    }
    const nearby = receipt.result["nearby"] as Array<{ entityId: string }>;
    const ids = nearby.map((item) => item.entityId);

    expect(ids).toContain("fridge-1");
    expect(ids).toContain("bob");
    expect(new Set(ids).size).toBe(ids.length);
  });
});
