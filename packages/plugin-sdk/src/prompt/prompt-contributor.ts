export type PromptSectionPlacement =
  | "persona"
  | "body_state"
  | "active_tasks"
  | "memory"
  | "perception"
  | "task_options"
  | "decision_reason";

export interface PromptContributor {
  readonly id: string;
  readonly placement: PromptSectionPlacement;
  readonly maxCharacters: number;
  render(): string;
}
