import type { ModelDecisionRequest, TaskDecision } from "@god-sim/protocol";

export interface DecisionProvider {
  decide(request: ModelDecisionRequest, signal: AbortSignal): Promise<TaskDecision>;
}
