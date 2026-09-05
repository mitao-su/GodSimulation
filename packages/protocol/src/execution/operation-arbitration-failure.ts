import { z } from "zod";

import { AgentIdSchema, EntityIdSchema } from "../identity/ids";

/**
 * 底层仲裁只报告结构化事实；具体 operation 的业务失败由上层映射。
 * 新增仲裁原因时应在这里增加独立的判别分支及其所需事实。
 */
export const ResourceClaimedArbitrationFailureSchema = z
  .object({
    reasonCode: z.literal("resource_claimed"),
    resourceEntityId: EntityIdSchema,
    winnerAgentId: AgentIdSchema,
  })
  .strict();

export const OperationArbitrationFailureSchema = z.discriminatedUnion(
  "reasonCode",
  [ResourceClaimedArbitrationFailureSchema],
);

export type OperationArbitrationFailure = z.infer<
  typeof OperationArbitrationFailureSchema
>;

export const OperationArbitrationFailureReasonCodeSchema = z.enum([
  "resource_claimed",
]);

export type OperationArbitrationFailureReasonCode = z.infer<
  typeof OperationArbitrationFailureReasonCodeSchema
>;
