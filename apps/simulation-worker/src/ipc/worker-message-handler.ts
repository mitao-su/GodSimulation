import {
  HostToWorkerMessageSchema,
  TechnicalFailureSchema,
  WorkerToHostMessageSchema,
  type HostToWorkerMessage,
  type PluginLock,
  type WorkerToHostMessage,
} from "@god-sim/protocol";
import type { GamePlugin } from "@god-sim/plugin-sdk";

import { WorldSession } from "../runtime/world-session";

export interface WorkerMessageHandlerOptions {
  readonly plugins: readonly GamePlugin[];
  readonly pluginLock: PluginLock;
  readonly emit: (message: WorkerToHostMessage) => void;
  readonly onShutdown: () => void;
  readonly now?: () => string;
}

export class WorkerMessageHandler {
  readonly #plugins: readonly GamePlugin[];
  readonly #pluginLock: PluginLock;
  readonly #emitRaw: (message: WorkerToHostMessage) => void;
  readonly #onShutdown: () => void;
  readonly #now: () => string;
  #session: WorldSession | null = null;
  #failureSequence = 0;
  #shutdownCompleted = false;

  constructor(options: WorkerMessageHandlerOptions) {
    this.#plugins = options.plugins;
    this.#pluginLock = options.pluginLock;
    this.#emitRaw = options.emit;
    this.#onShutdown = options.onShutdown;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  handle(messageValue: unknown): void {
    const parsed = HostToWorkerMessageSchema.safeParse(messageValue);
    if (!parsed.success) {
      this.#emitFailure(parsed.error, "protocol");
      return;
    }
    try {
      const message = parsed.data;
      if (message.type === "initialize") {
        this.#initialize(message);
        return;
      }
      if (message.type === "shutdown" && !this.#session) {
        this.#completeShutdown();
        return;
      }
      if (!this.#session) throw new Error("Simulation worker is not initialized");
      const result = this.#session.handle(message);
      if (result.shutdownReady) this.#completeShutdown();
    } catch (error) {
      this.#emitFailure(error, "worker");
    }
  }

  tick(): void {
    try {
      this.#session?.tick();
    } catch (error) {
      this.#emitFailure(error, "worker");
    }
  }

  #initialize(message: Extract<HostToWorkerMessage, { type: "initialize" }>): void {
    if (this.#session) throw new Error("Simulation worker is already initialized");
    if (message.pluginLock.hash !== this.#pluginLock.hash) {
      throw new Error(
        `Plugin lock mismatch: expected ${message.pluginLock.hash}, found ${this.#pluginLock.hash}`,
      );
    }
    this.#session = new WorldSession({
      worldDefinition: message.worldDefinition,
      plugins: this.#plugins,
      pluginLock: this.#pluginLock,
      reviewRequired: message.reviewRequired,
      deterministicSeed: message.deterministicSeed,
      ...(message.restoredSnapshot === undefined
        ? {}
        : { restoredSnapshot: message.restoredSnapshot }),
      emit: (outgoing) => this.#emit(outgoing),
    });
    this.#emit({ type: "worker_ready", protocolVersion: 1 });
    this.#session.start();
  }

  #emit(message: WorkerToHostMessage): void {
    this.#emitRaw(WorkerToHostMessageSchema.parse(message));
  }

  #completeShutdown(): void {
    if (this.#shutdownCompleted) return;
    this.#shutdownCompleted = true;
    this.#onShutdown();
  }

  #emitFailure(error: unknown, category: "protocol" | "worker"): void {
    this.#failureSequence += 1;
    const message = error instanceof Error ? error.message : String(error);
    const failure = TechnicalFailureSchema.parse({
      id: `failure:${category}:${this.#failureSequence}`,
      category,
      message: message.slice(0, 2_000),
      retryable: false,
      occurredAtRealTime: this.#now(),
    });
    this.#session?.block(failure);
    this.#emit({ type: "technical_failure", failure });
  }
}
