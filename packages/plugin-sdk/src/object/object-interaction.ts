import { z } from "zod";

import {
  AgentIdSchema,
  CoordinateSchema,
  EntityIdSchema,
  type JsonObject,
} from "@god-sim/protocol";

import type { EffectProposal } from "../effect/effect-proposal";
import type { OperationContract } from "../operation/operation-contract";
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

export interface InteractionLifecycleProposal extends EffectProposal {
  readonly result?: JsonObject;
}

export interface InteractionDefinition<
  State,
  Arguments extends JsonObject = Record<string, never>,
> extends OperationContract<State, InteractionContext, Arguments> {
  readonly id: string;
  readonly displayName: string;
  readonly trigger: "active_command";
  canStart(
    state: Readonly<State>,
    context: InteractionContext,
    argumentsValue: Readonly<Arguments>,
  ): InteractionAvailability;
  start?(
    state: Readonly<State>,
    context: InteractionContext,
    argumentsValue: Readonly<Arguments>,
  ): EffectProposal;
  complete(
    state: Readonly<State>,
    context: InteractionContext,
    argumentsValue: Readonly<Arguments>,
  ): InteractionLifecycleProposal;
  fail(
    state: Readonly<State>,
    context: InteractionContext,
    argumentsValue: Readonly<Arguments>,
    failureCode: string,
  ): InteractionLifecycleProposal;
  cancel(
    state: Readonly<State>,
    context: InteractionContext,
    argumentsValue: Readonly<Arguments>,
  ): InteractionLifecycleProposal;
}

export const InteractionMetadataSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    trigger: z.literal("active_command"),
  })
  .strict();
