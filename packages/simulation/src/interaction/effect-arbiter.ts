import type { AgentId, EntityId } from "@god-sim/protocol";

import { nextDeterministicRandom } from "../world/deterministic-random";
import type { WorldState } from "../world/world-state";

export interface InteractionIntent {
  readonly intentId: string;
  readonly agentId: AgentId;
  readonly entityId: EntityId;
  readonly interactionId: string;
  readonly arrivalTick: number;
}

export type ArbitrationDecision = InteractionIntent &
  (
    | { readonly accepted: true }
    | { readonly accepted: false; readonly reasonCode: "resource_claimed" }
  );

export interface ArbitrationRecord {
  readonly entityId: EntityId;
  readonly arrivalTick: number;
  readonly contenderAgentIds: readonly AgentId[];
  readonly winnerAgentId: AgentId;
  readonly tieBreaker: number | null;
}

export interface ArbitrationResult {
  readonly decisions: readonly ArbitrationDecision[];
  readonly records: readonly ArbitrationRecord[];
  readonly randomState: number;
}

function canonicalIntentOrder(left: InteractionIntent, right: InteractionIntent): number {
  return (
    left.arrivalTick - right.arrivalTick ||
    left.entityId.localeCompare(right.entityId) ||
    left.agentId.localeCompare(right.agentId) ||
    left.interactionId.localeCompare(right.interactionId) ||
    left.intentId.localeCompare(right.intentId)
  );
}

export function arbitrateInteractionBatch(
  world: WorldState,
  intents: readonly InteractionIntent[],
): ArbitrationResult {
  const byEntity = new Map<EntityId, InteractionIntent[]>();
  for (const intent of intents) {
    const group = byEntity.get(intent.entityId) ?? [];
    group.push(intent);
    byEntity.set(intent.entityId, group);
  }

  let randomState = world.randomState;
  const decisions: ArbitrationDecision[] = [];
  const records: ArbitrationRecord[] = [];

  for (const [entityId, unsortedGroup] of [...byEntity.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const group = [...unsortedGroup].sort(canonicalIntentOrder);
    const first = group[0];
    if (!first) continue;
    const earliest = group.filter((intent) => intent.arrivalTick === first.arrivalTick);

    let winner = earliest[0]!;
    let tieBreaker: number | null = null;
    if (earliest.length > 1) {
      const random = nextDeterministicRandom(randomState);
      randomState = random.state;
      tieBreaker = random.value;
      winner = earliest[random.value % earliest.length]!;
    }

    for (const intent of group) {
      decisions.push(
        intent.intentId === winner.intentId
          ? { ...intent, accepted: true }
          : { ...intent, accepted: false, reasonCode: "resource_claimed" },
      );
    }
    records.push({
      entityId,
      arrivalTick: first.arrivalTick,
      contenderAgentIds: earliest.map((intent) => intent.agentId),
      winnerAgentId: winner.agentId,
      tieBreaker,
    });
  }

  decisions.sort((left, right) => left.intentId.localeCompare(right.intentId));
  return { decisions, records, randomState };
}
