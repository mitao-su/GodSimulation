import type { DecisionPromptInput, SubjectiveDecisionContext } from "@god-sim/protocol";

export type CognitionContext = SubjectiveDecisionContext;

export function cognitionContextFromInput(input: DecisionPromptInput): CognitionContext {
  return {
    decisionReason: input.decisionReason,
    bodySensations: input.bodySensations,
    activeTasks: input.activeTasks,
    operationResults: input.operationResults,
    memories: input.memories,
    perception: input.perception,
  };
}
