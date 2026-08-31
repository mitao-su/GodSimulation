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

function checkpointReady(): Extract<WorkerToHostMessage, { type: "checkpoint_ready" }> {
  return {
    type: "checkpoint_ready",
    checkpointId: "checkpoint:starter-world:1:0" as never,
    events: [],
    snapshot: {
      schemaVersion: 2,
      worldId: "starter-world" as never,
      worldVersion: 1,
      worldTick: 0,
      lastEventSequence: 0,
      pluginLockHash: "a".repeat(64) as never,
      history: { mode: "strict", causalFromSequence: 1 },
      causalEventIds: [],
      state: {},
    },
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
  it("acknowledges a checkpoint only after its atomic commit resolves", async () => {
    let markCommitStarted: (() => void) | undefined;
    const commitStarted = new Promise<void>((resolve) => {
      markCommitStarted = resolve;
    });
    let releaseCommit: (() => void) | undefined;
    const commitReleased = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const store: TimelineStore = {
      async commitCheckpoint() {
        markCommitStarted?.();
        await commitReleased;
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
    });
    await coordinator.start();

    worker.emit(checkpointReady());
    await commitStarted;
    expect(worker.sent.filter((message) => message.type === "checkpoint_committed"))
      .toEqual([]);

    releaseCommit?.();
    await coordinator.waitForIdle();
    expect(worker.sent).toContainEqual({
      type: "checkpoint_committed",
      checkpointId: checkpointReady().checkpointId,
    });
    await coordinator.stop();
  });

  it("keeps an accepted model row when the worker rejects world adoption", async () => {
    const modelStatuses: string[] = [];
    const failures: Array<{
      requestId: string | undefined;
      category: string;
    }> = [];
    const store: TimelineStore = {
      async commitCheckpoint() {},
      async savePluginLock() {},
      async saveModelCall(record) {
        modelStatuses.push(record.status);
      },
      async recordFailure(_worldId, failure) {
        failures.push({
          requestId: failure.requestId,
          category: failure.category,
        });
      },
      async loadLatest() {
        return { snapshot: null, events: [] };
      },
      async close() {},
    };
    const worker = new FakeWorker();
    const coordinator = new SessionCoordinator({
      worker,
      decisionProvider: {
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
    });
    await coordinator.start();
    worker.emit({ type: "decision_requested", request: request("alice") });
    await vi.waitFor(() =>
      expect(worker.sent.some((message) => message.type === "decision_result")).toBe(true),
    );
    const delivered = worker.sent.find((message) => message.type === "decision_result")!;
    if (delivered.type !== "decision_result") throw new Error("Missing result");

    worker.emit({
      type: "decision_rejected",
      result: {
        requestId: delivered.result.requestId,
        agentId: delivered.result.agentId,
        worldId: delivered.result.worldId,
        worldVersion: delivered.result.worldVersion,
        decisionCycleId: delivered.result.decisionCycleId,
        schemaVersion: delivered.result.schemaVersion,
        pluginLockHash: delivered.result.pluginLockHash,
      },
      reason: "World rejected the stale result",
    });
    await coordinator.waitForIdle();

    expect(modelStatuses).toEqual(["accepted"]);
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: request("alice").requestId,
          category: "protocol",
        }),
      ]),
    );
    await coordinator.stop();
  });

  it("cancels model requests during shutdown without reporting a gameplay failure", async () => {
    const worker = new FakeWorker();
    const calls: string[] = [];
    const coordinator = new SessionCoordinator({
      worker,
      decisionProvider: {
        decide(requestValue, signal) {
          calls.push(requestValue.requestId);
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
      },
      persistence: PersistenceWriter.inMemory(),
      modelId: "fixed-test",
    });
    await coordinator.start();
    worker.emit({ type: "decision_requested", request: request("alice") });
    await vi.waitFor(() => expect(calls).toEqual(["request-alice"]));

    await coordinator.stop();

    expect(worker.sent).not.toContainEqual(
      expect.objectContaining({ type: "decision_failure" }),
    );
  });

  it("logs unsaved persistence operations while still completing shutdown", async () => {
    const errors: unknown[] = [];
    let storeClosed = false;
    const store: TimelineStore = {
      async commitCheckpoint() {
        throw new Error("disk unavailable");
      },
      async savePluginLock() {},
      async saveModelCall() {},
      async recordFailure() {},
      async loadLatest() {
        return { snapshot: null, events: [] };
      },
      async close() {
        storeClosed = true;
      },
    };
    const worker = new FakeWorker();
    const coordinator = new SessionCoordinator({
      worker,
      decisionProvider: deferredProvider().provider,
      persistence: new PersistenceWriter(store),
      modelId: "fixed-test",
      onError: (error) => errors.push(error),
    });
    await coordinator.start();
    worker.emit({ type: "world_view", view: worldView() });
    worker.emit(checkpointReady());
    await vi.waitFor(() => expect(errors).toHaveLength(1));

    await expect(coordinator.stop()).resolves.toBeUndefined();

    expect(storeClosed).toBe(true);
    expect(errors).toHaveLength(2);
    expect(errors[1]).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/unsaved persistence operation/i) }),
    );
  });

  it("does not request a host-driven snapshot for a decision freeze", async () => {
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

    expect(worker.sent.filter((message) => message.type === "request_snapshot")).toHaveLength(0);
    await coordinator.stop();
  });

  it("does not request a host-driven snapshot for an authoritative technical block", async () => {
    const worker = new FakeWorker();
    const coordinator = new SessionCoordinator({
      worker,
      decisionProvider: deferredProvider().provider,
      persistence: PersistenceWriter.inMemory(),
      modelId: "fixed-test",
    });
    await coordinator.start();
    const failure = {
      id: "failure:model:request-alice",
      category: "model" as const,
      message: "Model unavailable",
      requestId: "request-alice" as never,
      retryable: true,
      occurredAtRealTime: "2026-08-31T00:00:00.000Z",
    };
    worker.emit({
      type: "world_view",
      view: {
        ...worldView(),
        revision: 2,
        worldVersion: 2,
        mode: "TECHNICALLY_BLOCKED",
        pauseReason: {
          code: "technical_failure",
          message: failure.message,
          agentIds: ["alice" as never],
        },
        technicalFailure: failure,
      },
    });
    await coordinator.waitForIdle();

    expect(worker.sent.filter((message) => message.type === "request_snapshot"))
      .toHaveLength(0);
    await coordinator.stop();
  });

  it("blocks visibly when the worker rejects a delivered decision", async () => {
    const worker = new FakeWorker();
    const coordinator = new SessionCoordinator({
      worker,
      decisionProvider: deferredProvider().provider,
      persistence: PersistenceWriter.inMemory(),
      modelId: "fixed-test",
      now: () => "2026-08-31T00:00:00.000Z",
    });
    await coordinator.start();

    try {
      const rejected = request("alice");
      worker.emit({ type: "world_view", view: worldView() });
      worker.emit({
        type: "decision_rejected",
        result: {
          requestId: rejected.requestId,
          agentId: rejected.agentId,
          worldId: rejected.worldId,
          worldVersion: rejected.worldVersion,
          decisionCycleId: rejected.decisionCycleId,
          schemaVersion: rejected.schemaVersion,
          pluginLockHash: rejected.pluginLockHash,
        },
        reason: "Decision result does not match a pending option",
      });

      await vi.waitFor(() =>
        expect(coordinator.getView()).toMatchObject({
          mode: "TECHNICALLY_BLOCKED",
          technicalFailure: {
            category: "protocol",
            retryable: false,
            requestId: "request-alice",
            message: "Decision result does not match a pending option",
          },
        }),
      );
      expect(worker.sent).toContainEqual({
        type: "technical_failure",
        failure: expect.objectContaining({ category: "protocol" }),
      });
      const hostFailure = worker.sent.find(
        (message): message is Extract<HostToWorkerMessage, { type: "technical_failure" }> =>
          message.type === "technical_failure",
      )!.failure;
      worker.emit({
        type: "world_view",
        view: {
          ...worldView(),
          revision: 3,
          worldVersion: 2,
          mode: "TECHNICALLY_BLOCKED",
          pauseReason: {
            code: "technical_failure",
            message: hostFailure.message,
            agentIds: [],
          },
          technicalFailure: hostFailure,
        },
      });
      await coordinator.waitForIdle();
      expect(worker.sent.filter((message) => message.type === "request_snapshot"))
        .toHaveLength(0);
    } finally {
      await coordinator.stop();
    }
  });

  it("turns a persistence write failure into a visible technical block", async () => {
    const store: TimelineStore = {
      async commitCheckpoint() {
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
    worker.emit(checkpointReady());

    await vi.waitFor(() =>
      expect(coordinator.getView()).toMatchObject({
        mode: "TECHNICALLY_BLOCKED",
        technicalFailure: { category: "persistence" },
      }),
    );
    expect(worker.sent).toContainEqual({
      type: "technical_failure",
      failure: expect.objectContaining({
        category: "persistence",
        message: "disk unavailable",
      }),
    });

    worker.emit({ type: "world_view", view: { ...worldView(), revision: 2 } });
    await coordinator.waitForIdle();
    expect(coordinator.getView()).toMatchObject({
      mode: "TECHNICALLY_BLOCKED",
      technicalFailure: { category: "persistence" },
    });
    await coordinator.stop();
  });

  it("retains a persistence failure reported before the first world view", async () => {
    const errors: unknown[] = [];
    const store: TimelineStore = {
      async commitCheckpoint() {
        throw new Error("disk unavailable before first view");
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
      onError: (error) => errors.push(error),
    });
    await coordinator.start();

    try {
      worker.emit(checkpointReady());
      await vi.waitFor(() => expect(errors).toHaveLength(1));
      expect(coordinator.getView()).toBeNull();

      worker.emit({ type: "world_view", view: worldView() });

      await vi.waitFor(() =>
        expect(coordinator.getView()).toMatchObject({
          mode: "TECHNICALLY_BLOCKED",
          technicalFailure: {
            category: "persistence",
            retryable: true,
            message: "disk unavailable before first view",
          },
        }),
      );
    } finally {
      await coordinator.stop();
    }
  });

  it("coalesces concurrent persistence errors into one authoritative world block", async () => {
    class DeferredFreezeWorker extends FakeWorker {
      readonly freezeResolvers: Array<() => void> = [];

      override async send(message: HostToWorkerMessage): Promise<void> {
        await super.send(message);
        if (message.type === "technical_failure") {
          await new Promise<void>((resolve) => this.freezeResolvers.push(resolve));
        }
      }
    }

    const errors: unknown[] = [];
    const store: TimelineStore = {
      async commitCheckpoint() {
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
    const worker = new DeferredFreezeWorker();
    const coordinator = new SessionCoordinator({
      worker,
      decisionProvider: deferredProvider().provider,
      persistence: new PersistenceWriter(store),
      modelId: "fixed-test",
      now: () => "2026-08-31T00:00:00.000Z",
      onError: (error) => errors.push(error),
    });
    await coordinator.start();

    try {
      worker.emit({ type: "world_view", view: worldView() });
      worker.emit(checkpointReady());
      worker.emit(checkpointReady());
      await vi.waitFor(() => expect(errors).toHaveLength(2));

      for (const resolve of worker.freezeResolvers) resolve();
      await coordinator.waitForIdle();

      expect(worker.sent.filter((message) => message.type === "technical_failure"))
        .toHaveLength(1);
      expect(coordinator.getView()?.technicalFailure?.id).toBe(
        worker.sent.find((message) => message.type === "technical_failure")!.failure.id,
      );
    } finally {
      for (const resolve of worker.freezeResolvers) resolve();
      await coordinator.stop();
    }
  });

  it("reports a worker failure when the authoritative world cannot be blocked", async () => {
    class UnreachableWorker extends FakeWorker {
      override async send(message: HostToWorkerMessage): Promise<void> {
        await super.send(message);
        if (message.type === "technical_failure") {
          throw new Error("Failed to deliver the world freeze");
        }
      }
    }

    const store: TimelineStore = {
      async commitCheckpoint() {
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
    const worker = new UnreachableWorker();
    const coordinator = new SessionCoordinator({
      worker,
      decisionProvider: deferredProvider().provider,
      persistence: new PersistenceWriter(store),
      modelId: "fixed-test",
      now: () => "2026-08-31T00:00:00.000Z",
    });
    await coordinator.start();

    try {
      worker.emit({ type: "world_view", view: worldView() });
      worker.emit(checkpointReady());

      await vi.waitFor(() =>
        expect(coordinator.getView()).toMatchObject({
          mode: "TECHNICALLY_BLOCKED",
          technicalFailure: {
            category: "worker",
            retryable: false,
            message: "Failed to deliver the world freeze",
          },
        }),
      );
    } finally {
      await coordinator.stop();
    }
  });

  it("cancels an in-flight model request when persistence blocks the session", async () => {
    const store: TimelineStore = {
      async commitCheckpoint() {
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
    let providerStarted = false;
    let providerAborted = false;
    const coordinator = new SessionCoordinator({
      worker,
      decisionProvider: {
        decide(_requestValue, signal) {
          providerStarted = true;
          return new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                providerAborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        },
      },
      persistence: new PersistenceWriter(store),
      modelId: "fixed-test",
      now: () => "2026-08-31T00:00:00.000Z",
    });
    await coordinator.start();

    try {
      worker.emit({ type: "world_view", view: worldView() });
      await vi.waitFor(() => expect(coordinator.getView()).not.toBeNull());
      worker.emit({ type: "decision_requested", request: request("alice") });
      await vi.waitFor(() => expect(providerStarted).toBe(true));
      worker.emit(checkpointReady());

      await vi.waitFor(() => expect(providerAborted).toBe(true));
      await coordinator.waitForIdle();
      expect(worker.sent).not.toContainEqual(
        expect.objectContaining({ type: "decision_result" }),
      );
      expect(worker.sent).not.toContainEqual(
        expect.objectContaining({ type: "decision_failure" }),
      );
    } finally {
      await coordinator.stop();
    }
  });

  it("retries the failed write before recovering the authoritative world view", async () => {
    let diskAvailable = false;
    let checkpointAttempts = 0;
    const store: TimelineStore = {
      async commitCheckpoint() {
        checkpointAttempts += 1;
        if (!diskAvailable) throw new Error("disk unavailable");
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

    try {
      worker.emit({ type: "world_view", view: worldView() });
      worker.emit(checkpointReady());
      await vi.waitFor(() =>
        expect(coordinator.getView()).toMatchObject({
          mode: "TECHNICALLY_BLOCKED",
          technicalFailure: { category: "persistence", retryable: true },
        }),
      );
      const blocked = coordinator.getView()!;
      const failureId = blocked.technicalFailure!.id;
      diskAvailable = true;

      await coordinator.sendCommand({
        schemaVersion: 1,
        commandId: "command:retry:persistence" as never,
        worldId: blocked.worldId,
        expectedWorldVersion: blocked.worldVersion,
        issuedAtRealTime: "2026-08-31T00:00:01.000Z",
        type: "retry_technical_failure",
        failureId,
      });

      expect(checkpointAttempts).toBe(2);
      expect(worker.sent).toContainEqual({
        type: "checkpoint_committed",
        checkpointId: checkpointReady().checkpointId,
      });
      expect(worker.sent).toContainEqual({
        type: "world_command",
        command: expect.objectContaining({
          type: "retry_technical_failure",
          failureId,
        }),
      });
      worker.emit({
        type: "world_view",
        view: {
          ...worldView(),
          revision: 20,
          worldVersion: blocked.worldVersion + 1,
        },
      });
      await vi.waitFor(() => expect(coordinator.getView()?.mode).toBe("THINKING"));
      expect(coordinator.getView()?.technicalFailure).toBeNull();
    } finally {
      await coordinator.stop();
    }
  });

  it("reissues a decision request cancelled by a persistence failure", async () => {
    let diskAvailable = false;
    const store: TimelineStore = {
      async commitCheckpoint() {
        if (!diskAvailable) throw new Error("disk unavailable");
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
    let calls = 0;
    const coordinator = new SessionCoordinator({
      worker,
      decisionProvider: {
        decide(_requestValue, signal) {
          calls += 1;
          if (calls === 2) {
            return Promise.resolve({
              schemaVersion: 1,
              goalOptionId: "alice-wait" as never,
              reason: "Alice waits after recovery",
            });
          }
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
      },
      persistence: new PersistenceWriter(store),
      modelId: "fixed-test",
      now: () => "2026-08-31T00:00:00.000Z",
    });
    await coordinator.start();

    try {
      worker.emit({ type: "world_view", view: worldView() });
      worker.emit({ type: "decision_requested", request: request("alice") });
      await vi.waitFor(() => expect(calls).toBe(1));
      worker.emit(checkpointReady());
      await vi.waitFor(() => expect(coordinator.getView()?.mode).toBe("TECHNICALLY_BLOCKED"));
      const blocked = coordinator.getView()!;
      diskAvailable = true;

      await coordinator.sendCommand({
        schemaVersion: 1,
        commandId: "command:retry:cancelled-decision" as never,
        worldId: blocked.worldId,
        expectedWorldVersion: blocked.worldVersion,
        issuedAtRealTime: "2026-08-31T00:00:01.000Z",
        type: "retry_technical_failure",
        failureId: blocked.technicalFailure!.id,
      });

      await vi.waitFor(() => expect(calls).toBe(2));
      await vi.waitFor(() =>
        expect(worker.sent).toContainEqual(
          expect.objectContaining({ type: "decision_result" }),
        ),
      );
    } finally {
      await coordinator.stop();
    }
  });

  it("reuses a completed model result when only its persistence write failed", async () => {
    let diskAvailable = false;
    const store: TimelineStore = {
      async commitCheckpoint() {},
      async savePluginLock() {},
      async saveModelCall() {
        if (!diskAvailable) throw new Error("disk unavailable");
      },
      async recordFailure() {},
      async loadLatest() {
        return { snapshot: null, events: [] };
      },
      async close() {},
    };
    const worker = new FakeWorker();
    let calls = 0;
    const coordinator = new SessionCoordinator({
      worker,
      decisionProvider: {
        async decide() {
          calls += 1;
          return {
            schemaVersion: 1,
            goalOptionId: "alice-wait" as never,
            reason: "Keep this exact result",
          };
        },
      },
      persistence: new PersistenceWriter(store),
      modelId: "fixed-test",
      now: () => "2026-08-31T00:00:00.000Z",
    });
    await coordinator.start();

    try {
      worker.emit({ type: "world_view", view: worldView() });
      worker.emit({ type: "decision_requested", request: request("alice") });
      await vi.waitFor(() => expect(coordinator.getView()?.mode).toBe("TECHNICALLY_BLOCKED"));
      const blocked = coordinator.getView()!;
      diskAvailable = true;

      await coordinator.sendCommand({
        schemaVersion: 1,
        commandId: "command:retry:completed-decision" as never,
        worldId: blocked.worldId,
        expectedWorldVersion: blocked.worldVersion,
        issuedAtRealTime: "2026-08-31T00:00:01.000Z",
        type: "retry_technical_failure",
        failureId: blocked.technicalFailure!.id,
      });

      await vi.waitFor(() =>
        expect(worker.sent).toContainEqual(
          expect.objectContaining({
            type: "decision_result",
            result: expect.objectContaining({
              proposal: expect.objectContaining({ reason: "Keep this exact result" }),
            }),
          }),
        ),
      );
      expect(calls).toBe(1);
    } finally {
      await coordinator.stop();
    }
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

  it("keeps a worker failure authoritative when recording it also fails", async () => {
    const errors: unknown[] = [];
    const store: TimelineStore = {
      async commitCheckpoint() {},
      async savePluginLock() {},
      async saveModelCall() {},
      async recordFailure() {
        throw new Error("disk unavailable while recording worker failure");
      },
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
      onError: (error) => errors.push(error),
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
    await vi.waitFor(() => expect(errors).toHaveLength(1));

    expect(coordinator.getView()).toMatchObject({
      mode: "TECHNICALLY_BLOCKED",
      technicalFailure: {
        id: "failure:worker:exit",
        category: "worker",
        retryable: false,
      },
    });
    expect(worker.sent).not.toContainEqual(
      expect.objectContaining({ type: "technical_failure" }),
    );
    await coordinator.stop();
  });

  it("cancels an in-flight model request when the worker reports a technical failure", async () => {
    const worker = new FakeWorker();
    let providerStarted = false;
    let providerAborted = false;
    const coordinator = new SessionCoordinator({
      worker,
      decisionProvider: {
        decide(_requestValue, signal) {
          providerStarted = true;
          return new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                providerAborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        },
      },
      persistence: PersistenceWriter.inMemory(),
      modelId: "fixed-test",
      now: () => "2026-08-31T00:00:00.000Z",
    });
    await coordinator.start();

    try {
      worker.emit({ type: "world_view", view: worldView() });
      worker.emit({ type: "decision_requested", request: request("alice") });
      await vi.waitFor(() => expect(providerStarted).toBe(true));

      worker.emit({
        type: "technical_failure",
        failure: {
          id: "failure:worker:runtime",
          category: "worker",
          message: "Simulation worker failed",
          retryable: false,
          occurredAtRealTime: "2026-08-31T00:00:00.000Z",
        },
      });

      await vi.waitFor(() => expect(providerAborted).toBe(true));
      expect(worker.sent).not.toContainEqual(
        expect.objectContaining({ type: "decision_result" }),
      );
      expect(worker.sent).not.toContainEqual(
        expect.objectContaining({ type: "decision_failure" }),
      );
    } finally {
      await coordinator.stop();
    }
  });

  it("classifies a decision delivery failure as a worker failure", async () => {
    class FailingDecisionDeliveryWorker extends FakeWorker {
      override async send(message: HostToWorkerMessage): Promise<void> {
        await super.send(message);
        if (message.type === "decision_result") {
          throw new Error("Simulation worker IPC is not connected");
        }
      }
    }

    const worker = new FailingDecisionDeliveryWorker();
    const coordinator = new SessionCoordinator({
      worker,
      decisionProvider: {
        async decide() {
          return {
            schemaVersion: 1,
            goalOptionId: "alice-wait" as never,
            reason: "Alice waits",
          };
        },
      },
      persistence: PersistenceWriter.inMemory(),
      modelId: "fixed-test",
      now: () => "2026-08-31T00:00:00.000Z",
    });
    await coordinator.start();

    try {
      worker.emit({ type: "world_view", view: worldView() });
      worker.emit({ type: "decision_requested", request: request("alice") });

      await vi.waitFor(() =>
        expect(coordinator.getView()).toMatchObject({
          mode: "TECHNICALLY_BLOCKED",
          technicalFailure: {
            category: "worker",
            retryable: false,
            message: "Simulation worker IPC is not connected",
          },
        }),
      );
    } finally {
      await coordinator.stop();
    }
  });

  it.each(["world_command", "decision_result"] as const)(
    "classifies a %s delivery failure during persistence recovery as a worker failure",
    async (failingMessageType) => {
      class FailingRecoveryWorker extends FakeWorker {
        override async send(message: HostToWorkerMessage): Promise<void> {
          await super.send(message);
          if (message.type === failingMessageType) {
            throw new Error(`Failed to deliver ${failingMessageType}`);
          }
        }
      }

      let diskAvailable = false;
      const store: TimelineStore = {
        async commitCheckpoint() {},
        async savePluginLock() {},
        async saveModelCall() {
          if (!diskAvailable) throw new Error("disk unavailable");
        },
        async recordFailure() {},
        async loadLatest() {
          return { snapshot: null, events: [] };
        },
        async close() {},
      };
      const worker = new FailingRecoveryWorker();
      const coordinator = new SessionCoordinator({
        worker,
        decisionProvider: {
          async decide() {
            return {
              schemaVersion: 1,
              goalOptionId: "alice-wait" as never,
              reason: "Keep this result",
            };
          },
        },
        persistence: new PersistenceWriter(store),
        modelId: "fixed-test",
        now: () => "2026-08-31T00:00:00.000Z",
      });
      await coordinator.start();

      try {
        worker.emit({ type: "world_view", view: worldView() });
        worker.emit({ type: "decision_requested", request: request("alice") });
        await vi.waitFor(() =>
          expect(coordinator.getView()?.technicalFailure?.category).toBe("persistence"),
        );
        const blocked = coordinator.getView()!;
        diskAvailable = true;

        await expect(
          coordinator.sendCommand({
            schemaVersion: 1,
            commandId: `command:retry:${failingMessageType}` as never,
            worldId: blocked.worldId,
            expectedWorldVersion: blocked.worldVersion,
            issuedAtRealTime: "2026-08-31T00:00:01.000Z",
            type: "retry_technical_failure",
            failureId: blocked.technicalFailure!.id,
          }),
        ).rejects.toThrow(`Failed to deliver ${failingMessageType}`);

        expect(coordinator.getView()).toMatchObject({
          mode: "TECHNICALLY_BLOCKED",
          technicalFailure: {
            category: "worker",
            retryable: false,
            message: `Failed to deliver ${failingMessageType}`,
          },
        });
      } finally {
        await coordinator.stop();
      }
    },
  );

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
