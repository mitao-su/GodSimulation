import type {
  DomainEvent,
  TechnicalFailure,
  WorldId,
  WorldSnapshot,
} from "@god-sim/protocol";
import type {
  ModelCallRecord,
  PluginLockRecord,
  TimelineStore,
} from "@god-sim/timeline";

export class PersistenceWriter {
  readonly #store: TimelineStore | null;
  #tail: Promise<void> = Promise.resolve();

  constructor(store: TimelineStore | null) {
    this.#store = store;
  }

  static inMemory(): PersistenceWriter {
    return new PersistenceWriter(null);
  }

  appendEvents(events: readonly DomainEvent[]): Promise<void> {
    return this.#enqueue(() => this.#store?.appendEvents(events) ?? Promise.resolve());
  }

  saveSnapshot(snapshot: WorldSnapshot): Promise<void> {
    return this.#enqueue(() => this.#store?.saveSnapshot(snapshot) ?? Promise.resolve());
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

  async close(): Promise<void> {
    await this.flush();
    await this.#store?.close();
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.#tail.then(operation);
    this.#tail = next.catch(() => undefined);
    return next;
  }
}
