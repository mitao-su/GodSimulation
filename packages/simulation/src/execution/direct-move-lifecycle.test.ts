import { describe, expect, it, vi } from "vitest";

import {
  AgentIdSchema,
  EntityIdSchema,
  OperationCallIdSchema,
  OperationIdSchema,
  type DomainEvent,
} from "@god-sim/protocol";

import { prepareDirectOperationCall } from "./operation-planner";
import { isOperationRuntimeCall, type HostedOperationRuntime } from "./operation-runtime";
import { recordFuseResults } from "./operation-lifecycle";
import { cancelOperationLifecycle } from "./operation-lifecycle-runner";
import { commitHostedOperationTerminations } from "./operation-termination";
import { createOperationRegistry } from "./operation-registry";
import { createPluginRegistry } from "../world/plugin-registry";
import { OperationTechnicalFailureError } from "./operation-failure-classifier";
import { advanceHostedOperationBatch, applyHostedOperationBatchResult, retryPendingHostedOperationTerminations } from "./action-runner";
import * as effectCommitter from "../interaction/effect-committer";
import { type ActiveOperation } from "./operation";
import { runTickPipeline } from "../engine/tick-pipeline";
import {
  simulationTestWorld,
  testPlugin,
  testPluginRegistry,
} from "../testing/simulation-test-fixtures";
import { type WorldState } from "../world/world-state";

const agentId = AgentIdSchema.parse("alice");
const fridgeId = EntityIdSchema.parse("fridge-1");
const callId = OperationCallIdSchema.parse("operation-call:direct:move-lifecycle");

function directMoveWorld(): WorldState {
  const world = simulationTestWorld();
  const agent = world.agents.get(agentId)!;
  const prepared = prepareDirectOperationCall(
    world,
    testPluginRegistry,
    agentId,
    "BODY",
    {
      kind: "operation",
      operationId: OperationIdSchema.parse("core.move"),
      arguments: { targetEntityId: fridgeId },
    },
    callId,
  );
  if (prepared.kind !== "prepared") {
    throw new Error(`Expected a direct move call, got ${prepared.kind}`);
  }
  expect(prepared.operation.duration).toEqual({ kind: "indeterminate" });
  expect(prepared.operation.firstStepState).toBe("pending");
  expect(prepared.operation.progressTicks).toBe(0);
  expect(prepared.operation).not.toHaveProperty("plan");

  return {
    ...world,
    mode: "RUNNING",
    agents: new Map([
      [
        agentId,
        {
          ...agent,
          activeOperations: new Map([
            // P3 收口前沿用现有 active-call 存储边界，不创建旧 action plan。
            [callId, prepared.operation as unknown as ActiveOperation],
          ]),
          taskTracks: {
            HEAD: { kind: "empty" },
            BODY: { kind: "operation", callId },
          },
        },
      ],
    ]),
  };
}

function advance(worldInput: WorldState, ticks: number, registry = testPluginRegistry) {
  let world = worldInput;
  const events: DomainEvent[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const result = runTickPipeline(world, registry);
    world = result.world;
    events.push(...result.events);
  }
  return { world, events };
}

describe("direct move lifecycle", () => {
  it("moves to the adjacent interaction cell at the configured movement rate", () => {
    const initial = directMoveWorld();
    const ticksPerCell =
      initial.simulationRulesLock.rules.operations.move.ticksPerCell;

    expect(initial.agents.get(agentId)!.position).toEqual({ x: 3, y: 2 });
    const beforeArrival = advance(initial, ticksPerCell - 1);
    expect(beforeArrival.world.agents.get(agentId)!.position).toEqual({ x: 3, y: 2 });
    const arrived = advance(beforeArrival.world, 1);

    expect(arrived.world.agents.get(agentId)!.position).toEqual({ x: 4, y: 2 });
    expect(arrived.events.filter((event) => event.type === "agent_moved")).toEqual([
      expect.objectContaining({ agentId, callId, from: { x: 3, y: 2 }, to: { x: 4, y: 2 } }),
    ]);
    expect(arrived.world.objects).toEqual(initial.objects);
  });

  it("returns fuse observations without moving while frozen and resumes the same call", () => {
    const started = advance(directMoveWorld(), 1).world;
    const frozen = { ...started, mode: "THINKING" as const };
    const active = frozen.agents.get(agentId)!.activeOperations.get(callId)!;
    const fused = recordFuseResults(frozen, testPluginRegistry, [agentId], {
      causationId: "test:fuse", correlationId: "test:fuse",
    });
    expect(fused.events).toEqual([expect.objectContaining({
      type: "operation_result", callId, terminal: false, outcome: null,
      result: { nearby: expect.arrayContaining([expect.objectContaining({ entityId: fridgeId })]) },
    })]);
    const paused = advance(fused.world, 4);
    expect(paused.events).toEqual([]);
    expect(paused.world.tick).toBe(frozen.tick);
    expect(paused.world.agents.get(agentId)!.position).toEqual({ x: 3, y: 2 });
    expect(paused.world.agents.get(agentId)!.activeOperations.get(callId)).toEqual(active);
    const resumed = advance({ ...paused.world, mode: "RUNNING" }, 1);
    expect(resumed.world.agents.get(agentId)!.position).toEqual({ x: 4, y: 2 });
    expect(resumed.events.filter((event) => event.type === "agent_moved")).toHaveLength(1);
  });

  it("keeps committed movement when completion fails and retries only the terminal transaction", () => {
    const complete = vi.fn<HostedOperationRuntime["complete"]>();
    const registry = {
      ...testPluginRegistry,
      getHostedOperation: (...args: Parameters<typeof testPluginRegistry.getHostedOperation>) => {
        const runtime = testPluginRegistry.getHostedOperation(...args);
        if (!runtime || runtime.id !== "core.move") return runtime;
        return { ...runtime, complete };
      },
    };
    const original = testPluginRegistry.getHostedOperation("core.move", {
      kind: "agent", hostDefinitionId: "test.alice",
    })!;
    complete.mockImplementationOnce(() => { throw new Error("Injected completion failure"); })
      .mockImplementation(original.complete);
    const arrived = advance(directMoveWorld(), 2, registry);
    let committed: NonNullable<OperationTechnicalFailureError["committed"]> | undefined;
    try {
      runTickPipeline(arrived.world, registry);
    } catch (error) {
      if (!(error instanceof OperationTechnicalFailureError)) throw error;
      committed = error.committed;
    }
    expect(committed).toBeDefined();
    if (!committed) throw new Error("Expected a frozen completion failure");
    expect(committed.world.agents.get(agentId)!.position).toEqual({ x: 4, y: 2 });
    expect(committed.world.agents.get(agentId)!.activeOperations.has(callId)).toBe(true);
    expect(committed.events.filter((event) => event.type === "operation_result")).toEqual([]);
    const retried = retryPendingHostedOperationTerminations({ ...committed.world, mode: "TECHNICALLY_BLOCKED" }, registry);
    if (retried.kind !== "committed") throw new Error(retried.failure.message);
    expect(retried.world.agents.get(agentId)!.taskTracks.BODY).toEqual({ kind: "empty" });
    expect(retried.events.filter((event) => event.type === "agent_moved")).toEqual([]);
    expect(retried.events.filter((event) => event.type === "operation_result" && event.terminal)).toHaveLength(1);
    expect(retryPendingHostedOperationTerminations(retried.world, registry)).toMatchObject({ kind: "committed", events: [] });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("does not consume movement progress on a rejected commit and retries one step exactly once", () => {
    const started = advance(directMoveWorld(), 1).world;
    const world = { ...started, tick: started.tick + 1 };
    const operation = world.agents.get(agentId)!.activeOperations.get(callId)!;
    if (!isOperationRuntimeCall(operation)) throw new Error("Expected a hosted call");
    const commit = effectCommitter.commitProposal;
    const injected = vi.spyOn(effectCommitter, "commitProposal")
      .mockImplementationOnce(commit)
      .mockImplementationOnce((input) => ({
        accepted: false, world: input,
        reason: { code: "injected_rejection", message: "Injected commit failure", effectIndex: 0 },
      }));
    const failed = advanceHostedOperationBatch(world, testPluginRegistry, [{ agentId, operation }]);
    injected.mockRestore();
    expect(failed.results[0]!.result.kind).toBe("technical_failure");
    expect(failed.events).toEqual([]);
    const unchanged = applyHostedOperationBatchResult(failed);
    expect(unchanged.agents.get(agentId)!.position).toEqual({ x: 3, y: 2 });
    expect(unchanged.agents.get(agentId)!.activeOperations.get(callId)).toEqual(operation);
    const retry = advanceHostedOperationBatch(unchanged, testPluginRegistry, [{ agentId, operation }]);
    expect(retry.events.filter((event) => event.type === "agent_moved")).toHaveLength(1);
    const applied = applyHostedOperationBatchResult(retry);
    expect(applied.agents.get(agentId)!.position).toEqual({ x: 4, y: 2 });
    const repeated = advanceHostedOperationBatch(applied, testPluginRegistry, [{ agentId, operation }]);
    expect(repeated.events.filter((event) => event.type === "agent_moved")).toEqual([]);
    expect(repeated.world.agents.get(agentId)!.position).toEqual({ x: 4, y: 2 });
  });

  it("cancels a started traversal and releases its occupancy atomically with BODY", () => {
    const plugin = {
      ...testPlugin,
      objects: testPlugin.objects.map((definition) => definition.id === "test.fridge"
        ? { ...definition, traversal: { interactionId: "use" } } : definition),
    };
    const plugins = createPluginRegistry([plugin]);
    const registry = { ...plugins, ...createOperationRegistry(plugins) };
    const initial = directMoveWorld();
    const agent = initial.agents.get(agentId)!;
    const target = initial.objects.get(fridgeId)!;
    const traversalId = EntityIdSchema.parse("traversal");
    const world: WorldState = {
      ...initial,
      agents: new Map(initial.agents).set(agentId, { ...agent, position: { x: 3, y: 1 } }),
      objects: new Map(initial.objects)
        .set(fridgeId, { ...target, position: { x: 5, y: 0 } })
        .set(traversalId, { ...target, id: traversalId, position: { x: 4, y: 1 }, facing: "west" }),
    };
    const started = runTickPipeline(world, registry).world;
    expect(started.objects.get(traversalId)!.state).toEqual({ holder: agentId });
    const operation = started.agents.get(agentId)!.activeOperations.get(callId)!;
    if (!isOperationRuntimeCall(operation)) throw new Error("Expected a hosted move");
    const frozen = { ...started, mode: "THINKING" as const };
    const cancelled = cancelOperationLifecycle({ world: frozen, registry, agentId, operation }, "decision_replaced");
    if (cancelled.kind !== "termination_ready") throw new Error(cancelled.failure.message);
    const result = commitHostedOperationTerminations(frozen, registry, [{ operation, transaction: cancelled.transaction }]);
    if (result.kind !== "committed") throw new Error(result.failure.message);
    expect(result.world.objects.get(traversalId)!.state).toEqual({ holder: null });
    expect(result.world.agents.get(agentId)!.taskTracks.BODY).toEqual({ kind: "empty" });
    expect(result.world.agents.get(agentId)!.activeOperations.has(callId)).toBe(false);
    expect(result.world.agents.get(agentId)!.position).toEqual({ x: 3, y: 1 });
    expect(result.events.filter((event) => event.type === "operation_result"))
      .toEqual([expect.objectContaining({ callId, terminal: true, outcome: "cancelled" })]);
  });

  it("clears the active move, releases BODY and emits exactly one terminal result", () => {
    const initial = directMoveWorld();
    const ticksPerCell =
      initial.simulationRulesLock.rules.operations.move.ticksPerCell;
    const completed = advance(initial, ticksPerCell + 2);
    const agent = completed.world.agents.get(agentId)!;

    expect.soft(agent.position).toEqual({ x: 4, y: 2 });
    expect.soft(agent.activeOperations.has(callId)).toBe(false);
    expect.soft(agent.taskTracks.BODY).toEqual({ kind: "empty" });
    expect.soft(
      completed.events.filter(
        (event) => event.type === "operation_result" && event.callId === callId && event.terminal,
      ),
    ).toEqual([
      expect.objectContaining({
        type: "operation_result",
        callId,
        outcome: "completed",
        terminal: true,
      }),
    ]);

    const later = advance(completed.world, ticksPerCell);
    expect(
      later.events.filter(
        (event) => event.type === "operation_result" && event.callId === callId && event.terminal,
      ),
    ).toEqual([]);
    expect(later.world.objects).toEqual(initial.objects);
  });
});
