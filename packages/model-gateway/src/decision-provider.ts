import type { GoalProposal, ModelDecisionRequest } from "@god-sim/protocol";

export interface DecisionProvider {
  decide(request: ModelDecisionRequest, signal: AbortSignal): Promise<GoalProposal>;
}

