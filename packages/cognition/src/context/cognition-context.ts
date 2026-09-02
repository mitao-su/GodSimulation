import type {
  DecisionPromptInput,
  SubjectiveDecisionContext,
} from "@god-sim/protocol";

export interface CognitionContext extends SubjectiveDecisionContext {
  readonly taskOptions: DecisionPromptInput["taskOptions"];
}

export function cognitionContextFromInput(input: DecisionPromptInput): CognitionContext {
  return {
    decisionReason: input.decisionReason,
    bodySensations: input.bodySensations,
    activeTasks: input.activeTasks,
    memories: input.memories,
    perception: input.perception,
    taskOptions: input.taskOptions,
  };
}
