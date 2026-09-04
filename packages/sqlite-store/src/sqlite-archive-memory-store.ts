import { sql, type Kysely, type Selectable, type Transaction } from "kysely";

import { AgentIdSchema, EventIdSchema, WorldIdSchema } from "@god-sim/protocol";
import {
  ArchiveMemoryIndexLockConflictError,
  ArchiveMemoryVectorIndexNotReadyError,
  calculateArchivedMemoryStrength,
  cosineSimilarity,
  mergeArchiveMemoryHits,
  normalizeArchivedMemoryStrength,
  normalizeCosineSimilarity,
  rankArchiveMemoryCandidates,
  sameArchiveMemoryEncoderLock,
  shouldDeleteArchivedMemory,
  type ArchivedMemory,
  type ArchivedMemoryDraft,
  type ArchiveMemoryCollectionScope,
  type ArchiveMemoryEmbedding,
  type ArchiveMemoryEncoderLock,
  type ArchiveMemoryFullTextHit,
  type ArchiveMemoryIndexLock,
  type ArchiveMemoryIndexState,
  type ArchiveMemoryScope,
  type ArchiveMemoryStore,
  type ArchiveMemoryVectorHit,
  type PrepareArchiveMemoryVectorIndexRequest,
  type PruneArchivedMemoriesRequest,
  type PruneArchivedMemoriesResult,
  type RankedArchiveMemory,
  type RebuildArchiveMemoryVectorIndexRequest,
  type SaveArchivedMemoriesRequest,
  type SearchArchivedMemoriesRequest,
} from "@god-sim/timeline";

import type {
  ArchivedMemoryRow,
  ArchiveMemoryCollectionRow,
  ArchiveMemoryVectorRow,
  DatabaseSchema,
} from "./database-schema";

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;
type CollectionRow = Selectable<ArchiveMemoryCollectionRow>;
type MemoryRow = Selectable<ArchivedMemoryRow>;

const STABLE_STORAGE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const MAX_STABLE_STORAGE_ID_LENGTH = 128;
const IMPORTANCE_LEVELS = new Set(["critical", "high", "normal", "low"]);

function compareStableIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertStableStorageId(value: string, name: string): void {
  if (
    value.length === 0 ||
    value.length > MAX_STABLE_STORAGE_ID_LENGTH ||
    !STABLE_STORAGE_ID.test(value)
  ) {
    throw new Error(`${name} must be a stable identifier`);
  }
}

function assertNonempty(value: string, name: string): void {
  if (value.trim().length === 0) throw new Error(`${name} must not be empty`);
}

function assertNonnegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative integer`);
  }
}

function validateScope(scope: ArchiveMemoryScope): ArchiveMemoryScope {
  WorldIdSchema.parse(scope.worldId);
  AgentIdSchema.parse(scope.agentId);
  assertStableStorageId(scope.branchId, "branchId");
  return scope;
}

function validateEncoderLock(
  encoder: ArchiveMemoryEncoderLock,
): ArchiveMemoryEncoderLock {
  assertNonempty(encoder.encoderId, "encoderId");
  assertNonempty(encoder.encoderVersion, "encoderVersion");
  assertNonempty(encoder.normalization, "normalization");
  assertNonempty(encoder.modelFileIdentity, "modelFileIdentity");
  if (!Number.isInteger(encoder.dimension) || encoder.dimension <= 0) {
    throw new Error("encoder dimension must be a positive integer");
  }
  return encoder;
}

function validateVector(
  values: readonly number[],
  encoder: ArchiveMemoryEncoderLock,
): readonly number[] {
  if (values.length !== encoder.dimension) {
    throw new Error(
      `Embedding dimension ${values.length} does not match encoder dimension ${encoder.dimension}`,
    );
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Embedding values must be finite");
  }
  if (values.every((value) => value === 0)) {
    throw new Error("Embedding must have a nonzero norm");
  }
  return values;
}

function normalizeMemoryDraft(memory: ArchivedMemoryDraft): ArchivedMemoryDraft {
  assertStableStorageId(memory.memoryId, "memoryId");
  assertStableStorageId(memory.consolidationCycleId, "consolidationCycleId");
  assertNonempty(memory.content, "memory content");
  assertNonempty(memory.importanceReason, "importanceReason");
  assertNonnegativeInteger(memory.formedAtTick, "formedAtTick");
  assertNonnegativeInteger(memory.archivedAtTick, "archivedAtTick");
  if (memory.formedAtTick > memory.archivedAtTick) {
    throw new Error("formedAtTick must not be after archivedAtTick");
  }
  if (!IMPORTANCE_LEVELS.has(memory.importance)) {
    throw new Error(`Unknown archive memory importance ${memory.importance}`);
  }
  if (memory.sourceEventIds.length === 0) {
    throw new Error("Archived memory must reference at least one source Event");
  }
  const sourceEventIds = memory.sourceEventIds
    .map((sourceEventId) => EventIdSchema.parse(sourceEventId))
    .sort(compareStableIds);
  if (new Set(sourceEventIds).size !== sourceEventIds.length) {
    throw new Error("Archived memory source Event IDs must be unique");
  }
  return { ...memory, sourceEventIds };
}

function parseSourceEventIds(value: string): ArchivedMemory["sourceEventIds"] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Stored archive memory sources are invalid");
  }
  const sourceEventIds = parsed.map((sourceEventId) =>
    EventIdSchema.parse(sourceEventId),
  );
  if (
    new Set(sourceEventIds).size !== sourceEventIds.length ||
    sourceEventIds.some(
      (sourceEventId, index) =>
        index > 0 && compareStableIds(sourceEventIds[index - 1]!, sourceEventId) >= 0,
    )
  ) {
    throw new Error("Stored archive memory sources are not canonical");
  }
  return sourceEventIds;
}

function memoryFromRow(row: MemoryRow): ArchivedMemory {
  if (!IMPORTANCE_LEVELS.has(row.importance)) {
    throw new Error(`Stored archive memory importance is invalid: ${row.importance}`);
  }
  return {
    worldId: WorldIdSchema.parse(row.world_id),
    branchId: row.branch_id,
    agentId: AgentIdSchema.parse(row.agent_id),
    consolidationCycleId: row.consolidation_cycle_id,
    memoryId: row.memory_id,
    content: row.content,
    sourceEventIds: parseSourceEventIds(row.source_event_ids_json),
    formedAtTick: row.formed_at_tick,
    archivedAtTick: row.archived_at_tick,
    importance: row.importance as ArchivedMemory["importance"],
    importanceReason: row.importance_reason,
  };
}

function memoryRowMatches(row: MemoryRow, memory: ArchivedMemoryDraft): boolean {
  return (
    row.consolidation_cycle_id === memory.consolidationCycleId &&
    row.content === memory.content &&
    row.source_event_ids_json === JSON.stringify(memory.sourceEventIds) &&
    row.formed_at_tick === memory.formedAtTick &&
    row.archived_at_tick === memory.archivedAtTick &&
    row.importance === memory.importance &&
    row.importance_reason === memory.importanceReason
  );
}

function encoderFromRow(row: CollectionRow): ArchiveMemoryEncoderLock | null {
  const values = [
    row.encoder_id,
    row.encoder_version,
    row.encoder_dimension,
    row.encoder_normalization,
    row.encoder_model_file_identity,
  ];
  if (values.every((value) => value === null)) return null;
  if (values.some((value) => value === null)) {
    throw new Error("Archive memory encoder lock is only partially stored");
  }
  return validateEncoderLock({
    encoderId: row.encoder_id!,
    encoderVersion: row.encoder_version!,
    dimension: row.encoder_dimension!,
    normalization: row.encoder_normalization!,
    modelFileIdentity: row.encoder_model_file_identity!,
  });
}

function stateFromRow(row: CollectionRow): ArchiveMemoryIndexState {
  const base = {
    worldId: WorldIdSchema.parse(row.world_id),
    branchId: row.branch_id,
    agentId: AgentIdSchema.parse(row.agent_id),
    archiveVersion: row.archive_version,
    fullTextIndexVersion: row.full_text_index_version,
    vectorIndexVersion: row.vector_index_version,
  };
  const encoder = encoderFromRow(row);
  if (row.vector_status === "unconfigured") {
    if (encoder !== null || row.vector_archive_version !== null) {
      throw new Error("Unconfigured archive memory index contains a vector lock");
    }
    return {
      ...base,
      vectorStatus: "unconfigured",
      indexedArchiveVersion: null,
      encoder: null,
    };
  }
  if (encoder === null) {
    throw new Error("Configured archive memory index has no encoder lock");
  }
  if (row.vector_status === "stale") {
    if (row.vector_archive_version !== null) {
      throw new Error("Stale archive memory index claims an indexed archive version");
    }
    return {
      ...base,
      vectorStatus: "stale",
      indexedArchiveVersion: null,
      encoder,
    };
  }
  if (row.vector_status === "ready") {
    if (row.vector_archive_version !== row.archive_version) {
      throw new Error("Ready archive memory index does not cover the current archive");
    }
    return {
      ...base,
      vectorStatus: "ready",
      indexedArchiveVersion: row.vector_archive_version,
      encoder,
    };
  }
  throw new Error(`Unknown archive memory vector status ${row.vector_status}`);
}

async function ensureWorld(
  db: DatabaseExecutor,
  worldId: string,
): Promise<void> {
  await db
    .insertInto("worlds")
    .values({ world_id: worldId, created_at: new Date().toISOString() })
    .onConflict((conflict) => conflict.column("world_id").doNothing())
    .execute();
}

async function ensureCollection(
  db: DatabaseExecutor,
  scope: ArchiveMemoryScope,
): Promise<CollectionRow> {
  await ensureWorld(db, scope.worldId);
  await db
    .insertInto("archive_memory_collections")
    .values({
      world_id: scope.worldId,
      branch_id: scope.branchId,
      agent_id: scope.agentId,
      archive_version: 0,
      full_text_index_version: 0,
      vector_index_version: 0,
      vector_status: "unconfigured",
      vector_archive_version: null,
      encoder_id: null,
      encoder_version: null,
      encoder_dimension: null,
      encoder_normalization: null,
      encoder_model_file_identity: null,
    })
    .onConflict((conflict) =>
      conflict.columns(["world_id", "branch_id", "agent_id"]).doNothing(),
    )
    .execute();
  return selectCollection(db, scope).then((row) => row!);
}

async function selectCollection(
  db: DatabaseExecutor,
  scope: ArchiveMemoryScope,
): Promise<CollectionRow | undefined> {
  return db
    .selectFrom("archive_memory_collections")
    .selectAll()
    .where("world_id", "=", scope.worldId)
    .where("branch_id", "=", scope.branchId)
    .where("agent_id", "=", scope.agentId)
    .executeTakeFirst();
}

async function deleteScopeVectors(
  db: DatabaseExecutor,
  scope: ArchiveMemoryScope,
): Promise<void> {
  await db
    .deleteFrom("archive_memory_vectors")
    .where("world_id", "=", scope.worldId)
    .where("branch_id", "=", scope.branchId)
    .where("agent_id", "=", scope.agentId)
    .execute();
}

async function countScopeMemories(
  db: DatabaseExecutor,
  scope: ArchiveMemoryScope,
): Promise<number> {
  const row = await db
    .selectFrom("archived_memories")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("world_id", "=", scope.worldId)
    .where("branch_id", "=", scope.branchId)
    .where("agent_id", "=", scope.agentId)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

async function updateAfterArchiveMutation(
  db: DatabaseExecutor,
  scope: ArchiveMemoryScope,
  previous: CollectionRow,
  vectorsRemainComplete: boolean,
): Promise<CollectionRow> {
  const archiveVersion = previous.archive_version + 1;
  const hasEncoder = encoderFromRow(previous) !== null;
  if (!vectorsRemainComplete) await deleteScopeVectors(db, scope);
  await db
    .updateTable("archive_memory_collections")
    .set({
      archive_version: archiveVersion,
      full_text_index_version: previous.full_text_index_version + 1,
      vector_index_version: hasEncoder
        ? previous.vector_index_version + 1
        : previous.vector_index_version,
      vector_status: hasEncoder
        ? vectorsRemainComplete
          ? "ready"
          : "stale"
        : "unconfigured",
      vector_archive_version:
        hasEncoder && vectorsRemainComplete ? archiveVersion : null,
    })
    .where("world_id", "=", scope.worldId)
    .where("branch_id", "=", scope.branchId)
    .where("agent_id", "=", scope.agentId)
    .executeTakeFirstOrThrow();
  return selectCollection(db, scope).then((row) => row!);
}

function assertEmbeddingCoverage(
  memoryIds: readonly string[],
  embeddings: readonly ArchiveMemoryEmbedding[],
  encoder: ArchiveMemoryEncoderLock,
): ReadonlyMap<string, readonly number[]> {
  const byMemoryId = new Map<string, readonly number[]>();
  for (const embedding of embeddings) {
    assertStableStorageId(embedding.memoryId, "embedding memoryId");
    if (byMemoryId.has(embedding.memoryId)) {
      throw new Error(`Duplicate embedding for ${embedding.memoryId}`);
    }
    byMemoryId.set(embedding.memoryId, validateVector(embedding.values, encoder));
  }
  const expectedIds = [...memoryIds].sort(compareStableIds);
  const actualIds = [...byMemoryId.keys()].sort(compareStableIds);
  if (
    expectedIds.length !== actualIds.length ||
    expectedIds.some((memoryId, index) => memoryId !== actualIds[index])
  ) {
    throw new Error("Vector index rebuild must cover every archived memory exactly once");
  }
  return byMemoryId;
}

function assertIndexLock(
  state: ArchiveMemoryIndexState,
  lock: ArchiveMemoryIndexLock,
): asserts state is Extract<ArchiveMemoryIndexState, { vectorStatus: "ready" }> {
  if (
    state.vectorStatus !== "ready" ||
    state.worldId !== lock.worldId ||
    state.branchId !== lock.branchId ||
    state.agentId !== lock.agentId ||
    state.archiveVersion !== lock.archiveVersion ||
    state.fullTextIndexVersion !== lock.fullTextIndexVersion ||
    state.vectorIndexVersion !== lock.vectorIndexVersion ||
    !sameArchiveMemoryEncoderLock(state.encoder, lock.encoder)
  ) {
    throw new ArchiveMemoryIndexLockConflictError(state);
  }
}

function extractFullTextTerms(query: string): readonly string[] {
  const terms = query.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(terms)];
}

function vectorFromRow(
  row: Selectable<ArchiveMemoryVectorRow>,
  encoder: ArchiveMemoryEncoderLock,
): readonly number[] {
  const storedEncoder = validateEncoderLock({
    encoderId: row.encoder_id,
    encoderVersion: row.encoder_version,
    dimension: row.encoder_dimension,
    normalization: row.encoder_normalization,
    modelFileIdentity: row.encoder_model_file_identity,
  });
  if (!sameArchiveMemoryEncoderLock(storedEncoder, encoder)) {
    throw new Error(`Stored vector for ${row.memory_id} has an incompatible encoder lock`);
  }
  const parsed: unknown = JSON.parse(row.vector_json);
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "number")) {
    throw new Error(`Stored vector for ${row.memory_id} is invalid`);
  }
  return validateVector(parsed, encoder);
}

export class SqliteArchiveMemoryStore implements ArchiveMemoryStore {
  readonly #db: Kysely<DatabaseSchema>;

  constructor(db: Kysely<DatabaseSchema>) {
    this.#db = db;
  }

  async saveArchivedMemories(
    request: SaveArchivedMemoriesRequest,
  ): Promise<ArchiveMemoryIndexState> {
    const scope = validateScope(request.scope);
    if (request.memories.length === 0) {
      throw new Error("At least one archived memory is required");
    }
    const memories = request.memories.map(normalizeMemoryDraft);
    if (new Set(memories.map((memory) => memory.memoryId)).size !== memories.length) {
      throw new Error("Archived memory batch contains duplicate memory IDs");
    }

    return this.#db.transaction().execute(async (transaction) => {
      let collection = await ensureCollection(transaction, scope);
      let inserted = 0;
      for (const memory of memories) {
        const stored = await transaction
          .selectFrom("archived_memories")
          .selectAll()
          .where("world_id", "=", scope.worldId)
          .where("branch_id", "=", scope.branchId)
          .where("agent_id", "=", scope.agentId)
          .where("memory_id", "=", memory.memoryId)
          .executeTakeFirst();
        if (stored) {
          if (!memoryRowMatches(stored, memory)) {
            throw new Error(`Archived memory replay conflicts for ${memory.memoryId}`);
          }
          continue;
        }
        await transaction
          .insertInto("archived_memories")
          .values({
            world_id: scope.worldId,
            branch_id: scope.branchId,
            agent_id: scope.agentId,
            consolidation_cycle_id: memory.consolidationCycleId,
            memory_id: memory.memoryId,
            content: memory.content,
            source_event_ids_json: JSON.stringify(memory.sourceEventIds),
            formed_at_tick: memory.formedAtTick,
            archived_at_tick: memory.archivedAtTick,
            importance: memory.importance,
            importance_reason: memory.importanceReason,
          })
          .executeTakeFirstOrThrow();
        inserted += 1;
      }
      if (inserted > 0) {
        collection = await updateAfterArchiveMutation(
          transaction,
          scope,
          collection,
          false,
        );
      }
      return stateFromRow(collection);
    });
  }

  async loadArchivedMemories(
    collectionScope: ArchiveMemoryCollectionScope,
  ): Promise<readonly ArchivedMemory[]> {
    const scope = validateScope(collectionScope);
    assertStableStorageId(
      collectionScope.consolidationCycleId,
      "consolidationCycleId",
    );
    const rows = await this.#db
      .selectFrom("archived_memories")
      .selectAll()
      .where("world_id", "=", scope.worldId)
      .where("branch_id", "=", scope.branchId)
      .where("agent_id", "=", scope.agentId)
      .where("consolidation_cycle_id", "=", collectionScope.consolidationCycleId)
      .orderBy("archived_at_tick", "asc")
      .orderBy("memory_id", "asc")
      .execute();
    return rows.map(memoryFromRow);
  }

  async pruneArchivedMemories(
    request: PruneArchivedMemoriesRequest,
  ): Promise<PruneArchivedMemoriesResult> {
    const scope = validateScope(request.scope);
    assertNonnegativeInteger(request.atTick, "atTick");
    return this.#db.transaction().execute(async (transaction) => {
      let collection = await selectCollection(transaction, scope);
      if (!collection) return { deletedMemoryIds: [], indexState: null };
      const rows = await transaction
        .selectFrom("archived_memories")
        .selectAll()
        .where("world_id", "=", scope.worldId)
        .where("branch_id", "=", scope.branchId)
        .where("agent_id", "=", scope.agentId)
        .execute();
      const deletedMemoryIds = rows
        .map(memoryFromRow)
        .filter((memory) =>
          shouldDeleteArchivedMemory(memory, request.atTick, request.decay),
        )
        .map((memory) => memory.memoryId)
        .sort(compareStableIds);
      if (deletedMemoryIds.length === 0) {
        return { deletedMemoryIds, indexState: stateFromRow(collection) };
      }
      await transaction
        .deleteFrom("archived_memories")
        .where("world_id", "=", scope.worldId)
        .where("branch_id", "=", scope.branchId)
        .where("agent_id", "=", scope.agentId)
        .where("memory_id", "in", deletedMemoryIds)
        .execute();
      const remainingCount = await countScopeMemories(transaction, scope);
      collection = await updateAfterArchiveMutation(
        transaction,
        scope,
        collection,
        collection.vector_status === "ready" || remainingCount === 0,
      );
      return { deletedMemoryIds, indexState: stateFromRow(collection) };
    });
  }

  async getArchiveMemoryIndexState(
    scopeValue: ArchiveMemoryScope,
  ): Promise<ArchiveMemoryIndexState | null> {
    const scope = validateScope(scopeValue);
    const row = await selectCollection(this.#db, scope);
    return row ? stateFromRow(row) : null;
  }

  async prepareArchiveMemoryVectorIndex(
    request: PrepareArchiveMemoryVectorIndexRequest,
  ): Promise<ArchiveMemoryIndexState> {
    const scope = validateScope(request.scope);
    const encoder = validateEncoderLock(request.encoder);
    return this.#db.transaction().execute(async (transaction) => {
      let collection = await ensureCollection(transaction, scope);
      const currentEncoder = encoderFromRow(collection);
      if (
        currentEncoder !== null &&
        sameArchiveMemoryEncoderLock(currentEncoder, encoder)
      ) {
        return stateFromRow(collection);
      }
      await deleteScopeVectors(transaction, scope);
      const memoryCount = await countScopeMemories(transaction, scope);
      const ready = memoryCount === 0;
      await transaction
        .updateTable("archive_memory_collections")
        .set({
          vector_index_version: collection.vector_index_version + 1,
          vector_status: ready ? "ready" : "stale",
          vector_archive_version: ready ? collection.archive_version : null,
          encoder_id: encoder.encoderId,
          encoder_version: encoder.encoderVersion,
          encoder_dimension: encoder.dimension,
          encoder_normalization: encoder.normalization,
          encoder_model_file_identity: encoder.modelFileIdentity,
        })
        .where("world_id", "=", scope.worldId)
        .where("branch_id", "=", scope.branchId)
        .where("agent_id", "=", scope.agentId)
        .executeTakeFirstOrThrow();
      collection = (await selectCollection(transaction, scope))!;
      return stateFromRow(collection);
    });
  }

  async rebuildArchiveMemoryVectorIndex(
    request: RebuildArchiveMemoryVectorIndexRequest,
  ): Promise<ArchiveMemoryIndexState> {
    const scope = validateScope(request.scope);
    const encoder = validateEncoderLock(request.encoder);
    assertNonnegativeInteger(request.expectedArchiveVersion, "expectedArchiveVersion");
    return this.#db.transaction().execute(async (transaction) => {
      let collection = await selectCollection(transaction, scope);
      if (!collection || encoderFromRow(collection) === null) {
        throw new ArchiveMemoryVectorIndexNotReadyError(scope);
      }
      if (
        collection.archive_version !== request.expectedArchiveVersion ||
        !sameArchiveMemoryEncoderLock(encoderFromRow(collection)!, encoder)
      ) {
        throw new ArchiveMemoryIndexLockConflictError(scope);
      }
      const memoryRows = await transaction
        .selectFrom("archived_memories")
        .select("memory_id")
        .where("world_id", "=", scope.worldId)
        .where("branch_id", "=", scope.branchId)
        .where("agent_id", "=", scope.agentId)
        .execute();
      const embeddings = assertEmbeddingCoverage(
        memoryRows.map((row) => row.memory_id),
        request.embeddings,
        encoder,
      );
      await deleteScopeVectors(transaction, scope);
      for (const [memoryId, values] of embeddings) {
        await transaction
          .insertInto("archive_memory_vectors")
          .values({
            world_id: scope.worldId,
            branch_id: scope.branchId,
            agent_id: scope.agentId,
            memory_id: memoryId,
            encoder_id: encoder.encoderId,
            encoder_version: encoder.encoderVersion,
            encoder_dimension: encoder.dimension,
            encoder_normalization: encoder.normalization,
            encoder_model_file_identity: encoder.modelFileIdentity,
            vector_json: JSON.stringify(values),
          })
          .executeTakeFirstOrThrow();
      }
      await transaction
        .updateTable("archive_memory_collections")
        .set({
          vector_index_version: collection.vector_index_version + 1,
          vector_status: "ready",
          vector_archive_version: collection.archive_version,
        })
        .where("world_id", "=", scope.worldId)
        .where("branch_id", "=", scope.branchId)
        .where("agent_id", "=", scope.agentId)
        .executeTakeFirstOrThrow();
      collection = (await selectCollection(transaction, scope))!;
      return stateFromRow(collection);
    });
  }

  async searchArchivedMemories(
    request: SearchArchivedMemoriesRequest,
  ): Promise<readonly RankedArchiveMemory[]> {
    const scope = validateScope(request.scope);
    assertNonempty(request.query, "archive memory query");
    assertNonnegativeInteger(request.atTick, "atTick");
    const queryEncoder = validateEncoderLock(request.queryEmbedding.encoder);
    validateVector(request.queryEmbedding.values, queryEncoder);
    if (
      request.indexLock.worldId !== scope.worldId ||
      request.indexLock.branchId !== scope.branchId ||
      request.indexLock.agentId !== scope.agentId ||
      !sameArchiveMemoryEncoderLock(request.indexLock.encoder, queryEncoder)
    ) {
      throw new ArchiveMemoryIndexLockConflictError(scope);
    }

    return this.#db.transaction().execute(async (transaction) => {
      const collection = await selectCollection(transaction, scope);
      if (!collection) throw new ArchiveMemoryVectorIndexNotReadyError(scope);
      const state = stateFromRow(collection);
      assertIndexLock(state, request.indexLock);

      const memoryRows = await transaction
        .selectFrom("archived_memories")
        .selectAll()
        .where("world_id", "=", scope.worldId)
        .where("branch_id", "=", scope.branchId)
        .where("agent_id", "=", scope.agentId)
        .execute();
      const memories = memoryRows.map(memoryFromRow);
      const memoriesById = new Map(
        memories.map((memory) => [memory.memoryId, memory] as const),
      );

      const terms = extractFullTextTerms(request.query);
      const keywordHitCounts = new Map<string, number>();
      for (const term of terms) {
        const expression = `"${term.replaceAll('"', '""')}"`;
        const hits = await sql<{ readonly memory_id: string }>`
          SELECT memory.memory_id
          FROM archived_memories_fts
          JOIN archived_memories AS memory
            ON memory.row_id = archived_memories_fts.rowid
          WHERE archived_memories_fts MATCH ${expression}
            AND memory.world_id = ${scope.worldId}
            AND memory.branch_id = ${scope.branchId}
            AND memory.agent_id = ${scope.agentId}
        `.execute(transaction);
        for (const hit of hits.rows) {
          keywordHitCounts.set(
            hit.memory_id,
            (keywordHitCounts.get(hit.memory_id) ?? 0) + 1,
          );
        }
      }
      const fullTextHits: ArchiveMemoryFullTextHit[] = [];
      for (const [memoryId, count] of keywordHitCounts) {
        const memory = memoriesById.get(memoryId);
        if (!memory) throw new Error(`FTS returned unknown archive memory ${memoryId}`);
        fullTextHits.push({
          memory,
          keywordMatch: count / terms.length,
        });
      }

      const vectorRows = await transaction
        .selectFrom("archive_memory_vectors")
        .selectAll()
        .where("world_id", "=", scope.worldId)
        .where("branch_id", "=", scope.branchId)
        .where("agent_id", "=", scope.agentId)
        .execute();
      if (vectorRows.length !== memories.length) {
        throw new Error("Ready archive memory vector index has incomplete coverage");
      }
      const vectorHits: ArchiveMemoryVectorHit[] = vectorRows.map((row) => {
        const memory = memoriesById.get(row.memory_id);
        if (!memory) {
          throw new Error(`Vector index returned unknown archive memory ${row.memory_id}`);
        }
        return {
          memory,
          semanticSimilarity: normalizeCosineSimilarity(
            cosineSimilarity(
              request.queryEmbedding.values,
              vectorFromRow(row, state.encoder),
            ),
          ),
        };
      });

      return rankArchiveMemoryCandidates(
        mergeArchiveMemoryHits(fullTextHits, vectorHits).map((hit) => ({
          ...hit,
          currentStrength: normalizeArchivedMemoryStrength(
            calculateArchivedMemoryStrength(hit.memory, request.atTick, request.decay),
            request.decay,
          ),
        })),
        request.rankingWeights,
      );
    });
  }
}
