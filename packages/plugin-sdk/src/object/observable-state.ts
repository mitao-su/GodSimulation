import { z } from "zod";

import { AgentIdSchema, JsonValueSchema } from "@god-sim/protocol";

export const ObservationContextSchema = z
  .object({
    kind: z.enum(["vision", "hearing", "contact", "interaction"]),
    observerAgentId: AgentIdSchema,
  })
  .strict();

export type ObservationContext = z.infer<typeof ObservationContextSchema>;

export const ObservableObjectStateSchema = z
  .object({
    status: z.string().min(1),
    summary: z.string().min(1).max(500),
    details: JsonValueSchema,
  })
  .strict();

export type ObservableObjectState = z.infer<typeof ObservableObjectStateSchema>;
