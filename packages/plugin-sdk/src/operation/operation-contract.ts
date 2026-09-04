import { z } from "zod";

import {
  CanonicalTaskTracksSchema,
  JsonObjectSchema,
  OperationDomainFailureCodeSchema,
  OperationDomainFailureSchema,
  OperationTechnicalFailureSchema,
  type JsonObject,
  type OperationDomainFailure,
  type OperationDuration,
  type OperationManual,
  type OperationTargetRequirement,
  type TaskTrack,
} from "@god-sim/protocol";

import {
  EffectProposalSchema,
  type EffectProposal,
} from "../effect/effect-proposal";

export const EmptyOperationArgumentsSchema = z.object({}).strict();
export const EmptyOperationResultSchema = z.object({}).strict();

export const OperationEventIgnoreRuleSchema = z
  .object({
    eventType: z.string().min(1).max(120),
    attributes: JsonObjectSchema,
  })
  .strict();
export type OperationEventIgnoreRule = z.infer<
  typeof OperationEventIgnoreRuleSchema
>;

export const PublicBehaviorDeclarationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hidden") }).strict(),
  z
    .object({
      kind: z.literal("visible"),
      label: z.string().min(1).max(160),
    })
    .strict(),
]);
export type PublicBehaviorDeclaration = z.infer<
  typeof PublicBehaviorDeclarationSchema
>;

export const OperationDomainFailureDefinitionSchema = z
  .object({
    code: OperationDomainFailureCodeSchema,
    summary: z.string().min(1).max(500),
  })
  .strict();
export type OperationDomainFailureDefinition = z.infer<
  typeof OperationDomainFailureDefinitionSchema
>;

export interface OperationContract<
  State,
  Context,
  Arguments extends JsonObject = JsonObject,
> {
  readonly taskSlots: readonly TaskTrack[];
  readonly parametersSchema: z.ZodType<Arguments>;
  readonly eventIgnore: readonly OperationEventIgnoreRule[];
  readonly publicBehavior: PublicBehaviorDeclaration;
  readonly domainFailures: readonly OperationDomainFailureDefinition[];
  readonly resultSchema: z.ZodType<JsonObject>;
  resolveDuration(
    state: Readonly<State>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
  ): OperationDuration;
  fuse(
    state: Readonly<State>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
  ): JsonObject | null;
}

export const OperationTerminalProposalSchema = EffectProposalSchema.extend({
  result: JsonObjectSchema,
}).strict();
export interface OperationTerminalProposal extends EffectProposal {
  readonly result: JsonObject;
}

const OperationStartedResultSchema = z
  .object({
    kind: z.literal("started"),
    proposal: EffectProposalSchema,
  })
  .strict();

export const OperationStartResultSchema = z.discriminatedUnion("kind", [
  OperationStartedResultSchema,
  OperationDomainFailureSchema,
  OperationTechnicalFailureSchema,
]);
export type OperationStartResult = z.infer<typeof OperationStartResultSchema>;

export const OperationTickResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("running"),
      proposal: EffectProposalSchema,
    })
    .strict(),
  z.object({ kind: z.literal("complete") }).strict(),
  OperationDomainFailureSchema,
  OperationTechnicalFailureSchema,
]);
export type OperationTickResult = z.infer<typeof OperationTickResultSchema>;

export interface OperationLifecycle<
  State,
  Context,
  Arguments extends JsonObject = JsonObject,
> {
  start(
    state: Readonly<State>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
  ): OperationStartResult;
  tick?(
    state: Readonly<State>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
  ): OperationTickResult;
  complete(
    state: Readonly<State>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
  ): OperationTerminalProposal;
  fail(
    state: Readonly<State>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
    failure: OperationDomainFailure,
  ): OperationTerminalProposal;
  cancel(
    state: Readonly<State>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
  ): OperationTerminalProposal;
  fuse(
    state: Readonly<State>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
  ): JsonObject | null;
}

export interface HostOperationContract<
  State,
  Context,
  Arguments extends JsonObject = JsonObject,
> extends OperationContract<State, Context, Arguments>,
    OperationLifecycle<State, Context, Arguments> {
  readonly manual: OperationManual;
  readonly target: OperationTargetRequirement;
}

interface UnknownOperationContract {
  readonly taskSlots?: unknown;
  readonly parametersSchema?: unknown;
  readonly eventIgnore?: unknown;
  readonly publicBehavior?: unknown;
  readonly domainFailures?: unknown;
  readonly resultSchema?: unknown;
  readonly resolveDuration?: unknown;
  readonly fail?: unknown;
  readonly cancel?: unknown;
  readonly fuse?: unknown;
}

function isZodSchema(value: unknown): value is z.ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    "safeParse" in value &&
    typeof value.safeParse === "function"
  );
}

export function assertOperationContract(
  label: string,
  definition: UnknownOperationContract,
): void {
  CanonicalTaskTracksSchema.parse(definition.taskSlots);
  if (!isZodSchema(definition.parametersSchema)) {
    throw new Error(label + " requires a parameter schema");
  }
  if (typeof definition.resolveDuration !== "function") {
    throw new Error(label + " requires a duration resolver");
  }
  if (!Array.isArray(definition.eventIgnore)) {
    throw new Error(label + " requires an event ignore declaration");
  }
  z.array(OperationEventIgnoreRuleSchema).parse(definition.eventIgnore);
  if (definition.publicBehavior === undefined) {
    throw new Error(label + " requires a public behavior declaration");
  }
  PublicBehaviorDeclarationSchema.parse(definition.publicBehavior);
  if (!Array.isArray(definition.domainFailures)) {
    throw new Error(label + " requires a domain failure catalog");
  }
  const failures = z
    .array(OperationDomainFailureDefinitionSchema)
    .parse(definition.domainFailures);
  const failureCodes = new Set<string>();
  for (const failure of failures) {
    if (failureCodes.has(failure.code)) {
      throw new Error(label + " contains duplicate domain failure " + failure.code);
    }
    failureCodes.add(failure.code);
  }
  if (!isZodSchema(definition.resultSchema)) {
    throw new Error(label + " requires a result schema");
  }
  if (typeof definition.fail !== "function") {
    throw new Error(label + " requires a failure lifecycle");
  }
  if (typeof definition.cancel !== "function") {
    throw new Error(label + " requires a cancel lifecycle");
  }
  if (typeof definition.fuse !== "function") {
    throw new Error(label + " requires a fuse lifecycle");
  }
}
