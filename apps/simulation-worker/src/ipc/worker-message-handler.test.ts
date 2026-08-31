import { describe, expect, it } from "vitest";

import { JsonValueSchema, type PluginLock, type WorkerToHostMessage } from "@god-sim/protocol";
import homePlugin from "@god-sim/home-objects";
import spatialPlugin from "@god-sim/spatial-objects";
import agentsPlugin from "@god-sim/starter-agents";
import { createSimulation } from "@god-sim/simulation";

import starterHome from "../../../../content/worlds/starter-home/world.json" with { type: "json" };

import { WorkerMessageHandler } from "./worker-message-handler";

const pluginLock: PluginLock = {
  hash: "a".repeat(64),
  entries: [
    {
      pluginId: "test.plugin",
      version: "0.1.0",
      stateVersion: 1,
      buildHash: "b".repeat(64),
    },
  ],
};

describe("WorkerMessageHandler", () => {
  it("defers initialized shutdown until the final checkpoint is acknowledged", () => {
    const messages: WorkerToHostMessage[] = [];
    let stopped = false;
    const handler = new WorkerMessageHandler({
      plugins: [spatialPlugin, homePlugin, agentsPlugin],
      pluginLock,
      emit: (message) => messages.push(message),
      onShutdown: () => {
        stopped = true;
      },
    });
    handler.handle({
      type: "initialize",
      protocolVersion: 1,
      worldDefinition: JsonValueSchema.parse(starterHome),
      pluginLock,
      reviewRequired: true,
      deterministicSeed: 1,
    });
    const checkpoint = messages.find((message) => message.type === "checkpoint_ready")!;

    handler.handle({ type: "shutdown" });

    expect(stopped).toBe(false);
    handler.handle({
      type: "checkpoint_committed",
      checkpointId: checkpoint.checkpointId,
    });
    expect(stopped).toBe(true);
  });

  it("accepts shutdown even when world initialization failed", () => {
    const messages: WorkerToHostMessage[] = [];
    let stopped = false;
    const handler = new WorkerMessageHandler({
      plugins: [],
      pluginLock,
      emit: (message) => messages.push(message),
      onShutdown: () => {
        stopped = true;
      },
    });

    handler.handle({ type: "shutdown" });

    expect(stopped).toBe(true);
    expect(messages).toEqual([]);
  });

  it("blocks the authoritative world after an internal protocol failure", () => {
    const messages: WorkerToHostMessage[] = [];
    const handler = new WorkerMessageHandler({
      plugins: [spatialPlugin, homePlugin, agentsPlugin],
      pluginLock,
      emit: (message) => messages.push(message),
      onShutdown: () => undefined,
      now: () => "2026-08-31T00:00:00.000Z",
    });
    handler.handle({
      type: "initialize",
      protocolVersion: 1,
      worldDefinition: JsonValueSchema.parse(starterHome),
      pluginLock,
      reviewRequired: true,
      deterministicSeed: 1,
    });
    const initialCheckpoint = messages.find(
      (message) => message.type === "checkpoint_ready",
    );
    if (!initialCheckpoint || initialCheckpoint.type !== "checkpoint_ready") {
      throw new Error("Expected initial checkpoint");
    }
    handler.handle({
      type: "checkpoint_committed",
      checkpointId: initialCheckpoint.checkpointId,
    });
    const requests = messages.filter(
      (message): message is Extract<WorkerToHostMessage, { type: "decision_requested" }> =>
        message.type === "decision_requested",
    );
    for (const { request } of requests) {
      const wait = request.goalOptions.find((option) => option.goal.kind === "wait")!;
      handler.handle({
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
            schemaVersion: 1,
            goalOptionId: wait.id,
            reason: "Wait",
          },
        },
      });
    }
    const ready = messages.filter((message) => message.type === "world_view").at(-1)!.view;
    handler.handle({
      type: "world_command",
      command: {
        schemaVersion: 1,
        commandId: "command:release:worker-failure" as never,
        worldId: ready.worldId,
        expectedWorldVersion: ready.worldVersion,
        issuedAtRealTime: "2026-08-31T00:00:00.000Z",
        type: "release_execution",
      },
    });
    const runningCheckpoint = messages.findLast(
      (message) => message.type === "checkpoint_ready",
    );
    if (!runningCheckpoint || runningCheckpoint.type !== "checkpoint_ready") {
      throw new Error("Expected running checkpoint");
    }
    const released = messages.filter((message) => message.type === "world_view").at(-1)!.view;
    expect(released).toMatchObject({ mode: "RUNNING", worldTick: 0 });
    handler.handle({
      type: "checkpoint_committed",
      checkpointId: runningCheckpoint.checkpointId,
    });
    handler.tick();
    const running = messages.filter((message) => message.type === "world_view").at(-1)!.view;
    expect(running.mode).toBe("RUNNING");
    expect(running.worldTick).toBeGreaterThan(0);

    handler.handle({ type: "invalid_host_message" });

    const blocked = messages.filter((message) => message.type === "world_view").at(-1)!.view;
    expect(blocked).toMatchObject({
      mode: "TECHNICALLY_BLOCKED",
      worldTick: running.worldTick,
      technicalFailure: { category: "protocol" },
    });
    handler.tick();
    expect(messages.filter((message) => message.type === "world_view").at(-1)!.view.worldTick)
      .toBe(blocked.worldTick);
  });

  it("does not request model decisions from a restored technical block before retry", () => {
    const engine = createSimulation({
      worldDefinition: starterHome,
      plugins: [spatialPlugin, homePlugin, agentsPlugin],
      reviewRequired: true,
      seed: 1,
      pluginLockHash: pluginLock.hash,
    });
    const failure = {
      id: "failure:persistence:restore",
      category: "persistence" as const,
      message: "disk unavailable",
      retryable: true,
      occurredAtRealTime: "2026-08-31T00:00:00.000Z",
    };
    const blocked = engine.reportTechnicalFailure(failure);
    if (!blocked.accepted) throw new Error(blocked.reason);
    const messages: WorkerToHostMessage[] = [];
    const handler = new WorkerMessageHandler({
      plugins: [spatialPlugin, homePlugin, agentsPlugin],
      pluginLock,
      emit: (message) => messages.push(message),
      onShutdown: () => undefined,
    });

    handler.handle({
      type: "initialize",
      protocolVersion: 1,
      worldDefinition: JsonValueSchema.parse(starterHome),
      pluginLock,
      reviewRequired: true,
      deterministicSeed: 1,
      restoredSnapshot: engine.createSnapshot(),
    });

    expect(messages.filter((message) => message.type === "decision_requested"))
      .toHaveLength(0);
    const blockedView = messages.filter((message) => message.type === "world_view").at(-1)!.view;
    handler.handle({
      type: "world_command",
      command: {
        schemaVersion: 1,
        commandId: "command:retry:restored-block" as never,
        worldId: blockedView.worldId,
        expectedWorldVersion: blockedView.worldVersion,
        issuedAtRealTime: "2026-08-31T00:00:01.000Z",
        type: "retry_technical_failure",
        failureId: failure.id,
      },
    });

    const retryCheckpoint = messages.findLast(
      (message) => message.type === "checkpoint_ready",
    );
    if (!retryCheckpoint || retryCheckpoint.type !== "checkpoint_ready") {
      throw new Error("Expected retry checkpoint");
    }
    handler.handle({
      type: "checkpoint_committed",
      checkpointId: retryCheckpoint.checkpointId,
    });

    expect(messages.filter((message) => message.type === "decision_requested"))
      .toHaveLength(2);
  });
});
