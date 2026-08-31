import type {
  TechnicalFailure,
  WorldId,
} from "@god-sim/protocol";
import type {
  ModelCallRecord,
  PluginLockRecord,
  TimelineStore,
  WorldCheckpoint,
} from "@god-sim/timeline";

export class PersistenceWriter {
  readonly #store: TimelineStore | null;
  #tail: Promise<void> = Promise.resolve();
  #blocked = false;
  #blockedError: unknown;
  readonly #retryQueue: Array<() => Promise<void>> = [];

  constructor(store: TimelineStore | null) {
    this.#store = store;
  }

  static inMemory(): PersistenceWriter {
    return new PersistenceWriter(null);
  }

  commitCheckpoint(checkpoint: WorldCheckpoint): Promise<void> {
    return this.#enqueue(
      () => this.#store?.commitCheckpoint(checkpoint) ?? Promise.resolve(),
    );
  }

  savePluginLock(record: PluginLockRecord): Promise<void> {
    return this.#enqueue(() => this.#store?.savePluginLock(record) ?? Promise.resolve());
  }

  saveModelCall(record: ModelCallRecord): Promise<void> {
    return this.#enqueue(() => this.#store?.saveModelCall(record) ?? Promise.resolve());
  }

  recordFailure(worldId: WorldId, failure: TechnicalFailure): Promise<void> {
    return this.#enqueue(() => this.#store?.recordFailure(worldId, failure) ?? Promise.resolve());
  }

  async flush(): Promise<void> {
    await this.#tail;
  }

  retryFailed(): Promise<void> {
    const retry = this.#tail.then(async () => {
      if (!this.#blocked) return;
      while (this.#retryQueue.length > 0) {
        const operation = this.#retryQueue[0]!;
        try {
          await operation();
        } catch (error) {
          this.#blocked = true;
          this.#blockedError = error;
          throw error;
        }
        this.#retryQueue.shift();
      }
      this.#blocked = false;
      this.#blockedError = undefined;
    });
    this.#tail = retry.catch(() => undefined);
    return retry;
  }

  async close(): Promise<void> {
    await this.flush();
    const unsavedOperationCount = this.#retryQueue.length;
    const blockedError = this.#blockedError;
    await this.#store?.close();
    if (unsavedOperationCount > 0) {
      throw new Error(
        `${unsavedOperationCount} unsaved persistence operation${unsavedOperationCount === 1 ? "" : "s"} remained when the store closed`,
        { cause: blockedError },
      );
    }
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.#tail.then(async () => {
      if (this.#blocked) {
        this.#retryQueue.push(operation);
        throw new Error("Persistence is blocked until an explicit retry", {
          cause: this.#blockedError,
        });
      }
      try {
        await operation();
      } catch (error) {
        this.#blocked = true;
        this.#blockedError = error;
        this.#retryQueue.push(operation);
        throw error;
      }
    });
    this.#tail = next.catch(() => undefined);
    return next;
  }
}
