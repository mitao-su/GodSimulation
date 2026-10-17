import { z } from "zod";

import {
  CapabilityListSchema,
  ClothingStyleAnchorSchema,
  ItemCapacityUnitsSchema,
  ItemDefinitionIdSchema,
  ItemDefinitionVersionSchema,
  ItemInstanceSchema,
  type ClothingStyleAnchor,
  type ItemCapacityUnits,
  type ItemDefinitionId,
} from "@god-sim/protocol";

export const ItemKindSchema = z.enum(["generic", "clothing"]);
export type ItemKind = z.infer<typeof ItemKindSchema>;

export interface ItemDefinition<State = unknown> {
  readonly id: ItemDefinitionId;
  readonly version: string;
  readonly displayName: string;
  readonly kind: ItemKind;
  readonly tags: readonly string[];
  readonly capabilities: readonly string[];
  /** 单件容量占用；实例数量由世界按整数乘法计算。 */
  readonly capacityUnits: ItemCapacityUnits;
  readonly stateSchema: z.ZodType<State>;
  initialState(): State;
  readonly clothing?: ClothingStyleAnchor;
}

export function assertItemDefinition<State>(definition: ItemDefinition<State>): void {
  ItemDefinitionIdSchema.parse(definition.id);
  ItemDefinitionVersionSchema.parse(definition.version);
  if (definition.displayName.length === 0) {
    throw new Error(`Item ${definition.id} requires a display name`);
  }
  ItemKindSchema.parse(definition.kind);
  z.array(z.string().min(1).max(128)).parse(definition.tags);
  CapabilityListSchema.parse(definition.capabilities);
  ItemCapacityUnitsSchema.parse(definition.capacityUnits);
  if (definition.kind === "clothing") {
    if (definition.clothing === undefined) {
      throw new Error(`Clothing item ${definition.id} requires a style anchor`);
    }
    ClothingStyleAnchorSchema.parse(definition.clothing);
  } else if (definition.clothing !== undefined) {
    throw new Error(`Generic item ${definition.id} cannot declare a clothing style anchor`);
  }
  ItemInstanceSchema.shape.state.parse(definition.stateSchema.parse(definition.initialState()));
}

