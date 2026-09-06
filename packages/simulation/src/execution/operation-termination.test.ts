import { describe, expect, it } from "vitest";

import type { OperationTerminationTransaction } from "./operation-runtime";
import {
  commitActiveOperationTerminations,
  commitOperationTermination,
} from "./operation-termination";
import type { ActiveOperation } from "./operation";
import {
  simulationTestWorld,
  testPluginRegistry,
} from "../testing/simulation-test-fixtures";

const agentId = "alice" as never;

function worldWith(operation: ActiveOperation) {
  const world = simulationTestWorld();
  const agent = world.agents.get(agentId)!;
  return {
    ...world,
    mode: "RUNNING" as const,
    agents: new Map(world.agents).set(agentId, {
      ...agent,
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

function waitOperation(callId: string): ActiveOperation {
  return {
    callId: callId as never,
    operationId: "core.wait" as never,
    taskOptionId: `task-option:${callId}` as never,
    label: "Wait",
    taskSlots: ["BODY"],
    arguments: { durationTicks: 1 },
    duration: { kind: "fixed", totalTicks: 1 },
    startedAtTick: 0,
    progressTicks: 1,
    state: {},
    plan: {
      currentActionIndex: 0,
      actions: [{ id: `${callId}:action`, kind: "wait", durationTicks: 1, progressTicks: 1 }],
    },
  };
}

function transaction(
  operation: ActiveOperation,
  outcome: OperationTerminationTransaction["outcome"],
  proposal: OperationTerminationTransaction["proposal"],
  source = "operation_completed",
): OperationTerminationTransaction {
  if (outcome === "failed") {
    return {
      agentId,
      callId: operation.callId,
      operationId: operation.operationId,
      outcome,
      source,
      terminatedAtTick: 0,
      failure: { kind: "domain_failure", code: "occupied", details: {} },
      proposal,
    };
  }
  return {
    agentId,
    callId: operation.callId,
    operationId: operation.operationId,
    outcome,
    source,
    terminatedAtTick: 0,
    proposal,
  };
}

describe("atomic operation termination", () => {
  it("commits completion, cleanup and exactly one terminal result together", () => {
    const operation = waitOperation("operation-call:atomic:complete");
    const world = worldWith(operation);
    const result = commitOperationTermination(
      world,
      testPluginRegistry,
      transaction(operation, "completed", { effects: [], result: {} }),
    );

    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") return;
    const agent = result.world.agents.get(agentId)!;
    expect(agent.activeOperations.has(operation.callId)).toBe(false);
    expect(agent.taskTracks.BODY).toEqual({ kind: "empty" });
    expect(result.events.map((event) => event.type)).toEqual([
      "operation_terminated",
      "operation_result",
    ]);
    expect(
      result.events.filter(
        (event) => event.type === "operation_result" && event.terminal,
      ),
    ).toHaveLength(1);
    expect(agent.pendingOperationResults).toHaveLength(1);
  });

  it("commits a declared failure through the same terminal path", () => {
    const operation: ActiveOperation = {
      ...waitOperation("operation-call:atomic:failed"),
      operationId: "object.test.fridge.use" as never,
      arguments: { targetEntityId: "fridge-1", parameters: {} },
    };
    const world = worldWith(operation);
    const result = commitOperationTermination(
      world,
      testPluginRegistry,
      transaction(
        operation,
        "failed",
        { effects: [], result: { status: "failed" } },
        "occupied",
      ),
    );

    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") return;
    expect(result.events.at(-1)).toMatchObject({
      type: "operation_result",
      outcome: "failed",
      reasonCode: "occupied",
      result: { status: "failed" },
    });
  });

  it("applies cancellation compensation before releasing the call", () => {
    const operation: ActiveOperation = {
      ...waitOperation("operation-call:atomic:cancel"),
      operationId: "object.test.fridge.use" as never,
      arguments: { targetEntityId: "fridge-1", parameters: {} },
    };
    const base = worldWith(operation);
    const fridge = base.objects.get("fridge-1" as never)!;
    const world = {
      ...base,
      objects: new Map(base.objects).set(fridge.id, {
        ...fridge,
        version: 1,
        state: { holder: agentId },
      }),
    };
    const result = commitOperationTermination(
      world,
      testPluginRegistry,
      transaction(
        operation,
        "cancelled",
        {
          effects: [
            {
              type: "release_occupancy",
              entityId: fridge.id,
              agentId,
              expectedObjectVersion: 1,
            },
          ],
          result: { status: "cancelled" },
        },
        "task_replaced",
      ),
    );

    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") return;
    expect(result.world.objects.get(fridge.id)).toMatchObject({
      version: 2,
      state: { holder: null },
    });
    expect(result.events.map((event) => event.type)).toEqual([
      "object_state_changed",
      "operation_terminated",
      "operation_result",
    ]);
  });

  it("keeps the original world and call when compensation is rejected", () => {
    const operation: ActiveOperation = {
      ...waitOperation("operation-call:atomic:rejected"),
      operationId: "object.test.fridge.use" as never,
      arguments: { targetEntityId: "fridge-1", parameters: {} },
    };
    const world = worldWith(operation);
    const result = commitOperationTermination(
      world,
      testPluginRegistry,
      transaction(operation, "cancelled", {
        effects: [
          {
            type: "release_occupancy",
            entityId: "fridge-1" as never,
            agentId,
            expectedObjectVersion: 99,
          },
        ],
        result: { status: "cancelled" },
      }, "task_replaced"),
    );

    expect(result.kind).toBe("technical_failure");
    expect(world.agents.get(agentId)?.activeOperations.has(operation.callId)).toBe(true);
    expect(result).toMatchObject({
      failure: { code: "termination_effect_rejected", kind: "technical_failure" },
    });
  });

  it("does not compensate or emit a second result on repeated termination", () => {
    const operation = waitOperation("operation-call:atomic:repeat");
    const world = worldWith(operation);
    const tx = transaction(operation, "completed", { effects: [], result: {} });
    const first = commitOperationTermination(world, testPluginRegistry, tx);
    expect(first.kind).toBe("committed");
    if (first.kind !== "committed") return;
    const second = commitOperationTermination(first.world, testPluginRegistry, tx);
    expect(second.kind).toBe("technical_failure");
    expect(second).toMatchObject({ failure: { code: "termination_already_committed" } });
    expect(
      first.events.filter((event) => event.type === "operation_result"),
    ).toHaveLength(1);
    expect(
      first.world.agents.get(agentId)?.pendingOperationResults.filter(
        (result) => result.callId === operation.callId && result.terminal,
      ),
    ).toHaveLength(1);
  });

  it("keeps every call unchanged when one member of a termination batch rejects", () => {
    const firstOperation = waitOperation("operation-call:atomic:batch-first");
    const secondOperation: ActiveOperation = {
      ...waitOperation("operation-call:atomic:batch-second"),
      operationId: "object.test.fridge.use" as never,
      arguments: { targetEntityId: "fridge-1", parameters: {} },
    };
    const base = worldWith(firstOperation);
    const agent = base.agents.get(agentId)!;
    const world = {
      ...base,
      agents: new Map(base.agents).set(agentId, {
        ...agent,
        activeOperations: new Map([
          [firstOperation.callId, firstOperation],
          [secondOperation.callId, secondOperation],
        ]),
      }),
    };
    const result = commitActiveOperationTerminations(world, testPluginRegistry, [
      {
        agentId,
        operation: firstOperation,
        outcome: "completed",
        source: "operation_completed",
        proposal: { effects: [] },
      },
      {
        agentId,
        operation: secondOperation,
        outcome: "cancelled",
        source: "task_replaced",
        proposal: {
          effects: [
            {
              type: "release_occupancy",
              entityId: "fridge-1" as never,
              agentId,
              expectedObjectVersion: 99,
            },
          ],
        },
        resultOverride: { status: "cancelled" },
      },
    ]);

    expect(result).toMatchObject({
      kind: "technical_failure",
      failure: { code: "termination_effect_rejected" },
    });
    expect(world.agents.get(agentId)?.activeOperations.has(firstOperation.callId)).toBe(true);
    expect(world.agents.get(agentId)?.activeOperations.has(secondOperation.callId)).toBe(true);
    expect(world.agents.get(agentId)?.pendingOperationResults).toHaveLength(0);
  });

  it("can close a hosted call whose active-call store is owned by its caller", () => {
    const operation = waitOperation("operation-call:atomic:external-store");
    const result = commitOperationTermination(
      simulationTestWorld(),
      testPluginRegistry,
      transaction(operation, "completed", { effects: [], result: {} }),
    );

    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") return;
    expect(
      result.world.agents
        .get(agentId)
        ?.pendingOperationResults.filter(
          (item) => item.callId === operation.callId && item.terminal,
        ),
    ).toHaveLength(1);
  });
});
