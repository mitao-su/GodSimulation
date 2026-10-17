import type { ModelDecisionProposal, ModelDecisionRequest } from "@god-sim/protocol";

export interface DecisionProvider {
  decide(request: ModelDecisionRequest, signal: AbortSignal): Promise<ModelDecisionProposal>;
}
