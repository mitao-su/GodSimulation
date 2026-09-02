import { describe, expect, it } from "vitest";

import type {
  AgentId,
  ModelDecisionResult,
  TaskDecision,
  TaskOption,
} from "@god-sim/protocol";

import { acceptDecisionResult, requestDecisions } from "./decision-gate";
import {
  applyReleasePolicy,
  releaseDecisionCycle,
} from "./release-policy";
import { buildTaskOptions } from "../execution/operation-catalog";
import { prepareOperationCall } from "../execution/operation-planner";
import {
  simulationTestWorld,
  testPluginRegistry,
} from "../testing/simulation-test-fixtures";
import type { WorldState } from "../world/world-state";

const SYNCHRONIZED_WAIT: TaskOption = {
  kind: "operation",
  id: "task-option:synchronized-wait" as never,
  operationId: "test.synchronized_wait" as never,
  label: "Synchronized wait",
  taskSlots: ["HEAD", "BODY"],
  argumentSchema: {},
  fixedArguments: {},
};

function optionsFor(
  world: WorldState,
  agentId: AgentId,
  synchronized = false,
): readonly TaskOption[] {
  const options = buildTaskOptions(world, testPluginRegistry, agentId);
  return synchronized
    ? [
        ...options,
        { ...SYNCHRONIZED_WAIT, id: `task-option:${agentId}:synchronized-wait` as never },
      ]
    : options;
}

function requests(
  world: WorldState = simulationTestWorld(),
  synchronized = false,
): WorldState {
  return requestDecisions(
    world,
    (["alice", "bob"] as const).map((agentId) => ({
      agentId: agentId as AgentId,
      reason: { code: "test_decision", summary: "Choose tasks" },
      taskOptions: optionsFor(world, agentId as AgentId, synchronized),
    })),
  ).world;
}

function waitDecision(world: WorldState, agentId: "alice" | "bob"): TaskDecision {
  const request = world.decisionCycle?.requests.get(agentId as never);
  const wait = request?.promptInput.taskOptions.find(
    (option) => option.kind === "operation" && option.operationId === "core.wait",
  );
  if (!wait) throw new Error(`Missing wait task for ${agentId}`);
  return {
    schemaVersion: 2,
    head: { kind: "continue" },
    body: {
      kind: "replace",
      taskOptionId: wait.id,
      arguments: { durationTicks: 10 },
    },
    reason: "Wait",
  };
}

function synchronizedDecision(
  world: WorldState,
  agentId: "alice" | "bob",
  headTicks = 10,
  bodyTicks = headTicks,
): TaskDecision {
  const request = world.decisionCycle?.requests.get(agentId as never);
  const option = request?.promptInput.taskOptions.find(
    (candidate) => candidate.label === "Synchronized wait",
  );
  if (!option) throw new Error(`Missing synchronized task for ${agentId}`);
  return {
    schemaVersion: 2,
    head: {
      kind: "replace",
      taskOptionId: option.id,
      arguments: { durationTicks: headTicks },
    },
    body: {
      kind: "replace",
      taskOptionId: option.id,
      arguments: { durationTicks: bodyTicks },
    },
    reason: "Use both tracks",
  };
}

function resultFor(
  world: WorldState,
  agentId: "alice" | "bob",
  proposal: TaskDecision,
): ModelDecisionResult {
  const request = world.decisionCycle?.requests.get(agentId as never);
  if (!request) throw new Error(`Missing request for ${agentId}`);
  return { ...request.identity, proposal };
}

function accept(
  world: WorldState,
  identityWorld: WorldState,
  agentId: "alice" | "bob",
  proposal: TaskDecision,
): WorldState {
  const accepted = acceptDecisionResult(
    world,
    resultFor(identityWorld, agentId, proposal),
  );
  if (!accepted.accepted) throw new Error(accepted.reason ?? "Decision rejected");
  return accepted.world;
}

function readyWorld(
  thinking: WorldState,
  agentId: "alice" | "bob",
): WorldState {
  return accept(
    thinking,
    thinking,
    agentId,
    waitDecision(thinking, agentId),
  );
}

function worldWithStartedFridgeUse(): WorldState {
  const base = { ...simulationTestWorld(), reviewRequired: false };
  const aliceId = "alice" as never;
  const fridgeId = "fridge-1" as never;
  const alice = base.agents.get(aliceId)!;
  const knownFridge = {
    entityId: fridgeId,
    displayName: "Fridge",
    status: "available",
    summary: "Available",
    observable: { holder: null },
    interactionAvailability: [],
    position: { x: 4, y: 1 },
    sourceEventId: "event:test:fridge" as never,
    observedAtTick: 0,
    observationKind: "vision" as const,
  };
  const inRange = {
    ...base,
    agents: new Map(base.agents).set(aliceId, {
      ...alice,
      position: { x: 4, y: 2 },
      knowledge: {
        ...alice.knowledge,
        objects: new Map([[fridgeId, knownFridge]]),
        visibleEntityIds: new Set([fridgeId]),
      },
    }),
  };
  const option = buildTaskOptions(inRange, testPluginRegistry, aliceId).find(
    (candidate) =>
      candidate.kind === "operation" &&
      candidate.operationId === "object.test.fridge.use",
  );
  if (!option || option.kind !== "operation") {
    throw new Error("Missing fridge use task");
  }
  const prepared = prepareOperationCall(
    inRange,
    testPluginRegistry,
    aliceId,
    option,
    {},
    "operation-call:test:fridge-use" as never,
  );
  if (prepared.kind !== "prepared") throw new Error(prepared.summary);
  const action = prepared.operation.plan.actions[0];
  if (!action || action.kind !== "interact_object") {
    throw new Error("Fridge use did not create an interaction action");
  }
  const operation = {
    ...prepared.operation,
    progressTicks: 2,
    plan: {
      ...prepared.operation.plan,
      actions: [{ ...action, started: true, progressTicks: 2 }],
    },
  };
  const activeAlice = inRange.agents.get(aliceId)!;
  const fridge = inRange.objects.get(fridgeId)!;
  return {
    ...inRange,
    agents: new Map(inRange.agents).set(aliceId, {
      ...activeAlice,
      taskTracks: {
        HEAD: { kind: "empty" },
        BODY: { kind: "operation", callId: operation.callId },
      },
      activeOperations: new Map([[operation.callId, operation]]),
    }),
    objects: new Map(inRange.objects).set(fridgeId, {
      ...fridge,
      version: 1,
      state: { holder: "alice" },
    }),
  };
}

describe("decision release policy", () => {
  it("keeps every task unchanged until all requested agents are ready", () => {
    const thinking = requests();
    const aliceBefore = thinking.agents.get("alice" as never)!;
    const bobBefore = thinking.agents.get("bob" as never)!;

    const first = accept(
      thinking,
      thinking,
      "alice",
      waitDecision(thinking, "alice"),
    );
    const pending = applyReleasePolicy(first, testPluginRegistry);

    expect(pending.world).toBe(first);
    expect(pending.events).toEqual([]);
    expect(first.agents.get("alice" as never)).toBe(aliceBefore);
    expect(first.agents.get("bob" as never)).toBe(bobBefore);
    expect(first.mode).toBe("THINKING");
    expect(first.tick).toBe(0);
  });

  it("atomically creates every new call at progress zero when review is disabled", () => {
    const thinking = requests({ ...simulationTestWorld(), reviewRequired: false });
    const aliceReady = accept(
      thinking,
      thinking,
      "alice",
      waitDecision(thinking, "alice"),
    );
    const ready = accept(
      aliceReady,
      thinking,
      "bob",
      waitDecision(thinking, "bob"),
    );

    const released = applyReleasePolicy(ready, testPluginRegistry);

    expect(released.world.mode).toBe("RUNNING");
    expect(released.world.decisionCycle).toBeNull();
    for (const agentId of ["alice", "bob"] as const) {
      const agent = released.world.agents.get(agentId as never)!;
      expect(agent.taskTracks.HEAD).toEqual({ kind: "empty" });
      expect(agent.taskTracks.BODY.kind).toBe("operation");
      expect([...agent.activeOperations.values()]).toEqual([
        expect.objectContaining({
          operationId: "core.wait",
          duration: { kind: "fixed", totalTicks: 10 },
          startedAtTick: 0,
          progressTicks: 0,
        }),
      ]);
    }
    expect(
      released.events
        .filter((event) => event.type === "operation_started")
        .map((event) => ({
          agentId: event.agentId,
          operationId: event.operationId,
          taskSlots: event.taskSlots,
        })),
    ).toEqual([
      { agentId: "alice", operationId: "core.wait", taskSlots: ["BODY"] },
      { agentId: "bob", operationId: "core.wait", taskSlots: ["BODY"] },
    ]);
  });

  it("emits one start event for each synchronized call instead of one per track", () => {
    const thinking = requests(
      { ...simulationTestWorld(), reviewRequired: false },
      true,
    );
    let ready = thinking;
    for (const agentId of ["alice", "bob"] as const) {
      ready = accept(
        ready,
        thinking,
        agentId,
        synchronizedDecision(thinking, agentId),
      );
    }

    const released = releaseDecisionCycle(ready, testPluginRegistry);

    expect(
      released.events.filter((event) => event.type === "operation_started"),
    ).toEqual([
      expect.objectContaining({
        type: "operation_started",
        agentId: "alice",
        taskSlots: ["HEAD", "BODY"],
      }),
      expect.objectContaining({
        type: "operation_started",
        agentId: "bob",
        taskSlots: ["HEAD", "BODY"],
      }),
    ]);
  });

  it("replacing both tracks with empty tasks creates no calls", () => {
    const thinking = requests({ ...simulationTestWorld(), reviewRequired: false });
    let ready = thinking;
    for (const agentId of ["alice", "bob"] as const) {
      const request = thinking.decisionCycle!.requests.get(agentId as never)!;
      const head = request.promptInput.taskOptions.find(
        (option) => option.kind === "empty" && option.taskSlots[0] === "HEAD",
      )!;
      const body = request.promptInput.taskOptions.find(
        (option) => option.kind === "empty" && option.taskSlots[0] === "BODY",
      )!;
      ready = accept(ready, thinking, agentId, {
        schemaVersion: 2,
        head: { kind: "replace", taskOptionId: head.id, arguments: {} },
        body: { kind: "replace", taskOptionId: body.id, arguments: {} },
        reason: "Clear both tracks",
      });
    }

    const released = releaseDecisionCycle(ready, testPluginRegistry);

    expect(
      [...released.world.agents.values()].flatMap((agent) => [
        ...agent.activeOperations.values(),
      ]),
    ).toEqual([]);
  });

  it("rejects selecting a synchronized task on only one declared track", () => {
    const thinking = requests({ ...simulationTestWorld(), reviewRequired: false }, true);
    const full = synchronizedDecision(thinking, "alice");
    const result = acceptDecisionResult(
      readyWorld(thinking, "bob"),
      resultFor(thinking, "alice", {
        ...full,
        body: { kind: "continue" },
      }),
    );

    expect(result).toMatchObject({
      accepted: false,
      reason: expect.stringMatching(/all declared tracks/i),
    });
  });

  it("rejects different arguments for the two halves of a synchronized task", () => {
    const thinking = requests({ ...simulationTestWorld(), reviewRequired: false }, true);
    const result = acceptDecisionResult(
      readyWorld(thinking, "bob"),
      resultFor(
        thinking,
        "alice",
        synchronizedDecision(thinking, "alice", 10, 11),
      ),
    );

    expect(result).toMatchObject({
      accepted: false,
      reason: expect.stringMatching(/same arguments/i),
    });
  });

  it("rejects replacing only one half of an existing synchronized call", () => {
    const initial = requests({ ...simulationTestWorld(), reviewRequired: false }, true);
    let ready = initial;
    for (const agentId of ["alice", "bob"] as const) {
      ready = accept(
        ready,
        initial,
        agentId,
        synchronizedDecision(initial, agentId),
      );
    }
    const running = releaseDecisionCycle(ready, testPluginRegistry).world;
    const thinking = requests(running);
    const aliceRequest = thinking.decisionCycle!.requests.get("alice" as never)!;
    const emptyHead = aliceRequest.promptInput.taskOptions.find(
      (option) => option.kind === "empty" && option.taskSlots[0] === "HEAD",
    )!;
    const aliceReady = accept(readyWorld(thinking, "bob"), thinking, "alice", {
      schemaVersion: 2,
      head: {
        kind: "replace",
        taskOptionId: emptyHead.id,
        arguments: {},
      },
      body: { kind: "continue" },
      reason: "Replace only head",
    });

    expect(() => releaseDecisionCycle(aliceReady, testPluginRegistry)).toThrow(
      /synchronized call/i,
    );
  });

  it("keeps an independent continued call object and its progress unchanged", () => {
    const initial = requests({ ...simulationTestWorld(), reviewRequired: false });
    let ready = initial;
    for (const agentId of ["alice", "bob"] as const) {
      ready = accept(ready, initial, agentId, waitDecision(initial, agentId));
    }
    const running = releaseDecisionCycle(ready, testPluginRegistry).world;
    const alice = running.agents.get("alice" as never)!;
    const bodyCall = [...alice.activeOperations.values()][0]!;
    const progressedCall = { ...bodyCall, progressTicks: 4 };
    const progressed = {
      ...running,
      agents: new Map(running.agents).set("alice" as never, {
        ...alice,
        activeOperations: new Map([[bodyCall.callId, progressedCall]]),
      }),
    };
    const thinking = requests(progressed);
    const aliceRequest = thinking.decisionCycle!.requests.get("alice" as never)!;
    const emptyHead = aliceRequest.promptInput.taskOptions.find(
      (option) => option.kind === "empty" && option.taskSlots[0] === "HEAD",
    )!;
    const aliceReady = accept(readyWorld(thinking, "bob"), thinking, "alice", {
      schemaVersion: 2,
      head: {
        kind: "replace",
        taskOptionId: emptyHead.id,
        arguments: {},
      },
      body: { kind: "continue" },
      reason: "Keep waiting",
    });

    const released = releaseDecisionCycle(aliceReady, testPluginRegistry).world;
    const nextAlice = released.agents.get("alice" as never)!;

    expect(nextAlice.activeOperations.get(bodyCall.callId)).toBe(progressedCall);
    expect(nextAlice.taskTracks.BODY).toEqual({
      kind: "operation",
      callId: bodyCall.callId,
    });
  });

  it("commits the cancel lifecycle before replacing a started operation", () => {
    const running = worldWithStartedFridgeUse();
    const thinking = requestDecisions(running, [
      {
        agentId: "alice" as never,
        reason: { code: "change_task", summary: "Stop using the fridge" },
        taskOptions: buildTaskOptions(
          running,
          testPluginRegistry,
          "alice" as never,
        ),
      },
    ]).world;
    const request = thinking.decisionCycle!.requests.get("alice" as never)!;
    const emptyBody = request.promptInput.taskOptions.find(
      (option) => option.kind === "empty" && option.taskSlots[0] === "BODY",
    )!;
    const ready = accept(thinking, thinking, "alice", {
      schemaVersion: 2,
      head: { kind: "continue" },
      body: {
        kind: "replace",
        taskOptionId: emptyBody.id,
        arguments: {},
      },
      reason: "Stop",
    });

    const released = releaseDecisionCycle(ready, testPluginRegistry);

    expect(released.world.objects.get("fridge-1" as never)).toMatchObject({
      version: 2,
      state: { holder: null },
    });
    expect(released.events).toEqual([
      expect.objectContaining({
        type: "object_state_changed",
        entityId: "fridge-1",
      }),
      expect.objectContaining({
        type: "operation_terminated",
        agentId: "alice",
        outcome: "cancelled",
        reasonCode: "task_replaced",
      }),
      expect.objectContaining({
        type: "operation_result",
        agentId: "alice",
        terminal: true,
        outcome: "cancelled",
        reasonCode: "task_replaced",
        result: {},
      }),
    ]);
  });
});
