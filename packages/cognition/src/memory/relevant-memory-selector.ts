import type { DecisionPromptInput } from "@god-sim/protocol";

type DecisionMemory = DecisionPromptInput["memories"][number];

function terms(input: DecisionPromptInput): ReadonlySet<string> {
  const text = [
    input.decisionReason.code,
    input.decisionReason.summary,
    input.currentGoal?.label ?? "",
    ...input.goalOptions.map((option) => option.label),
    ...input.perception.visibleEntities.map((entity) => entity.displayName),
  ]
    .join(" ")
    .toLowerCase();
  return new Set(text.match(/[\p{L}\p{N}_-]+/gu) ?? []);
}

function relevance(memory: DecisionMemory, relevantTerms: ReadonlySet<string>): number {
  const memoryTerms = memory.summary.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return memoryTerms.reduce(
    (score, term) => score + (relevantTerms.has(term) ? 1 : 0),
    0,
  );
}

export function selectRelevantMemories(
  input: DecisionPromptInput,
  limit = 12,
): readonly DecisionMemory[] {
  if (!Number.isInteger(limit) || limit < 0) throw new Error("Memory limit must be nonnegative");
  const relevantTerms = terms(input);
  return [...input.memories]
    .sort(
      (left, right) =>
        relevance(right, relevantTerms) - relevance(left, relevantTerms) ||
        right.formedAtTick - left.formedAtTick ||
        left.memoryId.localeCompare(right.memoryId),
    )
    .slice(0, limit);
}
