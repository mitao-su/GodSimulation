import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ArchiveMemoryIndexLockConflictError,
  lockArchiveMemoryIndex,
  type ArchivedMemoryDraft,
  type ArchiveMemoryDecayPolicy,
  type ArchiveMemoryEmbedding,
  type ArchiveMemoryEncoderLock,
  type ArchiveMemoryScope,
  type ArchiveMemoryStore,
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
        await firstOpen.saveArchivedMemories({
          scope: archiveScope,
          memories: [memory("memory-a", { content: "persisted apple memory" })],
        });
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
        await store.saveArchivedMemories({
          scope: archiveScope,
          memories: [
            memory("shared-id", {
              content: `scope ${index}`,
              sourceEventIds: [`event:scope:${index}` as never],
            }),
          ],
        });
      }
      await store.saveArchivedMemories({
        scope: scopes[0]!,
        memories: [
          memory("cycle-2-memory", {
            consolidationCycleId: "cycle-2",
          }),
        ],
      });

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
    } finally {
      await store.close();
    }
  });

  it("keeps similar content with different IDs and merges FTS/vector routes per ID", async () => {
    const store = await createSqliteTimelineStore({ filename: ":memory:" });
    const archiveScope = scope();
    try {
      await store.saveArchivedMemories({
        scope: archiveScope,
        memories: [
          memory("memory-a", { content: "red apple picnic" }),
          memory("memory-b", { content: "red apple picnic" }),
          memory("memory-c", { content: "distant sea" }),
        ],
      });
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

  it("never returns another agent's archive through either retrieval route", async () => {
    const store = await createSqliteTimelineStore({ filename: ":memory:" });
    const aliceScope = scope("world-1", "branch-1", "alice");
    const bobScope = scope("world-1", "branch-1", "bob");
    try {
      await store.saveArchivedMemories({
        scope: aliceScope,
        memories: [memory("alice-memory", { content: "shared keyword" })],
      });
      await store.saveArchivedMemories({
        scope: bobScope,
        memories: [memory("bob-secret", { content: "shared keyword secret" })],
      });
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
      await oneShot.saveArchivedMemories({ scope: archiveScope, memories });
      await daily.saveArchivedMemories({ scope: archiveScope, memories });
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
      await store.saveArchivedMemories({
        scope: archiveScope,
        memories: [memory("memory-a")],
      });
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
      await store.saveArchivedMemories({
        scope: archiveScope,
        memories: [memory("memory-b")],
      });
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
      await store.saveArchivedMemories({
        scope: archiveScope,
        memories: [memory("memory-a", { content: "apple memory" })],
      });
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
