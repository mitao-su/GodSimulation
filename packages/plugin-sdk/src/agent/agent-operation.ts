import { z } from "zod";

import {
  OperationIdSchema,
  OperationManualSchema,
  OperationTargetRequirementSchema,
  type JsonObject,
  type OperationId,
} from "@god-sim/protocol";

import type { HostOperationContract } from "../operation/operation-contract";

function sameTargetRequirement(
  left: z.infer<typeof OperationTargetRequirementSchema>,
  right: z.infer<typeof OperationTargetRequirementSchema>,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== "object" || right.kind !== "object") return true;
  return (
    left.requiredCapabilities.length === right.requiredCapabilities.length &&
    left.requiredCapabilities.every(
      (capability, index) => capability === right.requiredCapabilities[index],
    )
  );
}

export const AgentOperationDefinitionSchema = z
  .object({
    id: OperationIdSchema,
    displayName: z.string().min(1).max(160),
    trigger: z.literal("active_command"),
    manual: OperationManualSchema,
    target: OperationTargetRequirementSchema,
  })
  .strict()
  .superRefine((definition, context) => {
    if (definition.id !== definition.manual.operationId) {
      context.addIssue({
        code: "custom",
        path: ["manual", "operationId"],
        message: "Agent operation ID must match its manual",
      });
    }
    if (definition.displayName !== definition.manual.displayName) {
      context.addIssue({
        code: "custom",
        path: ["manual", "displayName"],
        message: "Agent operation display name must match its manual",
      });
    }
    if (!sameTargetRequirement(definition.target, definition.manual.target)) {
      context.addIssue({
        code: "custom",
        path: ["manual", "target"],
        message: "Agent operation target must match its manual",
      });
    }
  });

export interface AgentOperationDefinition<
  State = JsonObject,
  Context = unknown,
  Arguments extends JsonObject = JsonObject,
> extends HostOperationContract<State, Context, Arguments> {
  readonly id: OperationId;
  readonly displayName: string;
  readonly trigger: "active_command";
}
