import { z } from "zod";

import {
  OperationIdSchema,
  OperationManualSchema,
  type OperationId,
  type OperationManual,
} from "@god-sim/protocol";

export const AgentOperationDefinitionSchema = z
  .object({
    operationId: OperationIdSchema,
    manual: OperationManualSchema,
  })
  .strict()
  .superRefine((definition, context) => {
    if (definition.operationId !== definition.manual.operationId) {
      context.addIssue({
        code: "custom",
        path: ["manual", "operationId"],
        message: "Mounted agent operation ID must match its manual",
      });
    }
  });

/** 角色插件只声明挂载和静态说明书；权威 runtime 由核心注册表绑定。 */
export interface AgentOperationDefinition {
  readonly operationId: OperationId;
  readonly manual: OperationManual;
}
