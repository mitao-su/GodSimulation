import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SimulationRulesLockSchema } from "@god-sim/protocol";
import {
  ArchiveMemoryIndexLockConflictError,
  lockArchiveMemoryIndex,
  type ArchivedMemoryDraft,
  type ArchiveMemoryDecayPolicy,
  type ArchiveMemoryEmbedding,
  type ArchiveMemoryEncoderLock,
  type ArchiveMemoryScope,
  type ArchiveMemoryStore,
  type ArchiveTimelineStore,
} from "@god-sim/timeline";

import { createSqliteTimelineStore } from "./sqlite-timeline-store";

const decay: ArchiveMemoryDecayPolicy = {
  ticksPerGameDay: 100,
  deletionThreshold: 0.1,
  importance: {
    critical: { initialStrength: 1, halfLifeDays: 90 },
    high: { initialStrength: 1, halfLifeDays: 30 },
    normal: { initialStrength: 1, halfLifeDays: 7 },
    low: { initialStrength: 1, halfLifeDays: 2 },
  },
};

const rankingWeights = {
  semanticSimilarity: 0.55,
  keywordMatch: 0.25,
  currentStrength: 0.2,
} as const;

const simulationRulesLock = SimulationRulesLockSchema.parse({
  hash: "c".repeat(64),
  rules: {
    schemaVersion: 1,
    id: "default",
    version: 1,
    time: { secondsPerGameTick: 6, epoch: { day: 1, hour: 8, minute: 0 } },
    context: { attentionBudgetTokens: 200_000, technicalHardLimitTokens: 200_000 },
    fatigue: {
      timeWeight: 0.6,
      tokenWeight: 0.4,
      forcedSleepThreshold: 0.6,
      timePressureFullAtTicks: 43_200,
    },
    inventory: { capacityUnits: 9 },
    operations: {
      move: { ticksPerCell: 2 },
      wait: { defaultDurationTicks: 600, maxDurationTicks: 600 },
      observe: { durationTicks: 1 },
    },
    memory: {
      importance: decay.importance,
      deletionThreshold: decay.deletionThreshold,
      recall: {
        maxReturnTokensPerOperation: 8_000,
        rankingWeights,
      },
    },
    sound: {
      speakSourceStrength: { quiet: 1, normal: 2, loud: 4 },
      attenuationPerTile: 0.25,
      fullContentThreshold: 1,
      unclearContentThreshold: 0.25,
    },
  },
});

const encoderA: ArchiveMemoryEncoderLock = {
  encoderId: "test-encoder",
  encoderVersion: "1.0.0",
  dimension: 2,
  normalization: "l2",
  modelFileIdentity: "sha256:model-a",
};

const encoderB: ArchiveMemoryEncoderLock = {
  ...encoderA,
  encoderVersion: "2.0.0",
  modelFileIdentity: "sha256:model-b",
};

function scope(
  worldId = "world-1",
  branchId = "branch-1",
  agentId = "alice",
): ArchiveMemoryScope {
  return {
    worldId: worldId as never,
    branchId,
    agentId: agentId as never,
  };
}

function memory(
  memoryId: string,
  options: Partial<ArchivedMemoryDraft> = {},
): ArchivedMemoryDraft {
  return {
    memoryId,
    consolidationCycleId: "cycle-1",
    content: `remembered ${memoryId}`,
    sourceEventIds: [`event:${memoryId}` as never],
    formedAtTick: 0,
    archivedAtTick: 0,
    importance: "normal",
    importanceReason: "test fixture",
    ...options,
  };
}

interface SeededWorldEvents {
  tail: number;
  readonly eventIds: Set<string>;
}

const seededEventsByStore = new WeakMap<
  ArchiveTimelineStore,
  Map<string, SeededWorldEvents>
>();

async function seedSourceEvents(
  store: ArchiveTimelineStore,
  archiveScope: ArchiveMemoryScope,
  memories: readonly ArchivedMemoryDraft[],
): Promise<void> {
  let worlds = seededEventsByStore.get(store);
  if (!worlds) {
    worlds = new Map();
    seededEventsByStore.set(store, worlds);
  }
  let world = worlds.get(archiveScope.worldId);
  if (!world) {
    world = { tail: 0, eventIds: new Set() };
    worlds.set(archiveScope.worldId, world);
  }
  const newEventIds = [
    ...new Set(memories.flatMap((draft) => draft.sourceEventIds)),
  ]
    .filter((eventId) => !world.eventIds.has(eventId))
    .sort();
  if (newEventIds.length === 0) return;

  const firstSequence = world.tail + 1;
  const tail = world.tail + newEventIds.length;
  const allEventIds = [...world.eventIds, ...newEventIds];
  await store.commitCheckpoint({
    checkpointId: `checkpoint:${archiveScope.worldId}:${tail}:${tail}` as never,
    events: newEventIds.map((eventId, index) => {
      const sequence = firstSequence + index;
      return {
        schemaVersion: 1,
        eventId,
        worldId: archiveScope.worldId,
        worldVersion: sequence,
        worldTick: sequence,
        sequence,
        parentSequence: sequence === 1 ? null : sequence - 1,
        causationId: `cause:archive-source:${sequence}`,
        correlationId: `cycle:archive-source:${sequence}`,
        type: "decision_requested",
        agentId: archiveScope.agentId,
        requestId: `request:archive-source:${sequence}`,
        decisionCycleId: `cycle:archive-source:${sequence}`,
        reasonCode: "archive_memory_test_source",
      } as never;
    }),
    snapshot: {
      schemaVersion: 3,
      worldId: archiveScope.worldId,
      worldVersion: tail,
      worldTick: tail,
      lastEventSequence: tail,
      pluginLockHash: "a".repeat(64),
      simulationRulesLock,
      history: { mode: "strict", causalFromSequence: 1 },
      causalEventIds: allEventIds,
      state: {},
    } as never,
  });
  world.tail = tail;
  for (const eventId of newEventIds) world.eventIds.add(eventId);
}

async function saveMemories(
  store: ArchiveTimelineStore,
  archiveScope: ArchiveMemoryScope,
  memories: readonly ArchivedMemoryDraft[],
) {
  await seedSourceEvents(store, archiveScope, memories);
  return store.saveArchivedMemories({ scope: archiveScope, memories });
}

async function rebuildIndex(
  store: ArchiveMemoryStore,
  archiveScope: ArchiveMemoryScope,
  encoder: ArchiveMemoryEncoderLock,
  embeddings: readonly ArchiveMemoryEmbedding[],
) {
  const prepared = await store.prepareArchiveMemoryVectorIndex({
    scope: archiveScope,
    encoder,
  });
  return store.rebuildArchiveMemoryVectorIndex({
    scope: archiveScope,
    encoder,
    expectedArchiveVersion: prepared.archiveVersion,
    embeddings,
  });
}

describe("SQLite archive memory store", () => {
  it("persists records, vectors, and their version lock across reopening", async () => {
    const directory = await mkdtemp(join(tmpdir(), "god-sim-archive-store-"));
    const filename = join(directory, "timeline.sqlite");
    const archiveScope = scope();
    try {
      const firstOpen = await createSqliteTimelineStore({ filename });
      let ready;
      try {
        await saveMemories(firstOpen, archiveScope, [
          memory("memory-a", { content: "persisted apple memory" }),
        ]);
        ready = await rebuildIndex(firstOpen, archiveScope, encoderA, [
          { memoryId: "memory-a", values: [1, 0] },
        ]);
      } finally {
        await firstOpen.close();
      }

      const reopened = await createSqliteTimelineStore({ filename });
      try {
        await expect(reopened.getArchiveMemoryIndexState(archiveScope)).resolves.toEqual(
          ready,
        );
        await expect(
          reopened.searchArchivedMemories({
            scope: archiveScope,
            query: "persisted apple",
            queryEmbedding: { encoder: encoderA, values: [1, 0] },
            indexLock: lockArchiveMemoryIndex(ready),
            atTick: 0,
            decay,
            rankingWeights,
          }),
        ).resolves.toEqual([
          expect.objectContaining({
            memory: expect.objectContaining({
              memoryId: "memory-a",
              content: "persisted apple memory",
            }),
            keywordMatch: 1,
            semanticSimilarity: 1,
          }),
        ]);
      } finally {
        await reopened.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reloads every archive cycle needed to rebuild a stale index after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "god-sim-archive-rebuild-"));
    const filename = join(directory, "timeline.sqlite");
    const archiveScope = scope();
    let staleArchiveVersion = -1;
    try {
      const firstOpen = await createSqliteTimelineStore({ filename });
      try {
        await saveMemories(firstOpen, archiveScope, [
          memory("memory-a", {
            consolidationCycleId: "cycle-1",
            content: "first archive cycle",
          }),
        ]);
        await rebuildIndex(firstOpen, archiveScope, encoderA, [
          { memoryId: "memory-a", values: [1, 0] },
        ]);
        const stale = await saveMemories(firstOpen, archiveScope, [
          memory("memory-b", {
            consolidationCycleId: "cycle-2",
            content: "second archive cycle",
          }),
        ]);
        expect(stale.vectorStatus).toBe("stale");
        staleArchiveVersion = stale.archiveVersion;
      } finally {
        await firstOpen.close();
      }

      const reopened = await createSqliteTimelineStore({ filename });
      try {
        const input = await reopened.loadArchiveMemoryVectorIndexInput(archiveScope);
        expect(input).toEqual({
          ...archiveScope,
          archiveVersion: staleArchiveVersion,
          documents: [
            { memoryId: "memory-a", content: "first archive cycle" },
            { memoryId: "memory-b", content: "second archive cycle" },
          ],
        });
        const ready = await reopened.rebuildArchiveMemoryVectorIndex({
          scope: archiveScope,
          encoder: encoderA,
          expectedArchiveVersion: input!.archiveVersion,
          embeddings: input!.documents.map((document, index) => ({
            memoryId: document.memoryId,
            values: index === 0 ? [1, 0] : [0, 1],
          })),
        });
        expect(ready).toMatchObject({
          vectorStatus: "ready",
          archiveVersion: staleArchiveVersion,
          indexedArchiveVersion: staleArchiveVersion,
        });
      } finally {
        await reopened.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rolls back the whole archive batch when a source Event is missing", async () => {
    const store = await createSqliteTimelineStore({ filename: ":memory:" });
    const archiveScope = scope();
    const durableMemory = memory("durable-source");
    try {
      await seedSourceEvents(store, archiveScope, [durableMemory]);
      await expect(
        store.saveArchivedMemories({
          scope: archiveScope,
          memories: [durableMemory, memory("missing-source")],
        }),
      ).rejects.toThrow(/missing Event event:missing-source/);
      await expect(store.getArchiveMemoryIndexState(archiveScope)).resolves.toBeNull();
      await expect(
        store.loadArchivedMemories({
          ...archiveScope,
          consolidationCycleId: "cycle-1",
        }),
      ).resolves.toEqual([]);
    } finally {
      await store.close();
    }
  });

  it("rolls back the whole archive batch when a source Event belongs to another world", async () => {
    const store = await createSqliteTimelineStore({ filename: ":memory:" });
    const archiveScope = scope("world-1");
    const otherWorldScope = scope("world-2");
    const durableMemory = memory("durable-source");
    const foreignMemory = memory("foreign-source");
    try {
      await seedSourceEvents(store, archiveScope, [durableMemory]);
      await seedSourceEvents(store, otherWorldScope, [foreignMemory]);
      await expect(
        store.saveArchivedMemories({
          scope: archiveScope,
          memories: [durableMemory, foreignMemory],
        }),
      ).rejects.toThrow(/belongs to world world-2, not world-1/);
      await expect(store.getArchiveMemoryIndexState(archiveScope)).resolves.toBeNull();
      await expect(
        store.loadArchivedMemories({
          ...archiveScope,
          consolidationCycleId: "cycle-1",
        }),
      ).resolves.toEqual([]);
    } finally {
      await store.close();
    }
  });

  it("isolates records by world, branch, agent, and consolidation cycle", async () => {
    const store = await createSqliteTimelineStore({ filename: ":memory:" });
    const scopes = [
      scope("world-1", "branch-1", "alice"),
      scope("world-1", "branch-2", "alice"),
      scope("world-1", "branch-1", "bob"),
      scope("world-2", "branch-1", "alice"),
    ];
    try {
      for (const [index, archiveScope] of scopes.entries()) {
        await saveMemories(store, archiveScope, [
          memory("shared-id", {
            content: `scope ${index}`,
            sourceEventIds: [`event:scope:${index}` as never],
          }),
        ]);
      }
      await saveMemories(store, scopes[0]!, [
        memory("cycle-2-memory", {
          consolidationCycleId: "cycle-2",
        }),
      ]);

      for (const [index, archiveScope] of scopes.entries()) {
        const records = await store.loadArchivedMemories({
          ...archiveScope,
          consolidationCycleId: "cycle-1",
        });
        expect(records).toHaveLength(1);
        expect(records[0]?.content).toBe(`scope ${index}`);
      }
      await expect(
        store.loadArchivedMemories({
          ...scopes[0]!,
          consolidationCycleId: "cycle-2",
        }),
      ).resolves.toEqual([
        expect.objectContaining({ memoryId: "cycle-2-memory" }),
      ]);
      await expect(
        store.loadArchiveMemoryVectorIndexInput(scopes[0]!),
      ).resolves.toMatchObject({
        ...scopes[0]!,
        documents: [
          { memoryId: "cycle-2-memory", content: "remembered cycle-2-memory" },
          { memoryId: "shared-id", content: "scope 0" },
        ],
      });
    } finally {
      await store.close();
    }
  });

  it("keeps similar content with different IDs and merges FTS/vector routes per ID", async () => {
    const store = await createSqliteTimelineStore({ filename: ":memory:" });
    const archiveScope = scope();
    try {
      await saveMemories(store, archiveScope, [
        memory("memory-a", { content: "red apple picnic" }),
        memory("memory-b", { content: "red apple picnic" }),
        memory("memory-c", { content: "distant sea" }),
      ]);
      const ready = await rebuildIndex(store, archiveScope, encoderA, [
        { memoryId: "memory-a", values: [1, 0] },
        { memoryId: "memory-b", values: [0.8, 0.6] },
        { memoryId: "memory-c", values: [-1, 0] },
      ]);
      const results = await store.searchArchivedMemories({
        scope: archiveScope,
        query: "apple",
        queryEmbedding: { encoder: encoderA, values: [1, 0] },
        indexLock: lockArchiveMemoryIndex(ready),
        atTick: 0,
        decay,
        rankingWeights,
      });

      expect(results.map((result) => result.memory.memoryId)).toEqual([
        "memory-a",
        "memory-b",
        "memory-c",
      ]);
      expect(results).toHaveLength(3);
      expect(results[0]).toMatchObject({
        keywordMatch: 1,
        semanticSimilarity: 1,
      });
      expect(results[1]).toMatchObject({ keywordMatch: 1 });
      expect(
        results.filter((result) => result.memory.content === "red apple picnic"),
      ).toHaveLength(2);
    } finally {
      await store.close();
    }
  });

  it("matches a Chinese phrase inside unsegmented Chinese archive content", async () => {
    const store = await createSqliteTimelineStore({ filename: ":memory:" });
    const archiveScope = scope();
    try {
      await saveMemories(store, archiveScope, [
        memory("park-memory", { content: "今天去了公园散步" }),
        memory("home-memory", { content: "今天留在家里读书" }),
      ]);
      const ready = await rebuildIndex(store, archiveScope, encoderA, [
        { memoryId: "park-memory", values: [0, 1] },
        { memoryId: "home-memory", values: [0, 1] },
      ]);

      const results = await store.searchArchivedMemories({
        scope: archiveScope,
        query: "公园",
        queryEmbedding: { encoder: encoderA, values: [1, 0] },
        indexLock: lockArchiveMemoryIndex(ready),
        atTick: 0,
        decay,
        rankingWeights,
      });

      expect(
        results.find((result) => result.memory.memoryId === "park-memory"),
      ).toMatchObject({ keywordMatch: 1 });
      expect(
        results.find((result) => result.memory.memoryId === "home-memory"),
      ).toMatchObject({ keywordMatch: 0 });
    } finally {
      await store.close();
    }
  });

  it("never returns another agent's archive through either retrieval route", async () => {
    const store = await createSqliteTimelineStore({ filename: ":memory:" });
    const aliceScope = scope("world-1", "branch-1", "alice");
    const bobScope = scope("world-1", "branch-1", "bob");
    try {
      await saveMemories(store, aliceScope, [
        memory("alice-memory", { content: "shared keyword" }),
      ]);
      await saveMemories(store, bobScope, [
        memory("bob-secret", { content: "shared keyword secret" }),
      ]);
      const aliceIndex = await rebuildIndex(store, aliceScope, encoderA, [
        { memoryId: "alice-memory", values: [1, 0] },
      ]);
      await rebuildIndex(store, bobScope, encoderA, [
        { memoryId: "bob-secret", values: [1, 0] },
      ]);

      const results = await store.searchArchivedMemories({
        scope: aliceScope,
        query: "shared keyword secret",
        queryEmbedding: { encoder: encoderA, values: [1, 0] },
        indexLock: lockArchiveMemoryIndex(aliceIndex),
        atTick: 0,
        decay,
        rankingWeights,
      });

      expect(results.map((result) => result.memory.memoryId)).toEqual([
        "alice-memory",
      ]);
    } finally {
      await store.close();
    }
  });

  it("produces the same decay and deletion after one jump or daily checks", async () => {
    const oneShot = await createSqliteTimelineStore({ filename: ":memory:" });
    const daily = await createSqliteTimelineStore({ filename: ":memory:" });
    const archiveScope = scope();
    const memories = [
      memory("low-memory", { importance: "low" }),
      memory("critical-memory", { importance: "critical" }),
    ];
    const embeddings = [
      { memoryId: "low-memory", values: [1, 0] },
      { memoryId: "critical-memory", values: [0, 1] },
    ] as const;
    try {
      await saveMemories(oneShot, archiveScope, memories);
      await saveMemories(daily, archiveScope, memories);
      await rebuildIndex(oneShot, archiveScope, encoderA, embeddings);
      await rebuildIndex(daily, archiveScope, encoderA, embeddings);

      const oneShotResult = await oneShot.pruneArchivedMemories({
        scope: archiveScope,
        atTick: 700,
        decay,
      });
      let dailyDeleted: readonly string[] = [];
      for (let day = 1; day <= 7; day += 1) {
        dailyDeleted = (
          await daily.pruneArchivedMemories({
            scope: archiveScope,
            atTick: day * 100,
            decay,
          })
        ).deletedMemoryIds;
      }

      expect(oneShotResult.deletedMemoryIds).toEqual(["low-memory"]);
      expect(dailyDeleted).toEqual(oneShotResult.deletedMemoryIds);
      const collectionScope = {
        ...archiveScope,
        consolidationCycleId: "cycle-1",
      };
      const [oneShotRecords, dailyRecords] = await Promise.all([
        oneShot.loadArchivedMemories(collectionScope),
        daily.loadArchivedMemories(collectionScope),
      ]);
      expect(oneShotRecords).toEqual(dailyRecords);
      expect(oneShotRecords.map((record) => record.memoryId)).toEqual([
        "critical-memory",
      ]);
      expect(oneShotResult.indexState?.vectorStatus).toBe("ready");
    } finally {
      await oneShot.close();
      await daily.close();
    }
  });

  it("invalidates incompatible model locks and requires an explicit rebuild", async () => {
    const store = await createSqliteTimelineStore({ filename: ":memory:" });
    const archiveScope = scope();
    try {
      await saveMemories(store, archiveScope, [memory("memory-a")]);
      const readyA = await rebuildIndex(store, archiveScope, encoderA, [
        { memoryId: "memory-a", values: [1, 0] },
      ]);
      const lockA = lockArchiveMemoryIndex(readyA);
      await expect(
        store.prepareArchiveMemoryVectorIndex({
          scope: archiveScope,
          encoder: encoderA,
        }),
      ).resolves.toEqual(readyA);

      const staleB = await store.prepareArchiveMemoryVectorIndex({
        scope: archiveScope,
        encoder: encoderB,
      });
      expect(staleB).toMatchObject({
        vectorStatus: "stale",
        indexedArchiveVersion: null,
        encoder: encoderB,
      });
      expect(staleB.vectorIndexVersion).toBeGreaterThan(readyA.vectorIndexVersion);
      await expect(
        store.searchArchivedMemories({
          scope: archiveScope,
          query: "memory",
          queryEmbedding: { encoder: encoderA, values: [1, 0] },
          indexLock: lockA,
          atTick: 0,
          decay,
          rankingWeights,
        }),
      ).rejects.toBeInstanceOf(ArchiveMemoryIndexLockConflictError);

      await expect(
        store.rebuildArchiveMemoryVectorIndex({
          scope: archiveScope,
          encoder: encoderB,
          expectedArchiveVersion: staleB.archiveVersion,
          embeddings: [],
        }),
      ).rejects.toThrow(/cover every archived memory/i);
      await expect(store.getArchiveMemoryIndexState(archiveScope)).resolves.toEqual(
        staleB,
      );

      const readyB = await store.rebuildArchiveMemoryVectorIndex({
        scope: archiveScope,
        encoder: encoderB,
        expectedArchiveVersion: staleB.archiveVersion,
        embeddings: [{ memoryId: "memory-a", values: [0, 1] }],
      });
      expect(readyB.vectorStatus).toBe("ready");
      await saveMemories(store, archiveScope, [memory("memory-b")]);
      const invalidated = await store.getArchiveMemoryIndexState(archiveScope);
      expect(invalidated?.vectorStatus).toBe("stale");
      await expect(
        store.searchArchivedMemories({
          scope: archiveScope,
          query: "memory",
          queryEmbedding: { encoder: encoderB, values: [0, 1] },
          indexLock: lockArchiveMemoryIndex(readyB),
          atTick: 0,
          decay,
          rankingWeights,
        }),
      ).rejects.toBeInstanceOf(ArchiveMemoryIndexLockConflictError);
    } finally {
      await store.close();
    }
  });

  it("does not update archive records, strength, or index versions during recall", async () => {
    const store = await createSqliteTimelineStore({ filename: ":memory:" });
    const archiveScope = scope();
    try {
      await saveMemories(store, archiveScope, [
        memory("memory-a", { content: "apple memory" }),
      ]);
      const ready = await rebuildIndex(store, archiveScope, encoderA, [
        { memoryId: "memory-a", values: [1, 0] },
      ]);
      const lock = lockArchiveMemoryIndex(ready);
      const collectionScope = {
        ...archiveScope,
        consolidationCycleId: "cycle-1",
      };
      const recordsBefore = await store.loadArchivedMemories(collectionScope);
      const stateBefore = await store.getArchiveMemoryIndexState(archiveScope);

      const first = await store.searchArchivedMemories({
        scope: archiveScope,
        query: "apple",
        queryEmbedding: { encoder: encoderA, values: [1, 0] },
        indexLock: lock,
        atTick: 0,
        decay,
        rankingWeights,
      });
      const later = await store.searchArchivedMemories({
        scope: archiveScope,
        query: "apple",
        queryEmbedding: { encoder: encoderA, values: [1, 0] },
        indexLock: lock,
        atTick: 400,
        decay,
        rankingWeights,
      });

      expect(later[0]!.currentStrength).toBeLessThan(first[0]!.currentStrength);
      await expect(store.loadArchivedMemories(collectionScope)).resolves.toEqual(
        recordsBefore,
      );
      await expect(store.getArchiveMemoryIndexState(archiveScope)).resolves.toEqual(
        stateBefore,
      );
    } finally {
      await store.close();
    }
  });
});
