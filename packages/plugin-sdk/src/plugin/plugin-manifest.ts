import { z } from "zod";

const DefinitionIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9.-]*$/);

export const PluginManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: DefinitionIdSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    stateVersion: z.number().int().positive(),
    engineApiVersion: z.literal(1),
    entry: z.string().regex(/^\.\/(?!.*\.\.)[^\\]+\.js$/),
    objectDefinitionIds: z.array(DefinitionIdSchema),
    agentDefinitionIds: z.array(DefinitionIdSchema),
  })
  .strict();

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
