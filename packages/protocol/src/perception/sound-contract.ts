import { z } from "zod";

import {
  AgentIdSchema,
  EntityIdSchema,
  EnvironmentSourceIdSchema,
} from "../identity/ids";
import { JsonObjectSchema } from "../json/json-value";
import { SoundRulesSchema } from "../rules/simulation-rules";
import { CoordinateSchema, FacingSchema } from "../world/coordinate";
import { RelativeDirectionSchema } from "./perception-contract";

export const SoundSourceKindSchema = z.enum(["agent", "object", "environment"]);
export type SoundSourceKind = z.infer<typeof SoundSourceKindSchema>;

export const SoundSourceReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("agent"), sourceId: AgentIdSchema })
    .strict(),
  z
    .object({ kind: z.literal("object"), sourceId: EntityIdSchema })
    .strict(),
  z
    .object({ kind: z.literal("environment"), sourceId: EnvironmentSourceIdSchema })
    .strict(),
]);
export type SoundSourceReference = z.infer<typeof SoundSourceReferenceSchema>;

export const SoundPropagationInputSchema = z
  .object({
    source: SoundSourceReferenceSchema,
    soundRules: SoundRulesSchema,
    sourcePosition: CoordinateSchema,
    sourceStrength: z.number().finite().positive(),
    receiverAgentId: AgentIdSchema,
    receiverPosition: CoordinateSchema,
    receiverFacing: FacingSchema,
    distanceTiles: z.number().int().nonnegative(),
    wallCount: z.number().int().nonnegative(),
    openDoorCount: z.number().int().nonnegative(),
    closedDoorCount: z.number().int().nonnegative(),
    blurSample: z.number().finite().min(0).max(1),
    payload: JsonObjectSchema,
  })
  .strict();
export type SoundPropagationInput = z.infer<typeof SoundPropagationInputSchema>;

const SoundPropagationVisibleBaseShape = {
  receiverAgentId: AgentIdSchema,
  receivedStrength: z.number().finite().nonnegative(),
  relativeDirection: RelativeDirectionSchema,
};

export const SoundPropagationResultSchema = z.discriminatedUnion("delivery", [
  z
    .object({
      delivery: z.literal("delivered"),
      ...SoundPropagationVisibleBaseShape,
      source: SoundSourceReferenceSchema,
      payload: JsonObjectSchema,
    })
    .strict(),
  z
    .object({
      delivery: z.literal("muffled"),
      ...SoundPropagationVisibleBaseShape,
      contentClarity: z.literal("distance_unclear"),
      source: SoundSourceReferenceSchema,
      payload: JsonObjectSchema,
    })
    .strict(),
  z
    .object({
      delivery: z.literal("silent"),
      receiverAgentId: AgentIdSchema,
    })
    .strict(),
]);
export type SoundPropagationResult = z.infer<typeof SoundPropagationResultSchema>;

export interface SoundPropagationPort {
  propagate(input: SoundPropagationInput): SoundPropagationResult;
}
