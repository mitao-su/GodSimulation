import type {
  AgentId,
  DecisionCycleId,
  DirectTaskDecision,
  PluginLockHash,
  RequestId,
  TaskDecision,
  WorldId,
} from "@god-sim/protocol";

export interface ModelCallRecord {
  readonly requestId: RequestId;
  readonly worldId: WorldId;
  readonly worldVersion: number;
  readonly agentId: AgentId;
  readonly protocolSchemaVersion: number;
  readonly decisionCycleId: DecisionCycleId;
  readonly pluginLockHash: PluginLockHash;
  readonly decisionReasonCode: string;
  readonly modelId: string;
  readonly status: "accepted" | "failed" | "rejected";
  /** 新请求记录 direct proposal；旧 v2 记录仍可回放。 */
  readonly taskDecision: TaskDecision | DirectTaskDecision | null;
  readonly responseReason: string | null;
  readonly latencyMs: number;
  readonly retryOfRequestId: RequestId | null;
  readonly recordedAtRealTime: string;
}
