import {
  type ArchivedMemory,
  type ArchiveMemoryDecayPolicy,
  type ArchiveMemoryEncoderLock,
  type ArchiveMemoryFullTextHit,
  type ArchiveMemoryRankingCandidate,
  type ArchiveMemoryRankingWeights,
  type ArchiveMemoryVectorHit,
  type MergedArchiveMemoryHit,
  type RankedArchiveMemory,
} from "./archive-memory";

const IMPORTANCE_LEVELS = ["critical", "high", "normal", "low"] as const;
const WEIGHT_SUM_TOLERANCE = Number.EPSILON * 8;

function compareStableIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertUnitInterval(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite number between 0 and 1`);
  }
}

function assertDecayPolicy(policy: ArchiveMemoryDecayPolicy): void {
  if (!Number.isFinite(policy.ticksPerGameDay) || policy.ticksPerGameDay <= 0) {
    throw new Error("ticksPerGameDay must be a positive finite number");
  }
  if (!Number.isFinite(policy.deletionThreshold) || policy.deletionThreshold <= 0) {
    throw new Error("deletionThreshold must be a positive finite number");
  }
  for (const importance of IMPORTANCE_LEVELS) {
    const rule = policy.importance[importance];
    if (!Number.isFinite(rule.initialStrength) || rule.initialStrength <= 0) {
      throw new Error(`${importance}.initialStrength must be positive and finite`);
    }
    if (!Number.isFinite(rule.halfLifeDays) || rule.halfLifeDays <= 0) {
      throw new Error(`${importance}.halfLifeDays must be positive and finite`);
    }
  }
}

function memoriesMatch(left: ArchivedMemory, right: ArchivedMemory): boolean {
  return (
    left.memoryId === right.memoryId &&
    left.worldId === right.worldId &&
    left.branchId === right.branchId &&
    left.agentId === right.agentId &&
    left.consolidationCycleId === right.consolidationCycleId &&
    left.content === right.content &&
    left.formedAtTick === right.formedAtTick &&
    left.archivedAtTick === right.archivedAtTick &&
    left.importance === right.importance &&
    left.importanceReason === right.importanceReason &&
    left.sourceEventIds.length === right.sourceEventIds.length &&
    left.sourceEventIds.every(
      (sourceEventId, index) => sourceEventId === right.sourceEventIds[index],
    )
  );
}

export function sameArchiveMemoryEncoderLock(
  left: ArchiveMemoryEncoderLock,
  right: ArchiveMemoryEncoderLock,
): boolean {
  return (
    left.encoderId === right.encoderId &&
    left.encoderVersion === right.encoderVersion &&
    left.dimension === right.dimension &&
    left.normalization === right.normalization &&
    left.modelFileIdentity === right.modelFileIdentity
  );
}

export function calculateArchivedMemoryStrength(
  memory: Pick<ArchivedMemory, "archivedAtTick" | "importance">,
  atTick: number,
  policy: ArchiveMemoryDecayPolicy,
): number {
  assertDecayPolicy(policy);
  if (!Number.isInteger(memory.archivedAtTick) || memory.archivedAtTick < 0) {
    throw new Error("archivedAtTick must be a nonnegative integer");
  }
  if (!Number.isInteger(atTick) || atTick < memory.archivedAtTick) {
    throw new Error("atTick must be an integer at or after archivedAtTick");
  }
  const archiveAgeDays = (atTick - memory.archivedAtTick) / policy.ticksPerGameDay;
  const rule = policy.importance[memory.importance];
  return rule.initialStrength * 2 ** (-archiveAgeDays / rule.halfLifeDays);
}

export function normalizeArchivedMemoryStrength(
  strength: number,
  policy: ArchiveMemoryDecayPolicy,
): number {
  assertDecayPolicy(policy);
  if (!Number.isFinite(strength) || strength < 0) {
    throw new Error("strength must be finite and nonnegative");
  }
  const maximumInitialStrength = Math.max(
    ...IMPORTANCE_LEVELS.map(
      (importance) => policy.importance[importance].initialStrength,
    ),
  );
  return Math.min(1, strength / maximumInitialStrength);
}

export function shouldDeleteArchivedMemory(
  memory: Pick<ArchivedMemory, "archivedAtTick" | "importance">,
  atTick: number,
  policy: ArchiveMemoryDecayPolicy,
): boolean {
  return calculateArchivedMemoryStrength(memory, atTick, policy) < policy.deletionThreshold;
}

export function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length === 0 || left.length !== right.length) {
    throw new Error("Vectors must have the same positive dimension");
  }
  let dotProduct = 0;
  let leftSquaredNorm = 0;
  let rightSquaredNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      throw new Error("Vectors must contain only finite numbers");
    }
    dotProduct += leftValue * rightValue;
    leftSquaredNorm += leftValue * leftValue;
    rightSquaredNorm += rightValue * rightValue;
  }
  if (leftSquaredNorm === 0 || rightSquaredNorm === 0) {
    throw new Error("Vectors must have a nonzero norm");
  }
  return dotProduct / Math.sqrt(leftSquaredNorm * rightSquaredNorm);
}

export function normalizeCosineSimilarity(similarity: number): number {
  if (!Number.isFinite(similarity)) {
    throw new Error("Cosine similarity must be finite");
  }
  return (Math.max(-1, Math.min(1, similarity)) + 1) / 2;
}

export function mergeArchiveMemoryHits(
  fullTextHits: readonly ArchiveMemoryFullTextHit[],
  vectorHits: readonly ArchiveMemoryVectorHit[],
): readonly MergedArchiveMemoryHit[] {
  const merged = new Map<string, MergedArchiveMemoryHit>();

  for (const hit of fullTextHits) {
    assertUnitInterval(hit.keywordMatch, "keywordMatch");
    const existing = merged.get(hit.memory.memoryId);
    if (existing && !memoriesMatch(existing.memory, hit.memory)) {
      throw new Error(
        `Conflicting archive memory hits for ${hit.memory.memoryId}`,
      );
    }
    merged.set(hit.memory.memoryId, {
      memory: existing?.memory ?? hit.memory,
      keywordMatch: Math.max(existing?.keywordMatch ?? 0, hit.keywordMatch),
      semanticSimilarity: existing?.semanticSimilarity ?? 0,
    });
  }

  for (const hit of vectorHits) {
    assertUnitInterval(hit.semanticSimilarity, "semanticSimilarity");
    const existing = merged.get(hit.memory.memoryId);
    if (existing && !memoriesMatch(existing.memory, hit.memory)) {
      throw new Error(
        `Conflicting archive memory hits for ${hit.memory.memoryId}`,
      );
    }
    merged.set(hit.memory.memoryId, {
      memory: existing?.memory ?? hit.memory,
      keywordMatch: existing?.keywordMatch ?? 0,
      semanticSimilarity: Math.max(
        existing?.semanticSimilarity ?? 0,
        hit.semanticSimilarity,
      ),
    });
  }

  return [...merged.values()].sort((left, right) =>
    compareStableIds(left.memory.memoryId, right.memory.memoryId),
  );
}

export function rankArchiveMemoryCandidates(
  candidates: readonly ArchiveMemoryRankingCandidate[],
  weights: ArchiveMemoryRankingWeights,
): readonly RankedArchiveMemory[] {
  assertUnitInterval(weights.semanticSimilarity, "semanticSimilarity weight");
  assertUnitInterval(weights.keywordMatch, "keywordMatch weight");
  assertUnitInterval(weights.currentStrength, "currentStrength weight");
  const weightSum =
    weights.semanticSimilarity + weights.keywordMatch + weights.currentStrength;
  if (Math.abs(weightSum - 1) > WEIGHT_SUM_TOLERANCE) {
    throw new Error("Archive memory ranking weights must total 1");
  }

  const ranked = candidates.map((candidate) => {
    assertUnitInterval(candidate.semanticSimilarity, "semanticSimilarity");
    assertUnitInterval(candidate.keywordMatch, "keywordMatch");
    assertUnitInterval(candidate.currentStrength, "currentStrength");
    return {
      ...candidate,
      score:
        candidate.semanticSimilarity * weights.semanticSimilarity +
        candidate.keywordMatch * weights.keywordMatch +
        candidate.currentStrength * weights.currentStrength,
    };
  });

  return ranked.sort(
    (left, right) =>
      right.score - left.score ||
      right.semanticSimilarity - left.semanticSimilarity ||
      right.keywordMatch - left.keywordMatch ||
      right.currentStrength - left.currentStrength ||
      compareStableIds(left.memory.memoryId, right.memory.memoryId),
  );
}
