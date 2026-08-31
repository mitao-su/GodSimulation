import { z } from "zod";

import { AgentIdSchema, JsonValueSchema } from "@god-sim/protocol";

export const ObservationContextSchema = z
  .object({
    kind: z.enum(["vision", "hearing", "contact", "interaction"]),
    observerAgentId: AgentIdSchema,
  })
  .strict();

export type ObservationContext = z.infer<typeof ObservationContextSchema>;

export const ObservedInteractionAvailabilitySchema = z.discriminatedUnion("available", [
  z
    .object({
      interactionId: z.string().min(1).max(120),
      available: z.literal(true),
    })
    .strict(),
  z
    .object({
      interactionId: z.string().min(1).max(120),
      available: z.literal(false),
      reasonCode: z.string().min(1).max(120),
      summary: z.string().min(1).max(500),
    })
    .strict(),
]);

export type ObservedInteractionAvailability = z.infer<
  typeof ObservedInteractionAvailabilitySchema
>;

export const ObservableObjectStateSchema = z
  .object({
    status: z.string().min(1),
    summary: z.string().min(1).max(500),
    details: JsonValueSchema,
    interactionAvailability: z.array(ObservedInteractionAvailabilitySchema).optional(),
  })
  .strict();

export type ObservableObjectState = z.infer<typeof ObservableObjectStateSchema>;
