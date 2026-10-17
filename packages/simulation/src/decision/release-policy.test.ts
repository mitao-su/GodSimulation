import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import type {
  AgentId,
  DirectOperationReference,
  DirectTaskDecision,
  ModelDecisionResult,
  TaskDecision,
  TaskOption,
} from "@god-sim/protocol";

import { acceptDecisionResult, requestDecisions } from "./decision-gate";
import {
  applyReleasePolicy,
  releaseDecisionCycle,
} from "./release-policy";
import { legacyTaskOptionsFor } from "../testing/legacy-task-options";
import {
  prepareDirectOperationCall,
  prepareOperationCall,
} from "../execution/operation-planner";
import type {
  HostedOperationRuntime,
  HostedOperationRuntimeRegistry,
} from "../execution/operation-runtime";
import {
  simulationTestWorld,
  testPluginRegistry,
} from "../testing/simulation-test-fixtures";
import type { DecisionRequestState, WorldState } from "../world/world-state";

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
  const options = legacyTaskOptionsFor(world, testPluginRegistry, agentId);
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

function directRequests(
  world: WorldState = simulationTestWorld(),
  agentIds: readonly ("alice" | "bob")[] = ["alice", "bob"],
): WorldState {
  return requestDecisions(
    world,
    agentIds.map((agentId) => ({
      agentId: agentId as AgentId,
      reason: { code: "test_decision", summary: "Choose direct operations" },
    })),
  ).world;
}

function directWaitDecision(durationTicks = 10): DirectTaskDecision {
  return {
    schemaVersion: 3,
    head: { kind: "continue" },
    body: {
      kind: "replace",
      task: {
        kind: "operation",
        operationId: "core.wait" as never,
        arguments: { durationTicks },
      },
    },
    reason: "Wait",
  };
}

function directEmptyDecision(): DirectTaskDecision {
  return {
    schemaVersion: 3,
    head: { kind: "replace", task: { kind: "empty_task" } },
    body: { kind: "replace", task: { kind: "empty_task" } },
    reason: "Clear both tracks",
  };
}

function acceptDirect(
  world: WorldState,
  identityWorld: WorldState,
  agentId: "alice" | "bob",
  proposal: DirectTaskDecision,
  registry: HostedOperationRuntimeRegistry = testPluginRegistry,
): WorldState {
  const request = identityWorld.decisionCycle?.requests.get(agentId as never);
  if (!request) throw new Error(`Missing direct request for ${agentId}`);
  const accepted = acceptDecisionResult(
    world,
    { ...request.identity, proposal },
    registry,
  );
  if (!accepted.accepted) throw new Error(accepted.reason ?? "Decision rejected");
  return accepted.world;
}

function legacyOptions(
  request: DecisionRequestState | undefined,
): readonly TaskOption[] {
  const options = request?.promptInput.taskOptions;
  if (!options) throw new Error("Missing legacy task options in this fixture");
  return options;
}

function waitDecision(world: WorldState, agentId: "alice" | "bob"): TaskDecision {
  const request = world.decisionCycle?.requests.get(agentId as never);
  const wait = legacyOptions(request).find(
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
  const option = legacyOptions(request).find(
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
  const option = legacyTaskOptionsFor(inRange, testPluginRegistry, aliceId).find(
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
    { parameters: {} },
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

function worldWithStartedHostedFridgeUse(
  registry: typeof testPluginRegistry,
): WorldState {
  const base = { ...simulationTestWorld(), reviewRequired: false };
  const aliceId = "alice" as never;
  const fridgeId = "fridge-1" as never;
  const alice = base.agents.get(aliceId)!;
  const atFridge = {
    ...base,
    agents: new Map(base.agents).set(aliceId, {
      ...alice,
      position: { x: 4, y: 2 },
    }),
  };
  const reference: DirectOperationReference = {
    kind: "operation",
    operationId: "object.test.fridge.use" as never,
    hostEntityId: fridgeId,
    arguments: {},
  };
  const prepared = prepareDirectOperationCall(
    atFridge,
    registry,
    aliceId,
    "BODY",
    reference,
    "operation-call:test:hosted-fridge-use" as never,
  );
  if (prepared.kind !== "prepared") {
    throw new Error(
      prepared.kind === "invalid_reference"
        ? prepared.message
        : prepared.failure.message,
    );
  }
  const operation = {
    ...prepared.operation,
    firstStepState: "started" as const,
    progressTicks: 1,
  };
  const activeAlice = atFridge.agents.get(aliceId)!;
  const fridge = atFridge.objects.get(fridgeId)!;
  return {
    ...atFridge,
    agents: new Map(atFridge.agents).set(aliceId, {
      ...activeAlice,
      taskTracks: {
        HEAD: { kind: "empty" },
        BODY: { kind: "operation", callId: operation.callId },
      },
      activeOperations: new Map([
        [operation.callId, operation as never],
      ]),
    }),
    objects: new Map(atFridge.objects).set(fridgeId, {
      ...fridge,
      version: 1,
      state: { holder: aliceId },
    }),
  };
}

function synchronizedDirectRegistry(): {
  readonly registry: HostedOperationRuntimeRegistry;
  readonly resolveDuration: ReturnType<typeof vi.fn>;
} {
  const baseRuntime = testPluginRegistry.getHostedOperation("core.wait", {
    kind: "agent",
    hostDefinitionId: "test.alice" as never,
  });
  if (!baseRuntime) throw new Error("Missing hosted wait runtime");
  const parametersSchema = z
    .object({ durationTicks: z.number().int().positive().default(10) })
    .strict();
  const resolveDuration = vi.fn(
    (
      _context: Parameters<HostedOperationRuntime["resolveDuration"]>[0],
      _host: Parameters<HostedOperationRuntime["resolveDuration"]>[1],
      argumentsValue: Parameters<HostedOperationRuntime["resolveDuration"]>[2],
    ) => ({
      kind: "fixed" as const,
      totalTicks: parametersSchema.parse(argumentsValue).durationTicks,
    }),
  );
  const runtime: HostedOperationRuntime = {
    ...baseRuntime,
    id: "test.direct_synchronized_wait" as never,
    taskSlots: ["HEAD", "BODY"],
    parametersSchema,
    resolveDuration,
  };
  const registry: HostedOperationRuntimeRegistry = {
    ...testPluginRegistry,
    resolveOperationReference(context, track, reference) {
      if (reference.operationId !== runtime.id) {
        return testPluginRegistry.resolveOperationReference(
          context,
          track,
          reference,
        );
      }
      if (reference.hostEntityId !== undefined) {
        return {
          kind: "invalid_reference",
          code: "invalid_host_reference",
          message: "Agent-hosted operations must omit hostEntityId",
        };
      }
      const parsed = parametersSchema.safeParse(reference.arguments);
      if (!parsed.success) {
        return {
          kind: "invalid_reference",
          code: "invalid_arguments",
          message: parsed.error.message,
        };
      }
      const agent = context.world.agents.get(context.agentId);
      if (!agent) {
        return {
          kind: "invalid_reference",
          code: "unknown_host",
          message: `Unknown agent ${context.agentId}`,
        };
      }
      return {
        kind: "resolved",
        binding: {
          runtime,
          host: { kind: "agent", hostEntityId: context.agentId },
          target: { kind: "none" },
          arguments: parsed.data,
        },
      };
    },
    getHostedOperation(operationId, host) {
      return operationId === runtime.id &&
        host.kind === "agent" &&
        host.hostDefinitionId === "test.alice"
        ? runtime
        : testPluginRegistry.getHostedOperation(operationId, host);
    },
  };
  return { registry, resolveDuration };
}

describe("decision release policy", () => {
  it("keeps direct decisions staged until every requested agent is ready", () => {
    const thinking = directRequests({
      ...simulationTestWorld(),
      reviewRequired: false,
    });
    const aliceBefore = thinking.agents.get("alice" as never)!;
    const bobBefore = thinking.agents.get("bob" as never)!;

    const aliceReady = acceptDirect(
      thinking,
      thinking,
      "alice",
      directWaitDecision(),
    );
    const pending = applyReleasePolicy(aliceReady, testPluginRegistry);

    expect(pending).toEqual({ world: aliceReady, events: [] });
    expect(aliceReady.agents.get("alice" as never)).toBe(aliceBefore);
    expect(aliceReady.agents.get("bob" as never)).toBe(bobBefore);
    expect(aliceReady.mode).toBe("THINKING");
    expect(aliceReady.tick).toBe(thinking.tick);
  });

  it("releases out-of-order direct results as one deterministic batch", () => {
    const thinking = directRequests({
      ...simulationTestWorld(),
      reviewRequired: false,
    });
    const bobReady = acceptDirect(
      thinking,
      thinking,
      "bob",
      directWaitDecision(12),
    );
    const ready = acceptDirect(
      bobReady,
      thinking,
      "alice",
      directWaitDecision(11),
    );

    const released = applyReleasePolicy(ready, testPluginRegistry);

    expect(released.world.mode).toBe("RUNNING");
    expect(released.world.decisionCycle).toBeNull();
    expect(
      released.events
        .filter((event) => event.type === "operation_started")
        .map((event) => event.agentId),
    ).toEqual(["alice", "bob"]);
    expect(
      released.world.agents.get("alice" as never)?.activeOperations.values().next()
        .value,
    ).toMatchObject({
      operationId: "core.wait",
      arguments: { durationTicks: 11 },
      progressTicks: 0,
      firstStepState: "pending",
    });
    expect(
      released.world.agents.get("bob" as never)?.activeOperations.values().next()
        .value,
    ).toMatchObject({
      operationId: "core.wait",
      arguments: { durationTicks: 12 },
      progressTicks: 0,
      firstStepState: "pending",
    });
  });

  it("uses stable empty-task branches without creating call IDs", () => {
    const thinking = directRequests({
      ...simulationTestWorld(),
      reviewRequired: false,
    });
    let ready = thinking;
    for (const agentId of ["bob", "alice"] as const) {
      ready = acceptDirect(
        ready,
        thinking,
        agentId,
        directEmptyDecision(),
      );
    }

    const released = releaseDecisionCycle(ready, testPluginRegistry);

    for (const agent of released.world.agents.values()) {
      expect(agent.taskTracks).toEqual({
        HEAD: { kind: "empty" },
        BODY: { kind: "empty" },
      });
      expect(agent.activeOperations.size).toBe(0);
    }
    expect(
      released.events.filter((event) => event.type === "operation_started"),
    ).toEqual([]);
  });

  it("binds a synchronized direct operation once using normalized arguments", () => {
    const { registry, resolveDuration } = synchronizedDirectRegistry();
    const thinking = directRequests(
      { ...simulationTestWorld(), reviewRequired: false },
      ["alice"],
    );
    const ready = acceptDirect(
      thinking,
      thinking,
      "alice",
      {
        schemaVersion: 3,
        head: {
          kind: "replace",
          task: {
            kind: "operation",
            operationId: "test.direct_synchronized_wait" as never,
            arguments: {},
          },
        },
        body: {
          kind: "replace",
          task: {
            kind: "operation",
            operationId: "test.direct_synchronized_wait" as never,
            arguments: { durationTicks: 10 },
          },
        },
        reason: "Use both tracks",
      },
      registry,
    );

    const released = releaseDecisionCycle(ready, registry);
    const alice = released.world.agents.get("alice" as never)!;
    const call = [...alice.activeOperations.values()][0]!;

    expect(alice.activeOperations.size).toBe(1);
    expect(alice.taskTracks).toEqual({
      HEAD: { kind: "operation", callId: call.callId },
      BODY: { kind: "operation", callId: call.callId },
    });
    expect(call.arguments).toEqual({ durationTicks: 10 });
    expect(resolveDuration).toHaveBeenCalledTimes(1);
    expect(
      released.events.filter((event) => event.type === "operation_started"),
    ).toHaveLength(1);
  });

  it("does not cancel or mutate any agent when final batch preparation fails", () => {
    const hosted = testPluginRegistry.getHostedOperation(
      "object.test.fridge.use",
      { kind: "furniture", hostDefinitionId: "test.fridge" },
    );
    if (!hosted) throw new Error("Missing hosted fridge runtime");
    const cancel = vi.fn(hosted.cancel);
    const registry: HostedOperationRuntimeRegistry = {
      ...testPluginRegistry,
      getHostedOperation(operationId, host) {
        const resolved = testPluginRegistry.getHostedOperation(operationId, host);
        if (
          operationId === "object.test.fridge.use" &&
          host.kind === "furniture" &&
          host.hostDefinitionId === "test.fridge"
        ) {
          return { ...hosted, cancel };
        }
        return resolved;
      },
    };
    const withFridge = worldWithStartedHostedFridgeUse(registry);
    const cycleId = `decision-cycle:${withFridge.version + 1}`;
    const collisionCallId =
      `operation-call:${cycleId}:alice:0` as never;
    const observe = prepareDirectOperationCall(
      withFridge,
      registry,
      "alice" as never,
      "HEAD",
      {
        kind: "operation",
        operationId: "core.observe" as never,
        arguments: { targetEntityId: "wall-1" as never },
      },
      collisionCallId,
    );
    if (observe.kind !== "prepared") {
      throw new Error(
        observe.kind === "invalid_reference"
          ? observe.message
          : observe.failure.message,
      );
    }
    const alice = withFridge.agents.get("alice" as never)!;
    const collisionWorld = {
      ...withFridge,
      agents: new Map(withFridge.agents).set("alice" as never, {
        ...alice,
        taskTracks: {
          HEAD: { kind: "operation", callId: collisionCallId },
          BODY: alice.taskTracks.BODY,
        },
        activeOperations: new Map([
          ...alice.activeOperations,
          [collisionCallId, observe.operation as never],
        ]),
      }),
    };
    const thinking = directRequests(collisionWorld, ["alice"]);
    const ready = acceptDirect(
      thinking,
      thinking,
      "alice",
      directWaitDecision(),
      registry,
    );
    const before = ready;

    expect(() => releaseDecisionCycle(ready, registry)).toThrow(
      /Active call|task tracks|Missing prepared operation/i,
    );
    expect(cancel).not.toHaveBeenCalled();
    expect(before).toBe(ready);
    expect(ready.objects.get("fridge-1" as never)?.state).toEqual({
      holder: "alice",
    });
    expect(ready.agents.get("alice" as never)?.activeOperations.size).toBe(2);
    expect(ready.agents.get("alice" as never)?.pendingOperationResults).toEqual([]);
    expect(ready.decisionCycle?.requests.get("alice" as never)?.acceptedProposal).toEqual(
      directWaitDecision(),
    );
  });

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
      const head = legacyOptions(request).find(
        (option) => option.kind === "empty" && option.taskSlots[0] === "HEAD",
      )!;
      const body = legacyOptions(request).find(
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
    const emptyHead = legacyOptions(aliceRequest).find(
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
    const emptyHead = legacyOptions(aliceRequest).find(
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
    const cancelledCallId = running.agents
      .get("alice" as never)!
      .taskTracks.BODY;
    if (cancelledCallId.kind !== "operation") {
      throw new Error("Expected the fridge use call on BODY");
    }
    const thinking = requestDecisions(running, [
      {
        agentId: "alice" as never,
        reason: { code: "change_task", summary: "Stop using the fridge" },
        taskOptions: legacyTaskOptionsFor(
          running,
          testPluginRegistry,
          "alice" as never,
        ),
      },
    ]).world;
    const request = thinking.decisionCycle!.requests.get("alice" as never)!;
    const emptyBody = legacyOptions(request).find(
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
    expect(
      released.world.agents.get("alice" as never)?.pendingOperationResults,
    ).toEqual([
      expect.objectContaining({
        callId: cancelledCallId.callId,
        terminal: true,
        outcome: "cancelled",
        reasonCode: "task_replaced",
        result: { status: "cancelled" },
      }),
    ]);
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
        result: { status: "cancelled" },
      }),
    ]);
  });

  it("cancels a hosted call through its runtime during replacement", () => {
    const getHostedOperation = vi.fn(testPluginRegistry.getHostedOperation);
    const registry = {
      ...testPluginRegistry,
      getHostedOperation,
    };
    const running = worldWithStartedHostedFridgeUse(registry);
    const active = running.agents.get("alice" as never)!;
    const call = [...active.activeOperations.values()][0]!;
    const promptWorld = {
      ...running,
      agents: new Map(running.agents).set("alice" as never, {
        ...active,
        taskTracks: {
          HEAD: { kind: "empty" },
          BODY: { kind: "empty" },
        },
        activeOperations: new Map(),
      }),
    };
    const thinkingWithoutCall = requestDecisions(promptWorld, [
      {
        agentId: "alice" as never,
        reason: { code: "change_task", summary: "Stop hosted use" },
        taskOptions: legacyTaskOptionsFor(promptWorld, registry, "alice" as never),
      },
    ]).world;
    const thinking = {
      ...thinkingWithoutCall,
      agents: new Map(thinkingWithoutCall.agents).set("alice" as never, {
        ...thinkingWithoutCall.agents.get("alice" as never)!,
        taskTracks: active.taskTracks,
        activeOperations: active.activeOperations,
      }),
    };
    const request = thinking.decisionCycle!.requests.get("alice" as never)!;
    const emptyBody = legacyOptions(request).find(
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
      reason: "Stop hosted use",
    });

    const released = releaseDecisionCycle(ready, registry);
    const alice = released.world.agents.get("alice" as never)!;
    expect(getHostedOperation).toHaveBeenCalled();
    expect(alice.activeOperations.has(call.callId)).toBe(false);
    expect(alice.pendingOperationResults).toContainEqual(
      expect.objectContaining({
        callId: call.callId,
        terminal: true,
        outcome: "cancelled",
        reasonCode: "task_replaced",
        result: { status: "cancelled" },
      }),
    );
    expect(released.world.objects.get("fridge-1" as never)).toMatchObject({
      version: 2,
      state: { holder: null },
    });
  });
});
