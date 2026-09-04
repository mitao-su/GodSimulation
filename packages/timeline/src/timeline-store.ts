import type {
  CheckpointId,
  DomainEvent,
  TechnicalFailure,
  WorldId,
  WorldSnapshot,
  WorldSnapshotCurrent,
} from "@god-sim/protocol";

import type { ModelCallRecord } from "./model-call-record";
import type { PluginLockRecord } from "./plugin-lock-record";
import type { ArchiveMemoryStore } from "./archive-memory";

export interface RestoredTimeline {
  readonly snapshot: WorldSnapshot | null;
  readonly events: readonly DomainEvent[];
}

export interface WorldCheckpoint {
  readonly checkpointId: CheckpointId;
  readonly events: readonly DomainEvent[];
  readonly snapshot: WorldSnapshotCurrent;
}

export interface TimelineStore {
  commitCheckpoint(checkpoint: WorldCheckpoint): Promise<void>;
  savePluginLock(record: PluginLockRecord): Promise<void>;
  saveModelCall(record: ModelCallRecord): Promise<void>;
  recordFailure(worldId: WorldId, failure: TechnicalFailure): Promise<void>;
  loadLatest(worldId: WorldId): Promise<RestoredTimeline>;
  close(): Promise<void>;
}

// TODO(W5-IF): 跨进程调用方式与 DTO 归属由 L5 讨论门禁决定；此处仅组合存储领域能力。
export interface ArchiveTimelineStore extends TimelineStore, ArchiveMemoryStore {}
