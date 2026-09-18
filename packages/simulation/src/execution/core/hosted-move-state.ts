import { z } from "zod";

import { EntityIdSchema, type JsonObject } from "@god-sim/protocol";

import { MoveOperationStateSchema } from "./move-operation";

export const TraversalStateSchema = z.object({
  kind: z.literal("traversal"),
  entityId: EntityIdSchema,
  interactionId: z.string().min(1),
  durationTicks: z.number().int().positive(),
  progressTicks: z.number().int().nonnegative(),
  completed: z.boolean(),
}).strict();

/** 路径随当前世界推导，调用只保留当前微步骤进度和实际观察。 */
export const HostedMoveOperationStateSchema = MoveOperationStateSchema.extend({
  movement: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("walking"), progressTicks: z.number().int().nonnegative() }).strict(),
    TraversalStateSchema,
  ]),
}).strict();
export type HostedMoveState = z.infer<typeof HostedMoveOperationStateSchema>;
export type TraversalState = z.infer<typeof TraversalStateSchema>;

/** 世界提交边界委托 move 自身校验私有步进状态，不以提议者填报的耗时为依据。 */
export function hasElapsedMoveStep(stateValue: JsonObject, ticksPerCell: number): boolean {
  const parsed = HostedMoveOperationStateSchema.safeParse(stateValue);
  if (!parsed.success) return false;
  const movement = parsed.data.movement;
  return (movement.kind === "walking" ? movement.progressTicks : 0) + 1 === ticksPerCell;
}
