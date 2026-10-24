import { describe, expect, it } from "vitest";

import type { DirectTaskDecision, ModelDecisionRequest } from "@god-sim/protocol";
import type { ModelCallRecord, TimelineStore } from "@god-sim/timeline";

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
  decisionReason: { code: "initial_task", summary: "Choose" },
  messages: [{ role: "user", content: "Choose" }],
};

const waitDecision: DirectTaskDecision = {
  schemaVersion: 3,
  head: { kind: "continue" },
  body: {
    kind: "replace",
    task: {
      kind: "operation",
      operationId: "core.wait" as never,
      hostEntityId: "alice" as never,
      arguments: { durationTicks: 10 },
    },
  },
  goalUpdates: {
    updates: [{ kind: "set", goalId: "goal:rest", status: "active" }],
  },
  reason: "Alice waits",
};

function storeWith(
  saveModelCall: TimelineStore["saveModelCall"],
): TimelineStore {
  return {
    async commitCheckpoint() {},
    async savePluginLock() {},
    saveModelCall,
    async recordFailure() {},
    async loadLatest() {
      return { snapshot: null, events: [] };
    },
    async close() {},
  };
}

function coordinator(
  records: ModelCallRecord[],
  decide: () => Promise<DirectTaskDecision> = async () => waitDecision,
): DecisionRequestCoordinator {
  return new DecisionRequestCoordinator({
    provider: { decide },
    persistence: new PersistenceWriter(
      storeWith(async (record) => {
        records.push(record);
      }),
    ),
    modelId: "fixed-test",
    now: () => "2026-08-31T00:00:00.000Z",
    monotonicNow: () => 10,
  });
}

describe("DecisionRequestCoordinator", () => {
  it("forwards and audits a direct production decision without task options", async () => {
    const records: ModelCallRecord[] = [];
    const requests: ModelDecisionRequest[] = [];
    const decisionCoordinator = new DecisionRequestCoordinator({
      provider: {
        async decide(requestValue) {
          requests.push(requestValue);
          return waitDecision;
        },
      },
      persistence: new PersistenceWriter(
        storeWith(async (record) => {
          records.push(record);
        }),
      ),
      modelId: "fixed-test",
      now: () => "2026-08-31T00:00:00.000Z",
      monotonicNow: () => 10,
    });

    const outcome = await decisionCoordinator.decide(request);

    expect(outcome).toMatchObject({
      type: "result",
      result: { proposal: waitDecision },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty("taskOptions");
    expect(records[0]).toMatchObject({ status: "accepted", taskDecision: waitDecision });
  });

  it("preserves direct operation identity, arguments, and goal updates in the audit record", async () => {
    const records: ModelCallRecord[] = [];
    const outcome = await coordinator(records).decide(request);

    expect(outcome).toMatchObject({
      type: "result",
      result: {
        proposal: {
          body: {
            task: {
              operationId: "core.wait",
              hostEntityId: "alice",
              arguments: { durationTicks: 10 },
            },
          },
          goalUpdates: { updates: [{ goalId: "goal:rest" }] },
        },
      },
    });
    expect(records[0]?.taskDecision).toEqual(waitDecision);
  });

  it("does not disguise an accepted-result persistence error as a model failure", async () => {
    const attemptedRecords: ModelCallRecord[] = [];
    const decisionCoordinator = new DecisionRequestCoordinator({
      provider: { async decide() { return waitDecision; } },
      persistence: new PersistenceWriter(
        storeWith(async (record) => {
          attemptedRecords.push(record);
          throw new Error("disk unavailable");
        }),
      ),
      modelId: "fixed-test",
      now: () => "2026-08-31T00:00:00.000Z",
      monotonicNow: () => 10,
    });

    await expect(decisionCoordinator.decide(request)).rejects.toThrow("disk unavailable");
    expect(attemptedRecords).toEqual([
      expect.objectContaining({
        status: "accepted",
        taskDecision: waitDecision,
        protocolSchemaVersion: request.schemaVersion,
        decisionCycleId: request.decisionCycleId,
        pluginLockHash: request.pluginLockHash,
        decisionReasonCode: request.decisionReason.code,
      }),
    ]);
    expect(attemptedRecords[0]).not.toHaveProperty("goalOptionId");
  });

  it("persists the same causal identity and no task decision for a failed model call", async () => {
    const records: ModelCallRecord[] = [];
    const decisionCoordinator = coordinator(records, async () => {
      throw new Error("provider unavailable");
    });

    await expect(decisionCoordinator.decide(request)).resolves.toMatchObject({
      type: "failure",
    });
    expect(records).toEqual([
      expect.objectContaining({
        status: "failed",
        taskDecision: null,
        protocolSchemaVersion: request.schemaVersion,
        decisionCycleId: request.decisionCycleId,
        pluginLockHash: request.pluginLockHash,
        decisionReasonCode: request.decisionReason.code,
      }),
    ]);
    expect(records[0]).not.toHaveProperty("messages");
  });

  it("rejects a legacy v2 proposal and records a failed call", async () => {
    const records: ModelCallRecord[] = [];
    const legacy = {
      schemaVersion: 2,
      head: { kind: "continue" },
      body: { kind: "continue" },
      reason: "Legacy response",
    } as never;
    const decisionCoordinator = coordinator(records, async () => legacy);

    const outcome = await decisionCoordinator.decide(request);

    expect(outcome).toMatchObject({
      type: "failure",
      failure: { message: expect.stringMatching(/legacy|direct/i) },
    });
    expect(records).toEqual([
      expect.objectContaining({ status: "failed", taskDecision: null }),
    ]);
  });

  it("delivers a model result that became durable before shutdown cancellation", async () => {
    let persistenceStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      persistenceStarted = resolve;
    });
    let releasePersistence!: () => void;
    const released = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const decisionCoordinator = new DecisionRequestCoordinator({
      provider: { async decide() { return waitDecision; } },
      persistence: new PersistenceWriter(
        storeWith(async () => {
          persistenceStarted();
          await released;
        }),
      ),
      modelId: "fixed-test",
      now: () => "2026-08-31T00:00:00.000Z",
      monotonicNow: () => 10,
    });

    const outcome = decisionCoordinator.decide(request);
    await started;
    decisionCoordinator.cancelAll();
    releasePersistence();

    await expect(outcome).resolves.toMatchObject({
      type: "result",
      result: { requestId: request.requestId, proposal: waitDecision },
    });
  });
});
