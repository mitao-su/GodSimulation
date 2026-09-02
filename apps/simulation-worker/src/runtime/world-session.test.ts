import { describe, expect, it } from "vitest";

import {
  PluginLockSchema,
  type WorkerToHostMessage,
} from "@god-sim/protocol";
import homePlugin from "@god-sim/home-objects";
import spatialPlugin from "@god-sim/spatial-objects";
import agentsPlugin from "@god-sim/starter-agents";
import { createSimulation } from "@god-sim/simulation";

import starterHome from "../../../../content/worlds/starter-home/world.json" with { type: "json" };
import { testSimulationRulesLock } from "../testing/simulation-rules-test-fixture";
import { WorldSession } from "./world-session";

const pluginLock = PluginLockSchema.parse({
  hash: "a".repeat(64),
  entries: [
    {
      pluginId: "test.plugins",
      version: "1.0.0",
      stateVersion: 1,
      buildHash: "b".repeat(64),
    },
  ],
});

describe("WorldSession restoration", () => {
  it("waits for the initial checkpoint before publishing model requests", () => {
    const emitted: WorkerToHostMessage[] = [];
    const session = new WorldSession({
      worldDefinition: starterHome,
      plugins: [spatialPlugin, homePlugin, agentsPlugin],
      pluginLock,
      simulationRulesLock: testSimulationRulesLock,
      reviewRequired: true,
      deterministicSeed: 1,
      emit: (message) => emitted.push(message),
    });

    session.start();

    const checkpoint = emitted.find((message) => message.type === "checkpoint_ready");
    expect(checkpoint).toBeDefined();
    expect(emitted.filter((message) => message.type === "decision_requested")).toEqual([]);
    session.tick();
    expect(emitted.filter((message) => message.type === "decision_requested")).toEqual([]);

    session.handle({
      type: "checkpoint_committed",
      checkpointId: checkpoint!.checkpointId,
    });

    expect(emitted.filter((message) => message.type === "decision_requested"))
      .toHaveLength(2);
  });

  it("does not advance a released world before its checkpoint is acknowledged", () => {
    const emitted: WorkerToHostMessage[] = [];
    const session = new WorldSession({
      worldDefinition: starterHome,
      plugins: [spatialPlugin, homePlugin, agentsPlugin],
      pluginLock,
      simulationRulesLock: testSimulationRulesLock,
      reviewRequired: true,
      deterministicSeed: 1,
      emit: (message) => emitted.push(message),
    });
    session.start();
    const initial = emitted.find((message) => message.type === "checkpoint_ready")!;
    session.handle({ type: "checkpoint_committed", checkpointId: initial.checkpointId });
    const requests = emitted.filter(
      (message): message is Extract<WorkerToHostMessage, { type: "decision_requested" }> =>
        message.type === "decision_requested",
    );
    for (const { request } of requests) {
      const wait = request.taskOptions.find(
        (option) =>
          option.kind === "operation" && option.operationId === "core.wait",
      )!;
      session.handle({
        type: "decision_result",
        result: {
          requestId: request.requestId,
          agentId: request.agentId,
          worldId: request.worldId,
          worldVersion: request.worldVersion,
          decisionCycleId: request.decisionCycleId,
          schemaVersion: request.schemaVersion,
          pluginLockHash: request.pluginLockHash,
          proposal: {
            schemaVersion: 2,
            head: { kind: "continue" },
            body: {
              kind: "replace",
              taskOptionId: wait.id,
              arguments: { durationTicks: 10 },
            },
            reason: "Wait",
          },
        },
      });
    }
    const ready = emitted.filter((message) => message.type === "world_view").at(-1)!.view;
    session.handle({
      type: "world_command",
      command: {
        schemaVersion: 1,
        commandId: "command:release:checkpoint-test" as never,
        worldId: ready.worldId,
        expectedWorldVersion: ready.worldVersion,
        issuedAtRealTime: "2026-08-31T00:00:00.000Z",
        type: "release_execution",
      },
    });

    const released = emitted.filter((message) => message.type === "checkpoint_ready").at(-1)!;
    expect(released.snapshot.worldTick).toBe(0);
    session.tick();
    expect(emitted.filter((message) => message.type === "world_view").at(-1)!.view.worldTick)
      .toBe(0);

    session.handle({ type: "checkpoint_committed", checkpointId: released.checkpointId });
    session.tick();
    expect(emitted.filter((message) => message.type === "world_view").at(-1)!.view.worldTick)
      .toBe(1);
  });

  it("does not replace a failed pending checkpoint with a technical-state checkpoint", () => {
    const emitted: WorkerToHostMessage[] = [];
    const session = new WorldSession({
      worldDefinition: starterHome,
      plugins: [spatialPlugin, homePlugin, agentsPlugin],
      pluginLock,
      simulationRulesLock: testSimulationRulesLock,
      reviewRequired: true,
      deterministicSeed: 1,
      emit: (message) => emitted.push(message),
    });
    session.start();

    session.block({
      id: "failure:persistence:checkpoint",
      category: "persistence",
      message: "disk unavailable",
      retryable: true,
      occurredAtRealTime: "2026-08-31T00:00:00.000Z",
    });

    expect(emitted.filter((message) => message.type === "checkpoint_ready"))
      .toHaveLength(1);
    expect(emitted.filter((message) => message.type === "world_view").at(-1)!.view)
      .toMatchObject({
        mode: "TECHNICALLY_BLOCKED",
        technicalFailure: { category: "persistence" },
      });
  });

  it("resumes model requests from a normally stopped thinking snapshot", () => {
    const plugins = [spatialPlugin, homePlugin, agentsPlugin];
    const engine = createSimulation({
      worldDefinition: starterHome,
      plugins,
      reviewRequired: true,
      seed: 1,
      pluginLockHash: pluginLock.hash,
      simulationRulesLock: testSimulationRulesLock,
    });
    const emitted: WorkerToHostMessage[] = [];
    const session = new WorldSession({
      worldDefinition: starterHome,
      plugins,
      pluginLock,
      simulationRulesLock: testSimulationRulesLock,
      reviewRequired: true,
      deterministicSeed: 1,
      restoredSnapshot: engine.createSnapshot(),
      emit: (message) => emitted.push(message),
    });

    session.start();

    expect(
      emitted
        .filter(
          (message): message is Extract<WorkerToHostMessage, { type: "decision_requested" }> =>
            message.type === "decision_requested",
        )
        .map((message) => message.request.agentId)
        .sort(),
    ).toEqual(["alice", "bob"]);
  });

  it("waits for explicit retry before resuming unresolved restored requests", () => {
    const plugins = [spatialPlugin, homePlugin, agentsPlugin];
    const engine = createSimulation({
      worldDefinition: starterHome,
      plugins,
      reviewRequired: true,
      seed: 1,
      pluginLockHash: pluginLock.hash,
      simulationRulesLock: testSimulationRulesLock,
    });
    const inputs = engine.getPendingDecisionInputs();
    const alice = inputs.find((input) => input.agentId === "alice")!;
    const bob = inputs.find((input) => input.agentId === "bob")!;
    expect(engine.reportDecisionFailure({
      id: `failure:model:${alice.requestId}`,
      category: "model",
      message: "Alice provider request failed",
      requestId: alice.requestId,
      retryable: true,
      occurredAtRealTime: "2026-08-31T00:00:00.000Z",
    }).accepted).toBe(true);

    const emitted: WorkerToHostMessage[] = [];
    const session = new WorldSession({
      worldDefinition: starterHome,
      plugins,
      pluginLock,
      simulationRulesLock: testSimulationRulesLock,
      reviewRequired: true,
      deterministicSeed: 1,
      restoredSnapshot: engine.createSnapshot(),
      emit: (message) => emitted.push(message),
    });

    session.start();
    expect(emitted.filter((message) => message.type === "decision_requested")).toEqual([]);
    const blockedView = emitted.findLast((message) => message.type === "world_view")!.view;

    session.handle({
      type: "world_command",
      command: {
        schemaVersion: 1,
        commandId: "command:retry:restored" as never,
        worldId: blockedView.worldId,
        expectedWorldVersion: blockedView.worldVersion,
        issuedAtRealTime: "2026-08-31T00:00:01.000Z",
        type: "retry_decision",
        requestId: alice.requestId,
      },
    });

    const checkpoint = emitted.findLast(
      (message) => message.type === "checkpoint_ready",
    );
    if (!checkpoint || checkpoint.type !== "checkpoint_ready") {
      throw new Error("Expected retry checkpoint");
    }
    session.handle({
      type: "checkpoint_committed",
      checkpointId: checkpoint.checkpointId,
    });

    const resumed = emitted.filter(
      (message): message is Extract<WorkerToHostMessage, { type: "decision_requested" }> =>
        message.type === "decision_requested",
    );
    expect(resumed.map((message) => message.request.agentId).sort()).toEqual(["alice", "bob"]);
    expect(resumed.find((message) => message.request.agentId === "alice")?.request)
      .toMatchObject({ retryOfRequestId: alice.requestId });
    expect(resumed.find((message) => message.request.agentId === "bob")?.request)
      .toMatchObject({ requestId: bob.requestId });
  });
});
