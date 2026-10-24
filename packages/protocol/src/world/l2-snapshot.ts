import { z } from "zod";

import { ItemInstanceSchema } from "../items/item-appearance";
import { AgentBodyFactsSnapshotSchema } from "../items/item-appearance";
import { AgentVisualSnapshotSchema } from "../perception/perception-contract";

/** L2 只声明字段片段；线上 WorldSnapshot 版本由 W2-X 统一升级。 */
export const L2ItemAppearanceSnapshotFieldsSchema = z
  .object({
    items: z.array(ItemInstanceSchema),
    agents: z.array(AgentBodyFactsSnapshotSchema),
  })
  .strict();
export type L2ItemAppearanceSnapshotFields = z.infer<
  typeof L2ItemAppearanceSnapshotFieldsSchema
>;

export const L2VisualSnapshotFieldsSchema = z
  .object({
    agents: z.array(AgentVisualSnapshotSchema),
  })
  .strict();
export type L2VisualSnapshotFields = z.infer<typeof L2VisualSnapshotFieldsSchema>;

export const L2SnapshotFieldsSchema = z
  .object({
    itemAppearance: L2ItemAppearanceSnapshotFieldsSchema,
    visual: L2VisualSnapshotFieldsSchema,
  })
  .strict();
export type L2SnapshotFields = z.infer<typeof L2SnapshotFieldsSchema>;
