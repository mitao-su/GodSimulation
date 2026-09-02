import { z } from "zod";

import {
  AgentIdSchema,
  CoordinateSchema,
  type JsonObject,
} from "@god-sim/protocol";

import type { InteractionDefinition } from "./object-interaction";
import type { ObservableObjectState, ObservationContext } from "./observable-state";

export const PlacementCapabilitySchema = z
  .object({
    kind: z.enum(["cell", "edge"]),
    footprint: z.array(CoordinateSchema).min(1),
    interactionOffsets: z
      .array(z.object({ x: z.number().int(), y: z.number().int() }).strict())
      .min(1),
  })
  .strict();

export type PlacementCapability = z.infer<typeof PlacementCapabilitySchema>;

export const QueryContextSchema = z
  .object({
    worldTick: z.number().int().nonnegative(),
    queryingAgentId: AgentIdSchema.optional(),
  })
  .strict();

export type QueryContext = z.infer<typeof QueryContextSchema>;

export interface MovementCapability<State> {
  blocksMovement(state: Readonly<State>, context: QueryContext): boolean;
}

export interface VisionCapability<State> {
  blocksVision(state: Readonly<State>, context: QueryContext): boolean;
}

export interface AutomaticTraversalCapability {
  readonly interactionId: string;
}

export interface OccupancyCapability<State> {
  readonly capacity: number;
  occupant(state: Readonly<State>): string | null;
  withOccupant(state: Readonly<State>, occupant: string | null): State;
}

export interface ObjectDefinition<State = unknown> {
  readonly id: string;
  readonly version: string;
  readonly stateVersion: number;
  readonly displayName: string;
  readonly tags: readonly string[];
  readonly stateSchema: z.ZodType<State>;
  initialState(): State;
  readonly resourceId: string;
  readonly placement: PlacementCapability;
  readonly movement?: MovementCapability<State>;
  readonly vision?: VisionCapability<State>;
  readonly traversal?: AutomaticTraversalCapability;
  readonly occupancy?: OccupancyCapability<State>;
  readonly interactions: readonly InteractionDefinition<State, JsonObject>[];
  observe(state: Readonly<State>, context: ObservationContext): ObservableObjectState;
}
