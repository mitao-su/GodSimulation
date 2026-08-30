export type PromptSection =
  | "core_rules"
  | "persona"
  | "body_state"
  | "current_goal"
  | "memory"
  | "perception"
  | "goal_options"
  | "decision_reason"
  | "response_format";

export const PROMPT_SECTION_CHARACTER_LIMITS: Readonly<Record<PromptSection, number>> = {
  core_rules: 2_000,
  persona: 4_000,
  body_state: 2_000,
  current_goal: 3_000,
  memory: 8_000,
  perception: 16_000,
  goal_options: 8_000,
  decision_reason: 2_000,
  response_format: 2_000,
};

export function assertPromptSectionFits(section: PromptSection, content: string): string {
  const limit = PROMPT_SECTION_CHARACTER_LIMITS[section];
  if (content.length > limit) {
    throw new Error(`Prompt section ${section} exceeds ${limit} characters`);
  }
  return content;
}

