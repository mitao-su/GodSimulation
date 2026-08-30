import type { ImmediateMemory, KnowledgeChange } from "./agent-knowledge";

export function formImmediateMemories(
  existing: readonly ImmediateMemory[],
  changes: readonly KnowledgeChange[],
): readonly ImmediateMemory[] {
  if (changes.length === 0) return existing;
  return [
    ...existing,
    ...changes.map((change) => ({
      id: `memory:${change.current.sourceEventId}`,
      sourceEventId: change.current.sourceEventId,
      formedAtTick: change.current.observedAtTick,
      observationKind: change.current.observationKind,
      summary: change.current.summary,
      relatedEntityId: change.current.entityId,
    })),
  ];
}
