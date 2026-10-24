import { z } from "zod";

import {
  AgentIdSchema,
  EntityIdSchema,
  OperationCallIdSchema,
  type AgentId,
} from "../identity/ids";
import {
  ExternallyVisibleAppearanceSchema,
  PublicBehaviorProjectionSchema,
} from "../items/item-appearance";
import { JsonValueSchema } from "../json/json-value";
import { CoordinateSchema, FacingSchema } from "../world/coordinate";

export const RelativeDirectionSchema = z.enum([
  "same_position",
  "front",
  "front_right",
  "right",
  "back_right",
  "back",
  "back_left",
  "left",
  "front_left",
  "unknown",
]);
export type RelativeDirection = z.infer<typeof RelativeDirectionSchema>;

export const PerceptionDistanceBandSchema = z.enum(["immediate", "near", "far"]);
export type PerceptionDistanceBand = z.infer<typeof PerceptionDistanceBandSchema>;

export const MovementTrajectoryPointSchema = z
  .object({
    position: CoordinateSchema,
    facing: FacingSchema,
  })
  .strict();
export type MovementTrajectoryPoint = z.infer<typeof MovementTrajectoryPointSchema>;

export const MovementTrajectorySchema = z
  .object({
    points: z.array(MovementTrajectoryPointSchema).min(1),
  })
  .strict();
export type MovementTrajectory = z.infer<typeof MovementTrajectorySchema>;

const NearbyObservationBaseShape = {
  category: z.string().min(1).max(160),
  summary: z.string().min(1).max(500),
};

export const NearbyAgentObservationSchema = z
  .object({
    kind: z.literal("agent"),
    entityId: EntityIdSchema,
    ...NearbyObservationBaseShape,
    publicBehavior: PublicBehaviorProjectionSchema,
    externallyVisible: ExternallyVisibleAppearanceSchema,
  })
  .strict();

export const NearbyObjectObservationSchema = z
  .object({
    kind: z.literal("object"),
    entityId: EntityIdSchema,
    ...NearbyObservationBaseShape,
  })
  .strict();

export const NearbyObservationSchema = z.discriminatedUnion("kind", [
  NearbyAgentObservationSchema,
  NearbyObjectObservationSchema,
]);
export type NearbyObservation = z.infer<typeof NearbyObservationSchema>;

export const NearbyObservationBatchSchema = z
  .object({
    observations: z.array(NearbyObservationSchema),
  })
  .strict();
export type NearbyObservationBatch = z.infer<typeof NearbyObservationBatchSchema>;

export const VisibleAgentProjectionSchema = z
  .object({
    agentId: AgentIdSchema,
    displayName: z.string().min(1).max(160),
    direction: RelativeDirectionSchema,
    distanceBand: PerceptionDistanceBandSchema,
    publicBehavior: PublicBehaviorProjectionSchema,
    externallyVisible: ExternallyVisibleAppearanceSchema,
  })
  .strict();
export type VisibleAgentProjection = z.infer<typeof VisibleAgentProjectionSchema>;

export const VisibleObjectProjectionSchema = z
  .object({
    entityId: EntityIdSchema,
    category: z.string().min(1).max(160),
    direction: RelativeDirectionSchema,
    distanceBand: PerceptionDistanceBandSchema,
    publicState: JsonValueSchema,
  })
  .strict();
export type VisibleObjectProjection = z.infer<typeof VisibleObjectProjectionSchema>;

export const VisualEntityStateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("agent"),
      agent: VisibleAgentProjectionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("object"),
      object: VisibleObjectProjectionSchema,
    })
    .strict(),
]);
export type VisualEntityState = z.infer<typeof VisualEntityStateSchema>;

export const ContinuousVisualStateSchema = z
  .object({
    visibleEntities: z.array(VisualEntityStateSchema),
  })
  .strict();
export type ContinuousVisualState = z.infer<typeof ContinuousVisualStateSchema>;

/** 当前冻结点的私有视线快照，不包含世界坐标或 operation 候选清单。 */
export const PerceptionNowSchema = z
  .object({
    visibleEntities: z.array(VisualEntityStateSchema),
  })
  .strict();
export type PerceptionNow = z.infer<typeof PerceptionNowSchema>;

export const MovePerceptionSnapshotSchema = z
  .object({
    callId: OperationCallIdSchema,
    accumulated: z.array(NearbyObservationSchema),
    deliveryCursor: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.deliveryCursor > value.accumulated.length) {
      context.addIssue({
        code: "custom",
        path: ["deliveryCursor"],
        message: "Delivery cursor cannot exceed accumulated observations",
      });
    }
  });
export type MovePerceptionSnapshot = z.infer<typeof MovePerceptionSnapshotSchema>;

export const AgentVisualSnapshotSchema = z
  .object({
    agentId: AgentIdSchema,
    continuous: ContinuousVisualStateSchema,
    moveCalls: z.array(MovePerceptionSnapshotSchema),
  })
  .strict();
export type AgentVisualSnapshot = z.infer<typeof AgentVisualSnapshotSchema>;

export interface PerceptionProjectionPort {
  projectNow(agentId: AgentId): PerceptionNow;
  projectContinuous(agentId: AgentId): ContinuousVisualState;
  collectTrajectoryObservations(
    agentId: AgentId,
    trajectory: MovementTrajectory,
  ): readonly NearbyObservation[];
}

export type DirectionProjectionInput = {
  readonly observerPosition: z.infer<typeof CoordinateSchema>;
  readonly observerFacing: z.infer<typeof FacingSchema>;
  readonly targetPosition: z.infer<typeof CoordinateSchema>;
};
