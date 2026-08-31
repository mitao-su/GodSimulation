import type {
  AgentId,
  DecisionCycleId,
  GoalOptionId,
  PluginLockHash,
  RequestId,
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
  readonly goalOptionId: GoalOptionId | null;
  readonly responseReason: string | null;
  readonly latencyMs: number;
  readonly retryOfRequestId: RequestId | null;
  readonly recordedAtRealTime: string;
}
