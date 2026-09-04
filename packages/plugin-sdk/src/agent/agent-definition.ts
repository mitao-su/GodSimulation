import type { MemoryExtractor } from "../memory/memory-extractor";
import type { PromptContributor } from "../prompt/prompt-contributor";
import type { AgentOperationDefinition } from "./agent-operation";

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
  /** W1-A 完成加载迁移前，旧角色定义可以暂时省略该挂载表。 */
  readonly operations?: readonly AgentOperationDefinition[];
  readonly promptContributors?: readonly PromptContributor[];
  readonly memoryExtractor?: MemoryExtractor;
}
