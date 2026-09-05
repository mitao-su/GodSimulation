import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import {
  AgentIdSchema,
  EntityIdSchema,
  OperationCallIdSchema,
  OperationHostDefinitionReferenceSchema,
  OperationIdSchema,
  OperationManualSchema,
  type JsonObject,
} from "@god-sim/protocol";
import {
  type OperationStartResult,
  type OperationTerminalProposal,
  type OperationTickResult,
} from "@god-sim/plugin-sdk";

import {
  advanceHostedOperation,
  advanceHostedOperationBatch,
  resumeHostedOperationTermination,
} from "./action-runner";
import {
  cancelOperationLifecycle,
  completeOperationLifecycle,
  failOperationLifecycle,
  fuseOperationLifecycle,
  startOperationLifecycle,
  tickOperationLifecycle,
} from "./operation-lifecycle-runner";
import type {
  HostedOperationRuntime,
  HostedOperationRuntimeRegistry,
  OperationRuntimeCall,
  OperationRuntimeContext,
} from "./operation-runtime";
import {
  simulationTestWorld,
  testPluginRegistry,
} from "../testing/simulation-test-fixtures";
import type { WorldState } from "../world/world-state";

const agentId = AgentIdSchema.parse("alice");
const operationId = OperationIdSchema.parse("furniture.test.fridge.lifecycle");
const callId = OperationCallIdSchema.parse("operation-call:test:lifecycle");
const fridgeId = EntityIdSchema.parse("fridge-1");
const hostDefinition = OperationHostDefinitionReferenceSchema.parse({
  kind: "furniture",
  hostDefinitionId: "test.fridge",
});
const operationStateSchema = z.object({ ticks: z.number().int().nonnegative() }).strict();
const operationResultSchema = z.union([
  z
    .object({
      status: z.enum(["completed", "cancelled", "running"]),
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      reason: z.string(),
    })
    .strict(),
]);

interface FixtureOverrides {
  readonly duration?: HostedOperationRuntime["duration"];
  readonly start?: HostedOperationRuntime["start"];
  readonly tick?: HostedOperationRuntime["tick"];
  readonly complete?: HostedOperationRuntime["complete"];
  readonly fail?: HostedOperationRuntime["fail"];
  readonly cancel?: HostedOperationRuntime["cancel"];
  readonly fuse?: HostedOperationRuntime["fuse"];
  readonly stateSchema?: HostedOperationRuntime["stateSchema"];
  readonly resultSchema?: HostedOperationRuntime["resultSchema"];
}

function fixtureRuntime(overrides: FixtureOverrides = {}) {
  const start = vi.fn(
    (_context: OperationRuntimeContext, operation: OperationRuntimeCall): OperationStartResult => ({
      kind: "started",
      proposal: { effects: [] },
      nextState: operation.state,
    }),
  );
  const tick = vi.fn(
    (_context: OperationRuntimeContext, operation: OperationRuntimeCall): OperationTickResult => ({
      kind: "running",
      proposal: { effects: [] },
      nextState: {
        ticks: z.number().int().parse(operation.state["ticks"]) + 1,
      },
    }),
  );
  const complete = vi.fn(
    (): OperationTerminalProposal => ({
      effects: [],
      result: { status: "completed" },
    }),
  );
  const fail = vi.fn(
    (): OperationTerminalProposal => ({
      effects: [],
      result: { status: "failed", reason: "Fridge occupied" },
    }),
  );
  const cancel = vi.fn(
    (): OperationTerminalProposal => ({
      effects: [],
      result: { status: "cancelled" },
    }),
  );
  const fuse = vi.fn((): JsonObject => ({ status: "running" }));
  const resolveDuration = vi.fn(() => ({ kind: "fixed" as const, totalTicks: 2 }));
  const runtime: HostedOperationRuntime = {
    id: operationId,
    displayName: "Lifecycle fixture",
    trigger: "active_command",
    ownerPluginId: "test.simulation",
    host: hostDefinition,
    manual: OperationManualSchema.parse({
      operationId,
      displayName: "Lifecycle fixture",
      summary: "Exercise the common operation lifecycle.",
      taskSlots: ["BODY"],
      parametersSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      target: { kind: "none" },
      duration: overrides.duration ?? { kind: "fixed" },
      worldPreconditions: [
        {
          failureCode: "occupied",
          description: "The fixture host must be available.",
        },
      ],
    }),
    target: { kind: "none" },
    duration: overrides.duration ?? { kind: "fixed" },
    taskSlots: ["BODY"],
    eventIgnore: [],
    publicBehavior: { kind: "visible", label: "testing lifecycle" },
    domainFailures: [
      {
        code: "occupied",
        summary: "The fixture host is occupied.",
        detailsSchema: z.object({ holderId: AgentIdSchema }).strict(),
        resultSchema: z
          .object({ status: z.literal("failed"), reason: z.string() })
          .strict(),
      },
    ],
    resultSchema: overrides.resultSchema ?? operationResultSchema,
    stateSchema: overrides.stateSchema ?? operationStateSchema,
    parametersSchema: z.object({}).strict(),
    initialState: () => ({ ticks: 0 }),
    resolveDuration,
    start: overrides.start ?? start,
    ...(overrides.tick === undefined && "tick" in overrides
      ? {}
      : { tick: overrides.tick ?? tick }),
    complete: overrides.complete ?? complete,
    fail: overrides.fail ?? fail,
    cancel: overrides.cancel ?? cancel,
    fuse: overrides.fuse ?? fuse,
    acknowledgeFuseResult: (_context, operation) => operation.state,
  };
  const registry: HostedOperationRuntimeRegistry = {
    ...testPluginRegistry,
    resolveOperationReference: () => ({
      kind: "invalid_reference",
      code: "operation_not_mounted",
      message: "Fixture references are created directly.",
    }),
    getHostedOperation: (candidateId, candidateHost) =>
      candidateId === runtime.id &&
      candidateHost.kind === runtime.host.kind &&
      candidateHost.hostDefinitionId === runtime.host.hostDefinitionId
        ? runtime
        : undefined,
  };
  return {
    runtime,
    registry,
    calls: {
      start: runtime.start,
      tick: runtime.tick,
      complete: runtime.complete,
      fail: runtime.fail,
      cancel: runtime.cancel,
      fuse: runtime.fuse,
      resolveDuration,
    },
  };
}

function runtimeCall(
  overrides: Partial<OperationRuntimeCall> = {},
): OperationRuntimeCall {
  return {
    callId,
    operationId,
    host: { kind: "furniture", hostEntityId: fridgeId },
    hostDefinition,
    target: { kind: "none" },
    taskSlots: ["BODY"],
    arguments: {},
    duration: { kind: "fixed", totalTicks: 2 },
    startedAtTick: 0,
    progressTicks: 0,
    firstStepState: "pending",
    state: { ticks: 0 },
    ...overrides,
  };
}

function runningWorld(): WorldState {
  return { ...simulationTestWorld(), mode: "RUNNING" };
}

describe("hosted operation lifecycle runner", () => {
  it("runs start once, then tick and complete at the locked fixed duration", () => {
    const fixture = fixtureRuntime();
    const world = runningWorld();

    const first = advanceHostedOperation(
      world,
      fixture.registry,
      agentId,
      runtimeCall(),
    );
    expect(first).toMatchObject({
      kind: "running",
      operation: { firstStepState: "started", progressTicks: 1 },
    });
    if (first.kind !== "running") throw new Error("Fixture did not start");

    const second = advanceHostedOperation(
      first.world,
      fixture.registry,
      agentId,
      first.operation,
    );
    expect(second).toMatchObject({
      kind: "termination_ready",
      operation: { progressTicks: 2, state: { ticks: 1 } },
      transaction: {
        outcome: "completed",
        source: "duration_elapsed",
        terminatedAtTick: world.tick,
        proposal: { result: { status: "completed" } },
      },
    });
    expect(fixture.calls.start).toHaveBeenCalledTimes(1);
    expect(fixture.calls.tick).toHaveBeenCalledTimes(1);
    expect(fixture.calls.complete).toHaveBeenCalledTimes(1);
    expect(fixture.calls.resolveDuration).not.toHaveBeenCalled();
  });

  it("does not run start twice when an already-started call is at its completion boundary", () => {
    const fixture = fixtureRuntime();
    const result = advanceHostedOperation(
      runningWorld(),
      fixture.registry,
      agentId,
      runtimeCall({
        firstStepState: "started",
        progressTicks: 2,
        duration: { kind: "fixed", totalTicks: 2 },
      }),
    );

    expect(result).toMatchObject({
      kind: "termination_ready",
      transaction: { outcome: "completed", source: "duration_elapsed" },
    });
    expect(fixture.calls.start).not.toHaveBeenCalled();
    expect(fixture.calls.tick).not.toHaveBeenCalled();
    expect(fixture.calls.complete).toHaveBeenCalledTimes(1);
  });

  it("supports an omitted tick lifecycle without inventing another execution path", () => {
    const fixture = fixtureRuntime({ tick: undefined });
    const first = advanceHostedOperation(
      runningWorld(),
      fixture.registry,
      agentId,
      runtimeCall(),
    );
    if (first.kind !== "running") throw new Error("Fixture did not start");
    const second = advanceHostedOperation(
      first.world,
      fixture.registry,
      agentId,
      first.operation,
    );

    expect(second.kind).toBe("termination_ready");
    expect(fixture.calls.tick).toBeUndefined();
    expect(fixture.calls.complete).toHaveBeenCalledTimes(1);
  });

  it("lets an indeterminate operation complete only from its explicit tick signal", () => {
    const tick = vi.fn(
      (_context: OperationRuntimeContext, operation: OperationRuntimeCall): OperationTickResult => ({
        kind: "complete",
        nextState: { ticks: z.number().parse(operation.state["ticks"]) + 1 },
      }),
    );
    const fixture = fixtureRuntime({
      duration: { kind: "indeterminate" },
      tick,
    });
    const first = advanceHostedOperation(
      runningWorld(),
      fixture.registry,
      agentId,
      runtimeCall({ duration: { kind: "indeterminate" } }),
    );
    if (first.kind !== "running") throw new Error("Fixture did not start");
    const second = advanceHostedOperation(
      first.world,
      fixture.registry,
      agentId,
      first.operation,
    );

    expect(second).toMatchObject({
      kind: "termination_ready",
      transaction: {
        outcome: "completed",
        source: "operation_signalled_completion",
      },
    });
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("rejects a repeated direct start without invoking the runtime again", () => {
    const fixture = fixtureRuntime();
    const input = {
      world: runningWorld(),
      registry: fixture.registry,
      agentId,
      operation: runtimeCall({ firstStepState: "started" }),
    };

    const result = startOperationLifecycle(input);

    expect(result).toMatchObject({
      kind: "technical_failure",
      failure: { code: "operation_start_repeated" },
    });
    expect(fixture.calls.start).not.toHaveBeenCalled();
  });

  it("rejects a pending call that already has progress", () => {
    const fixture = fixtureRuntime();
    const result = advanceHostedOperation(
      runningWorld(),
      fixture.registry,
      agentId,
      runtimeCall({ progressTicks: 1 }),
    );

    expect(result).toMatchObject({
      kind: "technical_failure",
      failure: { code: "operation_pending_with_progress" },
    });
    expect(fixture.calls.start).not.toHaveBeenCalled();
  });

  it.each([0, -1])(
    "rejects a fixed call with non-positive locked duration (%s)",
    (totalTicks) => {
      const fixture = fixtureRuntime();
      const result = advanceHostedOperation(
        runningWorld(),
        fixture.registry,
        agentId,
        runtimeCall({ duration: { kind: "fixed", totalTicks } }),
      );

      expect(result).toMatchObject({
        kind: "technical_failure",
        failure: { code: "operation_duration_invalid" },
        events: [],
      });
      expect(fixture.calls.start).not.toHaveBeenCalled();
    },
  );

  it("rejects progress overflow before invoking lifecycle code or effects", () => {
    const tick = vi.fn(
      (): OperationTickResult => ({
        kind: "running",
        proposal: {
          effects: [
            {
              type: "reserve_occupancy",
              entityId: fridgeId,
              agentId,
              expectedObjectVersion: 0,
            },
          ],
        },
        nextState: { ticks: 1 },
      }),
    );
    const fixture = fixtureRuntime({
      duration: { kind: "indeterminate" },
      tick,
    });
    const world = runningWorld();

    const result = advanceHostedOperation(
      world,
      fixture.registry,
      agentId,
      runtimeCall({
        duration: { kind: "indeterminate" },
        firstStepState: "started",
        progressTicks: Number.MAX_SAFE_INTEGER,
      }),
    );

    expect(result).toMatchObject({
      kind: "technical_failure",
      failure: { code: "operation_progress_overflow" },
      events: [],
    });
    expect(result.world).toBe(world);
    expect(result.world.objects.get(fridgeId)).toEqual(
      world.objects.get(fridgeId),
    );
    expect(tick).not.toHaveBeenCalled();
  });

  it("dispatches explicit complete, fail, and cancel through the same runtime", () => {
    const fixture = fixtureRuntime();
    const world = runningWorld();
    const operation = runtimeCall({ firstStepState: "started" });
    const input = { world, registry: fixture.registry, agentId, operation };

    const completed = completeOperationLifecycle(input, "test_completed");
    const failed = failOperationLifecycle(
      input,
      {
        kind: "domain_failure",
        code: "occupied",
        details: { holderId: "bob" },
      },
      "test_failed",
    );
    const cancelled = cancelOperationLifecycle(input, "test_cancelled");

    expect(completed).toMatchObject({
      kind: "termination_ready",
      transaction: { outcome: "completed", source: "test_completed" },
    });
    expect(failed).toMatchObject({
      kind: "termination_ready",
      transaction: {
        outcome: "failed",
        source: "test_failed",
        failure: { code: "occupied", details: { holderId: "bob" } },
      },
    });
    expect(cancelled).toMatchObject({
      kind: "termination_ready",
      transaction: { outcome: "cancelled", source: "test_cancelled" },
    });
    expect(fixture.calls.complete).toHaveBeenCalledTimes(1);
    expect(fixture.calls.fail).toHaveBeenCalledTimes(1);
    expect(fixture.calls.cancel).toHaveBeenCalledTimes(1);
  });

  it("validates a domain failure before invoking fail", () => {
    const fail = vi.fn(
      (): OperationTerminalProposal => ({
        effects: [],
        result: { status: "failed", reason: "Invented" },
      }),
    );
    const start = vi.fn(
      (): OperationStartResult => ({
        kind: "domain_failure",
        code: "invented",
        details: {},
      }),
    );
    const fixture = fixtureRuntime({ start, fail });
    const world = runningWorld();

    const result = advanceHostedOperation(
      world,
      fixture.registry,
      agentId,
      runtimeCall(),
    );

    expect(result).toMatchObject({
      kind: "technical_failure",
      operation: { firstStepState: "pending", progressTicks: 0 },
      failure: { code: "undeclared_domain_failure" },
      events: [],
    });
    expect(fail).not.toHaveBeenCalled();
    expect(result.world).toBe(world);
    expect(result.world.agents.get(agentId)).toEqual(world.agents.get(agentId));
  });

  it("turns an explicitly declared start failure into a failed transaction", () => {
    const start = vi.fn(
      (): OperationStartResult => ({
        kind: "domain_failure",
        code: "occupied",
        details: { holderId: "bob" },
      }),
    );
    const fixture = fixtureRuntime({ start });

    const result = advanceHostedOperation(
      runningWorld(),
      fixture.registry,
      agentId,
      runtimeCall(),
    );

    expect(result).toMatchObject({
      kind: "termination_ready",
      operation: { firstStepState: "pending", progressTicks: 0 },
      transaction: {
        outcome: "failed",
        source: "start_domain_failure",
        failure: {
          code: "occupied",
          details: { holderId: "bob" },
        },
        proposal: {
          result: { status: "failed", reason: "Fridge occupied" },
        },
      },
    });
    expect(fixture.calls.fail).toHaveBeenCalledTimes(1);
  });

  it("leaves a recovered internal blockage inside the owning operation", () => {
    const localRecovery = vi.fn(() => ({ ticks: 1 }));
    const tick = vi.fn(
      (): OperationTickResult => ({
        kind: "running",
        proposal: { effects: [] },
        nextState: localRecovery(),
      }),
    );
    const fail = vi.fn(
      (): OperationTerminalProposal => ({
        effects: [],
        result: { status: "failed", reason: "Should not be visible" },
      }),
    );
    const fixture = fixtureRuntime({
      duration: { kind: "indeterminate" },
      tick,
      fail,
    });

    const result = advanceHostedOperation(
      runningWorld(),
      fixture.registry,
      agentId,
      runtimeCall({
        duration: { kind: "indeterminate" },
        firstStepState: "started",
      }),
    );

    expect(result).toMatchObject({
      kind: "running",
      operation: { progressTicks: 1, state: { ticks: 1 } },
      events: [],
    });
    expect(localRecovery).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
  });

  it("treats invalid failure details and results as technical failures", () => {
    const badDetails = fixtureRuntime({
      start: () => ({
        kind: "domain_failure",
        code: "occupied",
        details: {},
      }),
    });
    const badResultFail = vi.fn(
      (): OperationTerminalProposal => ({
        effects: [],
        result: { status: "failed" },
      }),
    );
    const badResult = fixtureRuntime({
      start: () => ({
        kind: "domain_failure",
        code: "occupied",
        details: { holderId: "bob" },
      }),
      fail: badResultFail,
    });

    expect(
      advanceHostedOperation(
        runningWorld(),
        badDetails.registry,
        agentId,
        runtimeCall(),
      ),
    ).toMatchObject({
      kind: "technical_failure",
      failure: { code: "invalid_domain_failure_details" },
    });
    expect(
      advanceHostedOperation(
        runningWorld(),
        badResult.registry,
        agentId,
        runtimeCall(),
      ),
    ).toMatchObject({
      kind: "technical_failure",
      failure: { code: "invalid_domain_failure_result" },
    });
    expect(badResultFail).toHaveBeenCalledTimes(1);
  });

  it("keeps explicit runtime technical failures recoverable", () => {
    const start = vi.fn(
      (): OperationStartResult => ({
        kind: "technical_failure",
        category: "configuration",
        code: "fixture_not_configured",
        message: "The fixture runtime is not configured.",
        retryable: false,
      }),
    );
    const fixture = fixtureRuntime({ start });
    const world = runningWorld();
    const operation = runtimeCall();

    const result = advanceHostedOperation(
      world,
      fixture.registry,
      agentId,
      operation,
    );

    expect(result).toMatchObject({
      kind: "technical_failure",
      operation: { firstStepState: "pending", progressTicks: 0 },
      failure: { category: "configuration", code: "fixture_not_configured" },
      events: [],
    });
    expect(result.world).toBe(world);
  });

  it("does not infer a domain failure from exception text", () => {
    const fail = vi.fn(
      (): OperationTerminalProposal => ({ effects: [], result: {} }),
    );
    const fixture = fixtureRuntime({
      start: () => {
        throw new Error("occupied: material missing and target unavailable");
      },
      fail,
    });

    const result = advanceHostedOperation(
      runningWorld(),
      fixture.registry,
      agentId,
      runtimeCall(),
    );

    expect(result).toMatchObject({
      kind: "technical_failure",
      failure: { code: "start_lifecycle_exception", category: "plugin" },
    });
    expect(fail).not.toHaveBeenCalled();
  });

  it("rejects malformed lifecycle output and an invalid completed result", () => {
    const malformedStart = fixtureRuntime({
      start: () =>
        ({
          kind: "started",
          proposal: { effects: [{ type: "unknown_effect" }] },
          nextState: { ticks: 0 },
        }) as unknown as OperationStartResult,
    });
    const invalidComplete = fixtureRuntime({
      complete: () => ({ effects: [], result: { status: "invalid" } }),
    });
    const world = runningWorld();

    expect(
      advanceHostedOperation(
        world,
        malformedStart.registry,
        agentId,
        runtimeCall(),
      ),
    ).toMatchObject({
      kind: "technical_failure",
      failure: { code: "start_lifecycle_invalid_result" },
    });
    expect(
      completeOperationLifecycle(
        {
          world,
          registry: invalidComplete.registry,
          agentId,
          operation: runtimeCall({ firstStepState: "started" }),
        },
        "test_completed",
      ),
    ).toMatchObject({
      kind: "technical_failure",
      failure: { code: "complete_result_schema_mismatch" },
    });
  });

  it("defers start effects to batch commit and leaves terminal effects for the P2 transaction", () => {
    const start = vi.fn(
      (_context: OperationRuntimeContext, operation: OperationRuntimeCall): OperationStartResult => ({
        kind: "started",
        proposal: {
          effects: [
            {
              type: "reserve_occupancy",
              entityId: fridgeId,
              agentId,
              expectedObjectVersion: 0,
            },
          ],
        },
        nextState: operation.state,
      }),
    );
    const complete = vi.fn(
      (): OperationTerminalProposal => ({
        effects: [
          {
            type: "set_agent_need",
            agentId,
            need: "bladder",
            value: 0,
          },
        ],
        result: { status: "completed" },
      }),
    );
    const fixture = fixtureRuntime({ start, complete });
    const world = runningWorld();
    const beforeBladder = world.agents.get(agentId)?.bladder;

    const evaluated = advanceHostedOperation(
      world,
      fixture.registry,
      agentId,
      runtimeCall({ duration: { kind: "fixed", totalTicks: 1 } }),
    );
    expect(evaluated.kind).toBe("termination_ready");
    expect(evaluated.world).toBe(world);
    expect(evaluated.world.objects.get(fridgeId)).toEqual(world.objects.get(fridgeId));

    const result = advanceHostedOperationBatch(world, fixture.registry, [
      {
        agentId,
        operation: runtimeCall({ duration: { kind: "fixed", totalTicks: 1 } }),
      },
    ]).results[0]!.result;

    expect(result).toMatchObject({
      kind: "termination_ready",
      world: {
        objects: expect.any(Map),
      },
      transaction: {
        proposal: {
          effects: [expect.objectContaining({ type: "set_agent_need", value: 0 })],
        },
      },
    });
    expect(result.world.objects.get(fridgeId)).toMatchObject({
      version: 1,
      state: { holder: agentId },
    });
    expect(result.world.agents.get(agentId)?.bladder).toBe(beforeBladder);
  });

  it("keeps the call recoverable when lifecycle state or effects are invalid", () => {
    const invalidState = fixtureRuntime({
      start: () => ({
        kind: "started",
        proposal: { effects: [] },
        nextState: { ticks: "invalid" },
      }),
    });
    const invalidEffect = fixtureRuntime({
      start: (_context, operation) => ({
        kind: "started",
        proposal: {
          effects: [
            {
              type: "reserve_occupancy",
              entityId: EntityIdSchema.parse("missing-fixture-host"),
              agentId,
              expectedObjectVersion: 0,
            },
          ],
        },
        nextState: operation.state,
      }),
    });
    const world = runningWorld();
    const operation = runtimeCall();

    const badStateResult = advanceHostedOperation(
      world,
      invalidState.registry,
      agentId,
      operation,
    );
    const badEffectResult = advanceHostedOperationBatch(
      world,
      invalidEffect.registry,
      [{ agentId, operation }],
    ).results[0]!.result;

    expect(badStateResult).toMatchObject({
      kind: "technical_failure",
      operation: { firstStepState: "pending", progressTicks: 0 },
      failure: { code: "invalid_operation_state" },
    });
    expect(badEffectResult).toMatchObject({
      kind: "technical_failure",
      operation: { firstStepState: "pending", progressTicks: 0 },
      failure: { code: "operation_lifecycle_effect_rejected" },
      events: [],
    });
    expect(badEffectResult.world).toBe(world);
  });

  it("reports a missing locked runtime as a technical definition failure", () => {
    const fixture = fixtureRuntime();
    const result = advanceHostedOperation(
      runningWorld(),
      fixture.registry,
      agentId,
      runtimeCall({
        operationId: OperationIdSchema.parse("furniture.test.fridge.missing"),
      }),
    );

    expect(result).toMatchObject({
      kind: "technical_failure",
      failure: {
        category: "configuration",
        code: "operation_runtime_unavailable",
      },
    });
  });

  it("runs fuse only against isolated frozen state and never advances the call", () => {
    const fuse = vi.fn(
      (context: OperationRuntimeContext, operation: OperationRuntimeCall): JsonObject => {
        Reflect.set(context.world, "tick", 999);
        Reflect.set(operation.state, "ticks", 999);
        return { status: "running" };
      },
    );
    const fixture = fixtureRuntime({ fuse });
    const operation = runtimeCall({
      firstStepState: "started",
      progressTicks: 1,
      state: { ticks: 1 },
    });
    const frozenWorld = { ...simulationTestWorld(), mode: "THINKING" as const };

    const result = fuseOperationLifecycle({
      world: frozenWorld,
      registry: fixture.registry,
      agentId,
      operation,
    });

    expect(result).toMatchObject({ kind: "result", result: { status: "running" } });
    expect(frozenWorld.tick).toBe(0);
    expect(operation).toMatchObject({ progressTicks: 1, state: { ticks: 1 } });
    expect(fuse).toHaveBeenCalledTimes(1);

    const running = fuseOperationLifecycle({
      world: runningWorld(),
      registry: fixture.registry,
      agentId,
      operation,
    });
    expect(running).toMatchObject({
      kind: "technical_failure",
      failure: { code: "operation_fuse_requires_frozen_world" },
    });
    expect(fuse).toHaveBeenCalledTimes(1);
  });

  it("validates fuse output against the operation result schema", () => {
    const fixture = fixtureRuntime({ fuse: () => ({ status: "invalid" }) });

    const result = fuseOperationLifecycle({
      world: { ...simulationTestWorld(), mode: "THINKING" },
      registry: fixture.registry,
      agentId,
      operation: runtimeCall({ firstStepState: "started" }),
    });

    expect(result).toMatchObject({
      kind: "technical_failure",
      failure: { code: "fuse_result_schema_mismatch" },
    });
  });

  it("never advances a hosted operation while the world is frozen", () => {
    const fixture = fixtureRuntime();
    const world = { ...simulationTestWorld(), mode: "READY_FOR_RELEASE" as const };
    const operation = runtimeCall();

    const result = advanceHostedOperation(
      world,
      fixture.registry,
      agentId,
      operation,
    );

    expect(result).toEqual({
      kind: "not_advanced",
      world,
      operation,
      events: [],
    });
    expect(fixture.calls.start).not.toHaveBeenCalled();
    expect(fixture.calls.tick).not.toHaveBeenCalled();
  });

  it("calls tick directly only after the first step is marked started", () => {
    const fixture = fixtureRuntime();
    const beforeStart = tickOperationLifecycle({
      world: runningWorld(),
      registry: fixture.registry,
      agentId,
      operation: runtimeCall(),
    });

    expect(beforeStart).toMatchObject({
      kind: "technical_failure",
      failure: { code: "operation_tick_before_start" },
    });
    expect(fixture.calls.tick).not.toHaveBeenCalled();
  });

  it("arbitrates same-tick hosted start proposals independently of input order", () => {
    const fixture = fixtureRuntime({
      start: vi.fn(
        (context: OperationRuntimeContext, operation: OperationRuntimeCall): OperationStartResult => ({
          kind: "started",
          proposal: {
            effects: [
              {
                type: "reserve_occupancy",
                entityId: fridgeId,
                agentId: context.agentId,
                expectedObjectVersion: 0,
              },
            ],
          },
          nextState: operation.state,
        }),
      ),
    });
    const world = runningWorld();
    const aliceCall = runtimeCall({ callId: OperationCallIdSchema.parse("operation-call:alice") });
    const bobCall = runtimeCall({ callId: OperationCallIdSchema.parse("operation-call:bob") });
    const aliceEntry = { agentId, operation: aliceCall };
    const bobEntry = { agentId: AgentIdSchema.parse("bob"), operation: bobCall };

    const forward = advanceHostedOperationBatch(world, fixture.registry, [aliceEntry, bobEntry]);
    const reverse = advanceHostedOperationBatch(world, fixture.registry, [bobEntry, aliceEntry]);

    expect(forward.world.objects.get(fridgeId)).toEqual(reverse.world.objects.get(fridgeId));
    expect(forward.world.randomState).toBe(reverse.world.randomState);
    expect(forward.results.filter(({ result }) => result.kind === "running")).toHaveLength(1);
    expect(forward.results.filter(({ result }) => result.kind === "technical_failure")).toHaveLength(1);
  });

  it("keeps a completed tick pending when complete fails, then retries only complete", () => {
    const complete = vi
      .fn<HostedOperationRuntime["complete"]>()
      .mockImplementationOnce(() => {
        throw new Error("temporary completion failure");
      })
      .mockImplementation(() => ({ effects: [], result: { status: "completed" } }));
    const tick = vi.fn(
      (_context: OperationRuntimeContext, operation: OperationRuntimeCall): OperationTickResult => ({
        kind: "complete",
        nextState: { ticks: z.number().parse(operation.state["ticks"]) + 1 },
      }),
    );
    const fixture = fixtureRuntime({ duration: { kind: "indeterminate" }, tick, complete });
    const world = runningWorld();
    const started = advanceHostedOperation(
      world,
      fixture.registry,
      agentId,
      runtimeCall({ duration: { kind: "indeterminate" } }),
    );
    if (started.kind !== "running") throw new Error("Fixture did not start");

    const pending = advanceHostedOperation(world, fixture.registry, agentId, started.operation);
    expect(pending).toMatchObject({
      kind: "termination_pending",
      pending: { source: "operation_signalled_completion", operation: { progressTicks: 2, state: { ticks: 1 } } },
    });
    if (pending.kind !== "termination_pending") throw new Error("Completion was not pending");

    const resumed = resumeHostedOperationTermination(world, fixture.registry, agentId, pending.pending);
    expect(resumed).toMatchObject({ kind: "termination_ready", operation: { progressTicks: 2, state: { ticks: 1 } } });
    expect(tick).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
