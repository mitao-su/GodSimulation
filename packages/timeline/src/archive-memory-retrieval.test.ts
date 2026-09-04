import { describe, expect, it } from "vitest";

import type { ArchivedMemory, ArchiveMemoryDecayPolicy } from "./archive-memory";
import {
  calculateArchivedMemoryStrength,
  mergeArchiveMemoryHits,
  rankArchiveMemoryCandidates,
  sameArchiveMemoryEncoderLock,
  shouldDeleteArchivedMemory,
} from "./archive-memory-retrieval";

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

function memory(memoryId: string, content = "same remembered event"): ArchivedMemory {
  return {
    worldId: "world-1" as never,
    branchId: "branch-1",
    agentId: "alice" as never,
    consolidationCycleId: "cycle-1",
    memoryId,
    content,
    sourceEventIds: [`event:${memoryId}` as never],
    formedAtTick: 0,
    archivedAtTick: 0,
    importance: "low",
    importanceReason: "test",
  };
}

describe("archive memory retrieval policies", () => {
  it("recomputes decay directly from archive age across multiple days", () => {
    const archived = memory("memory-1");
    let dailyResult = 0;
    for (let day = 1; day <= 7; day += 1) {
      dailyResult = calculateArchivedMemoryStrength(archived, day * 100, decay);
    }
    const oneShotResult = calculateArchivedMemoryStrength(archived, 700, decay);

    expect(oneShotResult).toBe(dailyResult);
    expect(oneShotResult).toBe(1 * 2 ** (-7 / 2));
    expect(shouldDeleteArchivedMemory(archived, 600, decay)).toBe(false);
    expect(shouldDeleteArchivedMemory(archived, 700, decay)).toBe(true);
    expect(
      shouldDeleteArchivedMemory(archived, 200, {
        ...decay,
        deletionThreshold: 0.5,
      }),
    ).toBe(false);
  });

  it("merges only the two routes for one stable record ID", () => {
    const first = memory("memory-1");
    const similarButIndependent = memory("memory-2");
    const merged = mergeArchiveMemoryHits(
      [
        { memory: first, keywordMatch: 1 },
        { memory: similarButIndependent, keywordMatch: 1 },
      ],
      [
        { memory: first, semanticSimilarity: 0.9 },
        { memory: similarButIndependent, semanticSimilarity: 0.8 },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged).toEqual([
      { memory: first, keywordMatch: 1, semanticSimilarity: 0.9 },
      {
        memory: similarButIndependent,
        keywordMatch: 1,
        semanticSimilarity: 0.8,
      },
    ]);
  });

  it("sorts only by the three weighted retrieval factors and stable ID ties", () => {
    const first = memory("memory-a");
    const second = {
      ...memory("memory-b"),
      archivedAtTick: 99,
      importance: "critical" as const,
    };
    const ranked = rankArchiveMemoryCandidates(
      [
        {
          memory: second,
          semanticSimilarity: 0.5,
          keywordMatch: 0.5,
          currentStrength: 0.5,
        },
        {
          memory: first,
          semanticSimilarity: 0.5,
          keywordMatch: 0.5,
          currentStrength: 0.5,
        },
      ],
      { semanticSimilarity: 0.55, keywordMatch: 0.25, currentStrength: 0.2 },
    );

    expect(ranked.map((candidate) => candidate.memory.memoryId)).toEqual([
      "memory-a",
      "memory-b",
    ]);
    expect(ranked.map((candidate) => candidate.score)).toEqual([0.5, 0.5]);
  });

  it("treats every encoder identity field as part of the model lock", () => {
    const encoder = {
      encoderId: "local-encoder",
      encoderVersion: "1.0.0",
      dimension: 2,
      normalization: "l2",
      modelFileIdentity: "sha256:model-a",
    };

    expect(sameArchiveMemoryEncoderLock(encoder, { ...encoder })).toBe(true);
    for (const changed of [
      { ...encoder, encoderId: "other" },
      { ...encoder, encoderVersion: "1.0.1" },
      { ...encoder, dimension: 3 },
      { ...encoder, normalization: "none" },
      { ...encoder, modelFileIdentity: "sha256:model-b" },
    ]) {
      expect(sameArchiveMemoryEncoderLock(encoder, changed)).toBe(false);
    }
  });
});
