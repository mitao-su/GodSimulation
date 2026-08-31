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
  it("resumes model requests from a normally stopped thinking snapshot", () => {
    const plugins = [spatialPlugin, homePlugin, agentsPlugin];
    const engine = createSimulation({
      worldDefinition: starterHome,
      plugins,
      reviewRequired: true,
      seed: 1,
      pluginLockHash: pluginLock.hash,
    });
    const emitted: WorkerToHostMessage[] = [];
    const session = new WorldSession({
      worldDefinition: starterHome,
      plugins,
      pluginLock,
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
