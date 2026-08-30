import { z } from "zod";

import {
  AgentIdSchema,
  CoordinateSchema,
  EntityIdSchema,
  FacingSchema,
  JsonValueSchema,
  WorldIdSchema,
} from "@god-sim/protocol";

const DefinitionIdSchema = z.string().min(1).max(128);
const ResourceIdSchema = z.string().min(1).max(160);

export const PluginReferenceSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
  })
  .strict();

export const FloorRegionSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    resourceId: ResourceIdSchema,
    frameId: z.string().min(1),
  })
  .strict();

export const ZoneDefinitionSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(160),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const ObjectPlacementSchema = z
  .object({
    id: EntityIdSchema,
    definitionId: DefinitionIdSchema,
    position: CoordinateSchema,
    facing: FacingSchema,
    state: JsonValueSchema.optional(),
  })
  .strict();

export const AgentSpawnSchema = z
  .object({
    agentId: AgentIdSchema,
    definitionId: DefinitionIdSchema,
    position: CoordinateSchema,
    facing: FacingSchema,
    needs: z.object({ bladder: z.number().int().min(0).max(100) }).strict(),
  })
  .strict();

export const MapDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: WorldIdSchema,
    name: z.string().min(1).max(160),
    tileSize: z.literal(16),
    width: z.number().int().positive().max(256),
    height: z.number().int().positive().max(256),
    plugins: z.array(PluginReferenceSchema),
    floorRegions: z.array(FloorRegionSchema),
    zones: z.array(ZoneDefinitionSchema).min(1),
    objects: z.array(ObjectPlacementSchema),
    spawns: z.array(AgentSpawnSchema).min(1),
  })
  .strict();

export type MapDefinition = z.infer<typeof MapDefinitionSchema>;
export type FloorRegion = z.infer<typeof FloorRegionSchema>;
export type ZoneDefinition = z.infer<typeof ZoneDefinitionSchema>;
export type ObjectPlacement = z.infer<typeof ObjectPlacementSchema>;
export type AgentSpawn = z.infer<typeof AgentSpawnSchema>;
