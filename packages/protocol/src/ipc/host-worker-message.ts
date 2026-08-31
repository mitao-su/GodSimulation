import { z } from "zod";

import { WorldCommandSchema } from "../commands/world-command";
import { DomainEventSchema } from "../events/domain-event";
import {
  CheckpointIdSchema,
  PluginLockHashSchema,
  RequestIdSchema,
} from "../identity/ids";
import { JsonValueSchema } from "../json/json-value";
import {
  DecisionIdentitySchema,
  ModelDecisionRequestSchema,
  ModelDecisionResultSchema,
} from "../model/decision-contract";
import { WorldViewSchema } from "../view-models/world-view";
import { TechnicalFailureSchema } from "../world/technical-failure";
import { WorldSnapshotSchema, WorldSnapshotV2Schema } from "../world/world-snapshot";

export const PluginLockEntrySchema = z
  .object({
    pluginId: z.string().min(1),
    version: z.string().min(1),
    stateVersion: z.number().int().positive(),
    buildHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const PluginLockSchema = z
  .object({
    hash: PluginLockHashSchema,
    entries: z.array(PluginLockEntrySchema).min(1),
  })
  .strict();

const InitializeMessageSchema = z
  .object({
    type: z.literal("initialize"),
    protocolVersion: z.literal(1),
    worldDefinition: JsonValueSchema,
    pluginLock: PluginLockSchema,
    reviewRequired: z.boolean(),
    deterministicSeed: z.number().int().nonnegative(),
    restoredSnapshot: WorldSnapshotSchema.optional(),
  })
  .strict();

const WorldCommandMessageSchema = z
  .object({
    type: z.literal("world_command"),
    command: WorldCommandSchema,
  })
  .strict();

const DecisionResultMessageSchema = z
  .object({
    type: z.literal("decision_result"),
    result: ModelDecisionResultSchema,
  })
  .strict();

const DecisionFailureMessageSchema = z
  .object({
    type: z.literal("decision_failure"),
    failure: TechnicalFailureSchema,
  })
  .strict();

const HostTechnicalFailureMessageSchema = z
  .object({
    type: z.literal("technical_failure"),
    failure: TechnicalFailureSchema,
  })
  .strict();

const RequestSnapshotMessageSchema = z
  .object({
    type: z.literal("request_snapshot"),
    requestId: RequestIdSchema,
  })
  .strict();

const CheckpointCommittedMessageSchema = z
  .object({
    type: z.literal("checkpoint_committed"),
    checkpointId: CheckpointIdSchema,
  })
  .strict();

const ShutdownMessageSchema = z.object({ type: z.literal("shutdown") }).strict();

export const HostToWorkerMessageSchema = z.discriminatedUnion("type", [
  InitializeMessageSchema,
  WorldCommandMessageSchema,
  DecisionResultMessageSchema,
  DecisionFailureMessageSchema,
  HostTechnicalFailureMessageSchema,
  RequestSnapshotMessageSchema,
  CheckpointCommittedMessageSchema,
  ShutdownMessageSchema,
]);

export type HostToWorkerMessage = z.infer<typeof HostToWorkerMessageSchema>;

const WorkerReadyMessageSchema = z
  .object({
    type: z.literal("worker_ready"),
    protocolVersion: z.literal(1),
  })
  .strict();

const DecisionRequestedMessageSchema = z
  .object({
    type: z.literal("decision_requested"),
    request: ModelDecisionRequestSchema,
  })
  .strict();

const DecisionRejectedMessageSchema = z
  .object({
    type: z.literal("decision_rejected"),
    result: DecisionIdentitySchema,
    reason: z.string().min(1).max(500),
  })
  .strict();

const EventBatchMessageSchema = z
  .object({
    type: z.literal("event_batch"),
    events: z.array(DomainEventSchema).min(1),
  })
  .strict();

const SnapshotReadyMessageSchema = z
  .object({
    type: z.literal("snapshot_ready"),
    snapshot: WorldSnapshotSchema,
  })
  .strict();

const CheckpointReadyMessageSchema = z
  .object({
    type: z.literal("checkpoint_ready"),
    checkpointId: CheckpointIdSchema,
    events: z.array(DomainEventSchema),
    snapshot: WorldSnapshotV2Schema,
  })
  .strict();

const WorldViewMessageSchema = z
  .object({
    type: z.literal("world_view"),
    view: WorldViewSchema,
  })
  .strict();

const TechnicalFailureMessageSchema = z
  .object({
    type: z.literal("technical_failure"),
    failure: TechnicalFailureSchema,
  })
  .strict();

export const WorkerToHostMessageSchema = z.discriminatedUnion("type", [
  WorkerReadyMessageSchema,
  DecisionRequestedMessageSchema,
  DecisionRejectedMessageSchema,
  EventBatchMessageSchema,
  SnapshotReadyMessageSchema,
  CheckpointReadyMessageSchema,
  WorldViewMessageSchema,
  TechnicalFailureMessageSchema,
]);

export type WorkerToHostMessage = z.infer<typeof WorkerToHostMessageSchema>;
export type PluginLock = z.infer<typeof PluginLockSchema>;
