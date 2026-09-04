import { z } from "zod";

import {
  AgentIdSchema,
  CanonicalTaskTracksSchema,
  EntityIdSchema,
  JsonObjectSchema,
  OperationDomainFailureCodeSchema,
  OperationDomainFailureSchema,
  OperationDurationDeclarationSchema,
  OperationIdSchema,
  OperationManualSchema,
  OperationTargetRequirementSchema,
  OperationTechnicalFailureSchema,
  type JsonObject,
  type OperationDomainFailure,
  type OperationDomainFailureCode,
  type OperationDuration,
  type OperationDurationDeclaration,
  type OperationId,
  type OperationManual,
  type OperationTargetRequirement,
  type OperationTechnicalFailure,
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
    nextState: JsonObjectSchema,
  })
  .strict();

export const OperationStartResultSchema = z.discriminatedUnion("kind", [
  OperationStartedResultSchema,
  OperationDomainFailureSchema,
  OperationTechnicalFailureSchema,
]);
export type OperationStartResult<
  OperationState extends JsonObject = JsonObject,
> =
  | {
      readonly kind: "started";
      readonly proposal: EffectProposal;
      readonly nextState: OperationState;
    }
  | OperationDomainFailure
  | OperationTechnicalFailure;

export const OperationTickResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("running"),
      proposal: EffectProposalSchema,
      nextState: JsonObjectSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("complete"),
      nextState: JsonObjectSchema,
    })
    .strict(),
  OperationDomainFailureSchema,
  OperationTechnicalFailureSchema,
]);
export type OperationTickResult<
  OperationState extends JsonObject = JsonObject,
> =
  | {
      readonly kind: "running";
      readonly proposal: EffectProposal;
      readonly nextState: OperationState;
    }
  | {
      readonly kind: "complete";
      readonly nextState: OperationState;
    }
  | OperationDomainFailure
  | OperationTechnicalFailure;

export interface HostedOperationDomainFailureDefinition<
  Details extends JsonObject = JsonObject,
  Result extends JsonObject = JsonObject,
> {
  readonly code: OperationDomainFailureCode;
  readonly summary: string;
  readonly detailsSchema: z.ZodType<Details>;
  readonly resultSchema: z.ZodType<Result>;
}

export interface OperationLifecycle<
  HostState,
  Context,
  Arguments extends JsonObject = JsonObject,
  OperationState extends JsonObject = JsonObject,
> {
  start(
    hostState: Readonly<HostState>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
    operationState: Readonly<OperationState>,
  ): OperationStartResult<OperationState>;
  tick?(
    hostState: Readonly<HostState>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
    operationState: Readonly<OperationState>,
  ): OperationTickResult<OperationState>;
  complete(
    hostState: Readonly<HostState>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
    operationState: Readonly<OperationState>,
  ): OperationTerminalProposal;
  fail(
    hostState: Readonly<HostState>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
    operationState: Readonly<OperationState>,
    failure: OperationDomainFailure,
  ): OperationTerminalProposal;
  cancel(
    hostState: Readonly<HostState>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
    operationState: Readonly<OperationState>,
  ): OperationTerminalProposal;
  fuse(
    hostState: Readonly<HostState>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
    operationState: Readonly<OperationState>,
  ): JsonObject | null;
  acknowledgeFuseResult(
    hostState: Readonly<HostState>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
    operationState: Readonly<OperationState>,
    result: Readonly<JsonObject>,
  ): OperationState;
}

export interface HostOperationContract<
  HostState,
  Context,
  Arguments extends JsonObject = JsonObject,
  OperationState extends JsonObject = JsonObject,
> extends OperationLifecycle<
    HostState,
    Context,
    Arguments,
    OperationState
  > {
  readonly manual: OperationManual;
  readonly target: OperationTargetRequirement;
  readonly duration: OperationDurationDeclaration;
  readonly taskSlots: readonly TaskTrack[];
  readonly parametersSchema: z.ZodType<Arguments>;
  readonly eventIgnore: readonly OperationEventIgnoreRule[];
  readonly publicBehavior: PublicBehaviorDeclaration;
  readonly domainFailures: readonly HostedOperationDomainFailureDefinition[];
  readonly resultSchema: z.ZodType<JsonObject>;
  readonly stateSchema: z.ZodType<OperationState>;
  initialState(
    hostState: Readonly<HostState>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
  ): OperationState;
  resolveDuration(
    hostState: Readonly<HostState>,
    context: Context,
    argumentsValue: Readonly<Arguments>,
  ): OperationDuration;
}

export interface HostedOperationDefinition<
  HostState,
  Context,
  Arguments extends JsonObject = JsonObject,
  OperationState extends JsonObject = JsonObject,
> extends HostOperationContract<
    HostState,
    Context,
    Arguments,
    OperationState
  > {
  readonly id: OperationId;
  readonly displayName: string;
  readonly trigger: "active_command";
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

interface UnknownHostedOperationDefinition extends UnknownOperationContract {
  readonly id?: unknown;
  readonly displayName?: unknown;
  readonly trigger?: unknown;
  readonly manual?: unknown;
  readonly target?: unknown;
  readonly duration?: unknown;
  readonly stateSchema?: unknown;
  readonly initialState?: unknown;
  readonly start?: unknown;
  readonly tick?: unknown;
  readonly complete?: unknown;
  readonly acknowledgeFuseResult?: unknown;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJson(entry)]),
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

const OperationParametersDocumentSchema = z
  .object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
  })
  .passthrough();

export function operationParametersJsonSchema(
  schema: z.ZodType,
): JsonObject {
  const document = {
    ...(z.toJSONSchema(schema) as Record<string, unknown>),
  };
  delete document["$schema"];
  return JsonObjectSchema.parse(document);
}

function assertTargetParameterContract(
  label: string,
  target: OperationTargetRequirement,
  parametersDocument: JsonObject,
): void {
  const parameters = OperationParametersDocumentSchema.safeParse(
    parametersDocument,
  );
  if (!parameters.success) {
    throw new Error(label + " parameter schema must describe an object");
  }

  const targetParameterNames = [
    "targetCharacterId",
    "targetEntityId",
  ] as const;
  if (target.kind === "none") {
    for (const parameterName of targetParameterNames) {
      if (parameterName in parameters.data.properties) {
        throw new Error(
          `${label} none target cannot declare parameter ${parameterName}`,
        );
      }
    }
    return;
  }

  const parameterName =
    target.kind === "character" ? "targetCharacterId" : "targetEntityId";
  const incompatibleParameterName =
    target.kind === "character" ? "targetEntityId" : "targetCharacterId";
  if (incompatibleParameterName in parameters.data.properties) {
    throw new Error(
      `${label} ${target.kind} target cannot declare parameter ${incompatibleParameterName}`,
    );
  }
  if (
    !parameters.data.required?.includes(parameterName) ||
    !(parameterName in parameters.data.properties)
  ) {
    throw new Error(
      `${label} ${target.kind} target requires parameter ${parameterName}`,
    );
  }

  const expectedSchema = operationParametersJsonSchema(
    target.kind === "character" ? AgentIdSchema : EntityIdSchema,
  );
  if (!sameJson(parameters.data.properties[parameterName], expectedSchema)) {
    throw new Error(
      `${label} parameter ${parameterName} must use the canonical ID schema`,
    );
  }
}

function requireFunction(label: string, name: string, value: unknown): void {
  if (typeof value !== "function") {
    throw new Error(`${label} requires a ${name} lifecycle`);
  }
}

/**
 * 校验已经把宿主挂载声明与权威实现绑定后的完整定义。旧生产路径在
 * W1-X 删除前继续使用 assertOperationContract，不会隐式进入本校验器。
 */
export function assertHostedOperationContract(
  label: string,
  definition: UnknownHostedOperationDefinition,
): void {
  const id = OperationIdSchema.parse(definition.id);
  const displayName = z.string().min(1).max(160).parse(definition.displayName);
  z.literal("active_command").parse(definition.trigger);
  const manual = OperationManualSchema.parse(definition.manual);
  const target = OperationTargetRequirementSchema.parse(definition.target);
  const duration = OperationDurationDeclarationSchema.parse(definition.duration);
  const taskSlots = CanonicalTaskTracksSchema.parse(definition.taskSlots);

  if (!isZodSchema(definition.parametersSchema)) {
    throw new Error(label + " requires a parameter schema");
  }
  if (!Array.isArray(definition.eventIgnore)) {
    throw new Error(label + " requires an event ignore declaration");
  }
  z.array(OperationEventIgnoreRuleSchema).parse(definition.eventIgnore);
  PublicBehaviorDeclarationSchema.parse(definition.publicBehavior);
  if (!isZodSchema(definition.resultSchema)) {
    throw new Error(label + " requires a result schema");
  }
  if (!isZodSchema(definition.stateSchema)) {
    throw new Error(label + " requires an operation state schema");
  }
  if (!Array.isArray(definition.domainFailures)) {
    throw new Error(label + " requires a domain failure catalog");
  }

  const failureCodes = new Set<string>();
  for (const candidate of definition.domainFailures) {
    if (typeof candidate !== "object" || candidate === null) {
      throw new Error(label + " contains an invalid domain failure definition");
    }
    const entry = candidate as Record<string, unknown>;
    const code = OperationDomainFailureCodeSchema.parse(entry["code"]);
    z.string().min(1).max(500).parse(entry["summary"]);
    if (!isZodSchema(entry["detailsSchema"])) {
      throw new Error(`${label} domain failure ${code} requires a details schema`);
    }
    if (!isZodSchema(entry["resultSchema"])) {
      throw new Error(`${label} domain failure ${code} requires a result schema`);
    }
    if (failureCodes.has(code)) {
      throw new Error(`${label} contains duplicate domain failure ${code}`);
    }
    failureCodes.add(code);
  }

  requireFunction(label, "initial state", definition.initialState);
  requireFunction(label, "duration resolver", definition.resolveDuration);
  requireFunction(label, "start", definition.start);
  if (definition.tick !== undefined) requireFunction(label, "tick", definition.tick);
  requireFunction(label, "complete", definition.complete);
  requireFunction(label, "failure", definition.fail);
  requireFunction(label, "cancel", definition.cancel);
  requireFunction(label, "fuse", definition.fuse);
  requireFunction(
    label,
    "fuse result acknowledgement",
    definition.acknowledgeFuseResult,
  );

  if (id !== manual.operationId) {
    throw new Error(label + " operation ID does not match its manual");
  }
  if (displayName !== manual.displayName) {
    throw new Error(label + " display name does not match its manual");
  }
  if (!sameJson(taskSlots, manual.taskSlots)) {
    throw new Error(label + " task slots do not match its manual");
  }
  if (!sameJson(target, manual.target)) {
    throw new Error(label + " target requirement does not match its manual");
  }
  if (!sameJson(duration, manual.duration)) {
    throw new Error(label + " duration declaration does not match its manual");
  }

  let parametersDocument: JsonObject;
  try {
    parametersDocument = operationParametersJsonSchema(definition.parametersSchema);
  } catch {
    throw new Error(label + " parameter schema cannot be exposed as JSON Schema");
  }
  if (!sameJson(parametersDocument, manual.parametersSchema)) {
    throw new Error(label + " parameter schema does not match its manual");
  }
  assertTargetParameterContract(label, target, parametersDocument);

  const manualFailureCodes = new Set<string>();
  for (const precondition of manual.worldPreconditions) {
    if (manualFailureCodes.has(precondition.failureCode)) {
      throw new Error(
        `${label} manual contains duplicate precondition ${precondition.failureCode}`,
      );
    }
    if (!failureCodes.has(precondition.failureCode)) {
      throw new Error(
        `${label} manual references undeclared failure ${precondition.failureCode}`,
      );
    }
    manualFailureCodes.add(precondition.failureCode);
  }
}

function operationTechnicalFailure(
  code: string,
  message: string,
): OperationTechnicalFailure {
  return {
    kind: "technical_failure",
    category: "plugin",
    code,
    message,
    retryable: false,
  };
}

export type OperationStateValidationResult =
  | { readonly kind: "valid_state"; readonly state: JsonObject }
  | OperationTechnicalFailure;

export function validateOperationStateTransition(
  stateSchema: z.ZodType<JsonObject>,
  nextState: unknown,
): OperationStateValidationResult {
  const parsed = stateSchema.safeParse(nextState);
  const normalized = parsed.success
    ? JsonObjectSchema.safeParse(parsed.data)
    : undefined;
  if (!parsed.success || !normalized?.success) {
    return operationTechnicalFailure(
      "invalid_operation_state",
      "Operation lifecycle returned state that does not match stateSchema.",
    );
  }
  return { kind: "valid_state", state: normalized.data };
}

export type OperationDomainFailureValidationResult =
  | {
      readonly kind: "valid_domain_failure";
      readonly failure: OperationDomainFailure;
      readonly result: JsonObject;
    }
  | OperationTechnicalFailure;

export function validateOperationDomainFailureOutcome(
  catalog: readonly HostedOperationDomainFailureDefinition[],
  failureValue: unknown,
  resultValue: unknown,
): OperationDomainFailureValidationResult {
  const failure = OperationDomainFailureSchema.safeParse(failureValue);
  if (!failure.success) {
    return operationTechnicalFailure(
      "invalid_domain_failure",
      "Operation returned a malformed domain failure.",
    );
  }
  const declaration = catalog.find((entry) => entry.code === failure.data.code);
  if (!declaration) {
    return operationTechnicalFailure(
      "undeclared_domain_failure",
      `Operation returned undeclared domain failure ${failure.data.code}.`,
    );
  }
  const details = declaration.detailsSchema.safeParse(failure.data.details);
  const normalizedDetails = details.success
    ? JsonObjectSchema.safeParse(details.data)
    : undefined;
  if (!details.success || !normalizedDetails?.success) {
    return operationTechnicalFailure(
      "invalid_domain_failure_details",
      `Operation domain failure ${failure.data.code} returned invalid details.`,
    );
  }
  const result = declaration.resultSchema.safeParse(resultValue);
  const normalizedResult = result.success
    ? JsonObjectSchema.safeParse(result.data)
    : undefined;
  if (!result.success || !normalizedResult?.success) {
    return operationTechnicalFailure(
      "invalid_domain_failure_result",
      `Operation domain failure ${failure.data.code} returned an invalid result.`,
    );
  }
  return {
    kind: "valid_domain_failure",
    failure: {
      ...failure.data,
      details: normalizedDetails.data,
    },
    result: normalizedResult.data,
  };
}
