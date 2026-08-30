import type {
  Goal,
  GoalOptionId,
  GoalProposal,
  ModelDecisionRequest,
} from "@god-sim/protocol";

import type { DecisionProvider } from "../decision-provider";

export interface FixedDecisionRules {
  readonly byRequestId?: Readonly<Record<string, GoalOptionId>>;
  readonly byAgentAndReason?: Readonly<Record<string, GoalOptionId>>;
  readonly defaultGoalOptionId?: GoalOptionId;
  readonly defaultGoalKind?: Goal["kind"];
}

export class FixedDecisionProvider implements DecisionProvider {
  readonly #rules: FixedDecisionRules;

  constructor(rules: FixedDecisionRules) {
    this.#rules = rules;
  }

  async decide(request: ModelDecisionRequest, signal: AbortSignal): Promise<GoalProposal> {
    if (signal.aborted) throw signal.reason;
    const reasonKey = `${request.agentId}:${request.decisionReason.code}`;
    const configuredGoalOptionId =
      this.#rules.byRequestId?.[request.requestId] ??
      this.#rules.byAgentAndReason?.[reasonKey] ??
      this.#rules.defaultGoalOptionId;
    const goalOptionId =
      configuredGoalOptionId ??
      request.goalOptions.find((option) => option.goal.kind === this.#rules.defaultGoalKind)?.id;
    if (!goalOptionId) throw new Error(`No fixed decision configured for ${request.requestId}`);
    if (!request.goalOptions.some((option) => option.id === goalOptionId)) {
      throw new Error(`Fixed goal option ${goalOptionId} was not offered for ${request.requestId}`);
    }
    return {
      schemaVersion: 1,
      goalOptionId,
      reason: `Fixed decision for ${request.decisionReason.code}`,
    };
  }
}
