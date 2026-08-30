import type { MemoryExtractor } from "../memory/memory-extractor";
import type { PromptContributor } from "../prompt/prompt-contributor";

export interface AgentPersona {
  readonly background: string;
  readonly personality: string;
  readonly values: readonly string[];
  readonly language: string;
  readonly thinkingStyle: string;
}

export interface InitialMemoryDefinition {
  readonly id: string;
  readonly summary: string;
}

export interface AgentDefinition {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly persona: AgentPersona;
  readonly initialMemories: readonly InitialMemoryDefinition[];
  readonly resourceId: string;
  readonly animationSetId: string;
  readonly promptContributors?: readonly PromptContributor[];
  readonly memoryExtractor?: MemoryExtractor;
}
