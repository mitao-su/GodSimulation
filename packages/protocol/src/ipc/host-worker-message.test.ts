import { describe, expect, it } from "vitest";

import { HostToWorkerMessageSchema, WorkerToHostMessageSchema } from "./host-worker-message";

describe("host-worker messages", () => {
  it("accepts a versioned snapshot when initializing a restored world", () => {
    const message = HostToWorkerMessageSchema.parse({
      type: "initialize",
      protocolVersion: 1,
      worldDefinition: {},
      pluginLock: {
        hash: "a".repeat(64),
        entries: [
          {
            pluginId: "test.plugin",
            version: "0.1.0",
            stateVersion: 1,
            buildHash: "b".repeat(64),
          },
        ],
      },
      reviewRequired: true,
      deterministicSeed: 1,
      restoredSnapshot: {
        schemaVersion: 1,
        worldId: "test-world",
        worldVersion: 12,
        worldTick: 8,
        lastEventSequence: 4,
        pluginLockHash: "a".repeat(64),
        state: {},
      },
    });

    expect(message.type).toBe("initialize");
    if (message.type === "initialize") {
      expect(message.restoredSnapshot?.worldVersion).toBe(12);
    }
  });

  it("rejects a decision result without request identity", () => {
    expect(
      HostToWorkerMessageSchema.safeParse({
        type: "decision_result",
        result: { requestId: "request-1" },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown worker message types", () => {
    expect(
      WorkerToHostMessageSchema.safeParse({
        type: "world_mutated_directly",
        state: {},
      }).success,
    ).toBe(false);
  });

  it("accepts a redacted technical failure", () => {
    const message = WorkerToHostMessageSchema.parse({
      type: "technical_failure",
      failure: {
        id: "failure-1",
        category: "model",
        message: "Provider returned invalid JSON",
        requestId: "request-1",
        retryable: true,
        occurredAtRealTime: "2026-08-31T00:00:00.000Z",
      },
    });

    expect(message.type).toBe("technical_failure");
  });

  it("accepts a host-reported decision failure for the authoritative worker", () => {
    const message = HostToWorkerMessageSchema.parse({
      type: "decision_failure",
      failure: {
        id: "failure-1",
        category: "model",
        message: "Provider unavailable",
        requestId: "request-1",
        retryable: true,
        occurredAtRealTime: "2026-08-31T00:00:00.000Z",
      },
    });

    expect(message.type).toBe("decision_failure");
  });

  it("accepts a host technical failure that must block the authoritative world", () => {
    const result = HostToWorkerMessageSchema.safeParse({
      type: "technical_failure",
      failure: {
        id: "failure:persistence:1",
        category: "persistence",
        message: "Unable to save the event batch",
        retryable: false,
        occurredAtRealTime: "2026-08-31T00:00:00.000Z",
      },
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("technical_failure");
  });

  it("carries events and their strict snapshot in one checkpoint message", () => {
    const message = WorkerToHostMessageSchema.parse({
      type: "checkpoint_ready",
      checkpointId: "checkpoint:starter-world:8:17",
      events: [
        {
          schemaVersion: 1,
          eventId: "event:starter-world:17",
          type: "decision_requested",
          worldId: "starter-world",
          worldVersion: 8,
          worldTick: 42,
          sequence: 17,
          parentSequence: 16,
          causationId: "request:alice:2",
          correlationId: "cycle:2",
          agentId: "alice",
          requestId: "request:alice:2",
          decisionCycleId: "cycle:2",
          reasonCode: "goal_completed",
        },
      ],
      snapshot: {
        schemaVersion: 2,
        worldId: "starter-world",
        worldVersion: 8,
        worldTick: 42,
        lastEventSequence: 17,
        pluginLockHash: "b".repeat(64),
        history: { mode: "strict", causalFromSequence: 1 },
        causalEventIds: ["event:starter-world:17"],
        state: {},
      },
    });

    expect(message).toMatchObject({
      type: "checkpoint_ready",
      checkpointId: "checkpoint:starter-world:8:17",
    });
  });

  it("acknowledges only a named checkpoint", () => {
    const message = HostToWorkerMessageSchema.parse({
      type: "checkpoint_committed",
      checkpointId: "checkpoint:starter-world:8:17",
    });

    expect(message.type).toBe("checkpoint_committed");
    expect(
      HostToWorkerMessageSchema.safeParse({ type: "checkpoint_committed" }).success,
    ).toBe(false);
  });
});
