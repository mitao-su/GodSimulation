import type {
  DomainEvent,
  TechnicalFailure,
  WorldId,
  WorldSnapshot,
} from "@god-sim/protocol";

import type { ModelCallRecord } from "./model-call-record";
import type { PluginLockRecord } from "./plugin-lock-record";

export interface RestoredTimeline {
  readonly snapshot: WorldSnapshot | null;
  readonly events: readonly DomainEvent[];
}

export interface TimelineStore {
  appendEvents(events: readonly DomainEvent[]): Promise<void>;
  saveSnapshot(snapshot: WorldSnapshot): Promise<void>;
  savePluginLock(record: PluginLockRecord): Promise<void>;
  saveModelCall(record: ModelCallRecord): Promise<void>;
  recordFailure(worldId: WorldId, failure: TechnicalFailure): Promise<void>;
  loadLatest(worldId: WorldId): Promise<RestoredTimeline>;
  close(): Promise<void>;
}

