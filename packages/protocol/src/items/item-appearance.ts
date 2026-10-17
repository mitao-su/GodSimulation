import { z } from "zod";

import {
  AgentIdSchema,
  ItemDefinitionIdSchema,
  ItemInstanceIdSchema,
} from "../identity/ids";
import { JsonObjectSchema, JsonValueSchema } from "../json/json-value";

const NonNegativeIntegerSchema = z.number().int().nonnegative();

export const ItemCapacityUnitsSchema = NonNegativeIntegerSchema;
export type ItemCapacityUnits = z.infer<typeof ItemCapacityUnitsSchema>;

export const ItemQuantitySchema = z.number().int().positive();
export type ItemQuantity = z.infer<typeof ItemQuantitySchema>;

export const ItemDefinitionVersionSchema = z.string().min(1).max(128);
export type ItemDefinitionVersion = z.infer<typeof ItemDefinitionVersionSchema>;

export const ItemOwnershipSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("carried"),
      agentId: AgentIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("worn"),
      agentId: AgentIdSchema,
    })
    .strict(),
]);
export type ItemOwnership = z.infer<typeof ItemOwnershipSchema>;

export const ItemDefinitionReferenceSchema = z
  .object({
    definitionId: ItemDefinitionIdSchema,
    version: ItemDefinitionVersionSchema,
  })
  .strict();
export type ItemDefinitionReference = z.infer<typeof ItemDefinitionReferenceSchema>;

export const ItemInstanceSchema = z
  .object({
    id: ItemInstanceIdSchema,
    definition: ItemDefinitionReferenceSchema,
    version: NonNegativeIntegerSchema,
    quantity: ItemQuantitySchema,
    ownership: ItemOwnershipSchema,
    state: JsonValueSchema,
  })
  .strict();
export type ItemInstance = z.infer<typeof ItemInstanceSchema>;

export const BodyFactsSchema = z
  .object({
    schemaVersion: z.literal(1),
    hairColor: z.string().min(1).max(200).optional(),
    baseHairstyle: z.string().min(1).max(500).optional(),
    build: z.string().min(1).max(200).optional(),
    bodyCharacteristics: z.array(z.string().min(1).max(500)).max(32).optional(),
    permanentMarks: z.array(z.string().min(1).max(500)).max(32).optional(),
  })
  .strict();
export type BodyFacts = z.infer<typeof BodyFactsSchema>;

export const AppearanceSectionSchema = z
  .object({
    head: z.string().min(1).max(2_000),
    upperBody: z.string().min(1).max(2_000),
    lowerBody: z.string().min(1).max(2_000),
  })
  .strict();
export type AppearanceSection = z.infer<typeof AppearanceSectionSchema>;

export const AppearanceDescriptionSchema = z
  .object({
    schemaVersion: z.literal(1),
    externallyVisible: AppearanceSectionSchema,
    internallyHidden: AppearanceSectionSchema,
  })
  .strict();
export type AppearanceDescription = z.infer<typeof AppearanceDescriptionSchema>;

/** 观察者可读取的唯一外观分区；内部衣物信息不在该类型中。 */
export const ExternallyVisibleAppearanceSchema = AppearanceSectionSchema;
export type ExternallyVisibleAppearance = z.infer<
  typeof ExternallyVisibleAppearanceSchema
>;

export const ClothingStyleAnchorSchema = z
  .object({
    schemaVersion: z.literal(1),
    description: z.string().min(1).max(1_000),
    bodyRegions: z
      .array(z.enum(["head", "upper_body", "lower_body"]))
      .min(1)
      .max(3),
  })
  .strict();
export type ClothingStyleAnchor = z.infer<typeof ClothingStyleAnchorSchema>;

export const ClothingInstanceStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    arrangement: z.string().min(1).max(1_000),
  })
  .strict();
export type ClothingInstanceState = z.infer<typeof ClothingInstanceStateSchema>;

export const CharacterAppearanceStateSchema = z
  .object({
    wornItemIds: z.array(ItemInstanceIdSchema),
    description: AppearanceDescriptionSchema,
  })
  .strict();
export type CharacterAppearanceState = z.infer<typeof CharacterAppearanceStateSchema>;

export const PublicBehaviorProjectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hidden") }).strict(),
  z
    .object({
      kind: z.literal("visible"),
      label: z.string().min(1).max(160),
    })
    .strict(),
]);
export type PublicBehaviorProjection = z.infer<
  typeof PublicBehaviorProjectionSchema
>;

/** 对外投影明确不包含 bodyFacts、wornItemIds 或 internallyHidden。 */
export const PublicAppearanceProjectionSchema = z
  .object({
    externallyVisible: ExternallyVisibleAppearanceSchema,
  })
  .strict();
export type PublicAppearanceProjection = z.infer<
  typeof PublicAppearanceProjectionSchema
>;

export const ItemPublicProjectionSchema = z
  .object({
    itemId: ItemInstanceIdSchema,
    definitionId: ItemDefinitionIdSchema,
    displayName: z.string().min(1).max(160),
    quantity: ItemQuantitySchema,
    publicState: JsonObjectSchema,
  })
  .strict();
export type ItemPublicProjection = z.infer<typeof ItemPublicProjectionSchema>;

export interface PublicAppearanceReadPort {
  readonly externallyVisible: ExternallyVisibleAppearance;
  toPublicProjection(): PublicAppearanceProjection;
}

export const AppearanceAfterSchema = z
  .object({
    bodyFacts: BodyFactsSchema,
    appearance: CharacterAppearanceStateSchema,
  })
  .strict();
export type AppearanceAfter = z.infer<typeof AppearanceAfterSchema>;

export const AgentBodyFactsSnapshotSchema = z
  .object({
    agentId: AgentIdSchema,
    bodyFacts: BodyFactsSchema,
    appearance: CharacterAppearanceStateSchema,
  })
  .strict();
export type AgentBodyFactsSnapshot = z.infer<typeof AgentBodyFactsSnapshotSchema>;

