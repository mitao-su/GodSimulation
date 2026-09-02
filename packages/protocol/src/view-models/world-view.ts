import { z } from "zod";

import { DomainEventSchema } from "../events/domain-event";
import { OperationDurationSchema } from "../execution/task-contract";
import {
  AgentIdSchema,
  EntityIdSchema,
  OperationCallIdSchema,
  OperationIdSchema,
  RequestIdSchema,
  WorldIdSchema,
} from "../identity/ids";
import { CoordinateSchema, FacingSchema } from "../world/coordinate";
import { TechnicalFailureSchema } from "../world/technical-failure";
import { WorldModeSchema } from "../world/world-mode";

export const PauseReasonViewSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1).max(500),
    agentIds: z.array(AgentIdSchema),
  })
  .strict();

export const ZoneViewSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    cells: z.array(CoordinateSchema),
  })
  .strict();

export const TileViewSchema = z
  .object({
    position: CoordinateSchema,
    resourceId: z.string().min(1),
    frameId: z.string().min(1),
    renderLayer: z.number().int(),
  })
  .strict();

export const MapViewSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    tileSize: z.literal(16),
    zones: z.array(ZoneViewSchema),
    tiles: z.array(TileViewSchema),
  })
  .strict();

export const RenderEntityViewSchema = z
  .object({
    entityId: EntityIdSchema,
    kind: z.enum(["agent", "object"]),
    displayName: z.string().min(1),
    resourceId: z.string().min(1),
    position: CoordinateSchema,
    facing: FacingSchema,
    renderLayer: z.number().int(),
    status: z.string().min(1),
  })
  .strict();

export const AgentTaskViewSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("empty"),
      label: z.null(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("operation"),
      callId: OperationCallIdSchema,
      operationId: OperationIdSchema,
      label: z.string().min(1).max(160),
      duration: OperationDurationSchema,
      progressTicks: z.number().int().nonnegative(),
    })
    .strict(),
]);

export const AgentSummaryViewSchema = z
  .object({
    agentId: AgentIdSchema,
    displayName: z.string().min(1),
    headTask: AgentTaskViewSchema,
    bodyTask: AgentTaskViewSchema,
    bladderLevel: z.enum(["comfortable", "noticeable", "urgent"]),
    decisionStatus: z.enum(["none", "thinking", "ready", "error"]),
    perceivedSummaries: z.array(z.string()),
    memorySummaries: z.array(z.string()),
  })
  .strict();

export const PendingDecisionViewSchema = z
  .object({
    requestId: RequestIdSchema,
    agentId: AgentIdSchema,
    status: z.enum(["pending", "ready", "error"]),
    reason: z.string().min(1),
    proposalReason: z.string().min(1).nullable(),
    error: TechnicalFailureSchema.nullable(),
  })
  .strict();

export const GameTimeViewSchema = z
  .object({
    day: z.number().int().positive(),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  })
  .strict();
export type GameTimeView = z.infer<typeof GameTimeViewSchema>;

export const WorldViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    worldId: WorldIdSchema,
    worldName: z.string().min(1),
    worldVersion: z.number().int().nonnegative(),
    worldTick: z.number().int().nonnegative(),
    gameTime: GameTimeViewSchema,
    mode: WorldModeSchema,
    reviewRequired: z.boolean(),
    pauseReason: PauseReasonViewSchema.nullable(),
    map: MapViewSchema,
    entities: z.array(RenderEntityViewSchema),
    agents: z.array(AgentSummaryViewSchema),
    pendingDecisions: z.array(PendingDecisionViewSchema),
    recentEvents: z.array(DomainEventSchema),
    technicalFailure: TechnicalFailureSchema.nullable(),
  })
  .strict();

export type WorldView = z.infer<typeof WorldViewSchema>;
