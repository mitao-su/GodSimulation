import type { AgentDefinition, PromptSectionPlacement } from "@god-sim/plugin-sdk";
import {
  DecisionPromptInputSchema,
  ModelDecisionRequestSchema,
  type DecisionPromptInput,
  type ModelDecisionRequest,
} from "@god-sim/protocol";

import { selectRelevantMemories } from "../memory/relevant-memory-selector";
import {
  assertPromptSectionFits,
  type PromptSection,
} from "./prompt-budget";

const PLACEMENTS = new Set<PromptSectionPlacement>([
  "persona",
  "body_state",
  "active_tasks",
  "memory",
  "perception",
  "task_options",
  "decision_reason",
]);

type ContributorSections = ReadonlyMap<PromptSectionPlacement, readonly string[]>;

function renderContributors(definition: AgentDefinition): ContributorSections {
  const sections = new Map<PromptSectionPlacement, string[]>();
  for (const contributor of [...(definition.promptContributors ?? [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (!PLACEMENTS.has(contributor.placement)) {
      throw new Error(`Prompt contributor ${contributor.id} has invalid placement`);
    }
    if (!Number.isInteger(contributor.maxCharacters) || contributor.maxCharacters <= 0) {
      throw new Error(`Prompt contributor ${contributor.id} has invalid character limit`);
    }
    const content = contributor.render();
    if (content.length > contributor.maxCharacters) {
      throw new Error(`Prompt contributor ${contributor.id} exceeds its character limit`);
    }
    const existing = sections.get(contributor.placement) ?? [];
    existing.push(content);
    sections.set(contributor.placement, existing);
  }
  return sections;
}

function section(
  heading: string,
  key: PromptSection,
  body: string,
  additions: readonly string[] = [],
): string {
  const content = additions.length === 0 ? body : `${body}\n${additions.join("\n")}`;
  return assertPromptSectionFits(key, `${heading}\n${content}`);
}

export function assembleDecisionRequest(
  inputValue: DecisionPromptInput,
  agentDefinition: AgentDefinition,
): ModelDecisionRequest {
  const input = DecisionPromptInputSchema.parse(inputValue);
  if (agentDefinition.id.length === 0 || agentDefinition.displayName.length === 0) {
    throw new Error("Agent definition is incomplete");
  }
  const additions = renderContributors(agentDefinition);
  const coreRules = section(
    "[CORE RULES]",
    "core_rules",
    [
      "Return one decision for HEAD and one decision for BODY.",
      "For each track, either continue its current task or replace it with an offered task option for that track.",
      "Use only the character's listed sensations, memories, perception, and active tasks.",
      "Do not invent hidden world facts or execution steps; the program handles movement and interaction.",
      "Return only the required JSON object.",
    ].join("\n"),
  );
  const persona = section(
    "[PERSONA]",
    "persona",
    JSON.stringify(
      {
        name: agentDefinition.displayName,
        background: agentDefinition.persona.background,
        personality: agentDefinition.persona.personality,
        values: agentDefinition.persona.values,
        language: agentDefinition.persona.language,
        thinkingStyle: agentDefinition.persona.thinkingStyle,
      },
      null,
      2,
    ),
    additions.get("persona"),
  );
  const bodyState = section(
    "[BODY STATE]",
    "body_state",
    JSON.stringify(input.bodySensations, null, 2),
    additions.get("body_state"),
  );
  const activeTasks = section(
    "[ACTIVE TASKS]",
    "active_tasks",
    JSON.stringify(input.activeTasks, null, 2),
    additions.get("active_tasks"),
  );
  const memories = section(
    "[RELEVANT MEMORIES]",
    "memory",
    JSON.stringify(selectRelevantMemories(input), null, 2),
    additions.get("memory"),
  );
  const perception = section(
    "[CURRENT PERCEPTION]",
    "perception",
    JSON.stringify(input.perception, null, 2),
    additions.get("perception"),
  );
  const taskOptions = section(
    "[TASK OPTIONS]",
    "task_options",
    JSON.stringify(input.taskOptions, null, 2),
    additions.get("task_options"),
  );
  const reason = section(
    "[DECISION REASON]",
    "decision_reason",
    JSON.stringify(input.decisionReason, null, 2),
    additions.get("decision_reason"),
  );
  const responseFormat = section(
    "[RESPONSE FORMAT]",
    "response_format",
    '{"schemaVersion":2,"head":{"kind":"continue"},"body":{"kind":"replace","taskOptionId":"<offered ID>","arguments":{}},"reason":"<brief reason>"}',
  );

  return ModelDecisionRequestSchema.parse({
    requestId: input.requestId,
    agentId: input.agentId,
    worldId: input.worldId,
    worldVersion: input.worldVersion,
    decisionCycleId: input.decisionCycleId,
    schemaVersion: input.schemaVersion,
    pluginLockHash: input.pluginLockHash,
    ...(input.retryOfRequestId === undefined
      ? {}
      : { retryOfRequestId: input.retryOfRequestId }),
    decisionReason: input.decisionReason,
    messages: [
      { role: "system", content: `${coreRules}\n\n${persona}` },
      {
        role: "user",
        content: [
          bodyState,
          activeTasks,
          memories,
          perception,
          taskOptions,
          reason,
          responseFormat,
        ].join("\n\n"),
      },
    ],
    taskOptions: input.taskOptions,
  });
}
