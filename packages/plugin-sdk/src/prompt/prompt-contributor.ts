export type PromptSectionPlacement =
  | "persona"
  | "body_state"
  | "current_goal"
  | "memory"
  | "perception"
  | "goal_options"
  | "decision_reason";

export interface PromptContributor {
  readonly id: string;
  readonly placement: PromptSectionPlacement;
  readonly maxCharacters: number;
  render(): string;
}
