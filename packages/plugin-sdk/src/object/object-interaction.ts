import { z } from "zod";

import { AgentIdSchema, CoordinateSchema, EntityIdSchema } from "@god-sim/protocol";

import { BodySlotSchema, type BodySlot } from "../capability/body-slot";
import type { EffectProposal } from "../effect/effect-proposal";
import { TriggerSourceSchema } from "../trigger/trigger-source";

export const InteractionContextSchema = z
  .object({
    worldTick: z.number().int().nonnegative(),
    trigger: TriggerSourceSchema,
    object: z
      .object({
        entityId: EntityIdSchema,
        version: z.number().int().nonnegative(),
      })
      .strict(),
    actor: z
      .object({
        agentId: AgentIdSchema,
        position: CoordinateSchema,
        needs: z.object({ bladder: z.number().int().min(0).max(100) }).strict(),
      })
      .strict(),
    distance: z.number().int().nonnegative(),
  })
  .strict();

export type InteractionContext = z.infer<typeof InteractionContextSchema>;

export const InteractionAvailabilitySchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(true) }).strict(),
  z
    .object({
      available: z.literal(false),
      reasonCode: z.string().min(1),
      summary: z.string().min(1).max(500),
    })
    .strict(),
]);

export type InteractionAvailability = z.infer<typeof InteractionAvailabilitySchema>;

export interface InteractionDefinition<State> {
  readonly id: string;
  readonly displayName: string;
  readonly trigger: "active_command";
  readonly durationTicks: number;
  readonly slots: readonly BodySlot[];
  canStart(state: Readonly<State>, context: InteractionContext): InteractionAvailability;
  start?(state: Readonly<State>, context: InteractionContext): EffectProposal;
  complete(state: Readonly<State>, context: InteractionContext): EffectProposal;
}

export const InteractionMetadataSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    trigger: z.literal("active_command"),
    durationTicks: z.number().int().nonnegative(),
    slots: z.array(BodySlotSchema),
  })
  .strict();
