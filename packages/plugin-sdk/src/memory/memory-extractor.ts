import type { EventId } from "@god-sim/protocol";

export interface MemoryProposal {
  readonly sourceEventIds: readonly EventId[];
  readonly summary: string;
}

export interface MemoryExtractor {
  readonly id: string;
  propose(sourceEventIds: readonly EventId[]): MemoryProposal | null;
}
