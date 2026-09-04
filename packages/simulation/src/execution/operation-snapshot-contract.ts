import { z } from "zod";

import {
  CanonicalTaskTracksSchema,
  DirectTaskDecisionSchema,
  JsonObjectSchema,
  OperationCallIdSchema,
  OperationDurationSchema,
  OperationFirstStepStateSchema,
  OperationHostReferenceSchema,
  OperationIdSchema,
  OperationTargetReferenceSchema,
  OperationTerminationRecordSchema,
} from "@god-sim/protocol";

export const L1ActiveOperationSnapshotFieldsSchema = z
  .object({
    callId: OperationCallIdSchema,
    operationId: OperationIdSchema,
    host: OperationHostReferenceSchema,
    target: OperationTargetReferenceSchema,
    taskSlots: CanonicalTaskTracksSchema,
    arguments: JsonObjectSchema,
    duration: OperationDurationSchema,
    startedAtTick: z.number().int().nonnegative(),
    progressTicks: z.number().int().nonnegative(),
    firstStepState: OperationFirstStepStateSchema,
    state: JsonObjectSchema,
  })
  .strict();
export type L1ActiveOperationSnapshotFields = z.infer<
  typeof L1ActiveOperationSnapshotFieldsSchema
>;

export const L1OperationTerminationSnapshotFieldsSchema =
  OperationTerminationRecordSchema;
export type L1OperationTerminationSnapshotFields = z.infer<
  typeof L1OperationTerminationSnapshotFieldsSchema
>;

export const L1DecisionRequestSnapshotFieldsSchema = z
  .object({
    acceptedProposal: DirectTaskDecisionSchema.nullable(),
  })
  .strict();
export type L1DecisionRequestSnapshotFields = z.infer<
  typeof L1DecisionRequestSnapshotFieldsSchema
>;

export interface L1OperationSnapshotSerializationPort<
  RuntimeOperation,
  RuntimeTermination,
> {
  serializeOperation(
    operation: RuntimeOperation,
  ): L1ActiveOperationSnapshotFields;
  deserializeOperation(
    fields: L1ActiveOperationSnapshotFields,
  ): RuntimeOperation;
  serializeTermination(
    termination: RuntimeTermination,
  ): L1OperationTerminationSnapshotFields;
  deserializeTermination(
    fields: L1OperationTerminationSnapshotFields,
  ): RuntimeTermination;
}

export interface L1DecisionSnapshotSerializationPort<RuntimeDecisionRequest> {
  serializeDecisionRequest(
    request: RuntimeDecisionRequest,
  ): L1DecisionRequestSnapshotFields;
  deserializeDecisionRequest(
    fields: L1DecisionRequestSnapshotFields,
  ): RuntimeDecisionRequest;
}
