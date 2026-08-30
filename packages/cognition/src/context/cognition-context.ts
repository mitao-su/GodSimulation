import type {
  DecisionPromptInput,
  SubjectiveDecisionContext,
} from "@god-sim/protocol";

export interface CognitionContext extends SubjectiveDecisionContext {
  readonly goalOptions: DecisionPromptInput["goalOptions"];
}

export function cognitionContextFromInput(input: DecisionPromptInput): CognitionContext {
  return {
    decisionReason: input.decisionReason,
    bodySensations: input.bodySensations,
    currentGoal: input.currentGoal,
    memories: input.memories,
    perception: input.perception,
    goalOptions: input.goalOptions,
  };
}

