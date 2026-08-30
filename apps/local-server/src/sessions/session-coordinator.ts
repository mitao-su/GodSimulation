import type {
  HostToWorkerMessage,
  WorkerToHostMessage,
  WorldCommand,
  WorldView,
} from "@god-sim/protocol";
import { RequestIdSchema, TechnicalFailureSchema, WorldViewSchema } from "@god-sim/protocol";
import type { DecisionProvider } from "@god-sim/model-gateway";

import {
  DecisionRequestCoordinator,
  type CoordinatedDecision,
} from "../decisions/decision-request-coordinator";
import type { PersistenceWriter } from "../persistence/persistence-writer";
import type { WorkerTransport } from "./worker-supervisor";

export interface SessionCoordinatorOptions {
  readonly worker: WorkerTransport;
  readonly decisionProvider: DecisionProvider;
  readonly persistence: PersistenceWriter;
  readonly modelId: string;
  readonly now?: () => string;
  readonly onError?: (error: unknown) => void;
}

export interface SessionClientPort {
  getView(): WorldView | null;
  subscribe(listener: (view: WorldView) => void): () => void;
  sendCommand(command: WorldCommand): Promise<void>;
}

export class SessionCoordinator {
  readonly #worker: WorkerTransport;
  readonly #persistence: PersistenceWriter;
  readonly #decisions: DecisionRequestCoordinator;
  readonly #now: () => string;
  readonly #onError: (error: unknown) => void;
  readonly #tasks = new Set<Promise<void>>();
  readonly #viewListeners = new Set<(view: WorldView) => void>();
  readonly #snapshotKeys = new Set<string>();
  #unsubscribeWorker: (() => void) | null = null;
  #view: WorldView | null = null;
  #failureSequence = 0;

  constructor(options: SessionCoordinatorOptions) {
    this.#worker = options.worker;
    this.#persistence = options.persistence;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#onError = options.onError ?? (() => undefined);
    this.#decisions = new DecisionRequestCoordinator({
      provider: options.decisionProvider,
      persistence: options.persistence,
      modelId: options.modelId,
      now: this.#now,
    });
  }

  async start(
    initialization?: Extract<HostToWorkerMessage, { type: "initialize" }>,
  ): Promise<void> {
    if (this.#unsubscribeWorker) throw new Error("Session coordinator is already started");
    this.#unsubscribeWorker = this.#worker.onMessage((message) => this.#dispatch(message));
    await this.#worker.start(initialization);
  }

  async stop(): Promise<void> {
    this.#decisions.cancelAll();
    await this.waitForIdle();
    this.#unsubscribeWorker?.();
    this.#unsubscribeWorker = null;
    await this.#worker.stop();
    await this.#persistence.close();
  }

  getView(): WorldView | null {
    return this.#view;
  }

  subscribe(listener: (view: WorldView) => void): () => void {
    this.#viewListeners.add(listener);
    if (this.#view) listener(this.#view);
    return () => this.#viewListeners.delete(listener);
  }

  async sendCommand(command: WorldCommand): Promise<void> {
    await this.#worker.send({ type: "world_command", command });
  }

  async waitForIdle(): Promise<void> {
    while (this.#tasks.size > 0) await Promise.all([...this.#tasks]);
    await this.#persistence.flush();
  }

  #dispatch(message: WorkerToHostMessage): void {
    const task = this.#handleMessage(message).catch((error: unknown) => {
      this.#handleApplicationFailure(message, error);
    });
    this.#tasks.add(task);
    void task.then(() => this.#tasks.delete(task));
  }

  async #handleMessage(message: WorkerToHostMessage): Promise<void> {
    switch (message.type) {
      case "worker_ready":
      case "decision_rejected":
        return;
      case "decision_requested": {
        const outcome = await this.#decisions.decide(message.request);
        await this.#sendDecisionOutcome(outcome);
        return;
      }
      case "event_batch":
        await this.#persistence.appendEvents(message.events);
        return;
      case "snapshot_ready":
        await this.#persistence.saveSnapshot(message.snapshot);
        return;
      case "world_view":
        this.#publishView(message.view);
        await this.#requestFreezeSnapshot(message.view);
        return;
      case "technical_failure":
        if (this.#view) {
          await this.#persistence.recordFailure(this.#view.worldId, message.failure);
          this.#publishTechnicalFailure(message.failure);
        }
        return;
    }
  }

  async #sendDecisionOutcome(outcome: CoordinatedDecision): Promise<void> {
    if (outcome.type === "result") {
      await this.#worker.send({ type: "decision_result", result: outcome.result });
    } else {
      await this.#worker.send({ type: "decision_failure", failure: outcome.failure });
    }
  }

  #publishView(view: WorldView): void {
    this.#view = view;
    for (const listener of this.#viewListeners) listener(view);
  }

  async #requestFreezeSnapshot(view: WorldView): Promise<void> {
    if (view.mode !== "THINKING") return;
    const key = `${view.worldId}:${view.worldVersion}`;
    if (this.#snapshotKeys.has(key)) return;
    this.#snapshotKeys.add(key);
    await this.#worker.send({
      type: "request_snapshot",
      requestId: RequestIdSchema.parse(`snapshot:${key}`),
    });
  }

  #handleApplicationFailure(message: WorkerToHostMessage, error: unknown): void {
    try {
      this.#onError(error);
    } catch {
      // Logging must not create a second application failure.
    }
    if (!this.#view) return;
    this.#failureSequence += 1;
    const detail = error instanceof Error ? error.message : String(error);
    const persistenceMessage =
      message.type === "event_batch" ||
      message.type === "snapshot_ready" ||
      message.type === "technical_failure" ||
      message.type === "decision_requested";
    this.#publishTechnicalFailure(
      TechnicalFailureSchema.parse({
        id: `failure:host:${this.#failureSequence}`,
        category: persistenceMessage ? "persistence" : "worker",
        message: detail.slice(0, 2_000),
        ...(message.type === "decision_requested"
          ? { requestId: message.request.requestId }
          : {}),
        retryable: false,
        occurredAtRealTime: this.#now(),
      }),
    );
  }

  #publishTechnicalFailure(failure: ReturnType<typeof TechnicalFailureSchema.parse>): void {
    if (!this.#view) return;
    this.#publishView(
      WorldViewSchema.parse({
        ...this.#view,
        revision: this.#view.revision + 1,
        mode: "TECHNICALLY_BLOCKED",
        pauseReason: {
          code: "technical_failure",
          message: failure.message,
          agentIds: [],
        },
        technicalFailure: failure,
      }),
    );
  }
}
