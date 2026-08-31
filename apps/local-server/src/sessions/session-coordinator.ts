import type {
  CheckpointId,
  HostToWorkerMessage,
  TechnicalFailure,
  WorkerToHostMessage,
  WorldCommand,
  WorldView,
} from "@god-sim/protocol";
import { TechnicalFailureSchema, WorldViewSchema } from "@god-sim/protocol";
import type { DecisionProvider } from "@god-sim/model-gateway";

import {
  DecisionPersistenceError,
  DecisionRequestCoordinator,
  type CompletedDecision,
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
  readonly #pendingDecisionMessages = new Map<
    string,
    Extract<WorkerToHostMessage, { type: "decision_requested" }>
  >();
  readonly #pendingDecisionOutcomes = new Map<string, CompletedDecision>();
  #unsubscribeWorker: (() => void) | null = null;
  #view: WorldView | null = null;
  #failureSequence = 0;
  #terminalFailure: TechnicalFailure | null = null;
  #failedCheckpointId: CheckpointId | null = null;

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
    this.#pendingDecisionMessages.clear();
    this.#pendingDecisionOutcomes.clear();
    await this.#worker.stop();
    await this.waitForIdle();
    this.#unsubscribeWorker?.();
    this.#unsubscribeWorker = null;
    try {
      await this.#persistence.close();
    } catch (error) {
      try {
        this.#onError(error);
      } catch {
        // Shutdown must still finish when development logging fails.
      }
    }
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
    if (command.type === "retry_technical_failure") {
      await this.#retryTechnicalFailure(command);
      return;
    }
    await this.#worker.send({ type: "world_command", command });
  }

  async waitForIdle(): Promise<void> {
    while (this.#tasks.size > 0) await Promise.all([...this.#tasks]);
    await this.#persistence.flush();
  }

  #dispatch(message: WorkerToHostMessage): void {
    if (message.type === "decision_requested") {
      this.#pendingDecisionMessages.set(message.request.requestId, message);
    }
    const task = this.#handleMessage(message).catch((error: unknown) =>
      this.#handleApplicationFailure(message, error),
    );
    this.#tasks.add(task);
    void task.then(() => this.#tasks.delete(task));
  }

  async #handleMessage(message: WorkerToHostMessage): Promise<void> {
    switch (message.type) {
      case "worker_ready":
        return;
      case "decision_rejected":
        await this.#publishHostFailure({
          error: new Error(message.reason),
          category: "protocol",
          retryable: false,
          blockWorker: true,
          requestId: message.result.requestId,
          persistWorldId: message.result.worldId,
        });
        return;
      case "decision_requested": {
        let outcome: CoordinatedDecision;
        try {
          outcome = await this.#decisions.decide(message.request);
        } catch (error) {
          if (error instanceof DecisionPersistenceError) {
            this.#pendingDecisionOutcomes.set(message.request.requestId, error.outcome);
          }
          throw error;
        }
        await this.#sendDecisionOutcome(outcome);
        if (outcome.type !== "cancelled") {
          this.#pendingDecisionMessages.delete(message.request.requestId);
        }
        return;
      }
      case "checkpoint_ready":
        try {
          await this.#persistence.commitCheckpoint(message);
        } catch (error) {
          if (
            this.#failedCheckpointId &&
            this.#failedCheckpointId !== message.checkpointId
          ) {
            throw new Error(
              `Persistence already retains failed checkpoint ${this.#failedCheckpointId}`,
              { cause: error },
            );
          }
          this.#failedCheckpointId = message.checkpointId;
          throw error;
        }
        await this.#worker.send({
          type: "checkpoint_committed",
          checkpointId: message.checkpointId,
        });
        return;
      case "event_batch":
      case "snapshot_ready":
        throw new Error(`Legacy world-history message ${message.type} is not supported`);
      case "world_view":
        if (this.#terminalFailure) {
          if (
            message.view.mode === "TECHNICALLY_BLOCKED" &&
            message.view.technicalFailure?.id === this.#terminalFailure.id
          ) {
            this.#publishView(message.view);
            return;
          }
          if (!this.#view) {
            this.#publishTechnicalFailure(this.#terminalFailure, message.view);
          }
          return;
        }
        this.#publishView(message.view);
        return;
      case "technical_failure":
        this.#decisions.cancelAll("Simulation worker reported a technical failure");
        this.#publishTechnicalFailure(message.failure);
        if (this.#view) {
          await this.#persistence.recordFailure(this.#view.worldId, message.failure);
        }
        return;
    }
  }

  async #sendDecisionOutcome(outcome: CoordinatedDecision): Promise<void> {
    if (outcome.type === "cancelled") return;
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

  async #retryTechnicalFailure(
    command: Extract<WorldCommand, { type: "retry_technical_failure" }>,
  ): Promise<void> {
    const view = this.#view;
    const failure = view?.technicalFailure;
    if (
      !view ||
      view.worldId !== command.worldId ||
      view.mode !== "TECHNICALLY_BLOCKED" ||
      !failure ||
      failure.id !== command.failureId ||
      failure.category !== "persistence" ||
      !failure.retryable
    ) {
      throw new Error(`Persistence failure ${command.failureId} is not retryable`);
    }

    await this.waitForIdle();
    try {
      await this.#persistence.retryFailed();
    } catch (error) {
      try {
        this.#onError(error);
      } catch {
        // Logging must not replace the retry error.
      }
      throw error;
    }

    try {
      if (this.#failedCheckpointId) {
        const checkpointId = this.#failedCheckpointId;
        try {
          await this.#worker.send({ type: "checkpoint_committed", checkpointId });
        } catch (error) {
          await this.#publishHostFailure({
            error,
            category: "worker",
            retryable: false,
            blockWorker: false,
          });
          throw error;
        }
        this.#failedCheckpointId = null;
      }
      this.#terminalFailure = null;
      await this.#worker.send({ type: "world_command", command });
      for (const [requestId, outcome] of this.#pendingDecisionOutcomes) {
        await this.#sendDecisionOutcome(outcome);
        this.#pendingDecisionOutcomes.delete(requestId);
        this.#pendingDecisionMessages.delete(requestId);
      }
      for (const [requestId, message] of this.#pendingDecisionMessages) {
        if (this.#pendingDecisionOutcomes.has(requestId)) continue;
        this.#dispatch(message);
      }
    } catch (error) {
      await this.#publishHostFailure({
        error,
        category: "worker",
        retryable: false,
        blockWorker: false,
      });
      throw error;
    }
  }

  async #handleApplicationFailure(
    message: WorkerToHostMessage,
    error: unknown,
  ): Promise<void> {
    const rootError = error instanceof DecisionPersistenceError ? error.cause : error;
    const persistenceMessage =
      message.type === "checkpoint_ready" ||
      message.type === "technical_failure" ||
      error instanceof DecisionPersistenceError;
    await this.#publishHostFailure({
      error: rootError,
      category: persistenceMessage ? "persistence" : "worker",
      retryable: persistenceMessage,
      blockWorker: persistenceMessage,
      ...(message.type === "decision_requested"
        ? { requestId: message.request.requestId }
        : {}),
    });
  }

  async #publishHostFailure(options: {
    readonly error: unknown;
    readonly category: "persistence" | "protocol" | "worker";
    readonly retryable: boolean;
    readonly blockWorker: boolean;
    readonly requestId?: string;
    readonly persistWorldId?: WorldView["worldId"];
  }): Promise<void> {
    try {
      this.#onError(options.error);
    } catch {
      // Logging must not create a second application failure.
    }
    this.#decisions.cancelAll("Session blocked by a technical failure");
    if (
      this.#terminalFailure &&
      (options.category === "persistence" || this.#terminalFailure.category !== "persistence")
    ) {
      return;
    }
    this.#failureSequence += 1;
    const detail = options.error instanceof Error
      ? options.error.message
      : String(options.error);
    const failure = TechnicalFailureSchema.parse({
      id: `failure:host:${this.#failureSequence}`,
      category: options.category,
      message: detail.slice(0, 2_000),
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      retryable: options.retryable,
      occurredAtRealTime: this.#now(),
    });
    if (options.persistWorldId) {
      try {
        await this.#persistence.recordFailure(options.persistWorldId, failure);
      } catch (error) {
        await this.#publishHostFailure({
          error,
          category: "persistence",
          retryable: true,
          blockWorker: true,
        });
        return;
      }
    }
    this.#terminalFailure = failure;
    if (options.blockWorker) {
      try {
        await this.#worker.send({ type: "technical_failure", failure });
      } catch (sendError) {
        try {
          this.#onError(sendError);
        } catch {
          // Logging must not hide the original persistence failure.
        }
        this.#failureSequence += 1;
        const sendDetail = sendError instanceof Error
          ? sendError.message
          : String(sendError);
        this.#publishTechnicalFailure(
          TechnicalFailureSchema.parse({
            id: `failure:host:${this.#failureSequence}`,
            category: "worker",
            message: sendDetail.slice(0, 2_000),
            retryable: false,
            occurredAtRealTime: this.#now(),
          }),
        );
        return;
      }
    }
    this.#publishTechnicalFailure(failure);
  }

  #publishTechnicalFailure(
    failure: ReturnType<typeof TechnicalFailureSchema.parse>,
    baseView: WorldView | null = this.#view,
  ): void {
    this.#terminalFailure = failure;
    if (!baseView) return;
    this.#publishView(
      WorldViewSchema.parse({
        ...baseView,
        revision: baseView.revision + 1,
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
