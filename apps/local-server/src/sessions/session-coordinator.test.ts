import { describe, expect, it, vi } from "vitest";

import type {
  HostToWorkerMessage,
  ModelDecisionRequest,
  WorkerToHostMessage,
} from "@god-sim/protocol";
import type { DecisionProvider } from "@god-sim/model-gateway";
import type { TimelineStore } from "@god-sim/timeline";

import { PersistenceWriter } from "../persistence/persistence-writer";
import { SessionCoordinator } from "./session-coordinator";
import type { WorkerTransport } from "./worker-supervisor";

function request(agentId: "alice" | "bob"): ModelDecisionRequest {
  return {
    requestId: `request-${agentId}` as never,
    agentId: agentId as never,
    worldId: "starter-world" as never,
    worldVersion: 1,
    decisionCycleId: "cycle-1" as never,
    schemaVersion: 1,
    pluginLockHash: "a".repeat(64) as never,
    decisionReason: { code: "initial_goal", summary: "Choose" },
    messages: [{ role: "user", content: "Choose" }],
    goalOptions: [
      {
        id: `${agentId}-wait` as never,
        label: "Wait",
        goal: { kind: "wait", durationTicks: 10 },
      },
    ],
  };
}

function worldView(): Extract<WorkerToHostMessage, { type: "world_view" }>["view"] {
  return {
    schemaVersion: 1,
    revision: 1,
    worldId: "starter-world" as never,
    worldName: "Starter Home",
    worldVersion: 1,
    worldTick: 0,
    mode: "THINKING",
    reviewRequired: true,
    pauseReason: {
      code: "initial_goal",
      message: "Choose",
      agentIds: ["alice" as never, "bob" as never],
    },
    map: { width: 18, height: 12, tileSize: 16, zones: [], tiles: [] },
    entities: [],
    agents: [],
    pendingDecisions: [],
    recentEvents: [],
    technicalFailure: null,
  };
}

class FakeWorker implements WorkerTransport {
  readonly sent: HostToWorkerMessage[] = [];
  #listener: ((message: WorkerToHostMessage) => void) | null = null;

  onMessage(listener: (message: WorkerToHostMessage) => void): () => void {
    this.#listener = listener;
    return () => {
      this.#listener = null;
    };
  }

  async start(): Promise<void> {}

  async send(message: HostToWorkerMessage): Promise<void> {
    this.sent.push(message);
  }

  async stop(): Promise<void> {}

  emit(message: WorkerToHostMessage): void {
    this.#listener?.(message);
  }
}

function deferredProvider() {
  const resolvers = new Map<
    string,
    { resolve: (value: { schemaVersion: 1; goalOptionId: never; reason: string }) => void; reject: (error: Error) => void }
  >();
  const calls: string[] = [];
  const provider: DecisionProvider = {
    decide(requestValue) {
      calls.push(requestValue.agentId);
      return new Promise((resolve, reject) => {
        resolvers.set(requestValue.agentId, { resolve, reject });
      });
    },
  };
  return { provider, calls, resolvers };
}

describe("SessionCoordinator", () => {
  it("requests one durable snapshot when a decision freeze is first published", async () => {
    const worker = new FakeWorker();
    const coordinator = new SessionCoordinator({
      worker,
      decisionProvider: deferredProvider().provider,
      persistence: PersistenceWriter.inMemory(),
      modelId: "fixed-test",
    });
    await coordinator.start();
    worker.emit({ type: "world_view", view: worldView() });
    worker.emit({ type: "world_view", view: worldView() });
    await coordinator.waitForIdle();

    expect(worker.sent.filter((message) => message.type === "request_snapshot")).toHaveLength(1);
    await coordinator.stop();
  });

  it("turns a persistence write failure into a visible technical block", async () => {
    const store: TimelineStore = {
      async appendEvents() {},
      async saveSnapshot() {
        throw new Error("disk unavailable");
      },
      async savePluginLock() {},
      async saveModelCall() {},
      async recordFailure() {},
      async loadLatest() {
        return { snapshot: null, events: [] };
      },
      async close() {},
    };
    const worker = new FakeWorker();
    const coordinator = new SessionCoordinator({
      worker,
      decisionProvider: deferredProvider().provider,
      persistence: new PersistenceWriter(store),
      modelId: "fixed-test",
      now: () => "2026-08-31T00:00:00.000Z",
    });
    await coordinator.start();
    worker.emit({ type: "world_view", view: worldView() });
    worker.emit({
      type: "snapshot_ready",
      snapshot: {
        schemaVersion: 1,
        worldId: "starter-world" as never,
        worldVersion: 1,
        worldTick: 0,
        lastEventSequence: 0,
        pluginLockHash: "a".repeat(64) as never,
        state: {},
      },
    });

    await vi.waitFor(() =>
      expect(coordinator.getView()).toMatchObject({
        mode: "TECHNICALLY_BLOCKED",
        technicalFailure: { category: "persistence" },
      }),
    );
    await coordinator.stop();
  });

  it("projects a worker crash as a visible technical block", async () => {
    const worker = new FakeWorker();
    const coordinator = new SessionCoordinator({
      worker,
      decisionProvider: deferredProvider().provider,
      persistence: PersistenceWriter.inMemory(),
      modelId: "fixed-test",
      now: () => "2026-08-31T00:00:00.000Z",
    });
    await coordinator.start();
    worker.emit({ type: "world_view", view: worldView() });
    worker.emit({
      type: "technical_failure",
      failure: {
        id: "failure:worker:exit",
        category: "worker",
        message: "Simulation worker exited with code 17",
        retryable: false,
        occurredAtRealTime: "2026-08-31T00:00:00.000Z",
      },
    });
    await coordinator.waitForIdle();

    expect(coordinator.getView()).toMatchObject({
      mode: "TECHNICALLY_BLOCKED",
      technicalFailure: { id: "failure:worker:exit", category: "worker" },
    });
    await coordinator.stop();
  });

  it("runs requests concurrently and keeps peer results independent", async () => {
    const worker = new FakeWorker();
    const deferred = deferredProvider();
    const persistence = PersistenceWriter.inMemory();
    const coordinator = new SessionCoordinator({
      worker,
      decisionProvider: deferred.provider,
      persistence,
      modelId: "fixed-test",
      now: () => "2026-08-31T00:00:00.000Z",
    });
    await coordinator.start();

    worker.emit({ type: "decision_requested", request: request("alice") });
    worker.emit({ type: "decision_requested", request: request("bob") });
    await vi.waitFor(() => expect(deferred.calls).toEqual(["alice", "bob"]));
    deferred.resolvers.get("alice")!.resolve({
      schemaVersion: 1,
      goalOptionId: "alice-wait" as never,
      reason: "Alice waits",
    });
    await vi.waitFor(() => expect(worker.sent).toHaveLength(1));
    expect(worker.sent[0]).toMatchObject({
      type: "decision_result",
      result: { agentId: "alice", proposal: { goalOptionId: "alice-wait" } },
    });

    deferred.resolvers.get("bob")!.reject(new Error("Provider unavailable"));
    await coordinator.waitForIdle();

    expect(worker.sent[1]).toMatchObject({
      type: "decision_failure",
      failure: { category: "model", requestId: "request-bob", retryable: true },
    });
    expect(worker.sent).not.toContainEqual(
      expect.objectContaining({ type: "world_command" }),
    );
    await coordinator.stop();
  });
});
