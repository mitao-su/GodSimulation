import type { AgentId, JsonObject } from "@god-sim/protocol";

import type { WorldState } from "../world/world-state";

/**
 * W1-C 的目标补丁预检端口。W4-A2 负责提供严格补丁 Schema、权限和
 * 实际目标状态变更；本层只允许它在放行前拒绝无效补丁，不保存目标状态。
 */
export interface GoalUpdateValidator {
  validate(
    world: WorldState,
    agentId: AgentId,
    goalUpdates: JsonObject | undefined,
  ): GoalUpdateValidationResult;
}

export type GoalUpdateValidationResult =
  | { readonly kind: "valid" }
  | { readonly kind: "invalid"; readonly reason: string };

export function validateGoalUpdates(
  validator: GoalUpdateValidator | undefined,
  world: WorldState,
  agentId: AgentId,
  goalUpdates: JsonObject | undefined,
): string | null {
  if (!validator) return null;
  const result = validator.validate(world, agentId, goalUpdates);
  return result.kind === "invalid" ? result.reason : null;
}
