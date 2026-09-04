import { z } from "zod";

import {
  AgentIdSchema,
  EntityIdSchema,
  OperationCallIdSchema,
  OperationIdSchema,
} from "../identity/ids";
import { JsonObjectSchema } from "../json/json-value";
import { TechnicalFailureCategorySchema } from "../world/technical-failure";
import { CanonicalTaskTracksSchema } from "./task-contract";

export const OperationHostDefinitionIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const CapabilityIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9._:-]*$/);

function rejectDuplicateCapabilities(
  capabilities: readonly string[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const [index, capability] of capabilities.entries()) {
    if (seen.has(capability)) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: `Duplicate capability ${capability}`,
      });
    }
    seen.add(capability);
  }
}

export const CapabilityListSchema = z
  .array(CapabilityIdSchema)
  .superRefine(rejectDuplicateCapabilities);

export const RequiredCapabilitiesSchema = z
  .array(CapabilityIdSchema)
  .min(1)
  .superRefine(rejectDuplicateCapabilities);

export const OperationHostKindSchema = z.enum([
  "agent",
  "item",
  "furniture",
]);
export type OperationHostKind = z.infer<typeof OperationHostKindSchema>;

export const AgentOperationHostReferenceSchema = z
  .object({
    kind: z.literal("agent"),
    hostEntityId: AgentIdSchema,
  })
  .strict();

export const ItemOperationHostReferenceSchema = z
  .object({
    kind: z.literal("item"),
    hostEntityId: EntityIdSchema,
  })
  .strict();

export const FurnitureOperationHostReferenceSchema = z
  .object({
    kind: z.literal("furniture"),
    hostEntityId: EntityIdSchema,
  })
  .strict();

export const OperationHostReferenceSchema = z.discriminatedUnion("kind", [
  AgentOperationHostReferenceSchema,
  ItemOperationHostReferenceSchema,
  FurnitureOperationHostReferenceSchema,
]);
export type OperationHostReference = z.infer<
  typeof OperationHostReferenceSchema
>;

const operationHostDefinitionReference = <Kind extends OperationHostKind>(
  kind: Kind,
) =>
  z
    .object({
      kind: z.literal(kind),
      hostDefinitionId: OperationHostDefinitionIdSchema,
    })
    .strict();

export const OperationHostDefinitionReferenceSchema = z.discriminatedUnion(
  "kind",
  [
    operationHostDefinitionReference("agent"),
    operationHostDefinitionReference("item"),
    operationHostDefinitionReference("furniture"),
  ],
);
export type OperationHostDefinitionReference = z.infer<
  typeof OperationHostDefinitionReferenceSchema
>;

export const OperationTargetRequirementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("character") }).strict(),
  z
    .object({
      kind: z.literal("object"),
      requiredCapabilities: RequiredCapabilitiesSchema,
    })
    .strict(),
]);
export type OperationTargetRequirement = z.infer<
  typeof OperationTargetRequirementSchema
>;

export const OperationTargetReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("character"),
      targetCharacterId: AgentIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("object"),
      targetEntityId: EntityIdSchema,
    })
    .strict(),
]);
export type OperationTargetReference = z.infer<
  typeof OperationTargetReferenceSchema
>;

export const OperationDomainFailureCodeSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9_]*$/);
export type OperationDomainFailureCode = z.infer<
  typeof OperationDomainFailureCodeSchema
>;

export const OperationManualPreconditionSchema = z
  .object({
    failureCode: OperationDomainFailureCodeSchema,
    description: z.string().min(1).max(500),
  })
  .strict();

export const OperationManualSchema = z
  .object({
    operationId: OperationIdSchema,
    displayName: z.string().min(1).max(160),
    summary: z.string().min(1).max(1_000),
    taskSlots: CanonicalTaskTracksSchema,
    parametersSchema: JsonObjectSchema,
    target: OperationTargetRequirementSchema,
    duration: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("fixed") }).strict(),
      z.object({ kind: z.literal("indeterminate") }).strict(),
    ]),
    worldPreconditions: z.array(OperationManualPreconditionSchema),
  })
  .strict();
export type OperationManual = z.infer<typeof OperationManualSchema>;

export const DirectOperationReferenceSchema = z
  .object({
    kind: z.literal("operation"),
    operationId: OperationIdSchema,
    hostEntityId: EntityIdSchema.optional(),
    arguments: JsonObjectSchema,
  })
  .strict();
export type DirectOperationReference = z.infer<
  typeof DirectOperationReferenceSchema
>;

export const EmptyTaskReferenceSchema = z
  .object({ kind: z.literal("empty_task") })
  .strict();
export type EmptyTaskReference = z.infer<typeof EmptyTaskReferenceSchema>;

export const DirectTaskReplacementSchema = z.discriminatedUnion("kind", [
  EmptyTaskReferenceSchema,
  DirectOperationReferenceSchema,
]);
export type DirectTaskReplacement = z.infer<
  typeof DirectTaskReplacementSchema
>;

export const DirectTaskSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("continue") }).strict(),
  z
    .object({
      kind: z.literal("replace"),
      task: DirectTaskReplacementSchema,
    })
    .strict(),
]);
export type DirectTaskSelection = z.infer<typeof DirectTaskSelectionSchema>;

export const DirectTaskDecisionSchema = z
  .object({
    schemaVersion: z.literal(3),
    head: DirectTaskSelectionSchema,
    body: DirectTaskSelectionSchema,
    reason: z.string().min(1).max(500),
  })
  .strict();
export type DirectTaskDecision = z.infer<typeof DirectTaskDecisionSchema>;

export const OperationDomainFailureSchema = z
  .object({
    kind: z.literal("domain_failure"),
    code: OperationDomainFailureCodeSchema,
    details: JsonObjectSchema,
  })
  .strict();
export type OperationDomainFailure = z.infer<
  typeof OperationDomainFailureSchema
>;

export const OperationTechnicalFailureSchema = z
  .object({
    kind: z.literal("technical_failure"),
    category: TechnicalFailureCategorySchema,
    code: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z][a-z0-9_]*$/),
    message: z.string().min(1).max(2_000),
    retryable: z.boolean(),
  })
  .strict();
export type OperationTechnicalFailure = z.infer<
  typeof OperationTechnicalFailureSchema
>;

export const OperationFailureSchema = z.discriminatedUnion("kind", [
  OperationDomainFailureSchema,
  OperationTechnicalFailureSchema,
]);
export type OperationFailure = z.infer<typeof OperationFailureSchema>;

export const OperationFirstStepStateSchema = z.enum(["pending", "started"]);
export type OperationFirstStepState = z.infer<
  typeof OperationFirstStepStateSchema
>;

export const OperationTerminationSourceSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9_]*$/);
export type OperationTerminationSource = z.infer<
  typeof OperationTerminationSourceSchema
>;

const OperationTerminationBaseShape = {
  callId: OperationCallIdSchema,
  terminatedAtTick: z.number().int().nonnegative(),
  source: OperationTerminationSourceSchema,
};

export const OperationTerminationRecordSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        ...OperationTerminationBaseShape,
        outcome: z.literal("completed"),
      })
      .strict(),
    z
      .object({
        ...OperationTerminationBaseShape,
        outcome: z.literal("failed"),
        failure: OperationDomainFailureSchema,
      })
      .strict(),
    z
      .object({
        ...OperationTerminationBaseShape,
        outcome: z.literal("cancelled"),
      })
      .strict(),
  ],
);
export type OperationTerminationRecord = z.infer<
  typeof OperationTerminationRecordSchema
>;
