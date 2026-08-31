import { describe, expect, it } from "vitest";

import type { ModelDecisionRequest } from "@god-sim/protocol";
import type { TimelineStore } from "@god-sim/timeline";

import { PersistenceWriter } from "../persistence/persistence-writer";
import { DecisionRequestCoordinator } from "./decision-request-coordinator";

const request: ModelDecisionRequest = {
  requestId: "request-alice" as never,
  agentId: "alice" as never,
  worldId: "starter-world" as never,
  worldVersion: 1,
  decisionCycleId: "cycle-1" as never,
  schemaVersion: 1,
  pluginLockHash: "a".repeat(64) as never,
  decisionReason: { code: "initial_goal", summary: "Choose" },
  messages: [{ role: "user", content: "Choose" }],
  goalOptions: [
    {
      id: "alice-wait" as never,
      label: "Wait",
      goal: { kind: "wait", durationTicks: 10 },
    },
  ],
};

describe("DecisionRequestCoordinator", () => {
  it("does not disguise an accepted-result persistence error as a model failure", async () => {
    const attemptedStatuses: string[] = [];
    const store: TimelineStore = {
      async appendEvents() {},
      async saveSnapshot() {},
      async savePluginLock() {},
      async saveModelCall(record) {
        attemptedStatuses.push(record.status);
        throw new Error("disk unavailable");
      },
      async recordFailure() {},
      async loadLatest() {
        return { snapshot: null, events: [] };
      },
      async close() {},
    };
    const coordinator = new DecisionRequestCoordinator({
      provider: {
        async decide() {
          return {
            schemaVersion: 1,
            goalOptionId: "alice-wait" as never,
            reason: "Alice waits",
          };
        },
      },
      persistence: new PersistenceWriter(store),
      modelId: "fixed-test",
      now: () => "2026-08-31T00:00:00.000Z",
      monotonicNow: () => 10,
    });

    await expect(coordinator.decide(request)).rejects.toThrow("disk unavailable");
    expect(attemptedStatuses).toEqual(["accepted"]);
  });

  it("delivers a model result that became durable before shutdown cancellation", async () => {
    let finishPersistence: (() => void) | undefined;
    const persistenceStarted = new Promise<void>((resolveStarted) => {
      finishPersistence = resolveStarted;
    });
    let releasePersistence: (() => void) | undefined;
    const persistenceReleased = new Promise<void>((resolveReleased) => {
      releasePersistence = resolveReleased;
    });
    const store: TimelineStore = {
      async appendEvents() {},
      async saveSnapshot() {},
      async savePluginLock() {},
      async saveModelCall() {
        finishPersistence?.();
        await persistenceReleased;
      },
      async recordFailure() {},
      async loadLatest() {
        return { snapshot: null, events: [] };
      },
      async close() {},
    };
    const coordinator = new DecisionRequestCoordinator({
      provider: {
        async decide() {
          return {
            schemaVersion: 1,
            goalOptionId: "alice-wait" as never,
            reason: "Alice waits",
          };
        },
      },
      persistence: new PersistenceWriter(store),
      modelId: "fixed-test",
      now: () => "2026-08-31T00:00:00.000Z",
      monotonicNow: () => 10,
    });

    const outcome = coordinator.decide(request);
    await persistenceStarted;
    coordinator.cancelAll();
    releasePersistence?.();

    await expect(outcome).resolves.toMatchObject({
      type: "result",
      result: { requestId: request.requestId },
    });
  });
});
