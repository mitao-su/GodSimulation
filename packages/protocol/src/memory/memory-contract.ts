import { z } from "zod";

import {
  AgentIdSchema,
  BranchIdSchema,
  CheckpointIdSchema,
  ConsolidationCycleIdSchema,
  OperationCallIdSchema,
  PluginLockHashSchema,
  RequestIdSchema,
  SimulationRulesHashSchema,
  WorldIdSchema,
} from "../identity/ids";
import { JsonObjectSchema } from "../json/json-value";
import { TechnicalFailureSchema } from "../world/technical-failure";

const NonnegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();
const Sha256HashSchema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * 归档检索结果必须锁定到一个具体的归档、全文索引、向量索引和编码器。
 * 该 DTO 与 timeline 的实现接口保持值语义一致，但 protocol 不依赖 timeline。
 */
export const MemoryArchiveIndexLockSchema = z
  .object({
    archiveVersion: NonnegativeIntegerSchema,
    fullTextIndexVersion: NonnegativeIntegerSchema,
    vectorIndexVersion: NonnegativeIntegerSchema,
    encoder: z
      .object({
        encoderId: z.string().min(1).max(200),
        encoderVersion: z.string().min(1).max(200),
        dimension: PositiveIntegerSchema,
        normalization: z.string().min(1).max(120),
        modelFileIdentity: z.string().min(1).max(500),
      })
      .strict(),
  })
  .strict();
export type MemoryArchiveIndexLock = z.infer<
  typeof MemoryArchiveIndexLockSchema
>;

const MemoryRequestIdentityBaseShape = {
  schemaVersion: z.literal(1),
  requestId: RequestIdSchema,
  worldId: WorldIdSchema,
  branchId: BranchIdSchema,
  agentId: AgentIdSchema,
  checkpointId: CheckpointIdSchema,
  worldVersion: NonnegativeIntegerSchema,
  worldTick: NonnegativeIntegerSchema,
  lastEventSequence: NonnegativeIntegerSchema,
  simulationRulesHash: SimulationRulesHashSchema,
  pluginLockHash: PluginLockHashSchema,
  /** 输入正文的规范化 SHA-256，用于重试幂等和冲突检测。 */
  inputHash: Sha256HashSchema,
};

export const ConsolidationRequestIdentitySchema = z
  .object({
    ...MemoryRequestIdentityBaseShape,
    kind: z.literal("consolidation"),
    consolidationCycleId: ConsolidationCycleIdSchema,
  })
  .strict();

export const RecallRequestIdentitySchema = z
  .object({
    ...MemoryRequestIdentityBaseShape,
    kind: z.literal("recall"),
    operationCallId: OperationCallIdSchema,
    archiveIndexLock: MemoryArchiveIndexLockSchema,
  })
  .strict();

export const MemoryRequestIdentitySchema = z.discriminatedUnion("kind", [
  ConsolidationRequestIdentitySchema,
  RecallRequestIdentitySchema,
]);

export type ConsolidationRequestIdentity = z.infer<
  typeof ConsolidationRequestIdentitySchema
>;
export type RecallRequestIdentity = z.infer<typeof RecallRequestIdentitySchema>;
export type MemoryRequestIdentity = z.infer<typeof MemoryRequestIdentitySchema>;

/**
 * 整理输入由 cognition 负责定义语义，protocol 只保证跨进程边界是 JSON
 * 对象；其 hash 已经写入 identity，host 可据此拒绝同一身份的内容冲突。
 */
export const ConsolidationMemoryRequestSchema = z
  .object({
    identity: ConsolidationRequestIdentitySchema,
    input: JsonObjectSchema,
  })
  .strict();

export const RecallMemoryRequestSchema = z
  .object({
    identity: RecallRequestIdentitySchema,
    query: z.string().min(1).max(20_000),
  })
  .strict();

export const MemoryRequestSchema = z.union([
  ConsolidationMemoryRequestSchema,
  RecallMemoryRequestSchema,
]);

export type ConsolidationMemoryRequest = z.infer<
  typeof ConsolidationMemoryRequestSchema
>;
export type RecallMemoryRequest = z.infer<typeof RecallMemoryRequestSchema>;
export type MemoryRequest = z.infer<typeof MemoryRequestSchema>;

const MemoryResultBaseShape = {
  schemaVersion: z.literal(1),
  request: MemoryRequestIdentitySchema,
  /** host 首次持久化请求时分配；用于请求幂等和结果审计关联。 */
  requestReceiptSequence: PositiveIntegerSchema,
  /** host 第一次持久化结果时分配；重放必须复用该序号。 */
  resultReceiptSequence: PositiveIntegerSchema,
  resultHash: Sha256HashSchema,
};

export const SuccessfulMemoryResultSchema = z
  .object({
    ...MemoryResultBaseShape,
    status: z.literal("succeeded"),
    output: JsonObjectSchema,
  })
  .strict();

export const FailedMemoryResultSchema = z
  .object({
    ...MemoryResultBaseShape,
    status: z.literal("failed"),
    failure: TechnicalFailureSchema,
  })
  .strict();

export const MemoryResultSchema = z.discriminatedUnion("status", [
  SuccessfulMemoryResultSchema,
  FailedMemoryResultSchema,
]);

export type SuccessfulMemoryResult = z.infer<typeof SuccessfulMemoryResultSchema>;
export type FailedMemoryResult = z.infer<typeof FailedMemoryResultSchema>;
export type MemoryResult = z.infer<typeof MemoryResultSchema>;

export const MemoryResultDispositionSchema = z.enum(["applied", "queued", "stale"]);
export type MemoryResultDisposition = z.infer<
  typeof MemoryResultDispositionSchema
>;

export const MemoryResultAcknowledgementSchema = z
  .object({
    schemaVersion: z.literal(1),
    request: MemoryRequestIdentitySchema,
    requestReceiptSequence: PositiveIntegerSchema,
    resultReceiptSequence: PositiveIntegerSchema,
    disposition: MemoryResultDispositionSchema,
    acknowledgedWorldTick: NonnegativeIntegerSchema,
  })
  .strict();
export type MemoryResultAcknowledgement = z.infer<
  typeof MemoryResultAcknowledgementSchema
>;
