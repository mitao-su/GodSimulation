import type {
  AgentId,
  EventId,
  SimulationRules,
  WorldId,
} from "@god-sim/protocol";

export type ArchiveMemoryImportance = keyof SimulationRules["memory"]["importance"];

export interface ArchiveMemoryScope {
  readonly worldId: WorldId;
  readonly branchId: string;
  readonly agentId: AgentId;
}

export interface ArchiveMemoryCollectionScope extends ArchiveMemoryScope {
  readonly consolidationCycleId: string;
}

export interface ArchivedMemoryDraft {
  readonly memoryId: string;
  readonly consolidationCycleId: string;
  readonly content: string;
  readonly sourceEventIds: readonly EventId[];
  readonly formedAtTick: number;
  readonly archivedAtTick: number;
  readonly importance: ArchiveMemoryImportance;
  readonly importanceReason: string;
}

export interface ArchivedMemory extends ArchivedMemoryDraft, ArchiveMemoryScope {}

export interface ArchiveMemoryImportancePolicy {
  readonly initialStrength: number;
  readonly halfLifeDays: number;
}

export interface ArchiveMemoryDecayPolicy {
  readonly ticksPerGameDay: number;
  readonly deletionThreshold: number;
  readonly importance: Readonly<
    Record<ArchiveMemoryImportance, ArchiveMemoryImportancePolicy>
  >;
}

export interface ArchiveMemoryRankingWeights {
  readonly semanticSimilarity: number;
  readonly keywordMatch: number;
  readonly currentStrength: number;
}

export interface ArchiveMemoryEncoderLock {
  readonly encoderId: string;
  readonly encoderVersion: string;
  readonly dimension: number;
  readonly normalization: string;
  readonly modelFileIdentity: string;
}

export interface ArchiveMemoryEncoder {
  readonly lock: ArchiveMemoryEncoderLock;
  encode(contents: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export interface ArchiveMemoryEmbedding {
  readonly memoryId: string;
  readonly values: readonly number[];
}

interface ArchiveMemoryIndexStateBase extends ArchiveMemoryScope {
  readonly archiveVersion: number;
  readonly fullTextIndexVersion: number;
  readonly vectorIndexVersion: number;
}

export interface UnconfiguredArchiveMemoryIndexState
  extends ArchiveMemoryIndexStateBase {
  readonly vectorStatus: "unconfigured";
  readonly indexedArchiveVersion: null;
  readonly encoder: null;
}

export interface StaleArchiveMemoryIndexState extends ArchiveMemoryIndexStateBase {
  readonly vectorStatus: "stale";
  readonly indexedArchiveVersion: null;
  readonly encoder: ArchiveMemoryEncoderLock;
}

export interface ReadyArchiveMemoryIndexState extends ArchiveMemoryIndexStateBase {
  readonly vectorStatus: "ready";
  readonly indexedArchiveVersion: number;
  readonly encoder: ArchiveMemoryEncoderLock;
}

export type ArchiveMemoryIndexState =
  | UnconfiguredArchiveMemoryIndexState
  | StaleArchiveMemoryIndexState
  | ReadyArchiveMemoryIndexState;

export interface ArchiveMemoryIndexLock extends ArchiveMemoryScope {
  readonly archiveVersion: number;
  readonly fullTextIndexVersion: number;
  readonly vectorIndexVersion: number;
  readonly encoder: ArchiveMemoryEncoderLock;
}

export interface SaveArchivedMemoriesRequest {
  readonly scope: ArchiveMemoryScope;
  readonly memories: readonly ArchivedMemoryDraft[];
}

export interface PrepareArchiveMemoryVectorIndexRequest {
  readonly scope: ArchiveMemoryScope;
  readonly encoder: ArchiveMemoryEncoderLock;
}

export interface RebuildArchiveMemoryVectorIndexRequest
  extends PrepareArchiveMemoryVectorIndexRequest {
  readonly expectedArchiveVersion: number;
  readonly embeddings: readonly ArchiveMemoryEmbedding[];
}

export interface PruneArchivedMemoriesRequest {
  readonly scope: ArchiveMemoryScope;
  readonly atTick: number;
  readonly decay: ArchiveMemoryDecayPolicy;
}

export interface PruneArchivedMemoriesResult {
  readonly deletedMemoryIds: readonly string[];
  readonly indexState: ArchiveMemoryIndexState | null;
}

export interface SearchArchivedMemoriesRequest {
  readonly scope: ArchiveMemoryScope;
  readonly query: string;
  readonly queryEmbedding: {
    readonly encoder: ArchiveMemoryEncoderLock;
    readonly values: readonly number[];
  };
  readonly indexLock: ArchiveMemoryIndexLock;
  readonly atTick: number;
  readonly decay: ArchiveMemoryDecayPolicy;
  readonly rankingWeights: ArchiveMemoryRankingWeights;
}

export interface ArchiveMemoryFullTextHit {
  readonly memory: ArchivedMemory;
  readonly keywordMatch: number;
}

export interface ArchiveMemoryVectorHit {
  readonly memory: ArchivedMemory;
  readonly semanticSimilarity: number;
}

export interface MergedArchiveMemoryHit {
  readonly memory: ArchivedMemory;
  readonly keywordMatch: number;
  readonly semanticSimilarity: number;
}

export interface ArchiveMemoryRankingCandidate extends MergedArchiveMemoryHit {
  readonly currentStrength: number;
}

export interface RankedArchiveMemory extends ArchiveMemoryRankingCandidate {
  readonly score: number;
}

export interface ArchiveMemoryStore {
  saveArchivedMemories(
    request: SaveArchivedMemoriesRequest,
  ): Promise<ArchiveMemoryIndexState>;
  loadArchivedMemories(
    scope: ArchiveMemoryCollectionScope,
  ): Promise<readonly ArchivedMemory[]>;
  pruneArchivedMemories(
    request: PruneArchivedMemoriesRequest,
  ): Promise<PruneArchivedMemoriesResult>;
  getArchiveMemoryIndexState(
    scope: ArchiveMemoryScope,
  ): Promise<ArchiveMemoryIndexState | null>;
  prepareArchiveMemoryVectorIndex(
    request: PrepareArchiveMemoryVectorIndexRequest,
  ): Promise<ArchiveMemoryIndexState>;
  rebuildArchiveMemoryVectorIndex(
    request: RebuildArchiveMemoryVectorIndexRequest,
  ): Promise<ArchiveMemoryIndexState>;
  searchArchivedMemories(
    request: SearchArchivedMemoriesRequest,
  ): Promise<readonly RankedArchiveMemory[]>;
}

export class ArchiveMemoryVectorIndexNotReadyError extends Error {
  constructor(scope: ArchiveMemoryScope) {
    super(
      `Archive memory vector index is not ready for ${scope.worldId}/${scope.branchId}/${scope.agentId}`,
    );
    this.name = "ArchiveMemoryVectorIndexNotReadyError";
  }
}

export class ArchiveMemoryIndexLockConflictError extends Error {
  constructor(scope: ArchiveMemoryScope) {
    super(
      `Archive memory index lock is stale for ${scope.worldId}/${scope.branchId}/${scope.agentId}`,
    );
    this.name = "ArchiveMemoryIndexLockConflictError";
  }
}

export function lockArchiveMemoryIndex(
  state: ArchiveMemoryIndexState,
): ArchiveMemoryIndexLock {
  if (state.vectorStatus !== "ready") {
    throw new ArchiveMemoryVectorIndexNotReadyError(state);
  }
  return {
    worldId: state.worldId,
    branchId: state.branchId,
    agentId: state.agentId,
    archiveVersion: state.archiveVersion,
    fullTextIndexVersion: state.fullTextIndexVersion,
    vectorIndexVersion: state.vectorIndexVersion,
    encoder: state.encoder,
  };
}
