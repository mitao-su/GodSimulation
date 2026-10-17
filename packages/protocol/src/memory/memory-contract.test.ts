import { describe, expect, it } from "vitest";

import {
  ConsolidationMemoryRequestSchema,
  MemoryRequestSchema,
  MemoryResultAcknowledgementSchema,
  MemoryResultSchema,
  RecallMemoryRequestSchema,
} from "..";

const baseIdentity = {
  schemaVersion: 1,
  requestId: "memory-request:1",
  worldId: "world:1",
  branchId: "branch:main",
  agentId: "agent:alice",
  checkpointId: "checkpoint:world:1",
  worldVersion: 11,
  worldTick: 120,
  lastEventSequence: 31,
  simulationRulesHash: "a".repeat(64),
  pluginLockHash: "b".repeat(64),
  inputHash: "c".repeat(64),
};

const recallIdentity = {
  ...baseIdentity,
  kind: "recall" as const,
  operationCallId: "operation-call:recall:1",
  archiveIndexLock: {
    archiveVersion: 4,
    fullTextIndexVersion: 2,
    vectorIndexVersion: 3,
    encoder: {
      encoderId: "mock",
      encoderVersion: "1",
      dimension: 3,
      normalization: "l2",
      modelFileIdentity: "mock:v1",
    },
  },
};

describe("memory IPC contract", () => {
  it("keeps consolidation identity bound to a checkpoint and branch", () => {
    const request = ConsolidationMemoryRequestSchema.parse({
      identity: {
        ...baseIdentity,
        kind: "consolidation",
        consolidationCycleId: "consolidation-cycle:1",
      },
      input: {
        retainedMemories: [],
        conversations: [],
        semanticMap: {},
      },
    });

    expect(request.identity.branchId).toBe("branch:main");
    expect(MemoryRequestSchema.parse(request)).toEqual(request);
  });

  it("requires an archive/index/encoder lock for recall", () => {
    const request = RecallMemoryRequestSchema.parse({
      identity: recallIdentity,
      query: "where did Alice leave the key?",
    });

    expect(request.identity.archiveIndexLock.encoder.encoderId).toBe("mock");
    expect(
      RecallMemoryRequestSchema.safeParse({
        identity: { ...recallIdentity, archiveIndexLock: undefined },
        query: "key",
      }).success,
    ).toBe(false);
  });

  it("accepts a persisted success result and all acknowledgement dispositions", () => {
    const request = {
      ...baseIdentity,
      kind: "consolidation" as const,
      consolidationCycleId: "consolidation-cycle:1",
    };
    const result = MemoryResultSchema.parse({
      schemaVersion: 1,
      request,
      requestReceiptSequence: 3,
      resultReceiptSequence: 7,
      resultHash: "d".repeat(64),
      status: "succeeded",
      output: { retainedMemories: [], archivedMemories: [], semanticMap: {} },
    });

    expect(result.status).toBe("succeeded");
    for (const disposition of ["applied", "queued", "stale"] as const) {
      const acknowledgement = MemoryResultAcknowledgementSchema.parse({
        schemaVersion: 1,
        request,
        requestReceiptSequence: 3,
        resultReceiptSequence: 7,
        disposition,
        acknowledgedWorldTick: 121,
      });
      expect(acknowledgement.disposition).toBe(disposition);
    }
  });

  it("rejects a result with a non-SHA-256 receipt hash", () => {
    expect(
      MemoryResultSchema.safeParse({
        schemaVersion: 1,
        request: {
          ...baseIdentity,
          kind: "consolidation",
          consolidationCycleId: "consolidation-cycle:1",
        },
        requestReceiptSequence: 1,
        resultReceiptSequence: 1,
        resultHash: "not-a-hash",
        status: "succeeded",
        output: {},
      }).success,
    ).toBe(false);
  });
});
